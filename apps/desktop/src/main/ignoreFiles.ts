/**
 * Finding and editing `.caveignore` files from the settings (see core-tree/src/ignore.js for what they say).
 *
 * Three places hold one:
 *   - the whole computer: `.caveignore` in the app's config folder;
 *   - a workspace: `.caveignore` at the top of the workspace folder;
 *   - any folder: inside the workspace, in a folder that is searched for workspaces, or one the person chose.
 * The list shows every file found in those places, and always the first two (empty when there is no file yet).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IgnoreFileInfo } from '../shared/api';

export const IGNORE_NAME = '.caveignore';
const SKIP = new Set(['node_modules', '.git', 'proc', 'sys', 'dev', 'lost+found', '__pycache__', 'site-packages', 'venv']);
const MAX_FOLDERS = 20_000;
const MAX_MS = 6_000;
const MAX_DEPTH = 8;
/** The text a new file starts with. */
export const STARTER = '# Lines of this file say what Cave Notes should pretend is not there. One pattern per line; `!` brings something back.\n';

/** The whole-computer file: in the app's config folder. */
export const globalIgnorePath = (appConfigDir: string): string => path.join(appConfigDir, IGNORE_NAME);

/** Its text now, or null when there is no file. */
export function readGlobalIgnore(appConfigDir: string): string | null {
  try {
    return fs.readFileSync(globalIgnorePath(appConfigDir), 'utf8');
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The `.caveignore` files under some folders (hidden folders, `node_modules` and links are not entered; a time and size limit keeps a huge folder from being a problem). */
function walkFor(starts: Array<{ dir: string; depth: number }>): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const t0 = Date.now();
  let visited = 0;
  const queue = starts.map((s) => ({ dir: path.resolve(s.dir), depth: s.depth }));
  while (queue.length > 0) {
    if (visited >= MAX_FOLDERS || Date.now() - t0 > MAX_MS) break;
    const { dir, depth } = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === IGNORE_NAME) found.add(path.join(dir, e.name));
      else if (e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !SKIP.has(e.name) && depth < MAX_DEPTH) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return [...found];
}

export interface FindOptions {
  appConfigDir: string;
  /** the workspace the list is for (its own file is always listed) */
  workspaceRoot: string | null;
  /** folders the scan for workspaces looks in (the home folder when none are chosen) */
  scanRoots: string[];
  /** folders the person added by hand */
  extraFolders: string[];
}

/** Every `.caveignore` there is to show, the whole-computer one first, then the workspace's, then the rest by folder. */
export function findIgnoreFiles(o: FindOptions): IgnoreFileInfo[] {
  const globalFile = globalIgnorePath(o.appConfigDir);
  const workspaceFile = o.workspaceRoot ? path.join(path.resolve(o.workspaceRoot), IGNORE_NAME) : null;
  const out: IgnoreFileInfo[] = [];
  const add = (file: string, scope: IgnoreFileInfo['scope']): void => {
    const text = readText(file);
    out.push({ file, folder: path.dirname(file), scope, exists: text !== null, text: text ?? '', ...(scope === 'folder' && o.workspaceRoot && isInside(path.dirname(file), o.workspaceRoot) ? { insideWorkspace: true } : {}) });
  };
  add(globalFile, 'computer');
  if (workspaceFile) add(workspaceFile, 'workspace');
  const starts: Array<{ dir: string; depth: number }> = [];
  if (o.workspaceRoot) starts.push({ dir: o.workspaceRoot, depth: 0 });
  // a scan of the whole home folder looks only a few levels down (where workspaces and their `.caveignore` files are kept)
  for (const r of o.scanRoots) starts.push({ dir: r, depth: MAX_DEPTH - 4 });
  const rest = new Set(walkFor(starts));
  for (const f of o.extraFolders) {
    const file = path.join(path.resolve(f), IGNORE_NAME);
    if (readText(file) !== null) rest.add(file);
  }
  rest.delete(workspaceFile ?? '');
  rest.delete(globalFile);
  for (const f of [...rest].sort((a, b) => a.localeCompare(b))) add(f, 'folder');
  return out;
}

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Only files that are called `.caveignore` and have an absolute path can be written or removed here. */
function checked(file: string): string {
  if (!path.isAbsolute(file) || path.basename(file) !== IGNORE_NAME) throw new Error('That is not a .caveignore file.');
  return path.resolve(file);
}

export function writeIgnoreFile(file: string, text: string): void {
  const f = checked(file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.cave-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, f);
}

export function removeIgnoreFile(file: string): void {
  const f = checked(file);
  try {
    fs.unlinkSync(f);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** The text of a file for a folder that has none yet. */

