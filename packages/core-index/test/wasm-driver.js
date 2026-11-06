// Preloaded (node --import) to run the whole core-index suite on the SQLite WebAssembly driver instead of better-sqlite3.
// A database opened under a path is kept in memory and restored on reopen, which is what the Android app does with snapshots.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createSqliteWasmDriver } from '../src/driver-sqlite-wasm.js';
import { setDefaultDriver } from '../src/db.js';

const sqlite3 = await sqlite3InitModule();
setDefaultDriver(createSqliteWasmDriver(sqlite3, { snapshots: new Map() }));
