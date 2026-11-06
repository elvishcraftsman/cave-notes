// Node (and Electron) implementation: everything is Node's own, so behaviour is exactly what it was before this package existed.
import nodeFs from 'node:fs/promises';
import nodeFsSync from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';
import nodeOs from 'node:os';
import { createFsHolder } from './fs-holder.js';
import { createHostHolder } from './host.js';

const holder = createFsHolder(nodeFs);

const hostHolder = createHostHolder({
  hostname: () => nodeOs.hostname(),
  homedir: () => nodeOs.homedir(),
  tmpdir: () => nodeOs.tmpdir(),
  cpuCount: () => nodeOs.cpus().length,
  pid: () => process.pid,
  rssMB: () => Math.round(process.memoryUsage.rss() / 1048576),
});

/** hostname(), tmpdir(), cpuCount(), pid(), rssMB(): the machine, as the service needs to know it. */
export const host = hostHolder.host;
export const setHost = hostHolder.setHost;
export const resetHost = hostHolder.resetHost;

export const fs = holder.fs;
export const setFs = holder.setFs;
export const resetFs = holder.resetFs;
export const getFs = holder.getFs;
/** Synchronous Node fs, for the few callers that cannot wait (the Electron main process). Not available on Android. */
export const fsSync = nodeFsSync;
export const path = nodePath;
export const posix = nodePath.posix;
export const fileURLToPath = nodeFileURLToPath;

/** SHA-1 of a string or bytes, as lower-case hex (used as content fingerprints, not for security). */
export const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
/** `bytes` random bytes as lower-case hex. */
export const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
export { utf8Bytes, utf8Length, utf8Text, bytesEqual } from './bytes.js';
