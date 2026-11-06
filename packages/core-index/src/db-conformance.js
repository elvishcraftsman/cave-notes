// What any database driver must do, written once and run against better-sqlite3 and the SQLite WebAssembly driver.
// It covers the statement surface the indexer uses (named and positional parameters, RETURNING, transactions that nest,
// foreign keys with cascade, FTS5 with the porter tokenizer and bm25) and ends by opening the real index schema.
import assert from 'node:assert/strict';
import { openDatabase, SCHEMA_VERSION } from './db.js';

/**
 * @param {{ describe: Function, it: Function, beforeEach: Function, afterEach: Function }} t node:test functions
 * @param {string} name label
 * @param {() => object} makeDriver a driver ({ name, open, destroy })
 */
export function defineDbConformance(t, name, makeDriver) {
  t.describe(`db conformance: ${name}`, () => {
    let driver;
    let db;
    t.beforeEach(() => {
      driver = makeDriver();
      db = driver.open(':memory:');
    });
    t.afterEach(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    });

    const plain = (rows) => JSON.parse(JSON.stringify(rows));

    t.it('runs DDL and reports changes and the last inserted id', () => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, n REAL)');
      const ins = db.prepare('INSERT INTO t (name, n) VALUES (?, ?)');
      const r1 = ins.run('a', 1.5);
      const r2 = ins.run('b', 2);
      assert.equal(r1.changes, 1);
      assert.equal(r2.lastInsertRowid, r1.lastInsertRowid + 1);
      assert.equal(db.prepare('UPDATE t SET n = n + 1').run().changes, 2);
      assert.equal(db.prepare('DELETE FROM t WHERE name = ?').run('zzz').changes, 0);
    });

    t.it('get returns one row or undefined; all returns objects keyed by column name', () => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)');
      db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').run('a', 1);
      db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').run('b', 2);
      assert.deepEqual(plain(db.prepare('SELECT name, n AS count FROM t WHERE name = ?').get('b')), { name: 'b', count: 2 });
      assert.equal(db.prepare('SELECT * FROM t WHERE name = ?').get('nope'), undefined);
      assert.deepEqual(plain(db.prepare('SELECT name FROM t ORDER BY id').all()), [{ name: 'a' }, { name: 'b' }]);
      assert.deepEqual(db.prepare('SELECT name FROM t WHERE n > ?').all(99), []);
    });

    t.it('binds named parameters given without their prefix, including one used twice', () => {
      db.exec('CREATE TABLE t (path TEXT, a TEXT, b TEXT)');
      db.prepare('INSERT INTO t (path, a, b) VALUES (@path, @v, @v)').run({ path: 'x/y.md', v: 'same' });
      assert.deepEqual(plain(db.prepare('SELECT * FROM t').all()), [{ path: 'x/y.md', a: 'same', b: 'same' }]);
      assert.deepEqual(plain(db.prepare('SELECT path FROM t WHERE a = @v').get({ v: 'same' })), { path: 'x/y.md' });
    });

    t.it('keeps text, unicode, null, integers beyond 32 bits and floats exact', () => {
      db.exec('CREATE TABLE t (s TEXT, i INTEGER, f REAL, z TEXT)');
      db.prepare('INSERT INTO t VALUES (?, ?, ?, ?)').run('Héllo — “q” 日本 😀', 1_761_900_000_123, 0.1, null);
      const r = db.prepare('SELECT * FROM t').get();
      assert.equal(r.s, 'Héllo — “q” 日本 😀');
      assert.equal(r.i, 1_761_900_000_123);
      assert.equal(r.f, 0.1);
      assert.equal(r.z, null);
    });

    t.it('binds undefined as NULL, refuses booleans, and reports a missing named parameter', () => {
      db.exec('CREATE TABLE t (v)');
      const ins = db.prepare('INSERT INTO t VALUES (?)');
      ins.run(undefined);
      assert.equal(db.prepare('SELECT v FROM t').get().v, null);
      assert.throws(() => ins.run(true), TypeError);
      assert.throws(() => db.prepare('INSERT INTO t VALUES (@v)').run({}), RangeError);
    });

    t.it('reuses one prepared statement many times with different values', () => {
      db.exec('CREATE TABLE t (n INTEGER)');
      const ins = db.prepare('INSERT INTO t VALUES (?)');
      for (let i = 0; i < 200; i++) ins.run(i);
      assert.equal(db.prepare('SELECT COUNT(*) AS c, SUM(n) AS s FROM t').get().s, (199 * 200) / 2);
    });

    t.it('RETURNING works with get (the upsert the indexer uses)', () => {
      db.exec('CREATE TABLE pages (id INTEGER PRIMARY KEY, path TEXT UNIQUE, size INTEGER)');
      const up = db.prepare('INSERT INTO pages (path, size) VALUES (@path, @size) ON CONFLICT(path) DO UPDATE SET size = excluded.size RETURNING id');
      const a = up.get({ path: 'a.md', size: 1 });
      const b = up.get({ path: 'b.md', size: 2 });
      const a2 = up.get({ path: 'a.md', size: 9 });
      assert.equal(a2.id, a.id);
      assert.notEqual(a.id, b.id);
      assert.equal(db.prepare('SELECT size FROM pages WHERE id = ?').get(a.id).size, 9);
    });

    t.it('iterate yields rows one by one and can be stopped early', () => {
      db.exec('CREATE TABLE t (n INTEGER)');
      const ins = db.prepare('INSERT INTO t VALUES (?)');
      for (let i = 0; i < 10; i++) ins.run(i);
      const sel = db.prepare('SELECT n FROM t ORDER BY n');
      const seen = [];
      for (const r of sel.iterate()) {
        seen.push(r.n);
        if (seen.length === 3) break;
      }
      assert.deepEqual(seen, [0, 1, 2]);
      assert.equal(sel.all().length, 10, 'the statement is usable again after an early stop');
    });

    t.it('transactions commit, roll back on error and pass the result and arguments through', () => {
      db.exec('CREATE TABLE t (n INTEGER)');
      const add = db.transaction((a, b) => {
        db.prepare('INSERT INTO t VALUES (?)').run(a);
        db.prepare('INSERT INTO t VALUES (?)').run(b);
        return a + b;
      });
      assert.equal(add(1, 2), 3);
      const boom = db.transaction(() => {
        db.prepare('INSERT INTO t VALUES (99)').run();
        throw new Error('boom');
      });
      assert.throws(boom, /boom/);
      assert.deepEqual(plain(db.prepare('SELECT n FROM t ORDER BY n').all()), [{ n: 1 }, { n: 2 }]);
    });

    t.it('nested transactions: an inner failure undoes only the inner work when the outer catches it', () => {
      db.exec('CREATE TABLE t (n INTEGER)');
      const inner = db.transaction(() => {
        db.prepare('INSERT INTO t VALUES (2)').run();
        throw new Error('inner');
      });
      const outer = db.transaction(() => {
        db.prepare('INSERT INTO t VALUES (1)').run();
        try {
          inner();
        } catch {
          /* handled */
        }
        db.prepare('INSERT INTO t VALUES (3)').run();
      });
      outer();
      assert.deepEqual(plain(db.prepare('SELECT n FROM t ORDER BY n').all()), [{ n: 1 }, { n: 3 }]);
      const failOuter = db.transaction(() => {
        db.prepare('INSERT INTO t VALUES (4)').run();
        inner.call(null);
      });
      assert.throws(failOuter, /inner/);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM t').get().c, 2);
    });

    t.it('pragma reads and sets values, with and without simple', () => {
      assert.equal(db.pragma('user_version', { simple: true }), 0);
      db.pragma('user_version = 7');
      assert.equal(db.pragma('user_version', { simple: true }), 7);
      db.pragma('foreign_keys = ON');
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      assert.ok(Array.isArray(db.pragma('journal_mode = WAL')));
      db.pragma('synchronous = NORMAL');
    });

    t.it('foreign keys cascade deletes when enabled', () => {
      db.pragma('foreign_keys = ON');
      db.exec('CREATE TABLE pages (id INTEGER PRIMARY KEY); CREATE TABLE links (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE)');
      db.exec('INSERT INTO pages VALUES (1), (2); INSERT INTO links (page_id) VALUES (1), (1), (2)');
      db.prepare('DELETE FROM pages WHERE id = ?').run(1);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM links').get().c, 1);
    });

    t.it('FTS5: porter stemming, accent folding, prefix search and bm25 ranking', () => {
      db.exec("CREATE VIRTUAL TABLE pages_fts USING fts5(title, body, tokenize = 'porter unicode61 remove_diacritics 2')");
      const ins = db.prepare('INSERT INTO pages_fts (rowid, title, body) VALUES (?, ?, ?)');
      ins.run(1, 'Café notes', 'running runners ran quickly');
      ins.run(2, 'Other', 'nothing here');
      ins.run(3, 'Running', 'run run run');
      const ids = (q) => db.prepare('SELECT rowid FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rowid').all(q).map((r) => r.rowid);
      assert.deepEqual(ids('runs'), [1, 3], 'porter');
      assert.deepEqual(ids('cafe'), [1], 'accents');
      assert.deepEqual(ids('runn*'), [1], 'prefix (matches the stored stems)');
      assert.deepEqual(ids('run*'), [1, 3], 'shorter prefix');
      assert.deepEqual(ids('nothing AND here'), [2]);
      const ranked = db.prepare('SELECT rowid FROM pages_fts WHERE pages_fts MATCH ? ORDER BY bm25(pages_fts, 10.0, 1.0)').all('run*').map((r) => r.rowid);
      assert.equal(ranked[0], 3, 'a title hit with repeats ranks first');
      db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(2);
      assert.deepEqual(ids('nothing'), []);
    });

    t.it('exec accepts several statements; bad SQL throws', () => {
      db.exec('CREATE TABLE a (x); CREATE TABLE b (y); INSERT INTO a VALUES (1);');
      assert.equal(db.prepare('SELECT x FROM a').get().x, 1);
      assert.throws(() => db.prepare('SELEC nonsense'));
      assert.throws(() => db.exec('INSERT INTO missing VALUES (1)'));
    });

    t.it('handles a few thousand rows in one transaction', () => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT)');
      const ins = db.prepare('INSERT INTO t (s) VALUES (?)');
      db.transaction(() => {
        for (let i = 0; i < 5000; i++) ins.run(`row ${i}`);
      })();
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM t').get().c, 5000);
    });

    t.it('opens the real index schema fresh, and a wrong version is dropped and rebuilt', () => {
      const first = openDatabase(':memory:', driver);
      assert.equal(first.fresh, true);
      assert.equal(first.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
      const tables = first.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pages', 'links', 'headings', 'attrs', 'pages_fts') ORDER BY name").all();
      assert.deepEqual(tables.map((r) => r.name), ['attrs', 'headings', 'links', 'pages', 'pages_fts']);
      first.db.close();
    });
  });
}
