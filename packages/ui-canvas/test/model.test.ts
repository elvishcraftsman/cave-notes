import { describe, expect, it } from 'vitest';
import { emptyCanvas, newId, parseCanvas, serializeCanvas, type Canvas } from '../src';

const OBSIDIAN = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"Hello","x":0,"y":0,"width":250,"height":60,"color":"4"},
\t\t{"id":"b2","type":"file","file":"Notes/Idea.md","subpath":"#Top","x":300,"y":0,"width":400,"height":400},
\t\t{"id":"c3","type":"link","url":"https://example.com","x":0,"y":200,"width":250,"height":100},
\t\t{"id":"d4","type":"group","label":"Box","x":-50,"y":-50,"width":900,"height":600,"background":"bg.png","backgroundStyle":"cover"}
\t],
\t"edges":[
\t\t{"id":"e5","fromNode":"a1","fromSide":"right","toNode":"b2","toSide":"left","toEnd":"arrow","label":"leads to"}
\t]
}`;

describe('parseCanvas', () => {
  it('reads what Obsidian writes', () => {
    const r = parseCanvas(OBSIDIAN);
    expect(r.ok && r.canvas.nodes.map((n) => n.type)).toEqual(['text', 'file', 'link', 'group']);
    expect(r.ok && r.problems).toEqual([]);
  });

  it('an empty file is an empty canvas', () => {
    expect(parseCanvas('')).toEqual({ ok: true, canvas: emptyCanvas(), problems: [] });
    expect(parseCanvas('  \n')).toMatchObject({ ok: true });
  });

  it('refuses text that is not a canvas, so it can be shown as text and never overwritten', () => {
    expect(parseCanvas('# not json').ok).toBe(false);
    expect(parseCanvas('[1,2]').ok).toBe(false);
    expect(parseCanvas('{"nodes": [').ok).toBe(false);
  });

  it('keeps and reports what it cannot draw', () => {
    const r = parseCanvas('{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":10,"height":10},{"id":"a","type":"text","x":1,"y":1,"width":5,"height":5},{"id":"b","type":"text"},{"type":"text"},{"id":"c","type":"weird"}],"edges":[{"id":"e","fromNode":"a","toNode":"zzz"},{"id":"f"}]}');
    if (!r.ok) throw new Error(r.error);
    expect(r.canvas.nodes.map((n) => n.id)).toEqual(['a', 'a']);
    expect(r.problems.join('\n')).toMatch(/Two nodes have the id a/);
    expect(r.problems.join('\n')).toMatch(/Node b has no usable position/);
    expect(r.problems.join('\n')).toMatch(/Edge e joins a node that is not there/);
    expect(r.canvas.edges.map((e) => e.id)).toEqual(['e']);
  });
});

describe('serializeCanvas', () => {
  it('writes the way Obsidian does: tabs, one node and one edge per line', () => {
    const r = parseCanvas(OBSIDIAN);
    if (!r.ok) throw new Error(r.error);
    expect(serializeCanvas(r.canvas)).toBe(OBSIDIAN);
  });

  it('an empty canvas is two empty lists', () => {
    expect(serializeCanvas(emptyCanvas())).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    expect(JSON.parse(serializeCanvas(emptyCanvas()))).toEqual({ nodes: [], edges: [] });
  });

  it('carries through what it does not know, in nodes, edges and at the top', () => {
    const text = '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":9,"height":9,"customField":{"k":[1,2]}}],"edges":[],"metadata":{"version":"1.0"}}';
    const r = parseCanvas(text);
    if (!r.ok) throw new Error(r.error);
    const back = JSON.parse(serializeCanvas(r.canvas));
    expect(back.nodes[0].customField).toEqual({ k: [1, 2] });
    expect(back.metadata).toEqual({ version: '1.0' });
  });

  it('is stable: writing what was read changes nothing, and a second round trip is identical', () => {
    const r = parseCanvas(OBSIDIAN);
    if (!r.ok) throw new Error(r.error);
    const once = serializeCanvas(r.canvas);
    const again = parseCanvas(once);
    if (!again.ok) throw new Error(again.error);
    expect(serializeCanvas(again.canvas)).toBe(once);
  });
});

describe('newId', () => {
  it('makes 16 hex digits no node or edge has', () => {
    const c: Canvas = { nodes: [{ id: '0000000000000000', type: 'text', text: '', x: 0, y: 0, width: 1, height: 1 }], edges: [] };
    let calls = 0;
    const id = newId(c, () => (calls++ < 16 ? 0 : 0.99));
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toBe('0000000000000000');
  });
});
