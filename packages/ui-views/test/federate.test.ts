import { describe, expect, it } from 'vitest';
import { expandSaved, parseForeign, resolveQuery, sortRowsBy, splitForeign, withoutSort, type Row } from '../src/index';

describe('parseForeign', () => {
  it('splits workspace and name at the first ::', () => {
    expect(parseForeign('Theology::open-tasks')).toEqual({ workspace: 'Theology', name: 'open-tasks' });
    expect(parseForeign('My Notes :: the tasks')).toEqual({ workspace: 'My Notes', name: 'the tasks' });
    expect(parseForeign('open-tasks')).toBeNull();
    expect(parseForeign('Theology::')).toBeNull();
  });
});

describe('splitForeign', () => {
  it('leaves a query without such a term alone', () => {
    expect(splitForeign('status:todo OR status:doing sort:due')).toEqual({ local: 'status:todo OR status:doing sort:due', foreign: [], sort: [], sortSpec: '', errors: [] });
  });
  it('takes a query that is only the saved query of another workspace', () => {
    const s = splitForeign('saved:Theology::open-tasks');
    expect(s.local).toBe('');
    expect(s.foreign.map((f) => [f.workspace, f.name])).toEqual([['Theology', 'open-tasks']]);
    expect(s.errors).toEqual([]);
  });
  it('joins a local query and another workspace by OR', () => {
    const s = splitForeign('status:todo under:Projects OR saved:Theology::open-tasks');
    expect(s.local).toBe('status:todo under:Projects');
    expect(s.foreign.map((f) => `${f.workspace}/${f.name}`)).toEqual(['Theology/open-tasks']);
    expect(s.errors).toEqual([]);
  });
  it('reads quoted names with spaces and several workspaces', () => {
    const s = splitForeign('saved:"My Notes::open tasks" OR tag:x OR saved:Work::due');
    expect(s.local).toBe('tag:x');
    expect(s.foreign.map((f) => `${f.workspace}/${f.name}`)).toEqual(['My Notes/open tasks', 'Work/due']);
  });
  it('finds the term inside a group that is one alternative', () => {
    const s = splitForeign('a:1 OR (b:2 OR saved:W::q)');
    expect(s.local).toBe('a:1 OR b:2');
    expect(s.foreign.map((f) => f.name)).toEqual(['q']);
    expect(s.errors).toEqual([]);
  });
  it('gives the sort to the parts and keeps the order for the merge', () => {
    const s = splitForeign('a:1 OR saved:W::q sort:-due,title');
    expect(s.local).toBe('a:1');
    expect(s.sort).toEqual(['sort:-due,title']);
    expect(s.sortSpec).toBe('-due,title');
  });
  it('reports a term that is ANDed with others, and runs the rest', () => {
    const s = splitForeign('a:1 saved:W::q');
    expect(s.foreign).toEqual([]);
    expect(s.local).toBe('a:1');
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatch(/only be joined .* with OR/);
  });
  it('reports a negated term and a term inside a group joined by AND', () => {
    expect(splitForeign('a:1 OR -saved:W::q').errors[0]).toMatch(/cannot be negated/);
    const g = splitForeign('a:1 (b:2 OR saved:W::q)');
    expect(g.foreign).toEqual([]);
    expect(g.local).toBe('a:1 (b:2)');
    expect(g.errors).toHaveLength(1);
  });
  it('reports a term without a workspace or name', () => {
    expect(splitForeign('saved:W:: OR a:1').errors[0]).toMatch(/needs a workspace and a name/);
  });
});

describe('saved queries and other workspaces', () => {
  const saved = new Map([['mine', 'status:todo OR saved:Theology::open-tasks']]);
  it('expandSaved keeps a term for another workspace as it is', () => {
    const errors: string[] = [];
    expect(expandSaved('saved:mine OR tag:x', saved, errors)).toBe('( status:todo OR saved:Theology::open-tasks ) OR tag:x');
    expect(errors).toEqual([]);
  });
  it('resolveQuery lets such a term through, with the view sort', () => {
    expect(resolveQuery({ query: 'saved:mine', sort: 'due' }, { page: null, saved })).toBe('( status:todo OR saved:Theology::open-tasks ) sort:due');
  });
  it('terms written next to such a saved query narrow all of it, not just its last alternative', () => {
    const q = resolveQuery({ query: 'saved:mine title:foo', sort: '' }, { page: null, saved });
    expect(q).toBe('( status:todo OR saved:Theology::open-tasks ) title:foo');
    // the other workspace's pages cannot be narrowed here, so the window reports that instead of showing them unfiltered
    expect(splitForeign(q).errors).toHaveLength(1);
  });
  it('a local saved query that holds one splits like a written one', () => {
    const s = splitForeign(resolveQuery({ query: 'saved:mine', sort: 'due' }, { page: null, saved }));
    expect(s.local).toBe('status:todo');
    expect(s.foreign.map((f) => f.workspace)).toEqual(['Theology']);
    expect(s.sortSpec).toBe('due');
  });
});

describe('withoutSort', () => {
  it('drops sort terms and keeps the groups', () => {
    expect(withoutSort('a:1 (b:2 OR c:3) sort:-due')).toBe('a:1 ( b:2 OR c:3 )');
  });
});

describe('merging the parts', () => {
  const row = (path: string, title: string, due: string | null, workspace?: string): Row => ({
    path, title, isVirtual: false, mtimeMs: 0, attrs: due ? { due: [{ type: 'string', text: due, num: null }] } : {}, ...(workspace ? { workspace } : {}),
  });
  it('orders pages of both workspaces by the sort of the query', () => {
    const rows = [row('b.md', 'Bee', '2026-03-01'), row('x.md', 'Ex', '2026-01-01', 'Theology'), row('a.md', 'Ay', null), row('y.md', 'Why', '2026-02-01', 'Theology')];
    expect(sortRowsBy(rows, 'due').map((r) => r.title)).toEqual(['Ex', 'Why', 'Bee', 'Ay']);
    expect(sortRowsBy(rows, '-due').map((r) => r.title)).toEqual(['Bee', 'Why', 'Ex', 'Ay']);
  });
});
