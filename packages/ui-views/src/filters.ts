import { quoteValue, tokenize, type Token } from '@cave-notes/ui-search';

/** A column a filter can be about: a page attribute or one of the built-in search keys. */
export interface FieldInfo {
  key: string;
  /** string | number | date | bool, plus the built-ins text | page | flag */
  type: string;
  list?: boolean;
  /** known values (an enum from the schema, or the flags of `is:`) */
  values?: string[];
  /** a built-in key rather than a frontmatter attribute */
  builtin?: boolean;
}

export type Op = 'is' | 'is-not' | 'has' | 'has-not' | 'lt' | 'lte' | 'gt' | 'gte' | 'between';

export interface Clause {
  field: string;
  op: Op;
  values: string[];
}

export const BUILTIN_FIELDS: FieldInfo[] = [
  { key: 'title', type: 'text', builtin: true },
  { key: 'under', type: 'page', builtin: true },
  { key: 'is', type: 'flag', values: ['orphan', 'broken', 'ambiguous', 'virtual', 'leaf', 'root'], builtin: true },
  { key: 'links-to', type: 'page', builtin: true },
  { key: 'linked-from', type: 'page', builtin: true },
  { key: 'over', type: 'page', builtin: true },
  { key: 'parent', type: 'page', builtin: true },
  { key: 'children', type: 'page', builtin: true },
];

const BUILTIN_KEYS = new Set(BUILTIN_FIELDS.map((f) => f.key));

export function fieldsFor(keys: Array<{ key: string; type: string; list?: boolean; values?: string[] }>): FieldInfo[] {
  const attrs = keys.filter((k) => !BUILTIN_KEYS.has(k.key)).map<FieldInfo>((k) => ({ key: k.key, type: k.type, ...(k.list ? { list: true } : {}), ...(k.values?.length ? { values: k.values } : {}) }));
  return [...BUILTIN_FIELDS, ...attrs];
}

export function opsFor(f: FieldInfo): Array<{ op: Op; label: string }> {
  const has = [{ op: 'has' as Op, label: 'has a value' }, { op: 'has-not' as Op, label: 'is empty' }];
  if (f.type === 'flag') return [{ op: 'is', label: 'is' }, { op: 'is-not', label: 'is not' }];
  if (f.builtin) return [{ op: 'is', label: f.type === 'page' ? 'is' : 'contains' }, { op: 'is-not', label: f.type === 'page' ? 'is not' : 'does not contain' }];
  if (f.type === 'bool') return [{ op: 'is', label: 'is' }, ...has];
  if (f.type === 'date') {
    return [{ op: 'is', label: 'is' }, { op: 'lt', label: 'is before' }, { op: 'gt', label: 'is after' }, { op: 'lte', label: 'is on or before' }, { op: 'gte', label: 'is on or after' }, { op: 'between', label: 'is between' }, ...has];
  }
  if (f.type === 'number') {
    return [{ op: 'is', label: '=' }, { op: 'lt', label: '<' }, { op: 'lte', label: '≤' }, { op: 'gt', label: '>' }, { op: 'gte', label: '≥' }, { op: 'between', label: 'is between' }, ...has];
  }
  return [{ op: 'is', label: f.list ? 'contains' : 'is' }, { op: 'is-not', label: f.list ? 'does not contain' : 'is not' }, ...has];
}

export type Control = 'none' | 'choice' | 'multi' | 'text' | 'date' | 'date-range' | 'number' | 'number-range';

/** Which kind of input suits a field and operator. */
export function controlFor(f: FieldInfo, op: Op): Control {
  if (op === 'has' || op === 'has-not') return 'none';
  if (op === 'between') return f.type === 'date' ? 'date-range' : 'number-range';
  if (f.type === 'bool') return 'choice';
  if (f.type === 'flag') return 'choice';
  if (f.type === 'date') return 'date';
  if (f.type === 'number') return 'number';
  if (f.values?.length) return op === 'is' || op === 'is-not' ? 'multi' : 'choice';
  return 'text';
}

const CMP: Record<string, Op> = { '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };
const CMP_SYM: Record<string, string> = { lt: '<', lte: '<=', gt: '>', gte: '>=' };

/** A query token as a clause, or null when it is something else (a plain word, a sort, an odd form). */
export function parseClauseToken(t: Token): Clause | null {
  if (t.key === null || t.key === 'sort' || t.value === '') return null;
  if (t.key === 'has') return { field: t.value, op: t.negated ? 'has-not' : 'has', values: [] };
  if (t.quoted) return { field: t.key, op: t.negated ? 'is-not' : 'is', values: [t.value] };
  const cmp = /^(<=|>=|<|>)(.+)$/.exec(t.value);
  if (cmp) return t.negated ? null : { field: t.key, op: CMP[cmp[1]!]!, values: [cmp[2]!] };
  const range = /^(.+)\.\.(.+)$/.exec(t.value);
  if (range) return t.negated ? null : { field: t.key, op: 'between', values: [range[1]!, range[2]!] };
  if (/[*?]/.test(t.value) && t.key !== 'title') return null;
  return { field: t.key, op: t.negated ? 'is-not' : 'is', values: t.value.split(',').filter(Boolean) };
}

export function clauseToToken(c: Clause): string | null {
  if (c.op === 'has') return `has:${c.field}`;
  if (c.op === 'has-not') return `-has:${c.field}`;
  const vals = c.values.filter((v) => v !== '');
  if (vals.length === 0) return null;
  if (c.op === 'between') return vals.length === 2 ? `${c.field}:${vals[0]}..${vals[1]}` : null;
  if (c.op in CMP_SYM) return `${c.field}:${CMP_SYM[c.op]}${vals[0]}`;
  const neg = c.op === 'is-not' ? '-' : '';
  return `${neg}${c.field}:${vals.length === 1 ? quoteValue(vals[0]!) : vals.join(',')}`;
}

export interface ClauseRow {
  clause: Clause;
  token: Token;
}

/** The filter clauses in a query, in order, each with its position in the text. */
export function clausesOf(query: string): ClauseRow[] {
  const out: ClauseRow[] = [];
  for (const token of tokenize(query)) {
    const clause = parseClauseToken(token);
    if (clause) out.push({ clause, token });
  }
  return out;
}

const tidy = (s: string): string => s.replace(/\s{2,}/g, ' ').trim();

/** Replace the token's text with the clause (or remove it when the clause is null or unfinished). */
export function replaceClause(query: string, token: Pick<Token, 'start' | 'end'>, clause: Clause | null): string {
  const text = clause ? clauseToToken(clause) : null;
  return tidy(`${query.slice(0, token.start)} ${text ?? ''} ${query.slice(token.end)}`);
}

export function appendClause(query: string, clause: Clause): string {
  const text = clauseToToken(clause);
  return text ? tidy(`${query} ${text}`) : query;
}

/** A sensible first operator and value for a newly added filter row. */
export function defaultClause(f: FieldInfo): Clause {
  const op = opsFor(f)[0]!.op;
  return { field: f.key, op, values: [] };
}
