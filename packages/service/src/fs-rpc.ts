// The file system, carried over a message channel. In the Android app the service runs in a Web Worker, which cannot call
// Capacitor plugins; the page (main thread) can. So the worker's `fs` is a client that sends each call across, and the
// main thread answers it with the real implementation (the plugin adapter). Structured cloning drops methods and class
// identity, so Stats, Dirents and errors are sent as plain data and rebuilt on the worker's side.
import { FS_METHODS } from '@cave-notes/platform/fs-methods';

export type FsFn = (...args: unknown[]) => Promise<unknown>;
/** The methods of the fs contract (by name), plus Node's constants. */
export type FsImpl = { [method: string]: FsFn | Record<string, number> | undefined };

export interface WireStats {
  __t: 'stats';
  dir: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atimeMs: number;
  mode: number;
}
export interface WireDirent {
  __t: 'dirent';
  name: string;
  parentPath: string;
  dir: boolean;
}
export interface WireFsError {
  message: string;
  code?: string;
  syscall?: string;
  path?: string;
}
export type FsReply = { ok: true; value: unknown } | { ok: false; error: WireFsError };

const isStats = (v: unknown): v is { isDirectory(): boolean; size: number; mtimeMs: number } => typeof v === 'object' && v !== null && typeof (v as { isDirectory?: unknown }).isDirectory === 'function' && 'mtimeMs' in v && 'size' in v;
const isDirent = (v: unknown): v is { name: string; isDirectory(): boolean } => typeof v === 'object' && v !== null && typeof (v as { isDirectory?: unknown }).isDirectory === 'function' && 'name' in v && !('mtimeMs' in v);

function encode(v: unknown): unknown {
  if (isStats(v)) {
    const s = v as unknown as { size: number; mtimeMs: number; ctimeMs?: number; birthtimeMs?: number; atimeMs?: number; mode?: number; isDirectory(): boolean };
    return { __t: 'stats', dir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs ?? s.mtimeMs, birthtimeMs: s.birthtimeMs ?? s.mtimeMs, atimeMs: s.atimeMs ?? s.mtimeMs, mode: s.mode ?? (s.isDirectory() ? 0o040755 : 0o100644) } satisfies WireStats;
  }
  if (isDirent(v)) {
    const d = v as unknown as { name: string; parentPath?: string; path?: string; isDirectory(): boolean };
    return { __t: 'dirent', name: d.name, parentPath: d.parentPath ?? d.path ?? '', dir: d.isDirectory() } satisfies WireDirent;
  }
  if (Array.isArray(v)) return v.map(encode);
  return v;
}

class RebuiltStats {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly atimeMs: number;
  readonly mode: number;
  readonly mtime: Date;
  constructor(private readonly w: WireStats) {
    this.size = w.size;
    this.mtimeMs = w.mtimeMs;
    this.ctimeMs = w.ctimeMs;
    this.birthtimeMs = w.birthtimeMs;
    this.atimeMs = w.atimeMs;
    this.mode = w.mode;
    this.mtime = new Date(w.mtimeMs);
  }
  isFile(): boolean {
    return !this.w.dir;
  }
  isDirectory(): boolean {
    return this.w.dir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
}
class RebuiltDirent {
  readonly name: string;
  readonly parentPath: string;
  readonly path: string;
  constructor(private readonly w: WireDirent) {
    this.name = w.name;
    this.parentPath = w.parentPath;
    this.path = w.parentPath;
  }
  isFile(): boolean {
    return !this.w.dir;
  }
  isDirectory(): boolean {
    return this.w.dir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (typeof v === 'object' && v !== null) {
    const t = (v as { __t?: string }).__t;
    if (t === 'stats') return new RebuiltStats(v as WireStats);
    if (t === 'dirent') return new RebuiltDirent(v as WireDirent);
  }
  return v;
}

/** Main-thread side: run one call against the real file system and say how it went, in a form that survives postMessage. */
export async function serveFsCall(impl: FsImpl, method: string, args: unknown[]): Promise<FsReply> {
  try {
    const fn = impl[method] as FsFn | undefined;
    if (!FS_METHODS.includes(method) || typeof fn !== 'function') throw Object.assign(new Error(`fs.${method} is not available on this device`), { code: 'ENOSYS' });
    return { ok: true, value: encode(await fn.apply(impl, args)) };
  } catch (e) {
    const err = e as { message?: string; code?: string; syscall?: string; path?: string };
    return { ok: false, error: { message: String(err?.message ?? e), code: err?.code, syscall: err?.syscall, path: err?.path } };
  }
}

/** Worker side: an fs whose calls are answered by `send` (which posts the request and resolves with the main thread's reply). */
export function createFsClient(send: (method: string, args: unknown[]) => Promise<FsReply>): FsImpl {
  const client: FsImpl = { constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 } };
  for (const method of FS_METHODS) {
    client[method] = async (...args: unknown[]) => {
      const reply = await send(method, args);
      if (reply.ok) return decode(reply.value);
      throw Object.assign(new Error(reply.error.message), { code: reply.error.code, syscall: reply.error.syscall, path: reply.error.path });
    };
  }
  return client;
}
