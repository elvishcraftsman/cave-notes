import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { parse } from '@cave-notes/core-md';
import { openTree } from '@cave-notes/core-tree';
import { tmpRoot, ws, paths } from './helpers.js';

async function open(t, root, extra = {}) {
  const calls = { parse: 0 };
  const idx = await openIndex(root, {
    dbPath: ':memory:',
    parser: (text) => {
      calls.parse++;
      return parse(text);
    },
    ...extra,
  });
  t.after(() => idx.close());
  return { idx, calls };
}

const linkSummary = (idx, p) => idx.links(p).map((l) => [l.target || l.url, l.status, l.resolvedPage]);
const statuses = (idx, p) => idx.links(p).map((l) => l.status);

// ------------------------------------------------------------------ build

test('first build indexes pages, headings, titles, virtual pages and diagnostics', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Theology.md': '# Theology\n\n## Grace\n\n## Faith\n',
    'Theology/Grace.md': '---\ntitle: Grace (FM)\n---\nbody',
    'Untitled.md': 'no heading at all',
    'Bad.md': '---\nfoo: [unclosed\n---\n# Bad',
    'V/X.md': '# X',
  });
  const { idx } = await open(t, root);
  const s = await idx.reconcile();
  assert.deepEqual([s.added, s.virtual, s.changed, s.removed], [5, 1, 0, 0]);
  assert.equal(idx.getPage('Theology.md').title, 'Theology');
  assert.equal(idx.getPage('Theology/Grace.md').title, 'Grace (FM)');
  assert.equal(idx.getPage('Untitled.md').title, 'Untitled'); // falls back to the file name
  assert.equal(idx.getPage('V.md').isVirtual, true);
  assert.equal(idx.getPage('Nope.md'), null);
  assert.deepEqual(idx.headings('Theology.md').map((h) => [h.level, h.text, h.slug]), [
    [1, 'Theology', 'theology'],
    [2, 'Grace', 'grace'],
    [2, 'Faith', 'faith'],
  ]);
  assert.deepEqual(idx.diagnostics('Bad.md').map((d) => d.kind), ['frontmatter']);
  assert.equal(idx.stats().pages, 5);
});

// ------------------------------------------------------------------ incremental

test('incremental: only changed files are re-parsed; mtime-only changes are not', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '# A\nalpha', 'B.md': '# B\nbeta', 'C.md': '# C\ngamma' });
  const { idx, calls } = await open(t, root);
  await idx.reconcile();
  assert.equal(calls.parse, 3);

  const again = await idx.reconcile();
  assert.deepEqual([again.unchanged, calls.parse], [3, 3]);

  await w.touch('B.md'); // same content, new mtime
  const touched = await idx.reconcile();
  assert.deepEqual([touched.touched, touched.changed, calls.parse], [1, 0, 3]);

  await w.write('B.md', '# B\nbeta delta');
  await w.touch('B.md', 20);
  const changed = await idx.reconcile();
  assert.deepEqual([changed.changed, changed.unchanged, calls.parse], [1, 2, 4]);
  assert.deepEqual(paths(idx.search('delta')), ['B.md']);
  assert.deepEqual(paths(idx.search('beta')), ['B.md']);
});

test('deleting a page removes it, breaks inbound links, and recreating it heals them', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '# A\n[[B]] and [b](B.md)', 'B.md': '# B\ntext' });
  const { idx, calls } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'A.md'), ['ok', 'ok']);

  await w.rm('B.md');
  const s = await idx.reconcile();
  assert.equal(s.removed, 1);
  assert.deepEqual(statuses(idx, 'A.md'), ['broken', 'broken']);
  assert.deepEqual(paths(idx.search('text')), []);
  assert.equal(idx.stats().brokenLinks, 2);

  const parsesBefore = calls.parse;
  await w.write('B.md', '# B\nback again');
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'A.md'), ['ok', 'ok']);
  assert.equal(calls.parse, parsesBefore + 1); // A.md was not re-parsed to heal its links
});

test('moving pages: content-identical files are moved in the index without re-parsing', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'A.md': '# A\n[kid](A/Kid.md)',
    'A/Kid.md': '# Kid\nkid text',
    'Dest.md': '# Dest',
    'Z.md': '# Z\n[a](A.md)',
  });
  const { idx, calls } = await open(t, root);
  await idx.reconcile();
  const idBefore = idx.getPage('A/Kid.md').id;
  const parsesBefore = calls.parse;

  await openTree(root).movePage('A.md', 'Dest.md');
  const s = await idx.reconcile();
  assert.deepEqual([s.moved, s.removed, s.added, calls.parse], [2, 0, 0, parsesBefore]);
  assert.equal(idx.getPage('Dest/A/Kid.md').id, idBefore);
  assert.equal(idx.getPage('A/Kid.md'), null);
  assert.deepEqual(paths(idx.search('kid text')), ['Dest/A/Kid.md']);
  // A's relative link still lands on its child; Z's link to the old location is now broken.
  assert.deepEqual(linkSummary(idx, 'Dest/A.md'), [['A/Kid.md', 'ok', 'Dest/A/Kid.md']]);
  assert.deepEqual(statuses(idx, 'Z.md'), ['broken']);
});

test('renaming a page whose title is its file name updates the title and wiki links', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'Old.md': 'no heading', 'Ref.md': '# Ref\n[[Old]] [[New]]' });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'Ref.md'), ['ok', 'broken']);

  await openTree(root).renamePage('Old.md', 'New');
  await idx.reconcile();
  assert.equal(idx.getPage('New.md').title, 'New');
  assert.deepEqual(statuses(idx, 'Ref.md'), ['broken', 'ok']);
  assert.deepEqual(paths(idx.search('title:new')), ['New.md']);
});

test('changing a page title re-resolves wiki links that used the old/new title', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'p1.md': '# Alpha', 'Ref.md': '[[Alpha]] [[Beta]]' });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'Ref.md'), ['ok', 'broken']);
  await w.write('p1.md', '# Gamma');
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'Ref.md'), ['broken', 'broken']);
  await w.write('p1.md', '# Beta');
  await w.touch('p1.md', 30);
  await idx.reconcile();
  assert.deepEqual(statuses(idx, 'Ref.md'), ['broken', 'ok']);
});

test('a page whose file is deleted but folder remains becomes virtual; recreating makes it real', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'P.md': '# P\nreal text', 'P/Kid.md': '# Kid' });
  const { idx } = await open(t, root);
  await idx.reconcile();
  await w.rm('P.md');
  await idx.reconcile();
  assert.equal(idx.getPage('P.md').isVirtual, true);
  assert.deepEqual(paths(idx.search('real')), []);
  await w.write('P.md', '# P again\nreal text');
  await idx.reconcile();
  assert.equal(idx.getPage('P.md').isVirtual, false);
  assert.deepEqual(paths(idx.search('real')), ['P.md']);
});

// ------------------------------------------------------------------ link resolution

test('link resolution: relative, root-relative, parent, broken, same-page, web/file/other', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Top.md': '# Top',
    'A/B.md': '# B',
    'A/B/C.md': [
      '# C',
      '[up](../../Top.md)',
      '[sib](../B.md)',
      '[root](/Top.md)',
      '[out](../../../escape.md)',
      '[gone](Nope.md)',
      '[here](#c)',
      '[w](https://example.com)',
      '[f](../doc.pdf)',
      '[bad](javascript:alert(1))',
    ].join('\n\n'),
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(
    idx.links('A/B/C.md').map((l) => [l.kind, l.status, l.resolvedPage ?? l.targetPath]),
    [
      ['page', 'ok', 'Top.md'],
      ['page', 'ok', 'A/B.md'],
      ['page', 'ok', 'Top.md'],
      ['page', 'broken', '../escape.md'],
      ['page', 'broken', 'A/B/Nope.md'],
      ['page', 'ok', 'A/B/C.md'],
      ['web', 'external', null],
      ['file', 'file', 'A/doc.pdf'],
      ['other', 'external', null],
    ],
  );
});

test('wikilink resolution: stem, title, alias, path forms, case-insensitive, fragments', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Theology/Grace.md': '---\naliases: [Charis]\n---\n# Grace',
    'Notes/Idea.md': '# A Fancy Title',
    'Src.md': '[[grace]] [[Charis]] [[A Fancy Title]] [[Theology/Grace]] [[Grace#Sub|alias]] [[Idea]] [[Nothing]]',
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(linkSummary(idx, 'Src.md'), [
    ['grace', 'ok', 'Theology/Grace.md'],
    ['Charis', 'ok', 'Theology/Grace.md'],
    ['A Fancy Title', 'ok', 'Notes/Idea.md'],
    ['Theology/Grace', 'ok', 'Theology/Grace.md'],
    ['Grace', 'ok', 'Theology/Grace.md'],
    ['Idea', 'ok', 'Notes/Idea.md'],
    ['Nothing', 'broken', null],
  ]);
  assert.equal(idx.links('Src.md')[4].fragment, 'Sub');
});

test('wikilink ambiguity: closest page wins, exact tie is reported as ambiguous', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'X/Intro.md': '# Intro X',
    'Y/Intro.md': '# Intro Y',
    'X/Page.md': '[[Intro]]', // sibling of X/Intro: closest
    'Z/Page.md': '[[Intro]]', // equidistant from X and Y
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(linkSummary(idx, 'X/Page.md'), [['Intro', 'ok', 'X/Intro.md']]);
  assert.deepEqual(linkSummary(idx, 'Z/Page.md'), [['Intro', 'ambiguous', null]]);
  assert.equal(idx.stats().ambiguousLinks, 1);
  assert.deepEqual(paths(idx.search('is:ambiguous')), ['Z/Page.md']);
});

// ------------------------------------------------------------------ backlinks

test('backlinks list sources with line numbers and exclude self-links', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Target.md': '# Target\n[[Target]] self',
    'One.md': 'intro\n\n[[Target]]',
    'Two.md': '[t](Target.md)',
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(idx.backlinks('Target.md').map((b) => [b.fromPath, b.line]), [['One.md', 3], ['Two.md', 1]]);
});

// ------------------------------------------------------------------ refresh

test('refresh(paths) re-indexes just those pages, handles deletes and new nested pages', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'A.md': '# A', 'B.md': '# B', 'D.md': '# D', 'D/Kid.md': '# Kid' });
  const { idx, calls } = await open(t, root);
  await idx.reconcile();

  await w.write('A.md', '# A\nchanged');
  await w.touch('A.md');
  let s = await idx.refresh(['A.md']);
  assert.deepEqual([s.changed, calls.parse], [1, 5]);
  assert.deepEqual(paths(idx.search('changed')), ['A.md']);

  await w.rm('D.md');
  await w.rm('D');
  s = await idx.refresh(['D.md']);
  assert.equal(s.removed, 2); // D and its child
  assert.equal(idx.getPage('D/Kid.md'), null);

  await w.write('New/Deep/Page.md', '# Deep');
  await idx.refresh(['New/Deep/Page.md']);
  assert.equal(idx.getPage('New.md').isVirtual, true);
  assert.equal(idx.getPage('New/Deep.md').isVirtual, true);
  assert.equal(idx.getPage('New/Deep/Page.md').isVirtual, false);

  await idx.refresh(['../evil.md', 'not-md.txt', '']); // invalid paths are ignored
});

// ------------------------------------------------------------------ persistence & rebuild

test('on-disk index persists: reopening finds everything unchanged', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '# A\n[[B]]', 'B.md': '# B' });
  let idx = await openIndex(root);
  await idx.reconcile();
  await idx.close();

  idx = await openIndex(root);
  t.after(() => idx.close());
  const s = await idx.reconcile();
  assert.deepEqual([s.unchanged, s.added, s.changed], [2, 0, 0]);
  assert.deepEqual(linkSummary(idx, 'A.md'), [['B', 'ok', 'B.md']]);
  assert.deepEqual(paths(idx.search('title:a')), ['A.md']);
});

test('a schema-version mismatch drops the cache and rebuilds', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).write('A.md', '# A');
  let idx = await openIndex(root);
  await idx.reconcile();
  idx.db.pragma('user_version = 999');
  await idx.close();

  idx = await openIndex(root);
  t.after(() => idx.close());
  assert.equal(idx.stats().pages, 0); // cache was reset
  const s = await idx.reconcile();
  assert.equal(s.added, 1);
});

test('rebuild() clears and re-indexes everything', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '# A', 'B.md': '# B' });
  const { idx } = await open(t, root);
  await idx.reconcile();
  const s = await idx.rebuild();
  assert.equal(s.added, 2);
});

// ------------------------------------------------------------------ worker pool

test('parsing in worker threads gives the same index as in-process parsing', async (t) => {
  const root = await tmpRoot(t);
  const files = {};
  for (let i = 0; i < 40; i++) {
    files[`Dir${i % 4}/Page${i}.md`] = `---\nn: ${i}\ntags: [t${i % 3}]\n---\n# Page ${i}\n\nSee [[Page${(i + 1) % 40}]] and [x](../Dir0/Page0.md).`;
  }
  await ws(root).writeAll(files);
  const { idx: inline } = await open(t, root);
  await inline.reconcile();
  const pooled = await openIndex(root, { dbPath: ':memory:', workers: 3 });
  t.after(() => pooled.close());
  await pooled.reconcile();
  assert.deepEqual(pooled.stats(), inline.stats());
  assert.deepEqual(pooled.links('Dir1/Page1.md'), inline.links('Dir1/Page1.md'));
  assert.deepEqual(paths(pooled.search('tags:t1 sort:-n')), paths(inline.search('tags:t1 sort:-n')));
});

// ------------------------------------------------------------------ tree integration

test('frontmatter `order` feeds core-tree sorting through the index', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({
    'Alpha.md': '# Alpha',
    'Beta.md': '---\norder: 1\n---\n# Beta',
    'Gamma.md': '---\norder: 0.5\n---\n# G',
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  const items = await idx.tree.listChildren(null);
  assert.deepEqual(items.map((i) => i.name), ['Gamma', 'Beta', 'Alpha']);
});

// ------------------------------------------------------------------ explicit wikilink anchors

test('wikilink anchors: "/path" is from the workspace root; "./x" and "../x" are relative to the page', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Top.md': '# Top',
    'A/Top.md': '# A Top',
    'A/B/Page.md': '[[/Top]] [[/A/Top]] [[../Top]] [[./Page]] [[../../Top]] [[/Nope]] [[../../../out]]',
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(linkSummary(idx, 'A/B/Page.md'), [
    ['/Top', 'ok', 'Top.md'],
    ['/A/Top', 'ok', 'A/Top.md'],
    ['../Top', 'ok', 'A/Top.md'],
    ['./Page', 'ok', 'A/B/Page.md'],
    ['../../Top', 'ok', 'Top.md'],
    ['/Nope', 'broken', null],
    ['../../../out', 'broken', null],
  ]);
});

test('findLinkers matches page links, folder attachments and wikilinks by last path segment', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({
    'Target.md': '# Target',
    'Foo.md': '# Foo',
    'ByMd.md': '[t](Target.md)',
    'ByWiki.md': '[[Target]]',
    'ByPathWiki.md': '[[some/where/Target]]',
    'Attach.md': '![i](Foo/pic.png)',
    'Unrelated.md': '[[Other]] [x](https://example.com)',
  });
  const { idx } = await open(t, root);
  await idx.reconcile();
  assert.deepEqual(idx.findLinkers({ paths: ['Target.md'], names: ['Target'] }), ['ByMd.md', 'ByPathWiki.md', 'ByWiki.md']);
  assert.deepEqual(idx.findLinkers({ folderPrefix: 'Foo/' }), ['Attach.md']);
  assert.deepEqual(idx.findLinkers({}), []);
});
