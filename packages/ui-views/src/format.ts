import type { Attr, Row } from './shape';

/** How a cell is drawn, from a column's `formats:` entry (see ViewConfig.formats). */
export type Shown =
  | { kind: 'text'; text: string }
  | { kind: 'url'; text: string; href: string }
  | { kind: 'email'; text: string; href: string }
  | { kind: 'rating'; value: number; max: number }
  | { kind: 'progress'; value: number; max: number };

const numberOf = (a: Attr | undefined): number | null => {
  if (!a) return null;
  if (a.num !== null && Number.isFinite(a.num)) return a.num;
  const n = Number(a.text.replace(/[, ]/g, ''));
  return a.text.trim() !== '' && Number.isFinite(n) ? n : null;
};

const group = (n: number, digits: number): string => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The text or widget a value is shown as under a format. Unknown formats and values that do not fit one (text in a number format) are shown as they are. */
export function applyFormat(attrs: Attr[], spec: string | undefined): Shown {
  const plain = attrs.map((a) => a.text).join(', ');
  if (!spec) return { kind: 'text', text: plain };
  const [name, arg] = spec.split(':', 2) as [string, string | undefined];
  const first = attrs[0];
  const n = numberOf(first);
  switch (name) {
    case 'currency': {
      if (n === null || attrs.length !== 1) return { kind: 'text', text: plain };
      const code = (arg ?? 'USD').toUpperCase();
      try {
        return { kind: 'text', text: new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n) };
      } catch {
        return { kind: 'text', text: `${group(n, 2)} ${code}` };
      }
    }
    case 'percent': return n === null || attrs.length !== 1 ? { kind: 'text', text: plain } : { kind: 'text', text: `${group(n, Number.isInteger(n) ? 0 : 1)}%` };
    case 'number': {
      const d = Number(arg);
      return n === null || attrs.length !== 1 ? { kind: 'text', text: plain } : { kind: 'text', text: group(n, Number.isInteger(d) && d >= 0 && d <= 10 ? d : Number.isInteger(n) ? 0 : 2) };
    }
    case 'rating': {
      const max = Math.max(1, Math.min(10, Math.floor(Number(arg) || 5)));
      return n === null ? { kind: 'rating', value: 0, max } : { kind: 'rating', value: Math.max(0, Math.min(max, Math.round(n))), max };
    }
    case 'progress': {
      const max = Number(arg) > 0 ? Number(arg) : 100;
      return { kind: 'progress', value: n === null ? 0 : Math.max(0, Math.min(max, n)), max };
    }
    case 'url': return plain && /^[a-z][a-z0-9+.-]*:\/\//i.test(plain) ? { kind: 'url', text: plain.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), href: plain } : plain && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(plain) ? { kind: 'url', text: plain, href: `https://${plain}` } : { kind: 'text', text: plain };
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(plain) ? { kind: 'email', text: plain, href: `mailto:${plain}` } : { kind: 'text', text: plain };
    default: return { kind: 'text', text: plain };
  }
}

export const FORMAT_NAMES = ['currency', 'percent', 'number', 'rating', 'progress', 'url', 'email'] as const;
export const FOOTER_NAMES = ['sum', 'avg', 'min', 'max', 'median', 'count', 'filled', 'empty', 'unique', 'percent'] as const;

/** The summary of a column over some rows (`how` is one of FOOTER_NAMES); null when it is not known or there is nothing to say. */
export function summarize(rows: Row[], key: string, how: string, valuesOf: (row: Row, key: string) => Attr[], format?: string): string | null {
  const cells = rows.map((r) => valuesOf(r, key));
  const filled = cells.filter((a) => a.some((x) => x.text.trim() !== ''));
  switch (how) {
    case 'count': return String(rows.length);
    case 'filled': return String(filled.length);
    case 'empty': return String(rows.length - filled.length);
    case 'percent': return rows.length === 0 ? null : `${Math.round((filled.length / rows.length) * 1000) / 10}%`;
    case 'unique': return String(new Set(cells.flatMap((a) => a.map((x) => x.text.trim().toLowerCase())).filter(Boolean)).size);
    case 'sum': case 'avg': case 'min': case 'max': case 'median': {
      const nums = cells.map((a) => (a.length === 1 ? numberOf(a[0]) : null)).filter((x): x is number => x !== null);
      if (nums.length === 0) return how === 'sum' ? '0' : null;
      const sorted = [...nums].sort((a, b) => a - b);
      const v = how === 'sum' ? nums.reduce((s, x) => s + x, 0)
        : how === 'avg' ? nums.reduce((s, x) => s + x, 0) / nums.length
        : how === 'min' ? sorted[0]!
        : how === 'max' ? sorted[sorted.length - 1]!
        : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
      const r = Math.round(v * 1e6) / 1e6;
      const shown = applyFormat([{ type: 'number', text: String(r), num: r }], format && ['currency', 'percent', 'number'].includes(format.split(':')[0]!) ? format : undefined);
      return shown.kind === 'text' && format && ['currency', 'percent', 'number'].includes(format.split(':')[0]!) ? shown.text : group(r, Number.isInteger(r) ? 0 : 2);
    }
    default: return null;
  }
}

/** The rows with the results of a computed column put in as an attribute of the same name, so that sorting, grouping, summaries and drawing treat it like any other. */
export function withComputed(rows: Row[], name: string, results: Map<string, { text: string; list: string[]; kind: string }>): Row[] {
  return rows.map((r) => {
    const res = results.get(r.path);
    if (!res || (res.list.length === 0 && res.text === '')) return r;
    const type = res.kind === 'number' ? 'number' : res.kind === 'bool' ? 'bool' : res.kind === 'date' ? 'date' : 'string';
    const items = res.kind === 'list' ? res.list : [res.text];
    const attrs: Attr[] = items.map((t) => ({ type, text: t, num: type === 'number' && Number.isFinite(Number(t)) ? Number(t) : null }));
    return { ...r, attrs: { ...r.attrs, [name]: attrs } };
  });
}

/** What typed or pasted text becomes for a column: numbers and ticks by their type, lists split at commas, nothing for empty text. */
export function coerceValue(text: string, info: { type?: string; list?: boolean } | undefined): string | number | boolean | string[] | null {
  const t = text.trim();
  if (t === '') return null;
  if (info?.list) return t.split(',').map((x) => x.trim()).filter(Boolean);
  if (info?.type === 'bool') return /^(true|yes|1|x|✓)$/i.test(t);
  const n = Number(t.replace(/[, $€£%]/g, ''));
  if (info?.type === 'number' && Number.isFinite(n)) return n;
  return t;
}

/** Text in CSV form as rows of cells: quotes, doubled quotes, commas or semicolons or tabs inside quotes, CRLF or LF. A leading byte-order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  // the separator is whichever of comma, semicolon and tab the first line has most of (outside quotes)
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string): number => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === c) n++; } return n; };
  const sep = [',', ';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '') || row.length > 1) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); if (row.some((c) => c !== '')) rows.push(row); }
  return rows;
}

/** A CSV as records: the first line names the columns, each next line is one record (a column name once per record, blank cells left out). */
export function csvRecords(text: string): { columns: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], records: [] };
  const columns = rows[0]!.map((c) => c.trim());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    columns.forEach((c, i) => { const v = (r[i] ?? '').trim(); if (c && v !== '') rec[c] = v; });
    return rec;
  }).filter((r) => Object.keys(r).length > 0);
  return { columns: columns.filter(Boolean), records };
}
