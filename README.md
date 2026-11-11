# Cave Notes

A notes app where you’ll own everything and be happy.

# Features
- Powerful search and automations
- Simple interface
- Local notes storage—your notes are your files
- Syncs on your terms—if you want to sync, you can use Syncthing, a network folder, or your cloud storage provider
- No lock-in—uses human-readable Markdown and YAML to store notes
- Hardened against sync conflicts

# How it works
This is a notes app that uses what I call the “notes in place” (NIP) method. Like Obsidian, it uses local *.md (Markdown) files as the source of truth. It maps the notes as a hierarchy based on folder structure.

The app is built with the assumption that your notes are spread throughout your filesystem (though that’s up to you). You can specify any folder as a Cave Notes workspace, and everything in it will be indexed. The *.md files (or plain text files with any extensions that you choose) will be treated as notes and have their contents indexed too.

Cave Notes works with your file system. You can arbitrarily decide which file folders are your workspaces. The “file tree” (a pane where your notes are organized in a hierarchy) just follows your folder structure. You can also use Notion-like query views to organize your notes in another way that makes sense to you. Treat them like files or treat them like a database, however you like.

What this means is that you can live inside Cave Notes and link or reference any of your files here. But whenever you’re outside of Cave Notes, nothing is holding you back from accessing your notes or attachments in whatever way you choose.

The app also has a hybrid text/rendered editor, outline and link sidebars, and fast indexed search with attribute filtering.

# Documentation

Documentation is installed with the app. Just press F1.

# Installation

You can see the AppImage release [here](https://github.com/elvishcraftsman/cave-notes/releases). Right now there aren’t builds for Windows or Mac, but only Linux. Android is in progress.

# Building

## Requirements

- Node.js 20 or newer, and npm.
- A C/C++ toolchain and Python 3 (`gcc`, `g++`, `make`, `python3`) so `better-sqlite3` can compile against Electron.
- Network access on the first install (npm packages, Electron binary, Electron headers).
- Fedora Silverblue note: the host is immutable, so do development inside a toolbox or distrobox container, for example `toolbox create cave && toolbox enter cave`, then `sudo dnf install nodejs npm gcc-c++ make python3`. The Electron window opens from the container normally under GNOME (Wayland or X11).

## First run

```bash
unzip cave-notes-in-progress.zip -d cave-notes && cd cave-notes
npm install                        # at the repo root: installs every package in the monorepo
cd apps/desktop
npm run rebuild                    # compiles better-sqlite3 for Electron's ABI (needed once, and after upgrading Electron)
npm start                          # builds the bundles, then launches Electron
```

To open a specific folder at launch: `npm start -- /path/to/notes` (or set `CAVE_OPEN=/path/to/notes`). With no folder it shows the welcome screen and remembers your last workspace.

## Everyday commands

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

## End-to-end tests

`npm run e2e` needs `xvfb` (`sudo dnf install xorg-x11-server-Xvfb`) and uses plain Node for the worker (`CAVE_WORKER_NODE=1`), so it does not need `npm run rebuild`. It creates a sample workspace in `/tmp/cave-sample`, runs the script in `e2e/flows.cjs` against the built app, and writes screenshots to `/tmp/cave-shots`. Expect `73 passed, 0 failed`. Run `npm run build` first if you changed code.

## Handy environment variables

| Variable | Effect |
|---|---|
| `CAVE_OPEN=/path` | open this folder at startup |
| `CAVE_NATIVE_FRAME=1` | use the system title bar instead of the custom header bar |
| `CAVE_WORKER_NODE=1` | run the indexing worker in plain Node (no Electron rebuild of SQLite needed) |
| `ELECTRON_OZONE_PLATFORM_HINT=auto` | let Electron choose Wayland or X11 |

## Troubleshooting

- **`npm install` fails while compiling `better-sqlite3`:** install the toolchain above, or run `npm install --ignore-scripts` and then `npm run rebuild` in `apps/desktop`.
- **App starts but shows an error about a native module or `NODE_MODULE_VERSION`:** run `npm run rebuild` in `apps/desktop` again.
- **"The SUID sandbox helper binary was not configured correctly":** common in containers. For development only, launch with `npx electron . --no-sandbox`.
- **Blank window or GPU errors in a container:** try `npx electron . --disable-gpu`.
- **Search finds nothing in a freshly opened big folder:** wait for the footer to stop saying "Indexing…".

# License

MIT-0. Use as you wish.