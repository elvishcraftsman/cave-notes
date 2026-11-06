# @cave-notes/core-index

The SQLite index behind Cave Notes: incremental indexing, link resolution, typed attributes, full-text search and a filter query language. It is a **disposable cache**; delete `.cave-notes/index.db` any time and it rebuilds from the Markdown files. Uses `better-sqlite3`, so run it in Electron's main process or a utility process, never the renderer. Node >= 20.

```js
import { openIndex } from '@cave-notes/core-index';

const idx = await openIndex('/home/me/notes', { workers: 3 }); // workers: parse in threads (default 0)
await idx.reconcile();            // startup: cheap when nothing changed
await idx.refresh(['A/B.md']);    // file watcher: re-index just these pages

idx.search('grace status:draft,review tags:soteriology sort:-due', { limit: 50 });
// -> { results: [{ id, path, title, isVirtual, mtimeMs, rank, snippet }], total, errors, terms }

idx.getPage(path); idx.headings(path); idx.links(path); idx.backlinks(path);
idx.attributeKeys();                              // for the filter UI
idx.attributeValues('status', { query: 'under:Theology' });   // value counts within the current results
idx.tree;                                         // a core-tree instance sorted by frontmatter `order`
```

## Keeping it current

- **Startup / after tree operations** (`movePage`, `renamePage`, `deletePage`): call `reconcile()`. It stats every page, re-reads only what changed, and returns `{ added, changed, moved, removed, unchanged, touched, virtual, ms }`.
- **Watcher events:** call `refresh(paths)` with the affected page paths (batch and debounce them). Ancestors and deleted subtrees are handled.
- **Moves are detected by content:** a file that disappears from one path and appears at another with identical content is *moved* in the index (same page id, no re-parse). Renaming a subtree of 500 pages costs a few milliseconds per page, not a re-parse.
- **Touching a file without changing it** (sync tools, `git checkout`) updates its mtime only.
- After the link rewriter (M4) edits files, call `refresh()` with the edited pages.

## Link resolution

Links are stored as written and resolved after every batch (`status`: `ok`, `broken`, `ambiguous`, `external`, `file`).

- **Markdown page links** resolve relative to the page; a leading `/` means workspace root; `..` past the root is broken.
- **Wikilinks** resolve by: path (from the root, then relative to the page) → file name → title or alias, case-insensitively. Explicit anchors skip the guessing: `[[/A/B]]` is a path from the workspace root and `[[./B]]` / `[[../B]]` are relative to the page. If several pages match, the one **closest in the tree** wins; an exact tie is `ambiguous` and left unresolved (search `is:ambiguous`).
- **File links** get a `targetPath` (workspace-relative, or absolute as written). The index does not check that files exist.
- A page added, removed, moved or retitled re-resolves every wikilink and every unresolved link. A plain edit re-resolves only that page's links.

## Attributes and schema

Frontmatter becomes typed attribute rows: numbers, booleans, ISO dates (`2026-11-01`, stored as epoch ms), strings; lists become one row per item; nested mappings become dotted keys (`author.name`). Optional `.cave-notes/schema.yaml`:

```yaml
attributes:
  status:  { type: enum, values: [idea, draft, review, done] }
  weight:  { type: number }
  due:     { type: date }
  tags:    { type: list, of: string }
```

A schema coerces values (`"7"` becomes the number 7), normalizes enum casing, and records `diagnostics` for mismatches. It never blocks indexing. Call `reloadSchema()` after editing the file (or `setSchema(obj)`); changes are applied from the stored frontmatter without re-reading any file. Quoted numbers like `"10"` stay strings unless the schema says `number`, and numeric comparisons only match numeric attributes.

`aliases:` (string or list) feeds wikilink resolution. `order:` (number) feeds sibling sorting.

## Inheritance and hidden pages

Rules and syntax: [docs/attributes.md](../../docs/attributes.md). In short: a page has no attributes unless the workspace (`attributes` in `.cave-notes/workspace.yaml`), a `children:` block above it, or its own frontmatter gives it some. The index stores each page's own frontmatter (`fm_json`) and an inheritance state (`eff_json`: its attributes, what reaches its sub-pages, and its `children:` blocks), and builds the attribute rows from the attributes. A page's own values never travel down on their own, so a page's sub-pages are worked out from the page's state alone. When a page's state changes, its sub-pages are recomputed in the same transaction. Editing the global attributes (`reloadSchema()` re-reads them along with `schema.yaml`) recomputes every page. The `children` key is configuration and is not an attribute. Mistakes in a block are `diagnostics` of kind `inheritance`.

```js
import { resolveInheritance, rootState, parseChildren } from '@cave-notes/core-index'; // pure helpers
// resolveInheritance(ownFrontmatter, parentResult | undefined, globals) -> { attributes, carry, blocks, problems }
index.globals;                 // the global attributes in effect
index.templatePaths('Top.md'); // the same, for pages with template: true (they are hidden from the tree too)
index.hiddenPaths('Top.md');   // Set of direct sub-pages with hidden: true (own, global or handed down); null = top level; no argument = all
```

## For link rewriting (used by core-links)

`allPageRows()` returns every page with the fields resolution needs; `findLinkers({ paths, folderPrefix, names })` returns the pages whose links might be affected by moving some pages; `pageHash(path)` is the stored content hash. `buildLookup` and `resolvePageLink` are exported so a move can be simulated before it happens.

## Query language

```
grace                      full text; the last word matches as a prefix (search as you type)
"justification by faith"   phrase           -heresy   exclude
title:grace  body:grace    one column (body includes heading text)
status:draft               attribute equals    status:draft,review   any of    -status:done   not
tags:a tags:b              list: all of        name:Gr*   trailing * = prefix
due:<2026-12-01  weight:>=5  due:2026-01-01..2026-03-31  weight:..10     comparisons and ranges
has:due                    attribute exists
is:orphan|broken|ambiguous|virtual|leaf|root
under:"Theology/Soteriology"   pages beneath that page (path, file name, title or alias)
links-to:Grace  backlinks:Grace  linked-from:Theology
path:soter   heading:imputation
sort:due  sort:-title  sort:rank,title     rank | title | name | path | mtime | order | <attribute>
```

Incomplete tokens (`status:`) are ignored so the query bar can run on every keystroke. Bad input never throws; problems come back in `errors`. All values are bound as SQL parameters.

Snippets mark matches with `HIGHLIGHT_START` / `HIGHLIGHT_END` control characters (never HTML), so the UI can render them safely. `parseQuery(text).terms` gives structured terms for drawing filter chips. Pass `{ count: false }` to skip computing `total` when you only need a page.

## Saved queries and relations

`queries` and `relations` in `.cave-notes/workspace.yaml` (see [docs/queries.md](../../docs/queries.md)). `saved:name` terms are replaced by the saved text before parsing, in `search()` and `attributeValues()`. `index.savedQueries`, `index.relations` and `index.relatedFor(paths)` (`{ path: { column: [{ path, title }] } }`) serve views. They are kept in memory and read again by `reloadSchema()`; changing them never rebuilds the index.

## Performance

`npm run bench`, 9,310 pages (about 10 MB of Markdown, 18,000 links), **one slow CPU core**, no worker threads:

| Operation | Time |
|---|---|
| Cold build (parse and index everything) | 19 s (about 2 ms/page; use `workers` to divide this by your core count) |
| Reconcile, nothing changed | 0.37 s |
| Refresh one edited file | 3 to 8 ms steady state (25 ms the first time after startup, while the link lookup is built) |
| Search one word / two words / typing a prefix | 3.5 / 3.8 / 5.8 ms |
| Attribute filters (status, tags, ranges, sort) | 3 to 16 ms |
| `under:`, `links-to:`, backlinks, headings | 0.03 to 1.4 ms |
| `is:orphan` | 11 ms |
| Index size | 44 MB |

## Differences from the build guide's schema

`pages.parent_path` replaces `parent_id` (children are `WHERE parent_path = ?`); added `page_aliases`, `diagnostics` and `meta` tables, `links.status`, and `pages.fm_json` (so schema changes never need a re-read). The FTS table stores plain text so snippets work.

## Notes

- Changing `SCHEMA_VERSION` makes older caches rebuild themselves automatically.
- Bare URLs, `<autolinks>`, images and reference-style links are indexed like any other link (see core-md).
- Snippet matching is by word prefix, a cheap stand-in for the FTS stemmer, so a stemmed match may show an excerpt without highlighting.
