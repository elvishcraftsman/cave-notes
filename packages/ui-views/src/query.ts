import { quoteValue, tokenize } from '@cave-notes/ui-search';
import type { ViewConfig } from './config';

/** Keys that name a place or a kind of match; any other key is an attribute, where `$this` means a link to the page. */
const NOT_ATTRIBUTES = new Set(['under', 'over', 'parent', 'children', 'links-to', 'backlinks', 'linked-from', 'path', 'heading', 'title', 'body', 'has', 'is', 'sort', 'saved', 'filename', 'filetype', 'mtime']);

const stripMd = (p: string): string => p.replace(/\.md$/, '');

/**
 * A saved query is one unit: with an OR at its top level it is put in parentheses, so that terms written next to
 * `saved:name` apply to all of it. Its sort terms stay outside.
 */
export function asUnit(text: string): string {
  const toks = tokenize(text);
  let depth = 0;
  let or = false;
  for (const t of toks) {
    if (t.punct === '(') depth++;
    else if (t.punct === ')') depth--;
    else if (depth === 0 && t.kw === 'OR') or = true;
  }
  if (!or) return text;
  const isSort = (t: (typeof toks)[number]): boolean => t.key === 'sort' && !t.punct;
  return [`( ${toks.filter((t) => !isSort(t)).map((t) => t.raw).join(' ')} )`, ...toks.filter(isSort).map((t) => t.raw)].join(' ');
}

/**
 * Replace each `saved:name` by that saved query's text (which can use `saved:` itself). `saved:Workspace::name`, a saved
 * query of another workspace, is kept as it is.
 * A name that is unknown, or a query that uses itself, is left out and reported in `errors`.
 */
export function expandSaved(query: string, saved: ReadonlyMap<string, string>, errors: string[] = [], stack: string[] = []): string {
  if (!/saved:/i.test(query)) return query;
  const out: string[] = [];
  for (const t of tokenize(query)) {
    if (t.key !== 'saved') {
      out.push(t.raw);
      continue;
    }
    if (t.value === '') continue;
    if (t.value.includes('::')) {
      out.push(t.raw); // saved:Workspace::name is a query of another workspace: run there, not expanded here (see splitForeign)
      continue;
    }
    const key = t.value.trim().toLowerCase();
    const body = saved.get(key);
    if (t.negated) errors.push(`saved:${t.value} cannot be negated`);
    else if (body === undefined) errors.push(`There is no saved query named "${t.value}".`);
    else if (stack.includes(key) || stack.length >= 6) errors.push(`The saved query "${t.value}" uses itself.`);
    else out.push(asUnit(expandSaved(body, saved, errors, [...stack, key])));
  }
  return out.join(' ');
}

/**
 * Fill in saved queries, `$this` / `$parent` and the config's sort, giving the query to run.
 * The view's own `sort` replaces any sort a saved query brings.
 */
export function resolveQuery(config: Pick<ViewConfig, 'query' | 'sort'>, ctx: { page: string | null; saved?: ReadonlyMap<string, string> }): string {
  const here = ctx.page ? stripMd(ctx.page) : null;
  const parent = here && here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : null;
  const parts: string[] = [];
  const ownSort = tokenize(config.query).some((t) => t.key === 'sort');
  const expanded = ctx.saved ? expandSaved(config.query, ctx.saved) : config.query;
  for (const t of tokenize(expanded)) {
    if (config.sort && !ownSort && t.key === 'sort') continue; // a sort that only a saved query brings gives way to the view's own
    let raw = t.raw;
    if (raw.includes('$this')) {
      if (here === null) continue;
      const asLink = t.key !== null && !NOT_ATTRIBUTES.has(t.key) && !/^[a-z]+\.(year|month|day|weekday|week)$/.test(t.key) && t.value === '$this';
      raw = asLink ? `${t.negated ? '-' : ''}${t.key}:${quoteValue(`[[${here}]]`)}` : raw.replace('$this', quoteValue(here));
    }
    if (raw.includes('$parent')) {
      if (parent === null) continue;
      raw = raw.replace('$parent', quoteValue(parent));
    }
    parts.push(raw);
  }
  let q = parts.join(' ');
  if (config.sort && !tokenize(q).some((t) => t.key === 'sort')) q = `${q} sort:${config.sort}`.trim();
  return q;
}

/**
 * What a page made from a view should start with so that it shows up in that view: the plain "attribute is X"
 * filters of the query become attribute values, and `under:` and `children:` say where the page goes (the most specific wins). Groups, negations,
 * ranges and comparisons are left out (they do not name one value).
 */
export function newPageDefaults(query: string): { attrs: Record<string, string>; under: string | null } {
  const attrs: Record<string, string> = {};
  // `under:` and `children:` both say where a new page goes; the most specific one (the deepest page) wins,
  // and `children:` beats `under:` when they name equally deep pages (it is the stricter filter).
  let under: string | null = null;
  let underRank = -1;
  const toks = tokenize(query);
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.punct === '(') depth++;
    else if (t.punct === ')') depth = Math.max(0, depth - 1);
    if (depth > 0 || t.punct || t.negated || t.key === null || t.value === '') continue;
    if (toks[i + 1]?.kw === 'OR' || toks[i - 1]?.kw === 'OR') continue;
    if (t.key === 'under' || t.key === 'children') {
      const v = t.value.split(',')[0]!;
      const rank = v.replace(/\/+$/, '').split('/').length * 2 + (t.key === 'children' ? 1 : 0);
      if (rank > underRank) {
        under = v;
        underRank = rank;
      }
      continue;
    }
    if (['sort', 'has', 'is', 'over', 'parent', 'title', 'body', 'path', 'heading', 'links-to', 'linked-from', 'backlinks', 'saved', 'filename', 'filetype'].includes(t.key)) continue;
    if (/^(<=|>=|<|>)/.test(t.value) || t.value.includes('..') || /[*?]/.test(t.value) || t.value.startsWith('$now')) continue;
    if (/\.(year|month|day|weekday|week)$/.test(t.key)) continue;
    attrs[t.key] = t.value.split(',')[0]!;
  }
  return { attrs, under };
}

/**
 * The place filters a page must satisfy to be in a view (`under:`, `children:`, `parent:`, `over:`): only those that
 * stand alone, not in a group, an OR or a negation. Putting a page in a view by giving it attributes cannot satisfy
 * these; the page would have to move.
 */
export function placementOf(query: string): Array<{ key: 'under' | 'children' | 'parent' | 'over'; value: string }> {
  const out: Array<{ key: 'under' | 'children' | 'parent' | 'over'; value: string }> = [];
  const toks = tokenize(query);
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.punct === '(') depth++;
    else if (t.punct === ')') depth = Math.max(0, depth - 1);
    if (depth > 0 || t.punct || t.negated || t.key === null || t.value === '') continue;
    if (toks[i + 1]?.kw === 'OR' || toks[i - 1]?.kw === 'OR') continue;
    if (t.key === 'under' || t.key === 'children' || t.key === 'parent' || t.key === 'over') out.push({ key: t.key, value: t.value });
  }
  return out;
}

const plainYaml = (v: string): boolean => /^[A-Za-z][\w .@/-]*$/.test(v) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(v) && !/\s$/.test(v);

/** One frontmatter value as YAML text, by the attribute's type (number, date and bool are written bare). */
function yamlValue(raw: string, type: string, list: boolean): string {
  const one = (v: string): string => {
    const t = v.trim();
    if (type === 'number' && /^-?\d+(\.\d+)?$/.test(t)) return t;
    if (type === 'date' && /^\d{4}-\d{1,2}-\d{1,2}([T ][\d:.]+Z?)?$/.test(t)) return t.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_m, y, mo, d) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (type === 'bool' && /^(true|false)$/i.test(t)) return t.toLowerCase();
    return plainYaml(t) ? t : JSON.stringify(t);
  };
  return list ? `[${raw.split(',').map((x) => x.trim()).filter(Boolean).map(one).join(', ')}]` : one(raw);
}

/** The text of a new page: its attributes (empty ones left out) as frontmatter, then the title as a heading. */
export function newPageContent(title: string, attrs: Record<string, string>, types: Record<string, { type: string; list?: boolean }> = {}, links: Record<string, string[]> = {}): string {
  const lines = Object.entries(attrs)
    .filter(([, v]) => v.trim() !== '')
    .map(([k, v]) => `${k}: ${yamlValue(v, types[k]?.type ?? 'string', types[k]?.list ?? false)}`);
  // attributes that name pages (a relation's side): each page as a quoted [[link]]
  for (const [k, pages] of Object.entries(links)) {
    if (pages.length === 0) continue;
    const q = pages.map((p) => JSON.stringify(`[[${p}]]`));
    lines.push(`${k}: ${q.length === 1 ? q[0] : `[${q.join(', ')}]`}`);
  }
  const front = lines.length > 0 ? `---\n${lines.join('\n')}\n---\n` : '';
  return `${front}# ${title}\n\n`;
}
