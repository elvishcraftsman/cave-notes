/**
 * The app's own settings folder: the plugins that come with Cave Notes and what is installed for the whole app, kept where the
 * person can see and edit it. It is a settings folder like a workspace's `.cave-notes` (`<app data>/app-config/.cave-notes/`,
 * the name makes it open as one) and is read by the same code, as the layer under every workspace's own settings. What ships
 * with the app is installed into it as plugin packages and kept up to date (see builtins.ts).
 */
import YAML from 'yaml';
import { fs, path } from '@cave-notes/platform';
import { readConfig } from '@cave-notes/core-index/config';
import { CONFIG_DIR_NAME } from './config-folder';
import { log } from './log';

/** `<app data>/app-config/.cave-notes`: the folder that is opened to edit the app's own plugins and templates. */
export const appConfigFolder = (appData: string): string => path.join(appData, 'app-config', CONFIG_DIR_NAME);

/**
 * Which file of the app config folder each automation (rule id) is in, relative to the folder. The files are the ones the
 * layered settings reader takes (see `readConfig` of core-index), so the app's folder and a workspace's are read the same way.
 */
export async function appRuleFiles(target: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const cfg = await readConfig(target);
  for (const f of cfg.files) {
    if (f.error || !f.keys.includes('rules')) continue;
    try {
      const doc = YAML.parse(await fs.readFile(path.join(target, f.name), 'utf8')) as { rules?: unknown } | null;
      for (const r of doc && Array.isArray(doc.rules) ? doc.rules : []) {
        const id = r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined;
        if (typeof id === 'string' && !out.has(id)) out.set(id, f.name);
      }
    } catch (e) {
      log.warn(`app plugin file skipped: ${f.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Remove one automation from the app config folder's file, or the whole file when it was the last one. Whether it was found. */
export async function removeAppRule(target: string, id: string): Promise<boolean> {
  const rel = (await appRuleFiles(target)).get(id);
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
