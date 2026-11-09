import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { tmpRoot, ws } from './helpers.js';

const PAGES = {
  'Plain.md': '# Plain\nwords\n',
  'Tree.md': '---\nhidden: tree\n---\n# Tree\nwords\n',
  'Kids.md': '---\nhidden: children\n---\n# Kids\nwords\n',
  'Find.md': '---\nhidden: search\n---\n# Find\nwords\n',
  'All.md': '---\nhidden: all\n---\n# All\nwords\n',
  'True.md': '---\nhidden: true\n---\n# True\nwords\n',
  'Two.md': '---\nhidden: files, children\n---\n# Two\nwords\n',
  'List.md': '---\nhidden: [tree, search]\n---\n# List\nwords\n',
  'No.md': '---\nhidden: false\n---\n# No\nwords\n',
  'Odd.md': '---\nhidden: sometimes\n---\n# Odd\nwords\n',
};

async function open(t) {
  const root = await tmpRoot(t);
  await ws(root).writeAll(PAGES);
  const idx = await openIndex(root, { dbPath: ':memory:' });
  await idx.reconcile();
  return idx;
}
const sorted = (set) => [...set].sort();

test('hidden: each place has its own list of pages', async (t) => {
  const idx = await open(t);
  assert.deepEqual(sorted(idx.hiddenOnlyPaths(null)), ['All.md', 'List.md', 'Tree.md', 'True.md', 'Two.md']);
  assert.deepEqual(sorted(idx.hiddenOnlyPaths(null, 'children')), ['All.md', 'Kids.md', 'True.md', 'Two.md']);
  assert.deepEqual(sorted(idx.hiddenOnlyPaths(null, 'search')), ['All.md', 'Find.md', 'List.md', 'True.md']);
});

test('hidden: search keeps pages out of the search pane unless the query names hidden', async (t) => {
  const idx = await open(t);
  const found = (q, o) => idx.search(q, o).results.map((r) => r.path).sort();
  // views and rules still see what is only hidden from the search pane, tree or children bar; `all` and `true` hide from queries too
  assert.deepEqual(found('words'), ['Find.md', 'Kids.md', 'List.md', 'No.md', 'Odd.md', 'Plain.md', 'Tree.md', 'Two.md']);
  assert.deepEqual(found('words', { hideFrom: 'search' }), ['Kids.md', 'No.md', 'Odd.md', 'Plain.md', 'Tree.md', 'Two.md']);
  assert.ok(found('words hidden:all', { hideFrom: 'search' }).includes('All.md'));
  assert.ok(found('has:hidden words', { hideFrom: 'search' }).includes('Find.md'));
});
