// An in-memory file system with the same contract as the `fs` seam (Node's promise API, its error codes and return shapes).
// It is what the conformance suite and the Node test harness run the core code against without touching a disk,
// and it is the reference the Android file plugin is checked against.
import posix from './posix.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true }); // keep a byte-order mark, as Node does
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : Uint8Array.from(data));
const asBuffer = (bytes) => (typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes);

function fsError(code, syscall, p, text) {
  const err = new Error(`${code}: ${text}, ${syscall} '${p}'`);
  err.code = code;
  err.syscall = syscall;
  err.path = p;
  err.errno = { ENOENT: -2, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, ENOTEMPTY: -39 }[code] ?? -1;
  return err;
}
const enoent = (sys, p) => fsError('ENOENT', sys, p, 'no such file or directory');
const eexist = (sys, p) => fsError('EEXIST', sys, p, 'file already exists');
const enotdir = (sys, p) => fsError('ENOTDIR', sys, p, 'not a directory');
const eisdir = (sys, p) => fsError('EISDIR', sys, p, 'illegal operation on a directory');
const enotempty = (sys, p) => fsError('ENOTEMPTY', sys, p, 'directory not empty');

class Stats {
  constructor(node) {
    this._dir = node.dir;
    this.size = node.dir ? 4096 : node.data.length;
    this.mode = node.dir ? 0o040755 : 0o100644;
    this.mtimeMs = node.mtimeMs;
    this.ctimeMs = node.mtimeMs;
    this.birthtimeMs = node.birthtimeMs;
    this.atimeMs = node.mtimeMs;
    this.mtime = new Date(node.mtimeMs);
    this.ctime = this.mtime;
    this.birthtime = new Date(node.birthtimeMs);
    this.atime = this.mtime;
  }
  isFile() {
    return !this._dir;
  }
  isDirectory() {
    return this._dir;
  }
  isSymbolicLink() {
    return false;
  }
}

class Dirent {
  constructor(name, parentPath, dir) {
    this.name = name;
    this.parentPath = parentPath;
    this.path = parentPath;
    this._dir = dir;
  }
  isFile() {
    return !this._dir;
  }
  isDirectory() {
    return this._dir;
  }
  isSymbolicLink() {
    return false;
  }
}

/** @param {{ now?: () => number }} [opts] `now` supplies modification times (tests can make time stand still or jump) */
export function createMemFs(opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const mkNode = (dir) => {
    const t = now();
    return dir ? { dir: true, children: new Map(), mtimeMs: t, birthtimeMs: t } : { dir: false, data: new Uint8Array(0), mtimeMs: t, birthtimeMs: t };
  };
  const root = mkNode(true);

  const abs = (p) => posix.resolve('/', String(p));
  const parts = (a) => a.split('/').filter(Boolean);

  /** The node at an absolute path, or null; throws ENOTDIR when a file is in the way. */
  function find(a, sys, original) {
    let node = root;
    for (const seg of parts(a)) {
      if (!node.dir) throw enotdir(sys, original);
      node = node.children.get(seg);
      if (!node) return null;
    }
    return node;
  }
  /** The existing parent folder of a path and the name inside it. */
  function parentOf(a, sys, original) {
    const parent = find(posix.dirname(a), sys, original);
    if (!parent) throw enoent(sys, original);
    if (!parent.dir) throw enotdir(sys, original);
    return { parent, name: posix.basename(a) };
  }
  const encodingOf = (o) => (typeof o === 'string' ? o : o?.encoding);
  const touch = (node) => {
    node.mtimeMs = Math.max(now(), node.mtimeMs);
  };

  function clone(node) {
    if (!node.dir) return { ...mkNode(false), data: node.data.slice(), mtimeMs: node.mtimeMs };
    const copy = mkNode(true);
    copy.mtimeMs = node.mtimeMs;
    for (const [k, v] of node.children) copy.children.set(k, clone(v));
    return copy;
  }

  const impl = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 },

    async readFile(p, o) {
      const node = find(abs(p), 'open', p);
      if (!node) throw enoent('open', p);
      if (node.dir) throw eisdir('read', p);
      const enc = encodingOf(o);
      return enc ? decoder.decode(node.data) : asBuffer(node.data);
    },

    async writeFile(p, data, o) {
      const a = abs(p);
      const flag = (typeof o === 'object' && o?.flag) || 'w';
      const { parent, name } = parentOf(a, 'open', p);
      const existing = parent.children.get(name);
      if (existing?.dir) throw eisdir('open', p);
      if (existing && flag.includes('x')) throw eexist('open', p);
      const bytes = toBytes(data);
      if (existing) {
        existing.data = flag.startsWith('a') ? Uint8Array.from([...existing.data, ...bytes]) : bytes;
        touch(existing);
      } else {
        const node = mkNode(false);
        node.data = bytes;
        parent.children.set(name, node);
      }
      touch(parent);
    },

    async appendFile(p, data, o) {
      const flag = typeof o === 'object' && o?.flag ? o.flag : 'a';
      return impl.writeFile(p, data, { ...(typeof o === 'object' ? o : {}), flag });
    },

    async readdir(p, o) {
      const a = abs(p);
      const node = find(a, 'scandir', p);
      if (!node) throw enoent('scandir', p);
      if (!node.dir) throw enotdir('scandir', p);
      const names = [...node.children.keys()];
      if (o && typeof o === 'object' && o.withFileTypes) return names.map((n) => new Dirent(n, a, node.children.get(n).dir));
      return names;
    },

    async stat(p) {
      const node = find(abs(p), 'stat', p);
      if (!node) throw enoent('stat', p);
      return new Stats(node);
    },
    async lstat(p) {
      const node = find(abs(p), 'lstat', p);
      if (!node) throw enoent('lstat', p);
      return new Stats(node);
    },

    async access(p) {
      if (!find(abs(p), 'access', p)) throw enoent('access', p);
    },

    async realpath(p) {
      const a = abs(p);
      if (!find(a, 'realpath', p)) throw enoent('realpath', p);
      return a;
    },

    async mkdir(p, o) {
      const a = abs(p);
      const recursive = typeof o === 'object' && o?.recursive;
      if (recursive) {
        let node = root;
        let built = '';
        let first;
        for (const seg of parts(a)) {
          built += `/${seg}`;
          let next = node.children.get(seg);
          if (!next) {
            next = mkNode(true);
            node.children.set(seg, next);
            touch(node);
            first ??= built;
          } else if (!next.dir) throw enotdir('mkdir', p);
          node = next;
        }
        return first;
      }
      const { parent, name } = parentOf(a, 'mkdir', p);
      if (parent.children.has(name)) throw eexist('mkdir', p);
      parent.children.set(name, mkNode(true));
      touch(parent);
      return undefined;
    },

    async rename(from, to) {
      const a = abs(from);
      const b = abs(to);
      const src = find(a, 'rename', from);
      if (!src) throw enoent('rename', from);
      if (a === b) return;
      if (src.dir && (b + '/').startsWith(a + '/')) throw fsError('EINVAL', 'rename', from, 'invalid argument');
      const { parent: toParent, name: toName } = parentOf(b, 'rename', to);
      const existing = toParent.children.get(toName);
      if (existing) {
        if (existing.dir && !src.dir) throw eisdir('rename', to);
        if (!existing.dir && src.dir) throw enotdir('rename', to);
        if (existing.dir && existing.children.size > 0) throw enotempty('rename', to);
      }
      const { parent: fromParent, name: fromName } = parentOf(a, 'rename', from);
      fromParent.children.delete(fromName);
      toParent.children.set(toName, src);
      touch(fromParent);
      touch(toParent);
    },

    async rm(p, o) {
      const a = abs(p);
      const node = find(a, 'rm', p);
      if (!node) {
        if (o?.force) return;
        throw enoent('rm', p);
      }
      if (node.dir && !o?.recursive) throw fsError('ERR_FS_EISDIR', 'rm', p, 'Path is a directory');
      if (a === '/') throw fsError('EPERM', 'rm', p, 'operation not permitted');
      const { parent, name } = parentOf(a, 'rm', p);
      parent.children.delete(name);
      touch(parent);
    },

    async rmdir(p) {
      const a = abs(p);
      const node = find(a, 'rmdir', p);
      if (!node) throw enoent('rmdir', p);
      if (!node.dir) throw enotdir('rmdir', p);
      if (node.children.size > 0) throw enotempty('rmdir', p);
      const { parent, name } = parentOf(a, 'rmdir', p);
      parent.children.delete(name);
      touch(parent);
    },

    async unlink(p) {
      const a = abs(p);
      const node = find(a, 'unlink', p);
      if (!node) throw enoent('unlink', p);
      if (node.dir) throw eisdir('unlink', p);
      const { parent, name } = parentOf(a, 'unlink', p);
      parent.children.delete(name);
      touch(parent);
    },

    async copyFile(from, to, mode) {
      const src = find(abs(from), 'copyfile', from);
      if (!src) throw enoent('copyfile', from);
      if (src.dir) throw eisdir('copyfile', from);
      // COPYFILE_EXCL is 1
      return impl.writeFile(to, src.data, mode & 1 ? { flag: 'wx' } : undefined);
    },

    async cp(from, to, o) {
      const src = find(abs(from), 'cp', from);
      if (!src) throw enoent('cp', from);
      if (src.dir && !o?.recursive) throw fsError('ERR_FS_EISDIR', 'cp', from, 'Recursive option is required to copy a directory');
      const { parent, name } = parentOf(abs(to), 'cp', to);
      if (parent.children.has(name) && o?.force === false) return;
      parent.children.set(name, clone(src));
      touch(parent);
    },
  };
  return impl;
}

