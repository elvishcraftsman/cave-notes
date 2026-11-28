import YAML from 'yaml';

export const VIEW_TYPES = ['table', 'list', 'gallery', 'kanban', 'calendar'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * A database view lives in a fenced block:
 *
 *     ```view
 *     type: kanban
 *     query: under:$this status:todo,doing
 *     group: status
 *     ```
 */
export interface ComputedColumn {
  name: string;
  /** an expression as written in `${ }` (without the `${ }`) */
  expr: string;
}

export interface ViewConfig {
  type: ViewType;
  /** `open: true` in one view of a block of several: the tab that shows when the page opens (the app moves it as tabs are chosen) */
  open?: boolean;
  title?: string;
  /** the same query language as the search bar; `$this` and `$parent` stand for the page holding the block */
  query: string;
  sort?: string;
  /** kanban: the attribute whose values become columns */
  group?: string;
  /** the order of the groups of a table or list: `desc` puts the last value first */
  groupDir?: 'asc' | 'desc';
  /** calendar: the date attribute */
  date?: string;
  /** gallery: an attribute holding an image path (relative to each page) */
  cover?: string;
  /** table and cards: which properties to show (`title`, `path`, `modified`, or any attribute) */
  columns?: string[];
  /** the fields the + New row asks for, in order (without it: the shown properties) */
  newFields?: string[];
  /** true: the title is not shown (no title column; the New row does not ask for one and names each new file with the next free number) */
  hideTitle?: boolean;
  /** columns worked out for each row by an expression (`this` is the row's page): rollups over related pages, lookups, formulas. See docs. */
  computed?: ComputedColumn[];
  /** how a column is shown, by column name (lower case): `currency`, `currency:EUR`, `percent`, `number:2`, `url`, `email`, `rating`, `rating:10`, `progress`, `progress:200` */
  formats?: Record<string, string>;
  /** a summary under a table column (and under each group): `sum`, `avg`, `min`, `max`, `median`, `count`, `filled`, `empty`, `unique`, `percent` (filled), by column name (lower case) */
  footer?: Record<string, string>;
  /** table: true lets long text wrap onto more lines instead of being cut off */
  wrap?: boolean;
  /** table: how many columns, from the left, stay in place while the rest scroll sideways (0 to 3) */
  freeze?: number;
  limit?: number;
  /** rows per page of a table, list or gallery; 0 shows everything (up to `limit`) */
  pageSize?: number;
  /** colour rules: the first whose query matches a page colours its row */
  colors?: ColorRule[];
  /** true: creating a page whose name is taken goes ahead (the file gets `.1`, `.2` …) without asking first. Default false: ask */
  noDuplicateWarning?: boolean;
  /** a relation column that names a page or file which cannot name this page back: `link` links it from this side only, `skip` leaves it out. Unset: ask */
  relationFiles?: 'link' | 'skip';
}

/** `when` is query text (with `$now`, `$this` ...); `color` a name from COLOR_NAMES or #rrggbb */
export interface ColorRule {
  when: string;
  color: string;
}

export const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'gray'] as const;

/** The colour to draw: a hex value as is, a name as its shade, anything else null. */
export function colorValue(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m: Record<string, string> = { red: '#e5484d', orange: '#f76b15', yellow: '#e2a70f', green: '#30a46c', blue: '#3e63dd', purple: '#8e4ec6', brown: '#a07553', gray: '#8b8d98' };
  return m[c.toLowerCase()] ?? null;
}

export type ParseResult = { ok: true; config: ViewConfig } | { ok: false; error: string };

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : v instanceof Date ? v.toISOString().slice(0, 10) : undefined);

/**
 * `query: !Projects status:done` is a shortcode: YAML would read `!Projects` as a tag and lose it, so the value is quoted
 * before parsing (a comment after it stays where it is). A value that is quoted already is left alone.
 */
export function protectShortcodes(text: string): string {
  return text.replace(/^(\s*(?:-[ \t]+)?query:[ \t]*)(!.*?)([ \t]+#.*)?$/gm, (_m, head: string, value: string, comment?: string) => `${head}${JSON.stringify(value.trim())}${comment ?? ''}`);
}

/** The reverse, after YAML has written a block out again: a plain query that starts with ! goes back to being bare. */
function restoreShortcodes(text: string): string {
  return text.replace(/^(\s*(?:-[ \t]+)?query:[ \t]*)"(![^"\\#]*)"/gm, (_m, head: string, value: string) => `${head}${value}`);
}

export function parseViewConfig(source: string): ParseResult {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return { ok: false, error: yamlErrorText(doc.errors[0]!) };
  return readViewObject(doc.toJS() as unknown);
}

function yamlErrorText(e: YAML.YAMLError): string {
  const line = e.linePos?.[0]?.line;
  return `${e.message.split('\n')[0]}${line ? ` (line ${line})` : ''}`;
}

/** Read one view from its settings, already parsed from YAML. */
function readViewObject(raw: unknown): ParseResult {
  const obj = raw === null || raw === undefined ? {} : raw;
  if (typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'A view needs settings like "type: table" and "query: ...".' };
  const o = obj as Record<string, unknown>;
  const type = o.type === undefined ? 'table' : String(o.type).toLowerCase();
  if (!(VIEW_TYPES as readonly string[]).includes(type)) return { ok: false, error: `Unknown view type "${String(o.type)}". Use ${VIEW_TYPES.join(', ')}.` };
  const config: ViewConfig = { type: type as ViewType, query: typeof o.query === 'string' ? o.query.trim() : '' };
  const title = asString(o.name) ?? asString(o.title);
  if (title) config.title = title;
  if (Array.isArray(o.sort)) o.sort = o.sort.map(String).join(',');
  for (const k of ['sort', 'group', 'date', 'cover'] as const) {
    const v = asString(o[k]);
    if (v) config[k] = v;
  }
  if (o.open === true || (typeof o.open === 'string' && o.open.trim().toLowerCase() === 'true')) config.open = true;
  if (o.hideTitle === true || (typeof o.hideTitle === 'string' && o.hideTitle.trim().toLowerCase() === 'true')) config.hideTitle = true;
  if (o.noDuplicateWarning === true || (typeof o.noDuplicateWarning === 'string' && o.noDuplicateWarning.trim().toLowerCase() === 'true')) config.noDuplicateWarning = true;
  if (typeof o.relationFiles === 'string' && ['link', 'skip'].includes(o.relationFiles.trim().toLowerCase())) config.relationFiles = o.relationFiles.trim().toLowerCase() as 'link' | 'skip';
  if (typeof o.groupDir === 'string' && o.groupDir.trim().toLowerCase() === 'desc') config.groupDir = 'desc';
  if (o.columns !== undefined) {
    const cols = Array.isArray(o.columns) ? o.columns.map(String) : typeof o.columns === 'string' ? o.columns.split(',') : null;
    if (!cols) return { ok: false, error: '"columns" should be a list, like [title, status, due].' };
    const clean = cols.map((c) => c.trim()).filter(Boolean);
    if (clean.length) config.columns = clean;
  }
  if (o.newFields !== undefined) {
    const cols = Array.isArray(o.newFields) ? o.newFields.map(String) : typeof o.newFields === 'string' ? o.newFields.split(',') : null;
    if (!cols) return { ok: false, error: '"newFields" should be a list, like [title, status, due].' };
    const clean = cols.map((c) => c.trim()).filter(Boolean);
    if (clean.length) config.newFields = clean;
  }
  if (o.computed !== undefined) {
    const bare = (s: string): string => { const m = /^\s*\$\{([\s\S]*)\}\s*$/.exec(s); return (m ? m[1]! : s).trim(); };
    const list: ComputedColumn[] = [];
    const src = o.computed;
    const entries: Array<[unknown, unknown]> = Array.isArray(src)
      ? src.map((x) => (x && typeof x === 'object' ? [(x as Record<string, unknown>).name, (x as Record<string, unknown>).expr ?? (x as Record<string, unknown>).formula] : [undefined, undefined]))
      : src && typeof src === 'object' ? Object.entries(src as Record<string, unknown>) : [];
    for (const [n, e] of entries) {
      const name = asString(n);
      const expr = typeof e === 'string' ? bare(e) : '';
      if (!name || !expr) return { ok: false, error: '"computed" needs a name and an expression for each column, like  Total: ${sum("project:$this", "cost")}' };
      list.push({ name, expr });
    }
    if (list.length) config.computed = list;
  }
  for (const k of ['formats', 'footer'] as const) {
    const v = o[k];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `"${k}" should list a column and its ${k === 'formats' ? 'format' : 'summary'}, like  cost: ${k === 'formats' ? 'currency' : 'sum'}` };
    const m: Record<string, string> = {};
    for (const [col, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val.trim()) m[col.trim().toLowerCase()] = val.trim().toLowerCase();
    if (Object.keys(m).length) config[k] = m;
  }
  if (o.wrap === true || (typeof o.wrap === 'string' && o.wrap.trim().toLowerCase() === 'true')) config.wrap = true;
  if (o.freeze !== undefined) {
    const n = Number(o.freeze === true ? 1 : o.freeze);
    if (Number.isFinite(n) && n >= 1) config.freeze = Math.min(3, Math.floor(n));
  }
  if (o.limit !== undefined) {
    const n = Number(o.limit);
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: '"limit" should be a number, like 100.' };
    config.limit = Math.min(1000, Math.floor(n));
  }
  if (o.pageSize !== undefined) {
    const n = Number(o.pageSize);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: '"pageSize" should be a number, like 25 (0 shows everything).' };
    config.pageSize = Math.min(1000, Math.floor(n));
  }
  if (o.colors !== undefined) {
    if (!Array.isArray(o.colors)) return { ok: false, error: '"colors" should be a list of rules, each with "when" and "color".' };
    const rules: ColorRule[] = [];
    for (const r of o.colors) {
      const when = r && typeof r === 'object' ? asString((r as Record<string, unknown>).when) : undefined;
      const color = r && typeof r === 'object' ? asString((r as Record<string, unknown>).color) : undefined;
      if (!when || !color || !colorValue(color)) return { ok: false, error: `A colour rule needs "when" (a query) and "color" (${COLOR_NAMES.join(', ')} or #rrggbb).` };
      rules.push({ when, color });
    }
    if (rules.length) config.colors = rules;
  }
  return { ok: true, config };
}

type Patch = Partial<Record<keyof ViewConfig, string | number | boolean | string[] | ColorRule[] | null>>;

function applyPatch(doc: YAML.Document, map: YAML.YAMLMap, patch: Patch): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === '' || v === false) map.delete(k);
    else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') map.set(k, doc.createNode(v));
    else if (Array.isArray(v)) {
      const seq = doc.createNode(v) as YAML.YAMLSeq;
      seq.flow = true;
      map.set(k, seq);
    } else map.set(k, v);
  }
}

const dump = (doc: YAML.Document): string => restoreShortcodes(doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd());

/** Change settings in the block's YAML text, keeping comments and the order of the other lines. null removes a setting. */
export function updateConfigSource(source: string, patch: Patch): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return source;
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  applyPatch(doc, doc.contents as YAML.YAMLMap, patch);
  return dump(doc);
}

export const NEW_VIEW_TEMPLATE = 'type: table\nquery: under:$this\n';

/** The settings of a new view that shows a saved query. */
export const savedViewTemplate = (name: string): string => `type: table\nquery: ${/^[\w-]+$/.test(name) ? `saved:${name}` : `saved:"${name.replace(/"/g, '')}"`}\n`;

// ---------------------------------------------------------------- several views in one block

/**
 * A block can hold several views as a YAML list under `views:`:
 *
 *     views:
 *       - name: Projects
 *         type: table
 *         query: under:$this type:project
 *       - type: gallery
 *         query: !Projects
 *
 * A block without `views:` is one view whose settings stand at the top.
 */
export interface ViewSet {
  /** every view of the block, in order; a `!Name` query shortcode is already worked out in `query` */
  views: ViewConfig[];
  segmented: boolean;
  /** the view that shows first: the first with `open: true`, else the first */
  openIndex: number;
  /** the problems with shortcodes (a name nobody has), for a note under the toolbar */
  warnings: string[];
}

/** Split off a leading `!Name` (or `!"Two words"`) shortcode from a query. */
export function shortcodeOf(query: string): { name: string; rest: string } | null {
  const m = /^\s*!(?:"([^"]+)"|(\S+))\s*(.*)$/s.exec(query);
  return m ? { name: (m[1] ?? m[2])!, rest: m[3] ?? '' } : null;
}

/** The `views:` list of a block, when it has one. */
function viewsSeq(doc: YAML.Document): YAML.YAMLSeq | null {
  if (!YAML.isMap(doc.contents)) return null;
  const v = doc.contents.get('views', true);
  return YAML.isSeq(v) ? v : null;
}

const OLD_FORMAT_HINT = 'Several views are written as a list now: put them under "views:" and start each with "- " (see the queries help).';

export function parseViewSet(source: string): { ok: true; set: ViewSet } | { ok: false; error: string } {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) {
    const old = /^view[ \t]*:/m.test(source) && doc.errors.some((e) => e.code === 'DUPLICATE_KEY');
    return { ok: false, error: old ? OLD_FORMAT_HINT : yamlErrorText(doc.errors[0]!) };
  }
  const seq = viewsSeq(doc);
  const views: ViewConfig[] = [];
  if (seq) {
    if (seq.items.length === 0) return { ok: false, error: '"views:" needs at least one item, starting with "- ".' };
    for (const [i, item] of seq.items.entries()) {
      const r = readViewObject(YAML.isNode(item) ? item.toJS(doc) : item);
      if (!r.ok) return { ok: false, error: `View ${i + 1}: ${r.error}` };
      views.push(r.config);
    }
  } else {
    const r = readViewObject(doc.toJS() as unknown);
    if (!r.ok) return r;
    views.push(r.config);
  }
  // `!Name` takes the query of the view of that name, then adds its own filters
  const warnings: string[] = [];
  const byName = new Map<string, number>();
  views.forEach((v, i) => {
    if (v.title && !byName.has(v.title.toLowerCase())) byName.set(v.title.toLowerCase(), i);
  });
  const resolved = new Map<number, string>();
  const work = (i: number, stack: number[]): string => {
    if (resolved.has(i)) return resolved.get(i)!;
    const q = views[i]!.query;
    const sc = shortcodeOf(q);
    let out = q;
    if (sc) {
      const j = byName.get(sc.name.toLowerCase());
      if (j === undefined) {
        warnings.push(`There is no view called \u201c${sc.name}\u201d to take the query from.`);
        out = sc.rest;
      } else if (stack.includes(j) || j === i) {
        warnings.push(`The view \u201c${sc.name}\u201d takes its query from itself.`);
        out = sc.rest;
      } else out = `${work(j, [...stack, i])} ${sc.rest}`.trim();
    }
    resolved.set(i, out);
    return out;
  };
  const full = views.map((v, i) => ({ ...v, query: work(i, []) }));
  return { ok: true, set: { views: full, segmented: seq !== null, openIndex: Math.max(0, views.findIndex((v) => v.open === true)), warnings: [...new Set(warnings)] } };
}

/** The settings map of view `index` (a flat block is view 0), or null. */
function viewMap(doc: YAML.Document, index: number): YAML.YAMLMap | null {
  const seq = viewsSeq(doc);
  if (seq) {
    const item = seq.items[index];
    return YAML.isMap(item) ? item : null;
  }
  return index === 0 && YAML.isMap(doc.contents) ? doc.contents : null;
}

/** What a view's own `query:` says (the `!Name` shortcode not worked out), for editing. */
export function ownQueryOf(source: string, index: number): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return '';
  const q = viewMap(doc, index)?.get('query');
  return typeof q === 'string' ? q.trim() : '';
}

/** Change settings of one view of the block (index 0 of a block with a single flat view is that view). */
export function updateViewSource(source: string, index: number, patch: Patch): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return source;
  let map = viewMap(doc, index);
  if (!map) {
    if (index !== 0 || doc.contents) return source;
    map = doc.createNode({}) as YAML.YAMLMap;
    doc.contents = map as never;
  }
  const p = viewsSeq(doc) && 'title' in patch ? (Object.fromEntries(Object.entries(patch).map(([k, v]) => [k === 'title' ? 'name' : k, v])) as Patch) : patch;
  applyPatch(doc, map, p);
  return dump(doc);
}

/**
 * Remember which view of a block of several is open: `open: true` goes on that view and comes off the others, so the block opens
 * on it next time. A block of one view, and a block that already says so, come back unchanged.
 */
export function setOpenView(source: string, index: number): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return source;
  const seq = viewsSeq(doc);
  if (!seq || seq.items.length < 2 || index < 0 || index >= seq.items.length) return source;
  const isOpen = (m: YAML.YAMLMap): boolean => {
    const v = m.get('open');
    return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
  };
  const maps = seq.items.map((it) => (YAML.isMap(it) ? it : null));
  // already right: this one is the first open view and no later one claims to be open too
  const firstOpen = maps.findIndex((m) => m && isOpen(m));
  if ((firstOpen === index || (firstOpen === -1 && index === 0)) && maps.filter((m, i) => m && isOpen(m) && i !== index).length === 0) return source;
  maps.forEach((m, i) => {
    if (!m) return;
    if (i === index) m.set('open', true);
    else m.delete('open');
  });
  // the first view is the default: it needs no mark
  if (index === 0) maps[0]?.delete('open');
  return dump(doc);
}

/** Rename one key of a map, keeping its place (and comment) among the others. */
function renameKey(map: YAML.YAMLMap, from: string, to: string): void {
  if (map.has(to)) return;
  for (const pair of map.items) if (YAML.isScalar(pair.key) && pair.key.value === from) pair.key.value = to;
}

/** Add a view at the end of the block (the block becomes a block of several views when it was one flat view). */
export function addViewToSource(source: string, view: { name?: string; type: ViewType; query: string }): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return source;
  let seq = viewsSeq(doc);
  if (!seq) {
    const flat = YAML.isMap(doc.contents) ? doc.contents : (doc.createNode({}) as YAML.YAMLMap);
    renameKey(flat, 'title', 'name');
    seq = new YAML.YAMLSeq();
    seq.items.push(flat);
    const root = new YAML.YAMLMap();
    root.set('views', seq);
    doc.contents = root as never;
  }
  const item = doc.createNode({ ...(view.name ? { name: view.name } : {}), type: view.type, query: view.query }) as YAML.YAMLMap;
  seq.items.push(item);
  return dump(doc);
}

/** Copy view number `index` (all its settings) to the end of the block, named "<name> copy". The block becomes a block of several views when it was one flat view. */
export function duplicateViewInSource(source: string, index: number): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  if (doc.errors.length > 0) return source;
  let seq = viewsSeq(doc);
  if (!seq) {
    const flat = YAML.isMap(doc.contents) ? doc.contents : (doc.createNode({}) as YAML.YAMLMap);
    renameKey(flat, 'title', 'name');
    seq = new YAML.YAMLSeq();
    seq.items.push(flat);
    const root = new YAML.YAMLMap();
    root.set('views', seq);
    doc.contents = root as never;
  }
  const from = seq.items[index];
  if (!YAML.isMap(from)) return source;
  const copy = from.clone() as YAML.YAMLMap;
  copy.delete('open'); // the copy is not the one the block opens on
  const name = from.get('name');
  copy.set('name', typeof name === 'string' && name ? `${name} copy` : 'Copy');
  seq.items.splice(index + 1, 0, copy);
  return dump(doc);
}

/** Take a view out of a block of several (the last one stays; a block of one view turns flat again). */
export function removeViewFromSource(source: string, index: number): string {
  const doc = YAML.parseDocument(protectShortcodes(source));
  const seq = doc.errors.length > 0 ? null : viewsSeq(doc);
  if (!seq || seq.items.length < 2) return source;
  seq.items.splice(index, 1);
  if (seq.items.length === 1 && YAML.isMap(seq.items[0])) {
    renameKey(seq.items[0], 'name', 'title');
    doc.contents = seq.items[0] as never;
  }
  return dump(doc);
}

/** The extension of a view file: a page that is a database view and nothing else. */
export const VIEW_FILE_EXT = '.view';

/** What a new view file holds: a table of the pages under the view file itself (its children). The settings sit under `views:` so that they are not page attributes. */
export const NEW_VIEW_FILE = '---\nviews:\n  - type: table\n    query: under:$this\n---\n';

/**
 * A view file is a page whose front matter holds the view's settings (the same keys as inside a ```view block, or a `view:`
 * list of several), with any other front matter keys serving as the page's own attributes; text after the front matter is a
 * description. A file with no front matter is read whole as settings. Returns the settings text and where it sits in the file.
 */
export function viewFileConfig(text: string): { config: string; from: number; to: number } {
  const m = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n)?^---[ \t]*(?:\r?\n|$)/m.exec(text);
  if (m && m.index === 0) {
    const from = m[1]!.length;
    return { config: m[2]!, from, to: from + m[2]!.length };
  }
  return { config: text, from: 0, to: text.length };
}

/** The file text with its settings replaced (everything outside them, the description included, stays as it is). */
export function withViewFileConfig(text: string, next: string): string {
  const at = viewFileConfig(text);
  return `${text.slice(0, at.from)}${next.replace(/\n+$/, '')}${at.from === 0 && at.to === text.length ? '\n' : ''}${text.slice(at.to)}`;
}
