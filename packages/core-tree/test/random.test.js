import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openTree } from '../src/index.js';
import { tmpWorkspace, snapshot, readAllMd, collect } from './helpers.js';

// Small seeded PRNG so failures are reproducible.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['a', 'b', 'c', 'A', 'B', 'd e', 'ü', 'x1', 'x10'];
const EXPECTED_ERRORS = new Set(['COLLISION', 'MOVE_INTO_SELF', 'HAS_CHILDREN']);

async function checkInvariants(root, tree) {
  const snap = await snapshot(root);
  const set = new Set(snap);

  // 1. No page keeps an empty folder around.
  for (const entry of snap) {
    if (!entry.endsWith('/')) continue;
    const dir = entry.slice(0, -1);
    if (set.has(`${dir}.md`)) {
      const hasKids = snap.some((e) => e.startsWith(entry) && e !== entry);
      assert.ok(hasKids, `empty folder left behind: ${entry}`);
    }
  }

  // 2. Every .md on disk is visible through the tree, and every listed page resolves.
  const listed = await collect(tree.allPages());
  const listedReal = new Set(listed.filter((p) => p.exists).map((p) => p.path));
  const onDisk = snap.filter((e) => e.endsWith('.md'));
  assert.deepEqual([...listedReal].sort(), onDisk.sort());
  for (const p of listed) assert.notEqual(await tree.status(p.path), null, `unresolvable: ${p.path}`);
}

test('random operation sequences preserve content and structural invariants', async (t) => {
  for (const seed of [1, 2, 3, 42, 1337]) {
    const rand = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const root = await tmpWorkspace(t);
    const tree = openTree(root);
    let nextId = 0;

    for (let step = 0; step < 150; step++) {
      const pages = await collect(tree.allPages());
      const before = await readAllMd(root);
      const snapBefore = await snapshot(root);
      const op = pick(['create', 'create', 'move', 'rename', 'delete']);
      const target = pages.length ? pick(pages).path : null;
      const label = `seed ${seed} step ${step} ${op}`;

      try {
        if (op === 'create') {
          const parent = pages.length && rand() < 0.8 ? pick(pages).path : null;
          const id = `id${nextId++}`;
          const created = await tree.createPage(parent, pick(NAMES), id);
          const after = await readAllMd(root);
          assert.equal(after.get(created), id, label);
        } else if (op === 'move' && target) {
          const dest = rand() < 0.2 ? null : pick(pages).path;
          const res = await tree.movePage(target, dest);
          const after = await readAllMd(root);
          for (const m of res.pageMoves.filter((x) => x.exists)) {
            assert.equal(after.get(m.to), before.get(m.from), `${label}: ${m.from} -> ${m.to}`);
            if (m.to !== m.from) assert.equal(after.has(m.from) && !res.pageMoves.some((o) => o.to === m.from), false, label);
          }
          assert.equal(after.size, before.size, label);
        } else if (op === 'rename' && target) {
          const res = await tree.renamePage(target, pick(NAMES));
          const after = await readAllMd(root);
          for (const m of res.pageMoves.filter((x) => x.exists)) {
            assert.equal(after.get(m.to), before.get(m.from), label);
          }
          assert.equal(after.size, before.size, label);
        } else if (op === 'delete' && target) {
          const res = await tree.deletePage(target, { recursive: rand() < 0.5 });
          const after = await readAllMd(root);
          const gone = res.removed.filter((r) => r.exists).map((r) => r.path);
          assert.equal(after.size, before.size - gone.length, label);
          for (const p of gone) assert.equal(after.has(p), false, label);
        }
      } catch (e) {
        if (e?.name === 'TreeError' && EXPECTED_ERRORS.has(e.code)) {
          // A rejected operation must leave the workspace untouched.
          assert.deepEqual(await snapshot(root), snapBefore, `${label}: ${e.code} changed state`);
          assert.deepEqual([...(await readAllMd(root))], [...before], label);
        } else {
          throw new Error(`${label}: ${e?.stack ?? e}`);
        }
      }
      await checkInvariants(root, tree);
    }
  }
});
