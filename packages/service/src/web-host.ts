// The page's side of the service's Web Worker: starts the conversation, answers the worker's file requests with a real file
// system, and presents the service as the same typed `WorkerApi` the desktop window uses.
import { WORKER_METHODS, type EventMap, type WireError, type WorkerApi } from './api';
import { serveFsCall, type FsImpl } from './fs-rpc';
import type { FromWorker, InitInfo, ToWorker } from './web-protocol';

export interface WorkerLike {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  terminate?(): void;
}

export class RemoteError extends Error {
  code?: string;
  details?: unknown;
  constructor(wire: WireError) {
    super(wire.message);
    this.name = wire.name ?? 'Error';
    this.code = wire.code;
    this.details = wire.details;
  }
}

export interface WebWorkerHost {
  /** the service's API, every call crossing to the worker */
  api: WorkerApi;
  /** resolves once the worker has set up (rejects if it could not) */
  ready: Promise<void>;
  /** listen for the service's events (index progress, changes on disk, ...); returns the function that stops listening */
  onEvent(cb: (event: keyof EventMap | string, payload: unknown) => void): () => void;
  /** write the search index to storage now; call when the app goes to the background */
  saveIndex(): Promise<void>;
  /** a line of the worker's log (when `init.logToHost` is set) */
  onLog(cb: (line: string) => void): () => void;
  setLogLevel(level: NonNullable<InitInfo['logLevel']>): void;
  terminate(): void;
}

export function createWebWorkerHost(opts: { worker: WorkerLike; fs: FsImpl; init?: InitInfo }): WebWorkerHost {
  const { worker } = opts;
  const send = (m: ToWorker): void => worker.postMessage(m);
  let nextId = 1;
  const calls = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  const saves = new Map<number, () => void>();
  const listeners = new Set<(event: string, payload: unknown) => void>();
  const logListeners = new Set<(line: string) => void>();
  let markReady!: () => void;
  let failInit!: (e: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failInit = reject;
  });
  ready.catch(() => undefined); // a caller that never looks must not trip an unhandled rejection

  worker.onmessage = (e) => {
    const m = e.data as FromWorker;
    switch (m.kind) {
      case 'ready':
        markReady();
        return;
      case 'log':
        for (const l of logListeners) l(m.line);
        return;
      case 'init-failed':
        failInit(new Error(m.message));
        return;
      case 'result': {
        const c = calls.get(m.id);
        calls.delete(m.id);
        if (!c) return;
        if (m.ok) c.resolve(m.value);
        else c.reject(new RemoteError(m.error));
        return;
      }
      case 'event':
        for (const l of listeners) l(m.event, m.payload);
        return;
      case 'fs':
        void serveFsCall(opts.fs, m.method, m.args).then((reply) => send({ kind: 'fs-reply', id: m.id, reply }));
        return;
      case 'saved':
        saves.get(m.id)?.();
        saves.delete(m.id);
        return;
    }
  };

  send({ kind: 'init', ...(opts.init ?? {}) });

  const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of WORKER_METHODS) {
    api[method] = (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        calls.set(id, { resolve, reject });
        send({ kind: 'call', id, method, args });
      });
  }

  return {
    api: api as unknown as WorkerApi,
    ready,
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    saveIndex: () =>
      new Promise<void>((resolve) => {
        const id = nextId++;
        saves.set(id, resolve);
        send({ kind: 'save-index', id });
      }),
    onLog: (cb) => {
      logListeners.add(cb);
      return () => logListeners.delete(cb);
    },
    setLogLevel: (level) => send({ kind: 'log-level', level }),
    terminate() {
      worker.terminate?.();
      worker.onmessage = null;
      for (const c of calls.values()) c.reject(new Error('the service was stopped'));
      calls.clear();
    },
  };
}
