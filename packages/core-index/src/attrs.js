import YAML from 'yaml';
import { stripNoteExt } from './exts.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SCHEMA_TYPES = new Set(['string', 'number', 'date', 'bool', 'enum', 'list']);
/** Friendlier spellings: `select` is a single choice (enum); `multiselect` is a list whose items come from `values`. */
const TYPE_ALIASES = { select: 'enum', multiselect: 'list', 'multi-select': 'list', multi: 'list', boolean: 'bool', checkbox: 'bool', text: 'string' };
const MAX_DEPTH = 3;
/** Type of an attribute row that has no value and no declared type */
export const EMPTY_TYPE = 'empty';

/** Parse a date-like string to epoch ms (UTC when no zone is given), or null. */
export function parseDate(s) {
  if (typeof s !== 'string') return null;
  const t = padDate(s.trim());
  if (!DATE_RE.test(t)) return null;
  const ms = Date.parse(t.replace(' ', 'T'));
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls 2026-02-31 over into March: a day that does not exist is not a date
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDate() === Number(m[3]) ? ms : null;
}

/** `2026-11-1` and `2026-1-05` read as `2026-11-01` and `2026-01-05`: a single-digit month or day is fine. */
export function padDate(s) {
  return s.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T ])/, (_m, y, mo, d) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
}

/** Parse a number string strictly ("12", "-3.5", "1e3"), or null. */
export function parseNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string' || s.trim() === '') return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a schema object ({ attributes: { key: { type, values?, of? } } }).
 * Returns { schema, warnings } where schema.attributes is a Map keyed by lowercase key.
 */
export function normalizeSchema(raw) {
  const warnings = [];
  const attributes = new Map();
  const defs = raw && typeof raw === 'object' ? raw.attributes : null;
  if (raw && (defs === null || typeof defs !== 'object' || Array.isArray(defs))) {
    warnings.push('schema: "attributes" must be a mapping');
  } else if (defs) {
    for (const [key, rawDef] of Object.entries(defs)) {
      let def = rawDef && typeof rawDef === 'object' && TYPE_ALIASES[rawDef.type] ? { ...rawDef, type: TYPE_ALIASES[rawDef.type] } : rawDef;
      // `options` and `choices` are accepted for the list of choices as well as `values`
      if (def && typeof def === 'object' && def.values === undefined && (def.options !== undefined || def.choices !== undefined)) def = { ...def, values: def.options ?? def.choices };
      if (!def || typeof def !== 'object' || !SCHEMA_TYPES.has(def.type)) {
        warnings.push(`schema: attribute "${key}" has an unknown or missing type`);
        continue;
      }
      const entry = { key, type: def.type };
      if (def.type === 'enum') {
        if (!Array.isArray(def.values) || def.values.length === 0) {
          warnings.push(`schema: select "${key}" needs a non-empty "values" list, like values: [a, b]`);
          continue;
        }
        entry.values = def.values.map(String);
      }
      if (def.type === 'list') {
        const of = def.of ?? 'string';
        if (!['string', 'number', 'date', 'bool'].includes(of)) {
          warnings.push(`schema: list "${key}" has unknown element type "${of}"`);
          continue;
        }
        entry.of = of;
        if (def.values !== undefined || rawDef.type !== 'list') {
          if (!Array.isArray(def.values) || def.values.length === 0) {
            warnings.push(`schema: list \"${key}\" needs a non-empty \"values\" list`);
            continue;
          }
          entry.values = def.values.map(String);
        }
      }
      if (def.implies !== undefined) {
        const implies = new Map();
        const m = def.implies;
        if (!m || typeof m !== 'object' || Array.isArray(m)) warnings.push(`schema: \"${key}\": implies must list values, each with the attributes it sets`);
        else {
          for (const [value, set] of Object.entries(m)) {
            if (!set || typeof set !== 'object' || Array.isArray(set)) {
              warnings.push(`schema: \"${key}\": implies ${value} must be a mapping of attribute: value`);
              continue;
            }
            implies.set(String(value).trim().toLowerCase(), set);
          }
        }
        if (implies.size) entry.implies = implies;
      }
      attributes.set(key.toLowerCase(), entry);
    }
  }
  return { schema: { attributes }, warnings };
}

export function parseSchemaText(text) {
  try {
    return normalizeSchema(YAML.parse(text) ?? {});
  } catch (e) {
    return { schema: { attributes: new Map() }, warnings: [`schema: invalid YAML (${String(e.message).split('\n')[0]})`] };
  }
}

/** One scalar -> { type, text, num } using inference. */
function inferScalar(v) {
  if (typeof v === 'boolean') return { type: 'bool', text: String(v), num: v ? 1 : 0 };
  if (typeof v === 'number') return { type: 'number', text: String(v), num: v };
  if (v instanceof Date) return { type: 'date', text: v.toISOString(), num: v.getTime() };
  const s = String(v);
  const d = parseDate(s);
  return d === null ? { type: 'string', text: s, num: null } : { type: 'date', text: s, num: d };
}

/** One scalar coerced to a declared type. Returns { value, problem }. */
function coerceScalar(v, type, def) {
  const s = v instanceof Date ? v.toISOString() : String(v);
  switch (type) {
    case 'string':
      return { value: { type: 'string', text: s, num: null } };
    case 'number': {
      const n = parseNumber(typeof v === 'number' ? v : s);
      return n === null ? { value: inferScalar(v), problem: `expected a number, got "${s}"` } : { value: { type: 'number', text: String(n), num: n } };
    }
    case 'date': {
      const d = v instanceof Date ? v.getTime() : parseDate(s);
      return d === null ? { value: inferScalar(v), problem: `expected a date, got "${s}"` } : { value: { type: 'date', text: s, num: d } };
    }
    case 'bool': {
      if (typeof v === 'boolean') return { value: inferScalar(v) };
      const l = s.toLowerCase();
      if (l === 'true' || l === 'false') return { value: { type: 'bool', text: l, num: l === 'true' ? 1 : 0 } };
      return { value: inferScalar(v), problem: `expected true or false, got "${s}"` };
    }
    case 'enum': {
      const hit = def.values.find((x) => x.toLowerCase() === s.toLowerCase());
      return hit === undefined
        ? { value: { type: 'string', text: s, num: null }, problem: `"${s}" is not one of: ${def.values.join(', ')}` }
        : { value: { type: 'string', text: hit, num: null } };
    }
    default:
      return { value: inferScalar(v) };
  }
}

/**
 * Turn parsed frontmatter into attribute rows.
 * Nested mappings become dotted keys (depth <= 3); lists become one row per element.
 *
 * @returns {{ rows: Array<{key,type,text,num,idx}>, problems: string[], aliases: string[], order: number|null }}
 */
/**
 * Attributes that a value of another attribute implies, as the schema says (`implies:` under an attribute, e.g. `type: task`
 * implies `hidden: true`). Never written to a file; an attribute the page has (own or handed down) is not replaced.
 */
export function withImplied(data, defs) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  let out = data;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [lk, def] of defs) {
      if (!def.implies) continue;
      const actual = Object.keys(out).find((k) => k.toLowerCase() === lk);
      if (actual === undefined) continue;
      const raw = out[actual];
      const values = (Array.isArray(raw) ? raw.flat(Infinity) : [raw]).filter((x) => x !== null && x !== undefined && typeof x !== 'object').map((x) => String(x).trim().toLowerCase());
      for (const v of values) {
        const set = def.implies.get(v);
        if (!set) continue;
        for (const [k2, v2] of Object.entries(set)) {
          if (Object.keys(out).some((k) => k.toLowerCase() === k2.toLowerCase())) continue;
          if (out === data) out = { ...data };
          out[k2] = v2;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return out;
}

/** The expression of a value that is nothing but `${expression}`, else null. */
export function formulaOf(v) {
  const m = /^\$\{([^}\n]+)\}$/.exec(String(v).trim());
  return m ? m[1].trim() : null;
}

export function buildAttrs(rawData, schema) {
  const rows = [];
  const problems = [];
  const defs = schema?.attributes ?? new Map();
  const data = withImplied(rawData, defs);

  const add = (key, v, idx, forced) => {
    // a value written `${expression}` is worked out later (by the workspace, which can read other pages); until then it is its own text
    const f = typeof v === 'string' ? formulaOf(v) : null;
    if (f !== null) {
      rows.push({ key, type: 'string', text: v.trim(), num: null, idx, formula: f });
      return;
    }
    const def = defs.get(key.toLowerCase());
    const type = forced ?? (def ? (def.type === 'list' ? (def.values ? 'enum' : def.of) : def.type) : null);
    if (type) {
      const { value, problem } = coerceScalar(v, type, def);
      if (problem) problems.push(`${key}: ${problem}`);
      rows.push({ key, ...value, idx });
    } else {
      rows.push({ key, ...inferScalar(v), idx });
    }
  };

  const walk = (key, v, depth) => {
    if (v === null || v === undefined) {
      // present but empty: kept as a row without a value, so the page shows the property (typed when the schema says)
      if (isPageOnly(key)) return;
      const d = defs.get(key.toLowerCase());
      rows.push({ key, type: d ? (d.type === 'list' ? (d.values ? 'string' : d.of) : d.type === 'enum' ? 'string' : d.type) : EMPTY_TYPE, text: '', num: null, idx: 0 });
      return;
    }
    const def = defs.get(key.toLowerCase());
    if (Array.isArray(v)) {
      const flat = v.flat(Infinity).filter((x) => x !== null && x !== undefined);
      flat.forEach((x, i) => {
        if (typeof x === 'object' && !(x instanceof Date)) add(key, JSON.stringify(x), i, 'string');
        else add(key, x, i);
      });
      return;
    }
    if (typeof v === 'object' && !(v instanceof Date)) {
      if (depth >= MAX_DEPTH) {
        add(key, JSON.stringify(v), 0, 'string');
        return;
      }
      for (const [k, child] of Object.entries(v)) walk(`${key}.${k}`, child, depth + 1);
      return;
    }
    if (def?.type === 'list') add(key, v, 0); // a lone value for a list attribute is a one-item list
    else add(key, v, 0);
  };

  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) walk(k, v, 1);
  }

  let aliases = [];
  const a = data?.aliases;
  if (typeof a === 'string') aliases = [a];
  else if (Array.isArray(a)) aliases = a.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
  aliases = aliases.map((x) => x.trim()).filter(Boolean);

  const order = typeof data?.order === 'number' && Number.isFinite(data.order) ? data.order : null;
  return { rows, problems, aliases, order };
}

// ---------------------------------------------------------------------------------------------
// Inheritance
//
// A page has no attributes unless something gives them to it. There are three givers, weakest first:
//
//   1. the workspace's global attributes (`attributes` in .cave-notes/workspace.yaml)
//   2. `children:` blocks of the pages above it
//   3. the page's own frontmatter
//
// What a page sets for itself is never handed down on its own account: only the globals and
// `children:` blocks travel, so a page's own values can never break the chain for its sub-pages.
// The one way to pass own values down is to ask for them (`defaults: inherit`, or `inherit` as a value).
//
// Words that mean something as a whole attribute value (any capitalisation; an empty value is `none`):
//   inherit   the value my parent page has (inside a `children:` block: the value the block's page has)
//   original  the workspace's global value for the attribute, or blank if the workspace sets none
//             (`default` means the same for one attribute)
//   none      blank: the attribute is not there
//
// A `children:` block is a mapping, or a list of them. Reserved keys inside it:
//   defaults:     what the attributes it does not list do. One of
//                   default   leave them as the workspace and the pages above hand them down (the default)
//                   inherit   take every value of this page
//                   original  go back to the workspace's values
//                   none      blank
//                   [[Page]]  take every value of that page
//   inheritance:  all (the default) | children              how far it reaches
// Every other key is an attribute for the sub-pages. `defaults` need only be given in one list item.
// Every item's `defaults` is applied first, then every item's attributes, in the order written.
//
// `aliases`, `order` and `title` describe one page and are never handed down.
// ---------------------------------------------------------------------------------------------

/** Frontmatter key that holds the blocks for sub-pages. It is configuration, not an attribute. */
export const CHILDREN_KEY = 'children';

const KEYWORDS = new Set(['inherit', 'default', 'original', 'none']);
const PAGE_ONLY = new Set(['aliases', 'order', 'title']);

/** True for attributes that belong to a single page and are never handed down. */
export const isPageOnly = (key) => PAGE_ONLY.has(String(key).toLowerCase());

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/**
 * `inherit` | `default` | `original` | `none` when the whole value is one of those words, `empty` for a blank value
 * (`due:` with nothing after it): the attribute is there, with no value. Else null.
 */
export function keywordOf(v) {
  if (v === null || v === undefined) return 'empty';
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === '') return 'empty';
  return KEYWORDS.has(s) ? s : null;
}

/**
 * A link to a page: `[[Name]]`, `[[Name|label]]`, or a Markdown link `[label](Path/Name.md)` (a path from the workspace root).
 * An unquoted `[[Name]]` in YAML reads as a list inside a list; that is accepted too.
 * @returns {{ text: string, target: string } | null}
 */
export function linkTarget(raw) {
  if (Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0]) && raw[0].length === 1 && typeof raw[0][0] === 'string') raw = `[[${raw[0][0]}]]`;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  let m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(text);
  if (m) return { text, target: m[1].trim() };
  m = /^\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(text);
  if (m) {
    let t = m[1];
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep as written */
    }
    t = stripNoteExt(t.replace(/#.*$/, ''));
    return t ? { text, target: t } : null;
  }
  return null;
}

// Attribute names are case-insensitive everywhere, so `Status` and `status` are one attribute.
const findKey = (obj, key) => {
  const l = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === l) return k;
  return undefined;
};
const getVal = (obj, key) => {
  const k = findKey(obj, key);
  return k === undefined ? undefined : obj[k];
};
const dropVal = (obj, key) => {
  const k = findKey(obj, key);
  if (k !== undefined) delete obj[k];
};
const putVal = (obj, key, v) => {
  dropVal(obj, key);
  obj[key] = v;
};

/** A copy of an attribute mapping without the keys that never travel. */
function shareable(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (isPageOnly(k) || k === '__proto__' || k.toLowerCase() === CHILDREN_KEY) continue;
    putVal(out, k, v);
  }
  return out;
}

const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

/**
 * The workspace's global attributes: `attributes` of .cave-notes/workspace.yaml.
 * Plain values only (the words above mean nothing at the top and are skipped).
 * @returns {{ globals: object, problems: string[] }}
 */
export function normalizeGlobals(raw) {
  const globals = {};
  const problems = [];
  if (raw === undefined || raw === null) return { globals, problems };
  if (!isPlainObject(raw)) {
    problems.push('workspace.yaml: "attributes" must be a mapping');
    return { globals, problems };
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__') continue;
    if (isPageOnly(k)) problems.push(`workspace.yaml: "${k}" belongs to a single page and cannot be global`);
    else if (k.toLowerCase() === CHILDREN_KEY) problems.push('workspace.yaml: "children" cannot be a global attribute');
    else if (keywordOf(v) === 'empty') putVal(globals, k, null); // every page has it, with no value
    else if (keywordOf(v)) continue; // inherit, none ...: there is nothing above the workspace, so the attribute is simply not there
    else putVal(globals, k, v);
  }
  return { globals, problems };
}

/**
 * Read a page's `children:` value into blocks: { defaults, inheritance, attrs }.
 * Accepts one block, a list of blocks, or just a word (`children: inherit` = `defaults: inherit`).
 * @returns {{ blocks: Array<{defaults: string, inheritance: string, attrs: object}>, problems: string[] }}
 */
export function parseChildren(raw) {
  const blocks = [];
  const problems = [];
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  for (const item of list) {
    if (item === null || item === undefined) continue;
    if (typeof item === 'string') {
      const kw0 = keywordOf(item);
      const kw = kw0 === 'empty' ? null : kw0;
      const lk = kw ? null : linkTarget(item);
      if (kw) blocks.push({ defaults: kw, inheritance: 'all', attrs: {} });
      else if (lk) blocks.push({ defaults: 'link', link: lk.text, inheritance: 'all', attrs: {} });
      else problems.push(`children: ${show(item)} is not a block; write "defaults: inherit", for example`);
      continue;
    }
    if (!isPlainObject(item)) {
      problems.push('children: each block must be a mapping');
      continue;
    }
    let defaults = 'default';
    let link;
    let inheritance = 'all';
    const attrs = {};
    for (const [k, v] of Object.entries(item)) {
      const lk = k.toLowerCase();
      if (lk === 'defaults') {
        const kw0 = typeof v === 'string' ? keywordOf(v) : null;
        const kw = kw0 === 'empty' ? null : kw0;
        const lk = kw ? null : linkTarget(v);
        if (kw) defaults = kw;
        else if (lk) {
          defaults = 'link';
          link = lk.text;
        } else problems.push(`children: "defaults" must be default, inherit, original, none or a link to a page (got ${show(v)})`);
      } else if (lk === 'inheritance') {
        const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
        if (s === 'all' || s === 'children') inheritance = s;
        else problems.push(`children: "inheritance" must be all or children (got ${show(v)})`);
      } else if (lk === CHILDREN_KEY) {
        problems.push('children: a block cannot hold another "children"; put it in the page below');
      } else if (isPageOnly(k)) {
        problems.push(`children: "${k}" belongs to a single page and is not handed down`);
      } else if (k !== '__proto__') {
        putVal(attrs, k, v);
      }
    }
    blocks.push(defaults === 'link' ? { defaults, link, inheritance, attrs } : { defaults, inheritance, attrs });
  }
  return { blocks, problems };
}

/** Set one attribute in `out`, reading the words `inherit`, `default` and `none`. */
function resolveInto(out, key, v, parentAttrs, globals) {
  const kw = keywordOf(v);
  if (kw === 'none') return dropVal(out, key);
  if (kw === 'empty') return putVal(out, key, null); // the attribute is there, with no value
  if (kw === 'inherit' || kw === 'default' || kw === 'original') {
    const from = isPageOnly(key) ? undefined : getVal(kw === 'inherit' ? parentAttrs : globals, key);
    return from === undefined ? dropVal(out, key) : putVal(out, key, from);
  }
  putVal(out, key, v);
}

/** What a block's `defaults` does to the attributes the sub-pages would otherwise get (before any attribute is set). */
function applyBaseline(block, state, pageAttrs, globals, resolveLink) {
  switch (block.defaults) {
    case 'inherit':
      return shareable(pageAttrs);
    case 'original':
      return shareable(globals);
    case 'none':
      return {};
    case 'link': {
      const linked = resolveLink ? resolveLink(block.link) : null;
      return linked ? shareable(linked) : { ...state }; // a page that cannot be found changes nothing
    }
    default:
      return { ...state };
  }
}

/** The attributes a block lists, set on top of `state`. */
function applyListed(block, state, pageAttrs, globals) {
  const out = { ...state };
  for (const [k, v] of Object.entries(block.attrs)) resolveInto(out, k, v, pageAttrs, globals);
  return out;
}

/** The state of the workspace itself, which is the "parent" of every top-level page. */
export function rootState(globals) {
  const g = globals ?? {};
  return { attributes: g, carry: g, blocks: [], problems: [] };
}

/**
 * Work out one page.
 *
 * @param own      the page's own frontmatter (parsed YAML)
 * @param parent   the parent's result of this function (omit for a top-level page)
 * @param globals  the workspace's global attributes
 * @param resolveLink  (link text) => the attributes of the page it names, or null when there is none; needed for `defaults: [[Page]]`
 * @returns {{
 *   attributes: object,  the page's attributes, after everything
 *   carry: object,       what reaches its sub-pages from above (never its own values)
 *   blocks: object[],    its own `children:` blocks, read
 *   problems: string[],  mistakes in this page's `children:` blocks
 * }}
 */
export function resolveInheritance(own, parent, globals, resolveLink) {
  const g = globals ?? {};
  const P = parent ?? rootState(g);
  let carry = { ...P.carry }; // what keeps going down
  let seen = { ...P.carry }; // what this page sees: also the blocks that stop at its parent's children
  // every block's `defaults` first, so that it does not matter which list item carries it; then the listed attributes
  for (const block of P.blocks) {
    if (block.defaults === 'default') continue;
    seen = applyBaseline(block, seen, P.attributes, g, resolveLink);
    if (block.inheritance === 'all') carry = applyBaseline(block, carry, P.attributes, g, resolveLink);
  }
  for (const block of P.blocks) {
    seen = applyListed(block, seen, P.attributes, g);
    if (block.inheritance === 'all') carry = applyListed(block, carry, P.attributes, g);
  }
  const attributes = { ...seen };
  const data = isPlainObject(own) ? own : {};
  for (const [k, v] of Object.entries(data)) {
    if (k === '__proto__' || k.toLowerCase() === CHILDREN_KEY) continue;
    resolveInto(attributes, k, v, P.attributes, g);
  }
  const { blocks, problems } = parseChildren(getVal(data, CHILDREN_KEY));
  if (resolveLink) for (const b of blocks) if (b.defaults === 'link' && !resolveLink(b.link)) problems.push(`children: no page found for ${b.link}`);
  return { attributes, carry, blocks, problems };
}

/** A page's attributes as its own frontmatter alone gives them (no workspace, no parents). */
export const ownAttributes = (own) => resolveInheritance(own, rootState({}), {}).attributes;

/** What is stored per page so that its sub-pages can be worked out without reading anything above. */
export const serializeState = (st) => JSON.stringify({ a: st.attributes, c: st.carry, b: st.blocks });

export function parseState(text) {
  try {
    const v = JSON.parse(text);
    if (v && isPlainObject(v.a) && isPlainObject(v.c) && Array.isArray(v.b)) return { attributes: v.a, carry: v.c, blocks: v.b, problems: [] };
  } catch {
    /* fall through */
  }
  return { attributes: {}, carry: {}, blocks: [], problems: [] };
}
