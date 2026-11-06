import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex, normalizeSchema, parseSchemaText } from '../src/index.js';
import { buildAttrs } from '../src/attrs.js';
import { tmpRoot, ws, paths } from './helpers.js';

const SCHEMA = `
schema:
  status:  { type: enum, values: [idea, draft, review, done] }
  weight:  { type: number }
  due:     { type: date }
  tags:    { type: list, of: string }
  version: { type: string }
`;

test('normalizeSchema accepts good definitions and warns about bad ones', () => {
  const { schema, warnings } = normalizeSchema({
    attributes: {
      ok: { type: 'number' },
      Status: { type: 'enum', values: ['a', 'b'] },
      noType: {},
      badEnum: { type: 'enum' },
      weird: { type: 'banana' },
      badList: { type: 'list', of: 'enum' },
      goodList: { type: 'list', of: 'date' },
    },
  });
  assert.deepEqual([...schema.attributes.keys()].sort(), ['goodlist', 'ok', 'status']);
  assert.equal(warnings.length, 4);
  assert.deepEqual(normalizeSchema(null).warnings, []);
  assert.equal(normalizeSchema({ attributes: [] }).warnings.length, 1);
  assert.ok(parseSchemaText('attributes: [unclosed').warnings[0].includes('invalid YAML'));
});

test('typed attributes: coercion, normalization and diagnostics', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.write('.cave-notes/schema.yaml', SCHEMA);
  await w.writeAll({
    'Good.md': '---\nstatus: Draft\nweight: "7"\ndue: 2026-01-01\ntags: solo\nversion: 1.0\n---\n# Good',
    'Bad.md': '---\nstatus: bogus\nweight: heavy\ndue: soon\n---\n# Bad',
  });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();

  const good = idx.getPage('Good.md');
  assert.deepEqual(good.attributes.status, [{ type: 'string', text: 'draft', num: null }]); // enum normalized to schema casing
  assert.deepEqual(good.attributes.weight, [{ type: 'number', text: '7', num: 7 }]); // "7" coerced
  assert.equal(good.attributes.due[0].type, 'date');
  assert.deepEqual(good.attributes.tags.map((a) => a.text), ['solo']); // scalar for a list attribute
  assert.equal(good.attributes.version[0].type, 'string');
  assert.deepEqual(good.diagnostics, []);

  const bad = idx.diagnostics('Bad.md').map((d) => d.message);
  assert.equal(bad.length, 3);
  assert.ok(bad.some((m) => m.startsWith('status:') && m.includes('draft, review')));
  assert.ok(bad.some((m) => m.startsWith('weight:')));
  assert.ok(bad.some((m) => m.startsWith('due:')));

  assert.deepEqual(paths(idx.search('weight:>5')), ['Good.md']); // numeric now, not text
  assert.deepEqual(paths(idx.search('status:draft')), ['Good.md']);
});

test('attributeKeys includes declared attributes with no pages, plus enum values', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).write('.cave-notes/schema.yaml', SCHEMA);
  await ws(root).write('A.md', '---\nstatus: done\n---\n# A');
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  const keys = Object.fromEntries(idx.attributeKeys().map((k) => [k.key.toLowerCase(), k]));
  assert.equal(keys.status.pages, 1);
  assert.deepEqual(keys.status.values, ['idea', 'draft', 'review', 'done']);
  assert.equal(keys.status.declared, true);
  assert.equal(keys.version.pages, 0);
  assert.equal(keys.tags.list, true);
});

test('without a schema values are inferred; with one they are typed', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '---\nweight: "10"\n---\n# A', 'B.md': '---\nweight: "9"\n---\n# B' });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  // Quoted values are strings with no schema, and numeric comparisons only match numeric attributes.
  assert.deepEqual(paths(idx.search('weight:>5')), []);

  await w.write('.cave-notes/schema.yaml', 'schema:\n  weight: { type: number }\n');
  const r = await idx.reloadSchema();
  assert.equal(r.changed, true);
  assert.deepEqual(paths(idx.search('weight:>5 sort:weight')), ['B.md', 'A.md']);
  assert.equal((await idx.reloadSchema()).changed, false); // unchanged file: nothing to do
});

test('setSchema applies a schema programmatically and reports warnings', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '---\nn: "10"\n---\n# A', 'B.md': '---\nn: "9"\n---\n# B' });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  const { warnings } = idx.setSchema({ attributes: { n: { type: 'number' }, broken: { type: 'nope' } } });
  assert.equal(warnings.length, 1);
  assert.deepEqual(paths(idx.search('n:>=10')), ['A.md']);
  idx.setSchema(null);
  assert.deepEqual(paths(idx.search('n:>=10')), []);
});

test('changing schema.yaml between sessions rebuilds attributes on open', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '---\nn: "10"\n---\n# A' });
  let idx = await openIndex(root);
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('n:>5')), []);
  await idx.close();

  await w.write('.cave-notes/schema.yaml', 'schema:\n  n: { type: number }\n');
  idx = await openIndex(root);
  t.after(() => idx.close());
  assert.deepEqual(paths(idx.search('n:>5')), ['A.md']); // no reconcile needed: attrs rebuilt from stored frontmatter
  assert.deepEqual((await idx.reconcile()).unchanged, 1);
});

test('an invalid schema file produces warnings but never blocks indexing', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.write('.cave-notes/schema.yaml', 'attributes: [oops\n');
  await w.write('A.md', '---\nx: 1\n---\n# A');
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  assert.equal(idx.globalsWarnings.length, 1);
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('x:1')), ['A.md']);
});

test('nested mappings flatten to dotted keys; lists of lists flatten; nulls are skipped', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).write(
    'A.md',
    '---\nauthor:\n  name: Lynn\n  links: [x, y]\nmatrix: [[1, 2], [3]]\nempty:\nflag: true\n---\n# A',
  );
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('author.name:lynn')), ['A.md']);
  assert.deepEqual(paths(idx.search('author.links:y')), ['A.md']);
  assert.deepEqual(paths(idx.search('matrix:3')), ['A.md']);
  assert.deepEqual(paths(idx.search('has:empty')), []);
  assert.deepEqual(paths(idx.search('flag:true')), ['A.md']);
});

test('frontmatter errors are reported as diagnostics, not thrown', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).write('A.md', '---\n- not\n- a mapping\n---\n# A');
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(idx.diagnostics().map((d) => [d.path, d.kind]), [['A.md', 'frontmatter']]);
});

test('select, multiselect and boolean spellings are understood; list values are checked', () => {
  const { schema, warnings } = parseSchemaText(`attributes:
  kind: { type: select, values: [a, b] }
  tags: { type: multiselect, values: [x, y, z] }
  done: { type: checkbox }
`);
  assert.deepEqual(warnings, []);
  assert.equal(schema.attributes.get('kind').type, 'enum');
  assert.deepEqual(schema.attributes.get('tags'), { key: 'tags', type: 'list', of: 'string', values: ['x', 'y', 'z'] });
  assert.equal(schema.attributes.get('done').type, 'bool');
  const r = buildAttrs({ tags: ['X', 'q'] }, schema);
  assert.deepEqual(r.rows.map((x) => x.text), ['x', 'q']);
  assert.equal(r.problems.length, 1);
  assert.ok(parseSchemaText('attributes:\n  t: { type: multiselect }\n').warnings.length > 0);
});

test('implies: a value of one attribute sets others, unless the page sets them itself', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    '.cave-notes/schema.yaml': 'schema:\n  type:\n    type: select\n    values: [task, note]\n    implies:\n      task: { hidden: true, kind: work }\n  kind: { type: select, values: [work, home], implies: { work: { area: office } } }\n',
    'A.md': '---\ntype: task\n---\n# A\n',
    'B.md': '---\ntype: task\nhidden: false\n---\n# B\n',
    'C.md': '---\ntype: note\n---\n# C\n',
  });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  await idx.reconcile();
  assert.deepEqual([...idx.hiddenOnlyPaths(null)], ['A.md']);
  const keys = (p) => idx.db.prepare('SELECT a.key k, a.text_value v FROM attrs a JOIN pages p ON p.id = a.page_id WHERE p.path = ? ORDER BY a.key').all(p).map((r) => `${r.k}=${r.v}`);
  assert.deepEqual(keys('A.md'), ['area=office', 'hidden=true', 'kind=work', 'type=task']); // an implied value implies in turn
  assert.deepEqual(keys('C.md'), ['type=note']);
  const bad = normalizeSchema({ attributes: { t: { type: 'select', values: ['a'], implies: ['x'] } } });
  assert.ok(bad.warnings.some((x) => /implies/.test(x)));
});

test('a select can list its choices as `options` too, and an attribute may be called `type`', () => {
  const { schema, warnings } = normalizeSchema({
    attributes: {
      type: { type: 'select', options: ['project', 'task'] },
      tags: { type: 'multiselect', options: ['a', 'b'] },
      created: { type: 'date' },
      followup: { type: 'bool' },
    },
  });
  assert.deepEqual(warnings, []);
  assert.equal(schema.attributes.get('type').type, 'enum');
  assert.deepEqual(schema.attributes.get('type').values, ['project', 'task']);
  assert.deepEqual(schema.attributes.get('tags').values, ['a', 'b']);
});
