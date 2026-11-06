/**
 * Saved queries and relations
 * ---------------------------
 * In .cave-notes/workspace.yaml:
 *
 *   "queries": {
 *     "open-tasks": "status:todo,doing",
 *     "projects":   { "query": "kind:project", "title": "All projects" }
 *   },
 *   "relations": [
 *     { "name": "Project", "from": "open-tasks", "attribute": "project", "to": "projects", "reverse": "Tasks" },
 *     { "name": "Project", "from": "tasks", "attribute": "project", "multiple": false, "to": "projects",
 *       "backattribute": "tasks", "backname": "Tasks", "backmultiple": true }   // mutual: both sides are stored
 *   ]
 *
 * A saved query is used in any query with `saved:name` (or `saved:"a name"`), alone or with more terms.
 * A relation says: pages of the query `from` name pages of the query `to` in their `attribute`
 * (as `[[Page]]` or a plain page name). The column `name` of a view shows those pages for each row of `from`;
 * the column `reverse` shows, for each row of `to`, the pages of `from` that name it.
 */
import { tokenize } from './query.js';

const MAX_DEPTH = 6;

/** @returns {{ queries: Array<{name: string, query: string, title?: string}>, problems: string[] }} */
export function normalizeQueries(raw) {
  const queries = [];
  const problems = [];
  if (raw === undefined || raw === null) return { queries, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('workspace.yaml: "queries" must be a mapping of names to queries');
    return { queries, problems };
  }
  const seen = new Set();
  for (const [name, v] of Object.entries(raw)) {
    const query = typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.query === 'string' ? v.query : null;
    if (query === null || name.trim() === '') {
      problems.push(`workspace.yaml: saved query "${name}" needs a query, like "status:todo"`);
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      problems.push(`workspace.yaml: saved query "${name}" appears twice (names are not case-sensitive)`);
      continue;
    }
    seen.add(name.toLowerCase());
    const title = v && typeof v === 'object' && typeof v.title === 'string' && v.title.trim() ? v.title.trim() : undefined;
    queries.push(title ? { name: name.trim(), query: query.trim(), title } : { name: name.trim(), query: query.trim() });
  }
  return { queries, problems };
}

/**
 * @returns {{ relations: Array<{name: string, from: string, to: string, attribute: string, multiple: boolean,
 *   reverse?: string, backattribute?: string, backname?: string, backmultiple?: boolean}>, problems: string[] }}
 *
 * `multiple` / `backmultiple` say whether the attribute on that side holds one page or several (several unless `false`).
 * With `backattribute` the relation is mutual: the pages named are named back in that attribute, and the app keeps the
 * two in step when one side is edited. `backname` is the column of the other side (`reverse` is the older spelling).
 * Without `backattribute` the other column is only worked out from the first, and cannot be edited.
 * `reverse` is always the name of the other side's column, whichever way it is written.
 */
export function normalizeRelations(raw, queries) {
  const relations = [];
  const problems = [];
  if (raw === undefined || raw === null) return { relations, problems };
  if (!Array.isArray(raw)) {
    problems.push('workspace.yaml: "relations" must be a list');
    return { relations, problems };
  }
  const known = new Set(queries.map((q) => q.name.toLowerCase()));
  const names = new Set();
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const bool = (v, dflt) => (v === false || v === 'false' || v === 'single' ? false : v === true || v === 'true' || v === 'multiple' ? true : dflt);
  raw.forEach((r, i) => {
    const o = r && typeof r === 'object' ? r : {};
    const attribute = str(o.attribute);
    const from = str(o.from);
    const to = str(o.to);
    const name = str(o.name) || attribute;
    const backattribute = str(o.backattribute);
    const reverse = str(o.backname) || str(o.reverse) || (backattribute ? backattribute.charAt(0).toUpperCase() + backattribute.slice(1) : '');
    const where = `workspace.yaml: relation ${i + 1}${name ? ` "${name}"` : ''}`;
    if (!attribute || !from || !to) return void problems.push(`${where} needs "from", "attribute" and "to"`);
    for (const q of [from, to]) if (!known.has(q.toLowerCase())) return void problems.push(`${where}: there is no saved query "${q}"`);
    if (backattribute && backattribute.toLowerCase() === attribute.toLowerCase() && from.toLowerCase() !== to.toLowerCase()) {
      return void problems.push(`${where}: "attribute" and "backattribute" are both "${attribute}", which only works when "from" and "to" are the same query`);
    }
    for (const n of [name, reverse].filter(Boolean)) {
      if (names.has(n.toLowerCase())) return void problems.push(`${where}: the column name "${n}" is already used by another relation`);
    }
    if (reverse && reverse.toLowerCase() === name.toLowerCase()) return void problems.push(`${where}: the two columns need different names`);
    for (const n of [name, reverse].filter(Boolean)) names.add(n.toLowerCase());
    const rel = { name, from, to, attribute, multiple: bool(o.multiple, true) };
    if (reverse) rel.reverse = reverse;
    if (backattribute) {
      rel.backattribute = backattribute;
      rel.backname = reverse;
      rel.backmultiple = bool(o.backmultiple, true);
    }
    relations.push(rel);
  });
  return { relations, problems };
}

/** A term no page matches (no path holds this character): what a query of another workspace is here. */
export const NO_PAGE = 'path:"\u0001"';

/**
 * A saved query is one unit: with an OR at its top level it is put in parentheses, so that terms written next to
 * `saved:name` apply to all of it (`saved:x title:a` is not `A OR (B title:a)`). Its sort terms stay outside.
 */
export function asUnit(text) {
  const toks = tokenize(text);
  let depth = 0;
  let or = false;
  for (const t of toks) {
    if (t.punct === '(') depth++;
    else if (t.punct === ')') depth--;
    else if (depth === 0 && t.kw === 'OR') or = true;
  }
  if (!or) return text;
  const sorts = toks.filter((t) => t.key === 'sort' && !t.punct).map((t) => t.raw);
  const rest = toks.filter((t) => !(t.key === 'sort' && !t.punct)).map((t) => t.raw);
  return [`( ${rest.join(' ')} )`, ...sorts].join(' ');
}

/**
 * Replace every `saved:name` term by that query's text (which may use `saved:` itself).
 * A name that does not exist, or a query that uses itself, is left out and reported in `errors`.
 */
export function expandSaved(input, byName, errors = [], stack = []) {
  const text = String(input ?? '');
  if (!/saved:/i.test(text)) return text;
  const out = [];
  for (const t of tokenize(text)) {
    if (t.key !== 'saved') {
      out.push(t.raw);
      continue;
    }
    if (t.value === '') continue; // still typing
    if (t.value.includes('::')) {
      errors.push(`saved:${t.value} is a query of another workspace; it can be used in a view, joined to the rest by OR, but not here.`);
      // it finds no page of this workspace; left out altogether, a query of nothing else would find every page
      out.push(NO_PAGE);
      continue;
    }
    const key = t.value.trim().toLowerCase();
    const body = byName.get(key);
    if (t.negated) errors.push(`saved:${t.value} cannot be negated; write the opposite query instead`);
    else if (body === undefined) errors.push(`There is no saved query named "${t.value}".`);
    else if (stack.includes(key) || stack.length >= MAX_DEPTH) errors.push(`The saved query "${t.value}" uses itself.`);
    else out.push(asUnit(expandSaved(body, byName, errors, [...stack, key])));
  }
  return out.join(' ');
}
