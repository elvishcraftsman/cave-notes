// Usage: node bench/bench.js [topics=10] [subs=30] [pagesPerSub=30] [workers=auto]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openIndex } from '../src/index.js';

const [topics = 10, subs = 30, per = 30, workersArg] = process.argv.slice(2).map(Number);
const workers = Number.isFinite(workersArg) ? workersArg : Math.max(1, os.cpus().length - 1);

// Deterministic pseudo-random text.
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const letters = 'etaoinshrdlucmfwypvbgkjqxz';
const randomWord = () => Array.from({ length: 3 + Math.floor(rnd() * 7) }, () => letters[Math.floor(rnd() ** 1.6 * letters.length)]).join('');
const vocab = [...new Set(Array.from({ length: 6000 }, randomWord))];
const words = (n) => Array.from({ length: n }, () => vocab[Math.floor(rnd() ** 2 * vocab.length)]).join(' ');
const STATUS = ['idea', 'draft', 'review', 'done'];

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-bench-'));
const pageNames = [];
for (let a = 0; a < topics; a++) for (let b = 0; b < subs; b++) for (let c = 0; c < per; c++) pageNames.push([a, b, c]);

async function write(rel, text) {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
}

const pick = () => pageNames[Math.floor(rnd() * pageNames.length)];
const t0 = performance.now();
let count = 0;
for (let a = 0; a < topics; a++) {
  await write(`Topic${a}.md`, `# Topic ${a}\n\n${words(60)}\n`);
  for (let b = 0; b < subs; b++) {
    await write(`Topic${a}/Sub${b}.md`, `# Sub ${a}.${b}\n\n${words(60)}\n`);
    for (let c = 0; c < per; c++) {
      const l1 = pick();
      const l2 = pick();
      await write(
        `Topic${a}/Sub${b}/Page${c}.md`,
        `---\nstatus: ${STATUS[Math.floor(rnd() * 4)]}\ntags: [t${Math.floor(rnd() * 20)}, t${Math.floor(rnd() * 20)}]\ndue: 2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15\nweight: ${Math.floor(rnd() * 100)}\n---\n` +
          `# Page ${a}.${b}.${c}\n\n${words(90)}\n\n## Details\n\n${words(90)} [[Page ${l1.join('.')}]] and [rel](../../Topic${l2[0]}/Sub${l2[1]}/Page${l2[2]}.md)\n\n## More\n\n- ${words(8)}\n- ${words(8)}\n\n${words(60)}\n`,
      );
      count++;
    }
  }
}
// Wikilinks above use titles ("Page a.b.c"), which resolve through the title lookup.
console.log(`generated ${count + topics + topics * subs} pages in ${((performance.now() - t0) / 1000).toFixed(1)}s (workers=${workers})`);

const time = async (label, fn) => {
  const s = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(44)} ${(performance.now() - s).toFixed(1).padStart(9)} ms`);
  return r;
};
const timeMany = (label, fn, n = 50) => {
  fn(0);
  const s = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  console.log(`${label.padEnd(44)} ${((performance.now() - s) / n).toFixed(2).padStart(9)} ms/query`);
};

if (process.env.BENCH_ONLY_BUILD) {
  const i = await openIndex(root, { workers });
  await i.reconcile();
  await i.close();
  console.log('kept', root);
  process.exit(0);
}
const idx = await openIndex(root, { workers });
await time('cold build (parse + index everything)', () => idx.reconcile());
console.log(JSON.stringify(idx.stats()));
const dbSize = (await fs.stat(path.join(root, '.cave-notes', 'index.db'))).size;
console.log(`index.db: ${(dbSize / 1e6).toFixed(1)} MB`);

await time('reconcile, nothing changed', () => idx.reconcile());

// Single-file edit
const edited = 'Topic1/Sub2/Page3.md';
const original = await fs.readFile(path.join(root, edited), 'utf8');
await fs.writeFile(path.join(root, edited), `${original}\nedited marker zzzmarker\n`);
await time('refresh one edited file', () => idx.refresh([edited]));

timeMany('search: one word', (i) => idx.search(vocab[(i * 7 + 3) % 400], { limit: 50 }));
timeMany('search: two words', (i) => idx.search(`${vocab[i % 40]} ${vocab[(i % 25) + 40]}`, { limit: 50 }));
timeMany('search: prefix while typing', (i) => idx.search(vocab[i % 30].slice(0, 3), { limit: 50 }));
timeMany('filter: status', () => idx.search('status:draft', { limit: 50 }));
timeMany('filter: status + tag + weight range', () => idx.search('status:draft,review tags:t3 weight:10..60', { limit: 50 }));
timeMany('filter: date range + sort', () => idx.search('due:2026-03-01..2026-06-30 sort:-weight', { limit: 50 }));
timeMany('text + filters', (i) => idx.search(`${vocab[i % 20]} status:done sort:-due`, { limit: 50 }));
timeMany('under: subtree', () => idx.search('under:Topic3', { limit: 50 }));
timeMany('links-to + is:orphan', () => idx.search('links-to:"Page 1.2.3"', { limit: 50 }));
timeMany('is:orphan', () => idx.search('is:orphan', { limit: 50 }), 10);
timeMany('facet: status counts within a query', () => idx.attributeValues('status', { query: 'under:Topic2' }), 20);
timeMany('backlinks of one page', () => idx.backlinks('Topic1/Sub2/Page3.md'));
timeMany('headings of one page', () => idx.headings('Topic1/Sub2/Page3.md'));

await idx.close();
if (process.env.BENCH_KEEP) console.log('kept', root);
else await fs.rm(root, { recursive: true, force: true });
