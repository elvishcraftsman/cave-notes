/**
 * Pure path helpers. No filesystem access.
 *
 * A *page path* is a workspace-relative POSIX path ending in `.md`,
 * e.g. `Theology/Soteriology.md`. It identifies a page whether or not the
 * file exists (a "virtual" page is a folder without its `.md`).
 * The children of a page live in the folder named by the page path minus `.md`.
 */
import { posix, utf8Length } from '@cave-notes/platform';
import { TreeError } from './errors.js';

/** The default notes extension. A workspace can configure others with `configureNotes`. */
export const PAGE_EXT = '.md';
const MAX_EXT_BYTES = 16;
const MAX_NAME_BYTES = 255 - MAX_EXT_BYTES;

// Which files are notes. Each workspace runs in its own worker process, so this is process-wide state.
let NOTE_EXTS = [PAGE_EXT];
let DEFAULT_EXT = PAGE_EXT;

/** Normalize one extension: `TXT`, `.txt` and ` txt ` all become `.txt`. Returns null when it is not usable. */
export function cleanExt(e) {
  if (typeof e !== 'string') return null;
  const x = e.trim().toLowerCase().replace(/^\.+/, '');
  if (!x || !/^[a-z0-9][a-z0-9_-]*$/.test(x) || x.length > MAX_EXT_BYTES - 1) return null;
  return `.${x}`;
}

/**
 * Choose which file extensions are notes (the first one wins when two files share a stem) and which one new
 * notes get (`defaultExt`, which is added to the list when missing).
 */
export function configureNotes({ exts = [PAGE_EXT], defaultExt } = {}) {
  const list = [];
  for (const e of exts) {
    const c = cleanExt(e);
    if (c && !list.includes(c)) list.push(c);
  }
  const def = cleanExt(defaultExt) ?? list[0] ?? PAGE_EXT;
  if (!list.includes(def)) list.push(def);
  NOTE_EXTS = list;
  DEFAULT_EXT = def;
}

export const noteExtensions = () => [...NOTE_EXTS];
export const defaultNoteExt = () => DEFAULT_EXT;

/** The configured note extension a file name ends with (lower case), or null. Matching ignores case. */
export function noteExtOf(name) {
  const low = name.toLowerCase();
  let best = null;
  for (const e of NOTE_EXTS) if (low.endsWith(e) && low.length > e.length && (!best || e.length > best.length)) best = e;
  return best;
}

export const isNoteFile = (name) => noteExtOf(name) !== null;

/** The actual extension of a page path (keeps its case), e.g. `.md`. */
export function extOf(pagePath) {
  const e = noteExtOf(pagePath);
  return e ? pagePath.slice(pagePath.length - e.length) : DEFAULT_EXT;
}

const stripExt = (s) => {
  const e = noteExtOf(s);
  return e ? s.slice(0, -e.length) : s;
};

/** Validate and normalize a user-supplied page name (the stem, no extension). */
export function normalizeName(name) {
  if (typeof name !== 'string') {
    throw new TreeError('INVALID_NAME', 'Name must be a string');
  }
  let n = name.normalize('NFC').trim();
  n = stripExt(n).trim();
  if (!n) throw new TreeError('INVALID_NAME', 'Name cannot be empty');
  if (/[/\\\u0000-\u001f]/.test(n)) {
    throw new TreeError('INVALID_NAME', 'Name cannot contain slashes or control characters', { name });
  }
  if (n.startsWith('.')) {
    throw new TreeError('INVALID_NAME', 'Name cannot start with a dot', { name });
  }
  if (n.endsWith('.')) {
    throw new TreeError('INVALID_NAME', 'Name cannot end with a dot', { name });
  }
  if (utf8Length(n) > MAX_NAME_BYTES) {
    throw new TreeError('INVALID_NAME', 'Name is too long', { name });
  }
  return n;
}

/**
 * A file name made from a name a person typed (or a title): question marks are left out, and so is a trailing dot (the title
 * keeps both). Then the usual checks. What cannot become a name at all still throws.
 */
export function fileStem(name) {
  if (typeof name !== 'string') return normalizeName(name);
  const n = name.replace(/\?/g, '').trim().replace(/\.+$/, '').trim();
  return normalizeName(n);
}

/** Validate a page path. Returns it unchanged. Does not touch the filesystem. */
export function normalizePagePath(p) {
  if (typeof p !== 'string' || p === '') {
    throw new TreeError('INVALID_PATH', 'Page path must be a non-empty string', { path: p });
  }
  if (p.startsWith('/') || p.includes('\\') || p.includes('\u0000')) {
    throw new TreeError('INVALID_PATH', 'Page path must be relative and use "/" separators', { path: p });
  }
  if (!isNoteFile(p)) {
    throw new TreeError('INVALID_PATH', `Page path must end in ${NOTE_EXTS.join(', ')}`, { path: p });
  }
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || seg.startsWith('.')) {
      throw new TreeError('INVALID_PATH', 'Page path has an empty, relative, or hidden segment', { path: p });
    }
  }
  return p;
}

/** `A/B.md` -> `A/B` (the folder holding B's children). */
export function pageFolder(pagePath) {
  return stripExt(pagePath);
}

/** `A/B.md` -> `B` */
export function pageName(pagePath) {
  return posix.basename(stripExt(pagePath));
}

/**
 * `A/B/C.md` -> `A/B.md`; top-level pages have no parent (null). The parent gets the child's extension
 * unless `ext` says otherwise (the real parent may use another one: callers that know look it up).
 */
export function parentPage(pagePath, ext = extOf(pagePath)) {
  const dir = posix.dirname(pagePath);
  return dir === '.' ? null : dir + ext;
}

/** Build the path of a child named `name` under `parent` (null = workspace root). */
export function joinPage(parent, name, ext = DEFAULT_EXT) {
  return (parent === null ? '' : pageFolder(parent) + '/') + name + ext;
}

/** All ancestors, nearest first: `A/B/C.md` -> [`A/B.md`, `A.md`]. */
export function ancestors(pagePath) {
  const ext = extOf(pagePath);
  const out = [];
  for (let p = parentPage(pagePath, ext); p !== null; p = parentPage(p, ext)) out.push(p);
  return out;
}

/** True if `candidate` is `ancestor` itself or lives anywhere beneath it. */
export function isSelfOrDescendant(candidate, ancestor) {
  return candidate === ancestor || candidate.startsWith(pageFolder(ancestor) + '/');
}

/** Case- and Unicode-normalization-insensitive key for sibling collision checks. */
export function foldKey(name) {
  return name.normalize('NFC').toLowerCase();
}
