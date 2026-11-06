// The Web Worker's entry point (bundled to one script by apps/mobile): the service, with SQLite as WebAssembly.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { startWebWorker, type WorkerScope } from './web-worker-core';

startWebWorker(self as unknown as WorkerScope, {
  initSqlite: (info) =>
    (sqlite3InitModule as unknown as (options?: object) => Promise<unknown>)({
      ...(info.wasmBinary ? { wasmBinary: info.wasmBinary } : {}),
      ...(info.wasmUrl ? { locateFile: () => info.wasmUrl } : {}),
    }),
});
