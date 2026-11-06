import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openTree } from '../src/index.js';
import { tmpWorkspace, snapshot, collect, rejectsWith } from './helpers.js';

const names = (items) => items.map((i) => i.name);

// ---------------------------------------------------------------- listing

test('listChildren: root listing merges page+folder and shows virtual pages', async (t) => {
  const root = await tmpWorkspace(t, {
    'Theology.md': '# T',
    'Theology/Soteriology.md': '',
    'Notes.md': '',
    'Ideas/Loose.md': '', // folder with no Ideas.md -> virtual page
  });
  const tree = openTree(root);
  const items = await tree.listChildren(null);
  assert.deepEqual(items.map((i) => [i.path, i.exists, i.hasChildren]), [
    ['Ideas.md', false, true],
    ['Notes.md', true, false],
    ['Theology.md', true, true],
  ]);
});

test('listChildren: children of a page and of a virtual page', async (t) => {
  const root = await tmpWorkspace(t, {
    'A.md': '',
    'A/B.md': '',
    'A/B/C.md': '',
    'V/X.md': '',
  });
  const tree = openTree(root);
  assert.deepEqual((await tree.listChildren('A.md')).map((i) => i.path), ['A/B.md']);
  assert.deepEqual((await tree.listChildren('A/B.md')).map((i) => i.path), ['A/B/C.md']);
  assert.deepEqual((await tree.listChildren('V.md')).map((i) => i.path), ['V/X.md']);
  assert.deepEqual(await tree.listChildren('A/B/C.md'), []); // leaf, no folder
});

test('listChildren ignores dotfiles, non-.md files, symlinks, and configured names', async (t) => {
  const root = await tmpWorkspace(t, {
    '.cave-notes/index.db': 'x',
    '.hidden.md': '',
    'Real.md': '',
    'photo.png': '',
    'readme.txt': '',
    'assets/img.md': '',
  });
  await fsp.symlink(root, path.join(root, 'loop'));
  const tree = openTree(root, { ignore: ['assets'] });
  assert.deepEqual(names(await tree.listChildren(null)), ['Real']);
});

test('listChildren: hasChildren is false for an empty folder or a folder holding only non-pages', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/': null, 'B.md': '', 'B/pic.png': '' });
  const items = await openTree(root).listChildren(null);
  assert.deepEqual(items.map((i) => [i.name, i.hasChildren]), [['A', false], ['B', false]]);
});

test('folders that hold no pages (attachments only, or empty) are pages of the hierarchy, unless asked to leave them out', async (t) => {
  const root = await tmpWorkspace(t, {
    'Real.md': '',
    'docs/spec.pdf': 'x',
    'empty/': null,
    'images/2026/photo.png': 'x',
    'Mixed/pic.png': 'x',
    'Mixed/Kid.md': '',
  });
  const tree = openTree(root);
  assert.deepEqual(names(await tree.listChildren(null)), ['docs', 'empty', 'images', 'Mixed', 'Real']);
  const bare = await tree.listChildren(null);
  assert.equal(bare.find((i) => i.name === 'docs').exists, false); // a virtual page
  assert.equal(bare.find((i) => i.name === 'images').hasChildren, true); // it holds the folder 2026
  assert.deepEqual(names(await tree.listChildren(null, { bareFolders: false })), ['Mixed', 'Real']);
  assert.equal(await tree.status('docs.md'), 'virtual');
});

test('sorting: natural, case-insensitive, with frontmatter order first', async (t) => {
  const root = await tmpWorkspace(t, {
    'Chapter 10.md': '', 'Chapter 2.md': '', 'chapter 1.md': '', 'Zeta.md': '', 'alpha.md': '',
  });
  assert.deepEqual(names(await openTree(root).listChildren(null)), [
    'alpha', 'chapter 1', 'Chapter 2', 'Chapter 10', 'Zeta',
  ]);
  const order = { 'Zeta.md': 1, 'alpha.md': 2 };
  const ordered = openTree(root, { orderOf: (p) => order[p] });
  assert.deepEqual(names(await ordered.listChildren(null)).slice(0, 2), ['Zeta', 'alpha']);
});

test('allPages walks depth-first in tree order, including virtual pages', async (t) => {
  const root = await tmpWorkspace(t, {
    'A.md': '', 'A/B.md': '', 'A/B/C.md': '', 'D.md': '', 'V/W.md': '',
  });
  const all = await collect(openTree(root).allPages());
  assert.deepEqual(all.map((p) => p.path), ['A.md', 'A/B.md', 'A/B/C.md', 'D.md', 'V.md', 'V/W.md']);
  assert.deepEqual(all.filter((p) => !p.exists).map((p) => p.path), ['V.md']);
});

test('status distinguishes page, virtual and missing; rejects bad paths', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'V/X.md': '' });
  const tree = openTree(root, { ignore: ['assets'] });
  assert.equal(await tree.status('A.md'), 'page');
  assert.equal(await tree.status('V.md'), 'virtual');
  assert.equal(await tree.status('Nope.md'), null);
  await rejectsWith(assert, tree.status('../x.md'), 'INVALID_PATH');
  await rejectsWith(assert, tree.status('assets/x.md'), 'INVALID_PATH');
});

// ---------------------------------------------------------------- create

test('createPage at root and under a leaf creates the folder lazily', async (t) => {
  const root = await tmpWorkspace(t);
  const tree = openTree(root);
  assert.equal(await tree.createPage(null, 'Theology', '# T'), 'Theology.md');
  assert.deepEqual(await snapshot(root), ['Theology.md']); // no folder yet
  assert.equal(await tree.createPage('Theology.md', 'Grace'), 'Theology/Grace.md');
  assert.deepEqual(await snapshot(root), ['Theology.md', 'Theology/', 'Theology/Grace.md']);
  assert.equal(await fsp.readFile(path.join(root, 'Theology.md'), 'utf8'), '# T');
});

test('createPage under a virtual page and into an existing virtual folder (promotion)', async (t) => {
  const root = await tmpWorkspace(t, { 'V/X.md': '' });
  const tree = openTree(root);
  assert.equal(await tree.createPage('V.md', 'Y'), 'V/Y.md');
  assert.equal(await tree.createPage(null, 'V', 'now real'), 'V.md');
  assert.equal(await tree.status('V.md'), 'page');
});

test('createPage rejects collisions (case-insensitive), bad names, missing parent, ignored names', async (t) => {
  const root = await tmpWorkspace(t, { 'Grace.md': '', 'Folder/X.md': '' });
  const tree = openTree(root, { ignore: ['assets'] });
  await rejectsWith(assert, tree.createPage(null, 'Grace'), 'COLLISION');
  await rejectsWith(assert, tree.createPage(null, 'GRACE'), 'COLLISION');
  await rejectsWith(assert, tree.createPage(null, 'folder'), 'COLLISION'); // different case than Folder/
  await rejectsWith(assert, tree.createPage(null, 'a/b'), 'INVALID_NAME');
  await rejectsWith(assert, tree.createPage(null, 'assets'), 'INVALID_NAME');
  await rejectsWith(assert, tree.createPage('Missing.md', 'X'), 'NOT_FOUND');
});

test('promoteVirtual', async (t) => {
  const root = await tmpWorkspace(t, { 'V/X.md': '', 'Real.md': '' });
  const tree = openTree(root);
  assert.equal(await tree.promoteVirtual('V.md', '# V'), 'V.md');
  assert.equal(await tree.status('V.md'), 'page');
  await rejectsWith(assert, tree.promoteVirtual('Real.md'), 'EXISTS');
  await rejectsWith(assert, tree.promoteVirtual('Nope.md'), 'NOT_FOUND');
});

// ---------------------------------------------------------------- move / rename

test('movePage moves the page and its folder together and reports every affected page', async (t) => {
  const root = await tmpWorkspace(t, {
    'A.md': 'a', 'A/B.md': 'b', 'A/B/C.md': 'c', 'A/Virt/D.md': 'd',
    'Dest.md': 'dest',
  });
  const tree = openTree(root);
  const res = await tree.movePage('A.md', 'Dest.md');
  assert.equal(res.to, 'Dest/A.md');
  assert.deepEqual(
    res.pageMoves.map((m) => [m.from, m.to, m.exists]).sort(),
    [
      ['A.md', 'Dest/A.md', true],
      ['A/B.md', 'Dest/A/B.md', true],
      ['A/B/C.md', 'Dest/A/B/C.md', true],
      ['A/Virt.md', 'Dest/A/Virt.md', false],
      ['A/Virt/D.md', 'Dest/A/Virt/D.md', true],
    ].sort(),
  );
  assert.deepEqual(await snapshot(root), [
    'Dest.md', 'Dest/', 'Dest/A.md', 'Dest/A/', 'Dest/A/B.md', 'Dest/A/B/', 'Dest/A/B/C.md',
    'Dest/A/Virt/', 'Dest/A/Virt/D.md',
  ]);
});

test('movePage to the root, and prunes the now-empty folder of the old parent', async (t) => {
  const root = await tmpWorkspace(t, { 'P.md': '', 'P/Child.md': '' });
  const tree = openTree(root);
  await tree.movePage('P/Child.md', null);
  assert.deepEqual(await snapshot(root), ['Child.md', 'P.md']); // P/ pruned
});

test('movePage does not prune the folder of a virtual old parent', async (t) => {
  const root = await tmpWorkspace(t, { 'V/Child.md': '' });
  const tree = openTree(root);
  await tree.movePage('V/Child.md', null);
  assert.deepEqual(await snapshot(root), ['Child.md', 'V/']);
});

test('movePage rejects moving into itself or a descendant, and touches nothing', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/B.md': '', 'A/B/C.md': '' });
  const before = await snapshot(root);
  const tree = openTree(root);
  await rejectsWith(assert, tree.movePage('A.md', 'A.md'), 'MOVE_INTO_SELF');
  await rejectsWith(assert, tree.movePage('A.md', 'A/B.md'), 'MOVE_INTO_SELF');
  await rejectsWith(assert, tree.movePage('A.md', 'A/B/C.md'), 'MOVE_INTO_SELF');
  assert.deepEqual(await snapshot(root), before);
});

test('movePage into a sibling whose name merely shares a prefix is allowed', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/X.md': '', 'AB.md': '' });
  const tree = openTree(root);
  assert.equal((await tree.movePage('A.md', 'AB.md')).to, 'AB/A.md');
});

test('movePage rejects collisions at the destination, including case-insensitive ones', async (t) => {
  const root = await tmpWorkspace(t, {
    'A.md': '', 'A/Kid.md': '', 'Dest.md': '', 'Dest/a.md': '', 'Other.md': '', 'Other/A/x.md': '',
  });
  const before = await snapshot(root);
  const tree = openTree(root);
  await rejectsWith(assert, tree.movePage('A.md', 'Dest.md'), 'COLLISION');
  await rejectsWith(assert, tree.movePage('A.md', 'Other.md'), 'COLLISION'); // folder Other/A would merge
  assert.deepEqual(await snapshot(root), before);
});

test('movePage of a leaf onto a virtual folder of the same name promotes it', async (t) => {
  const root = await tmpWorkspace(t, { 'Leaf.md': 'leaf', 'Dest.md': '', 'Dest/Leaf/Kid.md': '' });
  const tree = openTree(root);
  await tree.movePage('Leaf.md', 'Dest.md');
  assert.equal(await tree.status('Dest/Leaf.md'), 'page');
  assert.deepEqual((await tree.listChildren('Dest/Leaf.md')).map((i) => i.path), ['Dest/Leaf/Kid.md']);
});

test('movePage creates the destination folder lazily when the new parent is a leaf', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'Leaf.md': '' });
  await openTree(root).movePage('A.md', 'Leaf.md');
  assert.deepEqual(await snapshot(root), ['Leaf.md', 'Leaf/', 'Leaf/A.md']);
});

test('movePage of a virtual page moves its folder', async (t) => {
  const root = await tmpWorkspace(t, { 'V/X.md': '', 'Dest.md': '' });
  const res = await openTree(root).movePage('V.md', 'Dest.md');
  assert.deepEqual(res.pageMoves.map((m) => m.to).sort(), ['Dest/V.md', 'Dest/V/X.md']);
  assert.deepEqual(await snapshot(root), ['Dest.md', 'Dest/', 'Dest/V/', 'Dest/V/X.md']);
});

test('movePage errors: missing source, missing destination parent', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '' });
  const tree = openTree(root);
  await rejectsWith(assert, tree.movePage('Nope.md', null, 'X'), 'NOT_FOUND');
  await rejectsWith(assert, tree.movePage('A.md', 'Nope.md'), 'NOT_FOUND');
});

test('renamePage renames page and folder, including case-only renames', async (t) => {
  const root = await tmpWorkspace(t, { 'foo.md': '', 'foo/Bar.md': '', 'Other.md': '' });
  const tree = openTree(root);
  const res = await tree.renamePage('foo.md', 'Foo');
  assert.deepEqual(res.pageMoves.map((m) => [m.from, m.to]), [
    ['foo.md', 'Foo.md'],
    ['foo/Bar.md', 'Foo/Bar.md'],
  ]);
  assert.deepEqual(await snapshot(root), ['Foo.md', 'Foo/', 'Foo/Bar.md', 'Other.md']);
  await rejectsWith(assert, tree.renamePage('Foo.md', 'other'), 'COLLISION');
  await rejectsWith(assert, tree.renamePage('Foo.md', 'bad/name'), 'INVALID_NAME');
});

test('renamePage to the same name is a no-op', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '' });
  const res = await openTree(root).renamePage('A.md', 'A');
  assert.deepEqual(res, { from: 'A.md', to: 'A.md', pageMoves: [] });
});

test('NFC/NFD: a decomposed name collides with its composed twin', async (t) => {
  const root = await tmpWorkspace(t, { 'Caf\u00e9.md': '' });
  await rejectsWith(assert, openTree(root).createPage(null, 'Cafe\u0301'), 'COLLISION');
});

test('movePage rolls back completely if the folder rename fails', async (t) => {
  const root = await tmpWorkspace(t, { 'Foo.md': 'foo', 'Foo/Bar.md': 'bar', 'Baz.md': 'baz' });
  const before = await snapshot(root);
  let calls = 0;
  const tree = openTree(root, {
    fs: {
      rename: async (a, b) => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('boom'), { code: 'EIO' });
        return fsp.rename(a, b);
      },
    },
  });
  await rejectsWith(assert, tree.movePage('Foo.md', 'Baz.md'), 'IO_ERROR');
  assert.deepEqual(await snapshot(root), before); // Foo.md back, Baz/ removed again
  assert.equal(await fsp.readFile(path.join(root, 'Foo.md'), 'utf8'), 'foo');
});

// ---------------------------------------------------------------- delete

test('deletePage: leaf, and prunes the parent folder if it becomes empty', async (t) => {
  const root = await tmpWorkspace(t, { 'P.md': '', 'P/Only.md': '' });
  const res = await openTree(root).deletePage('P/Only.md');
  assert.deepEqual(res.removed, [{ path: 'P/Only.md', exists: true }]);
  assert.deepEqual(await snapshot(root), ['P.md']);
});

test('deletePage refuses pages with children unless recursive', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/B.md': '', 'A/V/C.md': '' });
  const tree = openTree(root);
  const before = await snapshot(root);
  await rejectsWith(assert, tree.deletePage('A.md'), 'HAS_CHILDREN');
  assert.deepEqual(await snapshot(root), before);
  const res = await tree.deletePage('A.md', { recursive: true });
  assert.deepEqual(res.removed.map((r) => r.path).sort(), ['A.md', 'A/B.md', 'A/V.md', 'A/V/C.md']);
  assert.deepEqual(await snapshot(root), []);
});

test('deletePage removes an empty leftover folder; refuses folders holding attachments', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/': null, 'B.md': '', 'B/pic.png': 'x' });
  const tree = openTree(root);
  await tree.deletePage('A.md');
  assert.deepEqual(await snapshot(root), ['B.md', 'B/', 'B/pic.png']);
  await rejectsWith(assert, tree.deletePage('B.md'), 'HAS_CHILDREN');
});

test('deletePage of a virtual page needs recursive, then removes the folder', async (t) => {
  const root = await tmpWorkspace(t, { 'V/X.md': '' });
  const tree = openTree(root);
  await rejectsWith(assert, tree.deletePage('V.md'), 'HAS_CHILDREN');
  await tree.deletePage('V.md', { recursive: true });
  assert.deepEqual(await snapshot(root), []);
});

test('deletePage missing page', async (t) => {
  const root = await tmpWorkspace(t);
  await rejectsWith(assert, openTree(root).deletePage('Nope.md'), 'NOT_FOUND');
});

// ---------------------------------------------------------------- concurrency

test('concurrent creates of the same name: exactly one wins', async (t) => {
  const root = await tmpWorkspace(t);
  const tree = openTree(root);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => tree.createPage(null, 'Same')));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'COLLISION'), true);
});

// ---------------------------------------------------------------- planning

test('planMove / planRename describe a move exactly as movePage performs it, without touching the disk', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/B.md': '', 'A/V/C.md': '', 'Dest.md': '' });
  const tree = openTree(root);
  const before = await snapshot(root);
  const plan = await tree.planMove('A.md', 'Dest.md', 'Renamed');
  assert.deepEqual(await snapshot(root), before); // nothing happened
  assert.equal(plan.to, 'Dest/Renamed.md');
  const done = await tree.movePage('A.md', 'Dest.md', 'Renamed');
  assert.deepEqual(plan, done);

  const rename = await tree.planRename('Dest.md', 'Other');
  assert.deepEqual(rename.pageMoves.map((m) => m.to).sort(), [
    'Other.md', 'Other/Renamed.md', 'Other/Renamed/B.md', 'Other/Renamed/V.md', 'Other/Renamed/V/C.md',
  ]);
});

test('planMove reports the same errors as movePage, and an empty plan for a no-op', async (t) => {
  const root = await tmpWorkspace(t, { 'A.md': '', 'A/B.md': '', 'X.md': '', 'Y.md': '' });
  const tree = openTree(root);
  await rejectsWith(assert, tree.planMove('A.md', 'A/B.md'), 'MOVE_INTO_SELF');
  await rejectsWith(assert, tree.planMove('X.md', null, 'Y'), 'COLLISION');
  await rejectsWith(assert, tree.planMove('Nope.md', null), 'NOT_FOUND');
  assert.deepEqual(await tree.planMove('X.md', null), { from: 'X.md', to: 'X.md', pageMoves: [] });
});

test('sync conflict copies are not pages, and `only` limits the tree to one file', async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const dir = await mkdtemp(pathMod.join(os.tmpdir(), 'cave-only-'));
  await writeFile(pathMod.join(dir, 'A.md'), '# A');
  await writeFile(pathMod.join(dir, 'A.sync-conflict-20260101-120000-ABCDEFG.md'), '# A2');
  await writeFile(pathMod.join(dir, 'B.md'), '# B');
  await mkdir(pathMod.join(dir, 'A'));
  await writeFile(pathMod.join(dir, 'A', 'Kid.md'), '# Kid');
  const all = openTree(dir);
  assert.deepEqual((await all.listChildren(null)).map((i) => i.name), ['A', 'B']);
  const one = openTree(dir, { only: ['B.md'] });
  assert.deepEqual((await one.listChildren(null)).map((i) => i.name), ['B']);
  await rm(dir, { recursive: true, force: true });
});
