// Types for the platform seam. The file-system and path types are Node's own, so code written against node:fs/promises and
// node:path type-checks unchanged; what a particular platform really supports is what the conformance suite checks.
import type nodeFsPromises from 'node:fs/promises';
import type nodeFs from 'node:fs';
import type nodePath from 'node:path';

/** The promise-style file API (see FS_METHODS in fs-holder.js for the methods that are part of the contract). */
export const fs: typeof nodeFsPromises;
export function setFs(impl: Partial<typeof nodeFsPromises> | object): void;
export function resetFs(): void;
export function getFs(): typeof nodeFsPromises;

/** Synchronous file access: Node and Electron only. Calls on Android throw a clear error. */
export const fsSync: typeof nodeFs;

export const path: typeof nodePath.posix & Pick<typeof nodePath, 'sep' | 'delimiter'>;
export const posix: typeof nodePath.posix;
export function fileURLToPath(url: string | URL): string;

export function sha1(data: string | Uint8Array): string;
export function randomHex(bytes: number): string;
export function utf8Bytes(text: string): Uint8Array;
export function utf8Length(text: string): number;
export function utf8Text(bytes: Uint8Array): string;
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;

export interface HostInfo {
  hostname(): string;
  homedir(): string;
  tmpdir(): string;
  cpuCount(): number;
  pid(): number;
  rssMB(): number;
}
export const host: HostInfo;
export function setHost(impl: Partial<HostInfo>): void;
export function resetHost(): void;
