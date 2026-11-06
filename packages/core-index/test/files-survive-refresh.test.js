import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { tmpRoot, ws } from './helpers.js';

test('plain files stay in the index after a watcher-style refresh; is:file with OR groups finds them', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'Home.md': '# Home', 'pic.png': 'x', 'doc.pdf': 'y' });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  const files = () => idx.search('is:file').results.map((r) => r.path).sort();
  assert.deepEqual(files(), ['doc.pdf', 'pic.png']);
  await idx.refresh(['Home.md']);
  assert.deepEqual(files(), ['doc.pdf', 'pic.png']);
  assert.deepEqual(idx.search('is:file (pic OR doc)').results.map((r) => r.path).sort(), ['doc.pdf', 'pic.png']);
});

test('linkCount is 0 for a page without links', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '# A\nno links', 'B.md': '[[A]]' });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.equal(idx.linkCount('A.md'), 0);
  assert.equal(idx.linkCount('B.md'), 1);
});
