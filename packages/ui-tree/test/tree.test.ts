import { describe, expect, it } from 'vitest';
import { TreeModel, parentOf, type TreeNodeData } from '../src/index';

/** An in-memory workspace: children keyed by parent page path ('' = root). */
function fake(structure: Record<string, string[]>): { load: (p: string | null) => Promise<TreeNodeData[]>; calls: Array<string | null>; set: (k: string, v: string[]) => void } {
  const calls: Array<string | null> = [];
  const data = { ...structure };
  const load = async (parent: string | null): Promise<TreeNodeData[]> => {
    calls.push(parent);
    const names = data[parent ?? ''] ?? [];
    return names.map((name) => {
      const path = parent === null ? `${name}.md` : `${parent.slice(0, -3)}/${name}.md`;
      return { path, name, exists: true, hasChildren: (data[path] ?? []).length > 0 };
    });
  };
  return { load, calls, set: (k, v) => void (data[k] = v) };
}

const SAMPLE = {
  '': ['Notes', 'Theology'],
  'Theology.md': ['Grace', 'Soteriology'],
  'Theology/Soteriology.md': ['Imputation'],
};

const paths = (m: TreeModel): string[] => m.rows.map((r) => r.path);

describe('parentOf', () => {
  it('derives the parent page path', () => {
    expect(parentOf('A.md')).toBeNull();
    expect(parentOf('A/B.md')).toBe('A.md');
    expect(parentOf('A/B/C.md')).toBe('A/B.md');
  });
});

describe('TreeModel', () => {
  it('shows only the root until nodes are expanded, and loads lazily', async () => {
    const f = fake(SAMPLE);
    const m = new TreeModel({ load: f.load });
    await m.init();
    expect(paths(m)).toEqual(['Notes.md', 'Theology.md']);
    expect(m.rows[1]).toMatchObject({ hasChildren: true, expanded: false, depth: 0 });
    expect(f.calls).toEqual([null]);
    await m.expand('Theology.md');
    expect(paths(m)).toEqual(['Notes.md', 'Theology.md', 'Theology/Grace.md', 'Theology/Soteriology.md']);
    expect(m.rows[2]?.depth).toBe(1);
    expect(f.calls).toEqual([null, 'Theology.md']);
    m.collapse('Theology.md');
    await m.expand('Theology.md'); // cached: no second load
    expect(f.calls).toEqual([null, 'Theology.md']);
  });

  it('Down/Up move the selection and ask to open the page; they stop at the ends', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init();
    expect(await m.handleKey('ArrowDown')).toEqual({ type: 'open', path: 'Notes.md' }); // nothing selected: first row
    expect(await m.handleKey('ArrowDown')).toEqual({ type: 'open', path: 'Theology.md' });
    expect(await m.handleKey('ArrowDown')).toBeNull(); // already last
    expect(m.selected).toBe('Theology.md');
    expect(await m.handleKey('ArrowUp')).toEqual({ type: 'open', path: 'Notes.md' });
    expect(await m.handleKey('ArrowUp')).toBeNull();
    expect(await m.handleKey('End')).toEqual({ type: 'open', path: 'Theology.md' });
    expect(await m.handleKey('Home')).toEqual({ type: 'open', path: 'Notes.md' });
  });

  it('Right expands, then enters the first child; Left collapses, then goes to the parent', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init();
    m.select('Theology.md');
    expect(await m.handleKey('ArrowRight')).toBeNull(); // expands
    expect(m.rows.find((r) => r.path === 'Theology.md')?.expanded).toBe(true);
    expect(await m.handleKey('ArrowRight')).toEqual({ type: 'open', path: 'Theology/Grace.md' });
    expect(await m.handleKey('ArrowRight')).toBeNull(); // a leaf: nothing to do
    expect(await m.handleKey('ArrowLeft')).toEqual({ type: 'open', path: 'Theology.md' }); // leaf -> parent
    expect(await m.handleKey('ArrowLeft')).toBeNull(); // collapses
    expect(m.rows.find((r) => r.path === 'Theology.md')?.expanded).toBe(false);
    expect(await m.handleKey('ArrowLeft')).toBeNull(); // top level and collapsed: nowhere to go
    expect(m.selected).toBe('Theology.md');
  });

  it('walks a deep hierarchy with left/right alone', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init();
    m.select('Theology.md');
    await m.handleKey('ArrowRight'); // expand
    await m.handleKey('ArrowRight'); // -> Grace
    await m.handleKey('ArrowDown'); // -> Soteriology
    await m.handleKey('ArrowRight'); // expand
    expect(await m.handleKey('ArrowRight')).toEqual({ type: 'open', path: 'Theology/Soteriology/Imputation.md' });
    expect(await m.handleKey('ArrowLeft')).toEqual({ type: 'open', path: 'Theology/Soteriology.md' });
    expect(await m.handleKey('ArrowLeft')).toBeNull(); // collapse Soteriology
    expect(await m.handleKey('ArrowLeft')).toEqual({ type: 'open', path: 'Theology.md' });
  });

  it('maps editing keys to actions', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init();
    m.select('Notes.md');
    expect(await m.handleKey('Enter')).toEqual({ type: 'focus-editor', path: 'Notes.md' });
    expect(await m.handleKey('F2')).toEqual({ type: 'rename', path: 'Notes.md' });
    expect(await m.handleKey('Delete')).toEqual({ type: 'delete', path: 'Notes.md' });
    expect(await m.handleKey('n', { ctrl: true })).toEqual({ type: 'new-child', path: 'Notes.md' });
    expect(await m.handleKey('n', { ctrl: true, shift: true })).toEqual({ type: 'new-child', path: null });
    expect(await m.handleKey('n')).toBeNull();
    expect(await m.handleKey('x')).toBeNull();
  });

  it('keys do nothing sensible on an empty tree', async () => {
    const m = new TreeModel({ load: fake({}).load });
    await m.init();
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']) expect(await m.handleKey(k)).toBeNull();
  });

  it('reveal expands every ancestor and selects the page', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init();
    await m.reveal('Theology/Soteriology/Imputation.md');
    expect(m.selected).toBe('Theology/Soteriology/Imputation.md');
    expect(paths(m)).toEqual([
      'Notes.md', 'Theology.md', 'Theology/Grace.md', 'Theology/Soteriology.md', 'Theology/Soteriology/Imputation.md',
    ]);
  });

  it('init restores expansion, ignoring paths that no longer exist', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    await m.init(['Theology/Soteriology.md', 'Theology.md', 'Gone.md', 'Gone/Deep.md']);
    expect(paths(m)).toEqual(['Notes.md', 'Theology.md', 'Theology/Grace.md', 'Theology/Soteriology.md', 'Theology/Soteriology/Imputation.md']);
    expect([...m.expanded].sort()).toEqual(['Theology.md', 'Theology/Soteriology.md']);
  });

  it('refresh reloads loaded parents, drops vanished nodes and keeps unrelated state', async () => {
    const f = fake(SAMPLE);
    const m = new TreeModel({ load: f.load });
    await m.init(['Theology.md']);
    m.select('Theology/Grace.md');
    f.set('Theology.md', ['Mercy', 'Soteriology']); // Grace is gone, Mercy is new
    await m.refresh(['Theology.md']);
    expect(paths(m)).toEqual(['Notes.md', 'Theology.md', 'Theology/Mercy.md', 'Theology/Soteriology.md']);
    expect(m.selected).toBeNull(); // the selected page vanished
    f.set('', ['Notes', 'Theology', 'Fresh']);
    await m.refresh([null]);
    expect(paths(m)).toContain('Fresh.md');
    expect(m.expanded.has('Theology.md')).toBe(true);
  });

  it('refresh forgets the expansion of a node that lost its children, and of vanished subtrees', async () => {
    const f = fake(SAMPLE);
    const m = new TreeModel({ load: f.load });
    await m.init(['Theology.md', 'Theology/Soteriology.md']);
    f.set('Theology.md', ['Grace']);
    f.set('Theology/Soteriology.md', []);
    await m.refresh(['Theology.md']);
    expect(paths(m)).toEqual(['Notes.md', 'Theology.md', 'Theology/Grace.md']);
    expect(m.expanded.has('Theology/Soteriology.md')).toBe(false);
  });

  it('refresh ignores parents that were never loaded', async () => {
    const f = fake(SAMPLE);
    const m = new TreeModel({ load: f.load });
    await m.init();
    await m.refresh(['Theology.md']);
    expect(f.calls).toEqual([null]);
  });

  it('notifies subscribers, and unsubscribes', async () => {
    const m = new TreeModel({ load: fake(SAMPLE).load });
    let n = 0;
    const off = m.subscribe(() => n++);
    await m.init();
    const afterInit = n;
    expect(afterInit).toBeGreaterThan(0);
    m.select('Notes.md');
    expect(n).toBe(afterInit + 1);
    m.select('Notes.md'); // no change, no notification
    expect(n).toBe(afterInit + 1);
    off();
    m.select('Theology.md');
    expect(n).toBe(afterInit + 1);
  });

  it('marks a node as loading while its children arrive', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = fake(SAMPLE);
    const m = new TreeModel({
      load: async (p) => {
        if (p === 'Theology.md') await gate;
        return base.load(p);
      },
    });
    await m.init();
    const pending = m.expand('Theology.md');
    await Promise.resolve();
    expect(m.rows.find((r) => r.path === 'Theology.md')?.loading).toBe(true);
    release();
    await pending;
    expect(m.rows.find((r) => r.path === 'Theology.md')?.loading).toBe(false);
  });
});

describe('drop planning', () => {
  async function build() {
    const data: Record<string, Array<[string, boolean]>> = {
      '': [['A', true], ['B', false], ['C', true]],
      'A.md': [['A1', false], ['A2', false]],
      'C.md': [['C1', false]],
    };
    const t = new TreeModel({
      load: async (p) => (data[p ?? ''] ?? []).map(([name, hasChildren]) => ({ path: `${p ? p.slice(0, -3) + '/' : ''}${name}.md`, name, exists: true, hasChildren })),
    });
    await t.init(['A.md']);
    return t;
  }

  it('before / after / into', async () => {
    const t = await build();
    expect(t.resolveDrop('B.md', 'A.md', 'before')).toEqual({ parent: null, before: 'A.md' });
    expect(t.resolveDrop('C.md', 'B.md', 'before')).toEqual({ parent: null, before: 'B.md' });
    expect(t.resolveDrop('B.md', 'A.md', 'into')).toEqual({ parent: 'A.md', before: null });
    // after an expanded branch = first child; after a leaf = before its next sibling
    expect(t.resolveDrop('B.md', 'A.md', 'after')).toEqual({ parent: 'A.md', before: 'A/A1.md' });
    expect(t.resolveDrop('A.md', 'C.md', 'after')).toEqual({ parent: null, before: null });
    expect(t.resolveDrop('A/A2.md', 'A/A1.md', 'before')).toEqual({ parent: 'A.md', before: 'A/A1.md' });
  });

  it('refuses nonsense and no-ops', async () => {
    const t = await build();
    expect(t.resolveDrop('A.md', 'A/A1.md', 'into')).toBeNull();
    expect(t.resolveDrop('A.md', 'A/A1.md', 'before')).toBeNull();
    expect(t.resolveDrop('B.md', 'B.md', 'before')).toBeNull();
    expect(t.resolveDrop('B.md', 'C.md', 'before')).toBeNull(); // already right in front of C
    expect(t.resolveDrop('A/A1.md', 'A.md', 'into')).toBeNull(); // already its child
    expect(t.resolveDrop('A/A1.md', 'A/A1.md', 'after')).toBeNull();
  });
});

describe('auto-collapse of idle branches', () => {
  async function build() {
    const data: Record<string, Array<[string, boolean]>> = {
      '': [['A', true], ['B', true]],
      'A.md': [['A1', true]],
      'A/A1.md': [['A1x', false]],
      'B.md': [['B1', false]],
    };
    const t = new TreeModel({
      load: async (p) => (data[p ?? ''] ?? []).map(([name, hasChildren]) => ({ path: `${p ? p.slice(0, -3) + '/' : ''}${name}.md`, name, exists: true, hasChildren })),
    });
    await t.init(['A.md', 'A/A1.md', 'B.md']);
    return t;
  }

  it('collapses only the outermost idle branch, after the delay', async () => {
    const t = await build();
    const keep = ['B/B1.md'];
    expect(t.sweepIdle(keep, 1000, 10_000)).toEqual([]); // first seen idle
    expect(t.sweepIdle(keep, 9000, 10_000)).toEqual([]);
    expect(t.sweepIdle(keep, 11_000, 10_000)).toEqual(['A.md']);
    expect(t.expanded.has('A.md')).toBe(false);
    expect(t.expanded.has('A/A1.md')).toBe(true); // remembered, so re-opening A shows the way back
    expect(t.expanded.has('B.md')).toBe(true);
    expect(t.sweepIdle(keep, 30_000, 10_000)).toEqual([]);
  });

  it('opening something in the branch resets the clock', async () => {
    const t = await build();
    t.sweepIdle(['B/B1.md'], 0, 10_000);
    t.sweepIdle(['A/A1/A1x.md'], 5000, 10_000); // went back into A
    expect(t.sweepIdle(['B/B1.md'], 12_000, 10_000)).toEqual([]); // clock restarted at 12 s
    expect(t.sweepIdle(['B/B1.md'], 22_001, 10_000)).toEqual(['A.md']);
  });

  it('a branch holding the open page is kept, an idle inner branch beside it is collapsed', async () => {
    const t = await build();
    const keep = ['A/A1/A1x.md'];
    t.sweepIdle(keep, 0, 1000);
    expect(t.sweepIdle(keep, 2000, 1000)).toEqual(['B.md']);
    expect(t.expanded.has('A.md')).toBe(true);
  });
  it('the open page keeps its own branch open, while its idle sub-branches collapse', async () => {
    const t = await build();
    const keep = ['A.md']; // A is open: A stays expanded, but A/A1 (expanded, nothing open in it) is idle
    t.sweepIdle(keep, 0, 1000);
    expect(t.sweepIdle(keep, 2000, 1000)).toEqual(expect.arrayContaining(['A/A1.md']));
    expect(t.expanded.has('A.md')).toBe(true);
    expect(t.expanded.has('A/A1.md')).toBe(false);
  });
});
