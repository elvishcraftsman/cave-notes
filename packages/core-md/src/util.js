/** Heading slugs, GitHub style: "Hello, World!" -> "hello-world"; duplicates get -1, -2, ... */
export function slugify(text) {
  const s = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
  return s === '' ? 'section' : s;
}

export class Slugger {
  constructor() {
    this.occurrences = new Map();
  }
  slug(text) {
    const original = slugify(text);
    let result = original;
    while (this.occurrences.has(result)) {
      const n = (this.occurrences.get(original) ?? 0) + 1;
      this.occurrences.set(original, n);
      result = `${original}-${n}`;
    }
    this.occurrences.set(result, 0);
    return result;
  }
}

/** Offsets at which each line starts. Handles \n, \r\n and lone \r. */
export function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 1-based { line, column } for a 0-based offset. */
export function positionAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const isWs = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

const NBSP = '\u00a0';
const TITLE_TAIL = /^\S+\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\))$/;

/**
 * `[x](Some folder/file.png)` is no link in CommonMark (a destination ends at a space), but it is how people
 * write a path. Returns `text` with the spaces inside such destinations swapped for no-break spaces: the same
 * length, so every offset still matches, and the parser takes the whole path as one destination. The callers
 * turn them back into spaces. Destinations in `<angle brackets>`, with a title, or inside code fences are left alone.
 */
export function protectSpacedDestinations(text) {
  if (!text.includes('](')) return text;
  const lines = text.split('\n');
  let fence = null;
  let changed = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const f = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence || !line.includes('](')) continue;
    let out = line;
    let from = 0;
    for (let at = line.indexOf('](', from); at >= 0; at = line.indexOf('](', from)) {
      const start = at + 2;
      let depth = 0;
      let k = start;
      for (; k < line.length; k++) {
        const ch = line[k];
        if (ch === '\\') k++;
        else if (ch === '(') depth++;
        else if (ch === ')') {
          if (depth === 0) break;
          depth--;
        }
      }
      from = start;
      if (k >= line.length) continue; // never closed on this line
      const inner = line.slice(start, k);
      const trimmed = inner.trim();
      if (!trimmed.includes(' ') || trimmed.startsWith('<') || TITLE_TAIL.test(trimmed)) continue;
      const lead = inner.length - inner.trimStart().length;
      const body = trimmed.replace(/ /g, NBSP);
      out = out.slice(0, start + lead) + body + out.slice(start + lead + trimmed.length);
      from = k;
    }
    if (out !== line) {
      lines[n] = out;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : text;
}

/** Give the spaces back to a destination protected by protectSpacedDestinations (unless the file itself had no-break spaces). */
export const unprotectDestination = (url, original) => (original.includes(NBSP) ? url : url.replace(/\u00a0/g, ' '));
