import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openTree } from '@cave-notes/core-tree';
import { openIndex } from '@cave-notes/core-index';

export async function setup(t, files = {}, indexOpts = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const abs = (rel) => path.join(root, ...rel.split('/'));
  const w = {
    abs,
    async write(rel, content) {
      await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
      await fs.writeFile(abs(rel), content);
    },
    read: (rel) => fs.readFile(abs(rel), 'utf8'),
    exists: (rel) => fs.access(abs(rel)).then(() => true, () => false),
  };
  for (const [rel, c] of Object.entries(files)) await w.write(rel, c);
  const tree = openTree(root);
  const index = await openIndex(root, { dbPath: ':memory:', ...indexOpts });
  t.after(() => index.close());
  await index.reconcile();
  return { root, w, tree, index };
}

/** Every file under root (excluding .cave-notes) as { path: content }. */
export async function readAll(root) {
  const out = {};
  async function walk(dir, rel) {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (d.name === '.cave-notes') continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        out[`${r}/`] = null;
        await walk(path.join(dir, d.name), r);
      } else out[r] = await fs.readFile(path.join(dir, d.name), 'utf8');
    }
  }
  await walk(root, '');
  return out;
}

export async function rejectsWith(assert, promise, code) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}
