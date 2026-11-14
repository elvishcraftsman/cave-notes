// The service inside a Web Worker. Everything the service needs from the machine arrives over the message channel
// (files through fs-rpc, the SQLite module from the caller), so this runs unchanged in a real Web Worker on Android and,
// in tests, in a Node worker thread or in the same thread over a MessageChannel.
import { fs, path, setFs, setHost } from '@cave-notes/platform';
import { createSqliteWasmDriver } from '@cave-notes/core-index/driver-sqlite-wasm';
import { createFsClient, type FsImpl, type FsReply } from './fs-rpc';
import { configureLog, isLevel, log, setLogLevel } from './log';
import { toWireError, WorkspaceService } from './service';
import type { FromWorker, InitInfo, ToWorker } from './web-protocol';

export interface WorkerScope {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface WorkerDeps {
  /** initialise the SQLite WebAssembly module (the page knows where its .wasm file is) */
  initSqlite(info: InitInfo): Promise<unknown>;
  /** how often to save the search index while the app is open, in ms (default 30 s) */
  snapshotEveryMs?: number;
}

/** Starts the service on this scope; returns a function that stops its timers. */
export function startWebWorker(scope: WorkerScope, deps: WorkerDeps): () => void {
  const post = (m: FromWorker): void => scope.postMessage(m);

  // ---- files, asked of the page
  let nextFsId = 1;
  const pendingFs = new Map<number, (r: FsReply) => void>();
  const fsClient = createFsClient(
    (method, args) =>
      new Promise<FsReply>((resolve) => {
        const id = nextFsId++;
        pendingFs.set(id, resolve);
        post({ kind: 'fs', id, method, args });
      }),
  );

  // ---- the search index: lives in memory, saved to storage as snapshots
  const snapshots = new Map<string, Uint8Array>();
  const toWrite = new Map<string, Uint8Array>();
  let writing: Promise<void> = Promise.resolve();
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  const writeSnapshots = (): Promise<void> => {
    clearTimeout(writeTimer);
    writing = writing.then(async () => {
      for (const [file, bytes] of [...toWrite]) {
        toWrite.delete(file);
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          const tmp = `${file}.tmp`;
          await fs.writeFile(tmp, bytes);
          await fs.rename(tmp, file);
          log.debug(`index snapshot saved: ${file} (${Math.round(bytes.length / 1024)} KB)`);
        } catch (e) {
          log.warn(`could not save the index snapshot ${file} (it will be rebuilt next time)`, e);
        }
      }
    });
    return writing;
  };

  let service: WorkspaceService | null = null;
  let snapshotAll: () => number = () => 0;
  let allClosed: () => Promise<void> = () => Promise.resolve();
  /** set while a closed workspace's index is still being shut down (and so snapshotted) in the background */
  let closing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const init = async (info: InitInfo): Promise<void> => {
    configureLog({ file: null, level: isLevel(info.logLevel) ? info.logLevel : 'info', tag: info.logTag ?? 'web-worker', mirror: !info.logToHost, sink: info.logToHost ? (line) => post({ kind: 'log', line }) : null });
    setFs(fsClient as never);
    if (info.host) setHost({ ...(info.host.hostname ? { hostname: () => info.host!.hostname! } : {}), ...(info.host.homedir ? { homedir: () => info.host!.homedir! } : {}), ...(info.host.tmpdir ? { tmpdir: () => info.host!.tmpdir! } : {}), ...(info.host.cpuCount ? { cpuCount: () => info.host!.cpuCount! } : {}) });
    const sqlite3 = await deps.initSqlite(info);
    const driver = createSqliteWasmDriver(sqlite3, {
      snapshots,
      onSnapshot: (file, bytes) => {
        toWrite.set(file, bytes);
        clearTimeout(writeTimer);
        writeTimer = setTimeout(() => void writeSnapshots(), 2000);
      },
    });
    snapshotAll = () => driver.snapshotAll();
    allClosed = () => driver.allClosed();
    service = new WorkspaceService((event, payload) => post({ kind: 'event', event, payload }), {
      workers: 0,
      driver,
      // restore the saved index (if there is one) before the database opens
      prepareIndex: async (dbPath) => {
        if (snapshots.has(dbPath)) return;
        try {
          snapshots.set(dbPath, (await fs.readFile(dbPath)) as Uint8Array);
          log.info(`restored the saved index: ${dbPath}`);
        } catch {
          log.info('no saved index: it will be built from the files');
        }
      },
    });
    // The index is saved now and then (and always when the app goes to the background). Saving writes the whole database, which on
    // a big workspace takes seconds and, on a phone, keeps the file layer busy: so the wait grows with what the last save cost.
    const every = deps.snapshotEveryMs ?? 120_000;
    const tick = (): void => {
      const t0 = Date.now();
      let saved = 0;
      try {
        saved = snapshotAll();
      } finally {
        const took = Date.now() - t0;
        if (!stopped) timer = setTimeout(tick, saved > 0 ? Math.max(every, took * 60) : every);
      }
    };
    timer = setTimeout(tick, every);
    log.info(`service ready (sqlite ${driver.sqliteVersion})`);
  };

  scope.onmessage = (e) => {
    const m = e.data as ToWorker;
    switch (m.kind) {
      case 'init':
        init(m).then(
          () => post({ kind: 'ready' }),
          (err) => post({ kind: 'init-failed', message: String((err as Error)?.message ?? err) }),
        );
        return;
      case 'fs-reply': {
        const resolve = pendingFs.get(m.id);
        pendingFs.delete(m.id);
        resolve?.(m.reply);
        return;
      }
      case 'log-level':
        if (isLevel(m.level)) setLogLevel(m.level);
        return;
      case 'save-index':
        void (async () => {
          await closing;
          snapshotAll();
          await writeSnapshots();
          post({ kind: 'saved', id: m.id });
        })();
        return;
      case 'call': {
        const { id, method, args } = m;
        if (!service) {
          post({ kind: 'result', id, ok: false, error: { message: 'The service is not ready yet', code: 'NOT_READY' } });
          return;
        }
        service.call(method, args ?? []).then(
          async (value) => {
            post({ kind: 'result', id, ok: true, value });
            // closing a workspace shuts its index down in the background, which snapshots it: get that to storage
            if (method === 'closeWorkspace') {
              closing = allClosed()
                .then(() => writeSnapshots())
                .finally(() => {
                  closing = null;
                });
            }
          },
          (err) => post({ kind: 'result', id, ok: false, error: toWireError(err) }),
        );
        return;
      }
    }
  };

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(writeTimer);
    scope.onmessage = null;
  };
}

export type { FsImpl };
