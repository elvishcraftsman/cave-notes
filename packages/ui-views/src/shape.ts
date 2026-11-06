export interface Attr {
  type: string;
  text: string;
  num: number | null;
}

export interface Row {
  path: string;
  /** colour from the view's rules (name or #rrggbb) */
  color?: string;
  title: string;
  isVirtual: boolean;
  mtimeMs: number;
  attrs: Record<string, Attr[]>;
  /** pages named through a relation, by column name */
  related?: Record<string, Array<{ path: string; title: string; workspace?: string }>>;
  /** the workspace this page is in, when it is not the one shown (the row is then read only and opens that workspace) */
  workspace?: string;
}

export const BUILTIN = ['title', 'path', 'modified'] as const;

/** Properties every page has without being given any: they can be shown, sorted by and grouped by like attributes. */
export const BUILTIN_COLUMNS = ['title', 'modified', 'filename', 'filetype', 'path'] as const;

/** Properties of every row that are not shown unless someone asks (they would crowd out the real attributes). */
const QUIET = new Set(['filename', 'filetype']);

export function attrsOf(row: Row, key: string): Attr[] {
  return row.attrs[key] ?? [];
}

/** Text values of a column for a row (built-in columns included). */
export function valuesOf(row: Row, key: string): string[] {
  if (key === 'title') return [row.title];
  if (key === 'path') return [row.path.replace(/\.md$/, '')];
  if (key === 'filename') return [row.path.split('/').pop() ?? ''];
  if (key === 'filetype') return [/\.([^./]+)$/.test(row.path) ? row.path.split('.').pop()!.toLowerCase() : ''].filter(Boolean);
  if (key === 'modified') return [new Date(row.mtimeMs).toISOString().slice(0, 10)];
  if (row.related && key in row.related) return row.related[key]!.map((p) => p.title);
  // a property that is there with nothing in it has no value
  return attrsOf(row, key).map((a) => a.text).filter((t) => t !== '');
}

const sortKeyOf = (row: Row, key: string): number | string | null => {
  if (key === 'title') return row.title.toLowerCase();
  if (key === 'path') return row.path.toLowerCase();
  if (key === 'modified' || key === 'mtime') return row.mtimeMs;
  const a = attrsOf(row, key)[0];
  if (!a || a.text === '') return null;
  return a.num !== null ? a.num : a.text.toLowerCase();
};

/** Stable sort; pages without a value always go last. */
export function sortRows(rows: Row[], key: string, dir: 'asc' | 'desc' = 'asc'): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: sortKeyOf(r, key) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return a.i - b.i;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.r);
}

export interface Group {
  /** null = pages with no value for the attribute */
  value: string | null;
  rows: Row[];
}

/**
 * One group per value of `key`. A page with several values (tags) appears in each. `order` (for
 * example the declared values of an enum) comes first and always yields a group, even an empty one.
 */
export function groupRows(rows: Row[], key: string, order: string[] = [], dir: 'asc' | 'desc' = 'asc'): Group[] {
  const map = new Map<string, Row[]>();
  const none: Row[] = [];
  for (const r of rows) {
    const vals = [...new Set(valuesOf(r, key))];
    if (vals.length === 0) none.push(r);
    for (const v of vals) {
      const list = map.get(v);
      if (list) list.push(r);
      else map.set(v, [r]);
    }
  }
  const out: Group[] = [];
  for (const v of order) out.push({ value: v, rows: map.get(v) ?? [] });
  const seen = new Set(order);
  const sign = dir === 'desc' ? -1 : 1;
  for (const v of [...map.keys()].filter((x) => !seen.has(x)).sort((a, b) => sign * a.localeCompare(b, undefined, { numeric: true }))) out.push({ value: v, rows: map.get(v)! });
  if (none.length) out.push({ value: null, rows: none });
  return out;
}

/**
 * The relation column a name stands for, by lower-cased name: a relation can be asked for by its own name, or by the
 * attribute that holds it (`writing` for the relation `Writing`), whatever the capitals.
 */
export function relationAliases(relations: ReadonlyArray<{ name: string; reverse?: string; attribute?: string; backattribute?: string; backname?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const put = (from: string | undefined, to: string | undefined): void => {
    if (from && to && !out.has(from.toLowerCase())) out.set(from.toLowerCase(), to);
  };
  // names first, so that a relation's name always wins over another relation's attribute
  for (const r of relations) {
    put(r.name, r.name);
    const back = r.backname ?? r.reverse;
    put(back, back);
  }
  for (const r of relations) {
    put(r.attribute, r.name);
    put(r.backattribute, r.backname ?? r.reverse);
  }
  return out;
}

/** Columns to show: the configured ones, or the title plus the most common attributes of the rows. `aliases` (see relationAliases) turns the attribute of a relation into its relation column. */
export function pickColumns(configured: string[] | undefined, rows: Row[], max = 4, aliases?: Map<string, string>): string[] {
  const resolve = (cols: string[]): string[] => {
    if (!aliases || aliases.size === 0) return cols;
    const mapped = cols.map((c) => aliases.get(c.toLowerCase()) ?? c);
    return mapped.filter((c, i) => mapped.indexOf(c) === i);
  };
  if (configured && configured.length) return resolve(configured);
  const freq = new Map<string, number>();
  for (const r of rows) for (const k of Object.keys(r.attrs)) if (!QUIET.has(k)) freq.set(k, (freq.get(k) ?? 0) + 1);
  const keys = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
  return resolve(['title', ...keys]);
}

/** A title cut to `max` characters with an ellipsis (the whole title stays available as a tooltip). */
export function clipTitle(title: string, max = 32): string {
  const chars = [...title];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : title;
}

// ---------------------------------------------------------------- calendar

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  inMonth: boolean;
  isToday: boolean;
  rows: Row[];
}

export interface CalendarMonth {
  year: number;
  /** 0-11 */
  month: number;
  label: string;
  weeks: CalendarDay[][];
  /** pages without a usable date */
  unscheduled: Row[];
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The day (YYYY-MM-DD, UTC) a row falls on for a date attribute, or null. */
export function dayOf(row: Row, dateKey: string): string | null {
  const a = attrsOf(row, dateKey)[0];
  if (!a) return null;
  if (a.num !== null && a.type === 'date') return iso(new Date(a.num));
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(a.text);
  return m ? m[1]! : null;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function calendarMonth(year: number, month: number, rows: Row[], dateKey: string, today: string = iso(new Date()), weekStart = 0): CalendarMonth {
  const byDay = new Map<string, Row[]>();
  const unscheduled: Row[] = [];
  for (const r of rows) {
    const d = dayOf(r, dateKey);
    if (!d) unscheduled.push(r);
    else byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const start = new Date(Date.UTC(year, month, 1 - lead));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = iso(d);
    const day: CalendarDay = { date: key, inMonth: d.getUTCMonth() === month, isToday: key === today, rows: byDay.get(key) ?? [] };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push(day);
  }
  const label = first.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { year, month, label, weeks, unscheduled };
}

/** Month containing the earliest dated row (so a calendar opens where its data is), else the current month. */
export function initialMonth(rows: Row[], dateKey: string, now: Date = new Date()): { year: number; month: number } {
  const days = rows.map((r) => dayOf(r, dateKey)).filter((d): d is string => !!d).sort();
  const nowIso = iso(now);
  const pick = days.length === 0 ? nowIso : days.includes(nowIso) || days.some((d) => d.slice(0, 7) === nowIso.slice(0, 7)) ? nowIso : days.find((d) => d >= nowIso) ?? days[days.length - 1]!;
  return { year: Number(pick.slice(0, 4)), month: Number(pick.slice(5, 7)) - 1 };
}

export function formatAttr(a: Attr): string {
  if (a.type === 'date' && a.num !== null) return new Date(a.num).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (a.type === 'bool') return a.text === 'true' ? '✓' : '—';
  return a.text;
}

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows as CSV (RFC 4180): a header, then one line per row; several values of a column are joined with "; ". */
export function toCsv(rows: Row[], columns: string[]): string {
  const head = columns.map((c) => csvCell(c === 'modified' ? 'Modified' : c));
  const lines = rows.map((r) => columns.map((c) => csvCell(valuesOf(r, c).join('; '))).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** Rows ordered by several criteria, e.g. "due,-title": the first decides, the next break ties. */
export function sortRowsBy(rows: Row[], spec: string): Row[] {
  const keys = spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return rows;
  return keys.reduceRight((acc, k) => sortRows(acc, k.replace(/^-/, ''), k.startsWith('-') ? 'desc' : 'asc'), rows);
}
