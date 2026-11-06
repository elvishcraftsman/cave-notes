/**
 * Synonyms for one word at a time. The data (`data/thesaurus.txt`, one `word:syn,syn,...` line per word, best first) is made
 * by scripts/build-data.mjs from WordNet 3.0 and the Moby Thesaurus II; the text is handed in, so this works in the
 * browser and in tests alike.
 */

/** Words that are never offered synonyms: articles, prepositions, conjunctions, pronouns, auxiliaries and the like. */
const STOP = new Set(
  (
    'a an the and or but nor so yet for of in on at by to from with without within into onto upon over under above below about around ' +
    'across after before behind beside between beyond during except against among through throughout toward towards until up down off out ' +
    'near per via than as if then because since while although though unless whether either neither both not no nor ' +
    'i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves ' +
    'this that these those who whom whose which what where when why how whatever whoever whichever ' +
    'am is are was were be been being do does did done doing have has had having will would shall should can could may might must ' +
    'there here very too also just only even still such own same other another each every any all some more most much many few less least ' +
    'one two three four five six seven eight nine ten'
  ).split(' '),
);

/** Whether a word is too small to be worth a synonym menu. */
export function isStopWord(word: string): boolean {
  const w = word.toLowerCase();
  return STOP.has(w) || w.length < 3;
}

/** Give `replacement` the capitals of `original`: "Happy" -> "Glad", "HAPPY" -> "GLAD". */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) return replacement.toUpperCase();
  const first = original[0] ?? '';
  if (first !== first.toLowerCase() && first === first.toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

const VOWEL = /[aeiou]/;
const consonantY = (w: string): boolean => /[^aeiou]y$/.test(w);
/** one syllable ending consonant-vowel-consonant (stop -> stopped), not w, x or y */
const doubles = (w: string): boolean => /^[^aeiou]*[aeiou][bdgmnprt]$/.test(w) && w.length <= 5 && !/(.)\1$/.test(w);

const addS = (w: string): string => (consonantY(w) ? `${w.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`);
const addEd = (w: string): string => (w.endsWith('e') ? `${w}d` : consonantY(w) ? `${w.slice(0, -1)}ied` : doubles(w) ? `${w}${w.slice(-1)}ed` : `${w}ed`);
const addIng = (w: string): string => (w.endsWith('ie') ? `${w.slice(0, -2)}ying` : w.endsWith('e') && !w.endsWith('ee') ? `${w.slice(0, -1)}ing` : doubles(w) ? `${w}${w.slice(-1)}ing` : `${w}ing`);
const addLy = (w: string): string => (w.endsWith('le') ? `${w.slice(0, -1)}y` : consonantY(w) ? `${w.slice(0, -1)}ily` : w.endsWith('ic') ? `${w}ally` : `${w}ly`);
const addEr = (w: string): string => (w.endsWith('e') ? `${w}r` : consonantY(w) ? `${w.slice(0, -1)}ier` : doubles(w) ? `${w}${w.slice(-1)}er` : `${w}er`);
const addEst = (w: string): string => (w.endsWith('e') ? `${w}st` : consonantY(w) ? `${w.slice(0, -1)}iest` : doubles(w) ? `${w}${w.slice(-1)}est` : `${w}est`);

/** The ways a word can be an ordinary inflection of another: the possible base words, and how to inflect a synonym the same way. */
function inflections(w: string): Array<{ base: string; apply: (s: string) => string }> {
  const out: Array<{ base: string; apply: (s: string) => string }> = [];
  const add = (base: string, apply: (s: string) => string): void => {
    if (base.length >= 3 && VOWEL.test(base)) out.push({ base, apply });
  };
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`, addS);
  if (w.endsWith('es')) add(w.slice(0, -2), addS);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) add(w.slice(0, -1), addS);
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`, addEd);
  if (w.endsWith('ed')) {
    add(w.slice(0, -2), addEd);
    add(w.slice(0, -1), addEd);
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3), addEd);
  }
  if (w.endsWith('ing')) {
    add(w.slice(0, -3), addIng);
    add(`${w.slice(0, -3)}e`, addIng);
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4), addIng);
    if (w.endsWith('ying')) add(`${w.slice(0, -4)}ie`, addIng);
  }
  if (w.endsWith('ily')) add(`${w.slice(0, -3)}y`, addLy);
  if (w.endsWith('ly')) { add(w.slice(0, -2), addLy); add(`${w.slice(0, -2)}le`.replace(/lle$/, 'll'), addLy); }
  if (w.endsWith('ier')) add(`${w.slice(0, -3)}y`, addEr);
  if (w.endsWith('er')) { add(w.slice(0, -2), addEr); add(w.slice(0, -1), addEr); if (/(.)\1er$/.test(w)) add(w.slice(0, -3), addEr); }
  if (w.endsWith('iest')) add(`${w.slice(0, -4)}y`, addEst);
  if (w.endsWith('est')) { add(w.slice(0, -3), addEst); add(w.slice(0, -2), addEst); if (/(.)\1est$/.test(w)) add(w.slice(0, -4), addEst); }
  return out;
}

/** -ing and -ed words that are nouns or adjectives of their own, whatever verb they look like */
const FIXED = new Set(['morning', 'evening', 'building', 'ceiling', 'wedding', 'painting', 'meeting', 'feeling', 'clothing', 'spring', 'string', 'sibling', 'darling', 'sterling', 'hundred', 'kindred', 'naked', 'wicked', 'sacred', 'beloved']);

export class Thesaurus {
  private index: Map<string, string> | null = null;
  private verbs = new Set<string>();

  constructor(private readonly data: string) {}

  /** how many words have synonyms */
  get size(): number {
    return this.load().size;
  }

  private load(): Map<string, string> {
    if (this.index) return this.index;
    const m = new Map<string, string>();
    for (const line of this.data.split('\n')) {
      if (line.startsWith('#v:')) { this.verbs = new Set(line.slice(3).split(',')); continue; }
      const c = line.indexOf(':');
      if (c > 0) m.set(line.slice(0, c), line.slice(c + 1));
    }
    return (this.index = m);
  }

  /** Synonyms for a word in the word's own form and capitals, best first; null when the word is not worth a menu or is unknown. */
  lookup(word: string, limit = 10): string[] | null {
    if (isStopWord(word) || !/^[\p{L}'\u2019-]+$/u.test(word)) return null;
    const lower = word.toLowerCase().replace(/\u2019/g, "'");
    if (!/^[a-z]+$/.test(lower)) return null;
    const idx = this.load();
    const direct = idx.get(lower);
    const viaBase = (verbOnly: boolean): string[] | null => {
      for (const { base, apply } of inflections(lower)) {
        const hit = idx.get(base);
        if (!hit || (verbOnly && !this.verbs.has(base))) continue;
        // a verb form is made only from synonyms that are verbs, a comparative only from short words
        const kind = /(ing|ed)$/.test(lower) ? 'verb' : /(er|est)$/.test(lower) && !/s$/.test(lower) ? 'short' : 'any';
        const ok = (syn: string): boolean => (kind === 'verb' ? this.verbs.has(syn) : kind === 'short' ? syn.length <= 6 : true);
        const made = hit.split(',').filter(ok).map(apply);
        if (made.length > 0) return made;
      }
      return null;
    };
    // "walking" and "walked" come from the verb walk even when the word is also a noun or adjective ("running"); "seed" and "morning" are what they are
    const participle = /(ing|ed)$/.test(lower) && !FIXED.has(lower) && !this.verbs.has(lower);
    const found = participle ? (viaBase(true) ?? (direct ? direct.split(',') : null)) : direct ? direct.split(',') : viaBase(false);
    const list = found;
    if (!list) return null;
    const seen = new Set([lower]);
    const out: string[] = [];
    for (const s of list) {
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(matchCase(word, s));
      if (out.length === limit) break;
    }
    return out.length > 0 ? out : null;
  }
}
