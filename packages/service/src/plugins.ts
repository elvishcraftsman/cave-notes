/**
 * Plugins: installable packages (see docs/workspaces/making-plugins.md).
 *
 * A package is a set of files with a `plugin.yaml` at its root (a `.cnplugin` zip, a folder, or a zip of a folder, read by the
 * caller into `files`). Installing one writes **one folder** into the `plugins/` folder of its scope (a workspace's
 * `.cave-notes` or the app config folder), and leaves a record in it (`.installed.json`) once everything else is in place.
 * The settings loader (core-index config.js) reads an installed plugin from `automations/`, `definitions/` and `styles/`;
 * templates are found in `templates/` (templates.ts); `assets/` is for pictures and fonts; `base/` keeps the files as they were
 * installed.
 *
 * Everything here works on plain data: `parsePackage` and `planInstall` write nothing, so a window can show what an install
 * would do, and `writeInstall` writes the plan (all or nothing: a temporary folder, then one rename).
 */
import YAML from 'yaml';
import { FILE_CHANGING, coerceAnswers, normalizeAsk, parseAutomations, previewAnswers } from '@cave-notes/core-automation';
import { fs, path, sha1 } from '@cave-notes/platform';
import { safeStem } from '@cave-notes/core-tree';

export type PluginScope = 'workspace' | 'app' | 'shared';
export const PLUGIN_SCOPES: PluginScope[] = ['workspace', 'app', 'shared'];
export const PLUGIN_MANIFEST = 'plugin.yaml';
export const PLUGIN_RECORD = '.installed.json';

/** The sections a file of each part may hold (the settings loader enforces the same lists). */
export const PART_SECTIONS = {
  automations: ['rules', 'settings'],
  definitions: ['schema', 'attributes', 'files', 'queries', 'relations'],
  styles: ['export-style'],
} as const;

export interface SetupQuestion {
  name: string;
  label: string;
  type: string;
  default: unknown;
  options: string[] | null;
  min: number | null;
  max: number | null;
}

export interface PluginTemplateEntry {
  /** path in the package */
  path: string;
  /** the template's name: its file name without the extension */
  name: string;
  managed: boolean;
  hidden: boolean;
}

export interface PluginPageEntry {
  /** a template of this plugin, by name */
  from: string;
  /** where the page is made, as written (may hold `{{setup.name}}`) */
  path: string;
  open: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  homepage: string | null;
  minAppVersion: string | null;
  scopes: PluginScope[];
  icon: string | null;
  setup: SetupQuestion[];
  automations: string[];
  definitions: string[];
  styles: string[];
  templates: PluginTemplateEntry[];
  pages: PluginPageEntry[];
  assets: string[];
  renamed: { templates: Record<string, string> };
}

export interface PluginPackage {
  manifest: PluginManifest;
  /** every file of the package, by path with `/` */
  files: Map<string, Uint8Array>;
  readme: string | null;
}

export type ParseResult = { ok: true; plugin: PluginPackage; warnings: string[] } | { ok: false; errors: string[] };

const dec = new TextDecoder();
const enc = new TextEncoder();
const text = (b: Uint8Array): string => dec.decode(b);
const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `1.2.3` (and `1.2`, `1`): the numbers, or null. */
export function versionParts(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
/** <0, 0 or >0 as `a` is older than, the same as, or newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a) ?? [0, 0, 0];
  const y = versionParts(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** A path inside a package: no `..`, no absolute path, no backslashes, no empty parts. */
export function safeRel(p: string): string | null {
  if (typeof p !== 'string' || p === '' || p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((x) => x === '' || x === '..' || x === '.')) return null;
  return parts.join('/');
}

const SETUP_TOKEN = /\{\{\s*setup\.([A-Za-z_]\w*)\s*\}\}/g;
const tokensIn = (s: string): string[] => [...s.matchAll(SETUP_TOKEN)].map((m) => m[1]!);

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** What the package says about itself, checked. Reads nothing but `files`. */
export function parsePackage(files: Record<string, Uint8Array> | Map<string, Uint8Array>, opts: { appVersion?: string } = {}): ParseResult {
  const all = files instanceof Map ? new Map(files) : new Map(Object.entries(files));
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const name of all.keys()) if (safeRel(name) === null) errors.push(`The package holds an unsafe path: ${name}`);
  if (errors.length > 0) return { ok: false, errors };
  const raw = all.get(PLUGIN_MANIFEST);
  if (!raw) return { ok: false, errors: [`The package has no ${PLUGIN_MANIFEST} at its top.`] };
  let doc: unknown;
  try {
    doc = YAML.parse(text(raw));
  } catch (e) {
    return { ok: false, errors: [`${PLUGIN_MANIFEST} is not valid YAML: ${(e as Error).message}`] };
  }
  if (!isMap(doc) || !isMap(doc.plugin)) return { ok: false, errors: [`${PLUGIN_MANIFEST} must start with a “plugin:” section (id, name, version, description).`] };
  const KNOWN = new Set(['plugin', 'setup', 'automations', 'definitions', 'export-styles', 'templates', 'pages', 'assets', 'renamed']);
  for (const k of Object.keys(doc)) if (!KNOWN.has(k)) warnings.push(`${PLUGIN_MANIFEST}: “${k}” is not something a plugin file says, so it is ignored`);
  const p = doc.plugin;
  const str = (k: string, required: boolean): string | null => {
    const v = p[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      if (required) errors.push(`plugin: “${k}” is missing`);
      return null;
    }
    return String(v).trim();
  };
  const id = str('id', true);
  if (id !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) errors.push('plugin: “id” is lowercase letters, digits and - (at most 64)');
  const name = str('name', true);
  const version = str('version', true);
  if (version !== null && versionParts(version) === null) errors.push('plugin: “version” looks like 1.0.0');
  const description = str('description', true);
  const minAppVersion = str('minAppVersion', false);
  if (minAppVersion !== null) {
    if (versionParts(minAppVersion) === null) errors.push('plugin: “minAppVersion” looks like 0.20.0');
    else if (opts.appVersion && compareVersions(opts.appVersion, minAppVersion) < 0) errors.push(`This plugin needs Cave Notes ${minAppVersion} or newer (this is ${opts.appVersion}).`);
  }
  const scopes: PluginScope[] = [];
  for (const s of list(p.scopes)) {
    if (PLUGIN_SCOPES.includes(s as PluginScope)) scopes.push(s as PluginScope);
    else errors.push(`plugin: scope “${String(s)}” is not one of ${PLUGIN_SCOPES.join(', ')}`);
  }
  if (scopes.length === 0) scopes.push('workspace', 'app', 'shared');
  const icon = str('icon', false);
  if (icon !== null && !all.has(icon)) errors.push(`plugin: the icon “${icon}” is not in the package`);

  let setup: SetupQuestion[] = [];
  try {
    setup = normalizeAsk(doc.setup) as SetupQuestion[];
  } catch (e) {
    errors.push(`setup: ${(e as Error).message.replace(/^ask: /, '')}`);
  }

  const need = (kind: string, rel: unknown): string | null => {
    const r = typeof rel === 'string' ? safeRel(rel) : null;
    if (r === null) {
      errors.push(`${kind}: “${String(rel)}” is not a path inside the package`);
      return null;
    }
    if (!all.has(r)) {
      errors.push(`${kind}: “${r}” is not in the package`);
      return null;
    }
    return r;
  };
  const files_ = (kind: string, v: unknown, part: string): string[] => {
    const out: string[] = [];
    for (const x of list(v)) {
      const r = need(kind, x);
      if (r === null) continue;
      if (!r.startsWith(`${part}/`) || !/\.ya?ml$/i.test(r)) errors.push(`${kind}: “${r}” has to be a YAML file in the ${part}/ folder`);
      else out.push(r);
    }
    return out;
  };
  const automations = files_('automations', doc.automations, 'automations');
  const definitions = files_('definitions', doc.definitions, 'definitions');
  const styles = files_('export-styles', doc['export-styles'], 'styles');

  const exts = ['.md', '.txt'];
  const templates: PluginTemplateEntry[] = [];
  for (const t of list(doc.templates)) {
    const e = typeof t === 'string' ? { path: t } : isMap(t) ? t : null;
    if (!e) {
      errors.push('templates: each entry is a path, or { path, managed, hidden }');
      continue;
    }
    const r = need('templates', e.path);
    if (r === null) continue;
    if (!r.startsWith('templates/')) {
      errors.push(`templates: “${r}” has to be in the templates/ folder`);
      continue;
    }
    const f = r.slice(r.lastIndexOf('/') + 1);
    const ext = exts.find((x) => f.toLowerCase().endsWith(x));
    if (!ext) {
      errors.push(`templates: “${r}” is not a note file (.md)`);
      continue;
    }
    templates.push({ path: r, name: f.slice(0, -ext.length), managed: e.managed === true, hidden: e.hidden === true });
  }
  const names = new Set<string>();
  for (const t of templates) {
    if (names.has(t.name.toLowerCase())) errors.push(`templates: two templates are called “${t.name}”`);
    names.add(t.name.toLowerCase());
  }

  const pages: PluginPageEntry[] = [];
  for (const g of list(doc.pages)) {
    if (!isMap(g) || typeof g.from !== 'string' || typeof g.path !== 'string' || g.path.trim() === '') {
      errors.push('pages: each starter page needs “from” (a template of this plugin) and “path”');
      continue;
    }
    if (!names.has(g.from.trim().toLowerCase())) errors.push(`pages: “${g.from}” is not a template of this plugin`);
    pages.push({ from: g.from.trim(), path: g.path.trim(), open: g.open === true });
  }
  if (pages.filter((g) => g.open).length > 1) errors.push('pages: only one page can be opened after installing');

  const assets: string[] = [];
  for (const a of list(doc.assets)) {
    const r = typeof a === 'string' ? safeRel(a.replace(/\/$/, '')) : null;
    if (r === null || ![...all.keys()].some((k) => k === r || k.startsWith(`${r}/`))) errors.push(`assets: “${String(a)}” is not in the package`);
    else if (r !== 'assets' && !r.startsWith('assets/')) errors.push(`assets: “${r}” has to be in the assets/ folder`);
    else assets.push(r);
  }

  const renamed = { templates: {} as Record<string, string> };
  if (isMap(doc.renamed) && isMap(doc.renamed.templates)) for (const [a, b] of Object.entries(doc.renamed.templates)) renamed.templates[a] = String(b);

  // the setup values: every {{setup.x}} must name a question
  const declared = new Set(setup.filter((q) => q.type !== 'info').map((q) => q.name));
  const checkTokens = (rel: string): void => {
    if (!/\.(ya?ml|md|txt)$/i.test(rel)) return;
    const body = text(all.get(rel)!);
    for (const [i, line] of body.split(/\r?\n/).entries()) for (const t of tokensIn(line)) if (!declared.has(t)) errors.push(`${rel} line ${i + 1}: {{setup.${t}}} is not one of the setup questions`);
  };
  for (const rel of all.keys()) if (rel !== PLUGIN_MANIFEST || true) checkTokens(rel);
  for (const g of pages) for (const t of tokensIn(g.path)) if (!declared.has(t)) errors.push(`pages: {{setup.${t}}} in “${g.path}” is not one of the setup questions`);

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  const manifest: PluginManifest = {
    id: id!, name: name!, version: version!, description: description!,
    author: str('author', false), homepage: str('homepage', false), minAppVersion, scopes, icon, setup, automations, definitions, styles, templates, pages, assets, renamed,
  };
  const pkg: PluginPackage = { manifest, files: all, readme: all.has('README.md') ? text(all.get('README.md')!) : null };

  // each item is checked with the code that loads it
  const ids = checkItems(pkg);
  if (ids.length > 0) return { ok: false, errors: ids };
  return { ok: true, plugin: pkg, warnings };
}

/** The answers with the types their questions give, and the defaults for the rest. Throws a message a person can read. */
export function setupValues(setup: SetupQuestion[], answers: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> {
  return coerceAnswers(setup, answers ?? {}) as Record<string, string | number | boolean>;
}

/** Check the items of a package as they would be installed with the default answers. Returns the problems. */
function checkItems(pkg: PluginPackage): string[] {
  const out: string[] = [];
  let values: Record<string, string | number | boolean>;
  try {
    values = setupValues(pkg.manifest.setup, null);
  } catch (e) {
    // a question with no usable default: check with the preview values (empty where there is nothing)
    values = previewAnswers(pkg.manifest.setup, null) as Record<string, string | number | boolean>;
    for (const k of Object.keys(values)) if (values[k] === null) values[k] = '';
    void e;
  }
  const part = (rel: string, allowed: readonly string[], what: string): void => {
    let filled: string;
    try {
      filled = fillSetup(rel, text(pkg.files.get(rel)!), values);
    } catch (e) {
      out.push(`${rel}: ${(e as Error).message}`);
      return;
    }
    let doc: unknown;
    try {
      doc = YAML.parse(filled);
    } catch (e) {
      out.push(`${rel} is not valid YAML: ${(e as Error).message.split('\n')[0]}`);
      return;
    }
    if (doc === null || doc === undefined) return;
    if (!isMap(doc)) {
      out.push(`${rel}: ${what} file is a list of sections, not ${Array.isArray(doc) ? 'a list' : 'a single value'}`);
      return;
    }
    // a styles file is the styles themselves (`Letterhead:`) or the same under `export-style:`; installed, it is always the second
    if (what === 'styles') {
      if ('export-style' in doc && Object.keys(doc).length > 1) out.push(`${rel}: a styles file is either the styles themselves or only an “export-style:” section, not both`);
      return;
    }
    for (const k of Object.keys(doc)) if (!allowed.includes(k)) out.push(`${rel}: a ${what} file may hold only ${allowed.join(', ')}; “${k}” does not belong here`);
    if (what === 'automations' && 'rules' in doc) {
      const r = parseAutomations(filled);
      for (const e of r.errors as string[]) out.push(`${rel}: ${e}`);
    }
  };
  for (const rel of pkg.manifest.automations) part(rel, PART_SECTIONS.automations, 'automations');
  for (const rel of pkg.manifest.definitions) part(rel, PART_SECTIONS.definitions, 'definitions');
  for (const rel of pkg.manifest.styles) part(rel, ['export-style'], 'styles');
  return out;
}

// ---------------------------------------------------------------- setup values

/**
 * Put the answers in place of `{{setup.name}}` in the text of one file. A YAML file stays valid and means the same: a value is
 * written as a proper YAML scalar (a number or true/false where the answer is one and it fills a whole value, else text), so
 * `: `, `#`, quotes and line breaks in an answer are safe. Everything else (`${…}`, `{{title}}`, `{{date}}`) is untouched. In a
 * note the frontmatter is treated like a YAML file and the body gets the plain text.
 */
export function fillSetup(file: string, body: string, values: Record<string, unknown>): string {
  if (!/\{\{\s*setup\./.test(body)) return body;
  if (/\.ya?ml$/i.test(file)) return fillYaml(file, body, values);
  if (/\.(md|txt)$/i.test(file)) {
    const m = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(body);
    if (m) return m[1]! + (/\{\{\s*setup\./.test(m[2]!) ? fillYaml(file, m[2]!, values).replace(/\n$/, '') : m[2]!) + m[3]! + plain(body.slice(m[0].length), values);
    return plain(body, values);
  }
  return plain(body, values);
}

const plain = (s: string, values: Record<string, unknown>): string => s.replace(SETUP_TOKEN, (_all, n: string) => (n in values ? String(values[n]) : _all));

function fillYaml(file: string, body: string, values: Record<string, unknown>): string {
  const marks: string[] = [];
  // a token is swapped for a word that is a plain scalar anywhere in YAML, and the real value goes in after parsing
  const guarded = body.replace(SETUP_TOKEN, (_all, n: string) => {
    marks.push(n);
    return `CNSETUP${marks.length - 1}X`;
  });
  const doc = YAML.parseDocument(guarded);
  if (doc.errors.length > 0) throw new Error(`${file} could not be read (${doc.errors[0]!.message.split('\n')[0]})`);
  const MARK = /CNSETUP(\d+)X/g;
  YAML.visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value !== 'string' || !MARK.test(node.value)) return;
      MARK.lastIndex = 0;
      const whole = /^CNSETUP(\d+)X$/.exec(node.value);
      if (whole) {
        const v = values[marks[Number(whole[1])]!];
        if (typeof v === 'number' || typeof v === 'boolean') {
          node.value = v;
          node.type = undefined;
          return;
        }
      }
      node.value = node.value.replace(MARK, (_a, i: string) => String(values[marks[Number(i)]!] ?? ''));
      // a value that holds a line break reads best as a block, a short one as it was
      if (node.type === 'PLAIN') node.type = undefined;
    },
  });
  return doc.toString({ lineWidth: 0 });
}

/** A page path with the answers in it. A value stays one segment (no `/`), and loses leading dots. */
export function fillPath(p: string, values: Record<string, unknown>): string {
  const cleaned = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v).replace(/[/\\]/g, '-').replace(/^\.+/, '').trim()]));
  return plain(p, cleaned).split('/').map((s) => s.trim()).filter((s) => s !== '').join('/');
}

// ---------------------------------------------------------------- what a plugin can do

export interface Capability {
  kind: 'changes-pages' | 'runs-on-its-own' | 'runs-js' | 'runs-shell' | 'installs-automations' | 'changes-definitions' | 'shared' | 'content-only';
  text: string;
  /** shown in warning colour */
  warn?: boolean;
}

/** The names of actions used anywhere in a rule's `do:`, however deeply (on_success and so on). */
function actionNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const x of node) actionNames(x, out);
  else if (isMap(node)) for (const [k, v] of Object.entries(node)) {
    out.add(k);
    actionNames(v, out);
  }
  return out;
}

/** In words, when an automation that is not a button or a menu automation runs. */
function whenText(t: Record<string, unknown> | string): string {
  const kind = typeof t === 'string' ? t : Object.keys(t)[0]!;
  const v = typeof t === 'string' ? null : t[kind];
  const at = isMap(v) ? v : {};
  switch (kind) {
    case 'change': return 'when a page’s attribute changes';
    case 'match': return 'when a page starts to match a search';
    case 'create': return 'when a page is made';
    case 'schedule': return at.every || at.cron || at.at ? `on a schedule (${String(at.every ?? at.cron ?? at.at)})` : 'on a schedule';
    case 'daily': return 'every day';
    case 'weekly': return 'every week';
    case 'startup': return 'when the workspace opens';
    default: return `when “${kind}” happens`;
  }
}

/** What the content of a plugin can do, worked out from the content and from nothing else. */
export function capabilitiesOf(pkg: PluginPackage, scope: PluginScope, values: Record<string, unknown>, ctx: { jsAllowed?: boolean } = {}): Capability[] {
  const out: Capability[] = [];
  const changes: string[] = [];
  const own: string[] = [];
  let js = false;
  let shell = false;
  let installs = false;
  for (const rel of pkg.manifest.automations) {
    let doc: unknown;
    try {
      doc = YAML.parse(fillSetup(rel, text(pkg.files.get(rel)!), values));
    } catch {
      continue;
    }
    const rules = isMap(doc) && Array.isArray(doc.rules) ? doc.rules : [];
    for (const r of rules) {
      if (!isMap(r)) continue;
      const label = String(r.name ?? r.id ?? '');
      const names = actionNames(r.do ?? r.actions);
      if ([...names].some((n) => FILE_CHANGING.has(n))) changes.push(label);
      if (names.has('run_js')) js = true;
      if (names.has('run_shell')) shell = true;
      if (names.has('install_automations')) installs = true;
      const triggers = list(r.on ?? r.trigger) as Array<Record<string, unknown> | string>;
      const selfStarting = triggers.filter((t) => {
        const k = typeof t === 'string' ? t : Object.keys(t)[0];
        return k !== 'button' && k !== 'plugin' && k !== 'menu';
      });
      if (selfStarting.length > 0) own.push(`${label} (${whenText(selfStarting[0]!)})`);
    }
  }
  if (changes.length > 0) out.push({ kind: 'changes-pages', text: `Changes pages: ${changes.join(', ')}` });
  if (own.length > 0) out.push({ kind: 'runs-on-its-own', text: `Runs on its own: ${own.join('; ')}` });
  if (js) out.push({ kind: 'runs-js', text: ctx.jsAllowed === false ? 'Runs JavaScript (needs “Let automations run JavaScript” in Preferences, which is off)' : 'Runs JavaScript' });
  if (shell) out.push({ kind: 'runs-shell', text: 'Runs programs on this computer', warn: true });
  if (installs) out.push({ kind: 'installs-automations', text: 'Installs further automations' });
  if (pkg.manifest.definitions.length > 0) out.push({ kind: 'changes-definitions', text: 'Adds to how your pages are described (attributes, saved searches, relations)' });
  if (scope === 'shared') out.push({ kind: 'shared', text: 'Shared with every workspace that opens this one', warn: true });
  if (out.length === 0) out.push({ kind: 'content-only', text: 'Adds content only; runs nothing by itself.' });
  return out;
}

const SHAREABLE = new Set(['rules', 'schema', 'attributes', 'queries', 'relations', 'export-style']);

/** Tag the sections of a settings file that can be shared with `!global` (what the “shared” scope writes). */
export function tagShared(body: string): string {
  const doc = YAML.parseDocument(body);
  if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) return body;
  for (const pair of doc.contents.items) {
    const key = String((pair.key as { value?: unknown })?.value ?? pair.key);
    if (SHAREABLE.has(key) && YAML.isNode(pair.value)) (pair.value as { tag?: string }).tag = '!global';
  }
  return doc.toString({ lineWidth: 0 });
}

// ---------------------------------------------------------------- the plan

export interface ExistingNames {
  /** names that are taken in the place the plugin goes (case does not matter) */
  styles: ReadonlySet<string>;
  templates: ReadonlySet<string>;
  queries: ReadonlySet<string>;
  /** folders of `plugins/` that exist: folder name -> the plugin id installed there, or null when it is not one */
  folders: ReadonlyMap<string, string | null>;
  /** is there a page at this path (made from the plugin's page entries)? */
  pageTaken(path: string): boolean;
}

export interface Conflict {
  kind: 'export-style' | 'template' | 'query' | 'schema' | 'page' | 'folder';
  name: string;
  /** what the install does about it (the safe choice) */
  resolution: 'keep-both' | 'add-to-it' | 'make-as';
  becomes?: string;
  text: string;
}

export interface PlannedFile {
  /** path inside the plugin folder */
  rel: string;
  data: Uint8Array;
  kind: 'automations' | 'definitions' | 'export-style' | 'template' | 'asset' | 'readme' | 'icon' | 'base';
}

export interface PlannedPage {
  template: string;
  path: string;
  open: boolean;
  pageId: string;
  managed: boolean;
}

export interface InstallRecord {
  plugin: string;
  name: string;
  version: string;
  scope: PluginScope;
  folder: string;
  installed: string;
  updated: string;
  setup: Record<string, unknown>;
  items: Array<{ kind: string; path: string; fingerprint?: string; name?: string; names?: string[]; managed?: boolean; hidden?: boolean }>;
  pages: Array<{ pageId: string; template: string; path: string }>;
  /** names the plugin's own were given when something else had them (a template, an export style, a saved search): kept for updates */
  renames?: { templates: Record<string, string>; styles: Record<string, string>; queries: Record<string, string> };
}

export interface InstallPlan {
  manifest: PluginManifest;
  scope: PluginScope;
  /** the folder's name in `plugins/` */
  folder: string;
  files: PlannedFile[];
  pages: PlannedPage[];
  conflicts: Conflict[];
  /** in plain words, for the window: what it adds */
  adds: string[];
  can: Capability[];
  record: InstallRecord;
}

/** A hash of a text that does not change with line endings or trailing spaces: how the app tells whether a file was edited. */
export const fingerprint = (data: string | Uint8Array): string => sha1((typeof data === 'string' ? data : text(data)).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd());

const lc = (s: string): string => s.toLowerCase();

function uniqueName(base: string, taken: (n: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base} ${n}`)) return `${base} ${n}`;
}

/** Rename keys and values in a YAML text: `rename(key, value)` returns a replacement for a string value, or null. */
function rewriteYaml(body: string, edit: (doc: YAML.Document) => void): string {
  const doc = YAML.parseDocument(body);
  if (doc.errors.length > 0) return body;
  edit(doc);
  return doc.toString({ lineWidth: 0 });
}

/** Change what names a template, a style or a query in a text (a YAML file or a note's frontmatter), in the places that refer to one. */
function renameRefs(file: string, body: string, ren: { templates: Map<string, string>; styles: Map<string, string>; queries: Map<string, string> }): string {
  const refKeys: Array<[string, Map<string, string>]> = [['template', ren.templates], ['childTemplate', ren.templates], ['exportStyle', ren.styles], ['from', ren.queries], ['to', ren.queries]];
  const fix = (doc: YAML.Document): void => {
    YAML.visit(doc, {
      Pair(_k, pair) {
        const key = YAML.isScalar(pair.key) ? String(pair.key.value) : '';
        for (const [k, map] of refKeys) {
          if (key !== k || !YAML.isScalar(pair.value) || typeof pair.value.value !== 'string') continue;
          const v = pair.value.value;
          const link = /^\[\[(.+)\]\]$/.exec(v);
          const name = link ? link[1]! : v;
          const hit = [...map].find(([a]) => lc(a) === lc(name));
          if (hit) pair.value.value = link ? `[[${hit[1]}]]` : hit[1];
        }
      },
    });
  };
  if (/\.ya?ml$/i.test(file)) return rewriteYaml(body, fix);
  if (/\.md$/i.test(file)) {
    const m = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(body);
    let out = body;
    if (m) {
      const fm = rewriteYaml(m[2]!, fix);
      out = m[1] + fm.replace(/\n$/, '') + m[3] + body.slice(m[0].length);
    }
    // saved searches used in a view block: `query: !Name`
    for (const [a, b] of ren.queries) out = out.replace(new RegExp(`(query:\\s*!)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), `$1${b}`);
    return out;
  }
  return body;
}

/** Name a style, template or query taken by something else: `Name (Plugin name)`, and a number after that if needed. */
const keepBoth = (name: string, plugin: string, taken: (n: string) => boolean): string => uniqueName(`${name} (${plugin})`, taken);

/**
 * What installing `pkg` would do, in a place described by `existing`. Writes nothing. Throws a message a person can read when
 * the answers do not fit the questions.
 */
export function planInstall(
  pkg: PluginPackage,
  opts: {
    scope: PluginScope;
    answers?: Record<string, unknown>;
    existing: ExistingNames;
    now?: Date;
    jsAllowed?: boolean;
    /** an update: the folder it already has, the names it was given before, and no new starter pages */
    update?: { folder: string; renames: NonNullable<InstallRecord['renames']> };
  },
): InstallPlan {
  const m = pkg.manifest;
  if (!m.scopes.includes(opts.scope)) throw new Error(`This plugin cannot be installed ${opts.scope === 'app' ? 'for the whole app' : opts.scope === 'shared' ? 'shared with every workspace' : 'in a workspace'}.`);
  const values = setupValues(m.setup, opts.answers);
  const conflicts: Conflict[] = [];
  const ex = opts.existing;

  // the folder
  let folder = opts.update ? opts.update.folder : safeStem(m.name);
  const there = opts.update ? undefined : ex.folders.get(folder);
  if (there !== undefined) {
    if (there === m.id) throw new Error(`“${m.name}” is already installed. Remove it first (updating comes later).`);
    const becomes = uniqueName(folder, (n) => ex.folders.has(n));
    conflicts.push({ kind: 'folder', name: folder, resolution: 'make-as', becomes, text: `A folder called “${folder}” is in plugins already; this one is made as “${becomes}”.` });
    folder = becomes;
  }

  // names of styles, templates and queries that the plugin brings
  const styleNames: string[] = [];
  const queryNames: string[] = [];
  const read = (rel: string): string => fillSetup(rel, text(pkg.files.get(rel)!), values);
  for (const rel of m.styles) {
    const d = YAML.parse(read(rel)) as unknown;
    const set = isMap(d) && isMap(d['export-style']) ? d['export-style'] : isMap(d) ? d : {};
    styleNames.push(...Object.keys(set));
  }
  for (const rel of m.definitions) {
    const d = YAML.parse(read(rel)) as unknown;
    if (isMap(d) && isMap(d.queries)) queryNames.push(...Object.keys(d.queries));
    if (isMap(d) && isMap(d.schema)) {
      // a schema entry of a kind the workspace already has is added to, never replaced: the workspace's own win by name (the loader sees to that)
      for (const k of Object.keys(d.schema)) conflicts.push({ kind: 'schema', name: k, resolution: 'add-to-it', text: `“${k}” is described by the plugin too; where the workspace already describes it, the workspace’s own description is kept.` });
    }
  }
  // schema "conflicts" are only worth telling about when the workspace really has the name: the caller decides by what it passes in `existing`
  const schemaTaken = (ex as ExistingNames & { schema?: ReadonlySet<string> }).schema;
  for (let i = conflicts.length - 1; i >= 0; i--) if (conflicts[i]!.kind === 'schema' && !(schemaTaken?.has(lc(conflicts[i]!.name)))) conflicts.splice(i, 1);

  const ren = {
    templates: new Map<string, string>(Object.entries(opts.update?.renames.templates ?? {})),
    styles: new Map<string, string>(Object.entries(opts.update?.renames.styles ?? {})),
    queries: new Map<string, string>(Object.entries(opts.update?.renames.queries ?? {})),
  };
  const takenT = (n: string): boolean => ex.templates.has(lc(n)) || m.templates.some((t) => lc(t.name) === lc(n) && t.name !== n) || [...ren.templates.values()].some((v) => lc(v) === lc(n));
  for (const t of m.templates) {
    if (ren.templates.has(t.name) || !ex.templates.has(lc(t.name))) continue;
    const becomes = keepBoth(t.name, m.name, takenT);
    ren.templates.set(t.name, becomes);
    conflicts.push({ kind: 'template', name: t.name, resolution: 'keep-both', becomes, text: `A template called “${t.name}” exists already; the plugin’s is called “${becomes}”.` });
  }
  const takenS = (n: string): boolean => ex.styles.has(lc(n)) || styleNames.some((s) => lc(s) === lc(n)) || [...ren.styles.values()].some((v) => lc(v) === lc(n));
  for (const s of styleNames) {
    if (ren.styles.has(s) || !ex.styles.has(lc(s))) continue;
    const becomes = keepBoth(s, m.name, takenS);
    ren.styles.set(s, becomes);
    conflicts.push({ kind: 'export-style', name: s, resolution: 'keep-both', becomes, text: `An export style called “${s}” exists already; the plugin’s is called “${becomes}”.` });
  }
  const takenQ = (n: string): boolean => ex.queries.has(lc(n)) || queryNames.some((s) => lc(s) === lc(n)) || [...ren.queries.values()].some((v) => lc(v) === lc(n));
  for (const q of queryNames) {
    if (ren.queries.has(q) || !ex.queries.has(lc(q))) continue;
    const becomes = keepBoth(q, m.name, takenQ);
    ren.queries.set(q, becomes);
    conflicts.push({ kind: 'query', name: q, resolution: 'keep-both', becomes, text: `A saved search called “${q}” exists already; the plugin’s is called “${becomes}”.` });
  }
  const rewrite = (rel: string, body: string): string => (ren.templates.size + ren.styles.size + ren.queries.size > 0 ? renameRefs(rel, body, ren) : body);

  const files: PlannedFile[] = [];
  const items: InstallRecord['items'] = [];
  const baseFiles: PlannedFile[] = [];
  const ownerLine = `# installed by "plugin:${m.id}"\n`;

  const addText = (kind: PlannedFile['kind'], rel: string, body: string, prefix = ''): void => {
    const data = enc.encode(prefix + body);
    files.push({ rel, data, kind });
  };

  for (const rel of m.automations) {
    const body = opts.scope === 'shared' ? tagShared(rewrite(rel, read(rel))) : rewrite(rel, read(rel));
    addText('automations', rel, body, ownerLine);
    // the fingerprint is of the file as it is written, owner line and all: that is what is compared with later
    items.push({ kind: 'automations', path: rel, fingerprint: fingerprint(ownerLine + body) });
  }
  for (const rel of m.definitions) {
    let body = rewrite(rel, read(rel));
    // a query that was renamed is renamed as a key too
    if (ren.queries.size > 0) body = rewriteYaml(body, (doc) => {
      const qs = doc.get('queries', true);
      if (YAML.isMap(qs)) for (const pair of qs.items) if (YAML.isScalar(pair.key)) {
        const to = ren.queries.get(String(pair.key.value));
        if (to) pair.key.value = to;
      }
    });
    if (opts.scope === 'shared') body = tagShared(body);
    addText('definitions', rel, body);
    const qn = (YAML.parse(body) as { queries?: Record<string, unknown> } | null)?.queries;
    items.push({ kind: 'definitions', path: rel, fingerprint: fingerprint(body), ...(isMap(qn) ? { names: Object.keys(qn) } : {}) });
  }
  for (const rel of m.styles) {
    // always written under `export-style:`, whichever way the package wrote them, so there is one format
    const filled = read(rel);
    const d = YAML.parse(filled) as unknown;
    let wrapped = isMap(d) && 'export-style' in d ? filled : YAML.stringify({ 'export-style': d ?? {} }, { lineWidth: 0 });
    wrapped = rewriteYaml(wrapped, (doc) => {
      const set = doc.get('export-style', true);
      if (YAML.isMap(set)) for (const pair of set.items) if (YAML.isScalar(pair.key)) {
        const to = ren.styles.get(String(pair.key.value));
        if (to) pair.key.value = to;
      }
    });
    const names = Object.keys(((YAML.parse(wrapped) as Record<string, unknown>)['export-style'] as Record<string, unknown>) ?? {});
    if (opts.scope === 'shared') wrapped = tagShared(wrapped);
    addText('export-style', rel, wrapped);
    items.push({ kind: 'export-style', path: rel, names, fingerprint: fingerprint(wrapped) });
  }
  for (const t of m.templates) {
    let body = rewrite(t.path, fillSetup(t.path, text(pkg.files.get(t.path)!), values));
    const name = ren.templates.get(t.name) ?? t.name;
    const rel = `templates/${name}${t.path.slice(t.path.lastIndexOf('.'))}`;
    // the marks the app reads in a plugin template's frontmatter
    body = markTemplate(body, { plugin: m.id, managed: t.managed, hidden: t.hidden });
    addText('template', rel, body);
    items.push({ kind: 'template', path: rel, name, managed: t.managed, hidden: t.hidden, fingerprint: fingerprint(body) });
  }
  for (const a of m.assets) {
    for (const [rel, data] of pkg.files) if (rel === a || rel.startsWith(`${a}/`)) {
      files.push({ rel, data, kind: 'asset' });
      items.push({ kind: 'asset', path: rel, fingerprint: fingerprint(data) });
    }
  }
  if (m.icon && !files.some((f) => f.rel === m.icon)) files.push({ rel: m.icon, data: pkg.files.get(m.icon)!, kind: 'icon' });
  if (pkg.readme !== null) files.push({ rel: 'README.md', data: pkg.files.get('README.md')!, kind: 'readme' });
  files.push({ rel: PLUGIN_MANIFEST, data: enc.encode(fillSetup(PLUGIN_MANIFEST, text(pkg.files.get(PLUGIN_MANIFEST)!), values)), kind: 'base' });

  // starter pages
  const pages: PlannedPage[] = [];
  const used = new Set<string>();
  let n = 0;
  for (const g of opts.update ? [] : m.pages) {
    const tname = ren.templates.get(g.from) ?? m.templates.find((t) => lc(t.name) === lc(g.from))!.name;
    const t = m.templates.find((x) => lc(x.name) === lc(g.from))!;
    let p = fillPath(g.path, values);
    if (p === '') throw new Error(`The path of the starter page from “${g.from}” is empty.`);
    if (used.has(lc(p))) throw new Error(`Two starter pages would be made at “${p}”. Change the setup answers.`);
    if (ex.pageTaken(p)) {
      const becomes = uniqueName(p, (c) => ex.pageTaken(c) || used.has(lc(c)));
      conflicts.push({ kind: 'page', name: p, resolution: 'make-as', becomes, text: `A page called “${p}” exists already; the starter page is made as “${becomes}”.` });
      p = becomes;
    }
    used.add(lc(p));
    pages.push({ template: tname, path: p, open: g.open, pageId: `${m.id}/${safeStem(tname).toLowerCase().replace(/\s+/g, '-')}-${++n}`, managed: t.managed });
  }

  const count = (k: string): number => items.filter((i) => i.kind === k).length;
  const adds: string[] = [];
  const names = (xs: string[]): string => xs.join(', ');
  if (pages.length > 0) adds.push(`${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${names(pages.map((x) => x.path))}`);
  const autoCount = ruleCount(pkg, values);
  if (autoCount.total > 0) adds.push(`${autoCount.total} ${autoCount.total === 1 ? 'automation' : 'automations'}: ${names(autoCount.names)}`);
  if (m.definitions.length > 0) adds.push(`${m.definitions.length} ${m.definitions.length === 1 ? 'file of definitions' : 'files of definitions'}`);
  const visible = m.templates.filter((t) => !t.hidden).length;
  if (m.templates.length > 0) adds.push(`${m.templates.length} ${m.templates.length === 1 ? 'template' : 'templates'}${m.templates.length > visible ? ` (${m.templates.length - visible} used only by its automations)` : ''}`);
  if (count('export-style') > 0) adds.push(`${styleNames.length} export ${styleNames.length === 1 ? 'style' : 'styles'}: ${names(styleNames.map((s) => ren.styles.get(s) ?? s))}`);
  if (count('asset') > 0) adds.push(`${count('asset')} ${count('asset') === 1 ? 'picture or font' : 'pictures and fonts'}`);

  const now = (opts.now ?? new Date()).toISOString();
  const record: InstallRecord = {
    plugin: m.id, name: m.name, version: m.version, scope: opts.scope, folder, installed: now, updated: now,
    setup: Object.fromEntries(Object.entries(values)), items,
    pages: pages.map((g) => ({ pageId: g.pageId, template: g.template, path: g.path })),
    renames: { templates: Object.fromEntries(ren.templates), styles: Object.fromEntries(ren.styles), queries: Object.fromEntries(ren.queries) },
  };
  void baseFiles;
  return { manifest: m, scope: opts.scope, folder, files, pages, conflicts, adds, can: capabilitiesOf(pkg, opts.scope, values, { ...(opts.jsAllowed !== undefined ? { jsAllowed: opts.jsAllowed } : {}) }), record };
}

function ruleCount(pkg: PluginPackage, values: Record<string, unknown>): { total: number; names: string[] } {
  const names: string[] = [];
  for (const rel of pkg.manifest.automations) {
    try {
      const d = YAML.parse(fillSetup(rel, text(pkg.files.get(rel)!), values)) as unknown;
      if (isMap(d) && Array.isArray(d.rules)) for (const r of d.rules) if (isMap(r)) names.push(String(r.name ?? r.id));
    } catch {
      /* reported when the package was read */
    }
  }
  return { total: names.length, names };
}

/** Put `plugin:`, `managed:` and `hidden:` into the frontmatter of a template (made if there is none). */
function markTemplate(body: string, marks: { plugin: string; managed: boolean; hidden: boolean }): string {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(body);
  const doc = m ? YAML.parseDocument(m[1]!) : new YAML.Document({});
  if (doc.errors.length > 0 || (!YAML.isMap(doc.contents) && doc.contents !== null)) return body;
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  doc.set('plugin', marks.plugin);
  doc.set('managed', marks.managed);
  if (marks.hidden) doc.set('hidden', true);
  else doc.delete('hidden');
  const rest = m ? body.slice(m[0].length) : body;
  return `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${rest}`;
}

// ---------------------------------------------------------------- writing

/**
 * Write a plan into the `plugins/` folder of `settingsDir` (a workspace's `.cave-notes` or the app config folder). All or
 * nothing: the files go into a temporary folder, the record last, and the folder is renamed into place; on any error what was
 * written is removed again. Nothing is read as installed before the record is there (the settings loader checks).
 */
export async function writeInstall(settingsDir: string, plan: InstallPlan, opts: { failAfter?: number } = {}): Promise<string> {
  const plugins = path.join(settingsDir, 'plugins');
  const target = path.join(plugins, plan.folder);
  if (await exists(target)) throw new Error(`There is already something called “${plan.folder}” in plugins.`);
  const tmp = path.join(plugins, `.installing-${plan.record.plugin}-${Date.now().toString(36)}`);
  try {
    await fs.mkdir(tmp, { recursive: true });
    let n = 0;
    for (const f of plan.files) {
      const to = path.join(tmp, ...f.rel.split('/'));
      if (!isInside(tmp, to)) throw new Error(`The plugin would write outside its folder: ${f.rel}`);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, f.data);
      // the files as installed, for comparing with later versions
      if (f.kind !== 'asset' && f.kind !== 'icon' && f.kind !== 'readme' && f.kind !== 'base') {
        const b = path.join(tmp, 'base', ...f.rel.split('/'));
        await fs.mkdir(path.dirname(b), { recursive: true });
        await fs.writeFile(b, f.data);
      }
      if (opts.failAfter !== undefined && ++n >= opts.failAfter) throw new Error('simulated write error');
    }
    await fs.writeFile(path.join(tmp, PLUGIN_RECORD), `${JSON.stringify(plan.record, null, 2)}\n`);
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
  return target;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const isInside = (root: string, p: string): boolean => {
  const r = path.relative(root, p);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
};

// ---------------------------------------------------------------- what is installed

export interface InstalledPlugin {
  folder: string;
  record: InstallRecord;
}

/** The plugins installed in a settings folder (those with a record). */
export async function listInstalled(settingsDir: string): Promise<InstalledPlugin[]> {
  const out: InstalledPlugin[] = [];
  const base = path.join(settingsDir, 'plugins');
  let names: string[] = [];
  try {
    names = await fs.readdir(base);
  } catch {
    return out;
  }
  for (const folder of names.filter((n) => !n.startsWith('.')).sort()) {
    try {
      const rec = JSON.parse(await fs.readFile(path.join(base, folder, PLUGIN_RECORD), 'utf8')) as InstallRecord;
      if (rec && typeof rec.plugin === 'string') out.push({ folder, record: rec });
    } catch {
      /* not an installed plugin */
    }
  }
  return out;
}

// ---------------------------------------------------------------- updating

export interface UpdatePlan {
  /** the plan of the new version, written over the installed folder */
  plan: InstallPlan;
  from: string;
  to: string;
  /** `upgrade`, `same` (added again) or `older` (going back) */
  direction: 'upgrade' | 'same' | 'older';
  /** items the person had not touched: now the new version's */
  replaced: string[];
  /** items the person changed: theirs stay, the new version is kept in base/ to compare */
  kept: string[];
  added: string[];
  /** items the new version no longer has and the person had not touched */
  removed: string[];
  /** items the new version no longer has that the person changed or that are gone already: left alone */
  left: string[];
  /** what to write (relative to the plugin folder) and what to delete */
  writes: PlannedFile[];
  deletes: string[];
}

const readOrNull = async (file: string): Promise<Uint8Array | null> => {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
};

/**
 * What putting a new version of an installed plugin over it would do. Per item: one the person has not edited (its fingerprint
 * is still the one the app wrote) is replaced; one they edited keeps their version and the new one goes to `base/`; one the new
 * version adds is added; one it drops is removed if untouched. The setup answers are the ones the person gave, plus
 * `answers`; the names the plugin was given before (when something else had its own) stay. Starter pages are not made again and
 * pages made from templates are not changed. Writes nothing.
 */
export async function planUpdate(
  pkg: PluginPackage,
  installed: InstalledPlugin & { settingsDir: string },
  opts: { answers?: Record<string, unknown>; existing: ExistingNames; now?: Date; jsAllowed?: boolean },
): Promise<UpdatePlan> {
  const rec = installed.record;
  const dir = path.join(installed.settingsDir, 'plugins', installed.folder);
  const answers = { ...rec.setup, ...(opts.answers ?? {}) };
  const plan = planInstall(pkg, {
    scope: rec.scope, answers, existing: opts.existing, ...(opts.now ? { now: opts.now } : {}), ...(opts.jsAllowed !== undefined ? { jsAllowed: opts.jsAllowed } : {}),
    update: { folder: installed.folder, renames: rec.renames ?? { templates: {}, styles: {}, queries: {} } },
  });
  const cmp = compareVersions(pkg.manifest.version, rec.version);
  const up: UpdatePlan = { plan, from: rec.version, to: pkg.manifest.version, direction: cmp > 0 ? 'upgrade' : cmp === 0 ? 'same' : 'older', replaced: [], kept: [], added: [], removed: [], left: [], writes: [], deletes: [] };
  const oldItems = new Map(rec.items.map((i) => [i.path, i]));
  const newItems = new Map(plan.record.items.map((i) => [i.path, i]));
  const byRel = new Map(plan.files.map((f) => [f.rel, f]));
  const edited = async (path_: string, fp: string | undefined): Promise<'edited' | 'same' | 'gone'> => {
    const cur = await readOrNull(path.join(dir, ...path_.split('/')));
    if (cur === null) return 'gone';
    return fp !== undefined && fingerprint(cur) === fp ? 'same' : 'edited';
  };
  for (const f of plan.files) {
    const item = newItems.get(f.rel);
    if (!item) {
      // the manifest, the README and the icon belong to the plugin: always the new version
      up.writes.push(f);
      continue;
    }
    const old = oldItems.get(f.rel);
    if (!old) {
      if ((await readOrNull(path.join(dir, ...f.rel.split('/')))) === null) {
        up.added.push(f.rel);
        up.writes.push(f);
      } else up.kept.push(f.rel); // something of the person's is already there
      continue;
    }
    const state = await edited(f.rel, old.fingerprint);
    if (state === 'same') {
      if (old.fingerprint !== item.fingerprint) up.replaced.push(f.rel);
      up.writes.push(f);
    } else if (state === 'edited') {
      if (old.fingerprint !== item.fingerprint) up.kept.push(f.rel);
    } else up.left.push(f.rel); // the person deleted it: it stays deleted
  }
  for (const [rel, old] of oldItems) {
    if (newItems.has(rel) || byRel.has(rel)) continue;
    const state = await edited(rel, old.fingerprint);
    if (state === 'same') {
      up.removed.push(rel);
      up.deletes.push(rel);
    } else up.left.push(rel);
  }
  // a kept item is not in `writes`; its entry in the new record says what the new version had, as base/ does
  up.plan.record.installed = rec.installed;
  up.plan.record.pages = rec.pages;
  up.plan.record.setup = answers;
  return up;
}

/**
 * Write an update into the installed folder. All or nothing: what is overwritten or deleted is read first, and if anything fails
 * those files are put back and the new ones removed. The record is written last, so a cut-short update leaves the old one.
 */
export async function writeUpdate(settingsDir: string, installedFolder: string, up: UpdatePlan, opts: { failAfter?: number } = {}): Promise<void> {
  const dir = path.join(settingsDir, 'plugins', installedFolder);
  const undo: Array<() => Promise<void>> = [];
  let n = 0;
  const put = async (rel: string, data: Uint8Array): Promise<void> => {
    const to = path.join(dir, ...rel.split('/'));
    if (!isInside(dir, to)) throw new Error(`The plugin would write outside its folder: ${rel}`);
    const before = await readOrNull(to);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.writeFile(to, data);
    undo.push(async () => {
      if (before === null) await fs.rm(to, { force: true });
      else await fs.writeFile(to, before);
    });
    if (opts.failAfter !== undefined && ++n >= opts.failAfter) throw new Error('simulated write error');
  };
  const del = async (rel: string): Promise<void> => {
    const to = path.join(dir, ...rel.split('/'));
    if (!isInside(dir, to)) return;
    const before = await readOrNull(to);
    await fs.rm(to, { force: true });
    if (before !== null) undo.push(async () => fs.writeFile(to, before));
  };
  try {
    for (const f of up.writes) await put(f.rel, f.data);
    // base/ always holds the new version, also of what was kept
    for (const f of up.plan.files) if (f.kind !== 'asset' && f.kind !== 'icon' && f.kind !== 'readme' && f.kind !== 'base') await put(`base/${f.rel}`, f.data);
    for (const rel of up.deletes) {
      await del(rel);
      await del(`base/${rel}`);
    }
    up.plan.record.updated = new Date().toISOString();
    await put(PLUGIN_RECORD, enc.encode(`${JSON.stringify(up.plan.record, null, 2)}\n`));
  } catch (e) {
    for (const u of undo.reverse()) await u().catch(() => undefined);
    throw e;
  }
}

/** Change the record of an installed plugin (for example the real paths of its starter pages). */
export async function updateRecord(settingsDir: string, folder: string, change: (r: InstallRecord) => void): Promise<void> {
  const file = path.join(settingsDir, 'plugins', folder, PLUGIN_RECORD);
  const rec = JSON.parse(await fs.readFile(file, 'utf8')) as InstallRecord;
  change(rec);
  rec.updated = new Date().toISOString();
  await fs.writeFile(file, `${JSON.stringify(rec, null, 2)}\n`);
}

/** Take a plugin out: its folder goes (the page of a starter page does not: those are the person's). */
export async function removeInstalled(settingsDir: string, folder: string): Promise<void> {
  const target = path.join(settingsDir, 'plugins', folder);
  if (!isInside(path.join(settingsDir, 'plugins'), target)) throw new Error('That is not a plugin folder.');
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Files that are not a package (a YAML file of settings, notes that are templates, a folder of them) made into one, so that
 * they are added through the same window as any plugin and can be removed the same way. A YAML file is split by what its
 * sections are for: `rules` and `settings` become automations, `schema`, `attributes`, `files`, `queries` and `relations`
 * definitions, and styles (`export-style:` or the styles themselves) a styles file. A note is a template. Returns the files of
 * the package, or an error in words.
 */
export function packageFromPlain(items: Array<{ name: string; data: Uint8Array }>, label: string): { ok: true; files: Record<string, Uint8Array> } | { ok: false; error: string } {
  const files: Record<string, Uint8Array> = {};
  const automations: string[] = [];
  const definitions: string[] = [];
  const styles: string[] = [];
  const templates: Array<{ path: string }> = [];
  const AUTOMATION = ['rules', 'settings'];
  const DEFINITION = ['schema', 'attributes', 'files', 'queries', 'relations'];
  const used = new Set<string>();
  const place = (dir: string, stem: string): string => {
    let n = `${dir}/${stem}.yaml`;
    for (let i = 2; used.has(n); i++) n = `${dir}/${stem} ${i}.yaml`;
    used.add(n);
    return n;
  };
  const skipped: string[] = [];
  for (const it of items) {
    const base = it.name.slice(it.name.lastIndexOf('/') + 1);
    if (/\.ya?ml$/i.test(base)) {
      const stem = base.replace(/\.ya?ml$/i, '');
      const doc = YAML.parseDocument(text(it.data), { customTags: [{ tag: '!global', collection: 'map' }, { tag: '!global', collection: 'seq' }] });
      if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) {
        skipped.push(`${base}: not a YAML file of settings`);
        continue;
      }
      const groups: Record<string, YAML.Pair[]> = { automations: [], definitions: [], styles: [] };
      const bare: YAML.Pair[] = [];
      for (const pair of doc.contents.items) {
        const key = String((pair.key as { value?: unknown })?.value ?? pair.key);
        if (AUTOMATION.includes(key)) groups.automations!.push(pair);
        else if (DEFINITION.includes(key)) groups.definitions!.push(pair);
        else if (key === 'export-style' || key === 'export-styles') groups.styles!.push(pair);
        else bare.push(pair);
      }
      // a file with no section the app knows is a file of styles (each key a style's name)
      const known = groups.automations!.length + groups.definitions!.length + groups.styles!.length;
      const make = (pairs: YAML.Pair[]): Uint8Array => {
        const d = new YAML.Document({});
        d.contents = new YAML.YAMLMap();
        for (const pr of pairs) {
          // the `!global` marks are the scope's business, not the file's
          if (YAML.isNode(pr.value)) (pr.value as { tag?: string }).tag = undefined;
          (d.contents as YAML.YAMLMap).items.push(pr);
        }
        return enc.encode(d.toString({ lineWidth: 0 }));
      };
      if (groups.automations!.length > 0) {
        const rel = place('automations', stem);
        files[rel] = make(groups.automations!);
        automations.push(rel);
      }
      if (groups.definitions!.length > 0) {
        const rel = place('definitions', stem);
        files[rel] = make(groups.definitions!);
        definitions.push(rel);
      }
      if (groups.styles!.length > 0 || (known === 0 && bare.length > 0)) {
        const rel = place('styles', stem);
        files[rel] = make(groups.styles!.length > 0 ? groups.styles! : bare);
        styles.push(rel);
      } else if (bare.length > 0) skipped.push(`${base}: “${bare.map((b) => String((b.key as { value?: unknown })?.value ?? b.key)).join(', ')}” is not a section the app knows`);
    } else if (/\.(md|markdown|txt)$/i.test(base)) {
      const rel = `templates/${it.name.replace(/\.markdown$/i, '.md')}`;
      if (safeRel(rel) === null) {
        skipped.push(`${it.name}: unsafe path`);
        continue;
      }
      files[rel] = it.data;
      templates.push({ path: rel });
    } else skipped.push(`${base}: not a kind of file that can be added`);
  }
  if (automations.length + definitions.length + styles.length + templates.length === 0) {
    return { ok: false, error: skipped.length > 0 ? `Nothing could be added. ${skipped.join(' ')}` : 'There is nothing here to add.' };
  }
  const name = label.trim() || 'Added from a file';
  const id = `file-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plugin'}`;
  const manifest: Record<string, unknown> = {
    plugin: { id, name, version: '1.0.0', description: skipped.length > 0 ? `Added from files. Left out: ${skipped.join(' ')}` : 'Added from files.' },
    ...(automations.length > 0 ? { automations } : {}),
    ...(definitions.length > 0 ? { definitions } : {}),
    ...(styles.length > 0 ? { 'export-styles': styles } : {}),
    ...(templates.length > 0 ? { templates } : {}),
  };
  files[PLUGIN_MANIFEST] = enc.encode(YAML.stringify(manifest, { lineWidth: 0 }));
  return { ok: true, files };
}

/** Read the files of a folder into a package map (for authors who install from a folder). */
export async function readFolderPackage(dir: string, limits = { entries: 2000, bytes: 100 * 1024 * 1024 }): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  let count = 0;
  const walk = async (rel: string): Promise<void> => {
    const ents = (await fs.readdir(rel ? path.join(dir, ...rel.split('/')) : dir, { withFileTypes: true })) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
    for (const e of ents) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) {
        if (++count > limits.entries) throw new Error('The folder holds too many files.');
        const data = await fs.readFile(path.join(dir, ...r.split('/')));
        total += data.length;
        if (total > limits.bytes) throw new Error('The folder is too large.');
        out[r] = data;
      }
    }
  };
  await walk('');
  return out;
}
