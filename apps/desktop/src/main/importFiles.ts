/**
 * Adding plugins, export styles and templates from files: a file, a folder or a zip of them, put into the app's own folder
 * (all workspaces, this computer), into the workspace's `.cave-notes` folder (this workspace, every computer), or into the
 * workspace's folder with its sections tagged `!global` (every workspace, on every computer that has this workspace).
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseStyleSetsYaml, stringifyStyleSets } from '@cave-notes/core-export';
import type { ImportKind, ImportRequest, ImportResult, ImportWhere } from '../shared/api';
import { readZip } from './zip';

export type { ImportKind, ImportRequest, ImportResult, ImportWhere };

interface Item {
  /** path inside the destination folder, with `/` */
  name: string;
  data: Buffer;
}

const FOLDER: Record<ImportKind, string> = { plugin: 'plugins', style: 'styles', template: 'templates' };
const PLUGIN_SECTIONS = ['attributes', 'files', 'schema', 'queries', 'relations', 'rules', 'settings'];
/** The sections a `!global` tag shares with other workspaces (see global-tag.js). */
const SHAREABLE = new Set(['attributes', 'queries', 'relations', 'rules', 'schema', 'export-style']);
const isYaml = (n: string): boolean => /\.ya?ml$/i.test(n);
const MAX_FILES = 2000;
const MAX_BYTES = 100 * 1024 * 1024;

function walk(dir: string, rel: string, out: Item[], tally: { n: number; bytes: number }): void {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out, tally);
    else if (e.isFile()) {
      const data = fs.readFileSync(path.join(dir, r));
      tally.n++;
      tally.bytes += data.length;
      if (tally.n > MAX_FILES || tally.bytes > MAX_BYTES) throw new Error('That is too much to add (more than 2000 files or 100 MB).');
      out.push({ name: r, data });
    }
  }
}

/** What the chosen paths hold, as files to put into a folder. A zip is opened; a folder keeps its name. */
export function collectItems(sources: string[]): Item[] {
  const out: Item[] = [];
  const tally = { n: 0, bytes: 0 };
  for (const src of sources) {
    const st = fs.statSync(src);
    const base = path.basename(src);
    if (st.isDirectory()) {
      const inner: Item[] = [];
      walk(src, '', inner, tally);
      for (const i of inner) out.push({ name: `${base}/${i.name}`, data: i.data });
    } else if (/\.zip$/i.test(base)) {
      const entries = readZip(fs.readFileSync(src));
      // a zip of one folder: that folder; a zip of loose files: they go in as they are
      for (const e of entries) out.push({ name: e.name, data: e.data });
    } else if (st.isFile()) {
      if (st.size > MAX_BYTES) throw new Error('That file is too large.');
      out.push({ name: base, data: fs.readFileSync(src) });
    }
  }
  return out;
}

/** Tag the sections of a plugin or style file that can be shared with `!global`, and say which were. */
export function tagGlobal(text: string): { text: string; tagged: string[] } {
  const doc = YAML.parseDocument(text);
  const tagged: string[] = [];
  if (doc.errors.length === 0 && YAML.isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const key = String((pair.key as { value?: unknown })?.value ?? pair.key);
      if (SHAREABLE.has(key) && YAML.isNode(pair.value)) {
        (pair.value as { tag?: string }).tag = '!global';
        tagged.push(key);
      }
    }
  }
  return { text: doc.toString({ lineWidth: 0 }), tagged };
}

/** A style file holds either `export-style:` (the form of a workspace) or the styles themselves (the form of the app's file). */
function styleSetsOf(text: string): { sets: ReturnType<typeof parseStyleSetsYaml>['sets']; errors: string[] } {
  let body = text;
  const doc = YAML.parseDocument(text, { customTags: [{ tag: '!global', collection: 'map' }] });
  if (doc.errors.length === 0 && YAML.isMap(doc.contents) && doc.contents.has('export-style')) {
    body = YAML.stringify((doc.toJS() as Record<string, unknown>)['export-style']);
  }
  return parseStyleSetsYaml(body);
}

function unique(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let n = name;
  for (let i = 2; fs.existsSync(path.join(dir, n)); i++) n = `${stem} ${i}${ext}`;
  return n;
}

export function importFromFiles(req: ImportRequest, appConfigDir: string): ImportResult {
  try {
    if (req.sources.length === 0) return { ok: false, message: 'Choose a file, a folder or a zip first.', added: [] };
    if (req.where !== 'app' && !req.workspaceRoot) return { ok: false, message: 'Open a workspace first: this goes into a workspace.', added: [] };
    if (req.kind === 'template' && req.where === 'global') return { ok: false, message: 'Templates cannot be shared with !global; choose the app folder or this workspace.', added: [] };
    const items = collectItems(req.sources);
    if (items.length === 0) return { ok: false, message: 'There was nothing in that to add.', added: [] };
    const base = req.where === 'app' ? path.join(appConfigDir, FOLDER[req.kind]) : path.join(req.workspaceRoot!, '.cave-notes', FOLDER[req.kind]);
    const writes: Item[] = [];

    if (req.kind === 'plugin') {
      const yamls = items.filter((i) => isYaml(i.name));
      let found = 0;
      for (const y of yamls) {
        let doc: unknown;
        try {
          doc = YAML.parse(y.data.toString('utf8'), { customTags: [{ tag: '!global', collection: 'map' }, { tag: '!global', collection: 'seq' }, { tag: '!global', resolve: (s: string) => s }] });
        } catch (e) {
          return { ok: false, message: `${y.name} is not valid YAML: ${(e as Error).message.split('\n')[0]}`, added: [] };
        }
        if (doc && typeof doc === 'object' && PLUGIN_SECTIONS.some((k) => k in (doc as object))) found++;
      }
      if (found === 0) return { ok: false, message: 'That does not look like a plugin: it has no YAML file with rules, schema, attributes, queries or relations in it.', added: [] };
      for (const i of items) {
        if (req.where === 'global' && isYaml(i.name)) writes.push({ name: i.name, data: Buffer.from(tagGlobal(i.data.toString('utf8')).text) });
        else writes.push(i);
      }
    } else if (req.kind === 'style') {
      const yamls = items.filter((i) => isYaml(i.name));
      if (yamls.length === 0) return { ok: false, message: 'Styles come as YAML files. There was none in that.', added: [] };
      for (const y of yamls) {
        const text = y.data.toString('utf8');
        const r = styleSetsOf(text);
        if (r.errors.length > 0) return { ok: false, message: `${y.name}: ${r.errors[0]}`, added: [] };
        if (r.sets.length === 0) return { ok: false, message: `${y.name} has no export style in it.`, added: [] };
        const sets = stringifyStyleSets(r.sets);
        // the app's folder holds the styles themselves; a workspace's holds them under `export-style:`
        const out = req.where === 'app' ? sets : `export-style:${req.where === 'global' ? ' !global' : ''}\n${sets.replace(/^(?!$)/gm, '  ')}`;
        writes.push({ name: path.basename(y.name), data: Buffer.from(out) });
      }
    } else {
      const notes = items.filter((i) => /\.(md|markdown|txt)$/i.test(i.name));
      if (notes.length === 0) return { ok: false, message: 'Templates are note files (.md). There was none in that.', added: [] };
      writes.push(...items);
    }

    // nothing already there is overwritten: a name that is taken gets a number. A folder keeps together under one name.
    const top = new Map<string, string>();
    const added: string[] = [];
    fs.mkdirSync(base, { recursive: true });
    for (const w of writes) {
      const slash = w.name.indexOf('/');
      const head = slash < 0 ? w.name : w.name.slice(0, slash);
      let mapped = top.get(head);
      if (!mapped) {
        mapped = slash < 0 ? unique(base, head) : unique(base, head);
        top.set(head, mapped);
      }
      const rel = slash < 0 ? mapped : `${mapped}${w.name.slice(slash)}`;
      const dest = path.join(base, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, w.data);
      added.push(rel);
    }
    const where = req.where === 'app' ? 'the app folder (all workspaces on this computer)' : req.where === 'workspace' ? 'this workspace' : 'this workspace, shared with all workspaces';
    return { ok: true, message: `Added ${added.length === 1 ? added[0] : `${added.length} files`} to ${where}.`, added };
  } catch (e) {
    return { ok: false, message: (e as Error).message, added: [] };
  }
}
