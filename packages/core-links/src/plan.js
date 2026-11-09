import { fs, path, posix, sha1 as platformSha1, randomHex, utf8Bytes, utf8Text, bytesEqual } from '@cave-notes/platform';
import { parse, parseCanvasFile, jsonEscape } from '@cave-notes/core-md';
import { buildLookup, resolvePageLink, pageByStem } from '@cave-notes/core-index';
import { pageName, pageFolder, parentPage, noteExtOf } from '@cave-notes/core-tree';
import { makeMapper, dirOf, encodeLinkPath, relativeLink } from './paths.js';
import { LinksError } from './errors.js';

export const sha1 = platformSha1;

const lookupOf = (rows) => ({ ...buildLookup(rows), byId: new Map(rows.map((r) => [r.id, r])) });

function emptyPlan(tree, move) {
  return {
    id: newId(),
    noop: true,
    root: tree.root,
    createdAt: new Date().toISOString(),
    move: { from: move.from, to: move.to },
    pageMoves: [],
    files: [],
    warnings: [],
    summary: { pagesMoved: 0, filesEdited: 0, linksRewritten: 0, warnings: 0 },
  };
}

export function newId() {
  return `${Date.now().toString(36)}-${randomHex(3)}`;
}

/**
 * Plan moving (or renaming) a page and its subtree, including every link edit it requires.
 * Nothing on disk is changed. The result is plain JSON: show it as a preview, then pass it to applyPlan.
 *
 * @param {object} o
 * @param {object} o.tree        a core-tree instance
 * @param {object} o.index       a core-index instance for the same workspace
 * @param {string} o.from        page path to move
 * @param {string|null} [o.newParent]  new parent page (null = workspace root)
 * @param {string} [o.newName]   new file name (stem); omit to keep the current name
 * @param {boolean} [o.reconcile=true]  rescan the whole workspace first. Pass false when a file watcher
 *        keeps the index current: every page the plan reads is still checked against the index.
 * @param {(message: string) => void} [o.onStep]  told what the planner is doing and how long each step took
 *        (for a log; nothing is logged here so the package stays free of any logger)
 */
export async function planMove({ tree, index, from, newParent = null, newName, reconcile = true, onStep }) {
  const step = onStep ?? (() => {});
  const t0 = performance.now();
  const ms = (t) => Math.round(performance.now() - t);
  step(`plan: from=${from} newParent=${newParent ?? '(top level)'}${newName === undefined ? '' : ` newName=${newName}`} reconcile=${reconcile}`);
  const move = await tree.planMove(from, newParent, newName);
  const withFiles = move.pageMoves.filter((m) => m.exists).length;
  step(`plan: tree check done in ${ms(t0)} ms: ${move.from} -> ${move.to}, ${move.pageMoves.length} entr${move.pageMoves.length === 1 ? 'y' : 'ies'} in the subtree (${withFiles} with a file, ${move.pageMoves.length - withFiles} folder-only)`);
  if (move.pageMoves.length === 0) {
    step('plan: nothing to move (same place)');
    return emptyPlan(tree, move);
  }

  // The index is only a cache: bring it up to date, and if any page we need to read has
  // changed behind its back, refresh and start over (at most a few times).
  for (let attempt = 0; attempt < 3; attempt++) {
    const ta = performance.now();
    if (reconcile || attempt > 0) {
      step(`plan: attempt ${attempt + 1}: reconciling the index with the disk`);
      await index.reconcile();
      step(`plan: attempt ${attempt + 1}: reconcile took ${ms(ta)} ms`);
    }
    const plan = await tryPlan({ tree, index, move, step, attempt: attempt + 1 });
    if (plan) {
      step(`plan: done in ${ms(t0)} ms: ${plan.summary.filesEdited} file(s) to edit, ${plan.summary.linksRewritten} link(s) to rewrite, ${plan.summary.warnings} warning(s)`);
      return plan;
    }
    step(`plan: attempt ${attempt + 1} found files changed behind the index (${ms(ta)} ms); starting over`);
  }
  step(`plan: gave up after 3 attempts (${ms(t0)} ms): files kept changing`);
  throw new LinksError('STALE', 'Files kept changing while planning; try again');
}

/** planMove for an in-place rename (same parent, new name). */
export function planRename({ tree, index, page, newName, reconcile, onStep }) {
  return planMove({ tree, index, from: page, newParent: parentPage(page), newName, reconcile, onStep });
}

async function tryPlan({ tree, index, move, step = () => {}, attempt = 1 }) {
  const tStart = performance.now();
  const ms = (t) => Math.round(performance.now() - t);
  const root = tree.root;
  const mapPath = makeMapper(move.from, move.to);
  const movedFrom = new Set(move.pageMoves.map((m) => m.from));

  const rows = index.allPageRows();
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const beforeLookup = lookupOf(rows);
  const afterRows = rows.map((r) => {
    const np = mapPath(r.path);
    if (np === r.path) return r;
    const name = pageName(np);
    return { ...r, path: np, name, title: r.parsedTitle ?? name };
  });
  const afterLookup = lookupOf(afterRows);
  step(`plan: attempt ${attempt}: ${rows.length} page row(s) in the index, lookups built in ${ms(tStart)} ms`);

  // Which pages might have links that need changing?
  const names = [];
  for (const r of rows) {
    if (!movedFrom.has(r.path)) continue;
    // Old names (links that point at it) and new names (links elsewhere it might start to capture).
    const a = afterLookup.byId.get(r.id);
    names.push(r.name, r.title, a.name, a.title, ...r.aliases);
  }
  const candidates = new Set(
    index.findLinkers({ paths: [...movedFrom], folderPrefix: `${pageFolder(move.from)}/`, names }),
  );
  for (const m of move.pageMoves) if (m.exists) candidates.add(m.from);
  step(`plan: attempt ${attempt}: ${candidates.size} file(s) might need link changes (${names.length} name(s) searched, ${ms(tStart)} ms so far)`);

  const files = [];
  const warnings = [];
  let linksRewritten = 0;
  let needRefresh = false;

  let read = 0;
  let stale = 0;
  for (const X of [...candidates].sort()) {
    const row = byPath.get(X);
    if (!row || row.isVirtual) continue;

    const tf = performance.now();
    let buf;
    step(`plan: [${read + stale + 1}/${candidates.size}] reading ${X}`);
    try {
      buf = await fs.readFile(path.join(root, ...X.split('/')));
    } catch (e) {
      if (e.code === 'ENOENT') {
        step(`plan: ${X} is in the index but gone from the disk; skipped`);
        continue;
      }
      step(`plan: reading ${X} failed: ${e.code ?? ''} ${e.message}`);
      throw e;
    }
    read++;
    step(`plan: ${X}: read ${buf.length} bytes in ${ms(tf)} ms`);
    const hash = sha1(buf);
    if (index.pageHash(X) !== hash) {
      stale++;
      step(`plan: ${X} differs from the index (disk ${hash.slice(0, 8)}, index ${String(index.pageHash(X) ?? 'none').slice(0, 8)}); refreshing it`);
      await index.refresh([X]);
      needRefresh = true;
      continue;
    }
    if (needRefresh) continue; // we will start over anyway
    // The hash matches the index, and the index found no links in this file: nothing to rewrite.
    // (Parsing a huge plain-text file as Markdown can take minutes and blocks the whole workspace.)
    if (index.linkCount?.(X) === 0) {
      step(`plan: ${X}: the index holds no links for it; not parsing`);
      continue;
    }
    const text = utf8Text(buf);
    if (!bytesEqual(utf8Bytes(text), buf)) {
      warnings.push({ file: X, line: null, message: 'File is not valid UTF-8; its links were left untouched' });
      step(`plan: ${X} is not valid UTF-8; its links are left untouched`);
      continue;
    }

    step(`plan: ${X}: parsing`);
    const tp = performance.now();
    // a canvas is JSON: its file cards are rewritten in place (the new path escaped as JSON), not as Markdown links
    const isCanvas = /\.canvas$/i.test(X);
    const parsed = isCanvas ? parseCanvasFile(text) : parse(text);
    step(`plan: ${X}: parsed in ${ms(tp)} ms, ${parsed.links.length} link(s); computing edits`);
    const forText = (p) => editsFor({ X, X2: mapPath(X), text, row, parsed: p, mapPath, byPath, beforeLookup, afterLookup });
    let edits, w;
    if (isCanvas) {
      // file cards by their path; wikilinks in text cards as in any page, the new text then escaped to sit inside a JSON string
      const files = canvasEdits({ text, parsed, mapPath });
      const wikis = forText({ ...parsed, links: parsed.links.filter((l) => l.syntax === 'wiki') });
      edits = [...files.edits, ...wikis.edits.map((e) => ({ ...e, newText: jsonEscape(e.newText) }))].sort((p, q) => p.start - q.start);
      w = [...files.warnings, ...wikis.warnings];
    } else ({ edits, warnings: w } = forText(parsed));
    step(`plan: ${X}: edits computed (${ms(tf)} ms so far)`);
    warnings.push(...w);
    if (edits.length) {
      linksRewritten += edits.length;
      files.push({ path: X, newPath: mapPath(X), sourceHash: hash, edits });
      step(`plan: ${X}: ${edits.length} link edit(s), ${w.length} warning(s) (${ms(tf)} ms, ${buf.length} bytes)`);
    } else if (w.length) {
      step(`plan: ${X}: no edits, ${w.length} warning(s): ${w.map((x) => x.message).join(' | ')}`);
    }
    if (ms(tf) >= 250) step(`plan: ${X} was slow to process: ${ms(tf)} ms (${buf.length} bytes)`);
  }
  step(`plan: attempt ${attempt}: read ${read} file(s), ${stale} out of date, ${files.length} to edit, ${ms(tStart)} ms in all`);
  if (needRefresh) return null;

  return {
    id: newId(),
    noop: false,
    root,
    createdAt: new Date().toISOString(),
    move: { from: move.from, to: move.to },
    pageMoves: move.pageMoves,
    files,
    warnings,
    summary: { pagesMoved: move.pageMoves.length, filesEdited: files.length, linksRewritten, warnings: warnings.length },
  };
}

/** The edits a canvas needs: each file card whose page or file moved shows the new path. */
function canvasEdits({ text, parsed, mapPath }) {
  const edits = [];
  for (const link of parsed.links) {
    if (link.syntax !== 'md' || link.pathStart === null || (link.kind !== 'page' && link.kind !== 'file')) continue;
    const oldTarget = posix.normalize(link.raw);
    const newTarget = mapPath(oldTarget);
    if (newTarget === oldTarget) continue;
    edits.push({ start: link.pathStart, end: link.pathEnd, line: link.line, column: link.column, oldText: text.slice(link.pathStart, link.pathEnd), newText: jsonEscape(newTarget), kind: 'canvas' });
  }
  return { edits, warnings: [] };
}

/** All link edits needed in one file. */
function editsFor({ X, X2, text, row, parsed, mapPath, byPath, beforeLookup, afterLookup }) {
  const edits = new Map(); // span -> edit (reference-style links share a definition)
  const warnings = [];
  const selfAfter = afterLookup.byId.get(row.id);

  const push = (link, newText, kind) => {
    const key = `${link.pathStart}:${link.pathEnd}`;
    const oldText = text.slice(link.pathStart, link.pathEnd);
    if (oldText === newText) return;
    const prior = edits.get(key);
    if (prior) {
      if (prior.newText !== newText) {
        warnings.push({ file: X, line: link.line, message: `Conflicting rewrites for one link destination; left as is` });
        edits.delete(key);
        edits.set(key, { ...prior, conflict: true });
      }
      return;
    }
    edits.set(key, { start: link.pathStart, end: link.pathEnd, line: link.line, column: link.column, oldText, newText, kind });
  };

  for (const link of parsed.links) {
    if (link.pathStart === null) continue;

    if (link.syntax === 'md') {
      if (link.kind !== 'page' && link.kind !== 'file') continue;
      const target = link.target;
      if (target === '') continue; // same-page anchor
      const rootStyle = link.kind === 'page' && target.startsWith('/');
      if (link.kind === 'file' && target.startsWith('/')) continue; // absolute file-system path

      const oldTarget = rootStyle
        ? posix.normalize(target.slice(1))
        : posix.normalize(posix.join(dirOf(X), target));
      if (oldTarget === '..' || oldTarget.startsWith('../')) {
        warnings.push({ file: X, line: link.line, message: `Link leaves the workspace (${target}); left as is` });
        continue;
      }
      const newTarget = mapPath(oldTarget);
      let newText;
      if (rootStyle) {
        if (newTarget === oldTarget) continue;
        newText = `/${newTarget}`;
      } else {
        if (posix.normalize(posix.join(dirOf(X2), target)) === newTarget) continue; // still correct
        newText = relativeLink(dirOf(X2), target.endsWith('/') ? `${newTarget}/` : newTarget, {
          dotSlash: target.startsWith('./'),
        });
      }
      const angle = text[link.pathStart - 1] === '<';
      push(link, encodeLinkPath(newText, { angle }), 'md');
      continue;
    }

    // Wikilink: it only needs rewriting if it would stop resolving to the same page.
    if (link.target === '') continue;
    const before = resolvePageLink(link, X, byPath.get(X), beforeLookup);
    if (before.status !== 'ok') continue; // already broken or ambiguous: not ours to fix
    const after = resolvePageLink(link, X2, selfAfter, afterLookup);
    if (after.status === 'ok' && after.row.id === before.row.id) continue;

    const intended = afterLookup.byId.get(before.row.id);
    const chosen = chooseWikiText({ link, X, X2, intended, selfAfter, beforeLookup, afterLookup, before });
    if (chosen.converted) {
      warnings.push({
        file: X,
        line: link.line,
        message: `[[${link.target}]] now needs a path to keep pointing at ${intended.path}`,
      });
    }
    push(link, chosen.text, 'wiki');
  }

  return {
    edits: [...edits.values()].filter((e) => !e.conflict).sort((a, b) => a.start - b.start),
    warnings,
  };
}

/** A rooted path a wikilink can use: "A/B" normally, "/B" for a top-level page (a bare name would be a name lookup). */
const rootedText = (pagePath) => {
  const base = pageFolder(pagePath);
  return base.includes('/') ? base : `/${base}`;
};

/** Pick the least intrusive wikilink text that still resolves to the intended page. */
function chooseWikiText({ link, X, X2, intended, selfAfter, beforeLookup, afterLookup, before }) {
  const writtenExt = noteExtOf(link.target);
  const ext = writtenExt ? link.target.slice(link.target.length - writtenExt.length) : '';
  const written = (writtenExt ? link.target.slice(0, -writtenExt.length) : link.target).trim();
  const base = pageFolder(intended.path);

  const works = (txt) => {
    const r = resolvePageLink({ syntax: 'wiki', target: txt, fragment: link.fragment }, X2, selfAfter, afterLookup);
    return r.status === 'ok' && r.row.id === intended.id;
  };

  const candidates = [];
  const isName = !written.includes('/');
  if (isName) {
    candidates.push(intended.name + ext, rootedText(intended.path) + ext);
  } else if (written.startsWith('/')) {
    candidates.push(`/${base}${ext}`);
  } else if (written.startsWith('./') || written.startsWith('../')) {
    candidates.push(relativeLink(dirOf(X2), base, { dotSlash: true }) + ext, `/${base}${ext}`);
  } else {
    const rootedMatch = pageByStem(beforeLookup.byPath, written);
    const relMatch = pageByStem(beforeLookup.byPath, posix.normalize(posix.join(dirOf(X), written)));
    if (!(rootedMatch && rootedMatch.id === before.row.id) && relMatch && relMatch.id === before.row.id) {
      candidates.push(relativeLink(dirOf(X2), base) + ext);
    }
    candidates.push(rootedText(intended.path) + ext);
  }
  for (let i = 0; i < candidates.length; i++) {
    if (works(candidates[i])) return { text: candidates[i], converted: isName && i > 0 };
  }
  return { text: `/${base}${ext}`, converted: isName }; // an explicit rooted path always resolves
}
