import { describe, expect, it } from 'vitest';
import { type SchemaHint, lintFrontmatter, lintView } from '../src/index';

const schema = new Map<string, SchemaHint>([
  ['status', { key: 'status', type: 'string', declared: true, schemaType: 'enum', values: ['open', 'done'] }],
  ['due', { key: 'due', type: 'date', declared: true, schemaType: 'date' }],
  ['points', { key: 'points', type: 'number', declared: true, schemaType: 'number' }],
]);
const msgs = (body: string): string[] => lintFrontmatter(body, schema).map((p) => p.message);

describe('frontmatter linter', () => {
  it('accepts a good block', () => {
    expect(msgs('status: open\ndue: 2026-11-19\npoints: 3\norder: 2\nhidden: tree, search\nchildren:\n  status: inherit\n  defaults: none')).toEqual([]);
  });
  it('finds values the schema or Cave Notes cannot use', () => {
    expect(msgs('status: finished')[0]).toContain('not one of the choices');
    expect(msgs('due: tomorrow')[0]).toContain('date');
    expect(msgs('points: lots')[0]).toContain('number');
    expect(msgs('order: first')[0]).toContain('number');
    expect(msgs('hidden: nowhere')[0]).toContain('does not hide');
    expect(msgs('template: maybe')[0]).toContain('true or false');
    expect(msgs('children:\n  defaults: sometimes')[0]).toContain('defaults');
  });
  it('lets keywords and links stand where a value goes', () => {
    expect(msgs('status: inherit\ndue: none')).toEqual([]);
  });
  it('wants children: to hold attributes', () => {
    expect(msgs('children: yes')[0]).toContain('indented');
    expect(msgs('children:\ntitle: x')[0]).toContain('no attributes');
  });
  it('says where the problem is', () => {
    const p = lintFrontmatter('a: 1\nstatus: finished', schema)[0]!;
    expect([p.line, p.from, p.to]).toEqual([1, 8, 16]);
  });
});

describe('view linter', () => {
  const v = (body: string, saved: string[] = []): string[] => lintView(body, { savedQueries: saved }).map((p) => p.message);
  it('accepts good views', () => {
    expect(v('type: table\nquery: status:open\nsort: due')).toEqual([]);
    expect(v('views:\n  - name: A\n    type: kanban\n    group: status\n  - name: B\n    query: "!A"')).toEqual([]);
  });
  it('wants the lines a kind of view needs', () => {
    expect(v('type: kanban')[0]).toContain('group');
    expect(v('type: calendar')[0]).toContain('date');
    expect(v('views:\n  - type: table\n  - type: calendar')[0]).toContain('date');
  });
  it('finds settings that cannot work', () => {
    expect(v('type: chart')[0]).toContain('Unknown view type');
    expect(v('type: table\nlimt: 5')[0]).toContain('not a view setting');
    expect(v('limit: many')[0]).toContain('number');
    expect(v('groupDir: down')[0]).toContain('asc or desc');
    expect(v('query: "!Nothing"')[0]).toContain('no view or saved query');
    expect(v(`query: '!"Open tasks" status:open'`, ['Open tasks'])).toEqual([]);
    expect(v('query: "!Open tasks"', ['Open tasks'])).toEqual(['There is no view or saved query called \u201cOpen\u201d.']);
  });
});
