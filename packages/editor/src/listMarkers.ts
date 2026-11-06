/**
 * List markers beyond "1.": lettered (a. b. … A. B.) and Roman (i. ii. … I. II.).
 *
 * The Markdown parser only knows numbers, so it is shown a copy of the text in which such a marker is swapped for a
 * number of the same length ("b." → "2.", "iv." → "21."). Offsets stay the same, so the tree it
 * produces fits the real document. Everything else (renumbering, rendering) reads the marker from the real text.
 */

export type MarkerKind = 'num' | 'alpha' | 'roman';

export interface Marker {
  kind: MarkerKind;
  upper: boolean;
  value: number;
  delim: '.' | ')';
}

const ROMAN_VALUES: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

export function toRoman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN_VALUES) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The value of a well-formed Roman numeral of at most 399, or null. */
export function fromRoman(s: string): number | null {
  const t = s.toLowerCase();
  if (!/^[ivxlc]+$/.test(t) || t.length > 8) return null;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = ROMAN_VALUES.find(([, r]) => r === t[i])![0];
    const nxt = i + 1 < t.length ? ROMAN_VALUES.find(([, r]) => r === t[i + 1])![0] : 0;
    n += cur < nxt ? -cur : cur;
  }
  return n > 0 && n < 400 && toRoman(n) === t ? n : null;
}

export function toAlpha(n: number): string {
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

export function fromAlpha(s: string): number {
  let n = 0;
  for (const ch of s.toLowerCase()) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n;
}

/**
 * Read a marker's text ("b.", "IV)", "12."). A lone "i", "v", "x" … could be a letter or a numeral: `hint` (the
 * kind of the first item of the list, when known) decides; without one "i" is a numeral and the others are letters.
 */
export function parseMarker(text: string, hint?: MarkerKind): Marker | null {
  const m = /^(\d{1,9}|[A-Za-z]+)([.)])$/.exec(text.trim());
  if (!m) return null;
  const body = m[1]!;
  const delim = m[2] as '.' | ')';
  if (/^\d+$/.test(body)) return { kind: 'num', upper: false, value: parseInt(body, 10), delim };
  const upper = body === body.toUpperCase();
  if (body !== body.toLowerCase() && !upper) return null;
  const roman = fromRoman(body);
  if (body.length === 1) {
    const asRoman = hint ? hint === 'roman' : body.toLowerCase() === 'i';
    if (asRoman && roman !== null) return { kind: 'roman', upper, value: roman, delim };
    return { kind: 'alpha', upper, value: fromAlpha(body), delim };
  }
  if (roman !== null && hint !== 'alpha') return { kind: 'roman', upper, value: roman, delim };
  return null;
}

export function formatMarker(kind: MarkerKind, upper: boolean, value: number, delim: '.' | ')'): string {
  const body = kind === 'num' ? String(value) : kind === 'roman' ? toRoman(value) : toAlpha(value);
  return (upper && kind !== 'num' ? body.toUpperCase() : body) + delim;
}

const LINE_START = /^((?:[ \t]*>)*[ \t]*)((?:[A-Za-z]{1,8}))([.)])(?=[ \t]|$)/;

/** The text the parser should see for one line: a lettered or Roman marker swapped for a number of the same length. */
export function shadowLine(line: string): string {
  const m = LINE_START.exec(line);
  if (!m) return line;
  const mk = parseMarker(m[2]! + m[3]!);
  if (!mk) return line;
  // only a marker with value 1 may interrupt a paragraph, as with "1."; the digits keep the same width
  const len = m[2]!.length;
  const digits = (mk.value === 1 ? '1' : '2') + '1'.repeat(len - 1);
  return m[1]! + digits + line.slice(m[1]!.length + len);
}

interface ParserInput {
  length: number;
  lineChunks: boolean;
  chunk(from: number): string;
  read(from: number, to: number): string;
}

/** Wrap a parser input so the parser sees `shadowLine` of every line. */
export function shadowInput(input: ParserInput): ParserInput {
  return {
    get length() {
      return input.length;
    },
    get lineChunks() {
      return input.lineChunks;
    },
    chunk(from) {
      const c = input.chunk(from);
      if (!input.lineChunks || c === '\n' || c === '') return c;
      // a chunk starts at a line start when the parser asks for a line
      return from === 0 || input.read(from - 1, from) === '\n' ? shadowLine(c) : c;
    },
    read(from, to) {
      const t = input.read(from, to);
      if (!t.includes('\n') && !(from === 0 || input.read(from - 1, from) === '\n')) return t;
      const parts = t.split('\n');
      return parts.map((p, i) => (i === 0 && !(from === 0 || input.read(from - 1, from) === '\n') ? p : shadowLine(p))).join('\n');
    },
  };
}
