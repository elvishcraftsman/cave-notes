/**
 * The app's own settings folder: the plugins and templates that come with Cave Notes, kept where the person can edit them.
 *
 * The app ships a folder `defaults/` (in its resources, read-only: inside an AppImage nothing can be changed). On start the
 * files in it are copied into the app config folder, `<app data>/app-config/.cave-notes/` (the name makes it open as a
 * settings folder, like a workspace's), and every workspace then offers the plugins found in `plugins/` and the templates
 * found in `templates/`. Rules for the copying:
 *   - a file that is not there yet is copied, unless it was copied before (the person deleted it: that is how a default
 *     plugin is uninstalled, and it stays gone);
 *   - a copy nobody changed is replaced by a newer shipped version when the app brings one;
 *   - a copy the person changed is never touched.
 * What was copied, and what it looked like then, is written in `seeded.json` next to the folder (not inside it, so it is not
 * mistaken for a settings file).
 */
import YAML from 'yaml';
import { fs, path, sha1 } from '@cave-notes/platform';
import { CONFIG_DIR_NAME } from './config-folder';

const SUBFOLDERS = ['plugins', 'templates'] as const;
const MANIFEST = 'seeded.json';

/** `<app data>/app-config/.cave-notes`: the folder that is opened to edit the app's own plugins and templates. */
export const appConfigFolder = (appData: string): string => path.join(appData, 'app-config', CONFIG_DIR_NAME);

const manifestFile = (target: string): string => path.join(path.dirname(target), MANIFEST);

/** A fingerprint of a file's bytes (to tell whether it was changed), or null when it is not there. */
async function sha(file: string): Promise<string | null> {
  try {
    return sha1(await fs.readFile(file));
  } catch {
    return null;
  }
}

async function readManifest(target: string): Promise<Record<string, string>> {
  try {
    const v = JSON.parse(await fs.readFile(manifestFile(target), 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function listShipped(shipped: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of SUBFOLDERS) {
    let names: string[] = [];
    try {
      names = await fs.readdir(path.join(shipped, sub));
    } catch {
      continue;
    }
    for (const n of names.sort()) if (!n.startsWith('.') && /\.(ya?ml|md|txt)$/i.test(n)) out.push(`${sub}/${n}`);
  }
  return out;
}

export interface SeedResult {
  added: string[];
  updated: string[];
}

/** Copy what ships with the app into the app config folder (see the rules above). Safe to call at every start. */
export async function seedDefaults(shipped: string | null, target: string, opts: { restore?: boolean } = {}): Promise<SeedResult> {
  const result: SeedResult = { added: [], updated: [] };
  for (const sub of SUBFOLDERS) await fs.mkdir(path.join(target, sub), { recursive: true });
  if (!shipped) return result;
  const manifest = await readManifest(target);
  let changed = false;
  for (const rel of await listShipped(shipped)) {
    const from = path.join(shipped, rel);
    const to = path.join(target, rel);
    const shippedSha = await sha(from);
    if (!shippedSha) continue;
    const there = await sha(to);
    if (there === null) {
      if (manifest[rel] !== undefined && !opts.restore) continue; // copied before and deleted since: the person removed it
      await fs.copyFile(from, to);
      manifest[rel] = shippedSha;
      changed = true;
      result.added.push(rel);
    } else if (there !== shippedSha && manifest[rel] === there) {
      await fs.copyFile(from, to); // unchanged since it was copied, and the app has a newer one
      manifest[rel] = shippedSha;
      changed = true;
      result.updated.push(rel);
    } else if (there === shippedSha && manifest[rel] !== shippedSha) {
      manifest[rel] = shippedSha;
      changed = true;
    }
  }
  if (changed) await fs.writeFile(manifestFile(target), JSON.stringify(manifest, null, 2));
  return result;
}

/** The shipped files that were removed (and so are not copied again until restored). */
export async function removedDefaults(shipped: string | null, target: string): Promise<string[]> {
  if (!shipped) return [];
  const manifest = await readManifest(target);
  const out: string[] = [];
  for (const rel of await listShipped(shipped)) if (manifest[rel] !== undefined && (await sha(path.join(target, rel))) === null) out.push(rel);
  return out;
}

export interface DefaultPlugins {
  /** the rules of every plugin file, as the workspace's own `rules:` would be */
  rules: unknown[];
  /** which file each rule came from (relative to the app config folder) */
  fileOf: Map<string, string>;
  /** what was wrong with a file that could not be used */
  problems: string[];
}

/** Read the plugin files of the app config folder. A file that is not valid YAML is skipped, with a note in `problems`. */
export async function loadDefaultPlugins(target: string): Promise<DefaultPlugins> {
  const out: DefaultPlugins = { rules: [], fileOf: new Map(), problems: [] };
  let names: string[] = [];
  try {
    names = (await fs.readdir(path.join(target, 'plugins'))).filter((n) => /\.ya?ml$/i.test(n) && !n.startsWith('.')).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const doc = YAML.parse(await fs.readFile(path.join(target, 'plugins', n), 'utf8')) as { rules?: unknown } | null;
      const list = doc && Array.isArray(doc.rules) ? doc.rules : [];
      for (const r of list) {
        const id = r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined;
        if (typeof id !== 'string' || out.fileOf.has(id)) continue;
        out.rules.push(r);
        out.fileOf.set(id, `plugins/${n}`);
      }
    } catch (e) {
      out.problems.push(`plugins/${n}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Remove one rule (a plugin) from the file it is in, or the whole file when it was the last one. Whether it was found. */
export async function removeDefaultPlugin(target: string, id: string): Promise<boolean> {
  const loaded = await loadDefaultPlugins(target);
  const rel = loaded.fileOf.get(id);
  if (!rel) return false;
  const file = path.join(target, rel);
  const doc = YAML.parseDocument(await fs.readFile(file, 'utf8'));
  const rules = doc.get('rules');
  if (!YAML.isSeq(rules)) return false;
  rules.items = rules.items.filter((it) => !(YAML.isMap(it) && it.get('id') === id));
  if (rules.items.length === 0) await fs.rm(file, { force: true });
  else await fs.writeFile(file, String(doc));
  return true;
}

/** Take the rule with this `id` out of a settings file's `rules:`; false when that file does not have it. */
export async function removeRuleFromFile(file: string, id: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return false;
  }
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) return false;
  const rules = doc.get('rules');
  if (!YAML.isSeq(rules)) return false;
  const before = rules.items.length;
  rules.items = rules.items.filter((it) => !(YAML.isMap(it) && it.get('id') === id));
  if (rules.items.length === before) return false;
  // an empty `rules:` would switch off the rules shared by other workspaces, so the key goes when the last rule does
  if (rules.items.length === 0) doc.delete('rules');
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, String(doc));
  await fs.rename(tmp, file);
  return true;
}
