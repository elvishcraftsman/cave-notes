// Builds data/thesaurus.txt, one line per word: `word:synonym,synonym,...` (best first).
//
//   node scripts/build-data.mjs <mthesaur.txt> <COMMON.TXT> <wordnet dict folder>
//
// Sources (see README.md for where to get them):
//   WordNet 3.0 (Princeton University): synonyms grouped by sense, the commonest sense first. These lead each list.
//   Moby Thesaurus II (Grady Ward, public domain): far more terms, but every sense of a word mixed together. Its terms follow
//   WordNet's, ranked by how much the two words' lists overlap and whether each lists the other, and only when they are
//   common words (Moby Words II COMMON.TXT). Phrases, hyphenated terms and capitalised words are left out.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 12;
const [mobyFile, commonFile, wnDir] = process.argv.slice(2);
if (!wnDir) throw new Error('usage: node scripts/build-data.mjs mthesaur.txt COMMON.TXT wordnet/dict');
const SINGLE = /^[a-z]{2,}$/;
const common = new Set(readFileSync(commonFile, 'latin1').split(/\r?\n/).map((s) => s.trim().toLowerCase()));

// ---- WordNet
const POS = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
const synsets = new Map(); // "pos:offset" -> { words: string[], similar: string[] }
const lemmas = new Map(); // word -> Array<{ pos, tags, offsets }>
for (const [p, file] of Object.entries(POS)) {
  for (const line of readFileSync(join(wnDir, `data.${file}`), 'latin1').split(/\r?\n/)) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.split('|')[0].trim().split(/\s+/);
    const wc = parseInt(f[3], 16);
    const words = [];
    for (let i = 0; i < wc; i++) words.push(f[4 + i * 2].replace(/\(.*\)$/, '').toLowerCase());
    let k = 4 + wc * 2;
    const pc = parseInt(f[k++], 10);
    const similar = [];
    for (let i = 0; i < pc; i++, k += 4) if (f[k] === '&') similar.push(`${f[k + 2]}:${f[k + 1]}`);
    synsets.set(`${p === 'a' && f[2] === 's' ? 'a' : p}:${f[0]}`, { words, similar });
  }
  for (const line of readFileSync(join(wnDir, `index.${file}`), 'latin1').split(/\r?\n/)) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.split(/\s+/);
    const pc = parseInt(f[3], 10);
    const rest = f.slice(4 + pc); // sense_cnt tagsense_cnt offsets...
    const entry = { pos: p, tags: parseInt(rest[1], 10), offsets: rest.slice(2).filter(Boolean) };
    const word = f[0].toLowerCase();
    (lemmas.get(word) ?? lemmas.set(word, []).get(word)).push(entry);
  }
}
/** WordNet's synonyms of a word with how early each first appears (0 is the commonest sense) */
const fromWordNet = (word) => {
  const senses = [...(lemmas.get(word) ?? [])].sort((a, b) => b.tags - a.tags);
  const found = new Map();
  let n = 0;
  for (const s of senses) for (const off of s.offsets) {
    const ss = synsets.get(`${s.pos}:${off}`) ?? synsets.get(`a:${off}`);
    if (!ss) continue;
    for (const w of ss.words) if (!found.has(w)) found.set(w, n);
    for (const sim of ss.similar) { const [pp, o] = sim.split(':'); for (const w of synsets.get(`${pp}:${o}`)?.words ?? []) if (!found.has(w)) found.set(w, n + 0.5); }
    n++;
  }
  return found;
};

// ---- Moby
const ids = new Map();
const names = [];
const id = (w) => {
  let n = ids.get(w);
  if (n === undefined) { n = names.length; ids.set(w, n); names.push(w); }
  return n;
};
const entries = new Map();
for (const line of readFileSync(mobyFile, 'latin1').split(/\r?\n/)) {
  if (!line) continue;
  const [root, ...rest] = line.split(',');
  entries.set(id(root.trim().toLowerCase()), new Set(rest.map((w) => id(w.trim().toLowerCase()))));
}
/** Moby's terms for a word, each scored by whether it lists the word back and how much the two lists overlap */
const fromMoby = (word) => {
  const w = ids.get(word);
  const set = w === undefined ? undefined : entries.get(w);
  const found = new Map();
  if (!set) return found;
  for (const s of set) {
    const syn = names[s];
    const theirs = entries.get(s);
    if (!SINGLE.test(syn) || syn === word || !theirs) continue;
    let shared = 0;
    for (const x of set) if (theirs.has(x)) shared++;
    found.set(syn, (theirs.has(w) ? 1 : 0) + (2 * shared) / (set.size + theirs.size - shared));
  }
  return found;
};

// ---- merge
const roots = new Set([...lemmas.keys(), ...[...entries.keys()].map((i) => names[i])]);
const out = [];
for (const word of roots) {
  if (!SINGLE.test(word)) continue;
  if (!common.has(word) && ids.get(word) === undefined) continue; // an obscure WordNet-only word
  const wn = fromWordNet(word);
  const moby = fromMoby(word);
  const scored = [];
  for (const syn of new Set([...wn.keys(), ...moby.keys()])) {
    if (!SINGLE.test(syn) || syn === word) continue;
    const inWn = wn.has(syn);
    if (!inWn && !common.has(syn)) continue; // Moby's rare terms are noise
    // agreement of the two sources is the strongest sign; a WordNet term scores more the earlier its sense
    scored.push([(moby.get(syn) ?? 0) + (inWn ? 1.2 / (1 + wn.get(syn) * 0.6) : 0) + (inWn && moby.has(syn) ? 0.8 : 0) + (common.has(syn) ? 0.3 : 0), syn]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  const list = scored.slice(0, KEEP).map((x) => x[1]);
  if (list.length) out.push(`${word}:${list.join(',')}`);
}
out.sort();
// the words WordNet knows as verbs: an -ing or -ed word is inflected from its base only when the base is a verb
const verbs = [...lemmas].filter(([w, l]) => SINGLE.test(w) && l.some((e) => e.pos === 'v')).map(([w]) => w).sort();
writeFileSync(new URL('../data/thesaurus.txt', import.meta.url), `#v:${verbs.join(',')}\n` + out.join('\n') + '\n');
console.log(`${out.length} words`);
