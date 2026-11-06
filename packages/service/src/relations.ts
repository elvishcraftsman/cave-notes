/**
 * Editing a relation. A relation attribute (`project: [[River Bible]]`) names pages; when the relation is mutual the
 * other side (`tasks: [[Write intro]]`) names the page back, and the two are kept in step:
 *
 *   - naming a page adds this page to the other page's attribute;
 *   - dropping a page takes this page out of it;
 *   - an attribute that holds one page only, and already names another, is a conflict to ask about, never to guess.
 *
 * Nothing is written until the whole change is worked out and every conflict has an answer. The files are then
 * written (the other pages first, this page last); if one write fails the ones already done are put back.
 * The module knows nothing about files or the index: the service hands it a `RelationHost`.
 *
 * A page of another workspace (`project: [[Theology::Projects/Plan]]`) is handled like any other page: it is given a
 * key (see `foreignKey`) wherever a path would be, and the host reads and writes its file. Its back attribute is
 * changed in that file, with a link back that names this workspace (`[[Notes::Write intro]]`).
 */
import { linkTarget } from '@cave-notes/core-index';
import { parse as parseMarkdown } from '@cave-notes/core-md';
import type { AttrValue, RelationConflict, RelationDef, RelationEditRequest, RelationEditResult, RelationPage, RelationResolution } from './api';

/** Marks the key of a page of another workspace: no path of this workspace starts with it. */
const FOREIGN = '\u0001';

/** What stands for a page of another workspace wherever a path would: `\u0001workspace\u0001path` (the workspace name in lower case). */
export const foreignKey = (workspace: string, path: string): string => `${FOREIGN}${workspace.toLowerCase()}${FOREIGN}${path}`;

/** The workspace and path a key stands for; null for the path of a page of this workspace. */
export function foreignParts(key: string): { workspace: string; path: string } | null {
  if (!key.startsWith(FOREIGN)) return null;
  const i = key.indexOf(FOREIGN, 1);
  return i < 0 ? null : { workspace: key.slice(1, i), path: key.slice(i + 1) };
}

export interface RelationHost {
  /** the paths of the pages a saved query finds (this workspace only) */
  members(savedQuery: string): Set<string>;
  /**
   * The page a name, path or title points at. `within` is the workspace of the file the text was written in (null: this
   * one): there a plain name can only be a path, and `This::Page` points back into this workspace. A page of another
   * workspace comes back as a key.
   */
  resolve(ref: string, within?: string | null): { path: string; title: string } | null;
  titleOf(path: string): string;
  /** a page as a person is shown it: its title, and the workspace when it is another one */
  describe(path: string): RelationPage;
  /** the text that links to a page, `[[Name]]`, as written in a file of workspace `within` (null: this one) */
  linkFor(path: string, within?: string | null): string;
  read(path: string): Promise<{ exists: boolean; text: string; hash: string | null }>;
  /** save `text` unless the file is no longer what `baseHash` says; `conflict` says that it changed */
  write(path: string, text: string, baseHash: string | null): Promise<{ ok: boolean; hash?: string; conflict?: boolean }>;
  /** the text with one attribute set (null removes it) */
  setValue(text: string, key: string, value: AttrValue | null): string;
}

interface Entry {
  raw: string;
  /** the page it names, null when it names none (a plain word, a broken link) */
  path: string | null;
}

interface Loaded {
  path: string;
  text: string;
  hash: string | null;
}

/** The value of an attribute in a page's frontmatter: the key as written there (any capitals) and the entries it holds. */
export function readEntries(text: string, attribute: string, host: Pick<RelationHost, 'resolve'>, within: string | null = null): { key: string; entries: Entry[]; error: string | null } {
  const fm = (parseMarkdown(text) as { frontmatter: { data: Record<string, unknown>; error: string | null } }).frontmatter;
  if (fm.error) return { key: attribute, entries: [], error: fm.error };
  const data = fm.data ?? {};
  let key = Object.keys(data).find((k) => k.toLowerCase() === attribute.toLowerCase());
  let value: unknown = key === undefined ? undefined : data[key];
  if (key === undefined && attribute.includes('.')) {
    // a nested attribute, `a.b`
    let cur: unknown = data;
    for (const part of attribute.split('.')) {
      const obj = cur as Record<string, unknown> | undefined;
      const k = obj && typeof obj === 'object' ? Object.keys(obj).find((x) => x.toLowerCase() === part.toLowerCase()) : undefined;
      cur = k === undefined ? undefined : obj![k];
    }
    value = cur;
  }
  key ??= attribute;
  const raws: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'string' && v.trim() !== '') raws.push(v.trim());
    else if (typeof v === 'number' || typeof v === 'boolean') raws.push(String(v));
  };
  walk(value);
  const entries = raws.map((raw): Entry => {
    const lk = linkTarget(raw);
    const hit = host.resolve(lk ? lk.target : raw, within);
    return { raw, path: hit ? hit.path : null };
  });
  return { key, entries, error: null };
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/** What an attribute holds after an edit: nothing (removed), one value, or a list. */
function valueOf(raws: string[], multiple: boolean): AttrValue | null {
  if (raws.length === 0) return null;
  return multiple ? raws : raws[0]!;
}

interface Attempt {
  retry?: boolean;
  result: RelationEditResult;
}

/** Make the change a person asked for in a relation cell. Answers `conflicts` (nothing written) until they are all resolved. */
export async function editRelation(host: RelationHost, rel: RelationDef, req: RelationEditRequest): Promise<RelationEditResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await tryEdit(host, rel, req, attempt === 1);
    if (!r.retry) return r.result;
  }
  return { ok: false, error: 'The pages changed on disk while this was being saved. Nothing was changed; try again.' };
}

async function tryEdit(host: RelationHost, rel: RelationDef, req: RelationEditRequest, lastTry: boolean): Promise<Attempt> {
  const forward = req.side === 'forward';
  const fail = (error: string): Attempt => ({ result: { ok: false, error } });
  if (!forward && !rel.backattribute) return fail(`The relation “${rel.name}” has no other side to edit.`);
  const selfAttr = forward ? rel.attribute : rel.backattribute!;
  const selfMultiple = forward ? rel.multiple !== false : rel.backmultiple !== false;
  const otherAttr = forward ? rel.backattribute : rel.attribute; // undefined: the other side is only worked out, not stored
  const otherMultiple = forward ? rel.backmultiple !== false : rel.multiple !== false;
  const targets = host.members(forward ? rel.to : rel.from);
  const resolutions: Record<string, RelationResolution> = req.resolutions ?? {};
  const pageRef = (path: string): RelationPage => host.describe(path);
  const within = (path: string): string | null => foreignParts(path)?.workspace ?? null;

  // this page
  const me = await host.read(req.page);
  if (!me.exists) return fail('This page has no file yet. Create the page first.');
  const mine = readEntries(me.text, selfAttr, host); // this page is always one of this workspace
  if (mine.error) return fail('The attributes of this page could not be read, so nothing was changed.');
  const old = unique(mine.entries.flatMap((e) => (e.path ? [e.path] : [])));

  let want = unique(req.values).filter((p) => p !== req.page);
  // a page of another workspace was found by the window in that workspace's own index; it cannot be checked from here
  for (const p of want) if (!targets.has(p) && !foreignParts(p)) return fail(`“${host.titleOf(p)}” is not one of the pages this relation can name.`);

  // answers of "skip": a link that was to be made is dropped, one that was to be removed stays
  const added0 = want.filter((p) => !old.includes(p));
  const removed0 = old.filter((p) => !want.includes(p));
  const kept: string[] = [];
  for (const [id, r] of Object.entries(resolutions)) {
    if (r !== 'skip') continue;
    const [kind, a, b] = id.split('\u0000');
    if (kind === 'taken' || kind === 'holder') want = want.filter((p) => p !== (kind === 'taken' ? a : b));
    else if (kind === 'unwritable' && a !== undefined) {
      if (added0.includes(a)) want = want.filter((p) => p !== a);
      else if (removed0.includes(a)) {
        want.push(a);
        kept.push(a);
      }
    }
  }
  if (!selfMultiple && want.length > 1) want = kept.length > 0 ? [kept[0]!] : [want[want.length - 1]!];
  const added = want.filter((p) => !old.includes(p));
  const removed = old.filter((p) => !want.includes(p));

  const conflicts: RelationConflict[] = [];
  const edits = new Map<string, { loaded: Loaded; text: string }>();
  const files = new Map<string, Loaded | string>();
  const load = async (path: string): Promise<Loaded | string> => {
    const have = files.get(path);
    if (have !== undefined) return have;
    const f = await host.read(path);
    let out: Loaded | string;
    if (!f.exists) out = 'it has no page file to keep the link in';
    else if (readEntries(f.text, otherAttr ?? selfAttr, host, within(path)).error) out = 'its attributes could not be read';
    else out = { path, text: f.text, hash: f.hash };
    files.set(path, out);
    return out;
  };
  const current = (path: string, loaded: Loaded): string => edits.get(path)?.text ?? loaded.text;
  const stage = (loaded: Loaded, text: string): void => void edits.set(loaded.path, { loaded, text });

  /** Take `target` out of attribute `attr` of the page `at`. False when that page cannot be changed. */
  const unlinkIn = async (at: string, attr: string, multiple: boolean, target: string, onProblem: (reason: string) => void): Promise<void> => {
    const f = await load(at);
    if (typeof f === 'string') return onProblem(f);
    const text = current(at, f);
    const r = readEntries(text, attr, host, within(at));
    if (!r.entries.some((e) => e.path === target)) return;
    const raws = r.entries.filter((e) => e.path !== target).map((e) => e.raw);
    stage(f, host.setValue(text, r.key, valueOf(raws, multiple)));
  };

  if (otherAttr) {
    for (const r of removed) {
      await unlinkIn(r, otherAttr, otherMultiple, req.page, (reason) => {
        const id = ['unwritable', r].join('\u0000');
        if (resolutions[id] !== 'one-sided') conflicts.push({ id, kind: 'unwritable', action: 'unlink', page: pageRef(r), reason });
      });
    }
    for (const t of added) {
      const f = await load(t);
      if (typeof f === 'string') {
        const id = ['unwritable', t].join('\u0000');
        if (resolutions[id] !== 'one-sided') conflicts.push({ id, kind: 'unwritable', action: 'link', page: pageRef(t), reason: f });
        continue;
      }
      const text = current(t, f);
      const there = readEntries(text, otherAttr, host, within(t));
      if (there.entries.some((e) => e.path === req.page)) continue;
      const link = host.linkFor(req.page, within(t));
      if (otherMultiple || there.entries.length === 0) {
        stage(f, host.setValue(text, there.key, valueOf([...there.entries.map((e) => e.raw), link], otherMultiple)));
        continue;
      }
      // the page has room for one page only, and it names another
      const holder = there.entries[0]!;
      const id = ['taken', t].join('\u0000');
      if (resolutions[id] !== 'replace') {
        conflicts.push({ id, kind: 'taken', action: 'link', page: pageRef(t), holder: { path: holder.path, title: holder.path ? host.titleOf(holder.path) : holder.raw } });
        continue;
      }
      stage(f, host.setValue(text, there.key, valueOf([link], false)));
      if (holder.path && holder.path !== req.page) {
        // the page that had it loses it: its own attribute stops naming t
        await unlinkIn(holder.path, selfAttr, selfMultiple, t, (reason) => {
          const hid = ['holder', holder.path!, t].join('\u0000');
          if (resolutions[hid] !== 'one-sided') conflicts.push({ id: hid, kind: 'unwritable', action: 'unlink', page: pageRef(holder.path!), reason });
        });
      }
    }
  }
  if (conflicts.length > 0) return { result: { ok: false, conflicts } };

  // this page's own attribute
  const keepRaw = (e: Entry): boolean => (selfMultiple ? e.path === null || want.includes(e.path) : false);
  const raws: string[] = [];
  const seen = new Set<string>();
  if (selfMultiple) {
    for (const e of mine.entries.filter(keepRaw)) {
      if (e.path) {
        if (seen.has(e.path)) continue;
        seen.add(e.path);
      }
      raws.push(e.raw);
    }
  } else if (want[0] !== undefined) {
    raws.push(mine.entries.find((e) => e.path === want[0])?.raw ?? host.linkFor(want[0]));
  }
  if (selfMultiple) for (const p of want) if (!seen.has(p)) raws.push(host.linkFor(p));
  const mineText = host.setValue(me.text, mine.key, valueOf(raws, selfMultiple));
  if (mineText !== me.text) stage({ path: req.page, text: me.text, hash: me.hash }, mineText);

  // write: the other pages first, this one last; one that fails puts the others back
  const order = [...edits.values()].filter((e) => e.loaded.path !== req.page).concat([...edits.values()].filter((e) => e.loaded.path === req.page));
  const done: Array<{ loaded: Loaded; written: string }> = [];
  for (const e of order) {
    if (e.text === e.loaded.text) continue;
    const w = await host.write(e.loaded.path, e.text, e.loaded.hash);
    if (w.ok) {
      done.push({ loaded: e.loaded, written: w.hash ?? '' });
      continue;
    }
    for (const d of done.reverse()) await host.write(d.loaded.path, d.loaded.text, d.written || null).catch(() => undefined);
    if (!w.conflict) return fail(`“${host.titleOf(e.loaded.path)}” could not be saved. Nothing was changed.`);
    if (!lastTry) return { retry: true, result: { ok: false, error: '' } };
    if (e.loaded.path === req.page) return fail('This page changed on disk. Nothing was changed; try again.');
    const id = ['unwritable', e.loaded.path].join('\u0000');
    return { result: { ok: false, conflicts: [{ id, kind: 'unwritable', action: added.includes(e.loaded.path) ? 'link' : 'unlink', page: pageRef(e.loaded.path), reason: 'it changed on disk while this was being saved' }] } };
  }
  return { result: { ok: true, changed: done.map((d) => d.loaded.path) } };
}
