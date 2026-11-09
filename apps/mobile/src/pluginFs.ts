// The Node-style `fs` contract (see @cave-notes/platform) on top of the CaveFs plugin's primitives.
// Everything with a rule in it (flags, recursion, which error code for which situation) lives here, in TypeScript, where
// the conformance suite can test it against a stand-in plugin; the Java side only does single, simple operations.
import type { CaveFsPlugin, FsEntry } from './caveFs';

const encoder = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const MESSAGES: Record<string, string> = {
  ENOENT: 'no such file or directory',
  EEXIST: 'file already exists',
  ENOTDIR: 'not a directory',
  EISDIR: 'illegal operation on a directory',
  ENOTEMPTY: 'directory not empty',
  EACCES: 'permission denied',
  EIO: 'input/output error',
};

/** An error shaped like Node's (err.code, err.syscall, err.path), which the core code tests for. */
export function fsError(code: string, syscall: string, path: string): Error & { code: string; syscall: string; path: string } {
  const err = new Error(`${code}: ${MESSAGES[code] ?? 'file system error'}, ${syscall} '${path}'`) as Error & { code: string; syscall: string; path: string };
  err.code = code;
  err.syscall = syscall;
  err.path = path;
  return err;
}

/** Run a plugin call, turning its rejection into a Node-style error for `path`. */
async function call<T>(syscall: string, path: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if (typeof code === 'string' && code in MESSAGES) throw fsError(code, syscall, path);
    const text = String((e as Error)?.message ?? e);
    const guessed = /ENOENT|no such file|not found/i.test(text) ? 'ENOENT' : /EEXIST|already exists/i.test(text) ? 'EEXIST' : /EACCES|permission/i.test(text) ? 'EACCES' : 'EIO';
    throw fsError(guessed, syscall, path);
  }
}

class Stats {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly atimeMs: number;
  readonly mode: number;
  readonly mtime: Date;
  constructor(
    private readonly dir: boolean,
    size: number,
    mtimeMs: number,
  ) {
    this.size = size;
    this.mtimeMs = mtimeMs;
    this.ctimeMs = mtimeMs;
    this.birthtimeMs = mtimeMs;
    this.atimeMs = mtimeMs;
    this.mtime = new Date(mtimeMs);
    this.mode = dir ? 0o040755 : 0o100644;
  }
  isFile(): boolean {
    return !this.dir;
  }
  isDirectory(): boolean {
    return this.dir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
}

class Dirent {
  readonly path: string;
  constructor(
    readonly name: string,
    readonly parentPath: string,
    private readonly dir: boolean,
  ) {
    this.path = parentPath;
  }
  isFile(): boolean {
    return !this.dir;
  }
  isDirectory(): boolean {
    return this.dir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
}

const norm = (p: string): string => {
  const parts: string[] = [];
  for (const seg of String(p).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
};
const parentOf = (p: string): string => norm(p).replace(/\/[^/]*$/, '') || '/';
const baseOf = (p: string): string => norm(p).replace(/^.*\//, '');
const join = (a: string, b: string): string => `${a.replace(/\/+$/, '')}/${b}`;
const encodingOf = (o: unknown): string | undefined => (typeof o === 'string' ? o : (o as { encoding?: string } | undefined)?.encoding);

/**
 * The implementation to install with `setFs` in the service's worker (or to serve over the worker's message channel).
 *
 * Every call here crosses the bridge to Java, and indexing a workspace asks for the size and time of every file right after
 * listing its folder (thousands of calls for a folder of pictures). The listing already carries them, so what a listing
 * returned answers the stat calls that follow for `statCacheMs`; any change made through this fs forgets all of it.
 */
export function createPluginFs(plugin: CaveFsPlugin, { statCacheMs = 2000, treeCacheMs = 30000, now = () => Date.now() }: { statCacheMs?: number; treeCacheMs?: number; now?: () => number } = {}) {
  const known = new Map<string, { exists: true; isDir: boolean; size: number; mtime: number; at: number; ttl: number }>();
  /** the listing of whole folders, from one `tree` call: folder → its entries (answers readdir without a call each) */
  const folders = new Map<string, { entries: FsEntry[]; at: number }>();
  const forget = (): void => {
    known.clear();
    folders.clear();
  };
  const statPlugin = async (path: string, syscall: string, shown: string) => {
    const hit = known.get(path);
    if (hit && now() - hit.at < hit.ttl) return { exists: true as const, isDir: hit.isDir, size: hit.size, mtime: hit.mtime };
    return call(syscall, shown, plugin.stat({ path }));
  };
  const stat = async (p: string, syscall = 'stat') => {
    const s = await statPlugin(norm(p), syscall, p);
    if (!s.exists) {
      // distinguish a missing file from a file standing where a folder should be (stat('/file/inside'))
      let up = parentOf(norm(p));
      while (up !== '/') {
        const u = await call(syscall, p, plugin.stat({ path: up }));
        if (u.exists) {
          if (!u.isDir) throw fsError('ENOTDIR', syscall, p);
          break;
        }
        up = parentOf(up);
      }
      throw fsError('ENOENT', syscall, p);
    }
    return new Stats(s.isDir, s.isDir ? 4096 : s.size, s.mtime);
  };

  const impl = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 },

    async readFile(p: string, o?: unknown): Promise<string | Uint8Array> {
      const path = norm(p);
      const s = await stat(p, 'open');
      if (s.isDirectory()) throw fsError('EISDIR', 'read', p);
      const enc = encodingOf(o);
      if (enc) return (await call('open', p, plugin.read({ path }))).text;
      return fromBase64((await call('open', p, plugin.readBase64({ path }))).data);
    },

    async writeFile(p: string, data: string | Uint8Array, o?: unknown): Promise<void> {
      forget();
      const path = norm(p);
      const flag = (typeof o === 'object' && o !== null && (o as { flag?: string }).flag) || 'w';
      const parent = await call('open', p, plugin.stat({ path: parentOf(path) }));
      if (!parent.exists) throw fsError('ENOENT', 'open', p);
      if (!parent.isDir) throw fsError('ENOTDIR', 'open', p);
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      const mode = flag.startsWith('a') ? 'a' : flag.includes('x') ? 'wx' : 'w';
      if (mode !== 'a') {
        const here = await call('open', p, plugin.stat({ path }));
        if (here.exists && here.isDir) throw fsError('EISDIR', 'open', p);
      }
      await call('open', p, plugin.writeBase64({ path, data: toBase64(bytes), flag: mode }));
    },

    async appendFile(p: string, data: string | Uint8Array, o?: unknown): Promise<void> {
      return impl.writeFile(p, data, { ...(typeof o === 'object' && o ? o : {}), flag: 'a' });
    },

    async readdir(p: string, o?: unknown): Promise<Array<string | Dirent>> {
      const path = norm(p);
      const s = await stat(p, 'scandir');
      if (!s.isDirectory()) throw fsError('ENOTDIR', 'scandir', p);
      const primed = folders.get(path);
      const { entries } = primed && now() - primed.at < treeCacheMs ? { entries: primed.entries } : await call('scandir', p, plugin.list({ path }));
      const at = now();
      for (const e of entries) known.set(join(path, e.name), { exists: true, isDir: e.isDir, size: e.size, mtime: e.mtime, at, ttl: statCacheMs });
      if (o && typeof o === 'object' && (o as { withFileTypes?: boolean }).withFileTypes) return entries.map((e: FsEntry) => new Dirent(e.name, path, e.isDir));
      return entries.map((e: FsEntry) => e.name);
    },

    /**
     * Read a whole folder's tree with one call, so that the listings and stats indexing asks for next are answered from it
     * (for `treeCacheMs`, or until something is changed through this fs). Without it each folder is a call of its own.
     * Returns how many entries there were, and whether the plugin cut the listing short (then nothing is kept).
     */
    async primeTree(root: string): Promise<{ count: number; ms: number; truncated: boolean }> {
      const base = norm(root);
      const started = now();
      const t = await call('scandir', root, plugin.tree({ path: base, limit: 60000, maxMs: 15000 }));
      if (t.truncated) return { count: t.count, ms: now() - started, truncated: true };
      const at = now();
      const kids = new Map<string, FsEntry[]>([[base, []]]);
      for (const line of t.data.split('\n')) {
        if (!line) continue;
        const a = line.indexOf('|');
        const b = line.indexOf('|', a + 1);
        const c = line.indexOf('|', b + 1);
        const rel = line.slice(c + 1);
        const isDir = line[0] === 'd';
        const slash = rel.lastIndexOf('/');
        const parent = slash < 0 ? base : join(base, rel.slice(0, slash));
        const name = slash < 0 ? rel : rel.slice(slash + 1);
        const e: FsEntry = { name, isDir, size: Number(line.slice(a + 1, b)), mtime: Number(line.slice(b + 1, c)) };
        let list = kids.get(parent);
        if (!list) kids.set(parent, (list = []));
        list.push(e);
        if (isDir && !kids.has(join(base, rel))) kids.set(join(base, rel), []);
        known.set(join(base, rel), { exists: true, isDir, size: e.size, mtime: e.mtime, at, ttl: treeCacheMs });
      }
      for (const [dir, entries] of kids) folders.set(dir, { entries, at });
      known.set(base, { exists: true, isDir: true, size: 0, mtime: 0, at, ttl: treeCacheMs });
      return { count: t.count, ms: now() - started, truncated: false };
    },

    stat: (p: string) => stat(p, 'stat'),
    lstat: (p: string) => stat(p, 'lstat'),

    async access(p: string): Promise<void> {
      await stat(p, 'access');
    },

    async realpath(p: string): Promise<string> {
      await stat(p, 'realpath');
      return (await call('realpath', p, plugin.realpath({ path: norm(p) }))).path;
    },

    async mkdir(p: string, o?: unknown): Promise<string | undefined> {
      forget();
      const path = norm(p);
      const recursive = typeof o === 'object' && o !== null && (o as { recursive?: boolean }).recursive === true;
      if (!recursive) {
        const here = await call('mkdir', p, plugin.stat({ path }));
        if (here.exists) throw fsError('EEXIST', 'mkdir', p);
        const parent = await call('mkdir', p, plugin.stat({ path: parentOf(path) }));
        if (!parent.exists) throw fsError('ENOENT', 'mkdir', p);
        if (!parent.isDir) throw fsError('ENOTDIR', 'mkdir', p);
        await call('mkdir', p, plugin.mkdir({ path, recursive: false }));
        return undefined;
      }
      // the first folder that had to be made, as Node reports it
      let first: string | undefined;
      const missing: string[] = [];
      for (let cur = path; cur !== '/'; cur = parentOf(cur)) {
        const s = await call('mkdir', p, plugin.stat({ path: cur }));
        if (s.exists) {
          if (!s.isDir) throw fsError('ENOTDIR', 'mkdir', p);
          break;
        }
        missing.unshift(cur);
      }
      for (const dir of missing) {
        await call('mkdir', p, plugin.mkdir({ path: dir, recursive: false }));
        first ??= dir;
      }
      return first;
    },

    async rename(from: string, to: string): Promise<void> {
      forget();
      const a = norm(from);
      const b = norm(to);
      const src = await stat(from, 'rename');
      if (a === b) return;
      if (src.isDirectory() && `${b}/`.startsWith(`${a}/`)) throw fsError('EINVAL', 'rename', from);
      const parent = await call('rename', to, plugin.stat({ path: parentOf(b) }));
      if (!parent.exists) throw fsError('ENOENT', 'rename', to);
      if (!parent.isDir) throw fsError('ENOTDIR', 'rename', to);
      const there = await call('rename', to, plugin.stat({ path: b }));
      if (there.exists) {
        if (there.isDir && !src.isDirectory()) throw fsError('EISDIR', 'rename', to);
        if (!there.isDir && src.isDirectory()) throw fsError('ENOTDIR', 'rename', to);
        if (there.isDir && (await call('rename', to, plugin.list({ path: b }))).entries.length > 0) throw fsError('ENOTEMPTY', 'rename', to);
      }
      await call('rename', from, plugin.rename({ from: a, to: b }));
    },

    async rm(p: string, o?: { recursive?: boolean; force?: boolean }): Promise<void> {
      forget();
      const path = norm(p);
      const s = await call('rm', p, plugin.stat({ path }));
      if (!s.exists) {
        if (o?.force) return;
        throw fsError('ENOENT', 'rm', p);
      }
      if (!s.isDir) return call('rm', p, plugin.remove({ path }));
      if (!o?.recursive) {
        const e = fsError('ERR_FS_EISDIR', 'rm', p);
        throw e;
      }
      const walk = async (dir: string): Promise<void> => {
        for (const e of (await call('rm', p, plugin.list({ path: dir }))).entries) {
          if (e.isDir) await walk(join(dir, e.name));
          else await call('rm', p, plugin.remove({ path: join(dir, e.name) }));
        }
        await call('rm', p, plugin.remove({ path: dir }));
      };
      await walk(path);
    },

    async rmdir(p: string): Promise<void> {
      forget();
      const path = norm(p);
      const s = await stat(p, 'rmdir');
      if (!s.isDirectory()) throw fsError('ENOTDIR', 'rmdir', p);
      if ((await call('rmdir', p, plugin.list({ path }))).entries.length > 0) throw fsError('ENOTEMPTY', 'rmdir', p);
      await call('rmdir', p, plugin.remove({ path }));
    },

    async unlink(p: string): Promise<void> {
      forget();
      const s = await stat(p, 'unlink');
      if (s.isDirectory()) throw fsError('EISDIR', 'unlink', p);
      await call('unlink', p, plugin.remove({ path: norm(p) }));
    },

    async copyFile(from: string, to: string, mode?: number): Promise<void> {
      forget();
      const s = await stat(from, 'copyfile');
      if (s.isDirectory()) throw fsError('EISDIR', 'copyfile', from);
      const parent = await call('copyfile', to, plugin.stat({ path: parentOf(norm(to)) }));
      if (!parent.exists) throw fsError('ENOENT', 'copyfile', to);
      await call('copyfile', to, plugin.copyFile({ from: norm(from), to: norm(to), exclusive: ((mode ?? 0) & 1) === 1 }));
    },

    async cp(from: string, to: string, o?: { recursive?: boolean; force?: boolean }): Promise<void> {
      forget();
      const s = await stat(from, 'cp');
      const copy = async (a: string, b: string, isDir: boolean): Promise<void> => {
        if (!isDir) return call('cp', b, plugin.copyFile({ from: a, to: b }));
        await impl.mkdir(b, { recursive: true });
        for (const e of (await call('cp', a, plugin.list({ path: a }))).entries) await copy(join(a, e.name), join(b, e.name), e.isDir);
      };
      if (s.isDirectory() && !o?.recursive) throw fsError('ERR_FS_EISDIR', 'cp', from);
      await copy(norm(from), norm(to), s.isDirectory());
    },
  };
  return impl;
}
