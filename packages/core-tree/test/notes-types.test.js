import test from 'node:test';
import assert from 'node:assert/strict';
import { openTree, configureNotes, parentPage, pageFolder, pageName, normalizePagePath } from '../src/index.js';
import { tmpWorkspace } from './helpers.js';

const reset = () => configureNotes({ exts: ['.md'] });

test('configured extensions: .txt files are pages, other files are not', async (t) => {
  t.after(reset);
  configureNotes({ exts: ['.md', '.txt'] });
  const root = await tmpWorkspace(t, { 'A.md': '', 'B.txt': '', 'C.png': '', 'B/Deep.TXT': '' });
  const items = await openTree(root).listChildren(null);
  assert.deepEqual(items.map((i) => [i.path, i.exists, i.hasChildren]), [
    ['A.md', true, false],
    ['B.txt', true, true],
  ]);
  const kids = await openTree(root).listChildren('B.txt');
  assert.deepEqual(kids.map((i) => i.path), ['B/Deep.TXT']);
});

test('path helpers follow the extension of the page', (t) => {
  t.after(reset);
  configureNotes({ exts: ['.md', '.txt'] });
  assert.equal(pageFolder('A/B.txt'), 'A/B');
  assert.equal(pageName('A/B.txt'), 'B');
  assert.equal(parentPage('A/B/C.txt'), 'A/B.txt');
  assert.equal(parentPage('A/B/C.txt', '.md'), 'A/B.md');
  assert.equal(normalizePagePath('x.txt'), 'x.txt');
  assert.throws(() => normalizePagePath('x.png'));
});

test('two files with one stem: the first configured extension wins', async (t) => {
  t.after(reset);
  configureNotes({ exts: ['.txt', '.md'] });
  const root = await tmpWorkspace(t, { 'A.md': '', 'A.txt': '' });
  assert.deepEqual((await openTree(root).listChildren(null)).map((i) => i.path), ['A.txt']);
});

test('new pages get the default extension', async (t) => {
  t.after(reset);
  configureNotes({ exts: ['.md', '.txt'], defaultExt: '.txt' });
  const root = await tmpWorkspace(t, {});
  const tree = openTree(root);
  assert.equal(await tree.createPage(null, 'Fresh'), 'Fresh.txt');
  assert.equal(await tree.createPage('Fresh.txt', 'Child', '', '.md'), 'Fresh/Child.md');
});

test('a folder holding .cave-notes is a separate workspace', async (t) => {
  const root = await tmpWorkspace(t, {
    'Home.md': '',
    'School/Math.md': '',
    'School/.cave-notes/workspace.yaml': 'x: 1\n',
    'School/Math/Algebra.md': '',
    'Other/Page.md': '',
  });
  const tree = openTree(root);
  assert.deepEqual((await tree.listChildren(null)).map((i) => i.path), ['Home.md', 'Other.md']);
  const shown = await tree.listChildren(null, { workspaces: true });
  assert.deepEqual(shown.map((i) => [i.path, !!i.workspace, i.hasChildren]), [
    ['Home.md', false, false],
    ['Other.md', false, true],
    ['School.md', true, false],
  ]);
  const all = [];
  for await (const p of tree.allPages()) all.push(p.path);
  assert.deepEqual(all, ['Home.md', 'Other.md', 'Other/Page.md']);
  assert.equal(await tree.isWorkspaceDir('School'), true);
  assert.equal(await tree.isWorkspaceDir('Other'), false);
  // the inner workspace is its own tree
  const inner = openTree(root + '/School');
  assert.deepEqual((await inner.listChildren(null)).map((i) => i.path), ['Math.md']);
});

test('a page next to a workspace folder keeps its page but loses the folder as children', async (t) => {
  const root = await tmpWorkspace(t, { 'School.md': '# S', 'School/.cave-notes/workspace.yaml': '', 'School/Math.md': '' });
  const items = await openTree(root).listChildren(null);
  assert.deepEqual(items.map((i) => [i.path, i.exists, i.hasChildren, !!i.workspace]), [['School.md', true, false, true]]);
});
