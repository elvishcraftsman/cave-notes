import { fs, path, sha1, utf8Text } from '@cave-notes/platform';
import { openTree, pageName, pageFolder, normalizePagePath, ancestors, noteExtensions, extOf } from '@cave-notes/core-tree';
import { parse as mdParse, setPageExtensions, splitWorkspaceTarget } from '@cave-notes/core-md';
import { openDatabase } from './db.js';
import { mergeSection } from './global-tag.js';
import { readConfig } from './config.js';
import { EMPTY_TYPE, buildAttrs, linkTarget, normalizeGlobals, normalizeSchema, ownAttributes, parseSchemaText, parseState, resolveInheritance, rootState, serializeState } from './attrs.js';
import { toPlain, makeSnippet } from './plain.js';
import { buildLookup, resolvePageLink, resolveFilePath } from './resolve.js';
import { stripNoteExt, pageByStem } from './exts.js';
import { expandSaved, normalizeQueries, normalizeRelations } from './saved.js';
import { parseQuery, compileQuery, hiddenWhere, hiddenIdsSql, HIGHLIGHT_START, HIGHLIGHT_END } from './query.js';
import { ParsePool } from '#parse-pool';

const posix = path.posix;
const tick = () => new Promise((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Open the index for a workspace. Nothing is scanned until you call `reconcile()`.
 *
 * @param {string} rootDir
 * @param {object} [options]
 * @param {string}   [options.dbPath]      default <root>/.cave-notes/index.db (":memory:" works)
 * @param {string}   [options.configDir]   default <root>/.cave-notes: every YAML file in it is read for settings (see config.js)
 * @param {string[]} [options.ignore]      names hidden from the tree, as in core-tree
 * @param {string[]} [options.only]        show only these top-level page files (single-file mode, as in core-tree)
 * @param {number}   [options.workers]     parse in this many worker threads (default 0 = in-process)
 * @param {object}   [options.driver]      the database driver (default better-sqlite3; the Android app passes the sqlite-wasm driver)
 * @param {object}   [options.tree]        an existing core-tree instance
 * @param {(text: string) => object} [options.parser]  override the parser (in-process mode only; for tests)
 */
export async function openIndex(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const wsDir = path.join(root, '.cave-notes');
  const dbPath = options.dbPath ?? path.join(wsDir, 'index.db');
  const configDir = options.configDir ?? wsDir;
  const { db, fresh } = openDatabase(dbPath, options.driver);
  const pool = options.workers > 0 ? new ParsePool(options.workers) : null;
  const parser = options.parser ?? mdParse;
  const abs = (rel) => path.join(root, ...rel.split('/'));
  setPageExtensions(noteExtensions());

  // The page that holds a page: the real file of that name (whatever its extension), else a virtual one with the child's extension.
  const known = new Map(); // folder -> page path, for the pages of the scan in progress
  function realPage(folder) {
    for (const e of noteExtensions()) {
      if (q.pageByPath.get(folder + e)) return folder + e;
    }
    return known.get(folder) ?? null;
  }
  function parentOf(p) {
    const dir = path.posix.dirname(p);
    if (dir === '.') return null;
    return realPage(dir) ?? dir + extOf(p);
  }

  // ------------------------------------------------------------------ statements
  const q = {
    pageByPath: db.prepare('SELECT id, path, is_virtual AS isVirtual, mtime_ms AS mtimeMs, size, hash, title FROM pages WHERE path = ?'),
    allPaths: db.prepare('SELECT path FROM pages WHERE is_virtual < 2'),
    allFilePaths: db.prepare('SELECT id, path, fm_json AS fm FROM pages WHERE is_virtual = 2'),
    fileDecls: db.prepare("SELECT id, path, fm_json AS fm FROM pages WHERE is_virtual < 2 AND fm_json LIKE '%files%'"),
    underPrefix: db.prepare("SELECT id, path FROM pages WHERE is_virtual < 2 AND path LIKE ? ESCAPE '\\'"),
    orderOf: db.prepare('SELECT sort_order AS o FROM pages WHERE path = ?'),
    upsertPage: db.prepare(`
      INSERT INTO pages (path, parent_path, name, parsed_title, title, is_virtual, sort_order, mtime_ms, size, hash, fm_json, eff_json)
      VALUES (@path, @parent_path, @name, @parsed_title, @title, @is_virtual, @sort_order, @mtime_ms, @size, @hash, @fm_json, @fm_json)
      ON CONFLICT(path) DO UPDATE SET parent_path = excluded.parent_path, name = excluded.name,
        parsed_title = excluded.parsed_title, title = excluded.title, is_virtual = excluded.is_virtual,
        sort_order = excluded.sort_order, mtime_ms = excluded.mtime_ms, size = excluded.size,
        hash = excluded.hash, fm_json = excluded.fm_json
      RETURNING id`),
    delHeadings: db.prepare('DELETE FROM headings WHERE page_id = ?'),
    delLinks: db.prepare('DELETE FROM links WHERE page_id = ?'),
    delAttrs: db.prepare('DELETE FROM attrs WHERE page_id = ?'),
    delAttrLinks: db.prepare('DELETE FROM attr_links WHERE page_id = ?'),
    insAttrLink: db.prepare('INSERT OR IGNORE INTO attr_links(page_id, link) VALUES (?, ?)'),
    allAttrLinks: db.prepare('SELECT page_id, link, target, sig FROM attr_links'),
    setAttrLink: db.prepare('UPDATE attr_links SET target = ?, sig = ? WHERE page_id = ? AND link = ?'),
    delAliases: db.prepare('DELETE FROM page_aliases WHERE page_id = ?'),
    delDiag: db.prepare('DELETE FROM diagnostics WHERE page_id = ?'),
    delDiagKind: db.prepare('DELETE FROM diagnostics WHERE page_id = ? AND kind = ?'),
    insHeading: db.prepare('INSERT INTO headings (page_id, level, text, slug, line, ord) VALUES (?, ?, ?, ?, ?, ?)'),
    insLink: db.prepare(`INSERT INTO links (page_id, kind, syntax, via, embed, raw, target, target_name, fragment, url, text, line, status, target_path)
      VALUES (@page_id, @kind, @syntax, @via, @embed, @raw, @target, @target_name, @fragment, @url, @text, @line, @status, @target_path)`),
    insAttr: db.prepare('INSERT INTO attrs (page_id, key, type, text_value, num_value, idx) VALUES (?, ?, ?, ?, ?, ?)'),
    insAlias: db.prepare('INSERT INTO page_aliases (page_id, alias) VALUES (?, ?)'),
    insDiag: db.prepare('INSERT INTO diagnostics (page_id, kind, message) VALUES (?, ?, ?)'),
    delFts: db.prepare('DELETE FROM pages_fts WHERE rowid = ?'),
    insFts: db.prepare('INSERT INTO pages_fts (rowid, title, body) VALUES (?, ?, ?)'),
    setFtsTitle: db.prepare('UPDATE pages_fts SET title = ? WHERE rowid = ?'),
    delPage: db.prepare('DELETE FROM pages WHERE id = ?'),
    effOf: db.prepare('SELECT id, path, fm_json AS fm, eff_json AS eff, is_virtual AS isVirtual FROM pages WHERE id = ?'),
    effByPath: db.prepare('SELECT eff_json AS eff FROM pages WHERE path = ?'),
    childIds: db.prepare('SELECT id FROM pages WHERE is_virtual < 2 AND parent_path = (SELECT path FROM pages WHERE id = ?)'),
    setEff: db.prepare('UPDATE pages SET eff_json = ? WHERE id = ?'),
    setOrder: db.prepare('UPDATE pages SET sort_order = ? WHERE id = ?'),
    allForEff: db.prepare('SELECT id, path, fm_json AS fm FROM pages WHERE is_virtual < 2'),
    touch: db.prepare('UPDATE pages SET mtime_ms = ?, size = ? WHERE id = ?'),
    move: db.prepare(`UPDATE pages SET path = @path, parent_path = @parent_path, name = @name,
      title = COALESCE(parsed_title, @name), mtime_ms = @mtime_ms, size = @size WHERE id = @id`),
    resetInbound: db.prepare("UPDATE links SET target_page_id = NULL, target_path = NULL, status = 'pending' WHERE target_page_id = ?"),
    aliasesOf: db.prepare('SELECT alias FROM page_aliases WHERE page_id = ? ORDER BY alias'),
    lookupPages: db.prepare('SELECT id, path, name, title FROM pages WHERE is_virtual < 2'),
    lookupAliases: db.prepare('SELECT page_id, alias FROM page_aliases'),
    linksOfPage: db.prepare("SELECT * FROM links WHERE page_id = ? AND kind = 'page'"),
    linksUnresolved: db.prepare("SELECT * FROM links WHERE kind = 'page' AND status IN ('pending', 'broken', 'ambiguous')"),
    linksWiki: db.prepare("SELECT * FROM links WHERE kind = 'page' AND syntax = 'wiki'"),
    setLink: db.prepare('UPDATE links SET status = ?, target_page_id = ?, target_path = ? WHERE id = ?'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  // ------------------------------------------------------------------ schema
  let schema = { attributes: new Map() };
  let schemaWarnings = [];
  let schemaHash = '';
  // the workspace's global attributes (the weakest source of attributes, handed to every page)
  let globals = {};
  // `files:` of workspace.yaml: attributes for files that are not notes (paths from the workspace root)
  let globalFiles = null;
  let globalsWarnings = [];
  let globalsHash = '';
  // saved queries and relations (workspace.yaml: `queries`, `relations`); kept in memory, they are not part of the cache
  let savedQueries = [];
  let savedByName = new Map();
  let relations = [];
  let savedHash = '';

  /** Settings other workspaces on this computer offer and this person approved: { attributes, schemaAttributes, queries, relations } */
  let inherited = {};

  /**
   * Read the settings files (all YAML files of the folder, see config.js) and work out the schema and the global settings.
   * `invalid` means a file could not be read as YAML: the caller keeps what it had.
   */
  async function readSettings() {
    const cfg = await readConfig(configDir);
    const sec = cfg.sections;
    const has = (k) => cfg.present.has(k);

    // the schema: `schema:` is a map of attribute names to their types
    const schemaRaw = mergeSection(sec.schema, has('schema'), inherited.schemaAttributes, 'map');
    const schemaPart =
      schemaRaw && typeof schemaRaw === 'object' && Object.keys(schemaRaw).length > 0
        ? { ...normalizeSchema({ attributes: schemaRaw }), hash: sha1(JSON.stringify(schemaRaw)) }
        : { schema: { attributes: new Map() }, warnings: [], hash: '' };

    if (cfg.invalid) return { invalid: true, loaded: schemaPart, warnings: cfg.warnings };

    const attributesRaw = mergeSection(sec.attributes, has('attributes'), inherited.attributes, 'map');
    const queriesRaw = mergeSection(sec.queries, has('queries'), inherited.queries, 'map');
    const relationsRaw = mergeSection(sec.relations, has('relations'), inherited.relations, 'seq');
    const r = normalizeGlobals(attributesRaw);
    const qn = normalizeQueries(queriesRaw);
    const rn = normalizeRelations(relationsRaw, qn.queries);
    return {
      invalid: false,
      loaded: schemaPart,
      g: {
        globals: r.globals,
        files: sec.files ?? null,
        queries: qn.queries,
        relations: rn.relations,
        warnings: [...cfg.warnings, ...r.problems, ...qn.problems, ...rn.problems],
        hash: Object.keys(r.globals).length ? sha1(JSON.stringify(r.globals)) : '',
        savedHash: qn.queries.length || rn.relations.length ? sha1(JSON.stringify([qn.queries, rn.relations])) : '',
      },
    };
  }

  /** Rewrite one page's attribute rows (and diagnostics) from what it ends up with. Returns its `order`. */
  function writeAttrs(id, st) {
    const a = buildAttrs(st.attributes, schema);
    q.delAttrs.run(id);
    q.delDiagKind.run(id, 'schema');
    q.delDiagKind.run(id, 'inheritance');
    q.delAttrLinks.run(id);
    for (const b of st.blocks) if (b.defaults === 'link') q.insAttrLink.run(id, b.link);
    for (const r of a.rows) q.insAttr.run(id, r.key, r.type, r.text, r.num, r.idx);
    for (const msg of a.problems) q.insDiag.run(id, 'schema', msg);
    for (const msg of st.problems) q.insDiag.run(id, 'inheritance', msg);
    return a.order;
  }

  const parseJson = (text) => {
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };

  /** The attributes of the page a `defaults: [[Page]]` names; `states` holds results not stored yet. null when there is no such page. */
  function linkedAttributes(text, states) {
    const t = linkTarget(text)?.target;
    const row = t ? resolveRef(t) : null;
    if (!row) return null;
    const st = states?.get(row.path);
    if (st) return st.attributes;
    const stored = q.effByPath.get(row.path);
    return stored ? parseState(stored.eff).attributes : null;
  }

  /** What a link points to now, as stored in attr_links: its path and a hash of its attributes. */
  function linkSignature(link) {
    const t = linkTarget(link)?.target;
    const row = t ? resolveRef(t) : null;
    if (!row) return { target: '', sig: '' };
    const stored = q.effByPath.get(row.path);
    return { target: row.path, sig: sha1(JSON.stringify(stored ? parseState(stored.eff).attributes : {})) };
  }

  /** Recompute every page's attributes (the schema or the global attributes changed): parents before children. */
  function rebuildAttrs() {
    const pages = q.allForEff.all().sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    let previous = new Map();
    // a page can take its values from any other page, so repeat until nothing moves (only when some page does)
    for (let pass = 0; pass < 6; pass++) {
      const states = new Map();
      let hasLinks = false;
      let moved = false;
      db.transaction(() => {
        for (const p of pages) {
          const parent = parentOf(p.path);
          const parentState = parent ? (states.get(parent) ?? parseState('')) : rootState(globals);
          const st = resolveInheritance(parseJson(p.fm), parentState, globals, (text) => linkedAttributes(text, states.size ? new Map([...previous, ...states]) : previous));
          states.set(p.path, st);
          if (st.blocks.some((b) => b.defaults === 'link')) hasLinks = true;
          if (serializeState(st) !== serializeState(previous.get(p.path) ?? parseState(''))) moved = true;
          q.setOrder.run(writeAttrs(p.id, st), p.id);
          q.setEff.run(serializeState(st), p.id);
        }
      })();
      previous = states;
      if (!hasLinks || !moved) break;
    }
    for (const d of q.allAttrLinks.all()) {
      const { target, sig } = linkSignature(d.link);
      q.setAttrLink.run(target, sig, d.page_id, d.link);
    }
  }

  /**
   * Work out the attributes of pages written or moved in a batch, and of the sub-pages that follow
   * from them. `ids` are the pages touched by the batch; `ownBased` are those among them that were
   * just (re)written from their file, so their attribute rows are gone and must be written again
   * (the others, moved pages, keep their rows until something above them changes what they get).
   * A page whose state differs from the stored one passes the difference on to its sub-pages.
   * Pages that take their values from a linked page (`defaults: [[Page]]`) follow that page too.
   * Must run inside the batch transaction.
   */
  function applyInheritance(ids, ownBased) {
    const rows = [...ids].map((id) => q.effOf.get(id)).filter(Boolean);
    rows.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    const visit = (row, done) => {
      if (done.has(row.id)) return;
      done.add(row.id);
      const parent = parentOf(row.path);
      const parentRow = parent ? q.effByPath.get(parent) : null;
      const parentState = parent ? (parentRow ? parseState(parentRow.eff) : parseState('')) : rootState(globals);
      const st = resolveInheritance(parseJson(row.fm), parentState, globals, (text) => linkedAttributes(text));
      const stText = serializeState(st);
      const before = parseState(row.eff).attributes;
      if (ownBased.has(row.id) || JSON.stringify(st.attributes) !== JSON.stringify(before)) q.setOrder.run(writeAttrs(row.id, st), row.id);
      if (stText === row.eff) return;
      q.setEff.run(stText, row.id);
      for (const c of q.childIds.all(row.id)) {
        const child = q.effOf.get(c.id);
        if (child) visit(child, done);
      }
    };
    const done = new Set();
    for (const row of rows) visit(row, done);
    // pages that take their values from a linked page: has the linked page (or what the link means) changed?
    for (let round = 0; round < 6; round++) {
      const stale = [];
      for (const d of q.allAttrLinks.all()) {
        const now = linkSignature(d.link);
        if (now.target !== d.target || now.sig !== d.sig) stale.push({ d, now });
      }
      if (stale.length === 0) break;
      const again = new Set();
      for (const { d, now } of stale) {
        q.setAttrLink.run(now.target, now.sig, d.page_id, d.link);
        const own = q.effOf.get(d.page_id);
        if (own) again.add(own.id);
      }
      for (const id of again) for (const c of q.childIds.all(id)) {
        const child = q.effOf.get(c.id);
        if (child) visit(child, new Set());
      }
    }
  }

  {
    const st = await readSettings();
    schema = st.loaded.schema;
    schemaWarnings = st.loaded.warnings;
    schemaHash = st.loaded.hash;
    if (!st.invalid) {
      globals = st.g.globals;
      globalsHash = st.g.hash;
      setSaved(st.g);
      globalFiles = st.g.files ?? null;
    }
    globalsWarnings = st.invalid ? st.warnings : st.g.warnings;
    const stored = q.getMeta.get('schema_hash')?.value ?? '';
    const storedGlobals = q.getMeta.get('globals_hash')?.value ?? '';
    if (!fresh && (stored !== schemaHash || storedGlobals !== globalsHash)) rebuildAttrs();
    q.setMeta.run('schema_hash', schemaHash);
    q.setMeta.run('globals_hash', globalsHash);
  }

  // ------------------------------------------------------------------ tree
  const tree =
    options.tree ??
    openTree(root, {
      ignore: options.ignore,
      ...(options.only ? { only: options.only } : {}),
      orderOf: (p) => q.orderOf.get(p)?.o ?? undefined,
    });

  // ------------------------------------------------------------------ writing pages
  function clearChildren(id) {
    q.delHeadings.run(id);
    q.delLinks.run(id);
    q.delAttrs.run(id);
    q.delAliases.run(id);
    q.delDiag.run(id);
  }

  /** Write one parsed page. Returns { id, namesChanged }. */
  function writePage(item, parsed) {
    const p = item.path;
    const name = pageName(p);
    const fm = parsed.frontmatter;
    const a = buildAttrs(ownAttributes(fm.data), schema); // only for `order` and `aliases`; the rows are written by applyInheritance
    const title = parsed.title ?? name;

    const old = q.pageByPath.get(p);
    const oldAliases = old ? q.aliasesOf.all(old.id).map((r) => r.alias).join('\u0000') : '';

    const { id } = q.upsertPage.get({
      path: p,
      parent_path: parentOf(p),
      name,
      parsed_title: parsed.title,
      title,
      is_virtual: 0,
      sort_order: a.order,
      mtime_ms: item.mtimeMs,
      size: item.size,
      hash: item.hash,
      fm_json: JSON.stringify(fm.data),
    });
    clearChildren(id);

    for (const h of parsed.headings) q.insHeading.run(id, h.level, h.text, h.slug, h.line, h.ord);
    for (const l of parsed.links) {
      const isPage = l.kind === 'page';
      q.insLink.run({
        page_id: id,
        kind: l.kind,
        syntax: l.syntax,
        via: l.via,
        embed: l.embed ? 1 : 0,
        raw: l.raw,
        target: l.target,
        target_name: l.syntax === 'wiki' ? stripNoteExt(l.target).split('/').pop().toLowerCase() : null,
        fragment: l.fragment,
        url: l.url,
        text: l.text,
        line: l.line,
        status: isPage ? 'pending' : l.kind === 'file' ? 'file' : 'external',
        target_path: l.kind === 'file' ? resolveFilePath(l.target, p) : null,
      });
    }
    for (const alias of a.aliases) q.insAlias.run(id, alias);
    if (fm.error) q.insDiag.run(id, 'frontmatter', fm.error);
    if (parsed.error) q.insDiag.run(id, 'parse', parsed.error);

    q.delFts.run(id);
    q.insFts.run(id, title, toPlain(item.text.slice(fm.endOffset)));

    const newAliases = [...a.aliases].sort((x, y) => x.localeCompare(y)).join('\u0000');
    const namesChanged = !old || old.isVirtual || old.title !== title || oldAliases.toLowerCase() !== newAliases.toLowerCase();
    return { id, namesChanged };
  }

  function writeVirtual(p) {
    const name = pageName(p);
    const { id } = q.upsertPage.get({
      path: p, parent_path: parentOf(p), name, parsed_title: null, title: name, is_virtual: 1,
      sort_order: null, mtime_ms: 0, size: 0, hash: '', fm_json: '{}',
    });
    clearChildren(id);
    q.delFts.run(id);
    q.insFts.run(id, name, '');
    return id;
  }

  // ------------------------------------------------------------------ link resolution
  let lookupCache = null;
  function getLookup() {
    if (lookupCache) return lookupCache;
    const aliases = new Map();
    for (const r of q.lookupAliases.all()) {
      const list = aliases.get(r.page_id);
      if (list) list.push(r.alias);
      else aliases.set(r.page_id, [r.alias]);
    }
    const rows = q.lookupPages.all().map((r) => ({ ...r, aliases: aliases.get(r.id) ?? [] }));
    lookupCache = buildLookup(rows);
    lookupCache.byId = new Map(rows.map((r) => [r.id, r]));
    return lookupCache;
  }

  function resolveLinks(dirtyIds, namesChanged) {
    if (namesChanged) lookupCache = null;
    const todo = new Map();
    for (const id of dirtyIds) for (const l of q.linksOfPage.all(id)) todo.set(l.id, l);
    for (const l of q.linksUnresolved.all()) todo.set(l.id, l);
    if (namesChanged) for (const l of q.linksWiki.all()) todo.set(l.id, l);
    if (todo.size === 0) return;
    const lookup = getLookup();
    for (const l of todo.values()) {
      const from = lookup.byId.get(l.page_id);
      if (!from) continue;
      const r = resolvePageLink(l, from.path, from, lookup);
      const id = r.row?.id ?? null;
      const tp = r.targetPath ?? null;
      if (l.status !== r.status || l.target_page_id !== id || l.target_path !== tp) q.setLink.run(r.status, id, tp, l.id);
    }
  }

  // ------------------------------------------------------------------ batch engine
  async function parseAll(items) {
    const out = new Array(items.length);
    if (pool) {
      const res = await Promise.all(items.map((it) => pool.parse(it.text)));
      res.forEach((r, k) => (out[k] = r));
    } else {
      for (let i = 0; i < items.length; i++) {
        out[i] = parser(items[i].text);
        if ((i & 15) === 15) await tick();
      }
    }
    return out;
  }

  /**
   * files:    Map<path, {mtimeMs, size}>  pages whose files exist
   * virtuals: Set<path>                   pages that exist only as folders
   * missing:  Set<path>                   pages known to be gone
   */
  async function processBatch({ files, virtuals, missing }, defer = null) {
    const t0 = performance.now();
    const stats = { added: 0, changed: 0, moved: 0, removed: 0, unchanged: 0, touched: 0, virtual: 0, ms: 0 };
    const toIndex = [];
    const touches = [];

    const entries = [...files.entries()];
    for (let i = 0; i < entries.length; i += 64) {
      await Promise.all(
        entries.slice(i, i + 64).map(async ([p, st]) => {
          const mtimeMs = st.mtimeMs; // full sub-millisecond precision: same-size edits in the same millisecond must differ
          const row = q.pageByPath.get(p);
          if (row && !row.isVirtual && row.mtimeMs === mtimeMs && row.size === st.size) {
            stats.unchanged++;
            return;
          }
          let buf;
          try {
            buf = await fs.readFile(abs(p));
          } catch (e) {
            if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
              missing.add(p);
              return;
            }
            throw e;
          }
          const hash = sha1(buf);
          if (row && !row.isVirtual && row.hash === hash) {
            touches.push({ id: row.id, mtimeMs, size: st.size });
            stats.touched++;
            return;
          }
          toIndex.push({ path: p, text: utf8Text(buf), hash, mtimeMs, size: st.size, existing: row ?? null, moveFrom: null });
        }),
      );
    }

    // Rows whose files are gone. A new file with identical content is treated as a move.
    const removedRows = [];
    for (const p of missing) {
      if (files.has(p) || virtuals.has(p)) continue;
      const row = q.pageByPath.get(p);
      if (row) removedRows.push(row);
    }
    const byHash = new Map();
    for (const r of removedRows) {
      if (r.isVirtual || !r.hash) continue;
      const list = byHash.get(r.hash);
      if (list) list.push(r);
      else byHash.set(r.hash, [r]);
    }
    const claimed = new Set();
    for (const it of toIndex) {
      if (it.existing) continue;
      const cand = byHash.get(it.hash)?.shift();
      if (cand) {
        it.moveFrom = cand;
        claimed.add(cand.id);
      }
    }

    const toParse = toIndex.filter((it) => !it.moveFrom);
    const parsed = await parseAll(toParse);

    db.transaction(() => {
      let namesChanged = false;
      const dirty = new Set();
      const ownBased = new Set();

      for (const r of removedRows) {
        q.resetInbound.run(r.id);
        if (claimed.has(r.id)) continue;
        q.delFts.run(r.id);
        q.delPage.run(r.id);
        stats.removed++;
        namesChanged = true;
      }

      for (const it of toIndex) {
        if (!it.moveFrom) continue;
        const id = it.moveFrom.id;
        q.resetInbound.run(id);
        q.move.run({ id, path: it.path, parent_path: parentOf(it.path), name: pageName(it.path), mtime_ms: it.mtimeMs, size: it.size });
        const title = q.pageByPath.get(it.path).title;
        q.setFtsTitle.run(title, id);
        dirty.add(id);
        stats.moved++;
        namesChanged = true;
      }

      for (const p of virtuals) {
        const row = q.pageByPath.get(p);
        if (row?.isVirtual) continue;
        const vid = writeVirtual(p);
        dirty.add(vid);
        ownBased.add(vid);
        stats.virtual++;
        namesChanged = true;
      }

      toParse.forEach((it, i) => {
        const r = writePage(it, parsed[i]);
        dirty.add(r.id);
        ownBased.add(r.id);
        if (r.namesChanged) namesChanged = true;
        if (it.existing && !it.existing.isVirtual) stats.changed++;
        else stats.added++;
      });

      for (const t of touches) q.touch.run(t.mtimeMs, t.size, t.id);

      applyInheritance(dirty, ownBased);
      if (defer) {
        // part of a larger run: links are resolved once, after the last part (see reconcile)
        for (const id of dirty) defer.dirty.add(id);
        if (namesChanged) defer.namesChanged = true;
      } else resolveLinks(dirty, namesChanged);
    })();

    if (!defer) await syncFiles();
    stats.ms = performance.now() - t0;
    return stats;
  }

  /** Pages to index per part, and the most text per part: bounds memory and how long the database is held at a time. */
  const PART_FILES = options.partFiles ?? 150;
  const PART_BYTES = options.partBytes ?? 6 * 1024 * 1024;

  /**
   * The same as processBatch, but a big pile of new or changed files is indexed part by part (smallest first, so most
   * pages become searchable soon), with one link-resolution pass at the end. Only when nothing was removed: removals
   * are matched with new files by content (a move), which needs them in the same part.
   */
  async function processInParts(batch) {
    const { files, virtuals, missing } = batch;
    const needs = [];
    const rest = new Map();
    for (const [p, st] of files) {
      const row = q.pageByPath.get(p);
      if (row && !row.isVirtual && row.mtimeMs === st.mtimeMs && row.size === st.size) rest.set(p, st);
      else needs.push([p, st]);
    }
    if (missing.size > 0 || needs.length <= PART_FILES) return processBatch(batch);

    needs.sort((a, b) => a[1].size - b[1].size);
    const parts = [];
    const partBytes = [];
    let cur = new Map();
    let bytes = 0;
    for (const [p, st] of needs) {
      if (cur.size > 0 && (cur.size >= PART_FILES || bytes + st.size > PART_BYTES)) {
        parts.push(cur);
        partBytes.push(bytes);
        cur = new Map();
        bytes = 0;
      }
      cur.set(p, st);
      bytes += st.size;
    }
    if (cur.size > 0) {
      parts.push(cur);
      partBytes.push(bytes);
    }
    const allBytes = Math.max(1, partBytes.reduce((a, b) => a + b, 0));
    let doneBytes = 0;
    // the unchanged files and the folder-only pages ride along with the first part
    for (const [p, st] of rest) parts[0].set(p, st);

    const defer = { dirty: new Set(), namesChanged: false };
    const total = { added: 0, changed: 0, moved: 0, removed: 0, unchanged: 0, touched: 0, virtual: 0, ms: 0 };
    const t0 = performance.now();
    for (let i = 0; i < parts.length; i++) {
      const stats = await processBatch({ files: parts[i], virtuals: i === 0 ? virtuals : new Set(), missing: new Set() }, defer);
      for (const k of Object.keys(total)) if (k !== 'ms') total[k] += stats[k];
      doneBytes += partBytes[i];
      options.onProgress?.({ phase: 'parse', done: i + 1, parts: parts.length, fraction: doneBytes / allBytes });
      await tick(); // let other work (reading pages, saving) run between parts
    }
    options.onProgress?.({ phase: 'finish', fraction: 0 });
    db.transaction(() => resolveLinks(defer.dirty, defer.namesChanged))();
    await syncFiles();
    total.ms = performance.now() - t0;
    return total;
  }


  // ------------------------------------------------------------------ files that are not notes
  /**
   * Files other than notes (images, documents ...) take part in queries when a note's `files:` block, or the
   * `files:` of workspace.yaml, gives them attributes. They are rows of the pages table with is_virtual = 2.
   * A block is a mapping of file names to attributes, or a list of mappings that name the file in `file:`.
   * Names are relative to the folder of the note that lists them (or to the note's own folder of sub-pages);
   * a leading `/` means the workspace root. Other places than the workspace are ignored.
   */
  function fileEntries(block) {
    const out = [];
    if (Array.isArray(block)) {
      for (const item of block) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const key = Object.keys(item).find((k) => k.toLowerCase() === 'file' || k.toLowerCase() === 'name');
        if (!key || typeof item[key] !== 'string') continue;
        const { [key]: name, ...attrs } = item;
        out.push([name, attrs]);
      }
    } else if (block && typeof block === 'object') {
      for (const [name, attrs] of Object.entries(block)) out.push([name, attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs : {}]);
    }
    return out;
  }

  /** Set while a full scan runs: only then are all the files of the folder listed (a watcher event does not walk the disk). */
  let walkAll = false;
  const ALL_FILES_CAP = options.allFilesCap ?? 50000;

  /** Paths of every file that is not a note: no hidden names, no links, nothing inside another workspace. */
  async function walkNonNotes() {
    const out = [];
    const hidden = new Set((options.ignore ?? []).map((n) => String(n).normalize('NFC')));
    const exts = noteExtensions();
    async function walk(rel) {
      if (out.length >= ALL_FILES_CAP) return;
      let ents;
      try {
        ents = await fs.readdir(rel === '' ? root : abs(rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of ents) {
        if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
        const r = rel === '' ? d.name : `${rel}/${d.name}`;
        if (d.isDirectory()) {
          if (hidden.has(d.name.normalize('NFC'))) continue;
          try {
            if ((await fs.lstat(path.join(abs(r), '.cave-notes'))).isDirectory()) continue; // another workspace
          } catch {
            /* an ordinary folder */
          }
          await walk(r);
        } else if (d.isFile()) {
          if (exts.some((e) => d.name.toLowerCase().endsWith(e))) continue;
          if (hidden.has(d.name.normalize('NFC'))) continue;
          out.push(r);
        }
        if (out.length >= ALL_FILES_CAP) return;
      }
    }
    await walk('');
    return out;
  }

  async function syncFiles() {
    const wanted = new Map(); // path -> { attrs, owner, ownerId }
    const missing = new Map(); // ownerId -> [names]
    const candidates = [];
    for (const r of q.fileDecls.all()) {
      const fm = parseJson(r.fm);
      const key = Object.keys(fm).find((k) => k.toLowerCase() === 'files');
      if (!key) continue;
      for (const [name, attrs] of fileEntries(fm[key])) candidates.push({ name, attrs, owner: r.path, ownerId: r.id });
    }
    for (const [name, attrs] of fileEntries(globalFiles)) candidates.push({ name, attrs, owner: null, ownerId: null });

    const clean = (name, base) => {
      let n = String(name).trim().replace(/\\/g, '/');
      if (!n) return null;
      n = n.startsWith('/') ? posix.normalize(n.slice(1)) : posix.normalize(posix.join(base, n));
      if (n === '.' || n.startsWith('..') || n.split('/').some((seg) => seg.startsWith('.') && seg !== '.')) return null;
      return n;
    };
    for (const c of candidates) {
      const ownDir = c.owner ? (posix.dirname(c.owner) === '.' ? '' : posix.dirname(c.owner)) : '';
      const tries = [clean(c.name, ownDir)];
      if (c.owner && !String(c.name).startsWith('/')) tries.push(clean(c.name, pageFolder(c.owner)));
      let found = null;
      for (const rel of tries) {
        if (!rel) continue;
        if (noteExtensions().some((e) => rel.toLowerCase().endsWith(e))) continue; // notes have their own attributes
        try {
          const st = await fs.stat(abs(rel));
          if (st.isFile()) {
            found = { rel, st };
            break;
          }
        } catch {
          /* try the next place */
        }
      }
      if (!found) {
        if (c.ownerId !== null) (missing.get(c.ownerId) ?? missing.set(c.ownerId, []).get(c.ownerId)).push(String(c.name));
        continue;
      }
      if (!wanted.has(found.rel)) wanted.set(found.rel, { ...c, ...found });
    }
    // every other file of the folder takes part too, with no attributes of its own
    if (walkAll && !options.only) {
      const rest = (await walkNonNotes()).filter((p) => !wanted.has(p));
      const stats = await statChunked(rest);
      for (const [rel, st] of stats) wanted.set(rel, { name: posix.basename(rel), attrs: {}, owner: null, ownerId: null, rel, st });
    }

    db.transaction(() => {
      for (const r of q.fileDecls.all()) {
        q.delDiagKind.run(r.id, 'files');
        for (const n of missing.get(r.id) ?? []) q.insDiag.run(r.id, 'files', `files: "${n}" was not found`);
      }
      for (const old of q.allFilePaths.all()) {
        if (wanted.has(old.path)) continue;
        // A watcher-driven pass does not walk the disk, so it only knows the declared files. Rows of plain
        // (undeclared) files must survive it; only a full scan may drop them.
        if (!walkAll && (old.fm === '{}' || old.fm === '' || old.fm == null)) continue;
        q.delFts.run(old.id);
        q.delPage.run(old.id);
      }
      for (const [rel, w] of wanted) {
        const name = posix.basename(rel);
        const own = ownAttributes(w.attrs);
        const a = buildAttrs(own, schema);
        const { id } = q.upsertPage.get({
          path: rel, parent_path: w.owner, name, parsed_title: null, title: name, is_virtual: 2,
          sort_order: a.order, mtime_ms: w.st.mtimeMs, size: w.st.size, hash: '', fm_json: JSON.stringify(w.attrs),
        });
        q.delAttrs.run(id);
        q.delDiagKind.run(id, 'schema');
        for (const r of a.rows) q.insAttr.run(id, r.key, r.type, r.text, r.num, r.idx);
        for (const msg of a.problems) q.insDiag.run(id, 'schema', msg);
        q.delFts.run(id);
        q.insFts.run(id, name, '');
      }
    })();
    lookupCache = null;
  }

  // ------------------------------------------------------------------ public: sync
  const statChunked = async (paths) => {
    const out = new Map();
    for (let i = 0; i < paths.length; i += 128) {
      await Promise.all(
        paths.slice(i, i + 128).map(async (p) => {
          try {
            const st = await fs.lstat(abs(p));
            if (st.isFile()) out.set(p, { mtimeMs: st.mtimeMs, size: st.size });
          } catch (e) {
            if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
          }
        }),
      );
    }
    return out;
  };

  /** Bring the index in line with the disk. Cheap when little has changed. */
  async function reconcile() {
    options.onProgress?.({ phase: 'scan', fraction: 0 });
    const walk = [];
    for await (const p of tree.allPages()) walk.push(p);
    known.clear();
    for (const p of walk) known.set(pageFolder(p.path), p.path);
    const real = walk.filter((p) => p.exists).map((p) => p.path);
    const virtuals = new Set(walk.filter((p) => !p.exists).map((p) => p.path));
    const files = await statChunked(real);
    const seen = new Set(walk.map((p) => p.path));
    const missing = new Set();
    for (const r of q.allPaths.iterate()) if (!seen.has(r.path)) missing.add(r.path);
    for (const p of real) if (!files.has(p)) missing.add(p);
    walkAll = true;
    options.onProgress?.({ phase: 'parse', fraction: 0 });
    try {
      return await processInParts({ files, virtuals, missing });
    } finally {
      walkAll = false;
    }
  }

  /** Re-index specific pages (e.g. from a file watcher). Unknown or invalid paths are ignored. */
  async function refresh(pagePaths) {
    const want = new Set();
    for (const raw of pagePaths) {
      let p;
      try {
        p = normalizePagePath(raw);
      } catch {
        continue;
      }
      want.add(p);
      for (const a of ancestors(p)) if (!realPage(pageFolder(a))) want.add(a);
    }
    const real = [];
    const virtuals = new Set();
    const missing = new Set();
    // pages inside a folder that is a workspace of its own do not belong to this one
    const insideOther = async (p, st) => {
      const parts = p.split('/');
      parts.pop();
      let cur = '';
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (await tree.isWorkspaceDir(cur)) return true;
      }
      return st === 'virtual' && (await tree.isWorkspaceDir(pageFolder(p)));
    };
    for (const p of want) {
      let st = await tree.status(p).catch(() => null);
      if (st && (await insideOther(p, st))) st = null;
      if (st === 'page') real.push(p);
      else if (st === 'virtual') virtuals.add(p);
      else {
        missing.add(p);
        for (const r of q.underPrefix.all(`${escapeLike(pageFolder(p))}/%`)) {
          if ((await tree.status(r.path).catch(() => null)) === null) missing.add(r.path);
        }
      }
    }
    const files = await statChunked(real);
    for (const p of real) if (!files.has(p)) missing.add(p);
    return processBatch({ files, virtuals, missing });
  }

  async function rebuild() {
    db.transaction(() => {
      for (const t of ['links', 'headings', 'attrs', 'page_aliases', 'diagnostics', 'pages']) db.exec(`DELETE FROM ${t}`);
      db.exec('DELETE FROM pages_fts');
    })();
    lookupCache = null;
    return reconcile();
  }

  // ------------------------------------------------------------------ public: reading
  const pageRow = (p) => db.prepare('SELECT id, path, parent_path AS parentPath, name, title, is_virtual AS isVirtual, sort_order AS sortOrder, mtime_ms AS mtimeMs, size FROM pages WHERE path = ?').get(p);

  function getPage(p) {
    const row = pageRow(p);
    if (!row) return null;
    const attributes = {};
    for (const a of db.prepare('SELECT key, type, text_value AS text, num_value AS num, idx FROM attrs WHERE page_id = ? ORDER BY key, idx').all(row.id)) {
      (attributes[a.key] ??= []).push({ type: a.type, text: a.text, num: a.num });
    }
    return {
      ...row,
      isVirtual: row.isVirtual === 1,
      isFile: row.isVirtual === 2,
      attributes,
      aliases: q.aliasesOf.all(row.id).map((r) => r.alias),
      diagnostics: db.prepare('SELECT kind, message FROM diagnostics WHERE page_id = ?').all(row.id),
    };
  }

  const headings = (p) =>
    db.prepare('SELECT h.level, h.text, h.slug, h.line, h.ord FROM headings h JOIN pages p ON p.id = h.page_id WHERE p.path = ? ORDER BY h.ord').all(p);

  const links = (p) =>
    db
      .prepare(`SELECT l.kind, l.syntax, l.via, l.embed, l.raw, l.target, l.fragment, l.url, l.text, l.line, l.status,
                       l.target_path AS targetPath, t.path AS resolvedPage
                FROM links l JOIN pages p ON p.id = l.page_id LEFT JOIN pages t ON t.id = l.target_page_id
                WHERE p.path = ? ORDER BY l.id`)
      .all(p)
      .map((l) => ({ ...l, embed: !!l.embed }));

  const backlinks = (p) =>
    db
      .prepare(`SELECT src.path AS fromPath, src.title AS fromTitle, l.line, l.text, l.syntax
                FROM links l JOIN pages src ON src.id = l.page_id JOIN pages t ON t.id = l.target_page_id
                WHERE t.path = ? AND src.id != t.id ORDER BY src.path, l.line`)
      .all(p);

  const folderHas = db.prepare("SELECT 1 FROM pages WHERE path LIKE ? ESCAPE '\\' LIMIT 1");
  /** A folder path ("Projects/Maps") that has pages or files in it, or null. */
  function resolveFolder(ref) {
    const name = String(ref).trim().replace(/^\/+|\/+$/g, '');
    if (!name || name.includes('..')) return null;
    return folderHas.get(`${escapeLike(name)}/%`) ? name : null;
  }

  /** Resolve a page reference given as a path, file name, title or alias. */
  function resolveRef(ref) {
    const lookup = getLookup();
    const name = String(ref).trim();
    if (!name) return null;
    const byPath = lookup.byPath.get(name) ?? pageByStem(lookup.byPath, name);
    if (byPath) return byPath;
    const r = resolvePageLink({ syntax: 'wiki', target: name }, '', null, lookup);
    return r.status === 'ok' ? r.row : null;
  }

  const linkRows = db.prepare("SELECT page_id, text_value AS text FROM attrs WHERE key = ? AND text_value LIKE '[[%' OR key = ? AND text_value LIKE '[%](%'");
  /** Ids of the pages whose attribute `key` links to the page `ref` (`doctrine: [[Scripture]]`). */
  function attrLinkPages(key, ref) {
    const page = resolveRef(ref);
    if (!page) return [];
    const ids = new Set();
    for (const r of linkRows.all(key, key)) {
      const lk = linkTarget(r.text);
      const hit = lk ? resolveRef(lk.target) : null;
      if (hit && hit.path === page.path) ids.add(r.page_id);
    }
    return [...ids];
  }

  const parentOfPath = db.prepare('SELECT parent_path FROM pages WHERE path = ?');
  /** Paths of the pages above `ref`, nearest first (for `over:` and `parent:`). */
  function ancestorsOf(ref) {
    const page = resolveRef(ref);
    if (!page) return [];
    const out = [];
    let cur = page.path;
    for (let i = 0; i < 64; i++) {
      const row = parentOfPath.get(cur);
      if (!row || !row.parent_path || out.includes(row.parent_path)) break;
      out.push(row.parent_path);
      cur = row.parent_path;
    }
    return out;
  }

  /**
   * Search and filter. Returns { results, total, errors, terms }.
   * `total` is the full match count; pass { count: false } to skip it when you only need a page.
   * `now` (a Date) is what `$now` means in the query; the clock by default.
   * Snippets mark matches with HIGHLIGHT_START / HIGHLIGHT_END control characters (never HTML).
   */
  function search(queryText, { limit = 100, offset = 0, prefixLast = true, count = true, now = undefined, hideFrom = undefined } = {}) {
    const expandErrors = [];
    const parsed = parseQuery(expandSaved(queryText, savedByName, expandErrors));
    const c = compileQuery(parsed, { resolvePage: resolveRef, resolveFolder, attrLinkPages, ancestorsOf, prefixLast, now, hideFrom }, { limit, offset });
    try {
      const results = db.prepare(c.sql).all(...c.params).map((r) => ({ ...r, isVirtual: r.isVirtual === 1, isFile: r.isVirtual === 2 }));
      if (c.hasText && results.length) {
        // Snippets are built here from the stored text: FTS5's snippet() is slow when called per row.
        const words = parsed.terms
          .filter((t) => t.type === 'text' && !t.negated)
          .flatMap((t) => t.value.split(/[^\p{L}\p{N}]+/u))
          .filter(Boolean);
        const bodies = new Map(
          db
            .prepare(`SELECT rowid, body FROM pages_fts WHERE rowid IN (${results.map(() => '?').join(',')})`)
            .all(...results.map((r) => r.id))
            .map((r) => [r.rowid, r.body]),
        );
        for (const r of results) r.snippet = makeSnippet(bodies.get(r.id), words, HIGHLIGHT_START, HIGHLIGHT_END);
      }
      let total = null;
      if (results.length < limit && (offset === 0 || results.length > 0)) total = offset + results.length;
      else if (count) total = db.prepare(c.countSql).get(...c.countParams).n;
      return { results, total, errors: [...expandErrors, ...c.errors], terms: parsed.terms };
    } catch (e) {
      return { results: [], total: 0, errors: [...expandErrors, ...c.errors, `search error: ${e.message}`], terms: parsed.terms };
    }
  }

  /** Pages a relation names, for the given pages: { path: { columnName: [{ path, title }] } }. */
  function relatedFor(paths) {
    const out = {};
    if (relations.length === 0 || paths.length === 0) return out;
    const members = new Map();
    const membersOf = (name) => {
      if (!members.has(name)) members.set(name, new Set(search(`saved:${JSON.stringify(name)}`, { limit: 5000, count: false }).results.map((r) => r.path)));
      return members.get(name);
    };
    const titleOf = new Map();
    const ownName = path.basename(root).toLowerCase();
    const pageOf = (text) => {
      const lk = linkTarget(text);
      const ref = lk ? lk.target : text;
      // a page of another workspace, `[[Workspace::path/Page]]`: it cannot be looked up here, so it is named as the link names it
      const other = splitWorkspaceTarget(ref);
      if (other && other.workspace.toLowerCase() !== ownName) {
        const p = other.target.replace(/^[\\/]+/, '');
        if (!p) return null;
        return { path: p, title: (lk?.label ?? p.split('/').pop()).replace(/\.(md|markdown|txt)$/i, ''), workspace: other.workspace };
      }
      const row = resolveRef(other ? other.target : ref);
      if (!row) return null;
      titleOf.set(row.path, row.title);
      return row;
    };
    const add = (path, column, row) => {
      const cols = (out[path] ??= {});
      const list = (cols[column] ??= []);
      if (!list.some((x) => x.path === row.path && x.workspace === row.workspace)) list.push({ path: row.path, title: row.title ?? titleOf.get(row.path) ?? row.path, ...(row.workspace ? { workspace: row.workspace } : {}) });
    };
    const pageTitle = db.prepare('SELECT path, title FROM pages WHERE path = ?');
    const attrRows = db.prepare('SELECT p.path AS path, a.text_value AS text FROM attrs a JOIN pages p ON p.id = a.page_id WHERE a.key = ? ORDER BY p.path, a.idx');
    const wanted = new Set(paths);
    for (const r of relations) {
      const to = membersOf(r.to);
      const from = membersOf(r.from);
      // the column of the pages that name others (only pages of `from` take part)
      for (const x of attrRows.all(r.attribute)) {
        const target = pageOf(x.text);
        if (!target) continue;
        // (a page of another workspace is not one of this index's pages: whether it belongs to `to` was settled when it was chosen)
        if (wanted.has(x.path) && from.has(x.path) && (target.workspace || to.has(target.path))) add(x.path, r.name, target);
        // a relation that is only worked out: the other column lists the pages that name each one
        if (!target.workspace && !r.backattribute && r.reverse && wanted.has(target.path) && from.has(x.path) && to.has(target.path)) {
          const src = pageTitle.get(x.path);
          if (src) add(target.path, r.reverse, src);
        }
      }
      // a page that can have the column but has no value still gets it (empty), so a view knows the cell is a relation to fill in
      for (const path of paths) {
        if (from.has(path)) (out[path] ??= {})[r.name] ??= [];
        if (r.reverse && to.has(path)) (out[path] ??= {})[r.reverse] ??= [];
      }
      // a mutual relation keeps the other side in an attribute of its own: that is what the other column shows
      if (r.backattribute) {
        for (const x of attrRows.all(r.backattribute)) {
          const target = pageOf(x.text);
          if (target && wanted.has(x.path) && to.has(x.path) && (target.workspace || from.has(target.path))) add(x.path, r.backname ?? r.reverse, target);
        }
      }
    }
    return out;
  }

  function attributeKeys() {
    const rows = db.prepare('SELECT key, type, COUNT(DISTINCT page_id) AS pages FROM attrs GROUP BY key, type').all();
    const byKey = new Map();
    for (const r of rows) {
      const k = r.key.toLowerCase();
      const cur = byKey.get(k) ?? { key: r.key, type: r.type === EMPTY_TYPE ? 'string' : r.type, pages: 0, best: -1, declared: false };
      cur.pages += r.pages;
      // pages that have the property but no value say nothing about its type
      if (r.type !== EMPTY_TYPE && r.pages > cur.best) {
        cur.best = r.pages;
        cur.type = r.type;
      }
      byKey.set(k, cur);
    }
    for (const [k, def] of schema.attributes) {
      const cur = byKey.get(k) ?? { key: def.key, pages: 0, best: 0 };
      cur.type = def.type === 'list' ? def.of : def.type === 'enum' ? 'string' : def.type;
      cur.declared = true;
      if (def.values) cur.values = def.values;
      if (def.type === 'list') cur.list = true;
      byKey.set(k, cur);
    }
    return [...byKey.values()]
      .map(({ best, ...rest }) => rest)
      .sort((a, b) => b.pages - a.pages || a.key.localeCompare(b.key));
  }

  /** Distinct values of an attribute with counts, optionally within the results of a query (for filter UIs). */
  function attributeValues(key, { query = '', limit = 50 } = {}) {
    const parsed = parseQuery(expandSaved(query, savedByName));
    const c = compileQuery(parsed, { resolvePage: resolveRef, resolveFolder, attrLinkPages, ancestorsOf }, {});
    const inner = `SELECT p.id FROM ${c.from} ${c.whereClause}`;
    try {
      return db
        .prepare(`SELECT a.text_value AS value, a.type AS type, COUNT(DISTINCT a.page_id) AS count
                  FROM attrs a WHERE a.key = ? AND a.text_value != '' AND a.page_id IN (${inner})
                  GROUP BY a.text_value COLLATE NOCASE ORDER BY count DESC, value COLLATE NOCASE LIMIT ?`)
        .all(key, ...c.countParams, limit);
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------ public: support for link rewriting
  /** Every page with the fields link resolution needs: { id, path, name, title, parsedTitle, isVirtual, aliases }. */
  function allPageRows() {
    const aliases = new Map();
    for (const r of q.lookupAliases.all()) {
      const list = aliases.get(r.page_id);
      if (list) list.push(r.alias);
      else aliases.set(r.page_id, [r.alias]);
    }
    return db
      .prepare('SELECT id, path, name, title, parsed_title AS parsedTitle, is_virtual AS isVirtual FROM pages WHERE is_virtual < 2')
      .all()
      .map((r) => ({ ...r, isVirtual: !!r.isVirtual, aliases: aliases.get(r.id) ?? [] }));
  }

  /**
   * Paths of pages that contain links which might be affected by moving some pages:
   * links resolved to any of `paths`, links whose target path is `paths` or lies under `folderPrefix`
   * (attachments and broken links), and wikilinks written with any of `names` (they could start
   * resolving differently once pages move; matched on the last path segment, so path-style
   * wikilinks count too).
   */
  function findLinkers({ paths = [], folderPrefix = null, names = [] } = {}) {
    const out = new Set();
    const json = JSON.stringify(paths);
    for (const r of db
      .prepare(`SELECT DISTINCT p.path FROM links l JOIN pages p ON p.id = l.page_id
                WHERE l.kind IN ('page', 'file') AND (
                  l.target_path IN (SELECT value FROM json_each(?))
                  OR l.target_page_id IN (SELECT id FROM pages WHERE path IN (SELECT value FROM json_each(?))))`)
      .all(json, json)) out.add(r.path);
    if (folderPrefix) {
      for (const r of db
        .prepare(`SELECT DISTINCT p.path FROM links l JOIN pages p ON p.id = l.page_id
                  WHERE l.target_path LIKE ? ESCAPE '\\'`)
        .all(`${escapeLike(folderPrefix)}%`)) out.add(r.path);
    }
    if (names.length) {
      for (const r of db
        .prepare(`SELECT DISTINCT p.path FROM links l JOIN pages p ON p.id = l.page_id
                  WHERE l.syntax = 'wiki' AND l.target_name IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(names.map((n) => n.toLowerCase())))) out.add(r.path);
    }
    return [...out].sort();
  }

  /** Number of links the index holds for a page (null if the page is unknown). */
  function linkCount(p) {
    const row = q.pageByPath.get(p);
    if (!row) return null;
    return db.prepare('SELECT COUNT(*) AS n FROM links WHERE page_id = ?').get(row.id).n;
  }

  /** Stored content hash (sha1 of the file bytes) for a page, or null. */
  function pageHash(p) {
    return q.pageByPath.get(p)?.hash || null;
  }

  // ------------------------------------------------------------------ public: schema & misc
  function setSaved(g) {
    savedQueries = g.queries;
    savedByName = new Map(g.queries.map((x) => [x.name.toLowerCase(), x.query]));
    relations = g.relations;
    savedHash = g.savedHash;
  }

  /** Read the settings files of `.cave-notes` again. */
  async function reloadSchema() {
    const st = await readSettings();
    const loaded = st.loaded;
    const g = st.invalid ? { invalid: true, warnings: st.warnings } : { ...st.g, invalid: false };
    if (!st.invalid) {
      schema = loaded.schema;
      schemaWarnings = loaded.warnings;
    }
    globalsWarnings = g.warnings;
    let rebuild = false;
    if (!st.invalid && loaded.hash !== schemaHash) {
      schemaHash = loaded.hash;
      rebuild = true;
    }
    if (!g.invalid && g.hash !== globalsHash) {
      globals = g.globals;
      globalsHash = g.hash;
      rebuild = true;
    }
    let changed = rebuild;
    if (!g.invalid && JSON.stringify(g.files ?? null) !== JSON.stringify(globalFiles)) {
      globalFiles = g.files ?? null;
      await syncFiles();
      changed = true;
    }
    if (!g.invalid && g.savedHash !== savedHash) {
      setSaved(g); // views using saved queries are drawn again; no page changes
      changed = true;
    }
    if (rebuild) {
      rebuildAttrs();
      q.setMeta.run('schema_hash', schemaHash);
      q.setMeta.run('globals_hash', globalsHash);
    }
    return { changed, warnings: [...schemaWarnings, ...globalsWarnings] };
  }

  /** Replace the schema in memory (not on disk) and rebuild attributes. */
  function setSchema(raw) {
    const r = normalizeSchema(raw);
    schema = r.schema;
    schemaWarnings = r.warnings;
    schemaHash = sha1(JSON.stringify(raw ?? {}));
    rebuildAttrs();
    q.setMeta.run('schema_hash', schemaHash);
    return { warnings: schemaWarnings };
  }

  function diagnostics(p) {
    const sql = `SELECT p.path, d.kind, d.message FROM diagnostics d JOIN pages p ON p.id = d.page_id ${p ? 'WHERE p.path = ?' : ''} ORDER BY p.path`;
    return p ? db.prepare(sql).all(p) : db.prepare(sql).all();
  }

  function stats() {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      pages: n('SELECT COUNT(*) n FROM pages WHERE is_virtual = 0'),
      files: n('SELECT COUNT(*) n FROM pages WHERE is_virtual = 2'),
      virtualPages: n('SELECT COUNT(*) n FROM pages WHERE is_virtual = 1'),
      headings: n('SELECT COUNT(*) n FROM headings'),
      links: n('SELECT COUNT(*) n FROM links'),
      brokenLinks: n("SELECT COUNT(*) n FROM links WHERE status = 'broken'"),
      ambiguousLinks: n("SELECT COUNT(*) n FROM links WHERE status = 'ambiguous'"),
      attributes: n('SELECT COUNT(*) n FROM attrs'),
    };
  }

  const hiddenStatements = new Map();
  /** The statements that find the pages `hidden` keeps out of one place (tree, children, search), made when first needed. */
  const hiddenFor = (area) => {
    let st = hiddenStatements.get(area);
    if (!st) {
      const ids = hiddenIdsSql(area);
      st = {
        ofParent: db.prepare(`SELECT p.path FROM pages p WHERE p.parent_path IS ? AND p.id IN (${ids})`),
        all: db.prepare(`SELECT p.path FROM pages p WHERE p.id IN (${ids}) ORDER BY p.path`),
      };
      hiddenStatements.set(area, st);
    }
    return st;
  };
  const TEMPLATE_WHERE = "lower(a.key) = 'template' AND ((a.type = 'bool' AND a.num_value = 1) OR lower(a.text_value) = 'true')";
  const templatesOfParent = db.prepare(`SELECT DISTINCT p.path FROM pages p JOIN attrs a ON a.page_id = p.id WHERE p.parent_path IS ? AND ${TEMPLATE_WHERE}`);
  const templatesAll = db.prepare(`SELECT DISTINCT p.path FROM pages p JOIN attrs a ON a.page_id = p.id WHERE ${TEMPLATE_WHERE} ORDER BY p.path`);

  /** The pages that are templates (`template: true`). Same shape as hiddenPaths. */
  function templatePaths(parent) {
    const rows = parent === undefined ? templatesAll.all() : templatesOfParent.all(parent);
    return new Set(rows.map((r) => r.path));
  }

  const ICON_WHERE = "lower(a.key) = 'icon' AND a.type = 'string' AND a.text_value != ''";
  const iconOfParent = db.prepare(`SELECT p.path, a.text_value AS icon FROM pages p JOIN attrs a ON a.page_id = p.id WHERE p.parent_path IS ? AND ${ICON_WHERE}`);
  const iconAll = db.prepare(`SELECT p.path, a.text_value AS icon FROM pages p JOIN attrs a ON a.page_id = p.id WHERE ${ICON_WHERE} ORDER BY p.path`);

  /** The icon each page asks for (`icon: book`, an icon name of the bundled set): path -> name. With a parent (null = top level) only its direct children. */
  function iconPaths(parent) {
    const rows = parent === undefined ? iconAll.all() : iconOfParent.all(parent);
    return new Map(rows.map((r) => [r.path, r.icon]));
  }

  /**
   * Pages whose `hidden` attribute (own, or handed down by the workspace or a `children:` block) hides them from `area`: the page
   * `tree` (the default), the `children` pane or `search`.
   */
  function hiddenOnlyPaths(parent, area = 'tree') {
    const st = hiddenFor(area);
    const rows = parent === undefined ? st.all.all() : st.ofParent.all(parent);
    return new Set(rows.map((r) => r.path));
  }

  /**
   * Pages that keep out of the page tree: `hidden: tree` (or `files`, `all`, `true`) and the templates that say nothing of their own.
   * With a parent (null = top level) only its direct children are listed.
   */
  function hiddenPaths(parent) {
    return hiddenOnlyPaths(parent);
  }

  async function close() {
    if (pool) await pool.close();
    db.close();
  }

  return {
    root,
    tree,
    db,
    reconcile,
    refresh,
    rebuild,
    getPage,
    headings,
    links,
    backlinks,
    resolveRef,
    allPageRows,
    findLinkers,
    pageHash,
    linkCount,
    search,
    attributeKeys,
    attributeValues,
    reloadSchema,
    /** Replace the settings taken from other workspaces and read everything again. */
    async setInherited(x) {
      inherited = x ?? {};
      return reloadSchema();
    },
    syncFiles,
    setSchema,
    get schema() {
      return schema;
    },
    get schemaWarnings() {
      return schemaWarnings;
    },
    /** What a page hands down and takes in, as stored: its attributes and its own `children:` blocks (null when there is no such page). */
    stateOf(path) {
      const stored = q.effByPath.get(path);
      if (!stored) return null;
      const st = parseState(stored.eff);
      return { attributes: st.attributes, blocks: st.blocks };
    },
    /** the workspace's global attributes, as in effect */
    get globals() {
      return globals;
    },
    get globalsWarnings() {
      return globalsWarnings;
    },
    /** saved queries: [{ name, query, title? }] */
    get savedQueries() {
      return savedQueries;
    },
    /** relations between saved queries, as set in workspace.yaml */
    get relations() {
      return relations;
    },
    relatedFor,
    diagnostics,
    stats,
    hiddenPaths,
    hiddenOnlyPaths,
    iconPaths,
    templatePaths,
    orderOf: (p) => q.orderOf.get(p)?.o ?? undefined,
    close,
  };
}
