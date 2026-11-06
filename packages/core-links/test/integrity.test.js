import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { planMove, applyPlan, undo } from '../src/index.js';
import { setup, readAll } from './helpers.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// A small pool of names so duplicate stems appear in different folders (ambiguity!).
const NAMES = ['alpha', 'beta', 'gamma', 'Intro', 'Notes', 'Idea', 'x1', 'My Page'];

/** Random tree of pages. Returns [{ path, id, title }] */
function planPages(rand, count) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pages = [];
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const parent = pages.length && rand() < 0.75 ? pick(pages) : null;
      const name = pick(NAMES);
      const dir = parent ? `${parent.path.slice(0, -3)}/` : '';
      const p = `${dir}${name}.md`;
      if ([...taken].some((q) => q.toLowerCase() === p.toLowerCase())) continue;
      // A page cannot sit in a folder named like a sibling page that is a leaf-vs-folder clash; trees handle it.
      taken.add(p);
      pages.push({ path: p, id: `p${i}`, title: rand() < 0.7 ? `Title ${i}` : null });
      break;
    }
  }
  return pages;
}

/** One random link to `target`, written from a page at `from`. */
function randomLink(rand, from, target) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const style = pick(['md', 'md-dot', 'md-root', 'md-frag', 'wiki-stem', 'wiki-stem-md', 'wiki-title', 'wiki-root', 'wiki-rel', 'wiki-alias']);
  const rel = posix.relative(posix.dirname(from) === '.' ? '.' : posix.dirname(from), target.path);
  const enc = (s) => s.replace(/ /g, '%20');
  const stem = posix.basename(target.path, '.md');
  switch (style) {
    case 'md': return `[l](${enc(rel)})`;
    case 'md-dot': return `[l](${rel.startsWith('.') ? '' : './'}${enc(rel)})`;
    case 'md-root': return `[l](/${enc(target.path)})`;
    case 'md-frag': return `[l](${enc(rel)}#section)`;
    case 'wiki-stem': return `[[${stem}]]`;
    case 'wiki-stem-md': return `[[${stem}.md#h|shown]]`;
    case 'wiki-title': return target.title ? `[[${target.title}]]` : `[[${stem}]]`;
    case 'wiki-root': return `[[${target.path.slice(0, -3)}]]`;
    case 'wiki-rel': return `[[${posix.relative(posix.dirname(from) === '.' ? '.' : posix.dirname(from), target.path.slice(0, -3))}]]`;
    default: return `![[${stem}|alias]]`;
  }
}

function pageText(rand, page, pages) {
  const n = Math.floor(rand() * 6);
  const links = [];
  for (let i = 0; i < n; i++) links.push(randomLink(rand, page.path, pages[Math.floor(rand() * pages.length)]));
  return [
    '---',
    `id: ${page.id}`,
    '---',
    page.title ? `# ${page.title}` : '',
    '',
    ...links.map((l, i) => `Line ${i}: ${l}`),
    '',
  ].join('\n');
}

/** For every page: its page-links as [status, targetId]. Keyed by the page's id. */
function graph(index) {
  const idOf = new Map();
  const real = index.allPageRows().filter((r) => !r.isVirtual);
  for (const r of real) idOf.set(r.path, index.getPage(r.path).attributes.id?.[0].text);
  const out = {};
  for (const r of real) {
    out[idOf.get(r.path)] = index
      .links(r.path)
      .filter((l) => l.kind === 'page')
      .map((l) => [l.status, l.resolvedPage ? idOf.get(l.resolvedPage) : null, `${r.path} :: ${l.syntax} '${l.raw}' -> ${l.resolvedPage}`]);
  }
  return out;
}

function assertNoRegression(before, after, label) {
  for (const [id, links] of Object.entries(before)) {
    assert.equal(after[id]?.length, links.length, `${label}: link count changed in ${id}`);
    links.forEach(([status, target, desc], i) => {
      if (status !== 'ok') return;
      assert.deepEqual(after[id][i].slice(0, 2), ['ok', target], `${label}\n  BEFORE ${desc}\n  AFTER  ${after[id][i][2]}`);
    });
  }
}

test('random moves and renames never change where a working link points; undo restores everything', async (t) => {
  let totalOps = 0;
  let totalRewrites = 0;
  let totalWarnings = 0;
  const seedCount = Number(process.env.INTEGRITY_SEEDS ?? 8);
  for (const seed of Array.from({ length: seedCount }, (_, i) => i + 1)) {
    const rand = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const pages = planPages(rand, 24);
    const files = {};
    for (const p of pages) files[p.path] = pageText(rand, p, pages);
    const env = await setup(t, files);

    for (let step = 0; step < 18; step++) {
      const before = graph(env.index);
      const snapshot = await readAll(env.root);
      const all = [];
      for await (const p of env.tree.allPages()) all.push(p.path);
      const from = pick(all);
      const op = rand() < 0.5 ? 'move' : 'rename';
      const newParent = op === 'move' ? (rand() < 0.2 ? null : pick(all)) : undefined;
      const newName = op === 'rename' || rand() < 0.3 ? pick(NAMES) : undefined;
      const label = `seed ${seed} step ${step}: ${op} ${from} -> ${newParent === undefined ? '(same parent)' : newParent} name=${newName}`;

      let plan;
      try {
        const parent = op === 'rename' ? (posix.dirname(from) === '.' ? null : `${posix.dirname(from)}.md`) : newParent;
        plan = await planMove({ tree: env.tree, index: env.index, from, newParent: parent, newName });
      } catch (e) {
        if (e.name === 'TreeError') continue; // invalid move (collision, into itself, ...)
        throw new Error(`${label}: ${e.stack}`);
      }
      if (plan.noop) continue;

      await applyPlan(plan, { tree: env.tree, index: env.index });
      totalOps++;
      totalRewrites += plan.summary.linksRewritten;
      totalWarnings += plan.warnings.length;
      assertNoRegression(before, graph(env.index), label);

      if (step % 3 === 0) {
        await undo({ tree: env.tree, index: env.index });
        assert.deepEqual(await readAll(env.root), snapshot, `${label}: undo did not restore the workspace`);
        assertNoRegression(before, graph(env.index), `${label} (after undo)`);
      }
    }
  }
  // Make sure the test actually exercised the machinery.
  assert.ok(totalOps >= 60, `only ${totalOps} operations ran`);
  assert.ok(totalRewrites >= 40, `only ${totalRewrites} links were rewritten`);
  console.log(`# integrity: ${totalOps} operations, ${totalRewrites} links rewritten, ${totalWarnings} conversions warned`);
});
