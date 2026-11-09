/**
 * A small, safe expression language for `${...}` in automation rules. No eval, no access to anything the host
 * did not put in the context, no loops: an expression always ends.
 *
 *   ${add(this.due, "7d")}      ${this.status == "done" && this.owner}      ${format(today, "YYYY-MM-DD")}
 *
 * Values: null, booleans, numbers, strings, dates (DateValue), lists, and records (this, old, new ...).
 * Operators: + - * / %   == != < <= > >=   && || !   ? :   and ( ) , . [ ].
 * String comparison ignores capitals, the way queries do. A missing property is null, not an error.
 */
import {
  DateValue, addDuration, daysBetween, formatDate, isDateValue, parseDateValue, parseDuration, startOf, startOfDay,
} from './dates.js';

// ---------------------------------------------------------------- tokens

const PUNCT = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '.', '[', ']', '?', ':'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i));
      out.push({ t: 'num', v: Number(m[0]), at: i });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else s += src[j++];
      }
      if (src[j] !== c) throw new Error(`unterminated string in "${src}"`);
      out.push({ t: 'str', v: s, at: i });
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[$]?[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) throw new Error(`unexpected "$" in "${src}"`);
      out.push({ t: 'id', v: m[0].replace(/^\$/, ''), at: i });
      i += m[0].length;
    } else {
      const p = PUNCT.find((x) => src.startsWith(x, i));
      if (!p) throw new Error(`unexpected "${c}" in "${src}"`);
      out.push({ t: 'p', v: p, at: i });
      i += p.length;
    }
  }
  return out;
}

// ---------------------------------------------------------------- parser (precedence climbing)

const BINARY = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

/** Parse an expression to a tree. Throws Error with a readable message. */
export function parseExpr(src) {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isP = (v) => toks[pos]?.t === 'p' && toks[pos].v === v;
  const fail = (msg) => {
    throw new Error(`${msg} in "${src}"`);
  };
  const expect = (v) => {
    if (!isP(v)) fail(`expected "${v}"`);
    pos++;
  };

  function ternary() {
    const cond = binary(1);
    if (isP('?')) {
      pos++;
      const a = ternary();
      expect(':');
      const b = ternary();
      return { k: 'if', cond, a, b };
    }
    return cond;
  }
  function binary(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      const prec = t && t.t === 'p' ? BINARY[t.v] : undefined;
      if (prec === undefined || prec < min) return left;
      pos++;
      const right = binary(prec + 1);
      left = { k: 'bin', op: t.v, left, right };
    }
  }
  function unary() {
    if (isP('!')) {
      pos++;
      return { k: 'not', x: unary() };
    }
    if (isP('-')) {
      pos++;
      return { k: 'neg', x: unary() };
    }
    return postfix(primary());
  }
  function postfix(node) {
    for (;;) {
      if (isP('.')) {
        pos++;
        const t = peek();
        if (!t || t.t !== 'id') fail('expected a name after "."');
        pos++;
        node = { k: 'member', obj: node, key: t.v };
      } else if (isP('[')) {
        pos++;
        const key = ternary();
        expect(']');
        node = { k: 'index', obj: node, key };
      } else return node;
    }
  }
  function primary() {
    const t = peek();
    if (!t) fail('the expression ends too soon');
    pos++;
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (isP('(')) {
        pos++;
        const args = [];
        if (!isP(')')) {
          for (;;) {
            args.push(ternary());
            if (isP(',')) pos++;
            else break;
          }
        }
        expect(')');
        if (!FUNCTIONS[t.v.toLowerCase()]) fail(`unknown function ${t.v}()`);
        return { k: 'call', name: t.v.toLowerCase(), args };
      }
      return { k: 'var', name: t.v };
    }
    if (t.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    return fail(`unexpected "${t.v}"`);
  }

  if (toks.length === 0) fail('the expression is empty');
  const tree = ternary();
  if (pos < toks.length) fail(`unexpected "${toks[pos].v}"`);
  return tree;
}

// ---------------------------------------------------------------- values

export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function stringify(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(stringify).join(', ');
  if (isDateValue(v)) return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const asDate = (v) => (isDateValue(v) ? v : typeof v === 'string' ? parseDateValue(v) : null);
const asNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function compare(a, b) {
  const da = asDate(a);
  const db = asDate(b);
  if (da && db) return da.ms - db.ms;
  const na = asNum(a);
  const nb = asNum(b);
  if (na !== null && nb !== null) return na - nb;
  const sa = stringify(a).toLowerCase();
  const sb = stringify(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function equals(a, b) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    const la = Array.isArray(a) ? a : [a];
    const lb = Array.isArray(b) ? b : [b];
    return la.length === lb.length && la.every((x, i) => equals(x, lb[i]));
  }
  return compare(a, b) === 0;
}

function lookup(obj, key) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return key === 'length' ? obj.length : null;
  if (isDateValue(obj)) {
    const d = obj.date;
    switch (key) {
      case 'year': return d.getFullYear();
      case 'month': return d.getMonth() + 1;
      case 'day': return d.getDate();
      case 'weekday': return ((d.getDay() + 6) % 7) + 1; // 1 = Monday
      case 'hour': return d.getHours();
      case 'minute': return d.getMinutes();
      default: return null;
    }
  }
  if (typeof obj === 'string') return key === 'length' ? obj.length : null;
  if (typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const low = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === low) return obj[k];
  return null;
}

// ---------------------------------------------------------------- evaluation

const MAX_STEPS = 10_000;

/** Evaluate a parsed tree against a context (a plain object of variables). */
export function evalExpr(tree, ctx) {
  let steps = 0;
  const go = (n) => {
    if (++steps > MAX_STEPS) throw new Error('the expression is too long to evaluate');
    switch (n.k) {
      case 'lit': return n.v;
      case 'var': {
        const low = n.name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(ctx, low)) return ctx[low];
        throw new Error(`unknown name "${n.name}" (known: ${Object.keys(ctx).join(', ')})`);
      }
      case 'member': return lookup(go(n.obj), n.key);
      case 'index': {
        const o = go(n.obj);
        const k = go(n.key);
        return Array.isArray(o) && typeof k === 'number' ? (o[k] ?? null) : lookup(o, stringify(k));
      }
      case 'not': return !truthy(go(n.x));
      case 'neg': {
        const v = asNum(go(n.x));
        if (v === null) throw new Error('"-" needs a number');
        return -v;
      }
      case 'if': return truthy(go(n.cond)) ? go(n.a) : go(n.b);
      case 'call': return FUNCTIONS[n.name](n.args.map(go), ctx);
      case 'bin': return binary(n);
      default: throw new Error('bad expression');
    }
  };
  const binary = (n) => {
    const { op } = n;
    if (op === '&&') {
      const l = go(n.left);
      return truthy(l) ? go(n.right) : l;
    }
    if (op === '||') {
      const l = go(n.left);
      return truthy(l) ? l : go(n.right);
    }
    const l = go(n.left);
    const r = go(n.right);
    switch (op) {
      case '==': return equals(l, r);
      case '!=': return !equals(l, r);
      case '<': return compare(l, r) < 0;
      case '<=': return compare(l, r) <= 0;
      case '>': return compare(l, r) > 0;
      case '>=': return compare(l, r) >= 0;
      case '+': {
        if (isDateValue(l) && (typeof r === 'string' || typeof r === 'number') && durationLike(r)) return addDuration(l, parseDuration(r));
        if (typeof l === 'string' || typeof r === 'string' || Array.isArray(l) || Array.isArray(r)) return stringify(l) + stringify(r);
        const a = asNum(l);
        const b = asNum(r);
        if (a === null || b === null) throw new Error('"+" needs numbers, text or a date and a duration');
        return a + b;
      }
      case '-': {
        if (isDateValue(l) && isDateValue(r)) return daysBetween(r, l);
        if (isDateValue(l) && (typeof r === 'string' || typeof r === 'number') && durationLike(r)) {
          const d = parseDuration(r);
          return addDuration(l, { n: -d.n, unit: d.unit });
        }
        const a = asNum(l);
        const b = asNum(r);
        if (a === null || b === null) throw new Error('"-" needs numbers, or a date and a duration');
        return a - b;
      }
      default: {
        const a = asNum(l);
        const b = asNum(r);
        if (a === null || b === null) throw new Error(`"${op}" needs numbers`);
        if (op === '*') return a * b;
        if ((op === '/' || op === '%') && b === 0) throw new Error('division by zero');
        return op === '/' ? a / b : a % b;
      }
    }
  };
  return go(tree);
}

const durationLike = (x) => {
  try {
    parseDuration(x);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- functions

const need = (name, args, min, max = min) => {
  if (args.length < min || args.length > max) throw new Error(`${name}() takes ${min === max ? min : `${min} to ${max}`} argument(s)`);
};
const dateArg = (name, v) => {
  const d = asDate(v);
  if (!d) throw new Error(`${name}(): "${stringify(v)}" is not a date`);
  return d;
};
const numArg = (name, v) => {
  const n = asNum(v);
  if (n === null) throw new Error(`${name}(): "${stringify(v)}" is not a number`);
  return n;
};

/** Every function the expression language has. The documentation is generated from this list, so keep `doc` accurate. */
export const FUNCTION_DOCS = [];
const FUNCTIONS = {};
/** The names of the functions, for scripts (`fn.add(...)`). */
export const FUNCTION_NAMES = () => Object.keys(FUNCTIONS);
/** Call a function of the expression language by name, with already evaluated arguments (used by JavaScript in rules). */
export function callFunction(name, args, ctx = {}) {
  const f = Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : null;
  if (!f) throw new Error(`there is no function ${name}()`);
  return f(args, ctx);
}
function def(name, sig, doc, fn) {
  FUNCTIONS[name] = fn;
  FUNCTION_DOCS.push({ name, sig, doc });
}

def('add', 'add(date, "7d")', 'A date moved forward. Units: min h d w mo y. Negative moves back.', (a) => {
  need('add', a, 2);
  return addDuration(dateArg('add', a[0]), parseDuration(a[1]));
});
def('sub', 'sub(date, "7d")', 'A date moved back.', (a) => {
  need('sub', a, 2);
  const d = parseDuration(a[1]);
  return addDuration(dateArg('sub', a[0]), { n: -d.n, unit: d.unit });
});
def('date', 'date(text)', 'Read text as a date (null if it is not one).', (a) => {
  need('date', a, 1);
  return asDate(a[0]);
});
def('format', 'format(date, "YYYY-MM-DD")', 'Text from a date. Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH mm ss.', (a) => {
  need('format', a, 1, 2);
  const d = dateArg('format', a[0]);
  return formatDate(d.date, a[1] === undefined ? (d.dateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm') : String(a[1]));
});
def('days_between', 'days_between(a, b)', 'Whole days from a to b (negative if b is earlier).', (a) => {
  need('days_between', a, 2);
  return daysBetween(dateArg('days_between', a[0]), dateArg('days_between', a[1]));
});
def('start_of', 'start_of(date, "week")', 'The first moment of the day, week (starting Monday), month or year that holds the date.', (a) => {
  need('start_of', a, 2);
  return startOf(dateArg('start_of', a[0]), String(a[1]));
});
def('day', 'day(date)', 'The date without its time of day.', (a) => {
  need('day', a, 1);
  return startOfDay(dateArg('day', a[0]));
});
def('weekday', 'weekday(date)', 'The day of the week, 1 = Monday ... 7 = Sunday.', (a) => {
  need('weekday', a, 1);
  return ((dateArg('weekday', a[0]).date.getDay() + 6) % 7) + 1;
});
def('next_weekday', 'next_weekday(date, 1)', 'The next date (after the given one) that falls on this weekday, 1 = Monday ... 7 = Sunday.', (a) => {
  need('next_weekday', a, 2);
  const d = dateArg('next_weekday', a[0]);
  const want = numArg('next_weekday', a[1]);
  const cur = ((d.date.getDay() + 6) % 7) + 1;
  return addDuration(d, { n: ((want - cur + 6) % 7) + 1, unit: 'd' });
});
def('if', 'if(test, a, b)', 'a when the test is true, otherwise b.', (a) => {
  need('if', a, 2, 3);
  return truthy(a[0]) ? a[1] : (a[2] ?? null);
});
def('coalesce', 'coalesce(a, b, ...)', 'The first value that is not empty.', (a) => a.find((x) => x !== null && x !== undefined && x !== '') ?? null);
def('default', 'default(value, fallback)', 'The value, or the fallback when it is empty.', (a) => {
  need('default', a, 2);
  return a[0] === null || a[0] === undefined || a[0] === '' ? a[1] : a[0];
});
def('is_empty', 'is_empty(value)', 'True for null, empty text and empty lists.', (a) => {
  need('is_empty', a, 1);
  return a[0] === null || a[0] === undefined || a[0] === '' || (Array.isArray(a[0]) && a[0].length === 0);
});
def('upper', 'upper(text)', 'Capitals.', (a) => stringify(a[0]).toUpperCase());
def('lower', 'lower(text)', 'Lower case.', (a) => stringify(a[0]).toLowerCase());
def('trim', 'trim(text)', 'Without spaces at the ends.', (a) => stringify(a[0]).trim());
def('replace', 'replace(text, "a", "b")', 'Every "a" in the text becomes "b" (plain text, not a pattern).', (a) => {
  need('replace', a, 3);
  return stringify(a[0]).split(stringify(a[1])).join(stringify(a[2]));
});
def('trimword', 'trimword(text, count, "start")', 'Takes `count` words off the end of the text (or off the start when the third value is "start"; a negative count also counts from the start). For a recurring meeting whose title ends in its date: `trimword(this.title, 1)` is the title without that date.', (a) => {
  need('trimword', a, 2, 3);
  let n = numArg('trimword', a[1]);
  let fromStart = a[2] !== undefined && stringify(a[2]).trim().toLowerCase() === 'start';
  if (n < 0) {
    n = -n;
    fromStart = !fromStart;
  }
  const words = stringify(a[0]).trim().split(/\s+/).filter((w) => w !== '');
  const k = Math.min(Math.floor(n), words.length);
  return (fromStart ? words.slice(k) : words.slice(0, words.length - k)).join(' ');
});
def('contains', 'contains(list_or_text, x)', 'True if the list has x, or the text includes it (capitals ignored).', (a) => {
  need('contains', a, 2);
  if (Array.isArray(a[0])) return a[0].some((x) => equals(x, a[1]));
  return stringify(a[0]).toLowerCase().includes(stringify(a[1]).toLowerCase());
});
def('starts_with', 'starts_with(text, prefix)', 'True if the text starts with the prefix.', (a) => {
  need('starts_with', a, 2);
  return stringify(a[0]).toLowerCase().startsWith(stringify(a[1]).toLowerCase());
});
def('slug', 'slug(text)', 'Text safe for a file name: letters, digits and dashes.', (a) => stringify(a[0]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
def('join', 'join(list, ", ")', 'A list as text.', (a) => (Array.isArray(a[0]) ? a[0] : [a[0]]).map(stringify).join(a[1] === undefined ? ', ' : String(a[1])));
def('first', 'first(list)', 'The first item.', (a) => (Array.isArray(a[0]) ? (a[0][0] ?? null) : a[0]));
def('len', 'len(value)', 'The length of a list or text.', (a) => (Array.isArray(a[0]) ? a[0].length : stringify(a[0]).length));
def('number', 'number(value)', 'Read as a number (null if it is not one).', (a) => asNum(a[0]));
def('string', 'string(value)', 'As text.', (a) => stringify(a[0]));
def('round', 'round(n, digits)', 'Rounded; digits defaults to 0.', (a) => {
  const f = 10 ** (a[1] === undefined ? 0 : numArg('round', a[1]));
  return Math.round(numArg('round', a[0]) * f) / f;
});
def('floor', 'floor(n)', 'Rounded down.', (a) => Math.floor(numArg('floor', a[0])));
def('ceil', 'ceil(n)', 'Rounded up.', (a) => Math.ceil(numArg('ceil', a[0])));
def('abs', 'abs(n)', 'Without its sign.', (a) => Math.abs(numArg('abs', a[0])));
def('clamp', 'clamp(n, low, high)', 'n kept between low and high.', (a) => {
  need('clamp', a, 3);
  return Math.min(Math.max(numArg('clamp', a[0]), numArg('clamp', a[1])), numArg('clamp', a[2]));
});

// ---------------------------------------------------------------- lists, numbers, and what a query finds

/** The numbers in a list (or in several values): empty values and text that is no number are skipped, as a spreadsheet does. */
const numbersIn = (args) =>
  args
    .flat(Infinity)
    .map((x) => (typeof x === 'boolean' ? null : asNum(x)))
    .filter((x) => x !== null);
const isFilled = (x) => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && x.length === 0);
const sumOf = (n) => n.reduce((t, x) => t + x, 0);
const medianOf = (n) => {
  if (n.length === 0) return null;
  const s = [...n].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Fold a list of numbers the way `name` says (sum, avg, min, max, median, product). */
const FOLDS = {
  sum: (n) => sumOf(n),
  avg: (n) => (n.length === 0 ? null : sumOf(n) / n.length),
  min: (n) => (n.length === 0 ? null : Math.min(...n)),
  max: (n) => (n.length === 0 ? null : Math.max(...n)),
  median: medianOf,
  product: (n) => n.reduce((t, x) => t * x, 1),
};
const FOLD_ALIAS = { average: 'avg', mean: 'avg' };
const foldName = (name) => FOLD_ALIAS[name] ?? name;

/** Functions that can also read a query: `sum("status: done", "hours")`. Their result is worked out by the host before the expression runs. */
export const QUERY_FUNCTIONS = new Set(['sum', 'avg', 'average', 'mean', 'min', 'max', 'median', 'product', 'count', 'values', 'titles']);

/** The key the host stores a query call's result under. */
export const callKey = (name, args) => `${name}\u0000${JSON.stringify(args)}`;

/** Is this call `name(query, attribute)`: text first (that is no number), and for the folds one more text? */
function isQueryCall(name, args) {
  if (!QUERY_FUNCTIONS.has(name) || typeof args[0] !== 'string') return false;
  if (name === 'count' || name === 'values' || name === 'titles') return args.length >= 1 && args.length <= 2 && args.every((a) => typeof a === 'string');
  return args.length === 2 && typeof args[1] === 'string' && asNum(args[0]) === null;
}

/** The calls in a parsed expression that read a query or a page, with their text arguments: `{ kind: 'query' | 'page', name, args, key }`. */
export function hostCalls(tree) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.k === 'call') {
      const lits = n.args.every((a) => a.k === 'lit');
      const args = lits ? n.args.map((a) => a.v) : null;
      if (args && n.name === 'page' && args.length === 1 && typeof args[0] === 'string') add({ kind: 'page', name: 'page', args, key: callKey('page', args) });
      else if (args && isQueryCall(n.name, args)) add({ kind: 'query', name: n.name, args, key: callKey(n.name, args) });
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  const add = (c) => {
    if (!seen.has(c.key)) {
      seen.add(c.key);
      out.push(c);
    }
  };
  walk(tree);
  return out;
}

/**
 * The value of `name(query, attribute)` from what the host found: `data` is `{ count, titles, values }` where values are the
 * attribute's values on the pages the query found, as `{ type, text, num }`.
 */
export function queryValue(name, args, data) {
  const typed = (e) => (e.type === 'number' ? e.num : e.type === 'bool' ? e.num === 1 : e.type === 'date' ? (parseDateValue(e.text) ?? e.text) : e.text);
  if (name === 'titles') return data.titles;
  if (name === 'count') return args.length === 1 ? data.count : data.values.filter((e) => e.text !== '').length;
  const list = data.values.map(typed);
  if (name === 'values') return list;
  return FOLDS[foldName(name)](numbersIn([list]));
}

/** `[[Page]]` outside quotes becomes `page("Page")`, so that `[[Budget]].total` reads an attribute of another page. */
export function rewritePageRefs(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < src.length) out += src[++i];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '[' && src[i + 1] === '[') {
      const end = src.indexOf(']]', i + 2);
      if (end < 0) {
        out += c;
        continue;
      }
      const name = src.slice(i + 2, end).split('|')[0].trim();
      out += `page(${JSON.stringify(name)})`;
      i = end + 1;
    } else out += c;
  }
  return out;
}

const hostValue = (name, args, ctx) => {
  const store = ctx.__host;
  const key = callKey(name, args);
  if (!store) throw new Error(`${name}() with a query or a page works in the text of a page and in attribute formulas, not in an automation rule`);
  if (!store.has(key)) {
    throw new Error(`${name}(): write the query and the attribute as text in quotes, like ${name}("status: done", "hours")`);
  }
  const v = store.get(key);
  if (v && typeof v === 'object' && v.__error) throw new Error(`${name}(): ${v.__error}`);
  return v;
};

const listFn = (name, fold) => (a, ctx) => (isQueryCall(name, a) ? hostValue(name, a, ctx) : fold(numbersIn(a)));
def('sum', 'sum(list)', 'The total of the numbers in a list (or in several values); empty values and text are skipped. `sum("query", "attribute")` adds up the attribute over the pages a query finds.', listFn('sum', FOLDS.sum));
def('avg', 'avg(list)', 'The average of the numbers (null when there are none). Also `average` and `mean`. `avg("query", "attribute")` averages over the pages a query finds.', listFn('avg', FOLDS.avg));
FUNCTIONS.average = FUNCTIONS.mean = (a, ctx) => (isQueryCall('avg', a) ? hostValue('avg', a, ctx) : FOLDS.avg(numbersIn(a)));
def('min', 'min(a, b, ...)', 'The smallest number: of several values or of a list. `min("query", "attribute")` is the smallest over the pages a query finds.', (a, ctx) => (isQueryCall('min', a) ? hostValue('min', a, ctx) : FOLDS.min(numbersIn(a))));
def('max', 'max(a, b, ...)', 'The largest number: of several values or of a list. `max("query", "attribute")` is the largest over the pages a query finds.', (a, ctx) => (isQueryCall('max', a) ? hostValue('max', a, ctx) : FOLDS.max(numbersIn(a))));
def('median', 'median(list)', 'The middle number of a list. `median("query", "attribute")` works over the pages a query finds.', listFn('median', FOLDS.median));
def('product', 'product(list)', 'The numbers of a list multiplied.', listFn('product', FOLDS.product));
def('count', 'count(list)', 'How many items a list has that are not empty. `count("query")` is how many pages a query finds; `count("query", "attribute")` how many of them have a value for the attribute.', (a, ctx) => {
  if (isQueryCall('count', a)) return hostValue('count', a, ctx);
  return a.flat(Infinity).filter(isFilled).length;
});
def('values', 'values("query", "attribute")', 'The list of an attribute\'s values on the pages a query finds (numbers stay numbers). Use it where a list is wanted: `sum(values("under:[[Budget]]", "cost"))`.', (a, ctx) => {
  need('values', a, 2);
  return hostValue('values', a, ctx);
});
def('titles', 'titles("query")', 'The titles of the pages a query finds, as a list: `join(titles("status: active"), ", ")`.', (a, ctx) => {
  need('titles', a, 1);
  return hostValue('titles', a, ctx);
});
def('page', 'page("Name")', 'The page with that name, to read its attributes: `page("Budget").total`. Write `[[Budget]].total` for the same.', (a, ctx) => {
  need('page', a, 1);
  return hostValue('page', a, ctx);
});
def('unique', 'unique(list)', 'The list without repeated items.', (a) => {
  const out = [];
  for (const x of Array.isArray(a[0]) ? a[0] : [a[0]]) if (!out.some((y) => equals(x, y))) out.push(x);
  return out;
});
def('sort', 'sort(list)', 'The list in order, smallest first (numbers and dates by value, text without regard to capitals).', (a) => [...(Array.isArray(a[0]) ? a[0] : [a[0]])].sort(compare));
def('reverse', 'reverse(list)', 'The list the other way round.', (a) => [...(Array.isArray(a[0]) ? a[0] : [a[0]])].reverse());
def('last', 'last(list)', 'The last item.', (a) => (Array.isArray(a[0]) ? (a[0][a[0].length - 1] ?? null) : a[0]));
def('range', 'range(from, to)', 'The whole numbers from one to the other, as a list (at most 1000).', (a) => {
  need('range', a, 2);
  const from = Math.floor(numArg('range', a[0]));
  const to = Math.floor(numArg('range', a[1]));
  const out = [];
  for (let i = from; i <= to && out.length < 1000; i++) out.push(i);
  return out;
});
def('split', 'split(text, ",")', 'Text cut into a list at every separator; the pieces lose their surrounding spaces.', (a) => {
  need('split', a, 2);
  return stringify(a[0]).split(stringify(a[1])).map((x) => x.trim());
});
def('substr', 'substr(text, start, length)', 'Part of a text: from character `start` (the first is 1), `length` characters (to the end when left out).', (a) => {
  need('substr', a, 2, 3);
  const from = Math.max(1, Math.floor(numArg('substr', a[1]))) - 1;
  const t = stringify(a[0]);
  return a[2] === undefined ? t.slice(from) : t.slice(from, from + Math.max(0, Math.floor(numArg('substr', a[2]))));
});
def('sqrt', 'sqrt(n)', 'The square root.', (a) => {
  const n = numArg('sqrt', a[0]);
  if (n < 0) throw new Error('sqrt(): no square root of a negative number');
  return Math.sqrt(n);
});
def('pow', 'pow(n, power)', 'n to the power: `pow(2, 10)` is 1024.', (a) => {
  need('pow', a, 2);
  return numArg('pow', a[0]) ** numArg('pow', a[1]);
});
def('percent', 'percent(part, whole, digits)', 'What percentage part is of whole, rounded to `digits` (default 1): `percent(3, 8)` is 37.5. Null when whole is 0.', (a) => {
  need('percent', a, 2, 3);
  const whole = numArg('percent', a[1]);
  if (whole === 0) return null;
  const f = 10 ** (a[2] === undefined ? 1 : numArg('percent', a[2]));
  return Math.round((numArg('percent', a[0]) / whole) * 100 * f) / f;
});
def('fixed', 'fixed(n, digits)', 'A number as text with exactly this many decimals: `fixed(2.5, 2)` is `2.50`.', (a) => {
  need('fixed', a, 1, 2);
  return numArg('fixed', a[0]).toFixed(Math.max(0, Math.min(20, a[1] === undefined ? 0 : numArg('fixed', a[1]))));
});
def('commas', 'commas(n, digits)', 'A number as text with thousands separators: `commas(1234567.5, 1)` is `1,234,567.5`. Digits defaults to what the number has (at most 3).', (a) => {
  need('commas', a, 1, 2);
  const n = numArg('commas', a[0]);
  const d = a[1] === undefined ? undefined : Math.max(0, Math.min(20, numArg('commas', a[1])));
  return n.toLocaleString('en-US', d === undefined ? { maximumFractionDigits: 3 } : { minimumFractionDigits: d, maximumFractionDigits: d });
});
def('years_between', 'years_between(a, b)', 'Whole years from a to b (negative if b is earlier): `years_between(this.born, today)` is an age.', (a) => {
  need('years_between', a, 2);
  const x = dateArg('years_between', a[0]).date;
  const y = dateArg('years_between', a[1]).date;
  let n = y.getFullYear() - x.getFullYear();
  if (y.getMonth() < x.getMonth() || (y.getMonth() === x.getMonth() && y.getDate() < x.getDate())) n--;
  return n;
});

// ---------------------------------------------------------------- templates

/**
 * Split a string into literal text and `${expression}` parts. `$$` is a literal dollar sign. A bare `$now` or
 * `$today` (any capitals) is the same as `${now}` / `${today}`.
 */
export function splitTemplate(str) {
  const parts = [];
  let lit = '';
  let i = 0;
  const flush = () => {
    if (lit) parts.push({ lit });
    lit = '';
  };
  while (i < str.length) {
    const c = str[i];
    if (c === '$' && str[i + 1] === '$') {
      lit += '$';
      i += 2;
    } else if (c === '$' && str[i + 1] === '{') {
      let j = i + 2;
      let q = null;
      while (j < str.length && (q || str[j] !== '}')) {
        if (q) {
          if (str[j] === '\\') j++;
          else if (str[j] === q) q = null;
        } else if (str[j] === '"' || str[j] === "'") q = str[j];
        j++;
      }
      if (j >= str.length) throw new Error(`"\${" is never closed in "${str}"`);
      flush();
      parts.push({ expr: str.slice(i + 2, j).trim() });
      i = j + 1;
    } else if (c === '$') {
      const m = /^\$(now|today)(?![A-Za-z0-9_.{])/i.exec(str.slice(i));
      if (m) {
        flush();
        parts.push({ expr: m[1].toLowerCase() });
        i += m[0].length;
      } else {
        lit += c;
        i++;
      }
    } else {
      lit += c;
      i++;
    }
  }
  flush();
  return parts;
}

/** Check a template's expressions parse. Throws with a readable message. */
export function checkTemplate(str) {
  for (const p of splitTemplate(str)) if ('expr' in p) parseExpr(p.expr);
}

const cache = new Map();
const compiled = (src) => {
  let t = cache.get(src);
  if (!t) {
    t = parseExpr(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, t);
  }
  return t;
};

/**
 * Fill in a value. Text with one `${...}` and nothing else keeps the expression's own type (a date stays a date, a
 * number a number); mixed text becomes text. Lists and records are filled in item by item. Other values pass through.
 */
export function render(value, ctx) {
  if (typeof value === 'string') {
    const parts = splitTemplate(value);
    if (parts.length === 1 && 'expr' in parts[0]) return evalExpr(compiled(parts[0].expr), ctx);
    return parts.map((p) => ('lit' in p ? p.lit : stringify(evalExpr(compiled(p.expr), ctx)))).join('');
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object' && !isDateValue(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = render(v, ctx);
    return out;
  }
  return value;
}

/** Evaluate one bare expression (a rule's `if:`), not a template. */
export function evaluate(src, ctx) {
  return evalExpr(compiled(String(src)), ctx);
}

export { DateValue };
