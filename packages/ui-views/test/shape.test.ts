
import { clipTitle, groupRows, pickColumns, relationAliases, valuesOf, newPageContent, newPageDefaults, parseViewConfig, sortRowsBy, toCsv, type Row } from '../src/index';
import { describe as suiteX, expect as expectX, it as itX } from 'vitest';

const mk = (path: string, title: string, attrs: Record<string, string> = {}): Row => ({ path, title, isVirtual: false, mtimeMs: 0, attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, [{ type: 'string', text: v, num: null }]])) });

suiteX('csv, multi sort, new page defaults, colour rules', () => {
  itX('writes CSV with quoting', () => {
    const out = toCsv([mk('A.md', 'He said "hi", ok', { status: 'todo' })], ['title', 'status', 'path']);
    expectX(out).toBe('title,status,path\r\n"He said ""hi"", ok",todo,A\r\n');
  });
  itX('sorts by several criteria', () => {
    const rows = [mk('a.md', 'b', { s: '1' }), mk('b.md', 'a', { s: '2' }), mk('c.md', 'c', { s: '1' })];
    expectX(sortRowsBy(rows, 's,title').map((r) => r.title)).toEqual(['b', 'c', 'a']);
    expectX(sortRowsBy(rows, 's,-title').map((r) => r.title)).toEqual(['c', 'b', 'a']);
  });
  itX('takes starting values from the plain filters', () => {
    expectX(newPageDefaults('under:Projects status:todo,doing due:<$now.day (a OR b) -tags:x owner:ann sort:due')).toEqual({ attrs: { status: 'todo', owner: 'ann' }, under: 'Projects' });
    expectX(newPageDefaults('status:todo OR status:done')).toEqual({ attrs: {}, under: null });
    expectX(newPageDefaults('children:Projects').under).toBe('Projects');
    expectX(newPageContent('T', {}, {}, { owner: ['People/Ann'] })).toBe('---\nowner: "[[People/Ann]]"\n---\n# T\n\n');
    expectX(newPageContent('T', {}, {}, { owner: ['A', 'B'] })).toBe('---\nowner: ["[[A]]", "[[B]]"]\n---\n# T\n\n');
    expectX(newPageDefaults('under:Projects children:Projects/Active').under).toBe('Projects/Active');
    expectX(newPageDefaults('under:Projects/Active children:Projects').under).toBe('Projects/Active');
    expectX(newPageDefaults('under:Projects children:Projects').under).toBe('Projects');
    expectX(newPageDefaults('tags:a status:todo')).toEqual({ attrs: { tags: 'a', status: 'todo' }, under: null });
  });
  itX('reads colour rules', () => {
    const r = parseViewConfig('type: table\nquery: x\ncolors:\n  - when: "due:<$now.day"\n    color: red\n  - when: "status:done"\n    color: "#888888"\npageSize: 25\nsort: [due, -title]');
    expectX(r.ok && r.config.colors).toEqual([{ when: 'due:<$now.day', color: 'red' }, { when: 'status:done', color: '#888888' }]);
    expectX(r.ok && r.config.pageSize).toBe(25);
    expectX(r.ok && r.config.sort).toBe('due,-title');
    expectX(parseViewConfig('colors:\n  - when: x\n    color: nope').ok).toBe(false);
  });
});

suiteX('new page text', () => {
  itX('writes frontmatter by type, then the heading', () => {
    expectX(newPageContent('Fix it', { status: 'todo', due: '2026-11-01', weight: '5', done: 'true', tags: 'a, b c', note: 'x: y', empty: '' }, { due: { type: 'date' }, weight: { type: 'number' }, done: { type: 'bool' }, tags: { type: 'string', list: true } }))
      .toBe('---\nstatus: todo\ndue: 2026-11-01\nweight: 5\ndone: true\ntags: [a, b c]\nnote: "x: y"\n---\n# Fix it\n\n');
    expectX(newPageContent('Plain', {})).toBe('# Plain\n\n');
  });
});

suiteX('groups, empty values and default columns', () => {
  itX('orders groups either way and treats an empty value as no value', () => {
    const rows = [mk('a.md', 'A', { s: 'b' }), mk('b.md', 'B', { s: 'a' }), mk('c.md', 'C', { s: '' })];
    expectX(groupRows(rows, 's').map((g) => g.value)).toEqual(['a', 'b', null]);
    expectX(groupRows(rows, 's', [], 'desc').map((g) => g.value)).toEqual(['b', 'a', null]);
    expectX(valuesOf(rows[2]!, 's')).toEqual([]);
  });
  itX('can group by title, file name and file type', () => {
    const rows = [mk('A/x.md', 'x', { filename: 'x.md', filetype: 'md' }), mk('B/x.md', 'x', { filename: 'x.md', filetype: 'md' })];
    expectX(groupRows(rows, 'filename').map((g) => [g.value, g.rows.length])).toEqual([['x.md', 2]]);
    expectX(groupRows(rows, 'title')[0]!.rows.length).toBe(2);
  });
  itX('does not pick file name and file type as default columns', () => {
    const rows = [mk('a.md', 'A', { filename: 'a.md', filetype: 'md', status: 'x' })];
    expectX(pickColumns(undefined, rows)).toEqual(['title', 'status']);
    expectX(pickColumns(['title', 'filename'], rows)).toEqual(['title', 'filename']);
  });
});

suiteX('relation columns', () => {
  const relations = [{ name: 'Writing', attribute: 'writing', backattribute: 'doctrine', backname: 'Doctrine' }];
  const rows = [{ path: 'a.md', title: 'A', isVirtual: false, mtimeMs: 0, attrs: { writing: [{ type: 'string', text: '[[B]]', num: null }] } }] as Row[];
  itX('turns the attribute of a relation into its column, however the column is asked for', () => {
    const al = relationAliases(relations);
    expectX(pickColumns(['title', 'writing'], rows, 4, al)).toEqual(['title', 'Writing']);
    expectX(pickColumns(['title', 'Writing'], rows, 4, al)).toEqual(['title', 'Writing']);
    expectX(pickColumns(['title', 'doctrine'], rows, 4, al)).toEqual(['title', 'Doctrine']);
    expectX(pickColumns(['title', 'writing', 'Writing'], rows, 4, al)).toEqual(['title', 'Writing']);
  });
  itX('does the same for the columns picked when none are set', () => {
    expectX(pickColumns(undefined, rows, 4, relationAliases(relations))).toEqual(['title', 'Writing']);
  });
  itX('clips long titles', () => {
    expectX(clipTitle('short')).toBe('short');
    expectX([...clipTitle('x'.repeat(40))].length).toBe(32);
  });
});
