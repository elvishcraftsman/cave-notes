// Usage: node bench/bench.js [topics=10] [subs=30] [pagesPerSub=30]
// Builds a workspace with cross-links, then times planning, applying and undoing big subtree moves.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openTree } from '@cave-notes/core-tree';
import { openIndex } from '@cave-notes/core-index';
import { planMove, applyPlan, undo } from '../src/index.js';

const [topics = 10, subs = 30, per = 30] = process.argv.slice(2).map(Number);

let seed = 11;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-links-bench-'));
const all = [];
for (let a = 0; a < topics; a++) for (let b = 0; b < subs; b++) for (let c = 0; c < per; c++) all.push([a, b, c]);
const pick = () => all[Math.floor(rnd() * all.length)];
const write = async (rel, text) => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
};

for (let a = 0; a < topics; a++) {
  await write(`Topic${a}.md`, `# Topic ${a}\n\n${Array.from({ length: subs }, (_, b) => `[s](Topic${a}/Sub${b}.md)`).join(' ')}\n`);
  for (let b = 0; b < subs; b++) {
    await write(`Topic${a}/Sub${b}.md`, `# Sub ${a}.${b}\n`);
    for (let c = 0; c < per; c++) {
      const links = Array.from({ length: 4 }, () => {
        const t = pick();
        const rel = `../../Topic${t[0]}/Sub${t[1]}/Page${t[2]}.md`;
        return rnd() < 0.5 ? `[l](${rel})` : `[[Page ${t.join('.')}]]`;
      });
      await write(`Topic${a}/Sub${b}/Page${c}.md`, `---\nid: ${a}.${b}.${c}\n---\n# Page ${a}.${b}.${c}\n\n${links.join('\n\n')}\n`);
    }
    // each Sub page lists its children, each Topic page lists its Sub pages
    await write(`Topic${a}/Sub${b}.md`, `# Sub ${a}.${b}\n\n${Array.from({ length: per }, (_, c) => `[p](Sub${b}/Page${c}.md)`).join(' ')}\n`);
  }
}
const total = all.length + topics + topics * subs;

const tree = openTree(root);
const index = await openIndex(root, { workers: Math.max(1, os.cpus().length - 1) });
let t0 = performance.now();
await index.reconcile();
console.log(`${total} pages indexed in ${((performance.now() - t0) / 1000).toFixed(1)}s (${index.stats().links} links)`);

const time = async (label, fn) => {
  const s = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(46)} ${(performance.now() - s).toFixed(0).padStart(7)} ms`);
  return r;
};

async function scenario(name, from, newParent, newName, reconcile = true) {
  console.log(`\n== ${name}`);
  const before = index.stats().brokenLinks;
  const plan = await time('plan', () => planMove({ tree, index, from, newParent, newName, reconcile }));
  console.log(`   ${plan.summary.pagesMoved} pages move, ${plan.summary.filesEdited} files edited, ${plan.summary.linksRewritten} links rewritten, ${plan.summary.warnings} warnings`);
  await time('apply (edit files + move + reindex)', () => applyPlan(plan, { tree, index }));
  console.log(`   broken links: ${before} before, ${index.stats().brokenLinks} after`);
  await time('undo (move back + restore + reindex)', () => undo({ tree, index }));
  console.log(`   broken links after undo: ${index.stats().brokenLinks}`);
}

await scenario('rename one leaf page (full rescan first)', 'Topic3/Sub4/Page5.md', 'Topic3/Sub4.md', 'Renamed');
await scenario('rename one leaf page (index kept current by a watcher)', 'Topic3/Sub4/Page5.md', 'Topic3/Sub4.md', 'Renamed', false);
await scenario('move a 30-page branch to another topic', 'Topic3/Sub4.md', 'Topic5.md', 'Moved Branch', false);
await scenario('rename a 930-page topic (a tenth of the workspace)', 'Topic3.md', null, 'Renamed Topic', false);

await index.close();
await fs.rm(root, { recursive: true, force: true });
