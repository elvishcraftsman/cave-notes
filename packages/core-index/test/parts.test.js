import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { tmpRoot, ws } from './helpers.js';

/** A workspace with links in every direction, duplicate names, aliases, inheritance and folder-only pages. */
async function corpus(root) {
  const w = ws(root);
  const files = {};
  for (let d = 0; d < 6; d++) {
    for (let f = 0; f < 12; f++) {
      const pad = 'word '.repeat((d * 37 + f * 11) % 90);
      files[`Area ${d}/Note ${f}.md`] =
        `---\nstatus: s${f % 3}\n${f === 0 ? 'aliases: [Alias ' + d + ']\n' : ''}---\n# Note ${f} of ${d}\n\n${pad}\nSee [[Note ${(f + 1) % 12}]], [[Alias ${(d + 1) % 6}]], [[Area ${(d + 2) % 6}/Note 3]], [[Nowhere ${f}]] and [rel](../Area ${(d + 1) % 6}/Note ${f}.md).\n\n## Part ${f}\n\ntext\n`;
    }
  }
  files['Area 0.md'] = '---\nchildren:\n  kind: inherited\n---\n# Area 0\n';
  files['Area 2/Deep/Only In Folder/Leaf.md'] = '# Leaf\n\n[[Note 1]]\n';
  files['Top.md'] = '# Top\n\n[[Area 1]] [[Leaf]] [[Missing]]\n';
  await w.writeAll(files);
}

async function snapshot(idx) {
  const rows = idx.allPageRows().map((r) => ({ path: r.path, title: r.title, virtual: r.isVirtual, hash: r.hash })).sort((a, b) => a.path.localeCompare(b.path));
  const links = {};
  const back = {};
  for (const r of rows) {
    if (r.virtual === 2) continue;
    links[r.path] = idx.links(r.path).map((l) => [l.target ?? l.url, l.status, l.resolvedPage]);
    back[r.path] = idx.backlinks(r.path).map((b) => b.path ?? b.from ?? JSON.stringify(b)).sort();
  }
  const attrs = {};
  for (const r of rows) attrs[r.path] = JSON.stringify(idx.getPage(r.path)?.attrs ?? idx.getPage(r.path)?.attributes ?? null);
  return { rows, links, back, attrs, stats: idx.stats() };
}

test('indexing in parts gives exactly the same index as one big batch', async (t) => {
  const root = await tmpRoot(t);
  await corpus(root);
  const one = await openIndex(root, { dbPath: ':memory:', partFiles: Infinity });
  const parts = await openIndex(root, { dbPath: ':memory:', partFiles: 7, partBytes: 600 });
  t.after(() => Promise.all([one.close(), parts.close()]));
  const seen = [];
  const withProgress = await openIndex(root, { dbPath: ':memory:', partFiles: 7, partBytes: 600, onProgress: (p) => seen.push(p) });
  t.after(() => withProgress.close());

  const a = await one.reconcile();
  const b = await parts.reconcile();
  await withProgress.reconcile();
  assert.equal(b.added, a.added);
  assert.equal(b.virtual, a.virtual);
  assert.ok(seen.length > 3, `expected several parts, got ${seen.length}`);
  assert.deepEqual(await snapshot(parts), await snapshot(one));
  assert.deepEqual(await snapshot(withProgress), await snapshot(one));

  // a second reconcile finds nothing to do, in both
  assert.equal((await parts.reconcile()).unchanged, a.added);
});

test('removals in the same pass keep the single-batch path (moves are still detected)', async (t) => {
  const root = await tmpRoot(t);
  await corpus(root);
  const idx = await openIndex(root, { dbPath: ':memory:', partFiles: 5, partBytes: 600 });
  t.after(() => idx.close());
  await idx.reconcile();
  const w = ws(root);
  const text = await w.read('Area 3/Note 5.md');
  await w.rm('Area 3/Note 5.md');
  await w.write('Area 3/Renamed.md', text);
  const st = await idx.reconcile();
  assert.equal(st.moved, 1);
});
