import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex, parseConfig, configFileNames, homeFor, readConfig } from '../src/index.js';
import { tmpRoot, ws, paths } from './helpers.js';

const cfg = (files) => parseConfig(Object.entries(files).map(([name, text]) => ({ name, text })));

test('sections are found whichever file they are in, and lists and maps are put together', () => {
  const c = cfg({
    'workspace.yaml': 'queries:\n  open: status:todo\nrelations:\n  - name: A\n',
    'more.yaml': 'queries:\n  done: status:done\nrelations:\n  - name: B\nschema:\n  due: { type: date }\nexport-style:\n  Plain: { units: cm }\nrules: []\n',
  });
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(Object.keys(c.sections.queries), ['open', 'done']);
  assert.deepEqual(c.sections.relations.map((r) => r.name), ['A', 'B']);
  assert.deepEqual(c.sections.schema, { due: { type: 'date' } });
  assert.deepEqual(Object.keys(c.sections['export-style']), ['Plain']);
  assert.equal(c.present.has('rules'), true);
  assert.deepEqual(c.owners.queries, ['workspace.yaml', 'more.yaml']);
});

test('a name two files both give is reported, and the later file wins; unknown sections are reported', () => {
  const c = cfg({ 'workspace.yaml': 'queries:\n  a: x\n', 'z.yaml': 'queries:\n  a: y\nbogus: 1\n' });
  assert.equal(c.sections.queries.a, 'y');
  assert.equal(c.warnings.length, 2);
  assert.ok(c.warnings.some((w) => w.includes('both workspace.yaml and z.yaml')));
  assert.ok(c.warnings.some((w) => w.includes('“bogus”')));
});

test('a file that is not YAML makes the whole setup invalid (the app keeps what it had)', () => {
  const c = cfg({ 'a.yaml': 'attributes: [oops\n', 'b.yaml': 'queries:\n  a: x\n' });
  assert.equal(c.invalid, true);
  assert.ok(c.warnings[0].startsWith('a.yaml:'));
});

test('files are read in a fixed order, and only YAML files that are settings', () => {
  assert.deepEqual(configFileNames(['b.yaml', 'workspace.yaml', 'A.yml', 'state.yaml', 'x.md', '.hidden.yaml']), ['workspace.yaml', 'A.yml', 'b.yaml']);
});

test('a change goes to the file that has the section, else to the usual file, else to a file that holds settings', () => {
  const one = cfg({ 'setup.yaml': 'queries:\n  a: b\n' });
  assert.equal(homeFor(one, 'queries'), 'setup.yaml');
  assert.equal(homeFor(one, 'schema'), 'setup.yaml'); // no schema.yaml here: the one file with settings
  const two = cfg({ 'workspace.yaml': 'queries:\n  a: b\n', 'schema.yaml': '# nothing yet\n' });
  assert.equal(homeFor(two, 'schema'), 'schema.yaml');
  // what the app makes new goes into the subfolders
  assert.equal(homeFor(cfg({}), 'rules'), 'plugins/automations.yaml');
  assert.equal(homeFor(cfg({}), 'export-style'), 'styles/export-styles.yaml');
  // a main-folder file that has the section is preferred over a plugin's
  const both = cfg({ 'plugins/p.yaml': 'rules:\n  - id: a\n    on: {}\n', 'workspace.yaml': 'rules:\n  - id: b\n    on: {}\n' });
  assert.equal(homeFor(both, 'rules'), 'workspace.yaml');
});

test('an index reads its schema, global attributes and saved queries from one single file', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'A.md': '---\nn: "10"\n---\n# A',
    '.cave-notes/everything.yaml': 'schema:\n  n: { type: number }\nattributes:\n  lang: en\nqueries:\n  big: n:>5\n',
  });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('n:>5')), ['A.md']);
  assert.deepEqual(paths(idx.search('lang:en')), ['A.md']);
  assert.deepEqual(idx.savedQueries.map((q) => q.name), ['big']);
  const c = await readConfig(root + '/.cave-notes');
  assert.deepEqual(c.files.map((f) => f.name), ['everything.yaml']);
});

test('moving a section to another file changes nothing', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '---\nn: "10"\n---\n# A', '.cave-notes/workspace.yaml': 'queries:\n  big: n:>5\n' });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  await w.write('.cave-notes/schema.yaml', 'schema:\n  n: { type: number }\n');
  assert.equal((await idx.reloadSchema()).changed, true);
  assert.deepEqual(paths(idx.search('n:>5')), ['A.md']);
});

test('plugins/ and styles/ are read; the main folder wins; a subfolder may only hold its own sections', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'A.md': '# A',
    '.cave-notes/plugins/simple.yaml': 'queries:\n  q: n:>1\nrules:\n  - id: r1\n    name: from plugin\n',
    '.cave-notes/plugins/Big.md': '# Big plugin readme',
    '.cave-notes/plugins/Big/parts.yaml': 'schema:\n  n: { type: number }\n',
    '.cave-notes/plugins/Big/helper.js': '// helper file, not settings',
    '.cave-notes/plugins/bad.yaml': 'color: red\n',
    '.cave-notes/styles/paper.yaml': 'export-style:\n  Paper: {}\n',
    '.cave-notes/workspace.yaml': 'queries:\n  q: n:>5\nrules:\n  - id: r1\n    name: from main\n',
  });
  const c = await readConfig(root + '/.cave-notes');
  assert.deepEqual(c.files.map((f) => f.name), ['plugins/bad.yaml', 'plugins/Big/parts.yaml', 'plugins/simple.yaml', 'styles/paper.yaml', 'workspace.yaml']);
  assert.equal(c.sections.queries.q, 'n:>5', 'the main folder wins over the plugin');
  assert.deepEqual(c.sections.rules.map((r) => r.name), ['from main']);
  assert.ok(c.sections.schema.n && c.sections['export-style'].Paper);
  assert.ok(c.warnings.some((x) => x.includes('plugins/bad.yaml') && x.includes('color')), 'a section a plugin may not hold is reported');
  assert.ok(!c.warnings.some((x) => x.includes('both')), 'overriding a plugin is not a conflict');
});
