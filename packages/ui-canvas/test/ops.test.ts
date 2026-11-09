import { describe, expect, it } from 'vitest';
import * as C from '../src';

const seq = () => {
  let n = 0;
  return () => ((n++ * 7919) % 1000) / 1000;
};
const base = (): C.Canvas => ({
  nodes: [
    { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 400, label: 'G' },
    { id: 'a', type: 'text', text: 'a', x: 20, y: 20, width: 100, height: 60 },
    { id: 'b', type: 'text', text: 'b', x: 300, y: 20, width: 100, height: 60 },
    { id: 'out', type: 'text', text: 'o', x: 700, y: 20, width: 100, height: 60 },
  ],
  edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'a', toNode: 'out' }],
});

describe('adding', () => {
  it('a text node is centred on the point and can snap to a grid', () => {
    const { canvas, id } = C.addTextNode(C.emptyCanvas(), { x: 100, y: 100 }, 'hi', { random: seq() });
    expect(canvas.nodes[0]).toMatchObject({ id, type: 'text', text: 'hi', x: -25, y: 70, width: 250, height: 60 });
    const g = C.addTextNode(C.emptyCanvas(), { x: 103, y: 97 }, '', { grid: 20, random: seq() });
    expect(g.canvas.nodes[0]).toMatchObject({ x: -20, y: 60 });
  });

  it('file and link nodes carry their target', () => {
    const f = C.addFileNode(C.emptyCanvas(), { x: 0, y: 0 }, 'A/B.md', { subpath: '#Intro', random: seq() });
    expect(f.canvas.nodes[0]).toMatchObject({ type: 'file', file: 'A/B.md', subpath: '#Intro' });
    const l = C.addLinkNode(C.emptyCanvas(), { x: 0, y: 0 }, 'https://x.org', { random: seq() });
    expect(l.canvas.nodes[0]).toMatchObject({ type: 'link', url: 'https://x.org' });
  });

  it('a group made around nodes fits them with a margin and is drawn beneath them', () => {
    const { canvas, id } = C.addGroup(base(), { x: 0, y: 0 }, { around: ['b', 'out'], label: 'New', random: seq() });
    const g = canvas.nodes.find((n) => n.id === id)!;
    expect(g).toMatchObject({ type: 'group', label: 'New', x: 280, y: 0, width: 540, height: 100 });
    expect(canvas.nodes.findIndex((n) => n.id === id)).toBeLessThan(canvas.nodes.findIndex((n) => n.id === 'b'));
  });

  it('an edge picks facing sides, and a node cannot be joined to itself or twice the same way', () => {
    const one = C.addEdge(base(), 'b', 'a', { random: seq() });
    expect(one.canvas.edges.at(-1)).toMatchObject({ fromNode: 'b', fromSide: 'left', toNode: 'a', toSide: 'right', toEnd: 'arrow' });
    expect(C.addEdge(base(), 'a', 'a').id).toBeNull();
    expect(C.addEdge(base(), 'a', 'b').id).toBeNull(); // e1 already joins them (sides left unset mean "facing")
    expect(C.addEdge(base(), 'a', 'nope').id).toBeNull();
    expect(C.addEdge(base(), 'a', 'b', { fromSide: 'bottom', toSide: 'bottom', random: seq() }).id).not.toBeNull();
  });
});

describe('changing', () => {
  it('moving a group moves what is in it, and not what is outside', () => {
    const c = C.moveNodes(base(), ['g'], 10, 5);
    expect(c.nodes.map((n) => [n.id, n.x, n.y])).toEqual([['g', 10, 5], ['a', 30, 25], ['b', 310, 25], ['out', 700, 20]]);
  });

  it('moving does not change the canvas it was given', () => {
    const before = base();
    const copy = JSON.stringify(before);
    C.moveNodes(before, ['a'], 1, 1);
    expect(JSON.stringify(before)).toBe(copy);
  });

  it('resizing keeps a minimum size', () => {
    const c = C.resizeNode(base(), 'a', { x: 20, y: 20, width: 5, height: 5 });
    expect(c.nodes[1]).toMatchObject({ width: C.MIN_WIDTH, height: C.MIN_HEIGHT });
  });

  it('updating sets a field, and undefined removes it', () => {
    let c = C.updateNode(base(), 'a', { color: '4', text: 'new' });
    expect(c.nodes[1]).toMatchObject({ color: '4', text: 'new' });
    c = C.updateNode(c, 'a', { color: undefined });
    expect('color' in c.nodes[1]!).toBe(false);
    c = C.updateEdge(c, 'e1', { label: 'x', color: '2' });
    expect(c.edges[0]).toMatchObject({ label: 'x', color: '2' });
    expect('label' in C.updateEdge(c, 'e1', { label: undefined }).edges[0]!).toBe(false);
  });

  it('removing a node removes its edges', () => {
    const c = C.removeNodes(base(), ['b']);
    expect(c.nodes.map((n) => n.id)).toEqual(['g', 'a', 'out']);
    expect(c.edges.map((e) => e.id)).toEqual(['e2']);
    expect(C.removeEdges(base(), ['e1']).edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('front and back reorder the drawing order', () => {
    expect(C.bringToFront(base(), ['a']).nodes.map((n) => n.id)).toEqual(['g', 'b', 'out', 'a']);
    expect(C.sendToBack(base(), ['out']).nodes.map((n) => n.id)).toEqual(['out', 'g', 'a', 'b']);
  });

  it('duplicating copies nodes and the edges between them, with new ids', () => {
    const { canvas, ids } = C.duplicateNodes(base(), ['a', 'b'], 40, 40, seq());
    expect(ids).toHaveLength(2);
    expect(canvas.nodes).toHaveLength(6);
    const copies = canvas.nodes.filter((n) => ids.includes(n.id));
    expect(copies.map((n) => [n.x, n.y])).toEqual([[60, 60], [340, 60]]);
    const newEdges = canvas.edges.filter((e) => !['e1', 'e2'].includes(e.id));
    expect(newEdges).toHaveLength(1); // a→b is copied, a→out leaves the selection
    expect(newEdges[0]).toMatchObject({ fromNode: ids[0], toNode: ids[1] });
    expect(new Set(canvas.nodes.map((n) => n.id)).size).toBe(6);
  });

  it('aligns nodes', () => {
    const left = C.alignNodes(base(), ['a', 'b', 'out'], 'left');
    expect(left.nodes.filter((n) => n.type === 'text').map((n) => n.x)).toEqual([20, 20, 20]);
    const right = C.alignNodes(base(), ['a', 'out'], 'right');
    expect(right.nodes.find((n) => n.id === 'a')!.x).toBe(700);
    const one = base();
    expect(C.alignNodes(one, ['a'], 'left')).toBe(one); // one node: nothing to do
  });
});

describe('geometry', () => {
  it('bounds, anchors and facing sides', () => {
    const c = base();
    expect(C.boundsOf(c.nodes)).toEqual({ x: 0, y: 0, width: 800, height: 400 });
    expect(C.boundsOf([])).toBeNull();
    expect(C.anchor({ x: 0, y: 0, width: 100, height: 50 }, 'right')).toEqual({ x: 100, y: 25 });
    expect(C.anchor({ x: 0, y: 0, width: 100, height: 50 }, 'top')).toEqual({ x: 50, y: 0 });
    expect(C.sidesBetween({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 5, width: 10, height: 10 })).toEqual({ from: 'right', to: 'left' });
    expect(C.sidesBetween({ x: 0, y: 100, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 })).toEqual({ from: 'top', to: 'bottom' });
  });

  it('an edge curve leaves and enters at right angles and has a middle', () => {
    const g = C.edgeGeometry({ x: 0, y: 0, width: 100, height: 100 }, 'right', { x: 300, y: 0, width: 100, height: 100 }, 'left');
    expect(g.from).toMatchObject({ x: 100, y: 50, side: 'right' });
    expect(g.to).toMatchObject({ x: 300, y: 50, side: 'left' });
    expect(g.d).toBe('M 100 50 C 200 50, 200 50, 300 50');
    expect(g.mid).toEqual({ x: 200, y: 50 });
  });

  it('membership is wholly inside the group', () => {
    const c = base();
    c.nodes.push({ id: 'half', type: 'text', text: '', x: 450, y: 20, width: 100, height: 60 });
    expect(C.membersOf(c, 'g').map((n) => n.id)).toEqual(['a', 'b']);
    expect(C.membersOf(c, 'a')).toEqual([]);
  });

  it('colours: presets, hex and nonsense', () => {
    expect(C.cssColor('1')).toBe('#fb464c');
    expect(C.cssColor('#abc')).toBe('#abc');
    expect(C.cssColor('#12345678')).toBeNull();
    expect(C.cssColor('red')).toBeNull();
    expect(C.cssColor(undefined)).toBeNull();
  });

  it('zoom keeps the point under the pointer still, and fit shows everything', () => {
    const v = C.zoomAt({ x: 0, y: 0, zoom: 1 }, 2, { x: 100, y: 100 });
    expect(v).toEqual({ x: -100, y: -100, zoom: 2 });
    expect(C.toCanvasPoint(v, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(C.zoomAt({ x: 0, y: 0, zoom: 3.9 }, 10, { x: 0, y: 0 }).zoom).toBe(C.MAX_ZOOM);
    const fit = C.fitViewport({ x: 0, y: 0, width: 2000, height: 1000 }, { width: 1000, height: 500 }, 0);
    expect(fit.zoom).toBe(0.5);
    expect(C.toScreenPoint(fit, { x: 1000, y: 500 })).toEqual({ x: 500, y: 250 });
    expect(C.fitViewport(null, { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 });
  });
});

describe('reconnecting an edge', () => {
  it('moves one end and keeps the other', () => {
    const c = C.reconnectEdge(base(), 'e1', 'to', 'out', 'top');
    expect(c.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'out', toSide: 'top' });
    const f = C.reconnectEdge(base(), 'e1', 'from', 'out', 'left');
    expect(f.edges[0]).toMatchObject({ fromNode: 'out', fromSide: 'left', toNode: 'b' });
  });
  it('refuses to join a node to itself, to a node that is not there, or to say what is already so', () => {
    const c = base();
    expect(C.reconnectEdge(c, 'e1', 'to', 'a', 'top')).toBe(c);
    expect(C.reconnectEdge(c, 'e1', 'to', 'nope', 'top')).toBe(c);
    expect(C.reconnectEdge(c, 'nope', 'to', 'b', 'top')).toBe(c);
    const r = C.reconnectEdge(c, 'e1', 'to', 'out', 'top');
    expect(C.reconnectEdge(r, 'e1', 'to', 'out', 'top')).toBe(r);
  });
  it('a picture card starts bigger than a page card, and a card is expanded from a height', () => {
    expect(C.addFileNode(C.emptyCanvas(), { x: 0, y: 0 }, 'a/b.md').canvas.nodes[0]).toMatchObject({ width: 260, height: 72 });
    expect(C.addFileNode(C.emptyCanvas(), { x: 0, y: 0 }, 'a/b.PNG').canvas.nodes[0]).toMatchObject({ width: 320, height: 220 });
    expect(C.isExpanded({ height: 139 })).toBe(false);
    expect(C.isExpanded({ height: 140 })).toBe(true);
  });
});

describe('looks, arrowheads and the list of objects', () => {
  const { cycleArrows, arrowEnds, objectTree, describeNode, distributeNodes, shapeOf, borderStyleOf } = C;
  type Canvas = C.Canvas;
  const base = (): Canvas => ({
    nodes: [
      { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 300, label: 'Box' },
      { id: 'in', type: 'text', text: '# Inside\nmore', x: 20, y: 20, width: 100, height: 60 },
      { id: 'out', type: 'text', text: '', x: 700, y: 0, width: 100, height: 60 },
    ],
    edges: [{ id: 'e', fromNode: 'in', toNode: 'out' }],
  });

  it('cycles the arrowheads: far end, near end, both, neither', () => {
    let c = base();
    const seen: Array<[boolean, boolean]> = [];
    for (let i = 0; i < 5; i++) {
      c = cycleArrows(c, ['e']);
      const a = arrowEnds(c.edges[0]!);
      seen.push([a.from, a.to]);
    }
    expect(seen).toEqual([[true, false], [true, true], [false, false], [false, true], [true, false]]);
  });

  it('lists a group with what is inside it beneath', () => {
    const tree = objectTree(base()).map((r) => `${r.depth}:${r.node.id}`);
    expect(tree).toEqual(['0:g', '1:in', '0:out']);
  });

  it('two groups of the same size do not hide each other', () => {
    const c: Canvas = { nodes: [{ id: 'a', type: 'group', x: 0, y: 0, width: 100, height: 100 }, { id: 'b', type: 'group', x: 0, y: 0, width: 100, height: 100 }], edges: [] };
    expect(objectTree(c).map((r) => r.node.id).sort()).toEqual(['a', 'b']);
  });

  it('names nodes for the list', () => {
    const c = base();
    expect(describeNode(c.nodes[1]!)).toBe('Inside');
    expect(describeNode(c.nodes[2]!)).toBe('(empty note)');
    expect(describeNode(c.nodes[0]!)).toBe('Box');
  });

  it('spaces three nodes evenly and keeps the outer two', () => {
    const c: Canvas = { nodes: [0, 10, 300].map((x, i) => ({ id: `n${i}`, type: 'text' as const, text: '', x, y: 0, width: 100, height: 50 })), edges: [] };
    const out = distributeNodes(c, ['n0', 'n1', 'n2'], 'horizontal');
    expect(out.nodes.map((n) => n.x)).toEqual([0, 150, 300]);
  });

  it('reads shapes and border styles, ignoring what it does not know', () => {
    expect(shapeOf({ shape: 'diamond' })).toBe('diamond');
    expect(shapeOf({ shape: 'star' })).toBe('rounded');
    expect(borderStyleOf({ borderStyle: 'dotted' })).toBe('dotted');
    expect(borderStyleOf({})).toBeNull();
  });
});
