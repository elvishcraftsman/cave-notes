// The default database driver (Node and Electron): better-sqlite3, a file on disk in WAL mode.
// A driver is { name, open(path) -> Db, destroy(path) }; a Db is better-sqlite3's own object, or an adapter with the same
// surface: prepare(sql) -> { run, get, all, iterate }, exec, transaction, pragma, close (see db-conformance.js).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const betterSqlite3Driver = {
  name: 'better-sqlite3',
  open(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    return new Database(dbPath);
  },
  /** Delete the database and its WAL side files (the index is only a cache, so a wrong version is simply started over). */
  destroy(dbPath) {
    if (dbPath === ':memory:') return;
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  },
};

export default betterSqlite3Driver;
