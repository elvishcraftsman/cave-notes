/**
 * A workspace's `.cave-notes` folder opened as a lightweight workspace of its own, to edit its settings files and templates.
 * Nothing here is indexed, no schema is read and the folder gets no `.cave-notes` of its own. (Kept free of heavy imports:
 * the main process uses it too.)
 */
import { fs, path } from '@cave-notes/platform';
import { INFO_DIR } from './workspace-file';

/** The folder's name on disk: a folder with this name is opened in config mode. */
export const CONFIG_DIR_NAME = INFO_DIR;

/** Which files the config folder shows as pages: the notes (templates) and the YAML settings. */
export const CONFIG_NOTES = { exts: ['.md', '.txt', '.yaml', '.yml'], create: '.md' };

/** The extension of a new page here: settings files at the top level are YAML; what goes inside `templates` stays Markdown. */
export const configCreateExt = (parent: string | null): '.yaml' | '.md' => (parent === null || /^(plugins|styles)(\/|$)/.test(parent) ? '.yaml' : '.md');

export const isConfigRoot = (root: string): boolean => path.basename(path.resolve(root)) === CONFIG_DIR_NAME;

/**
 * Make sure the `.cave-notes` folder exists, so it can be opened. Nothing else is written: no starter files and no
 * templates folder. Files appear only when the user makes them.
 */
export async function ensureConfigFolder(workspaceRoot: string): Promise<string> {
  const dir = path.join(path.resolve(workspaceRoot), INFO_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
