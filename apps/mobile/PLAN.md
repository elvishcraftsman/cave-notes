# Cave Notes for Android: plan and status

Last updated 2026-11-01. This file replaces the original brief ("Prompt: build the Android app for Cave Notes"). The goals,
scope and notification design of that brief are kept (sections 6 to 8); what changed is that a lot is now built, several
decisions were made along the way, and the remaining work is described from where things stand.

**If you are picking this up later (you, or a new Claude session):** read sections 1 to 3, run the commands in section 2, do
the phone checks in section 9 first, then continue with section 5. Work milestone by milestone and stop for approval after each.

## 0. How to work on this (unchanged rules)

- Be honest about what is verified. Claude's sandbox cannot run Android (no emulator; the network allows npm, PyPI and GitHub
  only, so Gradle cannot fetch the Android SDK). Put logic where Node can test it, say plainly what could not be run, and give
  a short manual checklist for the phone.
- Keep desktop working. Every existing test stays green; refactors are mechanical.
- When something is a hard Android constraint, drop the feature and say so, rather than half-building a workaround.
- Every feature gets tests. User-facing features get a short plain-language page in `docs/` (see the note on `docs/` in
  section 7). The version number lives in the **root** `package.json`; the Android version follows it.
- End each milestone with: what was done, what was tested, what was not, what is needed from Lynn.

## 1. Where things stand

| Milestone | State |
|---|---|
| M0 spike (editor on a phone, real files with Syncthing) | **Done, passed on a phone.** Storage and Gboard typing worked; three small problems found and fixed in M1 (below). |
| M1 platform-neutral code | **Done** (tests only; desktop smoke test by Lynn pending). |
| M2 service in a Web Worker | **Built and tested in Node; not yet run on a phone.** The shared window opens a workspace through it (jsdom boot test). Phone numbers, images and session restore need checking (section 9). |
| M3 narrow-screen UI, queries, sync handling | **Written, waiting for a phone test** (see section 5, M3). The package move is left undone on purpose. |
| M4 rules and notifications (foreground) | Not started. |
| M5 background (alarms, WorkManager) | Not started. |
| M6 polish and release | Not started. |

Test counts at this point (all passing in the sandbox): platform 59, core-md 43, core-tree 49, core-links 42, core-sync 14,
core-index 151 (and the same 151 on the WASM database: `npm run test:wasm`), core-automation 98, service 6, editor 249,
core-export 67, desktop 201, mobile 23.

**First phone run of M2 (Lynn's notes):** it opens, is fairly functional, and saves to the phone. It is laggy and Android often
warns that the app has frozen, probably while indexing. Search works well. The tab strip needs rethinking (tabs wanted, in the
style of Chrome on Android).

What was done about that (written, **not yet tried on the phone**):
- Lag and the "not responding" warning: the worker's file operations pass through the page's main thread, so indexing meant
  thousands of them in a burst. `src/limitFs.ts` now lets only 3 run at once and gives the page a turn after every 12. If the
  phone still freezes, the next steps are the bulk `listTree` call below, and then fewer, larger reads.
- Tabs: on a narrow screen the strip is replaced by the open page's name and a count button; it opens a full-screen grid of tab
  cards (tap to switch, × to close, New tab, other workspaces). Desktop is unchanged. No page thumbnails yet (a card shows the
  workspace and path).
- Coming back to the app after 8 seconds or more rescans each open workspace (Syncthing may have changed files meanwhile).
  The open page itself is not yet reloaded if it changed on disk: still to do.

## 2. How to build, test, install

```bash
npm install
# all the Node tests
for p in platform core-md core-tree core-links core-sync core-index core-automation; do (cd packages/$p && npm test); done
(cd packages/core-index && npm run test:wasm)     # whole index suite on the SQLite WebAssembly driver
(cd packages/service && npx vitest run)           # the service in a worker, over messages, incl. the real browser bundle
(cd packages/editor && npx vitest run)
(cd apps/mobile && npx vitest run)                # file adapter conformance, and the shared window booting on the Android deps
(cd apps/desktop && npx vitest run)

# the phone app (Ubuntu; needs sudo once for JDK 21; downloads ~1 GB of Android SDK on first run)
bash apps/mobile/scripts/build-apk.sh --install   # --install puts it on a phone with USB/wireless debugging
```

Build facts that cost time to learn: the default Java on the build machine may be too new (Gradle 8.14 cannot run on Java
25), so the script finds JDK 21 and uses it for the build only. Capacitor cannot load `capacitor.config.ts` with TypeScript 7,
so the config is `capacitor.config.json` (delete any stray `.ts` copy: Syncthing may bring it back). The repo lives inside a
Syncthing folder: `node_modules` and `android/app/build` should be in the ignore list.

Open the app with the URL hash `#dev` (the "Developer check page" button on the first screen) to get the old M0/M2 check page:
the editor on a real folder plus the "Service check (M2)" panel that times opening, indexing, search and snapshot restore.

## 3. What exists now (map)

```
packages/platform      the seams: fs, fsSync (Node only), path, sha1, randomHex, utf8 helpers, host info (hostname, homedir,
                       tmpdir, cpuCount, pid, rssMB). Node's own on desktop; a "browser" export condition gives the WebView
                       build. memfs (in-memory fs) and the fs conformance suite live here. A guard test fails if a core
                       package imports a Node module or a Buffer-only method directly.
packages/core-*        unchanged in behaviour; now import from @cave-notes/platform. core-index and core-automation have
                       "imports" conditions (#default-driver, #parse-pool, #sandbox, #js-syntax) that give the browser build
                       stubs instead of better-sqlite3, worker_threads and node:vm.
packages/core-index    also: driver-better-sqlite3.js (default), driver-sqlite-wasm.js (official SQLite WebAssembly build,
                       in-memory with snapshots), db-conformance suite, setDefaultDriver, test:wasm.
packages/service       NEW. The workspace service (moved from apps/desktop/src/worker), the typed API (WorkerApi/MainApi,
                       Capabilities), settings rules (settings.ts), workspace-folder logic (workspaces.ts), scan.ts, and the
                       Web Worker layer: fs-rpc.ts (fs over messages), web-protocol.ts, web-worker-core.ts (the service in a
                       worker), web-host.ts (the page's side), web-worker.ts (the entry that is bundled), and
                       build/worker-options.mjs (how to bundle it: shared by the app build and the test).
packages/editor        + touch selection menu (docked), Indent/Outdent buttons, curly apostrophes from keyboard autocorrect.
apps/desktop           Electron shell; renderer unchanged except Deps.assetUrl and Deps.capabilities hooks; re-exports
                       from @cave-notes/service where code moved.
apps/mobile           Capacitor project. src/boot.tsx (start, access gate, Back button), androidApp.ts (the MainApi and one
                       service worker per open workspace), androidSettings.ts, folderPicker.ts, pluginFs.ts (Node-style fs on
                       top of the plugin, with a listing-fed stat cache), caveFs.ts (plugin interface), spike.ts + m2.ts (the
                       #dev page), mobile.css, android/ (Java plugin CaveFsPlugin.java).
```

The shared window (Preact renderer) is **still imported from `apps/desktop/src/renderer`** by relative path. Moving it into
its own package is on the list (section 7).

## 4. Decisions made (and why they differ from the original brief)

1. **Java, not Kotlin** for the plugin: the Capacitor 8 template is Java; adding Kotlin build setup that could not be tested here
   was not worth it. The plugin does only single, simple operations; every rule (flags, recursion, error codes) is in
   `pluginFs.ts`, where it is tested.
2. **The platform seam is a module-level provider** (`setFs`, `setHost`), not parameters passed through every function. Same
   result, far smaller diff. Switch to explicit parameters only if two file systems ever need to coexist in one process.
3. **SQLite WebAssembly build `@sqlite.org/sqlite-wasm`, not sql.js.** The npm sql.js build has **no FTS5** ("no such module:
   fts5"), which the brief assumed. The official build has FTS5 (porter, accent folding, `bm25`) and byte export for snapshots.
4. **The index lives in memory and is saved as a snapshot** (on close, every 30 s while open, when the app goes to the
   background). It is a cache: a missing or wrong snapshot is simply rebuilt.
5. **One Web Worker per open workspace**, like desktop's one worker per workspace. Memory cost to be measured (section 9).
6. **Local Ubuntu build script instead of GitHub Actions.** The repo is public but not set up on GitHub; a workflow can be added
   later (`build-apk.sh` is the recipe).
7. **Capabilities** (`Capabilities` in `packages/service/src/api.ts`): the window asks `capabilitiesOf(deps)` rather than testing
   "is Android". All flags are false on Android today; turn each on as the feature is built. **Nothing in the UI reads the flags
   yet**: the audit that hides unsupported buttons is part of M3.
8. **Touch editing:** a long press selects a word natively (the old menu blocked this); the format menu then docks along the
   bottom edge. Indent/Outdent exist there only, and only act on list items.
9. **Scanning for workspaces is off by default** on Android (`scanAuto: false`); folders are chosen with the in-app folder picker
   (real paths, because the folder is the one Syncthing syncs).
10. **Drop on Android (unchanged):** shell commands, present mode, several windows, tray, reveal in file manager, OS file icons,
    JavaScript rules (`run_js`) in v1: the rule format still parses and such rules report "not available on this device".

## 5. What is left, in order

### M2: finish and verify on the phone
- [ ] Phone checks from section 9, and send back the numbers from the Service check panel. **Kill criteria:** index time or memory
      on the real workspaces unacceptable, or opening a workspace needs thousands of bridge calls (see below).
- [ ] If listing is still slow: add a bulk call to the plugin (`listTree`: one recursive walk returning path, size, mtime), and let
      the adapter answer `readdir`/`lstat` from it. The listing-fed stat cache already cut a 600-note + 3,000-attachment
      workspace from ~3,700 bridge calls to ~190 on restart (measured with a stand-in plugin in Node, not on the phone).
- [ ] Session restore and the "recent" list: written, covered by the boot test, not seen on a phone.
- [ ] Images: `Capacitor.convertFileSrc` addresses (unit-tested for the URL shape; **not tested that the WebView can load them**).
      If it cannot, use `WebViewAssetLoader` with a path check inside the workspace, as the original brief described.
- [ ] Fonts: only the system fonts are bundled so far (no Libertinus Serif); add if wanted.
- [ ] Snapshot memory: the whole index is in memory. Measure on the biggest workspace; if too large consider partial indexing.
- [ ] Watching for outside changes: there is no file watcher on Android. Rescan on resume is written (see section 1); still needed:
      reload the open page if it changed, every N seconds in the foreground, plus a `FileObserver` for the open folder (original brief, 4.4).

### M3: usable on a phone, attributes, queries, sync
- [x] Audit the shared window with the capability flags (`ctl.caps`): "Reveal" items, Move to New Window and tab tear-off, Present / PDF / HTML export, Export Page, code-block Run, the Presentations preferences page, and the shell, JavaScript, background and export-style settings are not shown when the device cannot do them. Not checked: tooltips-only controls (nothing to hover on a phone).
- [~] Touch: long press already brings the context menus (Chrome's `contextmenu` event); every drag has a "Move to…" menu item;
      query tables scroll sideways on the phone (cards were not built); a focused field in a dialog scrolls into view above the
      keyboard. **Not tried on the phone**; bulk select was not looked at.
- [ ] Rotation with the keyboard open (known "not enough room"; Lynn said to ignore for now).
- [x] Spell/synonym menus on touch: when a long press selects one word, its synonyms (or spelling suggestions) hang above the
      docked menu. The thesaurus is now loaded on the phone (3 MB added to the script). There is no spell checker on Android yet, so
      only synonyms show. Tested in jsdom, not on the phone.
- [~] Disk-change handling, Syncthing conflict files and conflict boxes: the shared logic checks the open page against the file
      whenever the app becomes visible, and workspaces are rescanned on return (8 s or more away). Conflict boxes need a manual
      test on the phone; nothing notices changes while the app stays in front.
- [ ] Move the renderer to a package (`packages/app-ui`) so `apps/mobile` stops importing from `apps/desktop`.

### M4: rules and notifications in the foreground
- [ ] Android automation host: device id, heartbeat file, `notify` as system notifications (plugin `CaveNotify`), no shell, no JS.
- [ ] Rules that need `node:vm`/`worker_threads` are already stubbed (`#sandbox`, `#js-syntax`); verify the engine reports them.
- [ ] Multi-computer tests of the engine with the phone as a device; "Test notification in 1 minute" button.

### M5: background (the part Lynn cares about most): see section 8
### M6: polish and release
- Open-with/share intents, deep links `cavenotes://open?workspace=…&page=…`, export via the share sheet, accessibility,
  signed release build and install/update instructions, `docs/android.md`.

## 6. Goal and scope (carried forward from the original brief)

An Android app (phone and tablet) for the notes: Markdown/text files in ordinary folders (**workspaces**), usually kept in sync
by **Syncthing**. A real second front end, not a viewer.

**In scope (v1):** open chosen workspaces; page tree; create/rename/move/delete; the live-preview editor; links and wikilinks;
images; outline and links panes; search (full text and attributes); attributes; queries, saved queries and their views;
templates; relations; the sync merge logic (disk changes load automatically; Syncthing conflict files merged; conflict boxes);
preferences; export to formats that work in a WebView (HTML first); declarative rules (triggers `change`, `match`, `schedule`,
`at: due`, `created/modified/deleted`, `button`, `plugin`; actions that need no shell); **notifications that work when the app is
closed**.

**Dropped:** see section 4, item 10, plus automatic workspace discovery (folders are chosen by hand).

## 7. Reuse map and technical notes (carried forward, updated)

| Feature | Reuse | Android work still to do |
|---|---|---|
| Tree, create/move/delete, templates | core-tree, ui-tree, service | touch menus |
| Editor | packages/editor | scroll-into-view above the keyboard is verified; toolbar already docks |
| Search, queries, views, relations | core-index, ui-search, ui-views | narrow-screen views |
| Sync merge, conflict files, history | core-sync | change source (no watcher) |
| Rules, buttons, plugins | core-automation, service automation | host without shell/js; device id/heartbeat; plan |
| Global offers (`!global`) | service globals.ts | `globalDir` in app storage (off for now: `globalsEnabled: false`) |
| Export | core-export | share sheet; PDF later |
| Settings | service settings.ts | stored in `settings.json` in the app's private folder |

- **Images/attachments:** `Deps.assetUrl` turns a workspace path into a Capacitor file address. The original brief asked for
  the same "only inside this workspace" refusal that `assetFileOf` does on desktop; `convertFileSrc` does **not** enforce
  that. Decide before release (WebViewAssetLoader with a path check is the strict option).
- **`docs/` is the built-in documentation** that desktop opens as a read-only workspace (`docsFolder`). Do not put developer
  notes there (this plan lives in `apps/mobile/PLAN.md` for that reason). The Android user page goes in at M6.
- **Permissions to add as features land:** `POST_NOTIFICATIONS` (13+), `SCHEDULE_EXACT_ALARM` (12+), `RECEIVE_BOOT_COMPLETED`,
  battery-optimisation advice. Already in: `MANAGE_EXTERNAL_STORAGE`.

## 8. Notifications and rules (design, unchanged)

**Principle:** same engine, same rule files; the phone is one more computer in the multi-computer model
(`docs/automation/computers.md`): own device id and heartbeat file in `.cave-notes`, **lower priority than the desktop**,
check-before-act, idempotent actions. Never double-fire a notification or a `set_property` the desktop already did.

Three tiers, built in this order:
1. **App open:** the full engine as on desktop; `notify` is an in-app toast, and a system notification when in the background.
2. **Planned alarms (app closed):** a pure function `planNotifications(rules, index, now, horizon) → Alarm[]` in `core-automation`
   (unit-tested in Node, usable by desktop later) computes the upcoming time-based `notify` occurrences for ~7 days, capped at
   ~100. A plugin schedules each with `AlarmManager` (`setExactAndAllowWhileIdle` if the exact-alarm permission is granted, else
   `setAndAllowWhileIdle`, and say which is in effect), with text and deep link already resolved. Rebuild whenever pages or rules
   change in the app, and on boot. No JavaScript is needed when the alarm fires, so it is reliable.
3. **Refreshing the plan with the app closed:** Syncthing may change a due date while the app is closed. A periodic `WorkManager`
   job (1–3 h) starts a headless run (hidden WebView, same bundle, `headless=1`): rescan changed files, recompute the plan,
   reschedule alarms; then, behind a setting, run rules that change files. **Spike this before committing.** Fallback: the plan
   refreshes on app open and whenever Syncthing's folder changes while a foreground service is allowed.

Background limits: no shell, no `run_js`; file-writing actions only in the headless step and only if the setting is on.
To specify and test: channels (reminders, rule results), grouping, tap → open page, snooze/done actions if cheap, time zone and
DST changes (recompute), the exact-alarm permission flow, battery advice, a clear status line in Preferences ("Reminders:
exact / approximate / off"), and the "Test notification in 1 minute" button.

## 9. Phone checks pending (do these before the next stage)

Build with `bash apps/mobile/scripts/build-apk.sh --install`, then:

**The app itself**
1. First start: the "Allow access to files" screen appears; allow it; the app continues by itself.
2. The welcome screen offers to open a folder. Choose your synced notes folder with the picker. A folder with no `.cave-notes`
   inside will ask whether to make it a workspace.
3. Tree, open a page, edit, close and reopen the app: your tabs should come back.
4. Search for a word you know is in a page body (full text).
5. A page with an image: does the image show? (Most likely thing to fail; see section 7.)
6. Edit a page on the desktop, let Syncthing carry it over, then reopen the app: is the change there? (No live watching yet.)
7. Android Back button: closes dialogs, closes the drawer, steps back through pages, and only then leaves the app.
8. The editor: long-press selects a word; the docked bar appears; Indent/Outdent on a nested list; `its` → `it's` with Gboard.

**The numbers (Developer check page → Service check)**: Start service, Open workspace on the biggest folder; note "opened in",
"indexing finished at", search time, Save index size, then Close and Open again (restore time). Also: does the app stay
responsive while indexing, and does it survive going to the background and back?

**Desktop:** launch the desktop app once, open a workspace, edit, search, rename a page that has links (the service moved
packages and now goes through the platform seam).

## 10. Risks and kill criteria (updated)

| Risk | Signal | Response |
|---|---|---|
| ~~CodeMirror + Gboard unusable~~ | M0 passed | resolved |
| WASM index too slow / too big in memory on the real workspaces | M2 phone numbers | bulk listing call; lazy or partial indexing; native async SQLite for hot paths |
| Bridge latency (every file call crosses worker → page → Java) | many seconds to open | bulk `listTree`; cache more aggressively |
| Images cannot load through the Capacitor file route | check 5 above | WebViewAssetLoader with a path check |
| Exact alarms or background refresh unreliable on this phone's OEM | M5 | document limits; "plan refresh on open" is the guarantee, background best-effort |
| One worker per workspace uses too much memory with several tabs | M2/M3 | limit open workspaces; share one worker |
| Big refactors destabilise desktop | any step | small steps; the test suites are the gate |

## 11. Settled questions

Distribution by sideloading, so all-files access is fine. Minimum Android 11 (API 30; the permission needs it). Largest
workspace 22 GB, mostly attachments, several hundred notes. Package id `com.lynnmichaelmartin.cavenotes`, name "Cave Notes".
Same repository, `apps/mobile`. Tablets: same UI. No hardware-keyboard or tablet testing for now. Background file changes: only
notify until M5 is proven.

## 12. To resume with Claude

Upload the repository zip (and this file), then say something like: "Continue the Android plan from `apps/mobile/PLAN.md`.
Here are the phone results from section 9: …". Claude should read sections 1 to 5, confirm which pending checks have results,
and start at the first unchecked item in section 5, keeping to the rules in section 0.


## Second phone run (Lynn's notes) and what was done

Written, not yet tried on the phone:
- **Log for freezes.** The app keeps a log file (`files/logs/cave-notes.log`, 2 MB, one older file) and a copy of its end in
  `Download/cave-notes-log.txt` each time the app goes to the background; "View Logs…" in the menu shows it too. It records:
  how long the page was blocked and what it was doing then (`blocked 1840 ms … doing: openWorkspace X (4.1 s so far) | fs 3
  running, 38 waiting`), long tasks, every call to the service that took 400 ms or more, every file operation of 300 ms or more or
  500 KB or more, a summary of file operations every 5 s, memory, the time to open a page until it was drawn, the log of each
  workspace's worker, and how the last run ended (killed in the background / did not end cleanly in front). Note text is never
  logged. To report a freeze: send `cave-notes-log.txt`.
- **Opening a workspace** now lists the whole folder tree with one native call (`CaveFs.tree`) and answers the listings and stats that
  indexing asks for from it (30 s), instead of a call per folder; the same on a rescan. The log says how long it took and how many
  entries. The Java part is new and could not be compiled here.
- **Session.** The open tabs and pages are written at once when they change and when the app goes to the background; an empty
  list is not written before the saved tabs have been reopened. The log says what was reopened. Scroll position and cursor are not kept yet.
- Back and forward buttons are not shown on the phone (the system back gesture steps back).
- Tab cards are opaque (a CSS variable was misnamed). Messages are small, one line or two, only the newest.
- Select all: a button in the docked menu, and the system's Select all on a long page selects the whole page.

Still open: why the app starts again after being in the background (Android stops it to take its memory; the log now says so;
the next step is to use less memory), and the sizes of big pages.
