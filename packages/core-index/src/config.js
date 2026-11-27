/**
 * Workspace settings in one file or in many
 * -----------------------------------------
 * A workspace keeps its settings in YAML files in its `.cave-notes` folder. Which file holds what does not matter: every
 * `*.yaml` / `*.yml` file there is read, and each top-level key is a section the app knows by its name:
 *
 *   attributes:    attributes every page has                     (a map: name -> value)
 *   files:         attributes for files that are not notes       (a map)
 *   schema:        the types of attributes                       (a map: name -> { type, values ... })
 *   queries:       saved queries                                 (a map: name -> query)
 *   relations:     relations between saved queries               (a list)
 *   rules:         automation rules                              (a list)
 *   settings:      settings of the automation engine             (a map)
 *   export-style:  styles for exporting to Word, ODT and PDF     (a map: style name -> settings)
 *   notes:         which files count as notes                    (a map)
 *   color, icon, font, fontSize: how the workspace looks         (single values)
 *   fontSizes:     a size for each of sans, serif and mono       (a map)
 *   styles:        named paragraph styles for `::: name` blocks  (a map: name -> properties)
 *   css:           extra CSS for the editor, HTML and PDF         (text)
 *   presentation-themes: slide themes and their layouts          (a map: name -> theme)
 *   presentation-rules:  which block kinds get which layout       (a list of { when, layout })
 *
 * so a setup can be shared as one file, or as a part of one that fits into a workspace that has its own. Where several
 * files have the same section, lists are joined and maps are merged by name; for a name that two files both give, the file
 * that comes later in the order (`workspace.yaml` first, then by name) wins, and the app says so.
 *
 * Besides those files, two subfolders hold settings that come as units:
 *
 *   plugins/   a plugin is any combination of schema, attributes, files, queries, relations, rules and settings that comes as
 *              a unit. A simple one is a YAML file (`plugins/Name.yaml`); a complex one is a notes page with a folder of the
 *              same name (`plugins/Name.md` as its readme, `plugins/Name/*.yaml` and helper files such as scripts).
 *   styles/    export styles (`export-style:`, `styles:`, `css:`, `presentation-themes:`, `presentation-rules:`), one file
 *              each or several in one file. No folders inside.
 *
 * (`templates/` holds pages, not settings: see templates.ts of the service.) Anything in the main folder (the YAML files
 * directly in `.cave-notes`) wins over a subfolder when both give the same name or `id`; the app says nothing about that,
 * since it is how a workspace overrides a plugin. A section a subfolder may not hold is reported and left out.
 *
 * Any section can be tagged `!global` (see global-tag.js).
 */
import { fsSync as fs, fs as fsp, path } from '@cave-notes/platform';
import { parseTagged } from './global-tag.js';

// re-exported so a caller that only needs it need not load the whole index (its worker pool uses import.meta)
export { mergeSection } from './global-tag.js';

/** The sections and what each holds. */
export const SECTIONS = {
  attributes: 'map',
  files: 'map',
  schema: 'map',
  queries: 'map',
  relations: 'seq',
  rules: 'seq',
  settings: 'map',
  'export-style': 'map',
  notes: 'map',
  color: 'scalar',
  icon: 'scalar',
  font: 'scalar',
  fontSize: 'scalar',
  fontSizes: 'map',
  window: 'map',
  styles: 'map',
  css: 'scalar',
  'presentation-themes': 'map',
  'presentation-rules': 'seq',
};

/** The file a section goes in when no file has it yet (and none of the others is a better home, see `homeFor`). */
export const DEFAULT_FILE = {
  attributes: 'workspace.yaml',
  files: 'workspace.yaml',
  queries: 'workspace.yaml',
  relations: 'workspace.yaml',
  notes: 'workspace.yaml',
  color: 'workspace.yaml',
  icon: 'workspace.yaml',
  font: 'workspace.yaml',
  fontSize: 'workspace.yaml',
  fontSizes: 'workspace.yaml',
  window: 'workspace.yaml',
  // what the app makes new always goes into the subfolders: automations in plugins/, export styles in styles/
  styles: 'styles/export-styles.yaml',
  css: 'styles/export-styles.yaml',
  'presentation-themes': 'styles/presentation.yaml',
  'presentation-rules': 'styles/presentation.yaml',
  schema: 'schema.yaml',
  rules: 'plugins/automations.yaml',
  settings: 'plugins/automations.yaml',
  'export-style': 'styles/export-styles.yaml',
};

/** True for the name of a file in a subfolder (`plugins/Name.yaml`), false for one in the main folder. */
export const isSubfolderFile = (name) => name.includes('/');
/** The subfolder a settings file is in (`plugins`, `styles`), or null for the main folder. */
export const folderOf = (name) => (name.includes('/') ? name.slice(0, name.indexOf('/')) : null);

/** Which sections a file in each subfolder may hold. */
export const FOLDER_SECTIONS = {
  plugins: ['attributes', 'files', 'schema', 'queries', 'relations', 'rules', 'settings'],
  styles: ['export-style', 'styles', 'css', 'presentation-themes', 'presentation-rules'],
  // inside an installed plugin's folder (see plugins.ts of the service): automations, definitions and styles each have their own sections
  automations: ['rules', 'settings'],
  definitions: ['attributes', 'files', 'schema', 'queries', 'relations'],
};

/** The files of an installed plugin that are read as settings, by folder: `plugins/<name>/automations/x.yaml` and so on. */
const PLUGIN_PART = /^plugins\/[^/]+\/(automations|definitions|styles)\/[^/]+$/;
/** Which section list governs a file: the plugin part it is in, else its subfolder (`plugins`, `styles`), else none (the main folder). */
export const folderKind = (name) => PLUGIN_PART.exec(name)?.[1] ?? folderOf(name);

/** The marks of an installed plugin's folder: what the package said (`plugin.yaml`) and what the app wrote when it was done (`.installed.json`). */
export const PLUGIN_MANIFEST = 'plugin.yaml';
export const PLUGIN_RECORD = '.installed.json';

/** Files in the folder that are not settings. */
const NOT_CONFIG = new Set(['state.yaml', 'state.yml']);

/** The layer of the first file that gave a section (for scalars, which only the main folder gives). */
const owner0 = (out, key) => {
  const first = out.owners[key]?.[0];
  return first === undefined ? undefined : isSubfolderFile(first) ? 0 : 1;
};

const isMapObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The names of the settings files in a list of file names: `workspace.yaml` first, then the rest by name. */
export function configFileNames(names) {
  return names
    .filter((n) => /\.ya?ml$/i.test(n) && !n.startsWith('.') && !NOT_CONFIG.has(n.toLowerCase()))
    .sort((a, b) => (a === 'workspace.yaml' ? -1 : b === 'workspace.yaml' ? 1 : a.toLowerCase().localeCompare(b.toLowerCase())));
}

/**
 * Put the text of several settings files together. Never throws.
 * @param {Array<{ name: string, text: string }>} files in reading order
 * @returns {{
 *   files: Array<{ name: string, keys: string[], error?: string }>,
 *   sections: Record<string, any>,
 *   present: Set<string>,
 *   globalKeys: Set<string>,
 *   shared: Record<string, any>,
 *   owners: Record<string, string[]>,
 *   warnings: string[],
 *   invalid: boolean,
 * }}
 */
export function parseConfig(files) {
  const out = { files: [], sections: {}, present: new Set(), globalKeys: new Set(), shared: {}, owners: {}, warnings: [], invalid: false };
  const source = {}; // which file gave each name of a map section, for the "both give it" message
  const layerOf = (name) => (isSubfolderFile(name) ? 0 : 1); // the main folder is read after the subfolders and wins
  const itemLayer = new WeakMap(); // list entries (rules, relations) -> the layer they came from
  for (const f of files) {
    const layer = layerOf(f.name);
    const folder = folderKind(f.name);
    const parsed = parseTagged(f.text ?? '');
    if (parsed.error) {
      out.files.push({ name: f.name, keys: [], error: parsed.error });
      out.warnings.push(`${f.name}: not valid YAML (${parsed.error})`);
      out.invalid = true;
      continue;
    }
    const value = parsed.value;
    if (value === null || value === undefined) {
      out.files.push({ name: f.name, keys: [] });
      continue;
    }
    if (!isMapObj(value)) {
      out.files.push({ name: f.name, keys: [] });
      out.warnings.push(`${f.name}: a settings file is a list of sections (attributes:, queries: …), not ${Array.isArray(value) ? 'a list' : 'a single value'}`);
      continue;
    }
    const keys = Object.keys(value);
    out.files.push({ name: f.name, keys });
    for (const key of keys) {
      const kind = SECTIONS[key];
      if (!kind) {
        out.warnings.push(`${f.name}: “${key}” is not a section the app knows (${Object.keys(SECTIONS).join(', ')})`);
        continue;
      }
      if (folder && !FOLDER_SECTIONS[folder]?.includes(key)) {
        out.warnings.push(`${f.name}: “${key}” is not read from the ${folder} folder (it holds ${FOLDER_SECTIONS[folder].join(', ')}); put it in a file in the main folder`);
        continue;
      }
      out.present.add(key);
      (out.owners[key] ??= []).push(f.name);
      if (parsed.globalKeys.includes(key)) out.globalKeys.add(key);
      // what this file shares of the section: all of it when tagged as a whole, else just the tagged entries; kept apart from the
      // section itself so that `rules: !global` in one file never shares the rules of another file
      const shareable = parsed.globalKeys.includes(key) ? value[key] : parsed.globalItems[key];
      if (shareable !== null && shareable !== undefined) {
        const mine = out.shared[key];
        if (kind === 'seq' && Array.isArray(shareable)) out.shared[key] = [...(mine ?? []), ...shareable];
        else if (kind === 'map' && isMapObj(shareable)) out.shared[key] = { ...(mine ?? {}), ...shareable };
      }
      const v = value[key];
      if (v === null || v === undefined) continue; // present but empty: it counts as having the section (it switches a global one off)
      const have = out.sections[key];
      if (kind === 'seq') {
        if (!Array.isArray(v)) {
          out.warnings.push(`${f.name}: “${key}” has to be a list (each entry starting with a dash)`);
          continue;
        }
        // an entry with an `id` in the main folder replaces one with the same `id` that came from a subfolder
        const mine = v.filter((x) => x !== null && x !== undefined);
        for (const x of mine) if (x && typeof x === 'object') itemLayer.set(x, layer);
        const ids = new Set(mine.map((x) => (x && typeof x === 'object' && typeof x.id === 'string' ? x.id : null)).filter(Boolean));
        const kept = (have ?? []).filter((x) => !(x && typeof x === 'object' && typeof x.id === 'string' && ids.has(x.id) && (itemLayer.get(x) ?? 1) < layer));
        out.sections[key] = [...kept, ...v];
      } else if (kind === 'map') {
        if (!isMapObj(v)) {
          out.warnings.push(`${f.name}: “${key}” has to be a list of names with values (name: value)`);
          continue;
        }
        const merged = { ...(have ?? {}) };
        const from = (source[key] ??= {});
        for (const [name, entry] of Object.entries(v)) {
          if (name in merged && from[name] !== f.name) {
            const was = layerOf(from[name]);
            if (was > layer) continue; // the main folder already gave it: it wins over a subfolder
            if (was === layer) out.warnings.push(`“${name}” in ${key} is given by both ${from[name]} and ${f.name}; ${f.name} is used`);
          }
          merged[name] = entry;
          from[name] = f.name;
        }
        out.sections[key] = merged;
      } else {
        if (have !== undefined && have !== v && layer === (owner0(out, key) ?? layer)) out.warnings.push(`“${key}” is given by more than one file; ${f.name} is used`);
        out.sections[key] = v;
      }
    }
  }
  return out;
}

const isYaml = (n) => /\.ya?ml$/i.test(n) && !n.startsWith('.');
const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());

/**
 * The settings files of the `plugins/` and `styles/` folders of a settings folder, as paths relative to it, in reading order.
 * `list(rel)` gives the entries of a folder, `has(rel)` says whether a file is there. An installed plugin (a folder with a
 * `.installed.json`) is read from its `automations/`, `definitions/` and `styles/` folders only; a folder with a `plugin.yaml` but
 * no record was not finished (or was never installed) and is left alone; any other folder is read as before (YAML files, a few
 * levels down).
 */
function layerFiles(list, has) {
  const out = [];
  const sorted = (rel) => [...list(rel)].sort((x, y) => byName(x.name, y.name)).filter((e) => !e.name.startsWith('.') && !e.isSymbolicLink());
  const walk = (rel, depth) => {
    for (const e of sorted(rel)) {
      if (e.isFile() && isYaml(e.name)) out.push(`${rel}/${e.name}`);
      else if (e.isDirectory() && depth < 3) {
        const sub = `${rel}/${e.name}`;
        if (depth === 1 && has(`${sub}/${PLUGIN_MANIFEST}`) && !has(`${sub}/${PLUGIN_RECORD}`)) continue; // not installed (yet)
        if (depth === 1 && has(`${sub}/${PLUGIN_RECORD}`)) {
          for (const part of ['automations', 'definitions', 'styles']) for (const f of sorted(`${sub}/${part}`)) if (f.isFile() && isYaml(f.name)) out.push(`${sub}/${part}/${f.name}`);
          continue;
        }
        walk(sub, depth + 1);
      }
    }
  };
  walk('plugins', 1);
  for (const e of sorted('styles')) if (e.isFile() && isYaml(e.name)) out.push(`styles/${e.name}`);
  return out;
}

const readDirAsync = (dir) => async (rel) => fsp.readdir(path.join(dir, ...rel.split('/')), { withFileTypes: true }).catch(() => []);

/** The `plugins/` and `styles/` files of a folder (async). */
async function collectLayer(dir) {
  const cache = new Map();
  const ls = readDirAsync(dir);
  // the listing is needed synchronously by layerFiles, so every folder it could ask about is read first
  const need = async (rel, depth) => {
    const ents = await ls(rel);
    cache.set(rel, ents);
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.') && depth < 3) await need(`${rel}/${e.name}`, depth + 1);
  };
  await need('plugins', 1);
  cache.set('styles', await ls('styles'));
  const marks = new Set();
  for (const [rel, ents] of cache) for (const e of ents) if (e.isFile() && (e.name === PLUGIN_MANIFEST || e.name === PLUGIN_RECORD)) marks.add(`${rel}/${e.name}`);
  for (const part of ['automations', 'definitions', 'styles']) {
    for (const [rel] of [...cache]) if (/^plugins\/[^/]+$/.test(rel) && marks.has(`${rel}/${PLUGIN_RECORD}`)) cache.set(`${rel}/${part}`, await ls(`${rel}/${part}`));
  }
  const names = layerFiles((rel) => cache.get(rel) ?? [], (f) => marks.has(f));
  const files = [];
  for (const rel of names) files.push({ name: rel, text: await fsp.readFile(path.join(dir, ...rel.split('/')), 'utf8').catch(() => '') });
  return files;
}

function collectLayerSync(dir) {
  const list = (rel) => {
    try {
      return fs.readdirSync(path.join(dir, ...rel.split('/')), { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const has = (rel) => {
    try {
      return fs.statSync(path.join(dir, ...rel.split('/'))).isFile();
    } catch {
      return false;
    }
  };
  const files = [];
  for (const rel of layerFiles(list, has)) {
    try {
      files.push({ name: rel, text: fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8') });
    } catch {
      /* unreadable: left out */
    }
  }
  return files;
}

/**
 * Read every settings file of a `.cave-notes` folder (async): the subfolders' first, then the main folder's (which wins). A
 * missing folder is an empty setup. With `baseDir` (the app config folder) the plugins and styles found there are read too,
 * with the same code, and kept apart as `base`: the app's layer lies under the workspace's own settings and is never written
 * to, so it is not in `files`, `owners` or `present`. `effectiveSections(config)` puts the two together.
 */
export async function readConfig(dir, opts = {}) {
  const files = await collectLayer(dir);
  for (const name of configFileNames(await fsp.readdir(dir).catch(() => []))) {
    const text = await fsp.readFile(path.join(dir, name), 'utf8').catch(() => '');
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) files.push({ name, text });
  }
  const cfg = { ...parseConfig(files), dir };
  if (opts.baseDir) cfg.base = parseConfig(await collectLayer(opts.baseDir));
  return cfg;
}

/** The same, without waiting (for the few places that cannot: the main process asking whether a workspace has rules). */
export function readConfigSync(dir, opts = {}) {
  const files = collectLayerSync(dir);
  let names = [];
  try {
    names = configFileNames(fs.readdirSync(dir));
  } catch {
    /* no folder */
  }
  for (const n of names) {
    try {
      if (fs.statSync(path.join(dir, n)).isFile()) files.push({ name: n, text: fs.readFileSync(path.join(dir, n), 'utf8') });
    } catch {
      /* unreadable: left out */
    }
  }
  const cfg = { ...parseConfig(files), dir };
  if (opts.baseDir) cfg.base = parseConfig(collectLayerSync(opts.baseDir));
  return cfg;
}

/**
 * The workspace's settings with the app's layer under them: maps are merged by name (the workspace's entry wins), lists are
 * joined with the app's entries first, except those whose `id` or `name` the workspace gives itself. Unlike an inherited
 * (`!global`) section, the app's layer is not switched off by an empty section of the workspace.
 * @returns {{ sections: Record<string, any>, present: Set<string> }}
 */
export function effectiveSections(config) {
  const own = config.sections ?? {};
  const base = config.base?.sections ?? {};
  const sections = { ...own };
  const present = new Set(config.present);
  for (const [key, b] of Object.entries(base)) {
    if (b === null || b === undefined) continue;
    const kind = SECTIONS[key];
    const o = own[key];
    if (kind === 'map' && isMapObj(b)) sections[key] = { ...b, ...(isMapObj(o) ? o : {}) };
    else if (kind === 'seq' && Array.isArray(b)) {
      const nameOf = (r) => String(r?.id ?? r?.name ?? '').toLowerCase();
      const mine = Array.isArray(o) ? o : [];
      const taken = new Set(mine.map(nameOf));
      sections[key] = [...b.filter((r) => !taken.has(nameOf(r))), ...mine];
    } else continue;
    present.add(key);
  }
  return { sections, present };
}

/**
 * The file a change to `key` should go to: the file that has the section, else the usual file for it if that exists, else
 * (when other settings files exist but not that one) the first file that holds any section, else the usual file.
 * @param {{ files: Array<{name: string, keys: string[], error?: string}>, owners: Record<string, string[]> }} config
 */
export function homeFor(config, key) {
  const owners = config.owners[key] ?? [];
  // a file in the main folder that has the section comes first (it wins over a plugin's), then a file of a subfolder
  const has = owners.find((n) => !isSubfolderFile(n)) ?? owners[0];
  if (has) return has;
  const usual = DEFAULT_FILE[key] ?? 'workspace.yaml';
  const names = config.files.map((f) => f.name);
  if (names.includes(usual)) return usual;
  // sections the app files into a subfolder always go there; the rest go to the one main-folder file that holds settings
  if (isSubfolderFile(usual)) return usual;
  const holder = config.files.find((f) => !isSubfolderFile(f.name) && f.keys.length > 0 && !f.error);
  return holder ? holder.name : usual;
}

/** What the settings files say about one section, as YAML text without the section's own name (for the boxes in Preferences). */
export function sectionValue(config, key) {
  return config.sections[key];
}
