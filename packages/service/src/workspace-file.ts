import { fs, path } from '@cave-notes/platform';
import YAML from 'yaml';
import { homeFor, mergeSection, readConfig, type WorkspaceConfig } from '@cave-notes/core-index/config';

/** The folder that marks a workspace, and the files the app keeps in it. */
export const INFO_DIR = '.cave-notes';
/** The usual file for the workspace's own settings. Any YAML file in the folder can hold any section (see packages/core-index/src/config.js). */
export const WORKSPACE_FILE = 'workspace.yaml';
export const STATE_FILE = 'state.yaml';

export const infoPath = (root: string, ...more: string[]): string => path.join(root, INFO_DIR, ...more);

/** Every settings file of a `.cave-notes` folder, put together. */
export const readSettings = (dir: string): Promise<WorkspaceConfig> => readConfig(dir);

/** The sections of the settings files of a `.cave-notes` folder, as one plain object. */
export async function readSections(dir: string): Promise<Record<string, any>> {
  return (await readConfig(dir)).sections;
}

/**
 * Change one section (a top-level key) in the settings file that has it, or in the usual file for it when none has it.
 * `change` gets the parsed document of that file and edits it, so comments and the order of keys stay.
 */
export async function editSection(dir: string, key: string, change: (doc: YAML.Document) => void): Promise<string> {
  const config = await readConfig(dir);
  const name = homeFor(config, key);
  await editYaml(path.join(dir, name), change);
  return name;
}

/** The automation rules (`rules:` and `settings:`) of the settings files, with the shared ones, as YAML text for the engine, or null when there are none. */
export async function rulesText(dir: string, inherited?: unknown[], defaults?: unknown[]): Promise<string | null> {
  const cfg = await readConfig(dir);
  const shared = inherited && inherited.length > 0 ? inherited : undefined;
  const shipped = defaults && defaults.length > 0 ? defaults : undefined;
  if (!cfg.present.has('rules') && !cfg.present.has('settings') && !shared && !shipped) return null;
  // rules other workspaces share (`rules: !global`) join the workspace's own, which win by `id`; an empty `rules:` switches them off
  const rules = mergeSection(cfg.sections.rules, cfg.present.has('rules'), shared, 'seq') ?? [];
  // the plugins that come with the app (the app config folder) come last: anything of the workspace's with the same id wins, and
  // an empty `rules:` does not switch them off (they are turned off, or uninstalled, in the Plugins menu)
  if (shipped) {
    const have = new Set((rules as Array<{ id?: unknown }>).map((r) => r?.id));
    for (const r of shipped) if (!have.has((r as { id?: unknown }).id)) rules.push(r);
  }
  return YAML.stringify({ ...(cfg.sections.settings ? { settings: cfg.sections.settings } : {}), rules });
}

/** Read a YAML file as a plain object ({} when it is missing or not a mapping). */
export async function readYamlObject(file: string): Promise<Record<string, unknown>> {
  try {
    const v = YAML.parse(await fs.readFile(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Change a YAML file without disturbing what the person wrote in it: comments and the order of keys stay.
 * `change` gets the parsed document and edits it. The file is replaced in one step.
 */
export async function editYaml(file: string, change: (doc: YAML.Document) => void): Promise<void> {
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    /* a new file */
  }
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) throw Object.assign(new Error(`${path.basename(file)} is not valid YAML, so it was left alone.`), { code: 'BAD_YAML' });
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  change(doc);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, String(doc));
  await fs.rename(tmp, file);
}

/** Set or remove (null/undefined) one top-level key. */
export function setKey(doc: YAML.Document, key: string, value: unknown): void {
  if (value === null || value === undefined) doc.delete(key);
  else doc.set(key, value);
}

/** The folder a workspace lives in, if `dir` or one of its ancestors holds `.cave-notes`; the nearest one wins. */
export async function containingWorkspace(dir: string, { includeSelf = true }: { includeSelf?: boolean } = {}): Promise<string | null> {
  let cur = path.resolve(dir);
  if (!includeSelf) cur = path.dirname(cur);
  for (;;) {
    try {
      if ((await fs.stat(path.join(cur, INFO_DIR))).isDirectory()) return cur;
    } catch {
      /* not here */
    }
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}
