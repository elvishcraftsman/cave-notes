import { fs as fsp, path } from '@cave-notes/platform';
import { TreeError } from './errors.js';
import { createIgnore } from './ignore.js';
import {
  noteExtensions,
  noteExtOf,
  defaultNoteExt,
  normalizeName,
  fileStem,
  normalizePagePath,
  pageFolder,
  pageName,
  parentPage,
  joinPage,
  isSelfOrDescendant,
  foldKey,
  extOf,
} from './paths.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isMissing = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

/**
 * Open a workspace.
 *
 * @param {string} rootDir
 * @param {object} [options]
 * @param {string[]} [options.ignore]   Folder/page names (stems) hidden at every level, e.g. ['assets'].
 * @param {(pagePath: string) => number|undefined} [options.orderOf]
 *        Sync lookup for a page's frontmatter `order`. Pages with an order sort first.
 * @param {string} [options.workspaceDir]  Name of the folder that marks a workspace (default `.cave-notes`). A sub-folder that
 *        holds one is a separate workspace: its pages are not part of this tree (see `workspaces` in listChildren).
 * @param {string[]} [options.only]     Show only these top-level page files (e.g. ['Notes.md']) and nothing below them
 *        (single-file mode: one Markdown file opened on its own).
 * @param {object} [options.fs]         Overrides for fs/promises methods (used by tests to inject failures).
 */
export function openTree(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const fs = { ...fsp, ...(options.fs ?? {}) };
  const ignore = new Set((options.ignore ?? []).map((n) => n.normalize('NFC')));
  const orderOf = options.orderOf ?? (() => undefined);
  const workspaceDir = options.workspaceDir ?? '.cave-notes';
  const only = options.only ? new Set(options.only.map((n) => n.normalize('NFC'))) : null;
  /** Sync tools leave copies like `Grace.sync-conflict-20260101-120000-ABCDEFG.md` next to a page; they are not pages. */
  const isConflictCopy = (name) => /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^./]+)?$/.test(name);

  const abs = (rel) => (rel === '' ? root : path.join(root, ...rel.split('/')));
  // `.caveignore` files: what they list is not here (not in the tree, not indexed). Not used in single-file mode.
  const ignoreRules = only || options.caveIgnore === false ? null : createIgnore(root, { fs: options.fs });
  const isIgnored = async (rel, isDir) => (ignoreRules ? ignoreRules.isIgnored(rel, isDir) : false);
  const isHiddenStem = (stem) => stem.startsWith('.') || ignore.has(stem.normalize('NFC'));

  // Mutating operations run one at a time so they can't interleave.
  let chain = Promise.resolve();
  const serialize = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  /** normalizePagePath + reject paths that go through an ignored folder. */
  function validPage(p) {
    normalizePagePath(p);
    for (const seg of p.split('/')) {
      const e = noteExtOf(seg);
      const stem = e ? seg.slice(0, -e.length) : seg;
      if (ignore.has(stem.normalize('NFC'))) {
        throw new TreeError('INVALID_PATH', `"${stem}" is an ignored name`, { path: p });
      }
    }
    return p;
  }

  function assertNotIgnored(stem) {
    if (ignore.has(stem.normalize('NFC'))) {
      throw new TreeError('INVALID_NAME', `"${stem}" is reserved`, { name: stem });
    }
  }

  async function isDir(rel) {
    try {
      return (await fs.lstat(abs(rel))).isDirectory();
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  }

  /** True when the folder is the root of another workspace (it holds a `.cave-notes` folder). */
  async function isWorkspaceDir(rel) {
    if (!workspaceDir) return false;
    try {
      if (!(await fs.lstat(path.join(abs(rel), workspaceDir))).isDirectory()) return false;
      // a `.caveignore` line can say that this `.cave-notes` does not make a workspace
      return !(await isIgnored(rel === '' ? workspaceDir : `${rel}/${workspaceDir}`, true));
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  }

  /**
   * Visible entries of a directory, merged by stem: Foo.md and Foo/ become one record.
   * A folder that is another workspace never gets children here. With `workspaces`, one without a page file is
   * still listed (flagged `workspace`); otherwise it is left out.
   * A folder with no page file and no notes in it (a folder of images, say) is a page of the hierarchy like any other,
   * unless `bare` is false: then it is left out.
   */
  async function readEntries(dirRel, workspaces = false, bare = true) {
    let dirents;
    try {
      dirents = await fs.readdir(abs(dirRel), { withFileTypes: true });
    } catch (e) {
      if (isMissing(e)) return new Map();
      throw e;
    }
    const order = noteExtensions();
    const out = new Map();
    for (const d of dirents) {
      if (d.isSymbolicLink()) continue; // avoid cycles and escaping the workspace
      if (isConflictCopy(d.name)) continue;
      if (only && (dirRel !== '' || !only.has(d.name.normalize('NFC')) || !d.isFile())) continue;
      let stem;
      let kind;
      let ext = null;
      if (d.isFile() && noteExtOf(d.name)) {
        ext = d.name.slice(d.name.length - noteExtOf(d.name).length);
        stem = d.name.slice(0, -ext.length);
        kind = 'md';
      } else if (d.isDirectory()) {
        stem = d.name;
        kind = 'dir';
      } else {
        continue;
      }
      if (!stem || isHiddenStem(stem)) continue;
      // Ignored by a `.caveignore`: gone, except a folder that a later `!` line may bring something back from. That one is
      // looked into (and left out below if nothing in it is wanted).
      let ghost = false;
      if (ignoreRules) {
        const info = await ignoreRules.check(dirRel === '' ? d.name : `${dirRel}/${d.name}`, d.isDirectory());
        if (info.ignored) {
          if (!d.isDirectory() || !info.reinclude) continue;
          ghost = true;
        }
      }
      const rec = out.get(stem) ?? { name: stem, hasMd: false, hasDir: false, ext: null, workspace: false };
      if (ghost) rec.ghost = true;
      if (kind === 'md') {
        // two files with one stem (Foo.md, Foo.txt): the extension listed first wins
        if (!rec.hasMd || order.indexOf(ext.toLowerCase()) < order.indexOf(rec.ext.toLowerCase())) rec.ext = ext;
        rec.hasMd = true;
      } else {
        rec.hasDir = true;
        if (!ghost) rec.ghost = false;
        if (!only && (await isWorkspaceDir(dirRel === '' ? stem : `${dirRel}/${stem}`))) rec.workspace = true;
      }
      out.set(stem, rec);
    }
    for (const [stem, rec] of [...out]) {
      if (rec.workspace) {
        rec.hasDir = false; // its contents belong to the other workspace
        if (!rec.hasMd && !workspaces) out.delete(stem);
      }
    }
    // a folder that is only here because a `.caveignore` line brings something back from it: only if it holds something
    for (const [stem, rec] of [...out]) {
      if (!rec.ghost) continue;
      const inner = await readEntries(dirRel === '' ? stem : `${dirRel}/${stem}`, workspaces, false);
      if (inner.size === 0) out.delete(stem);
    }
    // A folder with no page file of its own is a (virtual) page. Without `bare`, only those that hold pages or folders of
    // pages count: a folder of attachments alone (images, PDFs) is then left out.
    if (!bare) {
      for (const [stem, rec] of [...out]) {
        if (rec.hasMd || !rec.hasDir) continue;
        const inner = await readEntries(dirRel === '' ? stem : `${dirRel}/${stem}`, workspaces, false);
        if (inner.size === 0) out.delete(stem);
      }
    }
    return out;
  }

  const compare = (a, b) => {
    const oa = orderOf(a.path);
    const ob = orderOf(b.path);
    const ha = typeof oa === 'number' && !Number.isNaN(oa);
    const hb = typeof ob === 'number' && !Number.isNaN(ob);
    if (ha && hb && oa !== ob) return oa - ob;
    if (ha !== hb) return ha ? -1 : 1;
    return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  };

  /**
   * Children of a page (null = workspace root), sorted.
   * Each item: { path, name, exists, hasFolder, hasChildren }.
   * `exists: false` means a virtual page (folder without its .md).
   */
  async function listChildren(parent = null, { withChildFlag = true, workspaces = false, bareFolders = true } = {}) {
    const parentPath = parent === null ? null : validPage(parent);
    const dirRel = parentPath === null ? '' : pageFolder(parentPath);
    const entries = await readEntries(dirRel, workspaces, bareFolders);
    const items = [...entries.values()].map((e) => ({
      path: joinPage(parentPath, e.name, e.ext ?? defaultNoteExt()),
      name: e.name,
      exists: e.hasMd,
      hasFolder: e.hasDir,
      hasChildren: e.hasDir,
      ...(e.workspace ? { workspace: true } : {}),
    }));
    if (withChildFlag) {
      await Promise.all(
        items.map(async (it) => {
          if (it.hasFolder) it.hasChildren = (await readEntries(pageFolder(it.path), workspaces, bareFolders)).size > 0;
        }),
      );
    }
    return items.sort(compare);
  }

  /** Depth-first walk of every page in tree order. */
  async function* allPages(parent = null) {
    for (const child of await listChildren(parent, { withChildFlag: false })) {
      yield child;
      if (child.hasFolder) yield* allPages(child.path);
    }
  }

  /** All pages beneath `pagePath` (not including it): [{ path, exists }]. */
  async function descendants(pagePath) {
    const out = [];
    for await (const p of allPages(validPage(pagePath))) out.push({ path: p.path, exists: p.exists });
    return out;
  }

  /** 'page' (file exists), 'virtual' (only the folder exists), or null. */
  async function status(pagePath) {
    const p = validPage(pagePath);
    try {
      if ((await fs.lstat(abs(p))).isFile()) return 'page';
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    return (await isDir(pageFolder(p))) ? 'virtual' : null;
  }

  /**
   * Throw COLLISION if `name` clashes (case-insensitively) with an existing sibling in `dirRel`.
   * `allowPromotion`: an exact-name folder with no .md is allowed (the new page becomes its page).
   * `skipEntries`: raw directory entry names to ignore (the page being renamed itself).
   */
  async function assertFree(dirRel, name, { allowPromotion = false, skipEntries = new Set() } = {}) {
    let dirents;
    try {
      dirents = await fs.readdir(abs(dirRel), { withFileTypes: true });
    } catch (e) {
      if (isMissing(e)) return;
      throw e;
    }
    const key = foldKey(name);
    for (const d of dirents) {
      if (skipEntries.has(d.name)) continue;
      let stem;
      if (d.isFile() && noteExtOf(d.name)) stem = d.name.slice(0, -noteExtOf(d.name).length);
      else if (d.isDirectory() || d.isSymbolicLink()) stem = d.name;
      else continue;
      if (foldKey(stem) !== key) continue;
      if (allowPromotion && d.isDirectory() && d.name === name) continue;
      throw new TreeError('COLLISION', `"${stem}" already exists in this location`, { name: stem });
    }
  }

  /** Remove a page's folder if it is empty and the page file exists. */
  async function pruneIfEmpty(pagePath) {
    if ((await status(pagePath)) !== 'page') return;
    const folder = abs(pageFolder(pagePath));
    try {
      if ((await fs.readdir(folder)).length === 0) await fs.rmdir(folder);
    } catch (e) {
      if (!isMissing(e) && e.code !== 'ENOTEMPTY') throw e;
    }
  }

  async function subtreeOf(pagePath, st) {
    return [{ path: pagePath, exists: st === 'page' }, ...(await descendants(pagePath))];
  }

  /**
   * Create a page under `parent` (null = workspace root). The parent's folder is created lazily.
   * If a folder with this name already exists without a page file, it becomes the page's folder.
   * Returns the new page path.
   */
  const createPage = (parent, name, content = '', ext = defaultNoteExt()) =>
    serialize(async () => {
      const stem = fileStem(name);
      assertNotIgnored(stem);
      const parentPath = parent === null ? null : validPage(parent);
      if (parentPath !== null && (await status(parentPath)) === null) {
        throw new TreeError('NOT_FOUND', `Parent page not found: ${parentPath}`, { path: parentPath });
      }
      const dirRel = parentPath === null ? '' : pageFolder(parentPath);
      await assertFree(dirRel, stem, { allowPromotion: true });
      await fs.mkdir(abs(dirRel), { recursive: true });
      const target = joinPage(parentPath, stem, ext);
      try {
        await fs.writeFile(abs(target), content, { flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') throw new TreeError('EXISTS', `Page already exists: ${target}`, { path: target });
        throw e;
      }
      return target;
    });

  /** Turn a virtual page (folder only) into a real one by creating its .md. */
  const promoteVirtual = (pagePath, content = '') =>
    serialize(async () => {
      const p = validPage(pagePath);
      const st = await status(p);
      if (st === null) throw new TreeError('NOT_FOUND', `Page not found: ${p}`, { path: p });
      if (st === 'page') throw new TreeError('EXISTS', `Page already exists: ${p}`, { path: p });
      try {
        await fs.writeFile(abs(p), content, { flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') throw new TreeError('EXISTS', `Page already exists: ${p}`, { path: p });
        throw e;
      }
      return p;
    });

  /**
   * Validate a move and describe it without touching the disk.
   * Throws the same errors movePage would (NOT_FOUND, MOVE_INTO_SELF, COLLISION, ...).
   */
  async function prepareMove(from, newParent, newName) {
    const src = validPage(from);
    const srcStatus = await status(src);
    if (srcStatus === null) throw new TreeError('NOT_FOUND', `Page not found: ${src}`, { path: src });

    const stem = newName === undefined ? pageName(src) : fileStem(newName);
    assertNotIgnored(stem);

    const dstParent = newParent === null ? null : validPage(newParent);
    if (dstParent !== null) {
      if (isSelfOrDescendant(dstParent, src)) {
        throw new TreeError('MOVE_INTO_SELF', 'Cannot move a page into itself or its descendants', {
          from: src,
          to: dstParent,
        });
      }
      if ((await status(dstParent)) === null) {
        throw new TreeError('NOT_FOUND', `Destination parent not found: ${dstParent}`, { path: dstParent });
      }
    }

    const dst = joinPage(dstParent, stem, extOf(src));
    if (dst === src) return { noop: true, src, dst, pageMoves: [] };

    const srcFolder = pageFolder(src);
    const dstFolder = pageFolder(dst);
    const hasFolder = await isDir(srcFolder);
    const srcDir = path.posix.dirname(src) === '.' ? '' : path.posix.dirname(src);
    const dstDir = dstParent === null ? '' : pageFolder(dstParent);

    // Same-directory rename: the page's own entries must not count as collisions
    // (this is what makes case-only renames like foo -> Foo work).
    const skip =
      srcDir === dstDir ? new Set([path.posix.basename(src), path.posix.basename(srcFolder)]) : new Set();
    await assertFree(dstDir, stem, { allowPromotion: !hasFolder, skipEntries: skip });

    const subtree = await subtreeOf(src, srcStatus);
    const pageMoves = subtree.map((s) => ({
      from: s.path,
      to: s.path === src ? dst : dstFolder + '/' + s.path.slice(srcFolder.length + 1),
      exists: s.exists,
    }));
    return { noop: false, src, dst, srcStatus, srcFolder, dstFolder, hasFolder, dstParent, dstDir, pageMoves };
  }

  /** What movePage(from, newParent, newName) would do: { from, to, pageMoves }. Nothing is changed. */
  const planMove = async (from, newParent, newName) => {
    const m = await prepareMove(from, newParent, newName);
    return { from: m.src, to: m.dst, pageMoves: m.pageMoves };
  };

  /** What renamePage(pagePath, newName) would do. */
  const planRename = (pagePath, newName) => planMove(pagePath, parentPage(validPage(pagePath)), newName);

  /**
   * Move a page (and its folder) under `newParent` (null = root), optionally renaming it.
   * Returns { from, to, pageMoves: [{ from, to, exists }] } covering the page and every descendant,
   * which is what an indexer or link rewriter needs. Either everything moves or nothing does.
   */
  const movePage = (from, newParent, newName) =>
    serialize(async () => {
      const m = await prepareMove(from, newParent, newName);
      if (m.noop) return { from: m.src, to: m.dst, pageMoves: [] };
      const { src, dst, srcStatus, srcFolder, dstFolder, hasFolder, dstParent, dstDir } = m;

      let createdDir = null;
      if (dstParent !== null && !(await isDir(dstDir))) {
        await fs.mkdir(abs(dstDir));
        createdDir = dstDir;
      }

      const ops = [];
      if (srcStatus === 'page') ops.push([src, dst]);
      if (hasFolder) ops.push([srcFolder, dstFolder]);

      const done = [];
      try {
        for (const [a, b] of ops) {
          await fs.rename(abs(a), abs(b));
          done.push([a, b]);
        }
      } catch (cause) {
        for (const [a, b] of done.reverse()) {
          try {
            await fs.rename(abs(b), abs(a));
          } catch {
            /* best effort */
          }
        }
        if (createdDir !== null) {
          try {
            await fs.rmdir(abs(createdDir));
          } catch {
            /* best effort */
          }
        }
        throw new TreeError('IO_ERROR', `Move failed and was rolled back: ${cause.message}`, { cause });
      }

      const oldParent = parentPage(src);
      if (oldParent !== null) await pruneIfEmpty(oldParent);

      return { from: src, to: dst, pageMoves: m.pageMoves };
    });

  /** Rename a page in place (same parent). */
  const renamePage = (pagePath, newName) => movePage(pagePath, parentPage(validPage(pagePath)), newName);

  /**
   * Delete a page. If it has anything inside its folder, `recursive: true` is required.
   * Returns { removed: [{ path, exists }] } covering the page and every descendant.
   * (The app should confirm first, and may prefer to move things to the trash instead.)
   */
  const deletePage = (pagePath, { recursive = false } = {}) =>
    serialize(async () => {
      const p = validPage(pagePath);
      const st = await status(p);
      if (st === null) throw new TreeError('NOT_FOUND', `Page not found: ${p}`, { path: p });
      const folderRel = pageFolder(p);
      const hasFolder = await isDir(folderRel);

      if (hasFolder && !recursive && (await fs.readdir(abs(folderRel))).length > 0) {
        throw new TreeError('HAS_CHILDREN', `${p} has children; pass recursive: true to delete them too`, {
          path: p,
        });
      }

      const removed = await subtreeOf(p, st);
      if (st === 'page') await fs.rm(abs(p));
      if (hasFolder) await fs.rm(abs(folderRel), { recursive: true, force: true });

      const parent = parentPage(p);
      if (parent !== null) await pruneIfEmpty(parent);
      return { removed };
    });

  return {
    root,
    listChildren,
    isWorkspaceDir,
    /** Whether a `.caveignore` hides this path (relative to the workspace root; `isDir` for a folder). */
    isIgnored,
    /** Whether a walk can leave this folder out: it is ignored and no `!` line could bring something in it back. */
    skipDir: async (rel) => (ignoreRules ? ignoreRules.skipDir(rel) : false),
    /** A `.caveignore` changed: read them again. */
    reloadIgnore: () => ignoreRules?.reset(),
    allPages,
    descendants,
    status,
    createPage,
    promoteVirtual,
    planMove,
    planRename,
    movePage,
    renamePage,
    deletePage,
  };
}
