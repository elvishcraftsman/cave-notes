import { describe, expect, it } from 'vitest';
import {
  appendClause, calendarMonth, clauseToToken, clausesOf, controlFor, fieldsFor, groupRows, initialMonth, opsFor, parseViewConfig, pickColumns,
  expandSaved, replaceClause, resolveQuery, savedViewTemplate, shiftMonth, sortRows, updateConfigSource, valuesOf, type Row,
} from '../src/index';

const row = (path: string, attrs: Row['attrs'] = {}, title = path.replace(/\.md$/, '').split('/').pop()!, mtimeMs = 0): Row => ({ path, title, isVirtual: false, mtimeMs, attrs });
const t = (text: string) => [{ type: 'string', text, num: null }];
const d = (iso: string) => [{ type: 'date', text: iso, num: Date.parse(`${iso}T00:00:00Z`) }];
const n = (v: number) => [{ type: 'number', text: String(v), num: v }];

describe('parseViewConfig', () => {
  it('reads settings and applies defaults', () => {
    expect(parseViewConfig('')).toEqual({ ok: true, config: { type: 'table', query: '' } });
    const r = parseViewConfig('type: Kanban\ntitle: Tasks\nquery: under:$this status:todo,doing\ngroup: status\ncolumns: [title, due]\nlimit: 50');
    expect(r).toEqual({ ok: true, config: { type: 'kanban', title: 'Tasks', query: 'under:$this status:todo,doing', group: 'status', columns: ['title', 'due'], limit: 50 } });
  });
  it('accepts comma separated columns and caps the limit', () => {
    const r = parseViewConfig('columns: title, status\nlimit: 99999');
    expect(r.ok && r.config.columns).toEqual(['title', 'status']);
    expect(r.ok && r.config.limit).toBe(1000);
  });
  it('explains problems in plain words', () => {
    expect(parseViewConfig('type: chart')).toMatchObject({ ok: false, error: expect.stringContaining('Unknown view type "chart"') });
    expect(parseViewConfig('- a\n- b')).toMatchObject({ ok: false });
    expect(parseViewConfig('type: [unclosed')).toMatchObject({ ok: false });
    expect(parseViewConfig('limit: lots')).toMatchObject({ ok: false });
  });
});

describe('updateConfigSource', () => {
  const src = 'type: table # how to show\nquery: under:$this\n';
  it('changes one setting and keeps comments', () => {
    expect(updateConfigSource(src, { type: 'kanban', group: 'status' })).toBe('type: kanban # how to show\nquery: under:$this\ngroup: status');
  });
  it('removes settings with null and writes lists in flow style', () => {
    expect(updateConfigSource('type: table\ngroup: x\n', { group: null, columns: ['title', 'due'] })).toBe('type: table\ncolumns: [title, due]');
  });
  it('leaves text it cannot parse alone', () => {
    expect(updateConfigSource('type: [oops', { type: 'list' })).toBe('type: [oops');
  });
  it('works on an empty block', () => {
    expect(updateConfigSource('', { type: 'list', query: 'status:done' })).toBe('type: list\nquery: status:done');
  });
});

describe('resolveQuery', () => {
  it('turns $this into a link where an attribute is compared, so `doctrine: [[Scripture]]` pages are found', () => {
    expect(resolveQuery({ query: 'doctrine:$this' }, { page: 'Doctrine/Scripture.md' })).toBe('doctrine:[[Doctrine/Scripture]]');
    expect(resolveQuery({ query: '-doctrine:$this' }, { page: 'River Bible.md' })).toBe('-doctrine:"[[River Bible]]"');
    expect(resolveQuery({ query: 'over:$this children:$this parent:$this' }, { page: 'A/B.md' })).toBe('over:A/B children:A/B parent:A/B');
  });

  it('fills in $this and $parent', () => {
    expect(resolveQuery({ query: 'under:$this is:leaf' }, { page: 'Theology/Soteriology.md' })).toBe('under:Theology/Soteriology is:leaf');
    expect(resolveQuery({ query: 'under:$this' }, { page: 'Church History/Nicaea.md' })).toBe('under:"Church History/Nicaea"');
    expect(resolveQuery({ query: 'under:$parent' }, { page: 'Theology/Soteriology.md' })).toBe('under:Theology');
  });
  it('drops filters that cannot be filled in', () => {
    expect(resolveQuery({ query: 'status:todo under:$parent' }, { page: 'Welcome.md' })).toBe('status:todo');
    expect(resolveQuery({ query: 'under:$this x' }, { page: null })).toBe('x');
  });
  it('adds the configured sort unless the query has one', () => {
    expect(resolveQuery({ query: 'status:todo', sort: '-due' }, { page: 'A.md' })).toBe('status:todo sort:-due');
    expect(resolveQuery({ query: 'status:todo sort:title', sort: '-due' }, { page: 'A.md' })).toBe('status:todo sort:title');
    expect(resolveQuery({ query: '', sort: 'title' }, { page: 'A.md' })).toBe('sort:title');
  });
});

describe('sorting, grouping, columns', () => {
  const rows = [row('c.md', { due: d('2026-11-01'), w: n(10) }), row('a.md', { due: d('2026-10-01'), w: n(9) }), row('b.md'), row('d.md', { due: d('2026-12-01'), w: n(100) })];
  it('sorts by title, dates and numbers, with missing values last in both directions', () => {
    expect(sortRows(rows, 'title').map((r) => r.title)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortRows(rows, 'due').map((r) => r.title)).toEqual(['a', 'c', 'd', 'b']);
    expect(sortRows(rows, 'due', 'desc').map((r) => r.title)).toEqual(['d', 'c', 'a', 'b']);
    expect(sortRows(rows, 'w').map((r) => r.title)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('groups by value, honouring declared order, empty columns and a no-value group', () => {
    const items = [row('1.md', { s: t('doing') }), row('2.md', { s: t('todo') }), row('3.md'), row('4.md', { s: t('extra') }), row('5.md', { s: t('todo') })];
    const g = groupRows(items, 's', ['todo', 'doing', 'done']);
    expect(g.map((x) => [x.value, x.rows.length])).toEqual([['todo', 2], ['doing', 1], ['done', 0], ['extra', 1], [null, 1]]);
  });
  it('puts a page with several values in each group', () => {
    const items = [row('1.md', { tags: [...t('a'), ...t('b')] })];
    expect(groupRows(items, 'tags').map((x) => x.value)).toEqual(['a', 'b']);
  });
  it('reads built-in columns', () => {
    const r = row('Theology/Grace.md', {}, 'Grace', Date.parse('2026-10-05T12:00:00Z'));
    expect(valuesOf(r, 'title')).toEqual(['Grace']);
    expect(valuesOf(r, 'path')).toEqual(['Theology/Grace']);
    expect(valuesOf(r, 'modified')).toEqual(['2026-10-05']);
  });
  it('defaults to the title and the most common attributes', () => {
    const items = [row('a.md', { status: t('x'), due: d('2026-01-01') }), row('b.md', { status: t('y') }), row('c.md', { odd: t('z') })];
    expect(pickColumns(undefined, items, 2)).toEqual(['title', 'status', 'due']);
    expect(pickColumns(['title', 'odd'], items)).toEqual(['title', 'odd']);
  });
});

describe('calendar', () => {
  const rows = [row('a.md', { due: d('2026-10-20') }), row('b.md', { due: d('2026-10-20') }), row('c.md', { due: d('2026-11-02') }), row('x.md')];
  it('lays out whole weeks and places pages on their day', () => {
    const m = calendarMonth(2026, 9, rows, 'due', '2026-10-09');
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
    expect(m.weeks[0]![0]!.date <= '2026-10-01').toBe(true);
    const all = m.weeks.flat();
    expect(all.find((x) => x.date === '2026-10-20')!.rows.map((r) => r.title)).toEqual(['a', 'b']);
    expect(all.find((x) => x.date === '2026-10-09')!.isToday).toBe(true);
    expect(all.filter((x) => x.inMonth)).toHaveLength(31);
    expect(m.unscheduled.map((r) => r.title)).toEqual(['x']);
  });
  it('shows the next month\'s first days with their pages (outside the month)', () => {
    const m = calendarMonth(2026, 9, rows, 'due', '2026-10-09');
    const day = m.weeks.flat().find((x) => x.date === '2026-11-02');
    expect(day === undefined || !day.inMonth).toBe(true);
  });
  it('honours the week start', () => {
    expect(new Date(`${calendarMonth(2026, 9, [], 'due', '2026-10-09', 1).weeks[0]![0]!.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });
  it('moves between months across years', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
  it('opens on the current month if it has pages, else the next dated one, else the last', () => {
    const now = new Date('2026-10-09T00:00:00Z');
    expect(initialMonth(rows, 'due', now)).toEqual({ year: 2026, month: 9 });
    expect(initialMonth([row('c.md', { due: d('2026-12-02') })], 'due', now)).toEqual({ year: 2026, month: 11 });
    expect(initialMonth([row('c.md', { due: d('2026-01-02') })], 'due', now)).toEqual({ year: 2026, month: 0 });
    expect(initialMonth([], 'due', now)).toEqual({ year: 2026, month: 9 });
  });
});

describe('filter clauses', () => {
  const samples = ['status:todo', 'status:todo,doing', '-status:done', 'due:<2026-11-01', 'due:>=2026-11-01', 'due:2026-10-01..2026-10-31', 'has:due', '-has:due', 'under:Theology/Soteriology', 'under:"Church History"', 'is:orphan'];
  it('round-trips every supported form', () => {
    for (const s of samples) {
      const [row] = clausesOf(s);
      expect(row, s).toBeDefined();
      expect(clauseToToken(row!.clause), s).toBe(s);
    }
  });
  it('leaves words, sorts and wildcard filters alone', () => {
    expect(clausesOf('grace sort:-due tags:gr*').map((r) => r.token.raw)).toEqual([]);
    expect(clausesOf('grace status:todo').map((r) => r.token.raw)).toEqual(['status:todo']);
  });
  it('edits a clause in place, keeping the rest of the query', () => {
    const q = 'grace status:todo sort:due';
    const [r] = clausesOf(q);
    expect(replaceClause(q, r!.token, { field: 'status', op: 'is', values: ['done', 'review'] })).toBe('grace status:done,review sort:due');
    expect(replaceClause(q, r!.token, null)).toBe('grace sort:due');
    expect(replaceClause(q, r!.token, { field: 'status', op: 'is', values: [] })).toBe('grace sort:due');
  });
  it('appends finished clauses and ignores unfinished ones', () => {
    expect(appendClause('grace', { field: 'weight', op: 'gt', values: ['3'] })).toBe('grace weight:>3');
    expect(appendClause('grace', { field: 'weight', op: 'gt', values: [] })).toBe('grace');
    expect(appendClause('', { field: 'status', op: 'is', values: ['in progress'] })).toBe('status:"in progress"');
  });
  it('offers operators and controls that fit the field', () => {
    const f = fieldsFor([
      { key: 'status', type: 'string', values: ['todo', 'done'] },
      { key: 'due', type: 'date' },
      { key: 'weight', type: 'number' },
      { key: 'tags', type: 'string', list: true },
      { key: 'done', type: 'bool' },
    ]);
    const by = (k: string) => f.find((x) => x.key === k)!;
    expect(f.slice(0, 5).map((x) => x.key)).toEqual(['title', 'under', 'is', 'links-to', 'linked-from']);
    expect(opsFor(by('due')).map((o) => o.op)).toContain('between');
    expect(opsFor(by('tags'))[0]!.label).toBe('contains');
    expect(opsFor(by('status')).map((o) => o.op)).toEqual(['is', 'is-not', 'has', 'has-not']);
    expect(controlFor(by('status'), 'is')).toBe('multi');
    expect(controlFor(by('due'), 'between')).toBe('date-range');
    expect(controlFor(by('due'), 'lt')).toBe('date');
    expect(controlFor(by('weight'), 'gte')).toBe('number');
    expect(controlFor(by('weight'), 'between')).toBe('number-range');
    expect(controlFor(by('tags'), 'is')).toBe('text');
    expect(controlFor(by('done'), 'is')).toBe('choice');
    expect(controlFor(by('status'), 'has')).toBe('none');
    expect(controlFor(by('is'), 'is')).toBe('choice');
  });
});

describe('saved queries in views', () => {
  const saved = new Map([['open', 'status:todo sort:due'], ['mine', 'saved:open owner:ann'], ['here', 'under:$this']]);
  it('replaces saved:name, nested, and keeps the rest', () => {
    expect(resolveQuery({ query: 'saved:open tags:x' }, { page: null, saved })).toBe('status:todo sort:due tags:x');
    expect(resolveQuery({ query: 'saved:mine' }, { page: null, saved })).toBe('status:todo sort:due owner:ann');
    expect(resolveQuery({ query: 'saved:"Open"' }, { page: null, saved })).toBe('status:todo sort:due');
  });
  it('fills $this inside a saved query', () => {
    expect(resolveQuery({ query: 'saved:here' }, { page: 'Plan/Tasks.md', saved })).toBe('under:Plan/Tasks');
  });
  it("lets the view's own sort replace the saved query's", () => {
    expect(resolveQuery({ query: 'saved:open', sort: '-title' }, { page: null, saved })).toBe('status:todo sort:-title');
  });
  it('reports unknown and self-using names', () => {
    const errors: string[] = [];
    expandSaved('saved:nope saved:loop', new Map([['loop', 'saved:loop']]), errors);
    expect(errors).toHaveLength(2);
  });
  it('makes the settings of a view for a saved query', () => {
    expect(savedViewTemplate('open-tasks')).toBe('type: table\nquery: saved:open-tasks\n');
    expect(savedViewTemplate('My tasks')).toBe('type: table\nquery: saved:"My tasks"\n');
  });
  it('shows relation columns from the rows', () => {
    const row: Row = { path: 'T.md', title: 'T', isVirtual: false, mtimeMs: 0, attrs: {}, related: { Project: [{ path: 'A.md', title: 'Alpha' }] } };
    expect(valuesOf(row, 'Project')).toEqual(['Alpha']);
    expect(valuesOf(row, 'Other')).toEqual([]);
  });
});
