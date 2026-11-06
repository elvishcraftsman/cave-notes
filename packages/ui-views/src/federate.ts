import { tokenize, type Token } from '@cave-notes/ui-search';

/** A saved query of another workspace, written `saved:Workspace::name` (or `saved:"Two Words::the name"`). */
export interface ForeignRef {
  workspace: string;
  name: string;
  /** the term as written */
  raw: string;
}

/** `Workspace::name` split at the first `::`, or null when the text is not of that form. */
export function parseForeign(value: string): { workspace: string; name: string } | null {
  const i = value.indexOf('::');
  if (i < 0) return null;
  const workspace = value.slice(0, i).trim();
  const name = value.slice(i + 2).trim();
  return workspace && name ? { workspace, name } : null;
}

const isForeign = (t: Token): boolean => t.key === 'saved' && t.value.includes('::');

interface Group {
  negated: boolean;
  items: Item[];
}
type Item = Token | Group;
const isGroup = (i: Item): i is Group => 'items' in i;

function parseItems(tokens: Token[]): Item[] {
  let pos = 0;
  const run = (): Item[] => {
    const items: Item[] = [];
    while (pos < tokens.length) {
      const t = tokens[pos++]!;
      if (t.punct === '(') items.push({ negated: t.negated, items: run() });
      else if (t.punct === ')') return items;
      else items.push(t);
    }
    return items;
  };
  return run();
}

const mentionsForeign = (items: Item[]): boolean => items.some((i) => (isGroup(i) ? mentionsForeign(i.items) : isForeign(i)));

const isJoiner = (i: Item): boolean => !isGroup(i) && (i.kw === 'OR' || i.kw === 'AND');

/** Remove the OR / AND words that no longer have a term on both sides. */
function tidy(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const i of items) {
    if (isJoiner(i) && (out.length === 0 || isJoiner(out[out.length - 1]!))) continue;
    out.push(i);
  }
  while (out.length > 0 && isJoiner(out[out.length - 1]!)) out.pop();
  return out;
}

function stripForeign(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const i of items) {
    if (isGroup(i)) {
      const inner = stripForeign(i.items);
      if (inner.length > 0) out.push({ negated: i.negated, items: inner });
    } else if (!isForeign(i)) out.push(i);
  }
  return tidy(out);
}

function alternatives(items: Item[]): Item[][] {
  const alts: Item[][] = [[]];
  for (const i of items) {
    if (!isGroup(i) && i.kw === 'OR') alts.push([]);
    else alts[alts.length - 1]!.push(i);
  }
  return alts;
}

const text = (items: Item[]): string => items.map((i) => (isGroup(i) ? `${i.negated ? '-' : ''}(${text(i.items)})` : i.raw)).join(' ');

export interface Split {
  /** the query for this workspace itself (empty when nothing is left of it) */
  local: string;
  /** the saved queries of other workspaces that are joined to it by OR */
  foreign: ForeignRef[];
  /** the `sort:` terms, to give to every part; and the order itself, to merge the parts */
  sort: string[];
  sortSpec: string;
  errors: string[];
}

/**
 * Take the `saved:Workspace::name` terms out of a query. Pages of different workspaces are never the same page,
 * so such a term can only be one of the alternatives of an OR: `status:todo OR saved:Theology::open-tasks`.
 * Written anywhere else (next to other terms, negated) it is reported and left out. A query without such a term
 * comes back unchanged.
 */
export function splitForeign(query: string): Split {
  const tokens = tokenize(query);
  if (!tokens.some(isForeign)) return { local: query, foreign: [], sort: [], sortSpec: '', errors: [] };
  const errors: string[] = [];
  const foreign: ForeignRef[] = [];
  const sort: string[] = [];
  const sortKeys: string[] = [];
  const rest = tokens.filter((t) => {
    if (t.key === 'sort' && !t.punct) {
      sort.push(t.raw);
      sortKeys.push(t.value);
      return false;
    }
    return true;
  });

  const extract = (items: Item[]): Item[][] => {
    const kept: Item[][] = [];
    for (const alt of alternatives(items)) {
      const real = alt.filter((i) => isGroup(i) || i.kw !== 'AND');
      const only = real.length === 1 ? real[0]! : null;
      if (only && !isGroup(only) && isForeign(only)) {
        const ref = parseForeign(only.value);
        if (only.negated) errors.push(`saved:${only.value} cannot be negated; a saved query of another workspace can only be added with OR.`);
        else if (!ref) errors.push(`saved:${only.value} needs a workspace and a name, like saved:Theology::open-tasks.`);
        else foreign.push({ ...ref, raw: only.raw });
      } else if (only && isGroup(only) && !only.negated && mentionsForeign(only.items)) {
        kept.push(...extract(only.items)); // (a OR saved:W::q) joins the OR around it
      } else if (mentionsForeign(alt)) {
        alt.forEach(collect);
        const left = stripForeign(alt);
        if (left.length > 0) kept.push(left);
      } else if (alt.length > 0) kept.push(alt);
    }
    return kept;
  };
  const collect = (i: Item): void => {
    if (isGroup(i)) i.items.forEach(collect);
    else if (isForeign(i)) errors.push(`saved:${i.value} can only be joined to the rest of the query with OR (pages of another workspace are never the same pages).`);
  };

  const local = extract(parseItems(rest)).map(text).filter((s) => s.trim() !== '').join(' OR ');
  return { local, foreign, sort, sortSpec: sortKeys.join(','), errors };
}

/** The query without its `sort:` terms (a view's own order replaces the one a saved query brings). */
export function withoutSort(query: string): string {
  return tokenize(query).filter((t) => t.key !== 'sort' || t.punct).map((t) => t.raw).join(' ');
}
