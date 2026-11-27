/**
 * The plugins that come with Cave Notes are plugin packages like any other (see plugins.ts), shipped in the app's `defaults/plugins/`
 * (read-only, in its resources) and installed into the app config folder. They are kept up to date the same way a person's own
 * updates are: a new version of a package that is installed replaces the files nobody changed, keeps the ones the person
 * edited, adds new ones and drops what the new version dropped. A built-in the person removed stays removed (what was removed is
 * kept in `builtins.json` next to the folder, not inside it) until they restore it.
 *
 * Before this, built-ins were single YAML files copied by a separate mechanism (`seeded.json`); on the first start with this code
 * that is migrated: an unchanged old copy goes (the package takes its place), one the person edited stays theirs and the
 * package is not installed (there would be two of the same rule), and one that was deleted counts as removed.
 */
import { fs, path, sha1 } from '@cave-notes/platform';
import { log } from './log';
import { compareVersions, listInstalled, parsePackage, planInstall, planUpdate, readFolderPackage, writeInstall, writeUpdate, type ExistingNames, type PluginPackage } from './plugins';

const STATE = 'builtins.json';
const OLD_MANIFEST = 'seeded.json';

const stateFile = (appDir: string): string => path.join(path.dirname(appDir), STATE);

interface State {
  removed: string[];
}

async function readState(appDir: string): Promise<State> {
  try {
    const v = JSON.parse(await fs.readFile(stateFile(appDir), 'utf8')) as Partial<State>;
    return { removed: Array.isArray(v.removed) ? v.removed.filter((x): x is string => typeof x === 'string') : [] };
  } catch {
    return { removed: [] };
  }
}

async function writeState(appDir: string, st: State): Promise<void> {
  await fs.mkdir(path.dirname(stateFile(appDir)), { recursive: true });
  await fs.writeFile(stateFile(appDir), `${JSON.stringify({ removed: [...new Set(st.removed)].sort() }, null, 2)}\n`);
}

/** The packages that ship with the app: every folder of `<shipped>/plugins/` that holds a `plugin.yaml`. */
export async function shippedPackages(shipped: string): Promise<Array<{ folder: string; pkg: PluginPackage }>> {
  const out: Array<{ folder: string; pkg: PluginPackage }> = [];
  const base = path.join(shipped, 'plugins');
  let names: string[] = [];
  try {
    names = ((await fs.readdir(base, { withFileTypes: true })) as Array<{ name: string; isDirectory(): boolean }>).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch {
    return out;
  }
  for (const folder of names) {
    try {
      const parsed = parsePackage(await readFolderPackage(path.join(base, folder)));
      if (parsed.ok) out.push({ folder, pkg: parsed.plugin });
      else log.warn(`built-in plugin ${folder} is not valid: ${parsed.errors.join('; ')}`);
    } catch (e) {
      log.warn(`built-in plugin ${folder} could not be read: ${(e as Error).message}`);
    }
  }
  return out;
}

/** The ids of the packages that ship with the app. */
export async function shippedIds(shipped: string): Promise<string[]> {
  return (await shippedPackages(shipped)).map((p) => p.pkg.manifest.id);
}

async function migrateOldSeeding(shipped: Array<{ pkg: PluginPackage }>, appDir: string): Promise<void> {
  const file = path.join(path.dirname(appDir), OLD_MANIFEST);
  let old: Record<string, string>;
  try {
    old = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>;
  } catch {
    return;
  }
  const ids = new Set(shipped.map((p) => p.pkg.manifest.id));
  const st = await readState(appDir);
  for (const [rel, was] of Object.entries(old ?? {})) {
    const m = /^plugins\/([^/]+)\.ya?ml$/.exec(rel);
    if (!m || !ids.has(m[1]!)) continue;
    const abs = path.join(appDir, ...rel.split('/'));
    let now: string | null = null;
    try {
      now = sha1(await fs.readFile(abs));
    } catch {
      /* deleted */
    }
    if (now === null) st.removed.push(m[1]!); // the person had uninstalled it
    else if (now === was) await fs.rm(abs, { force: true }); // nobody changed it: the package replaces it
    else st.removed.push(m[1]!); // theirs now: not installed a second time
  }
  await writeState(appDir, st);
  await fs.rm(file, { force: true });
  log.info('migrated the built-in plugins from single files to packages');
}

async function existingFor(appDir: string): Promise<ExistingNames> {
  const folders = new Map<string, string | null>();
  const have = new Map((await listInstalled(appDir)).map((i) => [i.folder, i.record.plugin]));
  try {
    for (const e of (await fs.readdir(path.join(appDir, 'plugins'), { withFileTypes: true })) as Array<{ name: string; isDirectory(): boolean }>) {
      if (e.isDirectory() && !e.name.startsWith('.')) folders.set(e.name, have.get(e.name) ?? null);
    }
  } catch {
    /* none yet */
  }
  return { styles: new Set(), templates: new Set(), queries: new Set(), folders, pageTaken: () => true };
}

/** Install the built-ins that are not installed (and were not removed) and update the ones that have a newer version. */
export async function syncBuiltins(shipped: string, appDir: string): Promise<{ installed: string[]; updated: string[] }> {
  const out = { installed: [] as string[], updated: [] as string[] };
  const pkgs = await shippedPackages(shipped);
  if (pkgs.length === 0) return out;
  await migrateOldSeeding(pkgs, appDir);
  const st = await readState(appDir);
  for (const { pkg } of pkgs) {
    const m = pkg.manifest;
    if (st.removed.includes(m.id)) continue;
    try {
      const have = (await listInstalled(appDir)).find((i) => i.record.plugin === m.id);
      if (!have) {
        await writeInstall(appDir, planInstall(pkg, { scope: 'app', existing: await existingFor(appDir) }));
        out.installed.push(m.id);
      } else if (compareVersions(m.version, have.record.version) > 0) {
        const up = await planUpdate(pkg, { ...have, settingsDir: appDir }, { existing: await existingFor(appDir) });
        await writeUpdate(appDir, have.folder, up);
        out.updated.push(m.id);
      }
    } catch (e) {
      log.warn(`built-in plugin ${m.id}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Remember that a built-in was removed, so it does not come back when the app starts. */
export async function markBuiltinRemoved(appDir: string, id: string): Promise<void> {
  const st = await readState(appDir);
  await writeState(appDir, { removed: [...st.removed, id] });
}

/** The built-ins that were removed. */
export async function removedBuiltins(appDir: string): Promise<string[]> {
  return (await readState(appDir)).removed;
}

/** Bring back the built-ins that were removed; how many that was. */
export async function restoreBuiltins(shipped: string, appDir: string): Promise<number> {
  const ids = new Set(await shippedIds(shipped));
  const st = await readState(appDir);
  const back = st.removed.filter((id) => ids.has(id));
  await writeState(appDir, { removed: st.removed.filter((id) => !ids.has(id)) });
  await syncBuiltins(shipped, appDir);
  return back.length;
}
