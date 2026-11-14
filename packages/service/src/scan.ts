import { fs, host, path } from '@cave-notes/platform';
import { createIgnore } from '@cave-notes/core-tree';
import { log } from './log';

const INFO_DIR = '.cave-notes';
const SKIP = new Set(['node_modules', 'proc', 'sys', 'dev', 'lost+found', '__pycache__', 'site-packages', 'venv']);
/** Folders read at once: few, so a scan of a big home folder cannot starve the app of CPU. */
const CONCURRENCY = 3;
/** A scan gives up after this many folders (a runaway tree, or a network or cloud mount in the home folder). */
const MAX_FOLDERS = 60_000;
const MAX_MS = 60_000;

/**
 * Look through folders for workspaces (folders holding `.cave-notes`), including workspaces inside other workspaces.
 * Hidden folders, `node_modules` and symbolic links are not entered; `ignore` lists folders to leave out (with everything
 * below them). Folders are read a few at a time so the app stays responsive. Results are sorted by path.
 *
 * `.caveignore` files (see core-tree/src/ignore.js) in the folders being scanned are honoured: a folder they list is not
 * entered, and a `.cave-notes` they list does not make a workspace. A line that would leave no workspace at all is dropped:
 * if the scan finds nothing while some line kept it from looking, it runs once more without those lines.
 */
export async function scanForWorkspaces(roots: string[], ignore: string[] = [], isStopped: () => boolean = () => false): Promise<string[]> {
  const off = new Set<string>(); // lines of .caveignore files that are switched off, as "root|folder:line"
  const first = await scanOnce(roots, ignore, isStopped, off);
  if (first.found.length > 0 || first.pruned.size === 0 || isStopped()) return first.found;
  for (const id of first.pruned) off.add(id);
  log.warn(`workspace scan: .caveignore lines would hide every workspace, so they are left out: ${[...first.pruned].join(', ')}`);
  return (await scanOnce(roots, ignore, isStopped, off)).found;
}

async function scanOnce(roots: string[], ignore: string[], isStopped: () => boolean, off: Set<string>): Promise<{ found: string[]; pruned: Set<string> }> {
  const pruned = new Set<string>();
  const rootDirs = roots.map((r) => path.resolve(r));
  // one rule set per scanned folder; its "off" lines are the ones of this folder, written without the folder's name
  const rules = rootDirs.map((r) => {
    const mine = new Set<string>();
    for (const id of off) if (id.startsWith(`${r}|`)) mine.add(id.slice(r.length + 1));
    return { root: r, ig: createIgnore(r, { off: mine }) };
  });
  const ruleFor = (dir: string): { root: string; ig: ReturnType<typeof createIgnore> } | undefined =>
    rules.filter((x) => dir === x.root || dir.startsWith(x.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
  /** True when a .caveignore hides `target` (a folder); the deciding line is remembered. */
  const hidden = async (dir: string, name: string): Promise<boolean> => {
    const x = ruleFor(dir);
    if (!x) return false;
    const rel = path.relative(x.root, path.join(dir, name)).split(path.sep).join('/');
    const res = await x.ig.check(rel, true);
    if (res.ignored && res.by) pruned.add(`${x.root}|${res.by}`);
    return res.ignored && (name === INFO_DIR || !res.reinclude); // a folder that a `!` line may bring something back from is still looked into
  };
  const skipFolders = ignore.map((p) => path.resolve(p));
  const ignored = (dir: string): boolean => skipFolders.some((s) => dir === s || dir.startsWith(s + path.sep));
  const found = new Set<string>();
  const queue: string[] = roots.map((r) => path.resolve(r)).filter((r) => !ignored(r));
  const seen = new Set<string>(queue);
  let active = 0;
  let visited = 0;
  const t0 = performance.now();
  let gaveUp = false;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (isStopped() || (!gaveUp && (visited >= MAX_FOLDERS || performance.now() - t0 > MAX_MS))) {
        if (!isStopped() && !gaveUp) {
          gaveUp = true;
          log.warn(`workspace scan gave up after ${visited} folders / ${Math.round(performance.now() - t0)} ms (still ${queue.length} queued). A very large folder, or a network/cloud mount, is under ${roots.join(', ')}; narrow the scan in Preferences.`);
        }
        queue.length = 0;
      }
      while (active < CONCURRENCY && queue.length > 0) {
        const dir = queue.shift()!;
        active++;
        void visit(dir).finally(() => {
          active--;
          setTimeout(pump, 0); // let other work run between folders
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    };
    const visit = async (dir: string): Promise<void> => {
      visited++;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // no permission, or it vanished
      }
      for (const e of entries) {
        if (e.name === INFO_DIR && e.isDirectory() && !(await hidden(dir, INFO_DIR))) found.add(dir);
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const sub = path.join(dir, e.name);
        if (ignored(sub) || seen.has(sub)) continue;
        if (await hidden(dir, e.name)) continue; // listed in a .caveignore
        seen.add(sub);
        queue.push(sub);
      }
    };
    pump();
  });
  const sorted = [...found].sort((a, b) => a.localeCompare(b));
  log.info(`workspace scan: ${visited} folders in ${Math.round(performance.now() - t0)} ms, ${sorted.length} workspace(s) found${gaveUp ? ' (incomplete)' : ''}`);
  return { found: sorted, pruned };
}

/** Where scanning starts: the chosen folders, or the home folder when none are chosen. */
export const scanRoots = (chosen: string[]): string[] => {
  const list = chosen.filter((p) => path.isAbsolute(p));
  return list.length > 0 ? list : [host.homedir()];
};
