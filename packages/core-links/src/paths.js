import { posix } from '@cave-notes/platform';
import { pageFolder } from '@cave-notes/core-tree';

/**
 * Maps workspace paths affected by moving one page (and its folder) from `rootFrom` to `rootTo`.
 * Covers the page, its descendants, and attachments in its folder. Other paths map to themselves.
 */
export function makeMapper(rootFrom, rootTo) {
  const fromFolder = pageFolder(rootFrom);
  const toFolder = pageFolder(rootTo);
  return (p) => {
    if (p === rootFrom) return rootTo;
    if (p === fromFolder) return toFolder;
    if (p.startsWith(`${fromFolder}/`)) return toFolder + p.slice(fromFolder.length);
    return p;
  };
}

/** Directory of a workspace-relative path ('.' for the root). */
export const dirOf = (p) => posix.dirname(p);

/** Escape characters that would break a Markdown link destination. */
export function encodeLinkPath(text, { angle = false } = {}) {
  const pattern = angle ? /[<>%]/g : /[\s%#?()<>[\]\\]/g;
  return text.replace(pattern, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** Relative link from the directory `fromDir` to workspace path `target`, keeping a trailing slash. */
export function relativeLink(fromDir, target, { dotSlash = false } = {}) {
  let rel = posix.relative(fromDir === '' ? '.' : fromDir, target.replace(/\/$/, '')) || '.';
  if (target.endsWith('/') && !rel.endsWith('/')) rel += '/';
  if (dotSlash && !rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}
