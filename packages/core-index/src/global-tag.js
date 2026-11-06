/**
 * Globally global settings
 * ------------------------
 * A section of a workspace's own files can be tagged `!global`:
 *
 *   attributes: !global        (in any file of .cave-notes, and likewise `queries` and `relations`)
 *     status: idea
 *
 *   schema: !global
 *     due: { type: date }
 *
 *   rules: !global             (automation rules; they are told apart by their `id`)
 *     - id: archive-done
 *
 * A tag can also sit on a single entry, so that only that one is shared and its neighbours stay private:
 *
 *   rules:
 *     - !global                  (shared: this one rule)
 *       id: archive-done
 *     - id: only-here            (not shared)
 *   queries:
 *     open: !global status:idea  (shared: this one query; a value tagged like this is read as text)
 *     mine: status:mine
 *
 * Only what is tagged is offered, even when several files have the same section: `rules: !global` in one file does not
 * share the `rules:` of another file.
 *
 * Tagged sections apply to the workspace itself as usual, and are offered to the other workspaces on this computer
 * (which ask the person first). In a workspace that receives them, what the workspace sets itself wins: a section it
 * leaves out takes the global one, a section with entries is merged over it by name, and a section present but empty
 * switches the global one off.
 */
import YAML from 'yaml';

export const GLOBAL_TAG = '!global';
export const TAGS = [
  { tag: GLOBAL_TAG, collection: 'map' },
  { tag: GLOBAL_TAG, collection: 'seq' },
  { tag: GLOBAL_TAG, resolve: (str) => str }, // a single value (a text) tagged on its entry
];

/**
 * Parse YAML text that may contain `!global`. Never throws.
 * `globalKeys` are the sections tagged as a whole; `globalItems` has, for every other section, just the tagged entries
 * (a list of the tagged items, or a map of the tagged entries).
 * @returns {{ value: any, globalKeys: string[], globalItems: Record<string, any>, error?: string }}
 */
export function parseTagged(text) {
  const doc = YAML.parseDocument(text, { customTags: TAGS });
  if (doc.errors.length) return { value: undefined, globalKeys: [], globalItems: {}, error: String(doc.errors[0].message).split('\n')[0] };
  const globalKeys = [];
  const globalItems = {};
  const tagged = (n) => YAML.isNode(n) && n.tag === GLOBAL_TAG;
  if (YAML.isMap(doc.contents)) {
    for (const p of doc.contents.items) {
      const key = String(p.key?.value ?? p.key);
      if (tagged(p.value)) {
        globalKeys.push(key);
      } else if (YAML.isSeq(p.value)) {
        const items = p.value.items.filter(tagged).map((n) => n.toJS(doc));
        if (items.length) globalItems[key] = items;
      } else if (YAML.isMap(p.value)) {
        const entries = {};
        for (const e of p.value.items) if (tagged(e.value)) entries[String(e.key?.value ?? e.key)] = e.value.toJS(doc);
        if (Object.keys(entries).length) globalItems[key] = entries;
      }
    }
  }
  return { value: doc.toJS(), globalKeys, globalItems };
}

const isEmpty = (v) => v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v).length === 0 : false);
const isMapObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * What a section ends up as. `own` is the workspace's value, `present` whether it has the key at all, `inherited` the global one.
 * @param {'map'|'seq'} kind
 */
export function mergeSection(own, present, inherited, kind) {
  if (isEmpty(inherited)) return own;
  if (!present) return inherited;
  if (isEmpty(own)) return own; // present but empty: the global one is switched off
  if (kind === 'map') return isMapObj(own) && isMapObj(inherited) ? { ...inherited, ...own } : own;
  if (!Array.isArray(own) || !Array.isArray(inherited)) return own;
  const nameOf = (r) => String(r?.id ?? r?.name ?? '').toLowerCase();
  const names = new Set(own.map(nameOf));
  return [...inherited.filter((r) => !names.has(nameOf(r))), ...own];
}

/** What a workspace offers to the others: only what is tagged `!global`, as plain values. `config` is what `parseConfig` / `readConfig` gives. */
export function offered(config) {
  const out = {};
  const sec = config?.shared ?? {};
  for (const k of ['attributes', 'queries', 'relations', 'rules']) if (!isEmpty(sec[k])) out[k] = sec[k];
  if (!isEmpty(sec.schema)) out.schemaAttributes = sec.schema;
  if (!isEmpty(sec['export-style'])) out.exportStyles = sec['export-style'];
  return out;
}
