import { path } from '@cave-notes/platform';
import { stripNoteExt, pageByStem, endsWithStem } from './exts.js';

const posix = path.posix;

/**
 * In-memory lookup over the pages table, used to resolve many links per batch.
 * `rows`: [{ id, path, name, title, aliases: string[] }]
 */
export function buildLookup(rows) {
  const byPath = new Map();
  const byStem = new Map();
  const byTitle = new Map();
  const push = (map, key, row) => {
    const k = key.toLowerCase();
    const list = map.get(k);
    if (list) {
      if (!list.includes(row)) list.push(row);
    } else map.set(k, [row]);
  };
  for (const r of rows) {
    byPath.set(r.path, r);
    push(byStem, r.name, r);
    push(byTitle, r.title, r);
    for (const a of r.aliases) push(byTitle, a, r);
  }
  return { byPath, byStem, byTitle };
}

/** Number of tree steps between the folders holding two pages. */
function distance(aPath, bPath) {
  const a = posix.dirname(aPath) === '.' ? [] : posix.dirname(aPath).split('/');
  const b = posix.dirname(bPath) === '.' ? [] : posix.dirname(bPath).split('/');
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return a.length - common + (b.length - common);
}

/** Pick the unique closest candidate, or report ambiguity. */
function closest(candidates, fromPath) {
  if (candidates.length === 1) return { status: 'ok', row: candidates[0] };
  let best = Infinity;
  let winners = [];
  for (const c of candidates) {
    const d = distance(fromPath, c.path);
    if (d < best) {
      best = d;
      winners = [c];
    } else if (d === best) winners.push(c);
  }
  return winners.length === 1 ? { status: 'ok', row: winners[0] } : { status: 'ambiguous', row: null, candidates: winners };
}

/**
 * Resolve a page link found in `fromPath`.
 * link: { syntax: 'md'|'wiki', target, fragment }
 * Returns { status: 'ok'|'broken'|'ambiguous', row|null, targetPath|null, candidates?: string[] }
 * (candidates lists the equally close pages when the link is ambiguous).
 */
export function resolvePageLink(link, fromPath, fromRow, lookup) {
  const { byPath, byStem, byTitle } = lookup;

  if (link.target === '') return { status: 'ok', row: fromRow, targetPath: fromPath }; // same-page #anchor

  if (link.syntax === 'md') {
    const p = link.target.startsWith('/')
      ? posix.normalize(link.target.slice(1))
      : posix.normalize(posix.join(posix.dirname(fromPath), link.target));
    if (p.startsWith('..') || p.startsWith('/')) return { status: 'broken', row: null, targetPath: p };
    const row = byPath.get(p);
    return row ? { status: 'ok', row, targetPath: p } : { status: 'broken', row: null, targetPath: p };
  }

  // Wikilink: path, then file name, then title/alias.
  const name = stripNoteExt(link.target).trim();
  // Explicit anchors: "/a/b" is a path from the workspace root, "./b" and "../b" are relative to this page.
  if (name.startsWith('/')) {
    const row = pageByStem(byPath, posix.normalize(name.slice(1)));
    return row ? { status: 'ok', row, targetPath: row.path } : { status: 'broken', row: null, targetPath: null };
  }
  if (name.startsWith('./') || name.startsWith('../')) {
    const p = posix.normalize(posix.join(posix.dirname(fromPath), name));
    const row = p.startsWith('..') ? undefined : pageByStem(byPath, p);
    return row ? { status: 'ok', row, targetPath: row.path } : { status: 'broken', row: null, targetPath: null };
  }
  if (name.includes('/')) {
    const rooted = pageByStem(byPath, name);
    if (rooted) return { status: 'ok', row: rooted, targetPath: rooted.path };
    const rel = pageByStem(byPath, posix.normalize(posix.join(posix.dirname(fromPath), name)));
    if (rel) return { status: 'ok', row: rel, targetPath: rel.path };
    const suffix = `/${name}`.toLowerCase();
    const hits = [...byPath.values()].filter((r) => endsWithStem(`/${r.path}`.toLowerCase(), suffix));
    if (hits.length) {
      const c = closest(hits, fromPath);
      return { status: c.status, row: c.row, targetPath: c.row?.path ?? null, candidates: c.candidates?.map((r) => r.path) };
    }
    return { status: 'broken', row: null, targetPath: null };
  }
  const key = name.toLowerCase();
  const stems = byStem.get(key);
  const candidates = stems?.length ? stems : byTitle.get(key);
  if (!candidates?.length) return { status: 'broken', row: null, targetPath: null };
  const c = closest(candidates, fromPath);
  return { status: c.status, row: c.row, targetPath: c.row?.path ?? null, candidates: c.candidates?.map((r) => r.path) };
}

/** Resolve a workspace-relative path for a file link (no filesystem access). */
export function resolveFilePath(target, fromPath) {
  if (path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)) return target;
  return posix.normalize(posix.join(posix.dirname(fromPath), target));
}
