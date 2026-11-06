import { fs, host, path } from '@cave-notes/platform';
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
 */
export async function scanForWorkspaces(roots: string[], ignore: string[] = [], isStopped: () => boolean = () => false): Promise<string[]> {
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
        if (e.name === INFO_DIR && e.isDirectory()) found.add(dir);
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const sub = path.join(dir, e.name);
        if (ignored(sub) || seen.has(sub)) continue;
        seen.add(sub);
        queue.push(sub);
      }
    };
    pump();
  });
  const sorted = [...found].sort((a, b) => a.localeCompare(b));
  log.info(`workspace scan: ${visited} folders in ${Math.round(performance.now() - t0)} ms, ${sorted.length} workspace(s) found${gaveUp ? ' (incomplete)' : ''}`);
  return sorted;
}

/** Where scanning starts: the chosen folders, or the home folder when none are chosen. */
export const scanRoots = (chosen: string[]): string[] => {
  const list = chosen.filter((p) => path.isAbsolute(p));
  return list.length > 0 ? list : [host.homedir()];
};
