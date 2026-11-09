import { DateValue, evalExpr, hostCalls, isDateValue, parseDateValue, parseExpr, queryValue, rewritePageRefs, startOfDay } from '@cave-notes/core-automation';
import type { Index } from '@cave-notes/core-index';

/**
 * Values worked out from other pages: a `${…}` in the text of a page, or an attribute whose whole value is `${…}`
 * (a formula). The expression language is the one of automation rules (see core-automation); on top of it a page can
 * read a query (`sum("status: done", "hours")`) and another page (`[[Budget]].total`).
 */

type Entry = { type: string; text: string; num: number | null };
export type FormulaResult = { ok: true; value: unknown } | { ok: false; error: string };

/** What the formulas need of the workspace. */
export interface FormulaHost {
  index: Index;
  /** the page a name (or path) points at, seen from a page: its path, or null */
  resolvePage(name: string, from: string): Promise<string | null>;
}

const NOT_ATTRIBUTES = new Set(['under', 'over', 'parent', 'children', 'links-to', 'backlinks', 'linked-from', 'path', 'heading', 'title', 'body', 'has', 'is', 'sort', 'saved', 'filename', 'filetype', 'mtime']);
const stem = (p: string): string => p.replace(/\.[^./]+$/, '');
const quote = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Put the page in place of `$this` and `$parent` in a query. `key:$this` on an attribute means a link to the page, as in views. */
export function substituteQuery(query: string, here: string | null): string {
  const out: string[] = [];
  let cur = '';
  let q = false;
  const flush = (): void => {
    if (cur !== '') out.push(cur);
    cur = '';
  };
  for (const c of query) {
    if (c === '"') q = !q;
    if (/\s/.test(c) && !q) flush();
    else cur += c;
  }
  flush();
  const me = here ? stem(here) : null;
  const parent = me && me.includes('/') ? me.slice(0, me.lastIndexOf('/')) : null;
  const words: string[] = [];
  for (let t of out) {
    if (t.includes('$this')) {
      if (me === null) continue;
      const m = /^(-?)([A-Za-z][\w.-]*):\$this$/.exec(t);
      t = m && !NOT_ATTRIBUTES.has(m[2]!.toLowerCase()) && !/^[a-z]+\.(year|month|day|weekday|week)$/i.test(m[2]!) ? `${m[1]}${m[2]}:${quote(`[[${me}]]`)}` : t.replace('$this', quote(me));
    }
    if (t.includes('$parent')) {
      if (parent === null) continue;
      t = t.replace('$parent', quote(parent));
    }
    words.push(t);
  }
  return words.join(' ');
}

const typed = (e: Entry): unknown => (e.type === 'number' ? e.num : e.type === 'bool' ? e.num === 1 : e.type === 'date' ? (parseDateValue(e.text) ?? e.text) : e.text);

/** A page as an expression sees it: its title and path, and every attribute (a list when it has several values). */
function record(host: FormulaHost, path: string): Record<string, unknown> | null {
  const info = host.index.getPage(path) as { title: string; attributes: Record<string, Entry[]> } | null;
  if (!info) return null;
  const rec: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(info.attributes)) rec[k] = v.length === 0 ? null : v.length === 1 ? typed(v[0]!) : v.map(typed);
  rec.title = info.title;
  rec.path = path;
  rec.name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  return rec;
}

/** What a run of formulas reads again and again: queries (shared between formulas that ask the same) and pages. */
export class FormulaRun {
  private queries = new Map<string, { count: number; titles: string[]; values: Entry[] }>();
  constructor(
    readonly host: FormulaHost,
    readonly now: Date = new Date(),
  ) {}

  private find(query: string, attr: string | null, here: string | null): { count: number; titles: string[]; values: Entry[] } {
    const text = substituteQuery(query, here);
    const key = `${text}\u0000${attr ?? ''}`;
    const hit = this.queries.get(key);
    if (hit) return hit;
    const r = (this.host.index.search as (q: string, o: object) => { results: any[]; errors: string[] })(text, { limit: 100_000, count: false, prefixLast: false });
    if (r.errors.length > 0) throw new Error(r.errors[0]);
    const pages = r.results.filter((x: { isVirtual: boolean }) => !x.isVirtual) as Array<{ path: string; title: string }>;
    const values: Entry[] = [];
    if (attr !== null) {
      const want = attr.toLowerCase();
      for (const p of pages) {
        const name = p.path.split('/').pop() ?? p.path;
        if (want === 'title') values.push({ type: 'string', text: p.title, num: null });
        else if (want === 'path') values.push({ type: 'string', text: p.path, num: null });
        else if (want === 'filename') values.push({ type: 'string', text: name, num: null });
        else if (want === 'filetype') values.push({ type: 'string', text: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '', num: null });
        else {
          const info = this.host.index.getPage(p.path) as { attributes: Record<string, Entry[]> } | null;
          const k = info ? Object.keys(info.attributes).find((x) => x.toLowerCase() === want) : undefined;
          if (info && k) for (const e of info.attributes[k]!) if (e.text !== '') values.push({ type: e.type, text: e.text, num: e.num ?? null });
        }
      }
    }
    const out = { count: pages.length, titles: pages.map((p) => p.title), values };
    this.queries.set(key, out);
    return out;
  }

  /** Work out an expression written for page `here` (null: for no page). */
  async evaluate(here: string | null, expr: string): Promise<FormulaResult> {
    let tree: unknown;
    try {
      tree = parseExpr(rewritePageRefs(expr));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const store = new Map<string, unknown>();
    for (const c of hostCalls(tree)) {
      try {
        if (c.kind === 'page') {
          const path = await this.host.resolvePage(c.args[0]!, here ?? '');
          const rec = path ? record(this.host, path) : null;
          store.set(c.key, rec ?? { __error: `there is no page called “${c.args[0]}”` });
        } else {
          store.set(c.key, queryValue(c.name, c.args, this.find(c.args[0]!, c.args[1] ?? null, here)));
        }
      } catch (e) {
        store.set(c.key, { __error: (e as Error).message });
      }
    }
    const today = startOfDay(new DateValue(this.now.getTime(), false));
    const ctx: Record<string, unknown> = { this: here ? record(this.host, here) : null, today, now: new DateValue(this.now.getTime(), false), __host: store };
    try {
      return { ok: true, value: evalExpr(tree, ctx) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/** A number as text without the noise of floating point (0.1 + 0.2 is 0.3). */
export const numberText = (n: number): string => String(Number(n.toPrecision(12)));

/** The rows an attribute with this value has in the index: one per list item. */
export function rowsFor(value: unknown): Array<{ type: string; text: string; num: number | null }> {
  const items = Array.isArray(value) ? value : [value];
  const rows = items
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return { type: 'number', text: numberText(v), num: Number(v.toPrecision(12)) };
      if (typeof v === 'boolean') return { type: 'bool', text: String(v), num: v ? 1 : 0 };
      if (isDateValue(v)) {
        // the index keeps a date as the time its text names (a plain day is that day in UTC)
        const t = v.toString();
        const ms = Date.parse(t.replace(' ', 'T'));
        return { type: 'date', text: t, num: Number.isNaN(ms) ? v.ms : ms };
      }
      return { type: 'string', text: typeof v === 'number' ? String(v) : String(v), num: null };
    });
  return rows.length > 0 ? rows : [{ type: 'string', text: '', num: null }];
}

/** The text a `${…}` in a page shows for a value. */
export function valueText(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter((v) => v !== null && v !== undefined)
    .map((v) => (typeof v === 'number' ? numberText(v) : isDateValue(v) ? v.toString() : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(', ');
}

/**
 * Work out every attribute whose value is a formula and keep the result in the index (the page's file keeps the formula).
 * Formulas may read each other, so it goes round until nothing changes (three times at most). Returns whether anything changed.
 */
export function recomputeFormulas(host: FormulaHost): Promise<boolean> {
  return (async () => {
    const db = host.index.db;
    const rows = db.prepare('SELECT a.page_id AS pid, p.path AS path, a.key AS key, a.formula AS formula FROM attrs a JOIN pages p ON p.id = a.page_id WHERE a.formula IS NOT NULL AND a.idx = 0').all() as Array<{ pid: number; path: string; key: string; formula: string }>;
    if (rows.length === 0) return false;
    let any = false;
    const problems = new Map<string, { pid: number; messages: string[] }>();
    for (let pass = 0; pass < 3; pass++) {
      const run = new FormulaRun(host);
      problems.clear();
      let changed = false;
      for (const r of rows) {
        const res = await run.evaluate(r.path, r.formula);
        if (!res.ok) {
          const p = problems.get(r.path) ?? { pid: r.pid, messages: [] };
          p.messages.push(`${r.key}: ${res.error}`);
          problems.set(r.path, p);
          continue;
        }
        const next = rowsFor(res.value);
        const old = db.prepare('SELECT type, text_value AS text, num_value AS num FROM attrs WHERE page_id = ? AND key = ? ORDER BY idx').all(r.pid, r.key) as Array<{ type: string; text: string; num: number | null }>;
        if (old.length === next.length && old.every((o, i) => o.type === next[i]!.type && o.text === next[i]!.text && (o.num ?? null) === next[i]!.num)) continue;
        db.transaction(() => {
          db.prepare('DELETE FROM attrs WHERE page_id = ? AND key = ?').run(r.pid, r.key);
          next.forEach((n, i) => db.prepare('INSERT INTO attrs (page_id, key, type, text_value, num_value, idx, formula) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.pid, r.key, n.type, n.text, n.num, i, i === 0 ? r.formula : null));
        })();
        changed = true;
      }
      if (!changed) break;
      any = true;
    }
    db.transaction(() => {
      db.prepare("DELETE FROM diagnostics WHERE kind = 'formula'").run();
      for (const p of problems.values()) for (const m of p.messages) db.prepare("INSERT INTO diagnostics (page_id, kind, message) VALUES (?, 'formula', ?)").run(p.pid, m);
    })();
    return any;
  })();
}
