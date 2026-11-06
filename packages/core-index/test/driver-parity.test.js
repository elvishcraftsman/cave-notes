// The same workspace, indexed with each database driver, must give the same answers. This is a first, light version of the
// parity gate (the full core-index suite on both drivers comes with the Web Worker service in M2).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { openIndex } from '../src/index.js';
import { betterSqlite3Driver } from '../src/driver-better-sqlite3.js';
import { createSqliteWasmDriver } from '../src/driver-sqlite-wasm.js';

const sqlite3 = await sqlite3InitModule();

const FILES = {
  'Home.md': '---\nstatus: open\n---\n# Home\nWelcome. See [[Projects]] and [[Missing page]].\n',
  'Home/Ideas.md': '# Ideas\nRunning thoughts about cafés and [[Projects/Alpha]].\n',
  'Projects.md': '# Projects\nA list. Back to [[Home]].\n',
  'Projects/Alpha.md': '---\nstatus: done\ndue: 2026-11-05\n---\n# Alpha\nThe alpha project runs quickly. [link](../Home.md)\n',
  'Projects/Beta.md': '# Beta\nNothing to see.\n',
};

async function workspace() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cave-parity-'));
  for (const [rel, text] of Object.entries(FILES)) {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), text);
  }
  return root;
}

async function snapshot(driver, root) {
  const idx = await openIndex(root, { dbPath: ':memory:', driver });
  await idx.reconcile();
  const pages = idx.allPageRows().map((r) => r.path).sort();
  const hits = (q) => idx.search(q).results.map((r) => `${r.path} | ${r.snippet} | ${r.rank?.toPrecision(5)}`);
  const out = {
    pages,
    search: ['run', 'cafe', 'project', 'nothing', 'status:open', 'status:done'].map((q) => [q, hits(q)]),
    links: pages.map((p) => [p, idx.links(p).map((l) => `${l.kind}:${l.status}:${l.targetPath ?? l.target}`).sort()]),
    backlinks: pages.map((p) => [p, idx.backlinks(p).map((l) => `${l.fromPath}:${l.line}`).sort()]),
    attrs: JSON.stringify(idx.attributeKeys()),
    stats: JSON.stringify(idx.stats(), (k, v) => (k === 'dbBytes' || k === 'dbSize' ? undefined : v)),
  };
  idx.close();
  return out;
}

describe('the index gives the same answers on both database drivers', () => {
  it('better-sqlite3 and sqlite-wasm agree on pages, search, links, backlinks and attributes', async () => {
    const root = await workspace();
    try {
      const a = await snapshot(betterSqlite3Driver, root);
      const b = await snapshot(createSqliteWasmDriver(sqlite3), root);
      assert.ok(a.pages.length >= 5, `indexed ${a.pages.length} pages`);
      assert.ok(a.search.find(([q]) => q === 'run')[1].length > 0, 'search finds something');
      assert.ok(a.search.find(([q]) => q === 'status:done')[1].length > 0, 'attribute search finds something');
      assert.deepEqual(b, a);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
