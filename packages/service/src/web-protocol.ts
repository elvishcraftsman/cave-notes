// Messages between the page (main thread) and the service's Web Worker on Android.
import type { WireError } from './api';
import type { FsReply } from './fs-rpc';

export interface InitInfo {
  /** the contents of sqlite3.wasm, fetched by the page (the most dependable way: no fetch or MIME type to go wrong in the worker) */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** or where the worker can fetch it from, when the bytes are not supplied */
  wasmUrl?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** name of this worker in each line of its log (a workspace's name) */
  logTag?: string;
  /** send the worker's log lines to the page (which keeps them in a file) instead of the console */
  logToHost?: boolean;
  /** what the device says about itself */
  host?: { hostname?: string; homedir?: string; tmpdir?: string; cpuCount?: number };
}

export type ToWorker =
  | ({ kind: 'init' } & InitInfo)
  | { kind: 'call'; id: number; method: string; args: unknown[] }
  | { kind: 'fs-reply'; id: number; reply: FsReply }
  /** write the search index to storage now (the app is going to the background) */
  | { kind: 'save-index'; id: number }
  | { kind: 'log-level'; level: NonNullable<InitInfo['logLevel']> };

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'init-failed'; message: string }
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: WireError }
  | { kind: 'event'; event: string; payload: unknown }
  | { kind: 'fs'; id: number; method: string; args: unknown[] }
  | { kind: 'saved'; id: number }
  /** a line of the worker's log, for the page to keep with its own */
  | { kind: 'log'; line: string };
