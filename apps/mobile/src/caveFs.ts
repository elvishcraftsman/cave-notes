import { registerPlugin } from '@capacitor/core';

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface FsStat {
  exists: boolean;
  isDir: boolean;
  size: number;
  mtime: number;
}

/**
 * Real-path file access on Android (the Java plugin in android/app/src/main/java/.../CaveFsPlugin.java). These are the primitives;
 * pluginFs.ts builds the whole Node-style fs contract on top of them. A failure rejects with `code` set to a POSIX name
 * (ENOENT, EEXIST, ENOTDIR, EISDIR, ENOTEMPTY, EACCES, EIO).
 */
export interface CaveFsPlugin {
  hasAccess(): Promise<{ granted: boolean }>;
  /** Opens the system "All files access" screen for this app; resolves at once, so check hasAccess() when the app resumes. */
  requestAccess(): Promise<void>;
  list(opts: { path: string }): Promise<{ entries: FsEntry[] }>;
  /** Everything under a folder in one call, one line per entry: `d|f`, size, modified ms, path below the folder, separated by `|`. */
  tree(opts: { path: string; limit?: number; maxMs?: number }): Promise<{ data: string; count: number; truncated: boolean }>;
  read(opts: { path: string }): Promise<{ text: string; size: number; mtime: number }>;
  /** Writes to a temporary file beside the target, then renames it over the target. */
  write(opts: { path: string; text: string }): Promise<{ size: number; mtime: number }>;
  stat(opts: { path: string }): Promise<FsStat>;
  /** recursive: also creates missing parents and accepts an existing folder; otherwise a missing parent is ENOENT and an existing path EEXIST. */
  mkdir(opts: { path: string; recursive?: boolean }): Promise<void>;
  readBase64(opts: { path: string }): Promise<{ data: string; size: number; mtime: number }>;
  /** flag: 'w' replace (via a temporary file and rename), 'wx' fail with EEXIST if present, 'a' append. */
  writeBase64(opts: { path: string; data: string; flag?: 'w' | 'wx' | 'a' }): Promise<{ size: number; mtime: number }>;
  /** Moves a file or folder; replaces an existing file, refuses a non-empty folder (ENOTEMPTY). */
  rename(opts: { from: string; to: string }): Promise<void>;
  /** Deletes a file or an empty folder (ENOTEMPTY otherwise, ENOENT if absent). */
  remove(opts: { path: string }): Promise<void>;
  copyFile(opts: { from: string; to: string; exclusive?: boolean }): Promise<void>;
  realpath(opts: { path: string }): Promise<{ path: string }>;
  /** The app's private folders: `files` (kept) and `cache` (the system may clear it). */
  appPaths(): Promise<{ files: string; cache: string }>;
}

const raw = registerPlugin<CaveFsPlugin>('CaveFs');

/** Calls to the plugin that have not come back yet: what the log says when the phone's file layer seems stuck. */
const inflight = new Map<number, { op: string; target: string; at: number }>();
let nextCall = 1;

export function pluginBusy(now = Date.now()): string {
  const list = [...inflight.values()].sort((a, b) => a.at - b.at).slice(0, 4);
  return list.map((c) => `${c.op} ${c.target.replace(/^\/storage\/emulated\/0\//, '')} (${Math.round((now - c.at) / 1000)} s)`).join(', ');
}

/** The plugin with every call noted while it runs (the plugin object itself is a proxy and is not wrapped as a whole). */
export function traced(plugin: CaveFsPlugin): CaveFsPlugin {
  const out: Record<string, unknown> = {};
  for (const k of ['hasAccess', 'requestAccess', 'list', 'tree', 'read', 'write', 'stat', 'mkdir', 'readBase64', 'writeBase64', 'rename', 'remove', 'copyFile', 'realpath', 'appPaths'] as const) {
    out[k] = (opts?: { path?: string; from?: string }) => {
      const id = nextCall++;
      inflight.set(id, { op: k, target: opts?.path ?? opts?.from ?? '', at: Date.now() });
      return (plugin[k] as (o?: unknown) => Promise<unknown>)(opts).finally(() => inflight.delete(id));
    };
  }
  return out as unknown as CaveFsPlugin;
}

export const CaveFs: CaveFsPlugin = traced(raw);
