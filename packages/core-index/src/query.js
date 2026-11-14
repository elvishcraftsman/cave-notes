/**
 * Query language
 * --------------
 *   grace                     full-text (every bare word matches as the start of a word; quote it for an exact word)
 *   "justification by faith"  phrase
 *   -heresy                   exclude pages matching a word/phrase
 *   title:grace  body:grace   restrict full-text to one column
 *   status:draft              attribute equals (case-insensitive)
 *   status:draft,review       any of
 *   -status:done              negation
 *   tags:a tags:b             list attributes: all of
 *   due:<2026-12-01  weight:>=5  due:2026-01-01..2026-03-31  weight:..10
 *   name:Gr*                  trailing * = prefix match
 *   has:due                   attribute exists
 *   is:orphan|broken|ambiguous|virtual|leaf|root
 *   under:"Theology/Soteriology"   pages beneath that page
 *   over:"Theology/Soteriology"    the pages above it (its ancestors); parent: only the direct parent; children: only the direct sub-pages
 *   links-to:Grace  backlinks:Grace  linked-from:Theology
 *   path:soter   heading:imputation
 *   sort:due  sort:-title  sort:rank,title     (rank | title | path | mtime | order | <attribute>)
 *
 * Groups:  (a OR b)  a AND b  NOT a  -(a b)      AND is implied between terms; OR binds looser than AND.
 *   status:todo (owner:ann OR owner:bo) NOT tags:later
 *
 * Today:   due:$now.day  due:$now.month  due:<$now.week  due:$now.month-1..$now.month   whole periods of today's date
 *   $now.day  $now.week  $now.month  $now.year  (a trailing +N or -N moves by that many periods)
 *
 * Date parts, whatever the year (or month ...):  due.month:$now.month   due.day:$now.day due.month:$now.month
 *   .year  .month  .day  .weekday (1 = Monday)  .week (of the year, weeks start Monday); values may be 5, 3..6, 11..2, $now.month+1
 *
 * Every page also has `filename` (with extension) and `filetype` (extension, lower case), and `mtime`, the date its file
 * was last changed, which takes dates like an attribute does: mtime:<$now.day-30  mtime:$now.week  mtime:>2026-01-01
 */
import { parseDate, parseNumber } from './attrs.js';
import { pageFolder } from '@cave-notes/core-tree';

export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

const SPECIAL_KEYS = new Set([
  'has', 'is', 'under', 'over', 'parent', 'children', 'links-to', 'backlinks', 'linked-from', 'path', 'heading', 'sort', 'title', 'body',
]);
const IS_VALUES = new Set(['orphan', 'broken', 'ambiguous', 'virtual', 'leaf', 'root', 'file', 'note']);
const KEY_RE = /^([A-Za-z_][\w.-]*):/;
const OPS = ['<=', '>=', '<', '>', '='];

/**
 * Split input into tokens, honoring double quotes. Besides terms there are the group marks "(" and ")"
 * (token.punct, "-(" is a negated group) and the words OR, AND, NOT (token.kw).
 */
export function tokenize(input) {
  const tokens = [];
  const n = input.length;
  let i = 0;
  let depth = 0;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;
    const start = i;
    let negated = false;
    if (input[i] === '-' && i + 1 < n && !/\s/.test(input[i + 1])) {
      negated = true;
      i++;
    }
    if (input[i] === '(') {
      i++;
      depth++;
      tokens.push({ raw: input.slice(start, i), negated, key: null, value: '', quoted: false, punct: '(' });
      continue;
    }
    if (input[i] === ')' && !negated && depth > 0) {
      i++;
      depth--;
      tokens.push({ raw: ')', negated: false, key: null, value: '', quoted: false, punct: ')' });
      continue;
    }
    let key = null;
    const m = KEY_RE.exec(input.slice(i, i + 64));
    if (m) {
      key = m[1].toLowerCase();
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
      i++; // closing quote (or end of input while typing)
    } else {
      while (i < n && !/\s/.test(input[i]) && !(input[i] === ')' && depth > 0)) value += input[i++];
    }
    const tok = { raw: input.slice(start, Math.min(i, n)), negated, key, value, quoted };
    if (key === null && !quoted && !negated && (value === 'OR' || value === 'AND' || value === 'NOT')) tok.kw = value;
    tokens.push(tok);
  }
  return tokens;
}

/** Parse an attribute value expression into a spec. */
function parseValueSpec(value, quoted) {
  if (quoted) return { kind: 'any', values: [value] };
  for (const op of OPS) {
    if (value.startsWith(op) && value.length > op.length) {
      return op === '=' ? { kind: 'any', values: [value.slice(1)] } : { kind: 'cmp', op, value: value.slice(op.length) };
    }
  }
  const dots = value.indexOf('..');
  if (dots >= 0 && value !== '..') {
    return { kind: 'range', lo: value.slice(0, dots) || null, hi: value.slice(dots + 2) || null };
  }
  return { kind: 'any', values: value.split(',').filter((v) => v !== '') };
}

/** One token as a term, or null when it is not finished yet ("status:") or means nothing. */
function termFromToken(t) {
  if (t.key === null) {
    if (t.value === '' || (t.value === '-' && !t.quoted)) return null;
    return { raw: t.raw, type: 'text', negated: t.negated, value: t.value, phrase: t.quoted };
  }
  if (t.value === '') return null;
  if (t.key === 'title' || t.key === 'body') {
    return { raw: t.raw, type: 'text', negated: t.negated, value: t.value, phrase: t.quoted, column: t.key };
  }
  if (SPECIAL_KEYS.has(t.key)) {
    const values = t.quoted ? [t.value] : t.value.split(',').filter((v) => v !== '');
    return { raw: t.raw, type: 'special', negated: t.negated, key: t.key, values };
  }
  return { raw: t.raw, type: 'attr', negated: t.negated, key: t.key, ...parseValueSpec(t.value, t.quoted) };
}

/**
 * Parse a query string into terms (for compiling, and for rendering filter chips).
 * Incomplete tokens such as "status:" (while typing) are skipped. Terms are ANDed. A group, an OR, or a NOT in front
 * of one is a term of type "group": { op: "and" | "or", negated, children, raw }.
 */
export function parseQuery(input) {
  const toks = tokenize(String(input ?? ''));
  let pos = 0;
  const peek = () => toks[pos];

  const group = (op, children, negated, raw) => ({ raw, type: 'group', op, negated, children });
  const rawOf = (from, to) => toks.slice(from, to).map((t) => t.raw).join(' ');

  // unary := NOT unary | -( expr ) | ( expr ) | term
  function unary() {
    const t = peek();
    if (!t) return null;
    const from = pos;
    if (t.kw === 'NOT') {
      pos++;
      const inner = unary();
      if (!inner) return null;
      const copy = { ...inner, negated: !inner.negated };
      if (inner.type === 'group') copy.raw = rawOf(from, pos);
      return copy;
    }
    if (t.punct === '(') {
      pos++;
      const inner = orExpr();
      if (peek() && peek().punct === ')') pos++; // an unclosed group is closed at the end while typing
      if (!inner) return null;
      const g = inner.type === 'group' && !inner.negated ? { ...inner } : group('and', [inner], false, '');
      g.negated = t.negated;
      g.raw = rawOf(from, pos);
      return g;
    }
    pos++;
    return termFromToken(t);
  }

  // andExpr := unary ((AND)? unary)*
  function andExpr() {
    const items = [];
    while (peek() && peek().kw !== 'OR' && peek().punct !== ')') {
      if (peek().kw === 'AND') {
        pos++;
        continue;
      }
      const u = unary();
      if (u) items.push(u);
    }
    return items;
  }

  // chains := andExpr (OR andExpr)*   -> the AND chains that are ORed (one chain: no OR)
  function chains() {
    const out = [andExpr()];
    while (peek() && peek().kw === 'OR') {
      pos++;
      out.push(andExpr());
    }
    return out.filter((c) => c.length > 0);
  }

  const chainTerm = (c) => (c.length === 1 ? c[0] : group('and', c, false, c.map((x) => x.raw).join(' ')));
  function orExpr() {
    const from = pos;
    const cs = chains();
    if (cs.length === 0) return null;
    if (cs.length === 1) return chainTerm(cs[0]);
    return group('or', cs.map(chainTerm), false, rawOf(from, pos));
  }

  const terms = [];
  while (pos < toks.length) {
    const from = pos;
    const cs = chains();
    if (cs.length === 1) terms.push(...cs[0]);
    else if (cs.length > 1) terms.push(group('or', cs.map(chainTerm), false, rawOf(from, pos)));
    if (pos < toks.length && toks[pos].punct === ')') pos++; // a stray ")"
    if (pos === from) pos++;
  }
  return { terms };
}

const ftsQuote = (s) => `"${s.replace(/"/g, '""')}"`;
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function numeric(value) {
  const d = parseDate(value);
  if (d !== null) return { type: 'date', num: d };
  const n = parseNumber(value);
  return n === null ? null : { type: 'number', num: n };
}

// ---------------------------------------------------------------- today and date parts

const DAY_MS = 86400000;

/** The day a week starts on (0 = Sunday ... 6 = Saturday); `$now.week` and the `week` part of a date follow it. */
let weekStart = 0;
export function setWeekStart(day) {
  const n = Number(day);
  weekStart = Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
}
export const getWeekStart = () => weekStart;
/** Days to add to a date so that the first day of the week counts as a Monday (what SQLite's %W and weekOfYear assume). */
const weekShift = () => (8 - weekStart) % 7;
const PERIODS = new Set(['day', 'week', 'month', 'year']);
const PARTS = ['year', 'month', 'day', 'weekday', 'week'];

/** Today as a UTC midnight timestamp, from the calendar date where the person is (dates are stored as UTC midnights). */
function todayUtc(now) {
  const d = now instanceof Date ? now : new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `$now`, `$now.month`, `$now.week-1` ... as { unit, offset }, or null if the text is not one. */
function parseNow(text) {
  const m = /^\$now(?:\.([a-z]+))?(?:([+-])(\d+))?$/i.exec(String(text).trim());
  if (!m) return null;
  const unit = (m[1] ?? 'day').toLowerCase();
  if (!PERIODS.has(unit) && unit !== 'weekday') return null;
  return { unit, offset: m[2] ? (m[2] === '-' ? -1 : 1) * parseInt(m[3], 10) : 0 };
}

/** First and last millisecond (UTC) of the day, week (starting on the chosen day), month or year `offset` periods from today. */
export function periodRange(unit, offset, now) {
  const t = todayUtc(now);
  const d = new Date(t);
  let lo;
  let hiExclusive;
  if (unit === 'day') {
    lo = t + offset * DAY_MS;
    hiExclusive = lo + DAY_MS;
  } else if (unit === 'week') {
    const first = t - ((d.getUTCDay() - weekStart + 7) % 7) * DAY_MS;
    lo = first + offset * 7 * DAY_MS;
    hiExclusive = lo + 7 * DAY_MS;
  } else if (unit === 'month') {
    lo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
    hiExclusive = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 1);
  } else {
    lo = Date.UTC(d.getUTCFullYear() + offset, 0, 1);
    hiExclusive = Date.UTC(d.getUTCFullYear() + offset + 1, 0, 1);
  }
  return { lo, hi: hiExclusive - 1 };
}

/** Number of the week of the year, as SQLite's %W counts it for weeks that start on the chosen day (days before the first one are week 0). */
function weekOfYear(ms0) {
  const ms = ms0 + weekShift() * DAY_MS;
  const d = new Date(ms);
  const yday = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);
  return Math.floor((yday + 7 - ((d.getUTCDay() + 6) % 7)) / 7);
}

/** The number a date part takes for `$now.<unit>±N` or a plain integer; null if neither. */
function partValue(text, part, now) {
  const n = parseNow(text);
  if (n) {
    const t = todayUtc(now);
    const d = new Date(t);
    if (n.unit !== part) return null;
    switch (part) {
      case 'year': return d.getUTCFullYear() + n.offset;
      case 'month': return ((((d.getUTCMonth() + n.offset) % 12) + 12) % 12) + 1;
      case 'day': return new Date(t + n.offset * DAY_MS).getUTCDate();
      case 'weekday': return ((((((d.getUTCDay() + 6) % 7) + n.offset) % 7) + 7) % 7) + 1;
      default: return weekOfYear(t + n.offset * 7 * DAY_MS);
    }
  }
  return /^-?\d+$/.test(String(text).trim()) ? parseInt(text, 10) : null;
}

const PART_SQL = {
  year: "CAST(strftime('%Y', a.num_value / 1000, 'unixepoch') AS INTEGER)",
  month: "CAST(strftime('%m', a.num_value / 1000, 'unixepoch') AS INTEGER)",
  day: "CAST(strftime('%d', a.num_value / 1000, 'unixepoch') AS INTEGER)",
  weekday: "((CAST(strftime('%w', a.num_value / 1000, 'unixepoch') AS INTEGER) + 6) % 7 + 1)",
  week: () => `CAST(strftime('%W', a.num_value / 1000 + ${weekShift() * 86400}, 'unixepoch') AS INTEGER)`,
};

/** `due.month` -> { key: 'due', part: 'month' }, or null. */
function splitPart(key) {
  const i = key.lastIndexOf('.');
  if (i <= 0) return null;
  const part = key.slice(i + 1);
  return PARTS.includes(part) ? { key: key.slice(0, i), part } : null;
}

/** Condition on a part of a date attribute: due.month:$now.month, due.day:1..7 */
function partCondition(term, base, part, now, errors) {
  const expr0 = PART_SQL[part];
  const expr = typeof expr0 === 'function' ? expr0() : expr0;
  const conds = [];
  const params = [base];
  const num = (v) => {
    const x = partValue(v, part, now);
    if (x === null) errors.push(`${term.raw}: "${v}" is not a number for ${part}`);
    return x;
  };
  if (term.kind === 'any') {
    const vals = term.values.map(num).filter((x) => x !== null);
    if (vals.length === 0) return null;
    conds.push(`${expr} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  } else if (term.kind === 'cmp') {
    const x = num(term.value);
    if (x === null) return null;
    conds.push(`${expr} ${term.op} ?`);
    params.push(x);
  } else {
    const lo = term.lo === null ? null : num(term.lo);
    const hi = term.hi === null ? null : num(term.hi);
    if ((term.lo !== null && lo === null) || (term.hi !== null && hi === null)) return null;
    if (lo !== null && hi !== null && lo > hi && (part === 'month' || part === 'weekday' || part === 'week' || part === 'day')) {
      // a range that runs past the end of the cycle: 11..2 is November to February
      conds.push(`(${expr} >= ? OR ${expr} <= ?)`);
      params.push(lo, hi);
    } else {
      if (lo !== null) { conds.push(`${expr} >= ?`); params.push(lo); }
      if (hi !== null) { conds.push(`${expr} <= ?`); params.push(hi); }
    }
  }
  return { sql: `p.id IN (SELECT a.page_id FROM attrs a WHERE a.key = ? AND a.type = 'date' AND ${conds.join(' AND ')})`, params };
}

// ---------------------------------------------------------------- file name and type

/** The last part of a path, as SQL. */
const BASENAME_SQL = "(CASE WHEN p.is_virtual = 1 THEN NULL ELSE replace(p.path, rtrim(p.path, replace(p.path, '/', '')), '') END)";
const FILETYPE_SQL = `(CASE WHEN ${BASENAME_SQL} IS NULL OR instr(${BASENAME_SQL}, '.') = 0 OR substr(${BASENAME_SQL}, 1, 1) = '.' THEN NULL ELSE lower(replace(${BASENAME_SQL}, rtrim(${BASENAME_SQL}, replace(${BASENAME_SQL}, '.', '')), '')) END)`;
const VIRTUAL_ATTRS = { filename: BASENAME_SQL, filetype: FILETYPE_SQL };

/** Condition on filename / filetype, which every page has without writing them anywhere. */
function virtualCondition(term, expr, errors) {
  const params = [];
  const eq = (v) => {
    if (v.endsWith('*') && v.length > 1) {
      params.push(`${escapeLike(v.slice(0, -1))}%`);
      return `${expr} LIKE ? ESCAPE '\\'`;
    }
    params.push(v);
    return `${expr} = ? COLLATE NOCASE`;
  };
  if (term.kind === 'any') {
    if (term.values.length === 0) return null;
    // "filetype:.md" and "filetype:md" mean the same
    const vals = term.values.map((v) => (expr === FILETYPE_SQL ? v.replace(/^\./, '') : v));
    // COALESCE: a file with no type is not "csv", so -filetype:csv keeps it (NULL would drop it)
    return { sql: `COALESCE((${vals.map(eq).join(' OR ')}), 0)`, params };
  }
  errors.push(`${term.raw}: filename and filetype take plain values (use name* to match a start)`);
  return null;
}

/**
 * `mtime:` is when the page's file was last changed. It takes the same dates as an attribute: `mtime:<$now.day-30`
 * (not touched for 30 days), `mtime:$now.week`, `mtime:>2026-01-01`, `mtime:2026-01-01..2026-03-31`. Days are whole days.
 */
function mtimeCondition(term, errors, now) {
  const period = (v) => {
    const p = parseNow(v);
    return p && PERIODS.has(p.unit) ? periodRange(p.unit, p.offset, now) : null;
  };
  /** First and last millisecond a value stands for: a period, or one day. */
  const span = (v) => {
    const r = period(v);
    if (r) return r;
    const d = parseDate(v);
    if (d === null) {
      errors.push(`${term.raw}: "${v}" is not a date`);
      return null;
    }
    return { lo: d, hi: d + DAY_MS - 1 };
  };
  const col = 'p.mtime_ms';
  // a folder without a page of its own has no file, so no modification time
  const real = (c) => ({ sql: `(p.is_virtual = 0 AND ${c.sql})`, params: c.params });
  if (term.kind === 'any') {
    const parts = [];
    const params = [];
    for (const v of term.values) {
      const r = span(v);
      if (!r) return null;
      parts.push(`(${col} >= ? AND ${col} <= ?)`);
      params.push(r.lo, r.hi);
    }
    return parts.length === 0 ? null : real({ sql: `(${parts.join(' OR ')})`, params });
  }
  const conds = [];
  const params = [];
  const bound = (op, v) => {
    const r = span(v);
    if (!r) return false;
    conds.push(`${col} ${op} ?`);
    params.push({ '<': r.lo, '>=': r.lo, '<=': r.hi, '>': r.hi }[op]);
    return true;
  };
  if (term.kind === 'cmp') {
    if (!bound(term.op === '=' ? '>=' : term.op, term.value)) return null;
    if (term.op === '=') {
      if (!bound('<=', term.value)) return null;
    }
  } else {
    if (term.lo !== null && !bound('>=', term.lo)) return null;
    if (term.hi !== null && !bound('<=', term.hi)) return null;
  }
  return conds.length === 0 ? null : real({ sql: `(${conds.join(' AND ')})`, params });
}

/** SQL condition on one attribute for a parsed spec. */
function attrCondition(term, errors, now, ctx = {}) {
  if (term.key === 'mtime') return mtimeCondition(term, errors, now);
  const virtual = VIRTUAL_ATTRS[term.key];
  if (virtual) return virtualCondition(term, virtual, errors);
  const sp = splitPart(term.key);
  if (sp) return partCondition(term, sp.key, sp.part, now, errors);

  const params = [term.key];
  const base = 'p.id IN (SELECT a.page_id FROM attrs a WHERE a.key = ?';

  // $now.month and the like are whole periods: "is" the period is a range, and the comparisons use its edges
  const nowOf = (v) => {
    const p = parseNow(v);
    return p && PERIODS.has(p.unit) ? periodRange(p.unit, p.offset, now) : null;
  };

  if (term.kind === 'any') {
    if (term.values.length === 0) return null;
    const ors = term.values.map((v) => {
      // [[Page]]: attributes that hold a link to that page (not the plain words)
      const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(v.trim());
      if (link) {
        const ids = (ctx.attrLinkPages?.(term.key, link[1].trim()) ?? []).filter(Number.isInteger);
        return ids.length ? `a.page_id IN (${ids.join(',')})` : '0';
      }
      const r = nowOf(v);
      if (r) {
        params.push(r.lo, r.hi);
        return "(a.type = 'date' AND a.num_value >= ? AND a.num_value <= ?)";
      }
      if (v.endsWith('*') && v.length > 1) {
        params.push(`${escapeLike(v.slice(0, -1))}%`);
        return "a.text_value LIKE ? ESCAPE '\\'";
      }
      params.push(v);
      return 'a.text_value = ? COLLATE NOCASE';
    });
    return { sql: `${base} AND (${ors.join(' OR ')}))`, params };
  }

  const bounds = [];
  const dateBound = (op, v) => {
    const r = nowOf(v);
    if (!r) return false;
    // before a period: before its start; after it: after its end; "on or before" / "on or after" take the far edge
    const edge = { '<': r.lo, '>=': r.lo, '<=': r.hi, '>': r.hi }[op];
    bounds.push([op, edge, true]);
    return true;
  };
  let allNow = true;
  if (term.kind === 'cmp') {
    allNow = dateBound(term.op, term.value);
    if (!allNow) bounds.push([term.op, term.value]);
  } else {
    if (term.lo !== null) {
      // a range starts at the start of its first period and ends at the end of its last
      const r = nowOf(term.lo);
      if (r) bounds.push(['>=', r.lo, true]);
      else {
        allNow = false;
        bounds.push(['>=', term.lo]);
      }
    }
    if (term.hi !== null) {
      const r = nowOf(term.hi);
      if (r) bounds.push(['<=', r.hi, true]);
      else {
        allNow = false;
        bounds.push(['<=', term.hi]);
      }
    }
  }
  if (bounds.length === 0) return null;
  const anyNow = bounds.some((b) => b[2]);
  if (anyNow) {
    // mixing "$now" with a literal date works: the literal is read as a date
    const conds = ["a.type = 'date'"];
    for (const [op, v, isNum] of bounds) {
      let num = v;
      if (!isNum) {
        const d = numeric(v);
        if (!d || d.type !== 'date') {
          errors.push(`${term.raw}: "${v}" is not a date`);
          return null;
        }
        num = d.num;
      }
      conds.push(`a.num_value ${op} ?`);
      params.push(num);
    }
    return { sql: `${base} AND ${conds.join(' AND ')})`, params };
  }
  void allNow;
  const nums = bounds.map(([, v]) => numeric(v));
  const useNum = nums.every((x) => x !== null);
  if (useNum && new Set(nums.map((x) => x.type)).size > 1) {
    errors.push(`${term.raw}: cannot compare a date with a number`);
    return null;
  }
  const conds = [];
  if (useNum) {
    params.push(nums[0].type);
    conds.push('a.type = ?');
    bounds.forEach(([op], i) => {
      conds.push(`a.num_value ${op} ?`);
      params.push(nums[i].num);
    });
  } else {
    bounds.forEach(([op, v]) => {
      conds.push(`a.text_value COLLATE NOCASE ${op} ? COLLATE NOCASE`);
      params.push(v);
    });
  }
  return { sql: `${base} AND ${conds.join(' AND ')})`, params };
}

const TRUE_SQL = "((a.type = 'bool' AND a.num_value = 1) OR lower(a.text_value) = 'true')";

/** Where `hidden` can hide a page. `files` is another name for `tree`, `query` for `queries`. */
export const HIDDEN_AREAS = ['tree', 'children', 'search', 'queries'];
const AREA_NAMES = { tree: ['tree', 'files'], children: ['children'], search: ['search'], queries: ['queries', 'query'] };
/** The area a word in a query (`hidden:query`, `hidden:files`) names, or null. */
export const hiddenAreaOf = (word) => HIDDEN_AREAS.find((a) => AREA_NAMES[a].includes(String(word).trim().toLowerCase())) ?? null;
/**
 * The attribute rows that hide a page from `area`: `hidden: true` or `all` (everywhere), or the names of the places, as a list
 * (`[tree, children]`, one row each) or in one line (`tree, children`). `false`, other words and no value hide nothing.
 */
export function hiddenWhere(area) {
  const names = AREA_NAMES[area] ?? [area];
  const line = "(',' || replace(replace(lower(a.text_value), ' ', ''), char(9), '') || ',')";
  const hit = ['all', 'true', ...names].map((n) => `${line} LIKE '%,${n},%'`).join(' OR ');
  return `lower(a.key) = 'hidden' AND (${TRUE_SQL} OR (a.type != 'bool' AND (${hit})))`;
}
/**
 * The pages hidden from `area`: those whose `hidden` says so, and templates (`template: true`) with no `hidden` attribute of
 * their own, which count as `hidden: all`.
 */
export const hiddenIdsSql = (area) => `SELECT a.page_id FROM attrs a WHERE ${hiddenWhere(area)}
  UNION SELECT a.page_id FROM attrs a WHERE lower(a.key) = 'template' AND ${TRUE_SQL}
    AND a.page_id NOT IN (SELECT page_id FROM attrs WHERE lower(key) = 'hidden')`;

const BUILTIN_SORTS = {
  rank: null,
  title: 'p.title COLLATE NOCASE',
  name: 'p.name COLLATE NOCASE',
  path: 'p.path',
  mtime: 'p.mtime_ms',
  modified: 'p.mtime_ms',
  order: 'p.sort_order',
  filename: `${BASENAME_SQL} COLLATE NOCASE`,
  filetype: FILETYPE_SQL,
};

/**
 * Compile a parsed query to SQL.
 *
 * @param {{terms: object[]}} parsed
 * @param {object} ctx
 * @param {(nameOrPath: string) => ({id:number,path:string}|null)} ctx.resolvePage
 * @param {boolean} [ctx.prefixLast=true]  prefix-match every bare word (search as you type)
 */
export function compileQuery(parsed, ctx, { limit = 100, offset = 0 } = {}) {
  const errors = [];
  const where = [];
  const params = [];
  const fts = [];
  const ftsNeg = [];
  const sorts = [];
  const prefixLast = ctx.prefixLast !== false;


  const now = ctx.now ?? new Date();

  /**
   * The SQL condition of a term that is not a full-text word: { sql, params } or null. Inside a group, words too
   * (as a lookup in the full-text table), so they can be ORed and negated like the rest.
   */
  function condition(t, inGroup) {
    if (t.type === 'text') {
      if (!inGroup) return null;
      let expr = ftsQuote(t.value);
      if (!t.phrase && t.value.endsWith('*') && t.value.length > 1) expr = `${ftsQuote(t.value.slice(0, -1))}*`;
      if (t.column) expr = `${t.column} : ${expr}`;
      return { sql: 'p.id IN (SELECT rowid FROM pages_fts WHERE pages_fts MATCH ?)', params: [expr] };
    }
    if (t.type === 'group') {
      const parts = [];
      const gp = [];
      for (const child of t.children) {
        const c = condition(child, true);
        if (!c) continue;
        parts.push(child.negated ? `NOT ${c.sql}` : c.sql);
        gp.push(...c.params);
      }
      if (parts.length === 0) return null;
      return { sql: `(${parts.join(t.op === 'or' ? ' OR ' : ' AND ')})`, params: gp };
    }
    if (t.type === 'attr') {
      // `hidden:query` (or tree, files, children, search) also finds the pages that are `hidden: all` or `true`
      if (String(t.key).toLowerCase() === 'hidden' && t.kind === 'any' && t.values?.length > 0) {
        const areas = t.values.map(hiddenAreaOf);
        if (areas.every(Boolean)) return { sql: `(${areas.map((a) => `p.id IN (SELECT a.page_id FROM attrs a WHERE ${hiddenWhere(a)})`).join(' OR ')})`, params: [] };
      }
      return attrCondition(t, errors, now, ctx);
    }
    let cond = null;
    let condParams = [];
    switch (t.key) {
        case 'has':
          cond = `(${t.values.map(() => "p.id IN (SELECT a.page_id FROM attrs a WHERE a.key = ? AND a.text_value != '')").join(' OR ')})`;
          condParams = [...t.values];
          break;
        case 'is': {
          const parts = [];
          for (const v of t.values.map((x) => x.toLowerCase())) {
            if (!IS_VALUES.has(v)) {
              errors.push(`${t.raw}: unknown value "${v}" (use ${[...IS_VALUES].join(', ')})`);
              continue;
            }
            parts.push(
              {
                orphan: 'p.is_virtual < 2 AND NOT EXISTS (SELECT 1 FROM links l WHERE l.target_page_id = p.id AND l.page_id != p.id)',
                broken: "p.id IN (SELECT page_id FROM links WHERE status = 'broken')",
                ambiguous: "p.id IN (SELECT page_id FROM links WHERE status = 'ambiguous')",
                virtual: 'p.is_virtual = 1',
                leaf: 'p.is_virtual < 2 AND NOT EXISTS (SELECT 1 FROM pages c WHERE c.parent_path = p.path AND c.is_virtual < 2)',
                root: 'p.parent_path IS NULL AND p.is_virtual < 2',
                file: 'p.is_virtual = 2',
                note: 'p.is_virtual < 2',
              }[v],
            );
          }
          cond = parts.length ? `(${parts.join(' OR ')})` : null;
          break;
        }
        case 'under': {
          const parts = [];
          for (const v of t.values) {
            const page = ctx.resolvePage(v);
            // a folder with no page of its own (only files, say) still works as a place to look under
            const folder = page ? pageFolder(page.path) : ctx.resolveFolder?.(v) ?? null;
            if (folder === null) {
              parts.push('0');
              continue;
            }
            parts.push("p.path LIKE ? ESCAPE '\\'");
            condParams.push(`${escapeLike(folder)}/%`);
          }
          cond = `(${parts.join(' OR ')})`;
          break;
        }
        case 'over':
        case 'parent': {
          const parts = [];
          for (const v of t.values) {
            const up = ctx.ancestorsOf?.(v) ?? [];
            const use = t.key === 'parent' ? up.slice(0, 1) : up;
            if (use.length === 0) {
              parts.push('0');
              continue;
            }
            parts.push(`p.path IN (${use.map(() => '?').join(',')})`);
            condParams.push(...use);
          }
          cond = `(${parts.join(' OR ')})`;
          break;
        }
        case 'children': {
          const parts = [];
          for (const v of t.values) {
            const page = ctx.resolvePage(v);
            const folder = page ? pageFolder(page.path) : ctx.resolveFolder?.(v) ?? null;
            if (folder === null) {
              parts.push('0');
              continue;
            }
            parts.push("(p.path LIKE ? ESCAPE '\\' AND p.path NOT LIKE ? ESCAPE '\\')");
            condParams.push(`${escapeLike(folder)}/%`, `${escapeLike(folder)}/%/%`);
          }
          cond = `(${parts.join(' OR ')})`;
          break;
        }
        case 'links-to':
        case 'backlinks': {
          const parts = [];
          for (const v of t.values) {
            const page = ctx.resolvePage(v);
            if (!page) {
              parts.push('0');
              continue;
            }
            parts.push('p.id IN (SELECT page_id FROM links WHERE target_page_id = ? AND page_id != target_page_id)');
            condParams.push(page.id);
          }
          cond = `(${parts.join(' OR ')})`;
          break;
        }
        case 'linked-from': {
          const parts = [];
          for (const v of t.values) {
            const page = ctx.resolvePage(v);
            if (!page) {
              parts.push('0');
              continue;
            }
            parts.push('p.id IN (SELECT target_page_id FROM links WHERE page_id = ? AND target_page_id IS NOT NULL AND target_page_id != page_id)');
            condParams.push(page.id);
          }
          cond = `(${parts.join(' OR ')})`;
          break;
        }
        case 'path':
          cond = `(${t.values.map(() => "p.path LIKE ? ESCAPE '\\'").join(' OR ')})`;
          condParams = t.values.map((v) => `%${escapeLike(v)}%`);
          break;
        case 'heading':
          cond = `(${t.values.map(() => "p.id IN (SELECT page_id FROM headings WHERE text LIKE ? ESCAPE '\\')").join(' OR ')})`;
          condParams = t.values.map((v) => `%${escapeLike(v)}%`);
          break;
        default:
    }
    return cond ? { sql: cond, params: condParams } : null;
  }

  // the plain words of the search (not those limited to a column, not negated): what a page's name is compared with for ranking
  const nameWords = [];
  parsed.terms.forEach((t, i) => {
    if (t.type === 'text') {
      if (!t.column && !t.negated) nameWords.push(t.value.replace(/\*$/, '').toLowerCase());
      let expr = ftsQuote(t.value);
      if (!t.phrase && !t.negated && prefixLast) expr += '*'; // every plain word matches as a start ("theo iii" finds "Theology III"); quotes make a word exact
      else if (!t.phrase && t.value.endsWith('*') && t.value.length > 1) expr = `${ftsQuote(t.value.slice(0, -1))}*`;
      if (t.column) expr = `${t.column} : ${expr}`;
      (t.negated ? ftsNeg : fts).push(expr);
      return;
    }
    if (t.type === 'special' && t.key === 'sort') {
      for (const v of t.values) sorts.push(v);
      return;
    }
    const c = condition(t, false);
    if (c) {
      where.push(t.negated ? `NOT ${c.sql}` : c.sql);
      params.push(...c.params);
    }
  });

  // Pages hidden from queries (`hidden: queries`, `all` or `true`, and templates, which count as `hidden: all`) stay out of every result,
  // views and rules included, unless the query itself names `hidden` (or `template`). Rules and views still see pages that are
  // only hidden from the search pane, the tree or the children bar. The search pane itself also leaves out what `hidden` keeps from `search`.
  const mentions = (list, names) =>
    list.some((t) => (t.type === 'group' ? mentions(t.children, names) : (t.type === 'attr' && names.has(String(t.key).toLowerCase())) || (t.type === 'special' && t.key === 'has' && t.values.some((v) => names.has(String(v).toLowerCase())))));
  if (!mentions(parsed.terms, new Set(['hidden', 'template']))) {
    where.push(`p.id NOT IN (${hiddenIdsSql('queries')})`);
    if (ctx.hideFrom && ctx.hideFrom !== 'queries') where.push(`p.id NOT IN (${hiddenIdsSql(ctx.hideFrom)})`);
  }

  const hasText = fts.length > 0;
  const whereParams = [];
  const whereSql = [];
  if (hasText) {
    whereSql.push('pages_fts MATCH ?');
    whereParams.push(fts.join(' '));
  }
  for (const neg of ftsNeg) {
    whereSql.push('p.id NOT IN (SELECT rowid FROM pages_fts WHERE pages_fts MATCH ?)');
    whereParams.push(neg);
  }
  whereSql.push(...where);
  whereParams.push(...params);

  const from = hasText ? 'pages_fts JOIN pages p ON p.id = pages_fts.rowid' : 'pages p';
  const whereClause = whereSql.length ? `WHERE ${whereSql.join(' AND ')}` : '';

  // ORDER BY. Attribute sorts join a per-key summary once (a correlated subquery per row is quadratic).
  const orderParts = [];
  const joins = [];
  const joinParams = [];
  const specs = sorts.length ? sorts : [hasText ? 'rank' : 'title'];
  for (const spec of specs) {
    const desc = spec.startsWith('-');
    const name = (desc ? spec.slice(1) : spec).toLowerCase();
    const dir = desc ? 'DESC' : 'ASC';
    if (name in BUILTIN_SORTS) {
      if (name === 'rank') {
        if (hasText) orderParts.push(`rank ${dir}`);
      } else if (name === 'order') {
        orderParts.push(`p.sort_order IS NULL, p.sort_order ${dir}`);
      } else orderParts.push(`${BUILTIN_SORTS[name]} ${dir}`);
    } else {
      const a = `s${joins.length}`;
      joins.push(
        `LEFT JOIN (SELECT page_id, MIN(num_value) AS n, MIN(text_value) AS t FROM attrs WHERE key = ? AND text_value != '' GROUP BY page_id) ${a} ON ${a}.page_id = p.id`,
      );
      joinParams.push(name);
      // Pages without the attribute always sort last, whatever the direction.
      orderParts.push(`${a}.n IS NULL`, `${a}.n ${dir}`, `${a}.t COLLATE NOCASE ${dir}`);
    }
  }
  orderParts.push('p.path');

  // Ranking: bm25 (lower is better), then the name of the page: the more of its name the search covers, the better ("server"
  // finds server.md before server-status.md; a name that is exactly the search comes first of all), and notes before files.
  const wanted = nameWords.join(' ').trim();
  const norm = "lower(replace(replace(p.name, '-', ' '), '_', ' '))";
  const nameBoost = wanted
    ? `- CASE WHEN ${norm} = ? THEN 60.0 WHEN instr(${norm}, ?) > 0 THEN 30.0 * length(?) / length(${norm}) ELSE 0 END `
    : '';
  const selectParams = wanted ? [wanted, wanted, wanted] : [];
  const select = hasText
    ? `SELECT p.id, p.path, p.title, p.is_virtual AS isVirtual, p.mtime_ms AS mtimeMs,
              (bm25(pages_fts, 10.0, 1.0) ${nameBoost}+ CASE WHEN p.is_virtual = 2 THEN 25.0 ELSE 0 END) AS rank, NULL AS snippet`
    : 'SELECT p.id, p.path, p.title, p.is_virtual AS isVirtual, p.mtime_ms AS mtimeMs, NULL AS rank, NULL AS snippet';

  return {
    sql: `${select} FROM ${from} ${joins.join(' ')} ${whereClause} ORDER BY ${orderParts.join(', ')} LIMIT ? OFFSET ?`,
    params: [...(hasText ? selectParams : []), ...joinParams, ...whereParams, limit, offset],
    countSql: `SELECT COUNT(*) AS n FROM ${from} ${whereClause}`,
    countParams: whereParams,
    from,
    whereClause,
    hasText,
    errors,
  };
}
