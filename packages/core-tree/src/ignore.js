// `.caveignore`: files, folders and workspaces Cave Notes should pretend are not there.
//
// A `.caveignore` file can sit in any folder. Its lines are patterns (the same idea as `.gitignore`), read relative to the
// folder that holds the file. The lines are read in order and, for any path, the LAST line that matches it decides:
//
//   # a comment               blank lines and lines starting with # do nothing
//   build                     a file or folder called "build", at any depth below this folder
//   *.psd                     `*` stands for any characters inside one name; `?` for one character
//   *.{md,txt}                {a,b} stands for either: all of those that end in .md or .txt
//   drafts/                   a trailing slash: folders only (`folder:drafts` says the same)
//   file:*                    `file:` at the start: files only (so `file:*` is every file, and no folder)
//   /archive                  a leading slash (or any slash in the middle): counted from this folder only
//   X/docs/.cave-notes        with `*` for X: one folder level, so the `.cave-notes` of any `docs` one level down
//   (two stars, slash) old    two stars cross folder levels: any "old" anywhere
//   !keep.md                  a line starting with ! brings back what an earlier line ignored (a `!` line can be
//                             followed by `file:` or `folder:` too)
//
// A folder that matches is ignored with everything in it, unless a later `!` line brings something in it back. So to keep
// only the notes of a folder: `attachments/**` (ignore everything in it), `!attachments/**/` (but not its folders, so the
// notes in them can be reached), `!attachments/**/*.{md,txt}` (and bring back the notes).
// A pattern that matches a `.cave-notes` folder only says that folder does not make a workspace: the folder around it
// stays an ordinary folder.
//
// The open workspace's own `.cave-notes` can never be ignored, and a scan for workspaces drops a line that would hide every
// workspace it finds (see `scanForWorkspaces`).
import { fs as fsp, path } from '@cave-notes/platform';

export const IGNORE_FILE = '.caveignore';

/** Escape a character for use in a regular expression. */
const esc = (c) => c.replace(/[.+^${}()|\\]/g, '\\$&');

/** Turn the glob of one line into a regular expression source (matching a whole relative path). */
function globSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` = any number of folders (also none); a trailing `/**` or a lone `**` = everything below
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) out += '\\[';
      else {
        const body = glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\');
        out += `[${body}]`;
        i = end;
      }
    } else if (c === '{') {
      const end = glob.indexOf('}', i + 1);
      if (end === -1) out += '\\{';
      else {
        // {a,b}: either one (each part may hold * and ?)
        out += `(?:${glob.slice(i + 1, end).split(',').map((part) => globSource(part)).join('|')})`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) {
      out += esc(glob[i + 1]);
      i += 1;
    } else out += esc(c);
  }
  return out;
}

/**
 * Read the text of one `.caveignore` file.
 * @returns {Array<{ line: string, number: number, negate: boolean, dirOnly: boolean, fileOnly: boolean, re: RegExp }>}
 */
export function parseIgnore(text) {
  const rules = [];
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) return;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    let dirOnly = false;
    let fileOnly = false;
    const kindPrefix = /^(file|folder):/i.exec(line);
    if (kindPrefix) {
      if (kindPrefix[1].toLowerCase() === 'file') fileOnly = true;
      else dirOnly = true;
      line = line.slice(kindPrefix[0].length);
    }
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.replace(/\/+$/, '');
    }
    if (!line) return;
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
    line = line.replace(/^\/+/, '');
    if (!line) return;
    const src = globSource(line);
    let re;
    try {
      re = new RegExp(anchored ? `^${src}$` : `(?:^|/)${src}$`);
    } catch {
      return; // a pattern that is not valid is skipped
    }
    rules.push({ line: raw.trim(), number: i + 1, negate, dirOnly, fileOnly, re });
  });
  return rules;
}

/**
 * The decision of a set of ignore files about one path.
 * Each step of the path (`a`, `a/b`, `a/b/c.md`) is judged by the last line that matches it; a step no line matches takes the
 * decision of the step before it. So a folder ignored by one line takes everything in it with it, and a later `!` line that
 * matches something inside brings it back.
 * @param {(dirRel: string) => Array<ReturnType<typeof parseIgnore>[number]> | null} rulesFor  the rules of the `.caveignore` in a folder
 * @param {string} rel   path relative to the root, with `/`
 * @param {boolean} isDir  whether `rel` is a folder
 * @param {Set<string>} [off]  lines (as "folder:number") that are switched off
 * @returns {{ ignored: boolean, by: string | null, reinclude: boolean }}  `by` names the line that ignores it, as "folder:number";
 *   `reinclude` says that some `!` line is in force, so something inside an ignored folder may still be wanted
 */
export function decide(rulesFor, rel, isDir, off) {
  const parts = rel.split('/');
  let ignored = false;
  let by = null;
  let reinclude = false;
  for (let n = 1; n <= parts.length; n++) {
    const stepIsDir = n < parts.length || isDir;
    let hit = null;
    let hitNegated = false;
    // ignore files from the root down to the folder that holds this step; a deeper file (or a later line) wins
    for (let d = 0; d < n; d++) {
      const dirRel = parts.slice(0, d).join('/');
      const rules = rulesFor(dirRel);
      if (!rules || rules.length === 0) continue;
      const sub = parts.slice(d, n).join('/');
      for (const r of rules) {
        if (off?.has(`${dirRel}:${r.number}`)) continue;
        if (r.negate) reinclude = true;
        if (r.dirOnly && !stepIsDir) continue;
        if (r.fileOnly && stepIsDir) continue;
        if (r.re.test(sub)) {
          hit = `${dirRel}:${r.number}`;
          hitNegated = r.negate;
        }
      }
    }
    if (hit) {
      ignored = !hitNegated;
      by = hitNegated ? null : hit;
    }
  }
  return { ignored, by, reinclude };
}

/**
 * Ignore rules of a folder tree, read from disk when first needed and kept until `reset()`.
 * @param {string} root  absolute folder
 * @param {object} [options]
 * @param {Set<string>} [options.off]  lines to leave out, as "folder:number"
 * @param {object} [options.fs]  file system overrides
 */
export function createIgnore(root, options = {}) {
  const fs = { ...fsp, ...(options.fs ?? {}) };
  const off = options.off ?? new Set();
  const cache = new Map(); // dirRel -> rules | null
  const abs = (dirRel) => (dirRel === '' ? root : path.join(root, ...dirRel.split('/')));

  async function load(dirRel) {
    if (cache.has(dirRel)) return cache.get(dirRel);
    let rules = null;
    try {
      const text = await fs.readFile(path.join(abs(dirRel), IGNORE_FILE), 'utf8');
      rules = parseIgnore(text);
    } catch {
      rules = null; // no file, or not readable: nothing is ignored
    }
    cache.set(dirRel, rules);
    return rules;
  }

  /** Whether `rel` (a path under the root) is ignored. */
  async function check(rel, isDir = false) {
    const clean = String(rel).replace(/^\/+|\/+$/g, '');
    if (!clean) return { ignored: false, by: null, reinclude: false };
    const parts = clean.split('/');
    for (let d = 0; d < parts.length; d++) await load(parts.slice(0, d).join('/'));
    return decide((dirRel) => cache.get(dirRel) ?? null, clean, isDir, off);
  }

  return {
    /** @returns {Promise<boolean>} */
    isIgnored: async (rel, isDir = false) => (await check(rel, isDir)).ignored,
    /** Whether a walk can leave this folder out altogether: it is ignored and no `!` line could bring anything in it back. */
    skipDir: async (rel) => {
      const r = await check(rel, true);
      return r.ignored && !r.reinclude;
    },
    check,
    /** Forget what was read (a `.caveignore` changed). */
    reset: () => cache.clear(),
    /** Every line of the ignore files read so far, as "folder:number" -> text. */
    lines: () => {
      const out = new Map();
      for (const [dirRel, rules] of cache) for (const r of rules ?? []) out.set(`${dirRel}:${r.number}`, r.line);
      return out;
    },
  };
}

/** The same, for code that cannot wait (the file watcher decides inside a callback). Reads with the given sync function. */
export function createIgnoreSync(root, readFileSync, options = {}) {
  const off = options.off ?? new Set();
  const cache = new Map();
  const abs = (dirRel) => (dirRel === '' ? root : path.join(root, ...dirRel.split('/')));
  const load = (dirRel) => {
    if (cache.has(dirRel)) return cache.get(dirRel);
    let rules = null;
    try {
      rules = parseIgnore(readFileSync(path.join(abs(dirRel), IGNORE_FILE), 'utf8'));
    } catch {
      rules = null;
    }
    cache.set(dirRel, rules);
    return rules;
  };
  return {
    isIgnored(rel, isDir = false) {
      const clean = String(rel).replace(/^\/+|\/+$/g, '');
      if (!clean) return false;
      return decide(load, clean, isDir, off).ignored;
    },
    skipDir(rel) {
      const clean = String(rel).replace(/^\/+|\/+$/g, '');
      if (!clean) return false;
      const r = decide(load, clean, true, off);
      return r.ignored && !r.reinclude;
    },
    reset: () => cache.clear(),
  };
}
