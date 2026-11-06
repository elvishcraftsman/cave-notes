import platformDefaultDriver from '#default-driver';

let defaultDriver = platformDefaultDriver;
/** Choose the driver used when openIndex is not given one (the Android app installs sqlite-wasm; tests run both). */
export function setDefaultDriver(driver) {
  defaultDriver = driver ?? platformDefaultDriver;
}

/** Bump when the schema changes. A mismatch drops the index and rebuilds it (it is only a cache). */
export const SCHEMA_VERSION = 6;

const DDL = `
CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,          -- workspace-relative, e.g. Theology/Soteriology.md
  parent_path TEXT,                   -- NULL for top-level pages
  name TEXT NOT NULL,                 -- file stem
  parsed_title TEXT,                  -- first H1 or frontmatter title; NULL if neither
  title TEXT NOT NULL,                -- parsed_title, else name
  is_virtual INTEGER NOT NULL DEFAULT 0,
  sort_order REAL,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL DEFAULT '',
  fm_json TEXT NOT NULL DEFAULT '{}',   -- the page's own frontmatter
  eff_json TEXT NOT NULL DEFAULT '{}'   -- inheritance state: {a: attributes, c: what reaches sub-pages, b: children blocks}
);
CREATE INDEX idx_pages_parent ON pages(parent_path);
CREATE INDEX idx_pages_hash ON pages(hash);

CREATE TABLE headings (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  slug TEXT NOT NULL,
  line INTEGER NOT NULL,
  ord INTEGER NOT NULL
);
CREATE INDEX idx_headings_page ON headings(page_id, ord);

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- page | file | web | other
  syntax TEXT NOT NULL,               -- md | wiki
  via TEXT NOT NULL,
  embed INTEGER NOT NULL DEFAULT 0,
  raw TEXT NOT NULL,
  target TEXT NOT NULL,               -- as written (decoded)
  target_name TEXT,                   -- wikilinks: last path segment, lowercase, without .md
  fragment TEXT,
  url TEXT,
  text TEXT,
  line INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- ok | broken | ambiguous | external | file | pending
  target_page_id INTEGER,             -- resolved page (kind = page, status = ok)
  target_path TEXT                    -- resolved workspace path (pages) or path as written (files)
);
CREATE INDEX idx_links_page ON links(page_id);
CREATE INDEX idx_links_target ON links(target_page_id);
CREATE INDEX idx_links_status ON links(status);
CREATE INDEX idx_links_target_name ON links(target_name);

CREATE TABLE attrs (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key TEXT NOT NULL COLLATE NOCASE,
  type TEXT NOT NULL,                 -- string | number | date | bool
  text_value TEXT NOT NULL,
  num_value REAL,                     -- numbers, dates (epoch ms), bools (0/1)
  idx INTEGER NOT NULL DEFAULT 0      -- list items are one row each
);
CREATE INDEX idx_attrs_page ON attrs(page_id, key);
CREATE INDEX idx_attrs_key_text ON attrs(key, text_value COLLATE NOCASE);
CREATE INDEX idx_attrs_key_num ON attrs(key, num_value);

CREATE TABLE page_aliases (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  alias TEXT NOT NULL COLLATE NOCASE
);
CREATE INDEX idx_aliases_page ON page_aliases(page_id);
CREATE INDEX idx_aliases_alias ON page_aliases(alias);

CREATE TABLE attr_links (   -- pages named by a children block "defaults: [[Page]]", with what was last seen of them
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  link TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',   -- path the link resolved to ('' = none)
  sig TEXT NOT NULL DEFAULT '',      -- hash of that page's attributes
  PRIMARY KEY (page_id, link)
);

CREATE TABLE diagnostics (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- frontmatter | schema | parse
  message TEXT NOT NULL
);
CREATE INDEX idx_diag_page ON diagnostics(page_id);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE VIRTUAL TABLE pages_fts USING fts5(
  title, body,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
`;

/**
 * Open (creating or rebuilding as needed) the index database. `driver` says which SQLite to use (better-sqlite3 unless the
 * platform has no native modules; see driver-better-sqlite3.js for what a driver is).
 * Returns { db, fresh } where fresh means the file had no usable index.
 */
export function openDatabase(dbPath, driver = defaultDriver) {
  let db = driver.open(dbPath);
  let version = db.pragma('user_version', { simple: true });
  let fresh = false;

  if (version !== SCHEMA_VERSION) {
    if (version !== 0) {
      // Wrong version: it is only a cache, start over.
      db.close();
      driver.destroy(dbPath);
      db = driver.open(dbPath);
    }
    db.pragma('journal_mode = WAL');
    db.exec(DDL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    fresh = true;
  } else {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return { db, fresh };
}
