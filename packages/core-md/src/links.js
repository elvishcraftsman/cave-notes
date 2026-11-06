import { fileURLToPath } from '@cave-notes/platform';
import { isWs, safeDecode } from './util.js';

let PAGE_EXTS = ['.md'];

/** Which file extensions make a relative link a link to a page (the workspace's notes types). Default: `.md`. */
export function setPageExtensions(exts) {
  const list = (exts ?? []).map((e) => String(e).toLowerCase()).filter((e) => /^\.[a-z0-9][a-z0-9_-]*$/.test(e));
  PAGE_EXTS = list.length ? list : ['.md'];
}

const WEB_SCHEMES = new Set(['http', 'https', 'ftp', 'ftps', 'mailto', 'tel', 'sms']);

/**
 * Classify a link destination (already unescaped by the Markdown parser).
 *
 * kind:
 *   'page'  - relative/absolute path ending in .md, or a same-page "#anchor"
 *   'file'  - any other local path, or a file: URL
 *   'web'   - http(s), ftp, mailto, tel, sms
 *   'other' - any other scheme (javascript:, data:, ...). Never open these.
 *
 * Returns { kind, target, fragment, url, hasPath }.
 *   target:   decoded path without fragment ('' for same-page anchors and web links)
 *   fragment: decoded text after '#', or null
 *   url:      the full destination for web/other links, else null
 *   hasPath:  true when `target` is a plain relative/absolute path whose source span can be rewritten
 */
export function classifyDestination(dest) {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(dest);
  if (scheme && scheme[1].length > 1) {
    const name = scheme[1].toLowerCase();
    if (name === 'cave') {
      // cave://Workspace/path/to/page.md#heading : a page in another workspace
      const m = /^cave:\/\/([^/#?]+)\/?([^#]*)(?:#(.*))?$/i.exec(dest);
      if (m) return { kind: 'workspace', workspace: safeDecode(m[1]), target: safeDecode(m[2] ?? ''), fragment: m[3] ? safeDecode(m[3]) || null : null, url: dest, hasPath: false };
    }
    if (WEB_SCHEMES.has(name)) return { kind: 'web', target: '', fragment: null, url: dest, hasPath: false };
    if (name === 'file') {
      let target = dest;
      let fragment = null;
      const hash = dest.indexOf('#');
      const base = hash < 0 ? dest : dest.slice(0, hash);
      if (hash >= 0) fragment = safeDecode(dest.slice(hash + 1)) || null;
      try {
        target = fileURLToPath(base);
      } catch {
        target = safeDecode(base.replace(/^file:\/*/i, '/'));
      }
      return { kind: 'file', target, fragment, url: null, hasPath: false };
    }
    return { kind: 'other', target: '', fragment: null, url: dest, hasPath: false };
  }
  if (dest.startsWith('//')) return { kind: 'other', target: '', fragment: null, url: dest, hasPath: false };

  const hash = dest.indexOf('#');
  const rawPath = hash < 0 ? dest : dest.slice(0, hash);
  const fragment = hash < 0 ? null : safeDecode(dest.slice(hash + 1)) || null;
  const target = safeDecode(rawPath);
  const kind = target === '' || (() => { const low = target.toLowerCase(); return PAGE_EXTS.some((e) => low.endsWith(e)); })() ? 'page' : 'file';
  return { kind, target, fragment, url: null, hasPath: true };
}

/** Index of the `]` closing an opening bracket whose content starts at `from`, or -1. */
export function findCloseBracket(text, from, limit) {
  let depth = 0;
  for (let k = from; k < limit; k++) {
    const ch = text[k];
    if (ch === '\\') k++;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      if (depth === 0) return k;
      depth--;
    }
  }
  return -1;
}

/**
 * Find the destination inside `...](dest "title")` starting at `from` (just after the `(`),
 * or after `]:` for definitions. Returns { start, end } offsets of the destination text
 * (without angle brackets), or null.
 */
export function scanDestination(text, from, limit) {
  let j = from;
  while (j < limit && isWs(text[j])) j++;
  if (text[j] === '<') {
    const start = j + 1;
    let k = start;
    while (k < limit && text[k] !== '>' && text[k] !== '\n') {
      if (text[k] === '\\') k++;
      k++;
    }
    return text[k] === '>' ? { start, end: k } : null;
  }
  const start = j;
  let depth = 0;
  let k = start;
  while (k < limit) {
    const ch = text[k];
    if (ch === '\\') {
      k += 2;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (isWs(ch)) break;
    k++;
  }
  return { start, end: Math.min(k, limit) };
}

/** Destination span of an inline link or image node, or null if it can't be located. */
export function locateInlineDestination(text, node, isImage) {
  const nodeStart = node.position.start.offset;
  const nodeEnd = node.position.end.offset;
  let close;
  if (isImage) {
    close = findCloseBracket(text, nodeStart + 2, nodeEnd);
  } else {
    const last = node.children?.[node.children.length - 1];
    close = last?.position ? last.position.end.offset : nodeStart + 1;
  }
  if (close < 0 || text[close] !== ']' || text[close + 1] !== '(') return null;
  return scanDestination(text, close + 2, nodeEnd);
}

/** Destination span of a `[label]: dest` definition node, or null. */
export function locateDefinitionDestination(text, node) {
  const nodeStart = node.position.start.offset;
  const nodeEnd = node.position.end.offset;
  const close = findCloseBracket(text, nodeStart + 1, nodeEnd);
  if (close < 0 || text[close + 1] !== ':') return null;
  return scanDestination(text, close + 2, nodeEnd);
}

/**
 * `Workspace::Page/path` (the inside of a wikilink without its `|label` and `#heading`): the page of another
 * workspace. Returns { workspace, target }, or null for an ordinary link.
 */
export function splitWorkspaceTarget(target) {
  const m = /^([^:/\\|#?[\]]+?)\s*::\s*(.*)$/.exec(target);
  return m ? { workspace: m[1].trim(), target: m[2].trim() } : null;
}
