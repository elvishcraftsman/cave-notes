# Cave Notes

A Linux desktop app for mapping concepts as a hierarchy of Markdown pages. The folder structure *is* the hierarchy. It has a hybrid text/rendered editor, a keyboard-driven tree, outline and link sidebars, and fast indexed search with attribute filtering.

This README is the build guide. Work through the milestones in order; each one has acceptance criteria.

---

## 0. Run and develop (read this first)

**Status:** milestones M1 to M7 are built and tested in a headless sandbox. M8 (Flatpak packaging) is not started, and the app has not yet been run on a real desktop. Treat it as a testable preview.

### Requirements

- Node.js 20 or newer, and npm.
- A C/C++ toolchain and Python 3 (`gcc`, `g++`, `make`, `python3`) so `better-sqlite3` can compile against Electron.
- Network access on the first install (npm packages, Electron binary, Electron headers).
- Fedora Silverblue note: the host is immutable, so do development inside a toolbox or distrobox container, for example `toolbox create cave && toolbox enter cave`, then `sudo dnf install nodejs npm gcc-c++ make python3`. The Electron window opens from the container normally under GNOME (Wayland or X11).

### First run

```bash
unzip cave-notes-in-progress.zip -d cave-notes && cd cave-notes
npm install                        # at the repo root: installs every package in the monorepo
cd apps/desktop
npm run rebuild                    # compiles better-sqlite3 for Electron's ABI (needed once, and after upgrading Electron)
npm start                          # builds the bundles, then launches Electron
```

To open a specific folder at launch: `npm start -- /path/to/notes` (or set `CAVE_OPEN=/path/to/notes`). With no folder it shows the welcome screen and remembers your last workspace.

Try it on a sample workspace first: from `apps/desktop`, run `node -e "import('./e2e/sample-workspace.mjs').then(m => m.createSample('/tmp/cave-sample'))"`, then `npm start -- /tmp/cave-sample`. Or point the app at any folder of Markdown files. The app only writes to pages you edit (and to link rewrites you approve in the rename preview); its index lives in `.cave-notes/` inside the workspace and is safe to delete, since it rebuilds.

### Everyday commands

| Where | Command | What it does |
|---|---|---|
| repo root | `npm test` | runs the tests of every package |
| `apps/desktop` | `npm run build` | bundles main, preload, worker and renderer into `dist/` |
| `apps/desktop` | `npm start` | build, then launch |
| `apps/desktop` | `npm run typecheck` | TypeScript check |
| `apps/desktop` | `npm test` | worker service tests (21) |
| `apps/desktop` | `npm run e2e` | drives the real app in a virtual display (see below) |
| any `packages/*` | `npm test`, `npm run typecheck` | per-package checks |

There is no hot reload yet: after changing renderer or main code, quit the app and run `npm start` again. `packages/editor`, `ui-tree` and `ui-search` are consumed from source, so they need no separate build.

### End-to-end tests

`npm run e2e` needs `xvfb` (`sudo dnf install xorg-x11-server-Xvfb`) and uses plain Node for the worker (`CAVE_WORKER_NODE=1`), so it does not need `npm run rebuild`. It creates a sample workspace in `/tmp/cave-sample`, runs the script in `e2e/flows.cjs` against the built app, and writes screenshots to `/tmp/cave-shots`. Expect `73 passed, 0 failed`. Run `npm run build` first if you changed code.

### Handy environment variables

| Variable | Effect |
|---|---|
| `CAVE_OPEN=/path` | open this folder at startup |
| `CAVE_NATIVE_FRAME=1` | use the system title bar instead of the custom header bar |
| `CAVE_WORKER_NODE=1` | run the indexing worker in plain Node (no Electron rebuild of SQLite needed) |
| `ELECTRON_OZONE_PLATFORM_HINT=auto` | let Electron choose Wayland or X11 |

### Troubleshooting

- **`npm install` fails while compiling `better-sqlite3`:** install the toolchain above, or run `npm install --ignore-scripts` and then `npm run rebuild` in `apps/desktop`.
- **App starts but shows an error about a native module or `NODE_MODULE_VERSION`:** run `npm run rebuild` in `apps/desktop` again.
- **"The SUID sandbox helper binary was not configured correctly":** common in containers. For development only, launch with `npx electron . --no-sandbox`.
- **Blank window or GPU errors in a container:** try `npx electron . --disable-gpu`.
- **Search finds nothing in a freshly opened big folder:** wait for the footer to stop saying "Indexing…".

### What has and has not been tested

Tested: all `core-*` packages, editor, tree and search models, the worker service, and 73 end-to-end checks (navigation, editing and autosave, `[[` completion, rename with link rewriting and undo, moving, new pages, external changes and conflicts, tables, search and filters, themes).

Not yet tested on a real machine: Electron against your native SQLite build, real delete-to-trash, the custom title-bar buttons (minimize, maximize, close), drag and drop with a real mouse, Wayland behavior, HiDPI, and large workspaces (the 10,000-page budgets are met by `core-index` benchmarks, not yet measured end to end in the UI).

Known gaps: no keyboard shortcut list in the UI, views cannot yet create pages, cell values cannot be edited in place (only by dragging on boards and calendars), keyboard-only users cannot yet move the cursor into a table or view block (use the </> button or click), and no packaging (M8).

---

## 0b. Sub-page bar and database views

### The sub-page bar

Every page that has sub-pages shows them as a bar along the bottom of the editor. While there is more page below, it is a slim strip of buttons. When you scroll to the end of the page (or the page is too short to scroll) it grows into cards. The pin button keeps it expanded; the choice is remembered.

### Database views

A fenced block labelled `view` becomes a live view of your pages. It is plain text in the Markdown file, so it works with any editor, and it re-runs whenever the index changes.

````markdown
```view
type: kanban
title: Open tasks
query: under:$this status:todo,doing
group: status
columns: [title, due, tags]
sort: due
```
````

| Setting | Meaning |
|---|---|
| `type` | `table`, `list`, `gallery`, `kanban` or `calendar` (default `table`) |
| `query` | the same filter language as search: `status:todo,doing`, `-tags:done`, `due:<2026-12-01`, `due:2026-10-01..2026-10-31`, `has:due`, `under:Theology`, `is:orphan`, `links-to:Grace`. `$this` is the page holding the block and `$parent` its parent |
| `sort` | an attribute, `title` or `modified`; a leading `-` reverses it |
| `columns` | which properties to show: `title`, `path`, `modified`, or any attribute |
| `group` | kanban: the attribute whose values become columns (declared enum values come first, in schema order) |
| `date` | calendar: the date attribute |
| `cover` | gallery: an attribute holding an image path, relative to each page |
| `limit` | at most this many pages (default 200, maximum 1000) |

Everything can also be set with the controls on the block: the view-type buttons, **Filter** (typed controls: dropdowns and choices for enums, date pickers, number boxes, "contains" for tags, "has a value" and "is empty"), **Properties**, sort, and the group, date and cover pickers. Each change is written back into the fence as text, keeping your comments. The `</>` button shows the raw settings for editing; click elsewhere to see the view again. **Menu → Insert Database View** (Ctrl+Alt+V) adds an empty block.

You can change data from a view: **drag a card to another board column** to set that page's attribute, or **drag a page onto a calendar day** to set its date. Only that one frontmatter line changes; comments, other keys and the page body are left as they were. If the page is open with unsaved edits it is saved first.

The same typed filter controls appear in the search panel under **Filters**.

Typed attributes come from the `schema:` section of the workspace's settings files (see [docs/workspace-files.md](docs/workspace-files.md)), for example:

```yaml
attributes:
  status: { type: enum, values: [idea, todo, doing, review, done] }
  due: { type: date }
  tags: { type: list, of: string }
  weight: { type: number }
```

Without a schema, types are inferred from the values in your frontmatter.

Limits: a view lists pages, so a filter on the text of a page body is done with the search panel, not in a view. A multi-value filter whose values contain spaces cannot be written in the query language, so use one row per value. Dragging is disabled when a board is grouped by a list attribute such as `tags`.

---

## 0c. Tabs, preferences and page attributes

### Tabs

The title bar holds the tabs. A tab is one page of one workspace, so you can have several folders open at once, or several pages of one folder. The active tab is the heading: page name, with its path and save state under it.

- New tab: `Ctrl+T` duplicates the current tab; the `+` after the tabs also opens a folder in a new tab. Middle-click a page in the tree, use "Open in New Tab" in its menu, or `Shift`+`Ctrl`+click a link.
- Switch with `Ctrl+Tab` / `Ctrl+Shift+Tab` or `Ctrl+PageDown` / `Ctrl+PageUp`; close with `Ctrl+W` or middle-click; drag tabs to reorder them. Closing the last tab of a folder closes that workspace. The tabs come back at the next start.
- Preferences has two tabs, App Preferences and Workspace Preferences (also in the sidebar footer menu). The workspace tab holds an accent colour, an icon, the typeface and size of page text and the file types for the workspace, and the workspace's YAML (attributes, file attributes, schema, automations) as text boxes. The colour and icon show on all its tabs. All of it is saved in the settings files of that workspace's `.cave-notes` folder; Preferences holds the defaults for workspaces that choose nothing.
- Each open workspace has its own worker process; it stops when its last tab closes.
- **Back and forward** (title bar, `Alt+←` / `Alt+→`, or the mouse's back/forward buttons): every tab has its own history of the pages it showed. Stepping through the tree with the arrow keys counts as one step, and pages that no longer exist are skipped. The history lasts until the tab is closed.
- **Colours**: seven families of five shades (Workspace Preferences and App Preferences). The shown tab, the pressed buttons of the title bar and the highlights use the fourth shade, the title bar the darkest (the lightest in light mode), and tabs that are not shown the title bar's shade.
- **Opening a file**: `cave-notes /path/to/File.md` (or "Open with" in the file manager, see `packaging/cave-notes.desktop`) opens that one file in a tab of its own, without its folder: no page tree, nothing written beside it. If the file lies inside a workspace that is already open it opens there as a page instead. Files must end in `.md`; links from such a file to other `.md` files open them the same way. Further files given to a running app open in a new tab of the window in front.
- **Titles**: when you change a page's first `# Heading` and move off that line (or leave the editor), you are asked once whether to rename the file to match. Editing a title in a database view (double-click it) does both at once.

### Database views: editing in place

Cells are editable. What a cell offers follows the attribute's type, which comes from `.cave-notes/schema.yaml` (above) or, without a schema, from the values themselves:

| Type | Cell | Written as |
|---|---|---|
| `bool` (also inferred from `true` / `false`) | checkbox | `done: true` / `done: false` |
| `select` / `enum` with `values` | dropdown | `kind: bug` |
| `multiselect` (a `list` with `values`) | dropdown with checkboxes | `labels: [ui, sync]` |
| `date` | date picker | `due: 2026-10-22` |
| `number` | text, checked | `weight: 3` |
| anything else | text (a list: comma separated) | `note: hello` |

Edits go into the page's own frontmatter (an inherited value is overridden there, for that page only). To make a to-do list: give the parent `children:\n  done: false` so every sub-page has the attribute, and write a view with `query: under:$this` and `columns: [title, done]`.

### Syncing and disk changes

The page you have open follows the file on disk. If you have typed nothing since it was loaded or saved, the new text replaces it in place. If both changed, the two are merged **three ways** against the text both grew from (kept in a small version history; if that exact text is gone, the closest earlier one is used). Words are merged inside a line, so two edits in one long paragraph both survive. Where both sides rewrote the same words, both are kept between `<<<<<<< conflict` markers (never inside frontmatter: a clash there goes to the side saved later). The merge gives the same text whichever device runs it, so two devices merging the same pair write identical files and Syncthing sees no new conflict.

- **Conflict copies** (`Name.sync-conflict-20260101-120000-ABCDEFG.md`) are hidden from the tree and index. The first time one appears you are asked whether to merge such copies in and delete them; the answer is kept in Preferences → Syncing (`ask` / `auto` / `never`). A copy is deleted only after the merged page is written, and its text stays in the history.
- **Moved or renamed on disk**: a page whose file disappears while an identical file (same content) appears elsewhere is a move. An open page stays open at its new place, tabs and tab histories follow, and the tree shows it there.
- **Deleted on disk**: you are asked whether to keep the page (saved again as it is open) or close it. The text is put in the history either way.
- **Page History…** (main menu) lists what is remembered (the last 30 versions of recently used pages, kept in the app's data folder, not in the workspace, so it is never synced) and restores one as an ordinary, undoable edit.
- **Delays**: a change that arrives hours later, from a device that was offline, is merged against the closest version this device knows. A worse ancestor can only cause more "both kept" spots, never a lost edit.

### Preferences (`Ctrl+,`)

Dark theme, serif body text (Libertinus Serif, bundled with the app), collapsing idle branches of the page tree (on by default, after 10 seconds, adjustable), and where "New Page" puts a page: inside the open page (default), beside it, or at the top level. The arrow next to `+` offers all three each time; "beside" is hidden when the open page is at the top level, because it would be the same as top level.

### The page tree

- Drag a page onto a row to make it a sub-page, or between two rows to put it there. The siblings get `order:` numbers in their frontmatter, as few as possible; a folder that has no page of its own cannot carry one, so ordering around it asks you to create its page first.
- Idle branches collapse after the delay, but only the outermost one of a chain, so the branches inside it stay open and reopening it shows the way back to where you were. Branches holding an open page in any tab stay.
- Opening a page by any route (a link, a tab, search) reveals it in the tree.

### Attributes

Move the mouse above the first line of a page: "Add attributes" inserts an empty frontmatter block with the cursor in it, and the `i` button explains the syntax. Besides `aliases` and `order`:

```yaml
hidden: tree, search    # keep the page out of the page tree and search (children, or all / true for everywhere)
children:               # handed to every sub-page, at any depth, unless they set their own
  status: todo
  hidden: true
```

- `hidden: true` removes the page (and everything under it) from the tree. It still shows in the sub-page bar, search and views. While it is open, its nearest visible ancestor is the one selected in the tree.
- A page has no attributes unless it is given some: by the workspace (`attributes` in `.cave-notes/workspace.yaml`), by a `children:` block above it, or by its own frontmatter, strongest last. A page's own values are never passed down by themselves. `children:` takes `defaults:` (`default`, `inherit` or `none`) and `inheritance:` (`all` or `children`), may be a list of blocks, and the words `inherit`, `default` and `none` work as attribute values. **The full rules, reserved names and examples are in [docs/attributes.md](docs/attributes.md).**
- Search, views and the index see the resulting attributes; the page's own file is never rewritten for this.

### Queries, saved queries and relations

The query language, view settings, named queries (`queries` in `.cave-notes/workspace.yaml`, used as `saved:name`) and relations between them (`relations`, shown as view columns) are explained in [docs/queries.md](docs/queries.md).

### Automations

Rules (`rules:` in the settings files of `.cave-notes`) make the app act on its own: when a property changes, when a page starts to match a query, at a time (cron), or when a date in a property arrives. They can set and remove properties, move and create pages, carry unfinished tasks forward, notify, and (switched on in Preferences, each command approved) run shell commands. Several computers syncing the same workspace take turns and check before acting, so each change is made once. The package is `packages/core-automation` (pure logic, tested with a fake workspace); `apps/desktop/src/worker/automation.ts` connects it to the workspace, and `apps/desktop/src/main/automation-shell.ts` is the only code that starts programs. **Syntax, every action, variable and function, and examples for fifteen common uses are in [docs/automation.md](docs/automation.md).** The query language gained `mtime:` for this (not changed for 30 days: `mtime:<$now.day-30`).

### Workspaces are folders

Any folder becomes a workspace by being opened: that adds a `.cave-notes` folder to it. Only notes files count (by default `.md` and `.txt`; change this in Preferences, per app or per workspace, together with the type new notes are created as). Other files are ignored by the tree.

- **Nested workspaces.** A folder that holds its own `.cave-notes` is a separate workspace. Its notes do not inherit from the workspace around it and do not appear in that one's queries, search or links. The outer page tree can show it as a marked folder (Preferences; on by default) that opens in a new tab or in place.
- **Finding workspaces.** The app searches your home folder (or the folders you choose, minus those you leave out) in the background and adds what it finds to the workspace lists: the welcome screen, the Open Folder dropdown and the `+` menu. Search Now in Preferences does it immediately.
- **Making and unmaking.** Opening a folder that is inside a workspace asks first, as does "Make Workspace…" in a page's context menu; you can keep the surrounding workspace's schema, saved queries and shared attributes or start fresh. "Stop Using as Workspace…" (tab menu, nested folder row, welcome list) deletes `.cave-notes` after a warning. Notes are never touched.
- **Files in the sub-page bar.** The bar at the bottom lists every file in the page's folder. Notes open in the app, other files in the program the system has for them. The Notes/All switch is remembered.
- **Sync tools.** Whatever belongs to one computer (the search index, view state, version history and link-rewrite undo journals) lives in the app's own data folder, not in the workspace, so it works with Syncthing, git, a cloud drive or nothing, and no ignore file is needed. Only the settings files (YAML) stay in `.cave-notes`, and they sync with the notes.
- **Non-note files in queries.** See [docs/attributes.md](docs/attributes.md) for the `files:` block.

### Opening from outside

Preferences, "Opening from outside": a folder or Markdown file handed to the running app (file manager, command line) opens in a new tab of the window in front, or in a new window.

## 1. Decisions already made

| Topic | Decision |
|---|---|
| Shell | Electron, packaged as a Flatpak |
| Editor | CodeMirror 6 with a live-preview extension |
| Storage | Plain notes files (Markdown by default) on disk, no database as source of truth. Any folder can be a workspace |
| Hierarchy | `Foo.md` plus a sibling folder `Foo/` holding its children |
| Attributes | YAML frontmatter in each file (source of truth) |
| Schema | Optional `schema:` section in the settings files of `.cave-notes` for typed attributes |
| Links | Relative Markdown links **and** `[[wikilinks]]`, auto-updated on rename/move |
| Index | SQLite (better-sqlite3) with FTS5; a disposable cache in the app's data folder (per workspace) |
| Design goals | Modular packages reusable elsewhere; very snappy |

---

## 2. Workspace layout on disk

```
my-workspace/
  .cave-notes/            # marks the folder as a workspace; holds the settings as YAML, in separate files or in one (see docs/workspace-files.md): look, global attributes, schema, saved queries, relations, automation rules, export styles, note types, `files:`; index, state and history are kept in the app data folder
  Theology.md
  Theology/
    Soteriology.md
    Soteriology/
      Grace.md
      Justification.md
    Ecclesiology.md
  Notes.md               # leaf page, no folder
  assets/                # non-page folders are fine; shown only if configured
```

Rules:

- A page with children has a folder with the **same name minus `.md`**, in the same directory.
- A folder with no matching `.md` is a **virtual page**: shown in the tree (dimmed), openable, and promoted to a real page when you first type in it.
- A `.md` with no folder is a leaf. The folder is created lazily when the first child is added.
- Dotfiles and dot-folders are ignored. `.cave-notes/` is reserved.
- Sibling order: frontmatter `order:` (number) if present, else natural alphabetical by title. Pages with an `order` come first. Dragging in the tree writes it.
- Page title: first `# H1`, else frontmatter `title:`, else the file name.
- Case-insensitive name collisions in the same directory are rejected.

---

## 3. Architecture

An npm-workspaces monorepo. **Every `core-*` package has zero Electron or DOM dependencies**, so it can be reused in a CLI, a server, or another app.

```
packages/
  core-tree/      page/folder model, create/move/rename/delete (keeps pairs in sync)
  core-md/        parse: frontmatter, headings (with positions), links (all kinds)
  core-index/     SQLite schema, incremental indexer, query compiler, search
  core-links/     link resolution + rewrite planner (rename/move)
  editor/         CodeMirror 6 extension: live preview, link handling, heading jump API
  ui-tree/        left sidebar component (framework-agnostic, keyboard model)
  ui-side/        right sidebar: Outline and Links tabs
  ui-search/      query bar, filter chips, result list
apps/
  desktop/        Electron main + preload + renderer wiring everything together
```

Process model (Electron):

- **Main process:** window, menus, dialogs, file watching, opening external links. Keep it thin.
- **Utility process (worker):** owns `core-index` and does all indexing and search. This keeps the UI thread free.
- **Renderer:** UI only. Talks to main/worker through a small typed IPC API (`window.api.*`), never touches `fs` directly (`contextIsolation: true`, no `nodeIntegration`).

Suggested dependencies:

- `electron`, `@electron/rebuild` (better-sqlite3 is a native module and must be rebuilt for Electron)
- `better-sqlite3`
- `chokidar` (watching)
- `yaml` (frontmatter and schema)
- `unified`, `remark-parse`, `remark-frontmatter` (mdast gives positions for headings and links), or `markdown-it` if you prefer
- `codemirror`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/view`, `@codemirror/state`
- `vitest` or `node:test` for tests
- Build the renderer with Vite

Keep the UI framework-light. Vanilla web components or a tiny library such as Preact or Lit keeps startup fast and keeps `ui-*` packages portable.

---

## 4. Data model

### 4.1 Frontmatter

```yaml
---
title: Grace            # optional
order: 10               # optional sibling ordering
status: draft
tags: [soteriology, reformation]
due: 2026-11-01
aliases: [Charis]       # extra names for wikilink resolution
---
```

### 4.2 Optional schema (the `schema:` section of the settings files, usually `.cave-notes/schema.yaml`)

```yaml
schema:
  status:  { type: enum, values: [idea, draft, review, done] }
  tags:    { type: list, of: string }
  due:     { type: date }
  weight:  { type: number }
  source:  { type: string }
  done:    { type: bool }
  kind:    { type: select, values: [bug, feature, chore] }       # one choice: a dropdown in views
  labels:  { type: multiselect, values: [ui, sync, docs] }       # several choices: a multi-select dropdown
```

Spelling: `select` = `enum`; `multiselect` (also `multi`, `multi-select`) = a `list` whose items must come from `values`; `checkbox` = `bool`; `text` = `string`. Edits to this file take effect at once, without a restart.

Behavior:

- Keys **not** in the schema are still indexed, as strings (or inferred as number/date/bool/list from the YAML value).
- The schema adds: typed comparison and sorting, filter UI controls (dropdowns, date pickers, tag autocomplete), validation warnings (for example `statsu:` typos or invalid enum values), and templates for new pages.
- Schema problems are warnings, never blockers. The file on disk always wins.

### 4.3 SQLite schema (the index is a cache; it can always be rebuilt)

```sql
CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,        -- workspace-relative, e.g. Theology/Soteriology.md
  parent_path TEXT,                 -- NULL for top-level pages (see core-index README for the final schema)
  title TEXT NOT NULL,
  is_virtual INTEGER NOT NULL DEFAULT 0,
  sort_order REAL,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL                -- skip re-parse when unchanged
);

CREATE TABLE headings (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  text TEXT NOT NULL,
  slug TEXT NOT NULL,
  line INTEGER NOT NULL,
  ord INTEGER NOT NULL
);

CREATE TABLE links (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,               -- 'page' | 'file' | 'web' | 'other'
  syntax TEXT NOT NULL,             -- 'md' | 'wiki'
  raw TEXT NOT NULL,                -- as written
  target_page_id INTEGER,           -- resolved (kind='page'), NULL if broken
  target_path TEXT,                 -- resolved path for 'file'/'page'
  target_fragment TEXT,             -- heading slug if present
  url TEXT,                         -- for 'web'
  line INTEGER NOT NULL
);

CREATE TABLE attrs (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,               -- string|number|date|bool
  text_value TEXT,
  num_value REAL,                   -- also used for dates (epoch ms) and bools
  idx INTEGER NOT NULL DEFAULT 0    -- list items become multiple rows
);

CREATE VIRTUAL TABLE pages_fts USING fts5(title, body, content='', tokenize='porter unicode61');

CREATE INDEX idx_attrs_key_text ON attrs(key, text_value);
CREATE INDEX idx_attrs_key_num  ON attrs(key, num_value);
CREATE INDEX idx_links_target   ON links(target_page_id);
CREATE INDEX idx_pages_parent   ON pages(parent_id, sort_order);
```

Use WAL mode, `synchronous = NORMAL`, and wrap bulk indexing in one transaction.

---

## 5. Links

Supported forms:

```md
[Grace](Soteriology/Grace.md)            relative page link
[Grace](Grace.md#imputation)             page + heading
[[Grace]]                                 wikilink by title/filename/alias
[[Grace#Imputation]]                      wikilink + heading
[[Soteriology/Grace|God's favor]]         path form with display text
[spec](../docs/spec.pdf)                  local file
[site](https://example.com)               web
```

**Resolution order for wikilinks:** exact workspace path, then unique filename, then unique title or alias, then closest match by tree distance. If still ambiguous, mark the link as ambiguous and show it in the Links tab; never guess silently.

**Rename/move rewriting (`core-links`):**

1. `planMove(from, to)` returns a plan: the file and folder moves, plus every link edit (file, line, old text, new text).
2. Show a preview (a count of files affected, expandable).
3. `applyPlan(plan)` writes a **journal** first, applies edits with temp-file-plus-rename, and supports full undo from the journal.
4. A page and its folder always move together. Relative links *inside* moved pages must be rewritten too, and links in other pages that point into the moved subtree.
5. Preserve each link's original syntax (a wikilink stays a wikilink; relative paths stay relative).

This is the riskiest feature. Write the tests first.

---

## 6. Search and filtering

Query bar syntax (compiled to SQL by `core-index`):

```
grace                          full-text (FTS5, ranked by bm25, title boosted)
"justification by faith"       phrase
status:draft                   attribute equals
status:draft,review            any of
-status:done                   negation
tags:soteriology tags:reformation   all of (list attributes)
due:<2026-12-01   due:2026-01-01..2026-03-31   weight:>=5
has:due   is:orphan   is:broken        existence/state filters
under:"Theology/Soteriology"   subtree only
links-to:"Grace"   linked-from:"Theology"   backlinks
sort:due   sort:-title
```

Behavior:

- Results update as you type (debounce about 40 ms) and are cancellable. Never block typing.
- Filter chips mirror the query text and are clickable. With a schema, they offer typed controls.
- Search results show title, path breadcrumb and a snippet (`snippet()` from FTS5).
- Backlinks are a query on `links.target_page_id`, so they are essentially free.

---

## 7. UI behavior

### Left sidebar (tree)

- Opens a folder as the workspace; remembers the last workspace.
- Keyboard model (follow the standard tree pattern):
  - **Up/Down:** move selection and open the page (debounce about 80 ms so holding the key stays smooth).
  - **Right:** if collapsed, expand; if expanded, move to first child.
  - **Left:** if expanded, collapse; if collapsed, move to parent.
  - **Enter:** focus the editor. **F2:** rename. **Delete:** delete (confirm). **Ctrl+N:** new child.
- Virtualized rendering; children loaded lazily from the index.
- Drag and drop to move or reparent, routed through `planMove`.

### Editor (center)

- CodeMirror 6 in live-preview mode: syntax markers are hidden on every line except the one(s) containing the cursor or selection; headings, bold/italic, lists, links, code and tables render styled.
- Ctrl+Click on a link opens it: page links navigate, file links open with the system default (`shell.openPath`), web links open with `shell.openExternal`. Plain click just places the cursor.
- `[[` triggers autocomplete from the index. Typing a path link offers completion too.
- Autosave on a short idle debounce; detect external changes and reload if the buffer is clean.
- Expose `scrollToHeading(slug | line)`.
- Smart quotes: `"` and `'` write curly quotes (`packages/editor/src/smartQuotes.ts`). Undo right afterwards turns one back into the straight character. A double quote typed where no text touches it writes a pair and typing the closing one steps over it; against text, or a single quote, writes just the one. Code, frontmatter, HTML, link destinations and `[[wikilinks]]` are left alone.
- A bullet's marker (indent, `-`, spaces) is one unit for the cursor: one place to stand before the text, and Backspace there removes the marker.

### Right sidebar

- **Outline tab:** nested list of headings from the current buffer (parse live from the editor syntax tree, not from the index, so it updates as you type). Click scrolls to the heading and highlights the current section while scrolling.
- **Links tab:** every outgoing link in the page, grouped as Pages, Files and Web. Each shows its target, a broken-link marker where applicable, and opens on click. Include a **Backlinks** section.

---

## 8. Performance budgets

Treat these as test assertions, not aspirations:

| Operation | Budget (workspace of 10k pages) |
|---|---|
| Cold start to a usable window | < 1 s (tree from the existing index) |
| Open a page from tree selection | < 50 ms |
| Keystroke-to-render in a 1 MB file | < 16 ms |
| Search results while typing | < 50 ms |
| Reindex after a single file change | < 30 ms |
| Full rebuild of the index | a few seconds, in the background |

Techniques: index in a worker; incremental updates keyed on `mtime` plus `hash`; startup diff by comparing directory mtimes to the index; lazy tree; virtualized lists; only render what's visible in the editor; no framework re-render storms.

---

## 9. Milestones

Do these in order. Each ends with passing tests.

### M1: `core-tree` (done)
- Model the page/folder pair; functions `listChildren`, `createPage`, `movePage`, `renamePage`, `deletePage`, `promoteVirtual`.
- Operations are atomic where possible and never leave a page without its folder or vice versa.
- **Done when:** property-style tests on a temp directory pass for create, rename, move into a descendant (must be rejected), case collisions, virtual pages, and sort order.

### M2: `core-md` (done)
- `parse(text)` returns `{ frontmatter, title, headings[], links[] }` with line positions. Detect all link forms in §5; ignore links inside code blocks.
- **Done when:** a fixture suite covers every link form, nested headings, and malformed frontmatter (parse failure must never throw).

### M3: `core-index` (done)
- Schema from §4.3, full build, incremental update from a watcher event list, startup diff.
- **Done when:** a generated 10k-page workspace meets the §8 indexing budgets.

### M4 (done): `core-links`
- Resolver plus `planMove` / `applyPlan` / `undo`.
- **Done when:** moving a subtree rewrites all inbound and internal links in both syntaxes, and undo restores byte-identical files.

### M5: Electron shell and editor (done)
- Window, IPC, worker, the CodeMirror live-preview editor, open/save, external link opening.
- **Done when:** you can open a workspace, edit a page, and see it persist, with no UI stalls.

### M6: Sidebars (done)
- Left tree with the full keyboard model; right Outline and Links tabs.

### M7: Search UI (done)
- Query parser and SQL compiler live in `core-index`. `ui-search` is the framework-free model (debounced, cancellable session; chips derived from the query text; snippet segments). The desktop app adds the search panel: Ctrl+Shift+F, filter chips, a Filters panel (quick filters plus attribute keys and values from the index), sort, keyboard navigation with page preview. The backlinks panel is the "Linked from" section of the Links tab.
- Not yet: typed controls from `.cave-notes/schema.yaml` (date pickers, enum dropdowns). Values are listed as chips today.

### M8: Packaging
- Flatpak manifest (Freedesktop runtime plus the Electron base app), file-access permissions via portals, GNOME-friendly look (Adwaita-style theme, dark mode via `prefers-color-scheme`).

---

## 10. Testing

- Unit tests per package against temp-directory fixtures (`core-*` run under plain Node, no Electron).
- A **workspace generator** script that creates N pages with random frontmatter, links and nesting, used for both tests and performance checks.
- A "watch while editing" integration test: external writes, renames and deletes must leave the index consistent with the disk.
- Keep a `fixtures/` workspace in the repo that includes weird cases: unicode names, spaces, very deep nesting, broken links, duplicate titles.

---

## 11. Risks and edge cases to design for early

- **Rename and link rewrite correctness** (see §5): journal, preview, undo.
- **External changes** (git pull, sync tools) arriving while a page is open or dirty: never silently overwrite either side.
- **Ambiguous wikilinks** with duplicate titles.
- **Very large files**: keep parsing incremental; avoid re-parsing the whole buffer per keystroke for the outline.
- **Native module rebuilds** for better-sqlite3 against Electron's ABI, including inside the Flatpak build.
- **Case sensitivity and Unicode normalization** in paths (NFC vs NFD) when resolving links.

---

## 12. Suggested first commands

```bash
mkdir cave-notes && cd cave-notes
npm init -y
npm pkg set workspaces[0]="packages/*" workspaces[1]="apps/*"
mkdir -p packages/core-tree packages/core-md packages/core-index packages/core-links apps/desktop
# start with packages/core-tree: write the tests from M1 first, then the implementation
```
