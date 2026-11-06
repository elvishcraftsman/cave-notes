import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { resolveInheritance, parseChildren, normalizeGlobals, keywordOf } from '../src/attrs.js';
import { tmpRoot, ws, paths } from './helpers.js';

/** Work out a whole tree at once: spec is { 'A': frontmatter, 'A/B': frontmatter, ... }, the result is each page's attributes. */
function tree(globals, spec) {
  const states = {};
  for (const p of Object.keys(spec).sort((a, b) => a.split('/').length - b.split('/').length)) {
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
    states[p] = resolveInheritance(spec[p], parent ? states[parent] : undefined, globals);
  }
  return Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.attributes]));
}

// ---------------------------------------------------------------- the rules, as pure functions

test('a page has no attributes unless something gives it some', () => {
  assert.deepEqual(tree({}, { A: {}, 'A/B': {} }), { A: {}, 'A/B': {} });
});

test('global attributes reach every page; a page overrides them for itself only', () => {
  const g = { status: 'idea', lang: 'en' };
  const r = tree(g, { A: { status: 'done' }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r.A, { status: 'done', lang: 'en' });
  // what a page sets for itself is not handed down: the chain is not broken by it
  assert.deepEqual(r['A/B'], { status: 'idea', lang: 'en' });
  assert.deepEqual(r['A/B/C'], { status: 'idea', lang: 'en' });
});

test('a children block reaches every depth, and a page\'s own values do not break the chain', () => {
  const r = tree({}, { A: { children: { status: 'todo' } }, 'A/B': { status: 'done' }, 'A/B/C': {}, 'A/B/C/D': {} });
  assert.deepEqual(r['A/B'], { status: 'done' });
  assert.deepEqual(r['A/B/C'], { status: 'todo' });
  assert.deepEqual(r['A/B/C/D'], { status: 'todo' });
});

test('a children block overrides the global value, attribute by attribute', () => {
  const r = tree({ status: 'idea', lang: 'en' }, { A: { children: { status: 'todo' } }, 'A/B': {} });
  assert.deepEqual(r['A/B'], { status: 'todo', lang: 'en' });
});

test('a page\'s own children block overrides for its sub-pages only what it lists', () => {
  const r = tree({}, {
    A: { children: { status: 'todo', owner: 'ann' } },
    'A/B': { children: { status: 'later' } },
    'A/B/C': {},
    'A/B/C/D': {},
    'A/X': {},
  });
  assert.deepEqual(r['A/B/C'], { status: 'later', owner: 'ann' });
  assert.deepEqual(r['A/B/C/D'], { status: 'later', owner: 'ann' });
  assert.deepEqual(r['A/X'], { status: 'todo', owner: 'ann' });
});

test('inheritance: children keeps a block to the immediate sub-pages', () => {
  const r = tree({}, { A: { children: { inheritance: 'children', status: 'todo' } }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r['A/B'], { status: 'todo' });
  assert.deepEqual(r['A/B/C'], {});
  // and inheritance: all is the same as saying nothing
  const all = tree({}, { A: { children: { inheritance: 'all', status: 'todo' } }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(all['A/B/C'], { status: 'todo' });
});

test('defaults: inherit hands down every value the page has, own ones included, to every depth', () => {
  const g = { lang: 'en' };
  const r = tree(g, {
    A: { status: 'draft', tags: ['x'], children: { defaults: 'inherit' } },
    'A/B': { status: 'done', weight: 3 },
    'A/B/C': {},
  });
  assert.deepEqual(r['A/B'], { lang: 'en', status: 'done', tags: ['x'], weight: 3 }); // its own status wins for itself
  // the grandchild gets what A had, not B's own overrides
  assert.deepEqual(r['A/B/C'], { lang: 'en', status: 'draft', tags: ['x'] });
});

test('defaults: inherit with a list of attributes: the listed ones win', () => {
  const r = tree({}, { A: { status: 'draft', children: { defaults: 'inherit', status: 'todo' } }, 'A/B': {} });
  assert.deepEqual(r['A/B'], { status: 'todo' });
});

test('legacy "children: inherit" means defaults: inherit', () => {
  const r = tree({}, { A: { status: 'draft', children: 'inherit' }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r['A/B'], { status: 'draft' });
  assert.deepEqual(r['A/B/C'], { status: 'draft' });
});

test('defaults: none is a blank slate that is itself handed down; the page keeps what it got', () => {
  const g = { status: 'idea' };
  const r = tree(g, { A: { children: { defaults: 'none', owner: 'ann' } }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r.A, { status: 'idea' });
  assert.deepEqual(r['A/B'], { owner: 'ann' });
  assert.deepEqual(r['A/B/C'], { owner: 'ann' });
  // limited to the sub-pages, the slate is blank for them only
  const one = tree(g, { A: { children: { defaults: 'none', inheritance: 'children' } }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(one['A/B'], {});
  assert.deepEqual(one['A/B/C'], { status: 'idea' });
});

test('defaults: default (the default) leaves what is handed down from above alone', () => {
  const a = tree({ lang: 'en' }, { G: { children: { status: 'todo' } }, 'G/P': { children: { owner: 'ann' } }, 'G/P/C': {} });
  const b = tree({ lang: 'en' }, { G: { children: { status: 'todo' } }, 'G/P': { children: { defaults: 'default', owner: 'ann' } }, 'G/P/C': {} });
  assert.deepEqual(a['G/P/C'], { lang: 'en', status: 'todo', owner: 'ann' });
  assert.deepEqual(b, a);
});

test('the words: default = the workspace value, none = blank, inherit = the parent\'s value', () => {
  const g = { status: 'idea', lang: 'en' };
  const r = tree(g, {
    A: { children: { status: 'todo', lang: 'fr' }, owner: 'ann' },
    'A/B': { status: 'default', lang: 'NONE', owner: ' Inherit ', extra: null },
    'A/C': { children: { status: 'default', lang: 'none', owner: 'inherit' } },
    'A/C/D': {},
  });
  assert.deepEqual(r['A/B'], { status: 'idea', owner: 'ann', extra: null }); // a blank value is an attribute with no value
  assert.deepEqual(r['A/C/D'], { status: 'idea' }); // owner: inherit took the value A/C has, and A/C has none
  // `owner: inherit` in a block takes the block page's own value
  const r2 = tree(g, { A: { owner: 'ann', children: { owner: 'inherit' } }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r2['A/B'], { status: 'idea', lang: 'en', owner: 'ann' });
  assert.deepEqual(r2['A/B/C'], { status: 'idea', lang: 'en', owner: 'ann' });
  // inherit with nothing to inherit leaves the attribute out
  assert.deepEqual(tree({}, { A: {}, 'A/B': { owner: 'inherit' } })['A/B'], {});
  assert.equal(keywordOf('Default'), 'default');
  assert.equal(keywordOf(null), 'empty');
  assert.equal(keywordOf('  '), 'empty');
  assert.equal(keywordOf('nonesuch'), null);
  assert.equal(keywordOf(['none']), null);
});

test('several children blocks are applied in order, each with its own reach and defaults', () => {
  const r = tree({}, {
    A: {
      status: 'draft',
      children: [
        { defaults: 'inherit', inheritance: 'children' },
        { color: 'red' },
        { inheritance: 'children', color: 'blue' },
      ],
    },
    'A/B': {},
    'A/B/C': {},
  });
  assert.deepEqual(r['A/B'], { status: 'draft', color: 'blue' }); // all three apply to the sub-page
  assert.deepEqual(r['A/B/C'], { color: 'red' }); // only the unlimited block goes on
});

test('aliases, order and title belong to one page and are never handed down', () => {
  const g = normalizeGlobals({ order: 1, aliases: ['x'], status: 'idea' });
  assert.deepEqual(g.globals, { status: 'idea' });
  assert.equal(g.problems.length, 2);
  const r = tree({}, {
    A: { order: 5, aliases: ['a'], title: 'A', status: 'x', children: [{ defaults: 'inherit' }, { order: 9 }] },
    'A/B': { order: 'inherit' },
  });
  assert.deepEqual(r['A/B'], { status: 'x' });
  assert.equal(parseChildren({ order: 9 }).problems.length, 1);
});

test('attribute names are one attribute whatever their case', () => {
  const r = tree({ Status: 'idea' }, { A: { children: { STATUS: 'todo' } }, 'A/B': { status: 'done' } });
  assert.deepEqual(r['A/B'], { status: 'done' });
  assert.deepEqual(Object.keys(tree({ Status: 'idea' }, { A: { status: 'x' } }).A), ['status']);
});

test('mistakes in a children block are reported, and harmless', () => {
  const a = resolveInheritance({ children: { defaults: 'sideways', inheritance: 'sometimes', children: { x: 1 }, status: 'todo' } }, undefined, {});
  assert.equal(a.problems.length, 3);
  assert.deepEqual(a.blocks, [{ defaults: 'default', inheritance: 'all', attrs: { status: 'todo' } }]);
  assert.equal(resolveInheritance({ children: 'maybe' }, undefined, {}).problems.length, 1);
  assert.equal(resolveInheritance({ children: 42 }, undefined, {}).problems.length, 1);
  assert.equal(resolveInheritance({ children: [{ status: 'x' }, null] }, undefined, {}).problems.length, 0);
  assert.equal(normalizeGlobals('x').problems.length, 1);
  assert.equal(normalizeGlobals({ status: 'none' }).problems.length, 0); // nothing above the workspace: simply not there
  assert.deepEqual(normalizeGlobals({ status: 'none' }).globals, {});
});

test('a blank value is an attribute that is there with no value; none takes it away', () => {
  // children: { due: } gives every sub-page a `due` with nothing in it
  const r = tree({}, { A: { children: { due: null, owner: 'ann' } }, 'A/B': {}, 'A/C': { due: '2026-11-01' }, 'A/D': { due: 'none' }, 'A/E': { owner: null } });
  assert.deepEqual(r['A/B'], { due: null, owner: 'ann' });
  assert.deepEqual(r['A/C'], { due: '2026-11-01', owner: 'ann' });
  assert.deepEqual(r['A/D'], { owner: 'ann' });
  assert.deepEqual(r['A/E'], { due: null, owner: null }); // own blank overrides the inherited value
  // a workspace-wide blank
  const g = normalizeGlobals({ due: null });
  assert.deepEqual(g.globals, { due: null });
  const r2 = tree(g.globals, { A: {}, 'A/B': { due: 'default' }, 'A/C': { due: 'inherit' }, 'A/D': { due: 'original' } });
  assert.deepEqual(r2.A, { due: null });
  assert.deepEqual(r2['A/B'], { due: null });
  assert.deepEqual(r2['A/C'], { due: null });
  assert.deepEqual(r2['A/D'], { due: null });
});

// ---------------------------------------------------------------- in the index

test('the index stores what pages end up with, and follows edits above them', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    '.cave-notes/workspace.yaml': JSON.stringify({ color: '#3584e4', attributes: { lang: 'en', status: 'idea' } }),
    'Plan.md': '---\nstatus: draft\ntags: [alpha]\nchildren:\n  status: todo\n---\n# Plan',
    'Plan/Task A.md': '---\ntitle: A\n---\n# A',
    'Plan/Task B.md': '---\nstatus: done\ntags: inherit\n---\n# B',
    'Plan/Task A/Sub.md': '# Sub',
    'Loose.md': '# Loose',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();

  assert.deepEqual(paths(idx.search('lang:en')).sort(), ['Loose.md', 'Plan.md', 'Plan/Task A.md', 'Plan/Task A/Sub.md', 'Plan/Task B.md']);
  assert.deepEqual(paths(idx.search('status:idea')), ['Loose.md']);
  assert.deepEqual(paths(idx.search('status:todo')).sort(), ['Plan/Task A.md', 'Plan/Task A/Sub.md']); // the block reaches every depth
  assert.deepEqual(paths(idx.search('status:done')), ['Plan/Task B.md']);
  assert.deepEqual(paths(idx.search('tags:alpha')).sort(), ['Plan.md', 'Plan/Task B.md']);
  assert.equal(idx.getPage('Plan.md').attributes.children, undefined, '`children` is not an attribute');
  assert.deepEqual(idx.getPage('Loose.md').attributes.status.map((v) => v.text), ['idea']);

  // the parent changes what it hands down: sub-pages follow
  await w.write('Plan.md', '---\nstatus: draft\nchildren:\n  defaults: inherit\n---\n# Plan');
  await idx.refresh(['Plan.md']);
  assert.deepEqual(paths(idx.search('status:draft')).sort(), ['Plan.md', 'Plan/Task A.md', 'Plan/Task A/Sub.md']);
  assert.deepEqual(paths(idx.search('status:done')), ['Plan/Task B.md']);
  assert.equal(idx.getPage('Plan/Task B.md').attributes.tags, undefined, 'the parent has no tags any more');

  // no block any more: back to the workspace's value
  await w.write('Plan.md', '---\nstatus: draft\n---\n# Plan');
  await idx.refresh(['Plan.md']);
  assert.deepEqual(paths(idx.search('status:draft')), ['Plan.md']);
  assert.deepEqual(paths(idx.search('status:idea')).sort(), ['Loose.md', 'Plan/Task A.md', 'Plan/Task A/Sub.md']);
});

test('the global attributes follow edits to workspace.yaml, and survive restarts', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ '.cave-notes/workspace.yaml': JSON.stringify({ attributes: { status: 'idea' } }), 'A.md': '# A', 'A/B.md': '---\nstatus: default\n---\n# B' });
  let idx = await openIndex(root);
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('status:idea')).sort(), ['A.md', 'A/B.md']);

  await w.write('.cave-notes/workspace.yaml', JSON.stringify({ attributes: { status: 'plan', hidden: true } }));
  const r = await idx.reloadSchema();
  assert.equal(r.changed, true);
  assert.deepEqual(paths(idx.search('status:plan')).sort(), ['A.md', 'A/B.md']);
  assert.deepEqual([...idx.hiddenPaths()].sort(), ['A.md', 'A/B.md']);
  assert.equal((await idx.reloadSchema()).changed, false);

  // a change to something else in the file (the tab colour) is no change to the attributes
  await w.write('.cave-notes/workspace.yaml', JSON.stringify({ color: '#fff', attributes: { status: 'plan', hidden: true } }));
  assert.equal((await idx.reloadSchema()).changed, false);

  // broken YAML keeps what we had, and says so
  await w.write('.cave-notes/workspace.yaml', '{ nope');
  const bad = await idx.reloadSchema();
  assert.equal(bad.changed, false);
  assert.match(bad.warnings.join(), /not valid YAML/);
  assert.deepEqual(paths(idx.search('status:plan')).sort(), ['A.md', 'A/B.md']);
  await idx.close();

  // edited while the app was closed: found out at the next start
  await w.write('.cave-notes/workspace.yaml', JSON.stringify({ attributes: { status: 'later' } }));
  idx = await openIndex(root);
  t.after(() => idx.close());
  assert.deepEqual(paths(idx.search('status:later')).sort(), ['A.md', 'A/B.md']);
});

test('moving a page under another parent changes what it gets', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'A.md': '---\nchildren:\n  status: one\n---\n# A',
    'B.md': '---\nchildren:\n  status: two\n---\n# B',
    'A/Page.md': '# Page',
    'A/Page/Deep.md': '# Deep',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('status:one')).sort(), ['A/Page.md', 'A/Page/Deep.md']);
  await w.rm('A/Page.md');
  await w.rm('A/Page');
  await w.write('B/Page.md', '# Page');
  await w.write('B/Page/Deep.md', '# Deep');
  await idx.refresh(['A/Page.md', 'A/Page/Deep.md', 'B/Page.md', 'B/Page/Deep.md']);
  assert.deepEqual(paths(idx.search('status:one')), []);
  assert.deepEqual(paths(idx.search('status:two')).sort(), ['B/Page.md', 'B/Page/Deep.md']);
});

test('hidden pages: own, global or handed down, and the folders of hidden pages included', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Top.md': '# Top',
    'Top/Secret.md': '---\nhidden: true\n---\n# Secret',
    'Top/Shown.md': '# Shown',
    'Section.md': '---\nchildren:\n  hidden: true\n---\n# Section',
    'Section/Auto.md': '# Auto',
    'Section/Auto/Deeper.md': '# Deeper',
    'Section/Visible.md': '---\nhidden: false\n---\n# Visible',
    'Quiet.md': '---\nhidden: true\n---\n# Quiet',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual([...idx.hiddenPaths('Top.md')], ['Top/Secret.md']);
  assert.deepEqual([...idx.hiddenPaths('Section.md')].sort(), ['Section/Auto.md']);
  assert.deepEqual([...idx.hiddenPaths(null)], ['Quiet.md']);
  assert.deepEqual([...idx.hiddenPaths()].sort(), ['Quiet.md', 'Section/Auto.md', 'Section/Auto/Deeper.md', 'Top/Secret.md']);
});

test('mistakes in a children block show up as diagnostics of that page', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '---\nchildren:\n  defaults: sideways\n  status: todo\n---\n# A', 'A/B.md': '# B' });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.equal(idx.getPage('A.md').diagnostics.filter((d) => d.kind === 'inheritance').length, 1);
  assert.deepEqual(paths(idx.search('status:todo')), ['A/B.md']); // the rest of the block still works
});

// ---------------------------------------------------------------- original, links, and where `defaults` sits

test('defaults: original goes back to the workspace\'s values, and the word original does it for one attribute', () => {
  const g = { status: 'idea', lang: 'en' };
  const r = tree(g, { G: { children: { status: 'todo', owner: 'ann' } }, 'G/P': { children: { defaults: 'original' } }, 'G/P/C': {}, 'G/Q': { children: { status: 'original' } }, 'G/Q/C': {} });
  assert.deepEqual(r['G/P/C'], { status: 'idea', lang: 'en' }); // todo and ann are gone
  assert.deepEqual(r['G/Q/C'], { status: 'idea', lang: 'en', owner: 'ann' });
  assert.equal(keywordOf('Original'), 'original');
});

test('defaults takes a link to a page: its values are handed down', () => {
  const pages = { Template: { status: 'tpl', owner: 'ann', order: 1 } };
  const lookup = (text) => (text === '[[Template]]' ? pages.Template : null);
  const run = (fm) => {
    const a = resolveInheritance(fm, undefined, { lang: 'en' }, lookup);
    return { a, child: resolveInheritance({}, a, { lang: 'en' }, lookup), deep: null };
  };
  const { a, child } = run({ children: { defaults: '[[Template]]', owner: 'bob' } });
  assert.deepEqual(child.attributes, { status: 'tpl', owner: 'bob' }); // the template's values, the block's on top; order never travels
  assert.equal(a.problems.length, 0);
  // unquoted [[Template]] is a list in a list for YAML, and still understood
  assert.deepEqual(run({ children: { defaults: [['Template']] } }).child.attributes, { status: 'tpl', owner: 'ann' });
  // a markdown link works too
  assert.equal(parseChildren({ defaults: '[t](Notes/Template.md)' }).blocks[0].link, '[t](Notes/Template.md)');
  // a page that is not there changes nothing, and is reported
  const lost = resolveInheritance({ children: { defaults: '[[Nope]]' } }, undefined, {}, lookup);
  assert.equal(lost.problems.length, 1);
  assert.deepEqual(resolveInheritance({}, lost, {}, lookup).attributes, {});
  assert.equal(parseChildren({ defaults: 'whatever' }).problems.length, 1);
});

test('defaults needs to be in one list item only, wherever it is', () => {
  const first = tree({}, { A: { status: 'x', children: [{ defaults: 'inherit' }, { color: 'red' }] }, 'A/B': {} });
  const last = tree({}, { A: { status: 'x', children: [{ color: 'red' }, { defaults: 'inherit' }] }, 'A/B': {} });
  assert.deepEqual(first['A/B'], { status: 'x', color: 'red' });
  assert.deepEqual(last, first);
  // the item that carries it decides how far the defaults reach; the others have their own reach
  const r = tree({}, { A: { status: 'x', children: [{ defaults: 'inherit', inheritance: 'children' }, { inheritance: 'all', color: 'red' }] }, 'A/B': {}, 'A/B/C': {} });
  assert.deepEqual(r['A/B'], { status: 'x', color: 'red' });
  assert.deepEqual(r['A/B/C'], { color: 'red' });
});

test('in the index, a page that takes its values from a linked page follows it', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Template.md': '---\nstatus: tpl\n---\n# Template',
    'Plan.md': '---\nchildren:\n  defaults: "[[Template]]"\n---\n# Plan',
    'Plan/Task.md': '# Task',
    'Plan/Task/Sub.md': '# Sub',
    'Broken.md': '---\nchildren:\n  defaults: "[[Nowhere]]"\n---\n# Broken',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('status:tpl')).sort(), ['Plan/Task.md', 'Plan/Task/Sub.md', 'Template.md']);
  assert.equal(idx.getPage('Broken.md').diagnostics.filter((d) => d.kind === 'inheritance').length, 1);

  // the linked page changes: the pages that follow it do too
  await w.write('Template.md', '---\nstatus: new\nowner: ann\n---\n# Template');
  await idx.refresh(['Template.md']);
  assert.deepEqual(paths(idx.search('status:new')).sort(), ['Plan/Task.md', 'Plan/Task/Sub.md', 'Template.md']);
  assert.deepEqual(paths(idx.search('owner:ann')).sort(), ['Plan/Task.md', 'Plan/Task/Sub.md', 'Template.md']);

  // a global change reaches them as well (a rebuild takes the links into account)
  await w.write('.cave-notes/workspace.yaml', JSON.stringify({ attributes: { lang: 'en' } }));
  await idx.reloadSchema();
  assert.equal(paths(idx.search('lang:en')).length, 5);
  assert.deepEqual(paths(idx.search('status:new')).sort(), ['Plan/Task.md', 'Plan/Task/Sub.md', 'Template.md']);
});

test('an empty attribute shows up on the page, with the declared type, and has: ignores it', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    '.cave-notes/schema.yaml': 'schema:\n  due:\n    type: date\n',
    'Tasks.md': '---\nchildren:\n  due:   \n  done: false\n---\n# Tasks',
    'Tasks/A.md': '# A',
    'Tasks/B.md': '---\ndue: 2026-11-02\n---\n# B',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  const a = idx.getPage('Tasks/A.md').attributes;
  assert.deepEqual(a.due.map((v) => v.text), ['']);
  assert.equal(a.due[0].type, 'date', 'the schema types an empty value');
  assert.deepEqual(paths(idx.search('has:due')), ['Tasks/B.md']);
  assert.deepEqual(paths(idx.search('under:Tasks -has:due')), ['Tasks/A.md']);
  const key = idx.attributeKeys().find((k) => k.key === 'due');
  assert.equal(key.type, 'date');
  assert.equal(key.pages, 2);
});
