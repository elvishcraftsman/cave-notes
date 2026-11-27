/**
 * Reading what a person chose or dropped to add as a plugin: a `.cnplugin` or `.zip` (a package, or loose files), a folder (a
 * package, or loose files), or single files. The result is the files of a package, as plain data for the window to show and
 * install (see packages/service/src/plugins.ts); nothing is written here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { packageFromPlain, PLUGIN_MANIFEST } from '@cave-notes/service/plugins';
import { readZip } from './zip';

export type PluginSource = { ok: true; files: Record<string, Uint8Array>; label: string } | { ok: false; error: string };

const MAX_FILES = 2000;
const MAX_BYTES = 100 * 1024 * 1024;

interface Item {
  name: string;
  data: Uint8Array;
}

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

/** If every file is inside one folder and the package's manifest is directly in it, the files without that folder. */
function stripTop(items: Item[]): Item[] {
  if (items.some((i) => i.name === PLUGIN_MANIFEST)) return items;
  const tops = new Set(items.map((i) => i.name.split('/')[0]));
  if (tops.size !== 1) return items;
  const top = [...tops][0]!;
  return items.some((i) => i.name === `${top}/${PLUGIN_MANIFEST}`) ? items.map((i) => ({ name: i.name.slice(top.length + 1), data: i.data })) : items;
}

const asFiles = (items: Item[]): Record<string, Uint8Array> => Object.fromEntries(items.map((i) => [i.name, i.data]));

export function readPluginSources(sources: string[]): PluginSource {
  try {
    if (sources.length === 0) return { ok: false, error: 'Nothing was chosen.' };
    const tally = { n: 0, bytes: 0 };
    // one zip or one folder may be a package
    if (sources.length === 1) {
      const src = sources[0]!;
      const st = fs.statSync(src);
      const base = path.basename(src);
      if (st.isDirectory()) {
        const items: Item[] = [];
        walk(src, '', items, tally);
        if (items.some((i) => i.name === PLUGIN_MANIFEST)) return { ok: true, files: asFiles(items), label: base };
        return plain(items, base);
      }
      if (/\.(zip|cnplugin)$/i.test(base)) {
        const items = stripTop(readZip(fs.readFileSync(src)).map((e) => ({ name: e.name, data: e.data })));
        const label = base.replace(/\.(zip|cnplugin)$/i, '');
        if (items.some((i) => i.name === PLUGIN_MANIFEST)) return { ok: true, files: asFiles(items), label };
        return plain(items, label);
      }
    }
    // loose files and folders: a folder keeps its name for the paths of what is in it
    const items: Item[] = [];
    for (const src of sources) {
      const st = fs.statSync(src);
      const base = path.basename(src);
      if (st.isDirectory()) {
        const inner: Item[] = [];
        walk(src, '', inner, tally);
        for (const i of inner) items.push({ name: `${base}/${i.name}`, data: i.data });
      } else if (/\.(zip|cnplugin)$/i.test(base)) {
        for (const e of readZip(fs.readFileSync(src))) items.push({ name: e.name, data: e.data });
      } else {
        tally.n++;
        tally.bytes += st.size;
        if (tally.bytes > MAX_BYTES) throw new Error('That file is too large.');
        items.push({ name: base, data: fs.readFileSync(src) });
      }
    }
    const label = sources.length === 1 ? path.basename(sources[0]!).replace(/\.[^.]+$/, '') : 'Added from files';
    return plain(items, label);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function plain(items: Item[], label: string): PluginSource {
  const r = packageFromPlain(items, label);
  return r.ok ? { ok: true, files: r.files, label } : { ok: false, error: r.error };
}
