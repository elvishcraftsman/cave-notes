import YAML from 'yaml';
import { fs, path } from '@cave-notes/platform';
import { readConfig } from '@cave-notes/core-index/config';
import { INFO_DIR, WORKSPACE_FILE, containingWorkspace } from './workspace-file';

/** What an app asks before opening a folder: is it a workspace, and is it inside another one? */
export async function workspaceStatus(folder: string): Promise<{ isWorkspace: boolean; containing: string | null }> {
  const abs = path.resolve(folder);
  const own = await containingWorkspace(abs);
  return { isWorkspace: own === abs, containing: await containingWorkspace(abs, { includeSelf: false }) };
}

/** The sections of the settings a workspace passes on when a folder inside it becomes a workspace and keeps them (the schema goes too). */
const INHERITED_KEYS = ['attributes', 'schema', 'queries', 'relations', 'notes', 'color', 'icon'];

/**
 * Make a folder a workspace: create its `.cave-notes` folder. With `copySettingsFrom` (the workspace it was part of) the
 * schema and the shared settings are copied in, as one settings file. Nothing in the folder's notes changes.
 */
export async function promoteFolder(folder: string, copySettingsFrom: string | null): Promise<void> {
  const dir = path.join(path.resolve(folder), INFO_DIR);
  await fs.mkdir(dir, { recursive: true });
  if (!copySettingsFrom) return;
  const raw = (await readConfig(path.join(path.resolve(copySettingsFrom), INFO_DIR))).sections;
  const keep: Record<string, unknown> = {};
  for (const k of INHERITED_KEYS) if (k in raw) keep[k] = raw[k];
  if (Object.keys(keep).length > 0) {
    try {
      await fs.writeFile(path.join(dir, WORKSPACE_FILE), YAML.stringify(keep), { flag: 'wx' });
    } catch {
      /* one already exists: it is the folder's own */
    }
  }
}

/**
 * Stop a folder being a workspace: delete its `.cave-notes` folder (index, settings, saved queries, history). Notes are
 * not touched. When the folder is already gone (another computer removed it and a sync carried that over) there is
 * nothing left to delete, and that is fine: the aim, a folder that is no longer a workspace, is reached.
 */
export async function removeWorkspace(root: string): Promise<void> {
  const dir = path.join(path.resolve(root), INFO_DIR);
  let st;
  try {
    st = await fs.lstat(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return;
    throw e;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Not a workspace folder');
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Of these folders, the ones that exist but are not workspaces any more (their `.cave-notes` folder is gone, for example
 * because the workspace was removed on another computer and the sync followed). A folder that cannot be found at all is
 * not listed: it may be on a drive that is not plugged in.
 */
export async function noLongerWorkspaces(roots: string[]): Promise<string[]> {
  const gone: string[] = [];
  for (const r of roots) {
    const isDir = await fs.stat(r).then((st) => st.isDirectory(), () => false);
    if (!isDir) continue;
    const hasInfo = await fs.stat(path.join(r, INFO_DIR)).then((st) => st.isDirectory(), () => false);
    if (!hasInfo) gone.push(r);
  }
  return gone;
}
