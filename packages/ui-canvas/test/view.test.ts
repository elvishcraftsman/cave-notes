// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasView, plainHost, type Canvas } from '../src';

let parent: HTMLElement;
let changes: Canvas[];
let view: CanvasView;

const make = (): Canvas => ({
  nodes: [
    { id: 'a', type: 'text', text: 'one', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', type: 'text', text: 'two', x: 400, y: 0, width: 200, height: 100 },
  ],
  edges: [],
});

/** jsdom has no layout: give the root a size and the world an identity viewport. */
function open(canvas = make(), opts: { readOnly?: boolean; grid?: number } = {}): void {
  parent = document.createElement('div');
  document.body.append(parent);
  changes = [];
  const host = { ...plainHost((c) => changes.push(c)), chooseFile: async () => 'Notes/Idea.md', askUrl: async () => 'https://example.org' };
  const proto = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList?.contains('cv-root') ? ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0 } as DOMRect) : proto.call(this);
  };
  view = new CanvasView(parent, host, canvas, opts);
  view.setViewport({ x: 0, y: 0, zoom: 1 });
}

const ptr = (type: string, target: Element, x: number, y: number, extra: PointerEventInit = {}): void => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }) as MouseEvent & { pointerId: number };
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  target.dispatchEvent(ev);
};
const nodeEl = (id: string): HTMLElement => parent.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
const drag = (target: Element, from: [number, number], to: [number, number], extra: PointerEventInit = {}): void => {
  ptr('pointerdown', target, from[0], from[1], extra);
  ptr('pointermove', view.root, to[0], to[1], extra);
  ptr('pointerup', view.root, to[0], to[1], extra);
};
const key = (k: string, extra: KeyboardEventInit = {}): void => void view.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

beforeEach(() => open());
afterEach(() => {
  view.destroy();
  parent.remove();
});

describe('drawing', () => {
  it('draws every node where the file puts it', () => {
    expect(parent.querySelectorAll('.cv-node')).toHaveLength(2);
    expect(nodeEl('b').style.left).toBe('400px');
    expect(nodeEl('a').textContent).toBe('one');
  });

  it('draws an edge between two nodes, and a label', () => {
    view.destroy();
    open({ ...make(), edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'leads to' }] });
    expect(parent.querySelectorAll('.cv-edge-line')).toHaveLength(1);
    expect(parent.querySelector('.cv-edge-line')!.getAttribute('d')).toBe('M 200 50 C 300 50, 300 50, 400 50'.replace('300 50, 300 50', '300 50, 300 50'));
    expect(parent.querySelector('.cv-edge-label')!.textContent).toBe('leads to');
  });
});

describe('selecting and moving', () => {
  it('a click selects, a click on the empty canvas lets go', () => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    expect(view.selected).toEqual(['a']);
    expect(changes).toHaveLength(0);
    ptr('pointerdown', view.root, 800, 500);
    ptr('pointerup', view.root, 800, 500);
    expect(view.selected).toEqual([]);
  });

  it('a drag moves the node and is one change, made when the pointer is let go', () => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointermove', view.root, 80, 70);
    expect(changes).toHaveLength(0);
    expect(nodeEl('a').style.left).toBe('30px');
    ptr('pointerup', view.root, 80, 70);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.nodes[0]).toMatchObject({ id: 'a', x: 30, y: 20 });
  });

  it('a tiny wobble while clicking is not a move', () => {
    drag(nodeEl('a'), [50, 50], [51, 50]);
    expect(changes).toHaveLength(0);
  });

  it('dragging the empty canvas pans and changes nothing in the file', () => {
    drag(view.root, [800, 500], [850, 530]);
    expect(view.viewport).toMatchObject({ x: 50, y: 30, zoom: 1 });
    expect(changes).toHaveLength(0);
  });

  it('shift-drag selects the nodes inside the box', () => {
    drag(view.root, [-10, -10], [650, 150], { shiftKey: true });
    expect(view.selected.sort()).toEqual(['a', 'b']);
  });

  it('grid snaps what is dropped', () => {
    view.destroy();
    open(make(), { grid: 20 });
    drag(nodeEl('a'), [50, 50], [69, 63]);
    expect(changes[0]!.nodes[0]).toMatchObject({ x: 20, y: 20 });
  });
});

describe('resizing and connecting', () => {
  it('the handles of a lone selected node resize it', () => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    const se = nodeEl('a').querySelector('[data-handle="se"]')!;
    drag(se, [200, 100], [260, 150]);
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ x: 0, y: 0, width: 260, height: 150 });
  });

  it('dragging from a side port to another node joins them', () => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    const port = nodeEl('a').querySelector('[data-port="right"]')!;
    ptr('pointerdown', port, 210, 50);
    ptr('pointermove', view.root, 450, 50);
    ptr('pointerup', view.root, 450, 50);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.edges[0]).toMatchObject({ fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', toEnd: 'arrow' });
    expect(view.selected).toEqual([changes[0]!.edges[0]!.id]);
  });

  it('letting go over nothing joins nothing', () => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    const port = nodeEl('a').querySelector('[data-port="bottom"]')!;
    ptr('pointerdown', port, 100, 110);
    ptr('pointerup', view.root, 100, 400);
    expect(changes).toHaveLength(0);
  });
});

describe('making and removing', () => {
  it('a double click on empty canvas makes a text node there and edits it', () => {
    view.root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 800, clientY: 400 }));
    expect(changes).toHaveLength(1);
    const made = changes[0]!.nodes.at(-1)!;
    expect(made).toMatchObject({ type: 'text', text: '', x: 675, y: 370 });
    expect(parent.querySelector('textarea')).not.toBeNull();
  });

  it('typing in a node keeps the text on the canvas as it goes', () => {
    nodeEl('a').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 }));
    const ta = parent.querySelector('textarea')!;
    ta.value = 'changed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ id: 'a', text: 'changed' });
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.querySelector('textarea')).toBeNull();
  });

  it('Delete removes the selection and the edges that joined it', () => {
    view.destroy();
    open({ ...make(), edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] });
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    key('Delete');
    expect(changes.at(-1)!.nodes.map((n) => n.id)).toEqual(['b']);
    expect(changes.at(-1)!.edges).toEqual([]);
  });

  it('Ctrl+D duplicates, Ctrl+G groups', () => {
    view.select(['a']);
    key('d', { ctrlKey: true });
    expect(changes.at(-1)!.nodes).toHaveLength(3);
    view.select(['a', 'b']);
    key('g', { ctrlKey: true });
    expect(changes.at(-1)!.nodes.some((n) => n.type === 'group')).toBe(true);
  });

  it('the arrow keys nudge the selection', () => {
    view.select(['a']);
    key('ArrowRight');
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ x: 10 });
    key('ArrowDown', { shiftKey: true });
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ y: 50 });
  });

  it('the palette adds a file card and a web link through the host', async () => {
    (parent.querySelectorAll('.cv-palette .cv-add')[1] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(changes.at(-1)!.nodes.at(-1)).toMatchObject({ type: 'file', file: 'Notes/Idea.md' });
    (parent.querySelectorAll('.cv-palette .cv-add')[2] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(changes.at(-1)!.nodes.at(-1)).toMatchObject({ type: 'link', url: 'https://example.org' });
  });
});

describe('colour and the toolbar', () => {
  it('a swatch colours the selection', () => {
    view.select(['a', 'b']);
    (parent.querySelectorAll('.cv-toolbar .cv-swatch')[3] as HTMLElement).click();
    expect(changes.at(-1)!.nodes.map((n) => n.color)).toEqual(['4', '4']);
    expect(nodeEl('a').style.getPropertyValue('--cv-color')).toBe('#44cf6e');
  });

  it('the toolbar is hidden while nothing is selected', () => {
    expect((parent.querySelector('.cv-toolbar') as HTMLElement).hidden).toBe(true);
    view.select(['a']);
    expect((parent.querySelector('.cv-toolbar') as HTMLElement).hidden).toBe(false);
  });
});

describe('the view and the file', () => {
  it('setCanvas shows what the editor says (undo, a sync) and keeps the view', () => {
    view.setViewport({ x: 30, y: 40, zoom: 2 });
    view.select(['a', 'b']);
    view.setCanvas({ nodes: [make().nodes[0]!], edges: [] });
    expect(parent.querySelectorAll('.cv-node')).toHaveLength(1);
    expect(view.selected).toEqual(['a']);
    expect(view.viewport).toEqual({ x: 30, y: 40, zoom: 2 });
    expect(changes).toHaveLength(0); // what comes from the editor is not reported back
  });

  it('wheel with Ctrl zooms about the pointer; plain wheel pans', () => {
    const w = (init: WheelEventInit): void => void view.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
    w({ deltaY: 30, clientX: 100, clientY: 100 });
    expect(view.viewport).toMatchObject({ x: 0, y: -30, zoom: 1 });
    w({ deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });
    expect(view.viewport.zoom).toBeGreaterThan(1);
  });

  it('a read-only canvas can be looked at but not changed', () => {
    view.destroy();
    open(make(), { readOnly: true });
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointermove', view.root, 150, 150);
    ptr('pointerup', view.root, 150, 150);
    key('Delete');
    view.root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 800, clientY: 400 }));
    expect(changes).toHaveLength(0);
    expect(nodeEl('a').style.left).toBe('0px');
    expect(parent.querySelector('.cv-handle')).toBeNull();
  });
});

/** A real click is pointerdown, pointerup, then click on the element under the pointer, with the page free to change in between. */
function realClick(el: Element): void {
  const r = { clientX: 5, clientY: 5 };
  ptr('pointerdown', el, r.clientX, r.clientY);
  ptr('pointerup', el, r.clientX, r.clientY);
  // whatever the pointer-up did to the page, the click goes to the element the press began on, if it is still there
  if (el.isConnected) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('the selection toolbar under a real mouse', () => {
  it('its buttons are still there after the pointer is let go, so the click reaches them', () => {
    view.select(['a']);
    const sw = parent.querySelectorAll('.cv-toolbar .cv-swatch')[1] as HTMLElement;
    realClick(sw);
    expect(sw.isConnected).toBe(true);
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ color: '2' });
  });

  it('the arrow button goes through the four arrowhead choices', () => {
    view.destroy();
    open({ ...make(), edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', toEnd: 'arrow' }] });
    view.select(['e']);
    const seen: Array<[unknown, unknown]> = [];
    for (let i = 0; i < 4; i++) {
      const btn = [...parent.querySelectorAll<HTMLElement>('.cv-toolbar .cv-btn')].find((b) => b.title.startsWith('Arrowheads'))!;
      realClick(btn);
      const e = changes.at(-1)!.edges[0]!;
      seen.push([e.fromEnd ?? 'none', e.toEnd ?? 'arrow']);
    }
    expect(seen).toEqual([['arrow', 'none'], ['arrow', 'arrow'], ['none', 'none'], ['none', 'arrow']]);
  });

  it('the palette and zoom buttons are not rebuilt either', () => {
    const plus = parent.querySelector('.cv-zoom .cv-btn') as HTMLElement;
    realClick(plus);
    expect(plus.isConnected).toBe(true);
    expect(view.viewport.zoom).toBeGreaterThan(1);
  });
});

describe('background', () => {
  it('the dots move and scale with the canvas', () => {
    drag(view.root, [800, 500], [850, 530]);
    expect(view.root.style.getPropertyValue('--cv-x')).toBe('50px');
    expect(view.root.style.getPropertyValue('--cv-y')).toBe('30px');
    view.setViewport({ x: 0, y: 0, zoom: 2 });
    expect(view.root.style.getPropertyValue('--cv-zoom')).toBe('2');
  });
});

describe('joining cards', () => {
  const portDrag = (to: [number, number], onMove?: () => void): void => {
    ptr('pointerdown', nodeEl('a'), 50, 50);
    ptr('pointerup', view.root, 50, 50);
    const port = nodeEl('a').querySelector('[data-port="right"]')!;
    ptr('pointerdown', port, 210, 50);
    ptr('pointermove', view.root, to[0], to[1]);
    onMove?.();
    ptr('pointerup', view.root, to[0], to[1]);
  };

  it('shows the four sides of the card it would join, the nearest one lit', () => {
    let hints = 0;
    let lit = '';
    portDrag([430, 60], () => {
      hints = parent.querySelectorAll('.cv-hint').length;
      lit = parent.querySelector('.cv-hint-on')!.getAttribute('cx')! + ',' + parent.querySelector('.cv-hint-on')!.getAttribute('cy')!;
    });
    expect(hints).toBe(4);
    expect(lit).toBe('400,50'); // the left side of the card at x=400
  });

  it('joins at the side that was chosen, not at the side that happens to face', () => {
    portDrag([500, 95]); // near the bottom of b
    expect(changes.at(-1)!.edges[0]).toMatchObject({ fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'bottom' });
  });

  it('shows no sides while the pointer is over nothing', () => {
    let hints = -1;
    portDrag([300, 400], () => (hints = parent.querySelectorAll('.cv-hint').length));
    expect(hints).toBe(0);
  });
});

describe('moving the end of an arrow', () => {
  const edged = (): Canvas => ({ ...make(), nodes: [...make().nodes, { id: 'c', type: 'text', text: 'three', x: 400, y: 300, width: 200, height: 100 }], edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', toEnd: 'arrow' }] });

  it('a selected arrow shows a handle at each end', () => {
    view.destroy();
    open(edged());
    view.select(['e']);
    expect(parent.querySelectorAll('.cv-edge-end')).toHaveLength(2);
    view.select([]);
    expect(parent.querySelectorAll('.cv-edge-end')).toHaveLength(0);
  });

  it('dragging the arrowhead onto another card, at the side picked, moves that end', () => {
    view.destroy();
    open(edged());
    view.select(['e']);
    const end = parent.querySelector('.cv-edge-end[data-end="to"]')!;
    ptr('pointerdown', end, 400, 50);
    ptr('pointermove', view.root, 500, 300);
    expect(parent.querySelectorAll('.cv-hint')).toHaveLength(4);
    ptr('pointerup', view.root, 500, 300);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.edges[0]).toMatchObject({ fromNode: 'a', fromSide: 'right', toNode: 'c', toSide: 'top' });
  });

  it('dragging the tail moves the other end, and letting go over nothing changes nothing', () => {
    view.destroy();
    open(edged());
    view.select(['e']);
    ptr('pointerdown', parent.querySelector('.cv-edge-end[data-end="from"]')!, 200, 50);
    ptr('pointermove', view.root, 500, 700);
    ptr('pointerup', view.root, 500, 700);
    expect(changes).toHaveLength(0);
    ptr('pointerdown', parent.querySelector('.cv-edge-end[data-end="from"]')!, 200, 50);
    ptr('pointermove', view.root, 450, 350);
    ptr('pointerup', view.root, 450, 350);
    expect(changes[0]!.edges[0]).toMatchObject({ fromNode: 'c', toNode: 'b' });
  });
});

describe('page cards', () => {
  const withFile = (h = 72): Canvas => ({ nodes: [{ id: 'f', type: 'file', file: 'Notes/Idea.md', x: 0, y: 0, width: 260, height: h }], edges: [] });

  it('start small and open out to show more, and fold up again', () => {
    view.destroy();
    const asked: boolean[] = [];
    parent = document.createElement('div');
    document.body.append(parent);
    changes = [];
    const host = { ...plainHost((c) => changes.push(c)), fillFile: (el: HTMLElement, _n: unknown, expanded: boolean) => { asked.push(expanded); el.textContent = expanded ? 'preview' : 'name'; } };
    view = new CanvasView(parent, host as never, withFile());
    view.setViewport({ x: 0, y: 0, zoom: 1 });
    expect(nodeEl('f').textContent).toContain('name');
    const b = nodeEl('f').querySelector<HTMLElement>('.cv-expand')!;
    expect(b.getAttribute('aria-expanded')).toBe('false');
    b.click();
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ width: 420, height: 380 });
    expect(nodeEl('f').textContent).toContain('preview');
    nodeEl('f').querySelector<HTMLElement>('.cv-expand')!.click();
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ width: 260, height: 72 });
    expect(asked).toEqual([false, true, false]);
  });

  it('a card dragged taller shows the preview too', () => {
    view.destroy();
    open(withFile(200));
    expect(nodeEl('f').querySelector('.cv-expand')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('there is no expand button in a read-only canvas, or on other cards', () => {
    view.destroy();
    open(withFile(), { readOnly: true });
    expect(parent.querySelector('.cv-expand')).toBeNull();
    view.destroy();
    open();
    expect(parent.querySelector('.cv-expand')).toBeNull();
  });
});

describe('dropping pages', () => {
  const dropOf = (types: string[], paths: string[]): Event => {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types, getData: () => '', dropEffect: '' } });
    Object.defineProperty(e, 'clientX', { value: 300 });
    Object.defineProperty(e, 'clientY', { value: 200 });
    (e as unknown as { paths: string[] }).paths = paths;
    return e;
  };

  function openWithDrop(): void {
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    changes = [];
    const host = {
      ...plainHost((c) => changes.push(c)),
      canDrop: (types: readonly string[]) => types.includes('application/x-cave-page'),
      dropPaths: (dt: DataTransfer) => (dt as unknown as { __paths?: string[] }).__paths ?? ['Notes/A.md', 'B.md'],
    };
    view = new CanvasView(parent, host, make());
    view.setViewport({ x: 0, y: 0, zoom: 1 });
  }

  it('pages dragged over are accepted, other things are not', () => {
    openWithDrop();
    const over = (types: string[]): boolean => {
      const e = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: { types, dropEffect: '' } });
      view.root.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(over(['application/x-cave-page'])).toBe(true);
    expect(over(['text/plain'])).toBe(false);
  });

  it('dropped pages become page cards where they land, side by side, in one change', () => {
    openWithDrop();
    view.root.dispatchEvent(dropOf(['application/x-cave-page'], []));
    expect(changes).toHaveLength(1);
    const added = changes[0]!.nodes.slice(2);
    expect(added.map((n) => [n.type, (n as { file: string }).file, n.x, n.y])).toEqual([['file', 'Notes/A.md', 170, 164], ['file', 'B.md', 450, 164]]);
    expect(view.selected).toHaveLength(2);
  });
});

describe('view mode, the menu, snapping and the pieces beside the canvas', () => {
  it('view mode: a click on a page card opens it, and dragging moves the view instead', () => {
    view.destroy();
    const opened: string[] = [];
    parent = document.createElement('div');
    document.body.append(parent);
    const proto = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.classList?.contains('cv-root') ? ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0 } as DOMRect) : proto.call(this);
    };
    const c: Canvas = { nodes: [{ id: 'f', type: 'file', file: 'Notes/Idea.md', x: 0, y: 0, width: 200, height: 72 }, { id: 'l', type: 'link', url: 'https://example.org', x: 400, y: 0, width: 200, height: 100 }], edges: [] };
    view = new CanvasView(parent, { ...plainHost(), openFile: (n) => void opened.push(n.file), openUrl: (u) => void opened.push(u) }, c, {});
    view.setViewport({ x: 0, y: 0, zoom: 1 });
    view.setViewMode(true);
    ptr('pointerdown', nodeEl('f'), 50, 30);
    ptr('pointerup', view.root, 50, 30);
    expect(opened).toEqual(['Notes/Idea.md']);
    ptr('pointerdown', nodeEl('l'), 450, 30);
    ptr('pointerup', view.root, 450, 30);
    expect(opened).toEqual(['Notes/Idea.md', 'https://example.org']);
    drag(nodeEl('f'), [50, 30], [150, 30]);
    expect(opened).toHaveLength(2);
    expect(view.viewport.x).toBe(100);
    expect(changes).toHaveLength(0);
  });

  it('view mode cannot be left when the app forbids changes, and the mode is remembered', () => {
    view.destroy();
    const store: Record<string, boolean> = {};
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, { ...plainHost(), pref: { get: (k) => store[k] === true, set: (k, v) => void (store[k] = v) } }, make(), {});
    view.setViewMode(true);
    expect(store.view).toBe(true);
    expect(view.isViewMode).toBe(true);
    view.setViewMode(false);
    expect(view.isViewMode).toBe(false);
    view.setReadOnly(true);
    view.setViewMode(false);
    expect(view.isViewMode).toBe(true);
  });

  it('the snap button turns grid snapping on and off, and remembers it', () => {
    const store: Record<string, boolean> = {};
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, { ...plainHost((c) => changes.push(c)), pref: { get: () => false, set: (k, v) => void (store[k] = v) } }, make(), {});
    view.setViewport({ x: 0, y: 0, zoom: 1 });
    changes = [];
    const btn = [...parent.querySelectorAll<HTMLElement>('.cv-palette .cv-btn')].find((b) => b.title.startsWith('Snapping'))!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    expect(store.snap).toBe(true);
    expect(view.snapping).toBe(true);
    drag(nodeEl('a'), [50, 50], [69, 63]);
    expect(changes[0]!.nodes[0]).toMatchObject({ x: 24, y: 24 });
  });

  it('right-click on several selected cards offers to align them', () => {
    view.select(['a', 'b']);
    nodeEl('a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    const items = [...parent.querySelectorAll<HTMLElement>('.cv-menu-item')].map((i) => i.textContent);
    expect(items).toEqual(expect.arrayContaining(['Align Left', 'Align Horizontal Center', 'Align Right', 'Align Top', 'Align Vertical Center', 'Align Bottom']));
    const right = [...parent.querySelectorAll<HTMLElement>('.cv-menu-item')].find((i) => i.textContent === 'Align Right')!;
    right.click();
    expect(changes.at(-1)!.nodes.map((n) => n.x)).toEqual([400, 400]);
    expect(parent.querySelector('.cv-menu')).toBeNull();
  });

  it('tells a pane beside it when the selection changes, and can change what is selected', () => {
    let calls = 0;
    view.subscribe(() => void calls++);
    view.select(['a']);
    return Promise.resolve().then(() => {
      expect(calls).toBe(1);
      view.setBox('a', { x: 50, width: 300 });
      expect(changes.at(-1)!.nodes[0]).toMatchObject({ x: 50, width: 300 });
      view.patchSelectedNodes({ shape: 'diamond', borderStyle: 'dashed' });
      expect(changes.at(-1)!.nodes[0]).toMatchObject({ shape: 'diamond', borderStyle: 'dashed' });
      expect(nodeEl('a').dataset.shape).toBe('diamond');
    });
  });

  it('an embedded canvas lets the wheel scroll the page', () => {
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, plainHost(), make(), { readOnly: true, embedded: true });
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    view.root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    const z = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    view.root.dispatchEvent(z);
    expect(z.defaultPrevented).toBe(true);
  });
});

describe('fill colour', () => {
  it('a preset tints the card, another colour fills it with readable text, none puts it back', () => {
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, plainHost((c) => changes.push(c)), make(), {});
    view.select(['a']);
    view.patchSelectedNodes({ fill: '4' });
    expect(nodeEl('a').style.getPropertyValue('--cv-bg')).toContain('color-mix');
    expect(nodeEl('a').style.getPropertyValue('--cv-ink')).toBe('');
    view.patchSelectedNodes({ fill: '#102030' });
    expect(nodeEl('a').style.getPropertyValue('--cv-bg')).toBe('#102030');
    expect(nodeEl('a').style.getPropertyValue('--cv-ink')).toBe('#ffffff');
    view.patchSelectedNodes({ fill: '#f0f0a0' });
    expect(nodeEl('a').style.getPropertyValue('--cv-ink')).toBe('#1e1e1e');
    view.patchSelectedNodes({ fill: undefined });
    expect(nodeEl('a').style.getPropertyValue('--cv-bg')).toBe('');
    expect('fill' in changes.at(-1)!.nodes[0]!).toBe(false);
  });
});

describe('pictures in cards', () => {
  const picHost = (insert: { path: string | null }) => ({ ...plainHost((c) => changes.push(c)), imageUrl: (p: string) => `asset://ws/${p}`, chooseImage: async () => insert.path });
  const open2 = (h: ReturnType<typeof picHost>): void => {
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, h, make(), {});
  };

  it('a background picture is drawn behind the card, in the way chosen', () => {
    open2(picHost({ path: null }));
    view.select(['a']);
    view.setBackgroundImage('Pics/map one.png', 'ratio');
    const el = nodeEl('a');
    expect(el.style.getPropertyValue('--cv-img')).toContain('asset://ws/Pics/map one.png');
    expect(el.style.getPropertyValue('--cv-img-size')).toBe('contain');
    expect(changes.at(-1)!.nodes[0]).toMatchObject({ background: 'Pics/map one.png', backgroundStyle: 'ratio' });
    view.setBackgroundImage('Pics/map one.png', 'repeat');
    expect(nodeEl('a').style.getPropertyValue('--cv-img-repeat')).toBe('repeat');
    view.setBackgroundImage(null);
    expect(nodeEl('a').style.getPropertyValue('--cv-img')).toBe('');
    expect('background' in changes.at(-1)!.nodes[0]!).toBe(false);
    expect('backgroundStyle' in changes.at(-1)!.nodes[0]!).toBe(false);
  });

  it('a group can have one too, and keeps it', () => {
    open2(picHost({ path: null }));
    view.destroy();
    parent = document.createElement('div');
    document.body.append(parent);
    view = new CanvasView(parent, picHost({ path: null }), { nodes: [{ id: 'g', type: 'group', x: 0, y: 0, width: 300, height: 200, background: 'a.png', backgroundStyle: 'cover' }], edges: [] }, {});
    expect(nodeEl('g').style.getPropertyValue('--cv-img')).toContain('a.png');
  });

  it('Insert Image writes a picture at the end of a note, and only a picture will do', async () => {
    const pick = { path: 'Pictures/My Map.png' };
    open2(picHost(pick));
    changes = [];
    await view.insertImage('a');
    const text = (changes.at(-1)!.nodes[0] as { text: string }).text;
    expect(text.endsWith('![My Map](</Pictures/My Map.png>)')).toBe(true);
    pick.path = 'notes.txt';
    const before = changes.length;
    await view.insertImage('a');
    expect(changes).toHaveLength(before);
  });
});
