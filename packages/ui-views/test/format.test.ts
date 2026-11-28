import { describe, expect, it } from 'vitest';
import { applyFormat, coerceValue, csvRecords, parseCsv, summarize, withComputed } from '../src/format';
import { duplicateViewInSource, parseViewSet } from '../src/config';
import { viewColumns, valuesOf, type Row } from '../src/shape';

const a = (text: string, type = 'number'): { type: string; text: string; num: number | null } => ({ type, text, num: type === 'number' ? Number(text) : null });
const row = (path: string, attrs: Record<string, ReturnType<typeof a>[]>): Row => ({ path, title: path, isVirtual: false, mtimeMs: 0, attrs });

describe('formats', () => {
  it('shows money, percentages and decimals', () => {
    expect(applyFormat([a('1234.5')], 'currency')).toEqual({ kind: 'text', text: '$1,234.50' });
    expect(applyFormat([a('9')], 'currency:EUR')).toEqual({ kind: 'text', text: '€9.00' });
    expect(applyFormat([a('42')], 'percent')).toEqual({ kind: 'text', text: '42%' });
    expect(applyFormat([a('3.14159')], 'number:2')).toEqual({ kind: 'text', text: '3.14' });
  });
  it('leaves what does not fit as it is', () => {
    expect(applyFormat([a('n/a', 'string')], 'currency')).toEqual({ kind: 'text', text: 'n/a' });
    expect(applyFormat([a('x', 'string')], 'nonsense')).toEqual({ kind: 'text', text: 'x' });
  });
  it('makes ratings, bars and links', () => {
    expect(applyFormat([a('4')], 'rating')).toEqual({ kind: 'rating', value: 4, max: 5 });
    expect(applyFormat([a('9')], 'rating:5')).toMatchObject({ value: 5 });
    expect(applyFormat([a('30')], 'progress')).toEqual({ kind: 'progress', value: 30, max: 100 });
    expect(applyFormat([a('https://www.example.com/', 'string')], 'url')).toMatchObject({ kind: 'url', text: 'example.com', href: 'https://www.example.com/' });
    expect(applyFormat([a('me@example.com', 'string')], 'email')).toMatchObject({ kind: 'email', href: 'mailto:me@example.com' });
  });
});

describe('summaries', () => {
  const rows = [row('a', { cost: [a('10')] }), row('b', { cost: [a('20')] }), row('c', {}), row('d', { cost: [a('45')] })];
  const sum = (how: string, fmt?: string): string | null => summarize(rows, 'cost', how, (r, k) => r.attrs[k] ?? [], fmt);
  it('adds, averages and counts', () => {
    expect(sum('sum')).toBe('75');
    expect(sum('avg')).toBe('25');
    expect(sum('min')).toBe('10');
    expect(sum('max')).toBe('45');
    expect(sum('median')).toBe('20');
    expect(sum('count')).toBe('4');
    expect(sum('filled')).toBe('3');
    expect(sum('empty')).toBe('1');
    expect(sum('percent')).toBe('75%');
  });
  it('follows the column format', () => {
    expect(sum('sum', 'currency')).toBe('$75.00');
  });
});

describe('computed columns', () => {
  it('reads them from the settings and puts them after the other columns', () => {
    const r = parseViewSet('type: table\nquery: x\ncomputed:\n  Total: ${sum("project:$this", "cost")}\n  Share:\n  - 1');
    expect(r.ok).toBe(false);
    const ok = parseViewSet('type: table\nquery: x\ncomputed:\n  Total: ${sum("project:$this", "cost")}\n  Left: this.a - this.b\nformats:\n  Total: currency\nfooter:\n  total: sum\nwrap: true\nfreeze: 1');
    expect(ok.ok && ok.set.views[0]).toMatchObject({ computed: [{ name: 'Total', expr: 'sum("project:$this", "cost")' }, { name: 'Left', expr: 'this.a - this.b' }], formats: { total: 'currency' }, footer: { total: 'sum' }, wrap: true, freeze: 1 });
    const cfg = ok.ok ? ok.set.views[0]! : (null as never);
    expect(viewColumns(cfg, [row('a', { status: [a('x', 'string')] })])).toEqual(['title', 'status', 'Total', 'Left']);
  });
  it('are put into the rows as attributes', () => {
    const out = withComputed([row('a', {}), row('b', {})], 'Total', new Map([['a', { text: '12', list: ['12'], kind: 'number' }]]));
    expect(valuesOf(out[0]!, 'Total')).toEqual(['12']);
    expect(out[0]!.attrs.Total![0]).toMatchObject({ type: 'number', num: 12 });
    expect(out[1]!.attrs.Total).toBeUndefined();
  });
});

describe('pasting', () => {
  it('turns text into what the column holds', () => {
    expect(coerceValue(' $1,200 ', { type: 'number' })).toBe(1200);
    expect(coerceValue('yes', { type: 'bool' })).toBe(true);
    expect(coerceValue('a, b ,c', { list: true })).toEqual(['a', 'b', 'c']);
    expect(coerceValue('n/a', { type: 'number' })).toBe('n/a');
    expect(coerceValue('  ', {})).toBeNull();
  });
});

describe('csv', () => {
  it('reads quotes, commas inside quotes, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
  });
  it('finds a semicolon or tab separator', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('makes records, dropping blank cells and blank lines', () => {
    const r = csvRecords('\uFEFFtitle,cost,note\nRent,1000,\n\nFood,350.5,"a, b"\n');
    expect(r.columns).toEqual(['title', 'cost', 'note']);
    expect(r.records).toEqual([{ title: 'Rent', cost: '1000' }, { title: 'Food', cost: '350.5', note: 'a, b' }]);
  });
});

describe('duplicate view', () => {
  it('copies every setting of a flat view and makes it a block of two', () => {
    const out = duplicateViewInSource('title: Tasks\ntype: table\nquery: under:$this\nwrap: true\nopen: true\n', 0);
    const r = parseViewSet(out);
    expect(r.ok && r.set.views.map((v) => [v.title, v.type, v.wrap, v.open])).toEqual([['Tasks', 'table', true, true], ['Tasks copy', 'table', true, undefined]]);
  });
  it('copies a view of a block next to the original', () => {
    const out = duplicateViewInSource('views:\n  - name: A\n    type: table\n    query: x\n  - name: B\n    type: list\n    query: y\n', 0);
    const r = parseViewSet(out);
    expect(r.ok && r.set.views.map((v) => v.title)).toEqual(['A', 'A copy', 'B']);
  });
});
