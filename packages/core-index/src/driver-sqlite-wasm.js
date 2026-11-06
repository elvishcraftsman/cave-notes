// A database driver on the official SQLite WebAssembly build (@sqlite.org/sqlite-wasm), for places without native modules
// (the Android WebView). It gives the same statement surface as better-sqlite3, synchronously, over an in-memory database.
// The index is a cache that can always be rebuilt, so what persists is a snapshot: a database opened under a real path is saved
// into the `snapshots` map when it is closed (and whenever `db.snapshot()` is called, which the app does when idle or going to
// the background), and opening that path again restores it. The app writes the map's bytes to its private storage.
//
// The caller initialises the module (it knows where sqlite3.wasm lives) and passes it in, so this file imports nothing:
//   const sqlite3 = await sqlite3InitModule({ locateFile: (f) => ... });
//   const driver = createSqliteWasmDriver(sqlite3, { snapshots });
//
// Behaviour kept equal to better-sqlite3: named parameters are given without their prefix ({ path } for @path), booleans are
// refused instead of guessed at (undefined is NULL), get() returns undefined for no row, and transactions nest as savepoints.

const NAME_RE = /([@:$])([A-Za-z_][A-Za-z0-9_]*)/g;

function bindingsOf(sql, args) {
  if (args.length === 0) return undefined;
  const check = (v) => {
    if (typeof v === 'boolean') throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
    return v === undefined ? null : v; // better-sqlite3 binds undefined as NULL
  };
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0])) {
    const prefixes = new Map();
    for (const m of sql.matchAll(NAME_RE)) if (!prefixes.has(m[2])) prefixes.set(m[2], m[1]);
    const out = {};
    for (const [name, prefix] of prefixes) {
      if (!(name in args[0])) throw new RangeError(`Missing named parameter "${name}"`);
      out[prefix + name] = check(args[0][name]);
    }
    return out;
  }
  const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return list.map(check);
}

/**
 * @param {object} sqlite3 the initialised module
 * @param {{ snapshots?: Map<string, Uint8Array>, onSnapshot?: (path: string, bytes: Uint8Array) => void }} [opts]
 *   onSnapshot is called each time a snapshot is saved into the map, so the app can write it to storage
 */
export function createSqliteWasmDriver(sqlite3, { snapshots = new Map(), onSnapshot } = {}) {
  const { oo1, capi, wasm } = sqlite3;
  const openDbs = new Set();
  /** resolvers waiting for every database to be closed (a workspace closes its index in the background) */
  let closeWaiters = [];

  class Statement {
    #db;
    #sql;
    #stmt = null;
    constructor(db, sql) {
      this.#db = db;
      this.#sql = sql;
      this.#compile(); // fail now on bad SQL, as better-sqlite3 does
    }
    #compile() {
      this.#stmt = this.#db.raw.prepare(this.#sql);
      this.#db.statements.add(this);
    }
    #ready(args) {
      if (!this.#stmt) this.#compile();
      this.#stmt.reset(true);
      const b = bindingsOf(this.#sql, args);
      if (b !== undefined) this.#stmt.bind(b);
      return this.#stmt;
    }
    run(...args) {
      const s = this.#ready(args);
      try {
        while (s.step());
        return { changes: this.#db.raw.changes(), lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(this.#db.raw)) };
      } finally {
        s.reset(true);
      }
    }
    get(...args) {
      const s = this.#ready(args);
      try {
        return s.step() ? s.get({}) : undefined;
      } finally {
        s.reset(true);
      }
    }
    all(...args) {
      const s = this.#ready(args);
      try {
        const rows = [];
        while (s.step()) rows.push(s.get({}));
        return rows;
      } finally {
        s.reset(true);
      }
    }
    *iterate(...args) {
      const s = this.#ready(args);
      try {
        while (s.step()) yield s.get({});
      } finally {
        s.reset(true);
      }
    }
    finalize() {
      if (this.#stmt) this.#stmt.finalize();
      this.#stmt = null;
    }
  }

  class WasmDb {
    raw;
    statements = new Set();
    #depth = 0;
    #path;
    #savedAt = -1;
    constructor(raw, path) {
      this.raw = raw;
      this.#path = path;
      openDbs.add(this);
    }
    /** Whether anything changed since the last snapshot. */
    get dirty() {
      return this.#path !== ':memory:' && this.raw.selectValue('SELECT total_changes()') !== this.#savedAt;
    }
    prepare(sql) {
      return new Statement(this, sql);
    }
    exec(sql) {
      this.raw.exec(sql);
      return this;
    }
    transaction(fn) {
      return (...args) => {
        const id = this.#depth++;
        this.raw.exec(id === 0 ? 'BEGIN' : `SAVEPOINT sp${id}`);
        try {
          const result = fn(...args);
          this.raw.exec(id === 0 ? 'COMMIT' : `RELEASE sp${id}`);
          return result;
        } catch (e) {
          try {
            this.raw.exec(id === 0 ? 'ROLLBACK' : `ROLLBACK TO sp${id}; RELEASE sp${id}`);
          } catch {
            /* the original error matters more */
          }
          throw e;
        } finally {
          this.#depth--;
        }
      };
    }
    pragma(text, opts = {}) {
      const rows = this.raw.exec({ sql: `PRAGMA ${text}`, rowMode: 'object', returnValue: 'resultRows' });
      return opts.simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows;
    }
    /** The whole database as bytes (an SQLite file image), for saving a snapshot. */
    serialize() {
      return capi.sqlite3_js_db_export(this.raw);
    }
    markSaved() {
      this.#savedAt = this.raw.selectValue('SELECT total_changes()');
    }
    /** Save the current state into the snapshots map now (a no-op for an in-memory database). Returns the bytes saved. */
    snapshot() {
      if (this.#path === ':memory:') return null;
      const bytes = this.serialize();
      this.#savedAt = this.raw.selectValue('SELECT total_changes()');
      snapshots.set(this.#path, bytes);
      onSnapshot?.(this.#path, bytes);
      return bytes;
    }
    close() {
      this.snapshot();
      openDbs.delete(this);
      if (openDbs.size === 0) {
        const waiting = closeWaiters;
        closeWaiters = [];
        // after this close finishes, so a snapshot waiter sees the finished state
        queueMicrotask(() => waiting.forEach((r) => r()));
      }
      for (const s of [...this.statements]) s.finalize();
      this.statements.clear();
      this.raw.close();
    }
  }

  return {
    name: 'sqlite-wasm',
    sqliteVersion: capi.sqlite3_libversion(),
    /** `path` names a snapshot in `snapshots` (restored if present); the database itself lives in memory. */
    open(path) {
      const raw = new oo1.DB(':memory:', 'c');
      const bytes = path === ':memory:' ? undefined : snapshots.get(path);
      if (bytes) {
        const p = wasm.allocFromTypedArray(bytes);
        const rc = capi.sqlite3_deserialize(raw.pointer, 'main', p, bytes.length, bytes.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
        if (rc !== 0) {
          raw.close();
          throw new Error(`could not restore the index snapshot (sqlite error ${rc})`);
        }
      }
      const db = new WasmDb(raw, path);
      // what was restored is what is saved: nothing to write until something changes
      if (bytes) db.markSaved();
      return db;
    },
    destroy(path) {
      snapshots.delete(path);
    },
    /** Resolves when no database is open (immediately if none is). */
    allClosed() {
      return openDbs.size === 0 ? Promise.resolve() : new Promise((resolve) => closeWaiters.push(resolve));
    },
    /** Snapshot every open database that has changed since its last snapshot; returns how many were saved. */
    snapshotAll() {
      let n = 0;
      for (const db of openDbs) {
        if (db.dirty) {
          db.snapshot();
          n++;
        }
      }
      return n;
    },
  };
}
