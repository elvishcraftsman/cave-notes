// A small POSIX path module for places without node:path (the Android WebView). It follows Node's path.posix, which the tests
// compare it against. Only forward slashes are understood: Android paths are POSIX paths.

const assertPath = (p) => {
  if (typeof p !== 'string') throw new TypeError(`The "path" argument must be of type string. Received ${typeof p}`);
};

/** Resolves '.' and '..' segments; keeps leading '..' only when allowAboveRoot. */
function normalizeString(p, allowAboveRoot) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else out.push(seg);
  }
  return out.join('/');
}

export const sep = '/';
export const delimiter = ':';

export function isAbsolute(p) {
  assertPath(p);
  return p.startsWith('/');
}

export function normalize(p) {
  assertPath(p);
  if (p.length === 0) return '.';
  const abs = p.startsWith('/');
  const trailing = p.endsWith('/');
  let out = normalizeString(p, !abs);
  if (out.length === 0) {
    if (abs) return '/';
    return trailing ? './' : '.';
  }
  if (trailing) out += '/';
  return abs ? `/${out}` : out;
}

export function join(...parts) {
  let joined = '';
  for (const part of parts) {
    assertPath(part);
    if (part.length > 0) joined += joined.length === 0 ? part : `/${part}`;
  }
  return joined.length === 0 ? '.' : normalize(joined);
}

export function resolve(...parts) {
  let resolved = '';
  let abs = false;
  for (let i = parts.length - 1; i >= -1 && !abs; i--) {
    const p = i >= 0 ? parts[i] : '/';
    assertPath(p);
    if (p.length === 0) continue;
    resolved = `${p}/${resolved}`;
    abs = p.startsWith('/');
  }
  resolved = normalizeString(resolved, !abs);
  if (abs) return `/${resolved}`;
  return resolved.length > 0 ? resolved : '.';
}

export function dirname(p) {
  assertPath(p);
  if (p.length === 0) return '.';
  const abs = p.startsWith('/');
  let end = -1;
  let matchedSlash = true;
  for (let i = p.length - 1; i >= 1; --i) {
    if (p[i] === '/') {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return abs ? '/' : '.';
  if (abs && end === 1) return '//';
  return p.slice(0, end);
}

export function basename(p, ext) {
  assertPath(p);
  let end = p.length;
  while (end > 0 && p[end - 1] === '/') end--;
  if (end === 0) return '';
  const start = p.lastIndexOf('/', end - 1) + 1;
  let base = p.slice(start, end);
  if (ext !== undefined && ext.length > 0) {
    if (ext === p) return '';
    if (base !== ext && base.endsWith(ext)) base = base.slice(0, base.length - ext.length);
  }
  return base;
}

export function extname(p) {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || base === '..') return '';
  return base.slice(dot);
}

export function relative(from, to) {
  assertPath(from);
  assertPath(to);
  if (from === to) return '';
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

export const posix = { sep, delimiter, isAbsolute, normalize, join, resolve, dirname, basename, extname, relative };
posix.posix = posix;
export default posix;
