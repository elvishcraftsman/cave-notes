/**
 * Query text helpers for the search bar. They mirror the tokenizer in core-index (a parity test
 * checks this) but also keep each token's position, so a chip can be removed from the text.
 */

export interface Token {
  raw: string;
  start: number;
  end: number;
  negated: boolean;
  key: string | null;
  value: string;
  quoted: boolean;
  /** a group mark: "(" (negated for "-(") or ")" */
  punct?: '(' | ')';
  /** the words OR, AND and NOT */
  kw?: 'OR' | 'AND' | 'NOT';
}

const KEY_RE = /^([A-Za-z_][\w.-]*):/;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  let depth = 0;
  while (i < n) {
    while (i < n && /\s/.test(input[i]!)) i++;
    if (i >= n) break;
    const start = i;
    let negated = false;
    if (input[i] === '-' && i + 1 < n && !/\s/.test(input[i + 1]!)) {
      negated = true;
      i++;
    }
    if (input[i] === '(') {
      i++;
      depth++;
      tokens.push({ raw: input.slice(start, i), start, end: i, negated, key: null, value: '', quoted: false, punct: '(' });
      continue;
    }
    if (input[i] === ')' && !negated && depth > 0) {
      i++;
      depth--;
      tokens.push({ raw: ')', start, end: i, negated: false, key: null, value: '', quoted: false, punct: ')' });
      continue;
    }
    let key: string | null = null;
    const m = KEY_RE.exec(input.slice(i, i + 64));
    if (m) {
      key = m[1]!.toLowerCase();
      i += m[0].length;
    }
    let value = '';
    let quoted = false;
    if (input[i] === '"') {
      quoted = true;
      i++;
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) i++;
        value += input[i++];
      }
      i++;
    } else {
      while (i < n && !/\s/.test(input[i]!) && !(input[i] === ')' && depth > 0)) value += input[i++];
    }
    const end = Math.min(i, n);
    const tok: Token = { raw: input.slice(start, end), start, end, negated, key, value, quoted };
    if (key === null && !quoted && !negated && (value === 'OR' || value === 'AND' || value === 'NOT')) tok.kw = value;
    tokens.push(tok);
  }
  return tokens;
}

export interface Chip {
  raw: string;
  start: number;
  end: number;
  kind: 'filter' | 'sort' | 'exclude';
  negated: boolean;
  key: string | null;
  label: string;
}

const NICE_KEYS: Record<string, string> = { is: 'is', has: 'has', under: 'under', over: 'over', parent: 'parent', children: 'children', 'links-to': 'links to', backlinks: 'backlinks', 'linked-from': 'linked from' };

/** Chips for every complete filter, exclusion or sort in the query. Plain words stay in the text. */
export function chips(text: string): Chip[] {
  const out: Chip[] = [];
  for (const t of tokenize(text)) {
    if (t.value === '' || (t.key === null && !t.negated)) continue;
    if (t.key === null) {
      out.push({ raw: t.raw, start: t.start, end: t.end, kind: 'exclude', negated: true, key: null, label: `not ${t.value}` });
      continue;
    }
    const name = NICE_KEYS[t.key] ?? t.key;
    const kind = t.key === 'sort' ? 'sort' : 'filter';
    const label = kind === 'sort' ? (t.value.startsWith('-') ? `sort ${t.value.slice(1)} ↓` : `sort ${t.value} ↑`) : `${t.negated ? 'not ' : ''}${name}: ${t.value.replace(/,/g, ', ')}`;
    out.push({ raw: t.raw, start: t.start, end: t.end, kind, negated: t.negated, key: t.key, label });
  }
  return out;
}

const tidy = (s: string): string => s.replace(/\s{2,}/g, ' ').trim();

/** The text without the chip's token. */
export function removeChip(text: string, chip: Pick<Chip, 'start' | 'end'>): string {
  return tidy(text.slice(0, chip.start) + ' ' + text.slice(chip.end));
}

/** Add `token` (e.g. `status:draft`) to the query, or remove it if it is already there. */
export function toggleToken(text: string, token: string): string {
  const found = tokenize(text).find((t) => t.raw === token);
  if (found) return removeChip(text, found);
  return text.trim() === '' ? `${token} ` : `${text.trimEnd()} ${token} `;
}

/** Set the sort (`sort:due`, `sort:-title`), replacing any existing one; null removes it. */
export function setSort(text: string, sort: string | null): string {
  const kept = tokenize(text).filter((t) => t.key === 'sort');
  let out = text;
  for (const t of kept.reverse()) out = removeChip(out, t);
  return sort ? `${out.trimEnd()} sort:${sort} `.trimStart() : out;
}

/** Quote a value for use in a token when it contains spaces or commas. */
export function quoteValue(v: string): string {
  return /[\s,"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}
