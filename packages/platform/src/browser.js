// WebView / Web Worker implementation. There is no node:fs here: the file system is whatever the host installs with setFs
// (on Android, the CaveFs plugin behind an FsLike), and a call before that fails with a clear message.
import { sha1 as nobleSha1 } from '@noble/hashes/legacy.js';
import posix from './posix.js';
import { createFsHolder } from './fs-holder.js';
import { createHostHolder } from './host.js';

const notInstalled = new Proxy(
  {},
  {
    get: (_t, name) => (name === 'constants' ? undefined : () => Promise.reject(new Error(`no file system installed (fs.${String(name)}); call setFs first`))),
  },
);
const holder = createFsHolder(notInstalled);

const hostHolder = createHostHolder({
  hostname: () => 'this device',
  homedir: () => '/storage/emulated/0',
  tmpdir: () => '/tmp',
  cpuCount: () => globalThis.navigator?.hardwareConcurrency ?? 2,
  pid: () => 0,
  rssMB: () => Math.round((globalThis.performance?.memory?.usedJSHeapSize ?? 0) / 1048576),
});

/** hostname(), tmpdir(), cpuCount(), pid(), rssMB(): the device, as the service needs to know it. */
export const host = hostHolder.host;
export const setHost = hostHolder.setHost;
export const resetHost = hostHolder.resetHost;

export const fs = holder.fs;
export const setFs = holder.setFs;
export const resetFs = holder.resetFs;
export const getFs = holder.getFs;
/** There is no synchronous file access in a WebView; anything that asks for it gets a clear error. */
export const fsSync = new Proxy({}, { get: (_t, name) => () => { throw new Error(`synchronous file access (fs.${String(name)}) is not available on this platform`); } });
export const path = posix;
export { posix };

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-1 of a string or bytes, as lower-case hex (used as content fingerprints, not for security). */
export const sha1 = (data) => hex(nobleSha1(typeof data === 'string' ? encoder.encode(data) : data));
/** `bytes` random bytes as lower-case hex. */
export const randomHex = (bytes) => hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

/** file:///a/b%20c → /a/b c (POSIX only). */
export function fileURLToPath(url) {
  const u = typeof url === 'string' ? new URL(url) : url;
  if (u.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(u.pathname);
}
export { utf8Bytes, utf8Length, utf8Text, bytesEqual } from './bytes.js';
