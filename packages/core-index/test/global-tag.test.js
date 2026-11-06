import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex, mergeSection, offered, parseConfig, parseTagged } from '../src/index.js';
import { tmpRoot, ws } from './helpers.js';

test('!global tags are read, and only tagged sections are offered', () => {
  const p = parseTagged('attributes: !global\n  status: idea\nqueries:\n  a: b\nrelations: !global\n  - name: x\n');
  assert.deepEqual(p.globalKeys, ['attributes', 'relations']);
  const cfg = (...files) => parseConfig(files.map((text, i) => ({ name: `f${i}.yaml`, text })));
  assert.deepEqual(offered(cfg('attributes: !global\n  status: idea\nqueries:\n  a: b\n', 'schema: !global\n  due: { type: date }\n')), {
    attributes: { status: 'idea' },
    schemaAttributes: { due: { type: 'date' } },
  });
  assert.deepEqual(offered(cfg('attributes:\n  status: idea\n')), {});
  assert.equal(parseTagged('a: [').error !== undefined, true);
});

test('a workspace\'s own section wins: absent takes the global, entries merge over it, empty switches it off', () => {
  const g = { status: 'idea', due: null };
  assert.deepEqual(mergeSection(undefined, false, g, 'map'), g);
  assert.deepEqual(mergeSection({ status: 'open' }, true, g, 'map'), { status: 'open', due: null });
  assert.deepEqual(mergeSection({}, true, g, 'map'), {});
  assert.equal(mergeSection(null, true, g, 'map'), null);
  const rels = mergeSection([{ name: 'B' }], true, [{ name: 'a' }, { name: 'b' }], 'seq');
  assert.deepEqual(rels, [{ name: 'a' }, { name: 'B' }]);
});

test('an index takes approved global attributes, schema and queries, and a local empty section overrides them', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '# A\n', '.cave-notes/workspace.yaml': 'attributes: !global\n  status: idea\n' });
  const idx = await openIndex(root, { dbPath: ':memory:', workers: 0 });
  t.after(() => idx.close());
  assert.deepEqual(idx.globals, { status: 'idea' }); // its own tagged section applies to itself

  const root2 = await tmpRoot(t);
  const w2 = ws(root2);
  await w2.writeAll({ 'B.md': '# B\n' });
  const idx2 = await openIndex(root2, { dbPath: ':memory:', workers: 0 });
  t.after(() => idx2.close());
  assert.deepEqual(idx2.globals, {});
  await idx2.setInherited({ attributes: { status: 'idea' }, schemaAttributes: { due: { type: 'date' } }, queries: { open: 'status:idea' } });
  assert.deepEqual(idx2.globals, { status: 'idea' });
  assert.equal(idx2.schema.attributes.has('due'), true);
  assert.deepEqual(idx2.savedQueries.map((q) => q.name), ['open']);

  await w2.write('.cave-notes/workspace.yaml', 'attributes: {}\n');
  await idx2.reloadSchema();
  assert.deepEqual(idx2.globals, {}); // empty attributes switch the global ones off
  assert.deepEqual(idx2.savedQueries.map((q) => q.name), ['open']); // queries were not mentioned, so they still apply
});

test('only what is tagged is shared: not the same section of another file, and a single entry can be tagged', () => {
  const cfg = (...files) => parseConfig(files.map((text, i) => ({ name: `f${i}.yaml`, text })));
  // `rules: !global` in one file does not share the rules of another file
  const two = cfg('rules: !global\n  - id: shared\n', 'rules:\n  - id: private\n');
  assert.deepEqual(two.sections.rules.map((r) => r.id), ['shared', 'private']); // both apply here
  assert.deepEqual(offered(two), { rules: [{ id: 'shared' }] });

  // one tagged entry among others
  const one = cfg('rules:\n  - !global\n    id: shared\n    on: start\n  - id: private\nqueries:\n  open: !global status:idea\n  mine: status:mine\nschema:\n  due: !global { type: date }\n  other: { type: text }\n');
  assert.deepEqual(one.sections.rules.map((r) => r.id), ['shared', 'private']);
  assert.deepEqual(offered(one), {
    rules: [{ id: 'shared', on: 'start' }],
    queries: { open: 'status:idea' },
    schemaAttributes: { due: { type: 'date' } },
  });
  assert.deepEqual(offered(cfg('rules:\n  - id: a\n')), {});
});
