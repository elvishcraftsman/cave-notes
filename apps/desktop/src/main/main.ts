import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, protocol, screen, session, shell, Tray, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import { type Envelope, EVENT_NAMES, MAIN_METHODS, type MainApi, type Settings, WORKER_METHODS, type WindowState, type WireError, type WorkerEvents, type WorkspaceInfo } from '../shared/api';
import { cleanStyleSet, exportPage, parseDoc, parseStyleSetsYaml, renderHtml } from '@cave-notes/core-export';
import { cleanDictionary, cleanNoteTypes, portableSettings, SettingsStore } from './settings';
import { scanForWorkspaces, scanRoots } from './scan';
import { noLongerWorkspaces, promoteFolder, removeWorkspace, workspaceStatus } from './workspaces';
import { CONFIG_NOTES, isConfigRoot } from '@cave-notes/service/config-folder';
import { WorkerClient } from './worker-client';
import { integrate, removeIntegration } from './appimage-integration';
import { appConfigFolder, seedDefaults } from '@cave-notes/service/app-config';
import { UpdateManager } from './update-manager';
import { variantOf } from './updater';
import { readConfigSync } from '@cave-notes/core-index/config';
import { handleJs } from './automation-js';
import { Approvals, handleShell, type ShellRequest } from './automation-shell';
import { ScriptTrust, runScript as runScriptBlock } from './script-runner';
import { BUILTIN_STYLES, stringifyStyleSets } from '@cave-notes/core-export';
import { importFromFiles } from './importFiles';
import { zipFolder } from './zip';
import { listLogSources, readLogSource, type AutomationLogRef } from './logs';
import { configureLog, isLevel, log, logFile, logLevel, rotateLog, setLogLevel, watchEventLoop, type Level } from '../shared/log';

// ---------------------------------------------------------------- logging
// One file for the whole app (main, workers, and the windows' console errors): <userData>/logs/cave-notes.log.
// Level: CAVE_LOG=debug|trace in the environment, or Help > Verbose Logging (remembered by a marker file).
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const VERBOSE_MARK = path.join(LOG_DIR, 'verbose');
configureLog({
  file: path.join(LOG_DIR, 'cave-notes.log'),
  level: isLevel(process.env.CAVE_LOG) ? process.env.CAVE_LOG : fs.existsSync(VERBOSE_MARK) ? 'debug' : 'info',
  tag: 'main',
  mirror: true,
});
rotateLog();
process.on('uncaughtException', (e) => log.error('uncaught exception in main', e));
process.on('unhandledRejection', (e) => log.error('unhandled rejection in main', e));


const THEMES = {
  dark: { bg: '#242424', header: '#303030', symbols: '#ffffff' },
  light: { bg: '#fafafa', header: '#ebebeb', symbols: '#2e3436' },
} as const;
const HEADER_HEIGHT = 47;
/** The window buttons stop one pixel short of the header's bottom border, so the line runs under them too. */
const OVERLAY_HEIGHT = HEADER_HEIGHT - 1;

app.setName('Cave Notes');
protocol.registerSchemesAsPrivileged([{ scheme: 'cave-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

/** One open window: its tabs, and whether it may close without asking its page to save first. */
interface WinInfo {
  win: BrowserWindow;
  state: WindowState;
  /** the last state of this window that still had tabs (a closing window may empty its own list first) */
  lastState?: WindowState;
  allowClose: boolean;
  /** colour of the title bar (#rrggbb), null for the theme's own */
  header: string | null;
}
const wins = new Map<number, WinInfo>();
/** A window closed this shortly before the app itself closes still belongs to the session that is ending. */
const RECENTLY_CLOSED_MS = 30_000;
const recentlyClosed: Array<{ state: WindowState; at: number }> = [];
let settings: SettingsStore;
let quitting = false;

/**
 * A workspace open in at least one window. All windows share one worker per workspace; the worker stays
 * until the last window that has the workspace open lets go of it.
 */
interface Attached {
  id: string;
  root: string;
  /** the folder files may be read from: the root itself, or the folder of a single Markdown file opened on its own (then `root` is the file) */
  scope: string;
  /** set for a single file: its name */
  file: string | null;
  /** a workspace's own `.cave-notes` folder, opened to edit its settings files and templates (a lightweight workspace) */
  config: boolean;
  /** the bundled documentation, opened read only (a lightweight workspace like `config`, which it also sets) */
  docs: boolean;
  windows: Set<number>;
  opened: Promise<WorkspaceInfo> | null;
  lastStatus: { state: 'indexing' | 'ready'; pages: number; files?: number; percent?: number; phase?: string } | null;
  /** what the workspace's automations told us: whether it has any, and whether some depend on the clock */
  automation: { active: boolean; timed: boolean } | null;
}
const attached = new Map<string, Attached>();
const rootById = new Map<string, string>();
const workers = new Map<string, WorkerClient>();
let nextId = 1;

const wireError = (e: unknown): WireError => {
  const err = e as { message?: string; code?: string; name?: string };
  return { message: err?.message ?? String(e), ...(err?.code ? { code: err.code } : {}), ...(err?.name ? { name: err.name } : {}) };
};

const sendTo = (w: BrowserWindow | null | undefined, name: string, payload?: unknown, root?: string): void => {
  if (w && !w.isDestroyed()) w.webContents.send('cave:event', name, payload, root);
};
/** To the window the person is using (menu commands go there). */
const focusedInfo = (): WinInfo | null => {
  const f = BrowserWindow.getFocusedWindow();
  const fi = f ? wins.get(f.id) : undefined;
  return fi ?? [...wins.values()].at(-1) ?? null;
};
const sendFocused = (name: string, payload?: unknown): void => sendTo(focusedInfo()?.win, name, payload);
/** To every window that has this workspace open. */
const sendToRoot = (root: string, name: string, payload?: unknown): void => {
  for (const id of attached.get(root)?.windows ?? []) sendTo(wins.get(id)?.win, name, payload, root);
};
const sendToOthers = (except: BrowserWindow | null, name: string, payload?: unknown): void => {
  for (const i of wins.values()) if (i.win !== except) sendTo(i.win, name, payload);
};

/** The open workspace that contains `abs`, if any. (Everything the renderer asks us to touch must be inside one.) */
const isFileSync = (abs: string): boolean => {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
};

/** Other places a link written in a page may mean: inside the page's own folder (`Foo.md` → `Foo/`), then at the top of the workspace. */
function alternativeAssets(root: string, from: string | null, href: string | null): string[] {
  if (!from || !href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return [];
  const rel = href.startsWith('/') ? href.slice(1) : decodeURIComponent(href);
  const folder = from.replace(/\.[^./]+$/, '');
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const out = [path.resolve(root, folder, rel), path.resolve(root, rel)];
  // a link that already names the folder (`Foo/pic.jpg`) read from inside it (`Foo/Foo/pic.jpg`): take the repeat out
  const leaf = folder.split('/').pop() ?? '';
  const parts = rel.split('/');
  if (leaf && parts[0] === leaf) out.push(path.resolve(root, dir, rel.split('/').slice(1).join('/')));
  return out;
}

/** The file a `cave-asset://` address stands for, only if it lies inside the workspace the address names. */
function assetFileOf(address: string): string | null {
  const refused = (why: string): null => {
    // said once per address, so that a page of broken pictures does not fill the log
    if (!assetRefusals.has(address)) {
      if (assetRefusals.size > 500) assetRefusals.clear();
      assetRefusals.add(address);
      log.warn(`picture refused (${why}): ${address}`);
    }
    return null;
  };
  try {
    const url = new URL(address);
    const root = rootById.get(url.hostname);
    if (!root) return refused(`no open workspace has the id “${url.hostname}”: it was closed and opened again, or the window still has an old address`);
    const rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let abs = path.resolve(root, rel);
    // inside the workspace the address names (not "the first open workspace that contains it": with workspaces inside
    // workspaces, an outer one would claim the file and the image would be refused)
    const scope = attached.get(root)?.scope ?? root;
    const inside = (a: string): boolean => {
      const r = path.relative(scope, a);
      return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
    };
    if (!inside(abs)) return refused(`outside the workspace ${scope}`);
    if (!isFileSync(abs)) {
      // The link is relative to the page's folder, not to the folder the page stands in (or the other way round): try the
      // other readings of it before giving up.
      const found = alternativeAssets(root, url.searchParams.get('from'), url.searchParams.get('href')).find((a) => inside(a) && isFileSync(a));
      if (found) abs = found;
      else {
        const who = url.searchParams.get('from') ? ` (written as “${url.searchParams.get('href')}” in the page “${url.searchParams.get('from')}”)` : '';
        return refused(`no such file: ${abs}${who}`);
      }
    }
    return abs;
  } catch (e) {
    return refused(`unreadable address: ${(e as Error).message}`);
  }
}

const assetRefusals = new Set<string>();

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif' };

/** Put the pictures of a presentation inside its HTML, so that the file stands alone. */
function inlineAssets(html: string): string {
  return html.replace(/cave-asset:\/\/[^"'()\s<>]+/g, (m) => {
    const abs = assetFileOf(m.replace(/&amp;/g, '&'));
    const mime = abs ? MIME[path.extname(abs).toLowerCase()] : undefined;
    return abs && mime ? `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}` : m;
  });
}

let presenting: BrowserWindow[] = [];

/**
 * Show a presentation full screen on a screen of its own, and (if asked) the presenter's window on another. The windows have
 * no connection to the app: they say what slide they are on by writing `CN:{...}` to their console, which is read here and
 * passed to the other window, and the keys that end the show are caught here too.
 */
/** Is the app a Wayland client (where windows cannot be placed by their position)? Started with `--ozone-platform=x11` it is not. */
function onWayland(): boolean {
  if (process.platform !== 'linux') return false;
  const forced = app.commandLine.getSwitchValue('ozone-platform');
  if (forced) return forced === 'wayland';
  return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
}

async function startPresentation(req: { html: string; presenterHtml: string | null; screen: string; presenterScreen: string; appWindow: BrowserWindow | null }): Promise<void> {
  for (const old of presenting) if (!old.isDestroyed()) old.destroy();
  presenting = [];
  const displays = screen.getAllDisplays();
  const appDisplay = req.appWindow ? screen.getDisplayMatching(req.appWindow.getBounds()) : screen.getPrimaryDisplay();
  const byId = (id: string): Electron.Display | undefined => displays.find((d) => String(d.id) === id);
  // the audience: the chosen screen, else a screen other than the one with the app, else that one
  const audience = byId(req.screen) ?? displays.find((d) => d.id !== appDisplay.id) ?? appDisplay;
  // the presenter: the chosen screen, else the one with the app (when that is not the audience's)
  const presenterDisplay = req.presenterHtml ? byId(req.presenterScreen) ?? (appDisplay.id !== audience.id ? appDisplay : undefined) : undefined;
  const temp: string[] = [];
  const open = async (html: string, d: Electron.Display | undefined, full: boolean): Promise<BrowserWindow> => {
    const area = (d ?? audience).bounds;
    const win = new BrowserWindow({
      x: full ? area.x : area.x + Math.round(area.width * 0.05),
      y: full ? area.y : area.y + Math.round(area.height * 0.05),
      width: full ? area.width : Math.round(area.width * 0.9),
      height: full ? area.height : Math.round(area.height * 0.9),
      frame: !full,
      backgroundColor: '#111111',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setMenuBarVisibility(false);
    if (full && onWayland()) {
      // A Wayland program cannot say where its window goes. Chromium can ask for full screen on a chosen screen (the multi-screen
      // fullscreen request), so the window is let to ask for that, once it has loaded, for the screen that was chosen.
      const ses = win.webContents.session;
      ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'window-management'));
      ses.setPermissionCheckHandler((_wc, permission) => permission === 'window-management');
    }
    const file = path.join(os.tmpdir(), `cave-present-${process.pid}-${Date.now()}-${temp.length}.html`);
    temp.push(file);
    await fs.promises.writeFile(file, inlineAssets(html));
    await win.loadFile(file);
    win.show();
    if (full && onWayland()) {
      const { x, y, width, height } = (d ?? audience).bounds;
      const asked = await win.webContents
        .executeJavaScript(
          `(async () => { const all = (await window.getScreenDetails()).screens; const s = all.find((q) => q.availLeft === ${x} && q.availTop === ${y}) || all.find((q) => q.left === ${x} && q.top === ${y} && q.width === ${width} && q.height === ${height}); await document.documentElement.requestFullscreen(s ? { screen: s } : undefined); return !!s; })()`,
          true,
        )
        .catch((err: unknown) => {
          log.warn('main', `full screen on a chosen screen is not available on Wayland here: ${String(err)}`);
          return false;
        });
      if (!asked) win.setFullScreen(true); // on the screen the compositor picked
    } else if (full) win.setFullScreen(true);
    win.focus();
    return win;
  };
  const wins: BrowserWindow[] = [await open(req.html, audience, true)];
  if (req.presenterHtml) wins.push(await open(req.presenterHtml, presenterDisplay ?? appDisplay, false));
  presenting = wins;
  const closeAll = (): void => {
    for (const x of wins) if (!x.isDestroyed()) x.destroy();
  };
  await new Promise<void>((resolve) => {
    let left = wins.length;
    wins.forEach((win, i) => {
      win.webContents.on('console-message', (...args: unknown[]) => {
        const first = args[0] as { message?: unknown } | undefined;
        const message = typeof first?.message === 'string' ? first.message : String(args[2] ?? '');
        if (!message.startsWith('CN:')) return;
        try {
          const m = JSON.parse(message.slice(3)) as { go?: number; exit?: boolean };
          if (m.exit) return closeAll();
          if (typeof m.go === 'number') for (const other of wins) if (other !== win && !other.isDestroyed()) void other.webContents.executeJavaScript(`window.cnGo && window.cnGo(${Math.trunc(m.go)})`).catch(() => undefined);
        } catch {
          /* not for us */
        }
      });
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') closeAll();
      });
      win.on('closed', () => {
        if (i === 0) closeAll();
        if (--left === 0) resolve();
      });
    });
  });
  presenting = [];
  for (const f of temp) await fs.promises.rm(f, { force: true });
}

function workspaceOf(abs: string): string | null {
  for (const [root, a] of attached) {
    const rel = path.relative(a.scope, abs);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return root;
  }
  return null;
}

/** Does the name end with one of the extensions the app treats as notes (see the preferences)? */
function isNotePath(p: string): boolean {
  const low = p.toLowerCase();
  return settings.get().noteExts.some((e) => low.endsWith(e));
}

/** A notes file (not a folder) that exists. Such a path is opened on its own, in a tab of its own. */
function isMarkdownFile(p: string): boolean {
  try {
    return isNotePath(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Where the files that belong to one computer are kept (search index, view state, history, undo journals): with the app's own
 * data, never inside the workspace, so they work with any sync tool and nothing has to be excluded.
 */
/** The documentation is plain Markdown pages. */
const DOCS_NOTES = { exts: ['.md'], create: '.md' };
/** Where the bundled documentation is: beside the app's resources once packaged, the repository's docs folder when developing. */
const docsRoot = (): string => path.resolve(app.isPackaged ? path.join(process.resourcesPath, 'docs') : path.join(app.getAppPath(), '..', '..', 'docs'));
const isDocsRoot = (root: string): boolean => path.resolve(root) === docsRoot();

const dataDirFor = (root: string): string => path.join(app.getPath('userData'), 'workspaces', crypto.createHash('sha1').update(root).digest('hex').slice(0, 16));

/** Where workspaces publish the settings they offer to all workspaces, and where this computer's answers are kept. */
const fontsRoot = (): string => path.join(__dirname, 'fonts');
const WINDOW_ICON = path.join(__dirname, 'icons', '256.png');
const WEIGHT_OF = (f: string): number => (/Bold|RB|RBI/.test(f) ? 700 : 400);
const ITALIC_OF = (f: string): boolean => /Italic|RI|RBI/.test(f);
function listBundledFonts(): { url: string; families: Array<{ family: string; files: Array<{ file: string; weight: number; italic: boolean }> }> } {
  const root = fontsRoot();
  const families = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({
        family: d.name,
        files: fs.readdirSync(path.join(root, d.name)).filter((f) => /\.ttf$/i.test(f)).map((f) => ({ file: `${d.name}/${f}`, weight: WEIGHT_OF(f), italic: ITALIC_OF(f) })),
      }))
    : [];
  return { url: `${pathToFileURL(root).href}/`, families };
}
/** @font-face rules for the bundled fonts, so an export looks right on a computer that does not have them installed. */
function fontFaceCss(): string {
  const { url, families } = listBundledFonts();
  return families.flatMap((f) => f.files.map((x) => `@font-face{font-family:'${f.family}';font-weight:${x.weight};font-style:${x.italic ? 'italic' : 'normal'};src:url('${url}${x.file.split('/').map(encodeURIComponent).join('/')}')}`)).join('\n');
}
async function copyFonts(dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const fam of listBundledFonts().families) {
    for (const f of fam.files) await fs.promises.copyFile(path.join(fontsRoot(), f.file), path.join(dest, path.basename(f.file)));
    const lic = path.join(fontsRoot(), fam.family, 'OFL.txt');
    if (fs.existsSync(lic)) await fs.promises.copyFile(lic, path.join(dest, `${fam.family.replace(/ /g, '-')}-OFL.txt`));
  }
}
const globalDir = (): string => path.join(app.getPath('userData'), 'global-settings');
/** The app's own settings folder (its plugins and templates), and the folder of defaults that ships inside the app. */
const appConfigDir = (): string => appConfigFolder(app.getPath('userData'));

/**
 * The export styles of every workspace live in the app's own folder, in `styles/` like a workspace's. The default styles are
 * written there the first time, so they can be edited like any other. (Before, styles were in `export-styles.yaml` of the
 * app data folder: it is moved here the first time.)
 */
const globalStylesFile = (): string => {
  const dir = path.join(appConfigDir(), 'styles');
  const file = path.join(dir, 'export-styles.yaml');
  const old = path.join(app.getPath('userData'), 'export-styles.yaml');
  const seeded = path.join(dir, '.defaults-seeded');
  try {
    if (!fs.existsSync(file) && fs.existsSync(old)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(old, file);
      fs.rmSync(old, { force: true });
    }
    if (!fs.existsSync(file) && !fs.existsSync(seeded)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `# The export styles of every workspace. The styles that come with Cave Notes are here so you can change them; delete one and the built-in version is used again.\n# A workspace's own style with the same name wins over the one here.\n${stringifyStyleSets(BUILTIN_STYLES)}`);
      fs.writeFileSync(seeded, 'The default export styles were written to export-styles.yaml once; this file keeps them from coming back if you remove them.\n');
    }
  } catch (e) {
    log.warn(`the global export styles folder: ${(e as Error).message}`);
  }
  return file;
};

/** The styles in the other YAML files of that folder (ones that were added from a file): all of them in one text. */
const otherStyleFiles = (): string => {
  const main = globalStylesFile();
  const dir = path.dirname(main);
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.ya?ml$/i.test(n) && !n.startsWith('.') && path.join(dir, n) !== main)
      .sort((a, b) => a.localeCompare(b))
      .map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))
      .join('\n');
  } catch {
    return '';
  }
};
const shippedDefaultsDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'defaults') : path.join(app.getAppPath(), 'defaults'));

const noteTypesNow = (): { exts: string[]; create: string } => ({ exts: settings.get().noteExts, create: settings.get().noteCreate });

/** Make sure a workspace is in the list of workspaces the app knows about. */
function knownWorkspace(root: string): void {
  const s = settings.get();
  if (s.recent.includes(root) || s.found.includes(root)) return;
  settings.set({ found: [...s.found, root].sort((a, b) => a.localeCompare(b)) });
  sendToOthers(null, 'settings:changed', { found: settings.get().found });
}

/** Forget listed workspaces whose folder is still there but no longer holds a `.cave-notes` folder (removed elsewhere, then synced). */
async function pruneStaleWorkspaces(): Promise<void> {
  const s = settings.get();
  const gone = new Set(await noLongerWorkspaces([...new Set([...s.recent, ...s.found])].filter((r) => !attached.has(path.resolve(r)))));
  if (gone.size === 0) return;
  const now = settings.get();
  const patch = { recent: now.recent.filter((r) => !gone.has(r)), found: now.found.filter((r) => !gone.has(r)) };
  settings.set(patch);
  sendToOthers(null, 'settings:changed', patch);
  log.info(`forgot ${gone.size} workspace(s) whose .cave-notes folder is gone: ${[...gone].join(', ')}`);
}

let scanning: Promise<string[]> | null = null;
/** Look through the chosen folders for workspaces and remember what was found (one scan at a time). */
function scanNow(): Promise<string[]> {
  scanning ??= (async () => {
    try {
      const s = settings.get();
      const found = await scanForWorkspaces(scanRoots(s.scanFolders), s.scanIgnore);
      settings.set({ found });
      sendToOthers(null, 'settings:changed', { found });
      await pruneStaleWorkspaces().catch(() => undefined);
      return settings.get().found;
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

function attach(rootArg: string, windowId: number): Attached {
  const root = path.resolve(rootArg);
  let a = attached.get(root);
  if (!a) {
    const isFile = isMarkdownFile(root);
    a = { id: `w${nextId++}`, root, scope: isFile ? path.dirname(root) : root, file: isFile ? path.basename(root) : null, config: !isFile && (isConfigRoot(root) || isDocsRoot(root)), docs: !isFile && isDocsRoot(root), windows: new Set(), opened: null, lastStatus: null, automation: null };
    attached.set(root, a);
    rootById.set(a.id, root);
  }
  a.windows.add(windowId);
  log.info(`attach ${root} window=${windowId} (now ${a.windows.size} window(s))${a.file ? ' single-file' : ''}${a.config && !a.docs ? ' config-folder' : ''}${a.docs ? ' documentation' : ''}`);
  return a;
}

/** A window lets go of a workspace; the last one to do so ends its worker. */
async function detach(rootArg: string, windowId: number): Promise<void> {
  const root = path.resolve(rootArg);
  const a = attached.get(root);
  if (!a) return;
  a.windows.delete(windowId);
  // Automations that depend on the clock keep the workspace (and its worker) running without a window, if the person allowed it.
  if (a.windows.size === 0 && windowId !== BACKGROUND && settings.get().automationBackground && a.automation?.timed && !quitting) {
    a.windows.add(BACKGROUND);
    log.info(`detach ${root} window=${windowId}: no window left, kept running in the background for its automations`);
    return;
  }
  log.info(`detach ${root} window=${windowId} (${a.windows.size} window(s) left${a.windows.size === 0 ? ', stopping its worker' : ''})`);
  if (a.windows.size > 0) return;
  attached.delete(root);
  rootById.delete(a.id);
  const w = workers.get(root);
  workers.delete(root);
  if (w) {
    await w.call('closeWorkspace', []).catch(() => {});
    w.kill();
  }
}

/** The worker of an open workspace, started on first use. */
function workerFor(rootArg: string): WorkerClient {
  const root = path.resolve(rootArg);
  const a = attached.get(root);
  if (!a) throw Object.assign(new Error('That workspace is not open'), { code: 'NO_WORKSPACE' });
  let w = workers.get(root);
  if (!w) {
    w = new WorkerClient(path.join(__dirname, 'worker.mjs'), path.basename(root));
    w.onEvent((event, payload) => {
      // what automations ask of the main process (they are never forwarded to windows)
      if (event === 'automation:notify') return showAutomationNotification(payload as WorkerEvents['automation:notify']);
      if (event === 'automation:shell') return void answerAutomationShell(root, w!, payload as WorkerEvents['automation:shell']);
      if (event === 'automation:js') return void answerAutomationJs(w!, payload as WorkerEvents['automation:js']);
      if (event === 'automation:rules') return void answerAutomationRules(w!, payload as WorkerEvents['automation:rules']);
      if (event === 'automation:active') return onAutomationActive(a, payload as WorkerEvents['automation:active']);
      if (!(EVENT_NAMES as readonly string[]).includes(event)) return;
      if (event === 'index:status') a.lastStatus = payload as Attached['lastStatus'];
      sendToRoot(root, event, payload);
    });
    workers.set(root, w);
  }
  return w;
}

// ---------------------------------------------------------------- automations: notifications, shell commands, background

/** A pseudo window number: a workspace that is "open" in this keeps its worker running although no window shows it. */
const BACKGROUND = -2;

let approvals: Approvals | null = null;
const approvalsNow = (): Approvals => (approvals ??= new Approvals(path.join(app.getPath('userData'), 'automation-approvals.json')));

let scriptTrust: ScriptTrust | null = null;
const scriptTrustNow = (): ScriptTrust => (scriptTrust ??= new ScriptTrust(path.join(app.getPath('userData'), 'script-trust.json')));
/** The script a window is running right now (the Run button of a code block), so its Stop button can end it. */
const runningScripts = new Map<number, AbortController>();

/** "Run scripts from this workspace?", asked the first time the Run button is used in a workspace. */
async function askScriptTrust(root: string, parent: BrowserWindow | null): Promise<boolean> {
  const opts = {
    type: 'warning' as const,
    title: 'Run scripts from this workspace?',
    message: `Are you sure you want to run scripts from “${path.basename(root)}”?`,
    detail: `A script in a note can do anything you can do on this computer: change or delete files, use your accounts, go online. Notes can be changed by other people and other computers that share this workspace, so only say yes if you trust everything in it.\n\nIf you say yes, the Run button works for every script in this workspace from now on. Preferences can forget your answer.`,
    buttons: ['Cancel', 'Yes, run scripts from this workspace'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const r = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  return r.response === 1;
}

function showAutomationNotification(n: WorkerEvents['automation:notify']): void {
  try {
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: n.title || 'Cave Notes', body: n.body, silent: false });
    note.on('click', () => {
      const w = focusedInfo()?.win;
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    });
    note.show();
  } catch (e) {
    log.warn(`could not show a notification: ${(e as Error).message}`);
  }
}

/**
 * A question about something long (a command, a script, a file of rules) must not grow taller than the screen: a few lines of it
 * are shown, and when there is more a button opens the whole text, as a copy to read, in the person's own text editor. The question
 * is asked again afterwards. Returns the index of the button pressed (of `buttons`).
 */
const REVIEW_LINES = 10;
const REVIEW_CHARS = 900;
async function askWithText(o: { title: string; message: string; before?: string; text: string; after?: string; buttons: string[]; ext: string; name: string }): Promise<number> {
  const parent = focusedInfo()?.win;
  const lines = o.text.split('\n');
  const long = lines.length > REVIEW_LINES || o.text.length > REVIEW_CHARS;
  let shown = lines.slice(0, REVIEW_LINES).join('\n');
  if (shown.length > REVIEW_CHARS) shown = shown.slice(0, REVIEW_CHARS);
  const more = long ? `\n… (${Math.max(1, lines.length - shown.split('\n').length)} more lines, ${o.text.length} characters in all. Press “Open the full text” to read all of it.)` : '';
  const viewIndex = o.buttons.length;
  for (;;) {
    const opts = {
      type: 'warning' as const,
      title: o.title,
      message: o.message,
      detail: `${o.before ? `${o.before}\n\n` : ''}${shown}${more}${o.after ? `\n\n${o.after}` : ''}`,
      buttons: long ? [...o.buttons, 'Open the full text'] : o.buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const r = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (!(long && r.response === viewIndex)) return r.response;
    try {
      const dir = path.join(app.getPath('temp'), 'cave-notes-review');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${o.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.${o.ext}`);
      const mark = o.ext === 'js' ? '// A copy to read. Changing it changes nothing.\n' : '# A copy to read. Changing it changes nothing.\n';
      fs.writeFileSync(file, mark + o.text, { mode: 0o600 });
      await shell.openPath(file);
    } catch (e) {
      log.warn(`could not open the text to review: ${(e as Error).message}`);
    }
  }
}

/** The person's answer to "may this rule run this command?". The command is shown exactly as the rules file says it. */
async function askShell(what: { root: string; ruleId: string; command: string; cwd: string }): Promise<'always' | 'once' | 'deny'> {
  const r = await askWithText({
    title: 'Allow an automation to run a command?',
    message: `The rule "${what.ruleId}" in ${path.basename(what.root)} wants to run a command on this computer.`,
    text: what.command,
    after: `Working folder: ${what.cwd}\n\nOnly allow commands you recognize. The command can do anything you can do. Rules come from the settings files in .cave-notes, which other people or computers may have changed.`,
    buttons: ['Deny', 'Allow once', 'Always allow this command'],
    ext: 'sh',
    name: `command-${what.ruleId}`,
  });
  return r === 2 ? 'always' : r === 1 ? 'once' : 'deny';
}

/** The person's answer to "may this rule run this script?". The script is shown exactly as the rules file says it. */
async function askJs(what: { root: string; ruleId: string; code: string }): Promise<'always' | 'once' | 'deny'> {
  const r = await askWithText({
    title: 'Allow an automation to run a script?',
    message: `The rule "${what.ruleId}" in ${path.basename(what.root)} wants to run a JavaScript script.`,
    text: what.code,
    after: 'The script can read and change the page it works on, and nothing else: it cannot open files, use the network or start programs. Rules come from the settings files in .cave-notes, which other people and computers that share this workspace can change, so only allow scripts you recognize.',
    buttons: ['Deny', 'Allow once', 'Always allow this script'],
    ext: 'js',
    name: `script-${what.ruleId}`,
  });
  return r === 2 ? 'always' : r === 1 ? 'once' : 'deny';
}

/**
 * A rule wants to put a file of automations into the workspace, or take one away. This is asked every time it would change
 * anything, with no "always": what a workspace does from then on is decided here, by the person. The file is shown as it will be written.
 */
async function answerAutomationRules(worker: WorkerClient, ev: WorkerEvents['automation:rules']): Promise<void> {
  const names = ev.summary.rules.map((r) => r.name || r.id);
  const can = [ev.summary.js ? 'run JavaScript' : null, ev.summary.shell ? 'run programs' : null, ev.summary.installs ? 'change automations itself' : null].filter(Boolean);
  const what = ev.remove ? `take away the automations in .cave-notes/${ev.file}` : ev.created ? `add the automations in .cave-notes/${ev.file}` : `replace the automations in .cave-notes/${ev.file}`;
  let answer: { allowed: boolean; reason?: string };
  try {
    const r = await askWithText({
      title: 'Allow an automation to change automations?',
      message: `The rule "${ev.ruleId}" in ${path.basename(ev.root)} wants to ${what}.`,
      before: `${ev.remove ? 'Rules that go away' : 'Rules'}: ${names.join(', ') || 'none'}.\n${can.length > 0 ? `They can ${can.join(' and ')} (each of those also has its own permission in Preferences).` : 'They only change pages and settings of the workspace.'}`,
      text: ev.content,
      after: `Automations decide what this workspace does by itself from now on, and other people and computers that share it receive them. Only allow this if you know what it is for. To undo it, delete .cave-notes/${ev.file}.`,
      buttons: ['Deny', ev.remove ? 'Remove them' : 'Allow'],
      ext: 'yaml',
      name: ev.file.replace(/\.ya?ml$/, ''),
    });
    answer = r === 1 ? { allowed: true } : { allowed: false, reason: 'you did not allow it' };
  } catch (e) {
    answer = { allowed: false, reason: (e as Error).message };
  }
  log.info(`automation rules change (rule ${ev.ruleId}, ${ev.file}): ${answer.allowed ? 'allowed' : 'denied'}`);
  await worker.call('automationRulesResult', [ev.id, answer]).catch(() => undefined);
}

async function answerAutomationJs(worker: WorkerClient, ev: WorkerEvents['automation:js']): Promise<void> {
  let answer: { allowed: boolean; reason?: string };
  try {
    answer = await handleJs({
      root: ev.root,
      ruleId: ev.ruleId,
      code: ev.code,
      jsOn: settings.get().automationJs,
      askOn: settings.get().automationJsAsk,
      approvals: approvalsNow(),
      ask: askJs,
      log: (m) => log.info(m),
    });
  } catch (e) {
    answer = { allowed: false, reason: (e as Error).message };
  }
  await worker.call('automationJsResult', [ev.id, answer]).catch(() => undefined);
}

async function answerAutomationShell(root: string, worker: WorkerClient, ev: WorkerEvents['automation:shell']): Promise<void> {
  let result;
  try {
    result = await handleShell({
      root,
      req: ev.spec as ShellRequest,
      shellOn: settings.get().automationShell,
      approvals: approvalsNow(),
      ask: askShell,
      log: (m) => log.info(m),
    });
  } catch (e) {
    result = { code: -1, denied: true, reason: (e as Error).message };
  }
  await worker.call('automationShellResult', [ev.id, result]).catch(() => undefined);
}

/** A workspace told us whether it has automations. Without any (or when the person turned background running off), it needs no worker without a window. */
function onAutomationActive(a: Attached, st: WorkerEvents['automation:active']): void {
  a.automation = st;
  if (a.windows.has(BACKGROUND) && (!st.timed || !settings.get().automationBackground)) void detach(a.root, BACKGROUND).then(() => maybeQuitIdle());
}

const TRAY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAdklEQVR42u3XMQ6AIAyF4XcoLuFlPDuLs2wmiiYtlBbia8L8fxst8DFp20/LB8lYR1UYr/grwjteIf4NiIpfCAKWBeR83J4b4BnuhcAy3oJYByCNaxEYEdcgCMCouBRBAAEExP8Fmr3Q/B/gWj7NaTbFcRp1nhez0N6NLbZt9AAAAABJRU5ErkJggg==';
let tray: Tray | null = null;

function backgroundRoots(): string[] {
  return [...attached.values()].filter((a) => a.windows.has(BACKGROUND)).map((a) => a.root);
}

/** A little icon (where the desktop has a place for it) to open the app again or end it. */
function ensureTray(): void {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
    tray.setToolTip('Cave Notes: automations are running in the background');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Cave Notes', click: () => openFromBackground() },
      { type: 'separator' },
      { label: 'Quit (stops automations)', click: () => { quitting = false; app.quit(); } },
    ]));
    tray.on('click', () => openFromBackground());
  } catch (e) {
    log.warn(`no tray icon: ${(e as Error).message}`);
  }
}

function openFromBackground(): void {
  const existing = focusedInfo()?.win;
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  createWindow({ tabs: backgroundRoots().map((root) => ({ root, path: null })), activeTab: 0 }, null);
}

/** With no window and nothing left to run in the background, the app ends. */
function maybeQuitIdle(): void {
  if (wins.size > 0 || backgroundRoots().length > 0 || quitting) return;
  tray?.destroy();
  tray = null;
  app.quit();
}

/** Open a workspace without a window, only for its automations (the app was started with --background). */
async function openForAutomations(root: string): Promise<void> {
  if (!readConfigSync(path.join(root, '.cave-notes')).present.has('rules')) return;
  const a = attach(root, BACKGROUND);
  try {
    a.opened ??= (workerFor(root).call('openWorkspace', [root, { dataDir: dataDirFor(root), notes: noteTypesNow(), deviceName: settings.get().deviceName, firstDay: settings.get().firstDayOfWeek, globalDir: globalDir(), globalsEnabled: settings.get().globalsEnabled, appConfigDir: appConfigDir(), shippedDefaultsDir: shippedDefaultsDir() }]) as Promise<WorkspaceInfo>).catch((err) => {
      a.opened = null;
      throw err;
    });
    await a.opened;
  } catch (e) {
    log.warn(`could not open ${root} for its automations: ${(e as Error).message}`);
    await detach(root, BACKGROUND);
  }
}

// ---------------------------------------------------------------- title bar colour

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function overlayOf(theme: 'dark' | 'light', color: string | null): { color: string; symbolColor: string; height: number } {
  const t = THEMES[theme];
  if (!color) return { color: t.header, symbolColor: t.symbols, height: OVERLAY_HEIGHT };
  return { color, symbolColor: luminance(color) > 0.4 ? '#2e3436' : '#ffffff', height: OVERLAY_HEIGHT };
}

function paintHeader(info: WinInfo): void {
  try {
    info.win.setTitleBarOverlay(overlayOf(settings.get().theme, info.header));
  } catch {
    /* not supported on this platform/window */
  }
}

function applyTheme(theme: 'dark' | 'light'): void {
  nativeTheme.themeSource = theme;
  for (const i of wins.values()) {
    i.win.setBackgroundColor(THEMES[theme].bg);
    paintHeader(i);
  }
}

// ---------------------------------------------------------------- persistence of the windows

/** True while the windows of the last session are being recreated, and once the app is on its way out. */
let freezeWindowList = false;
function persistWindows(atQuit: boolean = quitting): void {
  if (freezeWindowList) return;
  // Never replace the remembered session with "no windows": that is what is left when the last window has just been
  // closed (or the app is quitting), and that session is exactly the one to bring back at the next start.
  const list = atQuit ? sessionAtQuit() : [...wins.values()].map((i) => ({ tabs: i.state.tabs, activeTab: i.state.activeTab }));
  if (list.length === 0 || (!atQuit && wins.size === 0)) return;
  log.debug(`remembering ${list.length} window(s): ${list.map((w) => w.tabs.length).join('+')} tab(s)`);
  settings.set({ windows: list });
}

/**
 * The windows to bring back at the next start when the app closes now: the ones still open (or, when the last one
 * has just been closed, the remembered list) plus every window closed within RECENTLY_CLOSED_MS before this moment.
 * Windows closed longer ago were closed on purpose and stay closed.
 */
function sessionAtQuit(now: number = Date.now()): WindowState[] {
  const live: WindowState[] = [...wins.values()].map((i) => ({ tabs: i.state.tabs, activeTab: i.state.activeTab }));
  const list: WindowState[] = live.length > 0 ? live : settings.get().windows.map((w) => ({ tabs: w.tabs, activeTab: w.activeTab }));
  const seen = new Set(list.map((w) => JSON.stringify(w.tabs)));
  const extra = recentlyClosed
    .filter((c) => now - c.at <= RECENTLY_CLOSED_MS)
    .sort((a, b) => a.at - b.at)
    .map((c) => c.state)
    .filter((s) => {
      const k = JSON.stringify(s.tabs);
      if (seen.has(k)) return false; // the last window is in the remembered list already
      seen.add(k);
      return true;
    });
  if (extra.length > 0) log.info(`session: ${extra.length} window(s) closed within ${RECENTLY_CLOSED_MS / 1000} s of quitting are kept in it`);
  return [...list, ...extra];
}

// ---------------------------------------------------------------- the API the renderer may call

/** The automation log of each open workspace (the ones with a folder of their own; a single file or the settings folder has none). */
const automationLogRefs = (): AutomationLogRef[] =>
  [...attached.values()].filter((a) => !a.file && !a.config && !a.docs).map((a) => ({ root: a.root, name: path.basename(a.root) || a.root, file: path.join(dataDirFor(a.root), 'automation.log') }));

/**
 * Give the spell checker the preferences: on or off, and the user's own dictionary. The list in the preferences is the
 * only one, so words Chromium kept from earlier are taken out and missing ones put in.
 */
let spellApply: Promise<void> = Promise.resolve();
function applySpelling(): void {
  const s = settings.get();
  spellApply = spellApply
    .then(async () => {
      const ses = session.defaultSession;
      ses.setSpellCheckerEnabled(s.spellcheck);
      const want = cleanDictionary(s.dictionary);
      const have = await ses.listWordsInSpellCheckerDictionary();
      const wantSet = new Set(want);
      for (const w of have) if (!wantSet.has(w)) ses.removeWordFromSpellCheckerDictionary(w);
      const haveSet = new Set(have);
      for (const w of want) if (!haveSet.has(w)) ses.addWordToSpellCheckerDictionary(w);
    })
    .catch((e) => log.warn(`spell checker setup failed: ${e instanceof Error ? e.message : String(e)}`));
}

const mainApiFor = (w: BrowserWindow | null): MainApi => {
  const info = (): WinInfo | null => (w ? (wins.get(w.id) ?? null) : null);
  return {
    async chooseWorkspace() {
      const opts = { title: 'Open Workspace Folder', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async getSettings() {
      return settings.get();
    },
    async setSettings(patch: Partial<Settings>) {
      // tabs belong to a window (setWindowTabs); everything else is shared by all windows
      const { tabs: _t, activeTab: _a, windows: _w, ...shared } = patch;
      // Shell commands are switched on only by a person, in a question the main process asks: a page cannot do it for them.
      if (shared.automationShell === true && !settings.get().automationShell) {
        const parent = w ?? BrowserWindow.getFocusedWindow();
        const question = {
          type: 'warning' as const, title: 'Allow shell commands in automations?',
          message: 'Let automations run shell commands on this computer?',
          detail: 'Rules in a workspace\'s settings files (.cave-notes) will be able to start programs, after you approve each command. Only switch this on for workspaces whose rules you trust.',
          buttons: ['Keep them off', 'Allow shell commands'], defaultId: 0, cancelId: 0, noLink: true,
        };
        const r = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
        if (r.response !== 1) delete shared.automationShell;
      }
      // JavaScript in rules is switched on, and its approval questions switched off, only by a person, in a question the main process asks.
      if (shared.automationJs === true && !settings.get().automationJs) {
        const parent = w ?? BrowserWindow.getFocusedWindow();
        const question = {
          type: 'warning' as const, title: 'Allow JavaScript in automations?',
          message: 'Let automations run JavaScript on this computer?',
          detail: 'Rules in a workspace\'s settings files (.cave-notes) will be able to run scripts that read and change the page they work on, after you approve each script. Scripts run in a sandbox: they cannot open files, use the network or start programs. Only switch this on for workspaces whose rules you trust.',
          buttons: ['Keep it off', 'Allow JavaScript'], defaultId: 0, cancelId: 0, noLink: true,
        };
        const r = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
        if (r.response !== 1) delete shared.automationJs;
      }
      if (shared.automationJsAsk === false && settings.get().automationJsAsk) {
        const parent = w ?? BrowserWindow.getFocusedWindow();
        const question = {
          type: 'warning' as const, title: 'Stop asking before scripts run?',
          message: 'Run rules\' JavaScript without asking first?',
          detail: 'Any rule in any workspace you open could then run its script as soon as its trigger happens, including rules that arrive from other computers through sync. The sandbox still keeps scripts away from your files and the network. Only do this on a computer where you trust every workspace.',
          buttons: ['Keep asking', 'Stop asking'], defaultId: 0, cancelId: 0, noLink: true,
        };
        const r = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
        if (r.response !== 1) delete shared.automationJsAsk;
      }
      if (typeof shared.deviceName === 'string') shared.deviceName = shared.deviceName.trim().slice(0, 40);
      if (shared.dictionary !== undefined) shared.dictionary = cleanDictionary(shared.dictionary);
      const v = settings.set(shared);
      if (shared.dictionary !== undefined || shared.spellcheck !== undefined) applySpelling();
      if (shared.deviceName !== undefined) for (const [root, a] of attached) if (a.opened && !a.file) void workerFor(root).call('automationSetDevice', [v.deviceName]).catch(() => undefined);
      if (shared.firstDayOfWeek !== undefined) for (const [root, a] of attached) if (a.opened && !a.file) void workerFor(root).call('setFirstDay', [v.firstDayOfWeek]).catch(() => undefined);
      if (shared.automationBackground === false) for (const a of attached.values()) if (a.windows.has(BACKGROUND)) void detach(a.root, BACKGROUND).then(() => maybeQuitIdle());
      if ('noteExts' in shared || 'noteCreate' in shared) {
        // a workspace without a choice of its own follows the app's
        const nt = cleanNoteTypes(v.noteExts, v.noteCreate);
        if (nt) {
          settings.set({ noteExts: nt.exts, noteCreate: nt.create });
          for (const [root, a] of attached) if (a.opened && !a.file && !a.config) void workerFor(root).call('applyAppNoteTypes', [nt]).catch(() => undefined);
        }
      }
      if (Object.keys(shared).length > 0) sendToOthers(w, 'settings:changed', shared);
      return v;
    },
    async attachWorkspace(rootArg) {
      const a = attach(rootArg, w?.id ?? -1);
      if (!a.file && !a.config && !a.docs) settings.remember(a.root);
      return { id: a.id };
    },
    async detachWorkspace(rootArg) {
      await detach(rootArg, w?.id ?? -1);
    },
    async runScript(rootArg, page, code, lang, terminal) {
      const root = path.resolve(rootArg);
      const a = attached.get(root);
      if (!a || a.docs) return { ran: false, reason: 'Scripts cannot be run from this place.' };
      const id = w?.id ?? -1;
      if (runningScripts.has(id)) return { ran: false, reason: 'A script is already running in this window.' };
      const ac = new AbortController();
      runningScripts.set(id, ac);
      try {
        return await runScriptBlock({ root, page, code, lang, terminal, trust: scriptTrustNow(), ask: (r) => askScriptTrust(r, w ?? null), signal: ac.signal, log: (m) => log.info(m) });
      } finally {
        runningScripts.delete(id);
      }
    },
    async stopScript() {
      runningScripts.get(w?.id ?? -1)?.abort();
    },
    async forgetScriptApprovals() {
      approvalsNow().clear();
      scriptTrustNow().clear();
    },
    async openPath(abs) {
      if (!path.isAbsolute(abs)) return 'Not an absolute path';
      return shell.openPath(abs);
    },
    async appConfigFolder() {
      const dir = appConfigDir();
      await seedDefaults(shippedDefaultsDir(), dir);
      return dir;
    },
    async updateStatus() {
      return updates.state();
    },
    async checkForUpdate() {
      return updates.check(true);
    },
    async installUpdate() {
      return updates.install();
    },
    async restartApp() {
      restartForUpdate();
    },
    async showInFolder(abs) {
      if (!path.isAbsolute(abs)) return 'Not an absolute path';
      if (!fs.existsSync(abs)) return 'That file is no longer there';
      shell.showItemInFolder(abs);
      return '';
    },
    async fileIcon(absArg) {
      if (!path.isAbsolute(absArg)) return null;
      const abs = path.resolve(absArg);
      if (!workspaceOf(abs) || !fs.existsSync(abs)) return null;
      try {
        const img = await app.getFileIcon(abs, { size: 'normal' });
        return img.isEmpty() ? null : img.toDataURL();
      } catch {
        return null;
      }
    },
    async revealPath(absArg) {
      if (!path.isAbsolute(absArg)) return 'Not an absolute path';
      const abs = path.resolve(absArg);
      if (!workspaceOf(abs)) return 'That is not inside an open workspace';
      try {
        const st = await fs.promises.stat(abs).catch(() => null);
        if (!st) {
          // a page that is not a file yet (a folder of pages): show its folder, or the nearest one that exists
          const ext = settings.get().noteExts.find((e) => abs.toLowerCase().endsWith(e));
          const own = ext ? abs.slice(0, -ext.length) : abs;
          if (own !== abs && fs.existsSync(own)) {
            shell.showItemInFolder(own);
            return '';
          }
          let dir = path.dirname(abs);
          while (dir !== path.dirname(dir) && !fs.existsSync(dir)) dir = path.dirname(dir);
          return shell.openPath(dir);
        }
        // the workspace folder itself is opened; any other folder (a page without a file of its own) is shown, selected, in its parent
        if (st.isDirectory() && workspaceOf(abs) === abs) return shell.openPath(abs);
        if (st.isDirectory() && !attached.has(abs)) {
          shell.showItemInFolder(abs);
          return '';
        }
        if (st.isDirectory()) return shell.openPath(abs);
        shell.showItemInFolder(abs);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    },
    async openExternal(url) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return false;
        await shell.openExternal(u.toString());
        return true;
      } catch {
        return false;
      }
    },
    async workspaceStatus(folder) {
      return workspaceStatus(folder);
    },
    async promoteFolder(folder, copySettingsFrom) {
      const abs = path.resolve(folder);
      const outer = (await workspaceStatus(abs)).containing;
      await promoteFolder(abs, copySettingsFrom);
      knownWorkspace(abs);
      // the workspace it was part of no longer holds its pages
      if (outer && attached.get(outer)?.opened) await workerFor(outer).call('rescan', []).catch(() => undefined);
    },
    async removeWorkspace(rootArg) {
      const root = path.resolve(rootArg);
      if (attached.has(root)) throw new Error('Close the tabs of this workspace first');
      const outer = (await workspaceStatus(root)).containing;
      await removeWorkspace(root);
      settings.set({ recent: settings.get().recent.filter((r) => r !== root), found: settings.get().found.filter((r) => r !== root) });
      sendToOthers(null, 'settings:changed', { recent: settings.get().recent, found: settings.get().found });
      if (outer && attached.get(outer)?.opened) await workerFor(outer).call('rescan', []).catch(() => undefined);
    },
    async scanWorkspaces() {
      return scanNow();
    },
    async trash(absPaths) {
      for (const p of absPaths) {
        const abs = path.resolve(p);
        if (!workspaceOf(abs) || attached.has(abs)) throw new Error(`Refusing to trash ${p}`);
      }
      for (const p of absPaths) await shell.trashItem(path.resolve(p));
    },
    async setTitle(title) {
      w?.setTitle(title ? `${title} — Cave Notes` : 'Cave Notes');
    },
    async setTheme(theme) {
      settings.set({ theme });
      applyTheme(theme);
      sendToOthers(w, 'settings:changed', { theme });
    },
    async closeNow() {
      const i = info();
      if (i) i.allowClose = true;
      w?.close();
    },
    async getWindowInit() {
      const i = info();
      if (!i) return { tabs: [], activeTab: 0 };
      const init = { ...i.state };
      delete i.state.files; // files from the command line are opened once
      return init;
    },
    async isFile(abs) {
      return path.isAbsolute(abs) && isMarkdownFile(abs);
    },
    async docsFolder() {
      return docsRoot();
    },
    async saveDocsZip() {
      const opts = { title: 'Save the Documentation as a Zip', defaultPath: path.join(app.getPath('documents'), 'Cave Notes Documentation.zip'), filters: [{ name: 'Zip archive', extensions: ['zip'] }] };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const file = r.filePath.toLowerCase().endsWith('.zip') ? r.filePath : `${r.filePath}.zip`;
      await fs.promises.writeFile(file, zipFolder(docsRoot(), 'Cave Notes Documentation'));
      return file;
    },
    async logSources() {
      return { dir: LOG_DIR, sources: await listLogSources(logFile(), automationLogRefs()) };
    },
    async readLog(id) {
      // only the logs listed here can be read: the id is never turned into a path
      return readLogSource(await listLogSources(logFile(), automationLogRefs()), String(id));
    },
    async setWindowTabs(tabs, activeTab) {
      const i = info();
      if (!i) return;
      i.state = { tabs: tabs.map((t) => ({ root: t.root, path: t.path, ...(t.single ? { single: true } : {}) })), activeTab };
      if (i.state.tabs.length > 0) i.lastState = i.state;
      persistWindows();
    },
    async newWindow(tab) {
      createWindow({ tabs: tab ? [{ root: tab.root, path: tab.path, ...(tab.single ? { single: true } : {}) }] : [], activeTab: 0 }, w);
    },
    async moveTabToWindow(tab, screenX, screenY) {
      const point = screenX === 0 && screenY === 0 ? screen.getCursorScreenPoint() : { x: Math.round(screenX), y: Math.round(screenY) };
      // dragging a tab out always makes a new window, even when it is let go over another one
      const at = w ? w.getBounds() : { width: 1100, height: 760 };
      const nw = createWindow({ tabs: [{ root: tab.root, path: tab.path, ...(tab.single ? { single: true } : {}) }], activeTab: 0 }, w, { x: point.x - 120, y: point.y - 24, width: at.width, height: at.height });
      attach(tab.root, nw.id);
    },
    async pickImportFiles(mode) {
      const opts: Electron.OpenDialogOptions = mode === 'folder'
        ? { title: 'Choose a folder to add', properties: ['openDirectory', 'multiSelections'] }
        : { title: 'Choose files or a zip to add', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Files and zips', extensions: ['yaml', 'yml', 'md', 'markdown', 'txt', 'js', 'json', 'zip'] }, { name: 'All files', extensions: ['*'] }] };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? [] : r.filePaths;
    },
    async importFromFile(req) {
      return importFromFiles(req, appConfigDir());
    },
    async getGlobalStyleFiles() {
      return otherStyleFiles();
    },
    async getGlobalExportStyles() {
      return fs.promises.readFile(globalStylesFile(), 'utf8').catch(() => '');
    },
    async setGlobalExportStyles(text) {
      const { errors } = parseStyleSetsYaml(text);
      if (errors.length > 0) throw new Error(errors[0]);
      const file = globalStylesFile();
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      if (text.trim() === '') await fs.promises.rm(file, { force: true });
      else await fs.promises.writeFile(file, text.endsWith('\n') ? text : `${text}\n`);
    },
    async bundledFonts() {
      return listBundledFonts();
    },
    async saveFonts() {
      const opts = { title: 'Save the Fonts To…', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      const dir = r.canceled ? null : r.filePaths[0];
      if (!dir) return null;
      await copyFonts(path.join(dir, 'Cave Notes Fonts'));
      return path.join(dir, 'Cave Notes Fonts');
    },
    async installFonts() {
      const dir = path.join(os.homedir(), '.local', 'share', 'fonts', 'cave-notes');
      await copyFonts(dir);
      const done = await new Promise<boolean>((resolve) => execFile('fc-cache', ['-f', dir], (err) => resolve(!err)));
      return done ? `Installed in ${dir}. Programs you already have open may need a restart to see them.` : `Copied to ${dir}, but the font cache could not be refreshed; log out and in, or run fc-cache.`;
    },
    async exportDocument(req) {
      const style = cleanStyleSet(req.style);
      const ext = req.format;
      const names = { docx: 'Word document', odt: 'OpenDocument text', pdf: 'PDF' } as const;
      const base = req.defaultName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'page';
      const opts = { title: 'Export Page', defaultPath: `${base}.${ext}`, filters: [{ name: names[ext], extensions: [ext] }] };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      if (ext === 'pdf') {
        // Chromium prints the same HTML the preview shows, with the style set's paper size and margins
        const html = renderHtml(parseDoc(req.markdown), style, { title: req.title, css: fontFaceCss() });
        const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
        const tmp = path.join(os.tmpdir(), `cave-export-${process.pid}-${Date.now()}.html`);
        try {
          await fs.promises.writeFile(tmp, html);
          await win.loadFile(tmp);
          const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
          await fs.promises.writeFile(r.filePath, pdf);
        } finally {
          win.destroy();
          await fs.promises.rm(tmp, { force: true });
        }
      } else {
        const bytes = (await exportPage(req.markdown, ext, style, req.title)) as Uint8Array;
        await fs.promises.writeFile(r.filePath, bytes);
      }
      return r.filePath;
    },
    async getDisplays() {
      const here = w ? screen.getDisplayMatching(w.getBounds()).id : -1;
      return screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `Screen ${i + 1}`, primary: d.id === screen.getPrimaryDisplay().id, width: d.size.width, height: d.size.height, hasApp: d.id === here }));
    },
    async presentStart(req) {
      await startPresentation({ ...req, appWindow: w ?? null });
    },
    async exportPresentation(req) {
      const base = req.defaultName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'presentation';
      const opts = { title: 'Export Presentation', defaultPath: `${base}.${req.format}`, filters: [{ name: req.format === 'pdf' ? 'PDF' : 'HTML page', extensions: [req.format] }] };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const html = inlineAssets(req.html);
      if (req.format === 'html') {
        await fs.promises.writeFile(r.filePath, html);
        return r.filePath;
      }
      // one slide to a page: the page's own size comes from its @page rule
      const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
      const tmp = path.join(os.tmpdir(), `cave-slides-${process.pid}-${Date.now()}.html`);
      try {
        await fs.promises.writeFile(tmp, html);
        await win.loadFile(tmp);
        const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
        await fs.promises.writeFile(r.filePath, pdf);
      } finally {
        win.destroy();
        await fs.promises.rm(tmp, { force: true });
      }
      return r.filePath;
    },
    async exportSettings() {
      const opts = { title: 'Export Settings', defaultPath: 'cave-notes-settings.json', filters: [{ name: 'Settings', extensions: ['json'] }] };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return false;
      const body = { app: 'cave-notes', version: 1, settings: portableSettings(settings.get()) };
      await fs.promises.writeFile(r.filePath, `${JSON.stringify(body, null, 2)}\n`);
      return true;
    },
    async importSettings() {
      const opts = { title: 'Import Settings', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Settings', extensions: ['json'] }] };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      const file = r.canceled ? null : r.filePaths[0];
      if (!file) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch {
        throw new Error('That file is not a Cave Notes settings file (it is not valid JSON).');
      }
      const inner = parsed && typeof parsed === 'object' && 'settings' in parsed ? (parsed as { settings: unknown }).settings : parsed;
      const patch = portableSettings(inner);
      if (Object.keys(patch).length === 0) throw new Error('That file has no Cave Notes settings in it.');
      settings.set(patch);
      if (patch.dictionary !== undefined || patch.spellcheck !== undefined) applySpelling();
      if (patch.theme) applyTheme(patch.theme);
      sendToOthers(w, 'settings:changed', patch);
      return patch;
    },
    async setHeaderColor(color) {
      const i = info();
      if (!i) return;
      i.header = color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
      paintHeader(i);
    },
  };
};

function contains(b: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

/** Calls that move, rename or undo pages: logged in full (start, end, how long, and a reminder every 3 s while one is still waiting). */
const MOVE_METHODS = new Set(['planMove', 'applyPlan', 'undoLast']);
let moveCallNo = 0;

async function loggedMoveCall(worker: WorkerClient, method: string, args: unknown[], root: string): Promise<unknown> {
  const n = ++moveCallNo;
  const who = `${method} #${n} (${path.basename(root)})`;
  const brief = (a: unknown): string => {
    if (a && typeof a === 'object' && 'move' in a) {
      const p = a as { id?: string; move: { from: string; to: string }; summary?: unknown };
      return `plan ${p.id ?? ''} ${p.move.from} -> ${p.move.to} ${JSON.stringify(p.summary ?? {})}`;
    }
    return JSON.stringify(a);
  };
  log.info(`move: ${who} sent to its worker (pid ${worker.pid ?? '?'}) args=${args.map(brief).join(' ')}`);
  const t0 = performance.now();
  const beat = setInterval(() => {
    const others = worker.waiting().filter((w) => w.method !== method);
    log.warn(`move: ${who} still waiting after ${Math.round((performance.now() - t0) / 1000)} s; the worker also has ${others.length} other call(s) waiting${others.length ? ` [${others.map((w) => `${w.method} ${w.ms} ms`).join(', ')}]` : ''}`);
  }, 3000);
  try {
    const v = await worker.call(method, args);
    log.info(`move: ${who} answered after ${Math.round(performance.now() - t0)} ms`);
    return v;
  } catch (e) {
    const err = e as Error & { code?: string };
    log.error(`move: ${who} FAILED after ${Math.round(performance.now() - t0)} ms: ${err.code ?? ''} ${err.message}`);
    throw e;
  } finally {
    clearInterval(beat);
  }
}

function registerIpc(): void {
  const fail = (e: unknown, what = ''): Envelope<unknown> => {
    const w = wireError(e);
    // expected, user-level errors stay quiet; anything else is worth a line
    if (!['NOT_FOUND', 'COLLISION', 'INVALID_NAME', 'MOVE_INTO_SELF', 'STALE'].includes(w.code ?? '')) log.warn(`${what} failed: ${w.code ?? ''} ${w.message}`);
    return { ok: false, error: w };
  };
  const bad = (method: string): Error => Object.assign(new Error(`Unknown method ${method}`), { code: 'BAD_METHOD' });

  ipcMain.handle('cave:main', async (e, method: string, args: unknown[]): Promise<Envelope<unknown>> => {
    try {
      if (!(MAIN_METHODS as readonly string[]).includes(method)) throw bad(method);
      const api = mainApiFor(BrowserWindow.fromWebContents(e.sender)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const fn = api[method];
      if (!fn) throw bad(method);
      const t0 = performance.now();
      const value = await fn(...(Array.isArray(args) ? args : []));
      const ms = Math.round(performance.now() - t0);
      if (ms > 750) log.warn(`main.${method} was slow: ${ms} ms`);
      return { ok: true, value };
    } catch (err) {
      return fail(err, `main.${method}`);
    }
  });

  // Workspace calls go to the worker of the workspace named by the last argument of invoke.
  ipcMain.handle('cave:ws', async (e, method: string, args: unknown[], root?: string): Promise<Envelope<unknown>> => {
    try {
      if (!(WORKER_METHODS as readonly string[]).includes(method)) throw bad(method);
      if (typeof root !== 'string') throw Object.assign(new Error('No workspace given'), { code: 'NO_WORKSPACE' });
      const a = attached.get(path.resolve(root));
      const worker = workerFor(root);
      // Several windows share a worker: the first to open the workspace opens it, the others get the same answer,
      // and it is closed when the last window detaches (see detach), not when one of them lets go.
      if (method === 'openWorkspace' && a) {
        if (!a.opened) {
          // a single file is opened as its folder with just that file in it; the answer names the file as the root again
          const given = Array.isArray(args) ? args : [];
          const callArgs = a.file
            ? [a.scope, { file: a.file, dataDir: dataDirFor(a.root), notes: noteTypesNow() }]
            : a.docs
            ? [a.root, { docs: true, dataDir: dataDirFor(a.root), notes: DOCS_NOTES, firstDay: settings.get().firstDayOfWeek }]
            : a.config
            ? [a.root, { config: true, dataDir: dataDirFor(a.root), notes: CONFIG_NOTES, firstDay: settings.get().firstDayOfWeek }]
            : [given[0], { dataDir: dataDirFor(a.root), notes: noteTypesNow(), deviceName: settings.get().deviceName, firstDay: settings.get().firstDayOfWeek, globalDir: globalDir(), globalsEnabled: settings.get().globalsEnabled, appConfigDir: appConfigDir(), shippedDefaultsDir: shippedDefaultsDir() }];
          a.opened = (worker.call('openWorkspace', callArgs) as Promise<WorkspaceInfo>).then((r) => (a.file ? { ...r, root: a.root } : r)).catch((err) => {
            a.opened = null;
            throw err;
          });
          return { ok: true, value: await a.opened };
        }
        const info = await a.opened;
        const ready = a.lastStatus?.state === 'ready' ? a.lastStatus.pages : undefined;
        return { ok: true, value: { ...info, ...(ready !== undefined ? { indexed: ready } : {}) } };
      }
      if (method === 'closeWorkspace') return { ok: true, value: undefined };
      if (MOVE_METHODS.has(method)) return { ok: true, value: await loggedMoveCall(worker, method, Array.isArray(args) ? args : [], root) };
      return { ok: true, value: await worker.call(method, Array.isArray(args) ? args : []) };
    } catch (err) {
      return fail(err, `ws.${method}${typeof root === 'string' ? ` (${path.basename(root)})` : ''}`);
    }
  });
}

// ---------------------------------------------------------------- diagnostics

function setVerbose(on: boolean): void {
  const level: Level = on ? 'debug' : 'info';
  setLogLevel(level);
  try {
    if (on) fs.writeFileSync(VERBOSE_MARK, 'debug\n');
    else fs.rmSync(VERBOSE_MARK, { force: true });
  } catch {
    /* the level still applies to this session */
  }
  for (const w of workers.values()) w.setLogLevel(level);
  log.info(`verbose logging ${on ? 'ON' : 'off'}`);
}

/** Last `n` lines of the log file. */
function logTail(n: number): string {
  const f = logFile();
  if (!f) return '(no log file)';
  try {
    return fs.readFileSync(f, 'utf8').split('\n').slice(-n - 1).join('\n');
  } catch {
    return '(log unreadable)';
  }
}

/** Everything useful for a bug report in one block of text, on the clipboard. No note text, only paths and numbers. */
async function copyDiagnostics(): Promise<void> {
  const s = settings.get();
  const metrics = app.getAppMetrics().map((m) => `  ${m.type}${m.name ? ` "${m.name}"` : ''} pid=${m.pid} cpu=${m.cpu.percentCPUUsage.toFixed(1)}% mem=${Math.round(m.memory.workingSetSize / 1024)} MB`);
  const open = [...attached.values()].map((a) => `  ${a.root} windows=${[...a.windows].join(',')} index=${a.lastStatus ? `${a.lastStatus.state}/${a.lastStatus.pages}` : '?'} waiting-calls=${JSON.stringify(workers.get(a.root)?.waiting() ?? [])}`);
  const text = [
    `Cave Notes ${app.getVersion()}  electron ${process.versions.electron}  chrome ${process.versions.chrome}  node ${process.versions.node}`,
    `${process.platform} ${process.arch}  session=${process.env.XDG_SESSION_TYPE ?? '?'}  desktop=${process.env.XDG_CURRENT_DESKTOP ?? '?'}  flatpak=${!!process.env.FLATPAK_ID}`,
    `userData=${app.getPath('userData')}  log=${logFile()}  level=${logLevel()}`,
    `settings: scanAuto=${s.scanAuto} scanFolders=${JSON.stringify(s.scanFolders)} found=${s.found.length} windows=${JSON.stringify(s.windows)}`,
    `open workspaces:\n${open.join('\n') || '  (none)'}`,
    `processes:\n${metrics.join('\n')}`,
    `--- last 250 log lines ---`,
    logTail(250),
  ].join('\n');
  clipboard.writeText(text);
  log.info('diagnostic report copied to the clipboard');
  const w = focusedInfo()?.win;
  if (w) void dialog.showMessageBox(w, { type: 'info', message: 'Diagnostic report copied', detail: 'Paste it into your bug report. It holds versions, settings, open workspaces and the last lines of the log; it never contains note text.' });
}

/** Every 30 s: which process is using CPU? A busy one is named in the log, so "Electron uses lots of CPU" has an answer. */
function startMetrics(): void {
  let busy = 0;
  const t = setInterval(() => {
    const ms = app.getAppMetrics();
    const hot = ms.filter((m) => m.cpu.percentCPUUsage >= 25);
    if (hot.length > 0) {
      busy++;
      const desc = hot.map((m) => `${m.type}${m.name ? ` "${m.name}"` : ''} pid=${m.pid} ${m.cpu.percentCPUUsage.toFixed(0)}%`).join('; ');
      const extra = busy % 4 === 1 ? ` | all: ${ms.map((m) => `${m.type}:${m.cpu.percentCPUUsage.toFixed(0)}%/${Math.round(m.memory.workingSetSize / 1024)}MB`).join(' ')}` : '';
      log.warn(`HIGH CPU (sample ${busy} in a row): ${desc}${extra}`);
    } else {
      if (busy > 0) log.info(`cpu back to normal after ${busy} busy sample(s)`);
      busy = 0;
      log.debug(`processes: ${ms.map((m) => `${m.type}${m.name ? `(${m.name})` : ''}:${m.cpu.percentCPUUsage.toFixed(0)}%/${Math.round(m.memory.workingSetSize / 1024)}MB`).join(' ')}`);
    }
  }, 30_000);
  t.unref();
}

// ---------------------------------------------------------------- menu

function buildMenu(): void {
  // menu commands go to the window they were chosen in
  const asWin = (bw: unknown): BrowserWindow | null => (bw instanceof BrowserWindow ? bw : null);
  const menuEvent = (name: string) => (_item: unknown, bw: unknown) => sendTo(asWin(bw) ?? focusedInfo()?.win, name);
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: (_i, bw) => createWindow({ tabs: [], activeTab: 0 }, asWin(bw) ?? focusedInfo()?.win ?? null) },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: menuEvent('menu:open-folder') },
        { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: menuEvent('menu:new-page') },
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: menuEvent('menu:new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: menuEvent('menu:close-tab') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: menuEvent('menu:preferences') },
        { type: 'separator' },
        { label: 'Undo Last Move or Rename', click: menuEvent('menu:undo-move') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Page Sidebar', accelerator: 'F9', click: menuEvent('menu:toggle-left') },
        { label: 'Toggle Outline Sidebar', accelerator: 'Shift+F9', click: menuEvent('menu:toggle-right') },
        { label: 'Export Page…', accelerator: 'CmdOrCtrl+Shift+E', click: menuEvent('menu:export') },
        { label: 'Toggle Light/Dark', accelerator: 'CmdOrCtrl+Shift+L', click: menuEvent('menu:toggle-theme') },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+PageDown', click: menuEvent('menu:next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+PageUp', click: menuEvent('menu:prev-tab') },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', accelerator: 'F1', click: menuEvent('menu:documentation') },
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: menuEvent('menu:shortcuts') },
        { type: 'separator' },
        { label: 'Copy Diagnostic Report', click: () => void copyDiagnostics() },
        { label: 'View Logs…', click: menuEvent('menu:logs') },
        { label: 'Open Log Folder', click: () => void shell.openPath(LOG_DIR) },
        {
          label: 'Verbose Logging',
          type: 'checkbox',
          checked: logLevel() === 'debug' || logLevel() === 'trace',
          click: (item) => setVerbose(item.checked),
        },
        { type: 'separator' },
        { label: 'About Cave Notes', click: menuEvent('menu:about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- windows

/**
 * Open a window showing `state`'s tabs. `from` is the window it comes from (the new one is placed a little
 * down and to the right of it, and starts at its size); `where` puts it exactly.
 */
function createWindow(state: WindowState, from: BrowserWindow | null = null, where?: Partial<Rectangle>): BrowserWindow {
  const s = settings.get();
  const t = THEMES[s.theme];
  const native = !!process.env.CAVE_NATIVE_FRAME;
  const base = from && !from.isDestroyed() ? from.getBounds() : null;
  const size = { width: where?.width ?? base?.width ?? s.bounds?.width ?? 1280, height: where?.height ?? base?.height ?? s.bounds?.height ?? 820 };
  const pos = where?.x !== undefined && where.y !== undefined ? { x: where.x, y: where.y } : base ? { x: base.x + 28, y: base.y + 28 } : {};
  const w = new BrowserWindow({
    ...size,
    ...pos,
    minWidth: 300,
    minHeight: 360,
    show: false,
    title: 'Cave Notes',
    backgroundColor: t.bg,
    ...(fs.existsSync(WINDOW_ICON) ? { icon: WINDOW_ICON } : {}),
    ...(native ? {} : { titleBarStyle: 'hidden' as const, titleBarOverlay: overlayOf(s.theme, null) }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  const info: WinInfo = { win: w, state: { tabs: state.tabs.map((x) => ({ ...x })), activeTab: state.activeTab, ...(state.files ? { files: state.files } : {}) }, allowClose: false, header: null };
  const id = w.id;
  wins.set(id, info);
  log.info(`window ${id} created with ${state.tabs.length} tab(s): ${state.tabs.map((t) => t.root).join(', ') || '(none)'}`);
  persistWindows();
  const wl = log.as(`win ${id}`);
  w.webContents.on('console-message', (e) => {
    const lv = e.level === 'error' ? 'error' : e.level === 'warning' ? 'warn' : 'debug';
    wl[lv](`console: ${e.message}${e.sourceId ? ` (${e.sourceId.split('/').pop()}:${e.lineNumber})` : ''}`);
  });
  w.webContents.on('render-process-gone', (_e, d) => wl.error(`the window's renderer process is gone: reason=${d.reason} exitCode=${d.exitCode}`));
  w.on('unresponsive', () => wl.error('window became UNRESPONSIVE (its renderer is not handling events)'));
  w.on('responsive', () => wl.warn('window is responsive again'));
  w.webContents.on('did-fail-load', (_e, code, desc, url) => wl.error(`failed to load ${url}: ${code} ${desc}`));
  nativeTheme.themeSource = s.theme;
  w.setMenuBarVisibility(false);
  w.once('ready-to-show', () => w.show());
  void w.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  w.webContents.setWindowOpenHandler(({ url }) => {
    void mainApiFor(w).openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      void mainApiFor(w).openExternal(url);
    }
  });

  // Remember the size and whether the window was maximized. The size kept is the un-maximized one, so un-maximizing
  // after a restart goes back to it. A window made from another (a dragged-out tab, a new window) does not start
  // maximized: it is placed exactly where it was asked to be.
  const rememberBounds = (): void => {
    if (w.isDestroyed() || w.isFullScreen()) return;
    const maximized = w.isMaximized();
    const { width, height } = maximized ? w.getNormalBounds() : w.getBounds();
    const cur = settings.get();
    if (width && height && (cur.bounds?.width !== width || cur.bounds?.height !== height || cur.maximized !== maximized)) settings.set({ bounds: { width, height }, maximized });
  };
  let boundsTimer: NodeJS.Timeout | null = null;
  const soon = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(rememberBounds, 400);
  };
  w.on('resize', soon);
  w.on('maximize', soon);
  w.on('unmaximize', soon);
  w.on('close', rememberBounds);
  if (s.maximized && !from && !where) w.maximize();

  // Give the renderer a chance to save before the window goes away.
  w.on('close', (e) => {
    if (info.allowClose) return;
    e.preventDefault();
    sendTo(w, 'app:before-close');
    setTimeout(() => {
      if (!w.isDestroyed()) wl.warn('the window did not finish saving within 4 s; closing it anyway (its page may be stuck)');
      info.allowClose = true;
      if (!w.isDestroyed()) w.close();
    }, 4000);
  });
  w.on('closed', () => {
    const others = wins.size - 1;
    const gone = wins.get(id);
    const goneState = gone && gone.state.tabs.length > 0 ? gone.state : gone?.lastState;
    if (goneState && !freezeWindowList) {
      const now = Date.now();
      while (recentlyClosed.length > 0 && now - recentlyClosed[0]!.at > RECENTLY_CLOSED_MS) recentlyClosed.shift();
      recentlyClosed.push({ state: { tabs: goneState.tabs.map((t) => ({ ...t })), activeTab: goneState.activeTab }, at: now });
    }
    wins.delete(id);
    log.info(`window ${id} closed (${others} left, quitting=${quitting})`);
    // A window the person closes is not brought back at the next start; when the app is quitting, every window is.
    // (A kill/SIGTERM closes windows one after another: that must not be mistaken for the person closing them.)
    if (!quitting && !freezeWindowList && others > 0) persistWindows();
    for (const root of [...attached.keys()]) void detach(root, id);
  });
  return w;
}

// ---------------------------------------------------------------- startup

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/** Folders and Markdown files named on a command line (relative ones are taken from `cwd`). */
function launchArgs(argv: string[], cwd: string = process.cwd()): { folders: string[]; files: string[] } {
  const folders: string[] = [];
  const files: string[] = [];
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    const abs = path.resolve(cwd, a);
    if (abs === app.getAppPath()) continue;
    try {
      const st = fs.statSync(abs);
      if (st.isDirectory()) folders.push(abs);
      else if (st.isFile() && isNotePath(abs)) files.push(abs);
    } catch {
      /* not a path */
    }
  }
  return { folders, files };
}

app.on('second-instance', (_e, argv, cwd) => {
  const { folders, files } = launchArgs(argv, cwd);
  if (wins.size === 0 && folders.length === 0 && files.length === 0) {
    openFromBackground(); // started again while only the automations were running: show the app
    return;
  }
  const inWindow = settings.get().openExternal === 'window';
  const current = focusedInfo()?.win ?? null;
  // preference: everything handed to the running app goes into a window of its own...
  if ((folders.length > 0 || files.length > 0) && (inWindow || (folders.length > 0 && !current))) {
    createWindow({ tabs: folders.map((d) => ({ root: d, path: null })), activeTab: 0, files }, current);
    return;
  }
  // ...or into new tabs of the window in front
  if (folders.length > 0) {
    for (const d of folders) {
      settings.remember(d);
      sendTo(current, 'window:adopt-tab', { root: d, path: null });
    }
    if (current) {
      if (current.isMinimized()) current.restore();
      current.focus();
    }
    if (files.length === 0) return;
  }
  if (files.length > 0) {
    for (const f of files) {
      // a file inside a workspace that is already open opens in that workspace; any other opens on its own
      const root = workspaceOf(f);
      const holder = root && !attached.get(root)?.file ? [...(attached.get(root)?.windows ?? [])][0] : undefined;
      const target = (holder !== undefined ? wins.get(holder)?.win : null) ?? focusedInfo()?.win ?? null;
      sendTo(target, 'window:open-file', { path: f });
      if (target) {
        if (target.isMinimized()) target.restore();
        target.focus();
      }
    }
    return;
  }
  const w = focusedInfo()?.win;
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

/**
 * Put the launcher and icons into ~/.local/share on first run, so the app is in the application grid and in "Open With" for
 * Markdown files, and fix them when the app has moved. The AppImage ($APPIMAGE is set by its runtime) is started by its
 * file; an unpacked build by its executable. Only on Linux. A source checkout run in development (`npm start`) does NOT
 * register anything: only an installed app (the AppImage or a packaged build) does. `--install-desktop-integration` still
 * forces it for a checkout, and `--remove-desktop-integration` undoes it.
 */
function setupDesktopIntegration(): boolean {
  if (process.platform !== 'linux') return false;
  const appImage = process.env.APPIMAGE;
  const command = appImage ? undefined : app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  const optOutFile = path.join(app.getPath('userData'), 'no-desktop-integration');
  try {
    if (process.argv.includes('--remove-desktop-integration')) {
      const gone = removeIntegration();
      fs.writeFileSync(optOutFile, 'remove this file to let the AppImage install its launcher again\n');
      log.info(`desktop integration removed (${gone.length} file(s)); it will not be installed again`);
      app.quit();
      return true;
    }
    const forced = process.argv.includes('--install-desktop-integration');
    if (forced) fs.rmSync(optOutFile, { force: true });
    if (!appImage && !app.isPackaged && !forced) {
      log.info('desktop integration: skipped (running from source; install the app, or pass --install-desktop-integration)');
      return false;
    }
    const result = integrate({ appImage, ...(command ? { command } : {}), iconsDir: path.join(__dirname, 'icons'), version: app.getVersion(), optOutFile });
    log.info(`desktop integration: ${result} (${appImage ?? command?.join(' ')})`);
  } catch (e) {
    log.warn(`desktop integration failed: ${(e as Error).message}`);
  }
  return false;
}

/** The updater: set up once the settings are loaded (see start-up below). */
let updates: UpdateManager;

/** The variant the running AppImage was built with: a file written into it when it was packed, else its file name. */
function runningVariant(appImage: string | null): ReturnType<typeof variantOf> {
  let marker: string | null = null;
  try {
    marker = fs.readFileSync(path.join(process.resourcesPath, 'appimage-variant'), 'utf8');
  } catch {
    /* an older build, or not an AppImage */
  }
  return variantOf(appImage ? path.basename(appImage) : '', marker);
}

/**
 * Start again from the AppImage's own path (the copy inside the mounted image goes away when this process ends).
 *
 * `app.relaunch()` starts the new process the moment this one exits, which can be before this one has let go of the single
 * instance lock: the new one then finds "another Cave Notes" running, hands over its arguments and quits, so the app just closed.
 * So the lock is given up first, and an AppImage is started by a small detached shell that waits a moment (until this process
 * and its mount are gone) and then runs the new file.
 */
function restartForUpdate(): void {
  const appImage = process.env.APPIMAGE;
  log.info(`restarting${appImage ? ` from ${appImage}` : ''}`);
  app.releaseSingleInstanceLock();
  if (appImage && path.isAbsolute(appImage)) {
    try {
      // what the old AppImage runtime put in the environment describes the old mount: the new runtime sets its own
      const env = { ...process.env };
      for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'APPIMAGE_SILENT_INSTALL']) delete env[k];
      const child = spawn('/bin/sh', ['-c', 'sleep 1; exec "$0"', appImage], { detached: true, stdio: 'ignore', env });
      child.on('error', (e) => log.warn(`restart: could not start ${appImage}: ${e.message}`));
      child.unref();
    } catch (e) {
      log.warn(`restart: ${(e as Error).message}; trying the ordinary relaunch`);
      app.relaunch({ execPath: appImage, args: [] });
    }
  } else app.relaunch();
  app.quit();
}

app.whenReady().then(() => {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const appImagePath = process.env.APPIMAGE && path.isAbsolute(process.env.APPIMAGE) ? process.env.APPIMAGE : null;
  updates = new UpdateManager({
    version: app.getVersion(),
    appImage: appImagePath,
    variant: runningVariant(appImagePath),
    backupDir: path.join(app.getPath('userData'), 'previous-appimage'),
    settings: () => settings.get(),
    remember: (patch) => settings.set(patch),
    fetch: (url, init) => net.fetch(url, init) as never,
    emit: (st) => {
      for (const i of wins.values()) sendTo(i.win, 'app:update', st);
    },
  });
  updates.start();
  const s0 = settings.get();
  applySpelling();
  log.info(`=== Cave Notes ${app.getVersion()} starting: electron ${process.versions.electron}, ${process.platform} ${process.arch}, pid ${process.pid}, log level ${logLevel()}`);
  log.info(`saved session: ${s0.windows.length} window(s) [${s0.windows.map((w) => `${w.tabs.length} tab(s)`).join(', ')}]; scanAuto=${s0.scanAuto} scanFolders=${s0.scanFolders.length || 'home'}`);
  watchEventLoop(300);
  startMetrics();
  if (setupDesktopIntegration()) return; // asked only to remove the launcher
  app.on('child-process-gone', (_e, d) => log.error(`child process gone: type=${d.type} reason=${d.reason} exitCode=${d.exitCode} name=${d.name ?? ''}`));

  void pruneStaleWorkspaces().catch(() => undefined);
  app.on('browser-window-focus', () => void pruneStaleWorkspaces().catch(() => undefined));

  // Look for workspaces in the background a little after start, then every half hour.
  if (s0.scanAuto) setTimeout(() => void scanNow().catch(() => undefined), 4000);
  setInterval(() => {
    if (settings.get().scanAuto) void scanNow().catch(() => undefined);
  }, 30 * 60 * 1000).unref();

  // Every window of the last session comes back. Older versions had one window, whose tabs were kept in the settings.
  let states: WindowState[] = s0.windows.map((x) => ({ tabs: x.tabs, activeTab: x.activeTab }));
  if (states.length === 0) {
    const legacy = s0.tabs.length > 0 ? s0.tabs : s0.lastWorkspace ? [{ root: s0.lastWorkspace, path: null }] : [];
    states = [{ tabs: legacy, activeTab: s0.activeTab }];
  }

  // A folder given on the command line (or CAVE_OPEN) is opened at startup, in a tab of its own that is the one shown.
  const launch = launchArgs(process.argv);
  const requested = process.env.CAVE_OPEN && fs.existsSync(process.env.CAVE_OPEN) && fs.statSync(process.env.CAVE_OPEN).isDirectory() ? [path.resolve(process.env.CAVE_OPEN)] : launch.folders;
  if (requested.length > 0) {
    const first = states[0]!;
    let tabs = first.tabs;
    for (const root of requested) {
      settings.remember(root);
      tabs = tabs.filter((t) => t.root !== root);
      tabs = [...tabs, { root, path: null }];
    }
    states[0] = { ...first, tabs, activeTab: tabs.length - 1 };
  }
  if (launch.files.length > 0) states[0] = { ...states[0]!, files: launch.files };

  // cave-asset://<workspace id>/<workspace-relative path>: images and attachments inside an open workspace only.
  protocol.handle('cave-asset', (req) => {
    const abs = assetFileOf(req.url);
    return abs ? net.fetch(pathToFileURL(abs).toString()) : new Response('Not found', { status: 404 });
  });

  registerIpc();
  buildMenu();
  // Started with --background (for example at login): no window, only the automations of the workspaces open last time.
  if (process.argv.includes('--background') && s0.automationBackground) {
    const roots = [...new Set(states.flatMap((x) => x.tabs.map((t) => t.root)))].filter((r) => fs.existsSync(r) && fs.statSync(r).isDirectory());
    log.info(`starting in the background for ${roots.length} workspace(s)`);
    void Promise.all(roots.map((r) => openForAutomations(r))).then(() => {
      if (backgroundRoots().length > 0) ensureTray();
      setTimeout(maybeQuitIdle, 90_000).unref();
    });
    return;
  }
  let first: BrowserWindow | null = null;
  // The list of windows is rewritten once they all exist, not after each one (that would briefly say "one window").
  freezeWindowList = true;
  for (const st of states) {
    const w = createWindow(st, null, first ? { x: (first.getBounds().x ?? 0) + 28 * wins.size, y: (first.getBounds().y ?? 0) + 28 * wins.size } : undefined);
    first ??= w;
  }
  freezeWindowList = false;
  persistWindows();

  // E2E / development hook: a script that drives the first window (see e2e/).
  const script = process.env.CAVE_E2E;
  if (script && first) {
    const win = first;
    win.webContents.once('did-finish-load', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void require(path.resolve(script))({ win, app, send: (name: string, payload?: unknown) => sendTo(win, name, payload), settings, mainApi: mainApiFor(win), wins, createWindow });
    });
  }
});

// Quitting: every window gets the chance to save first, then the app ends once they are all closed.
// A kill from a terminal (SIGTERM/SIGINT/SIGHUP) is a quit like any other: keep the windows as they are for the next start.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => {
    log.info(`received ${sig}: quitting, keeping the ${wins.size} open window(s) for the next start`);
    persistWindows(true);
    freezeWindowList = true;
    settings?.flush();
    quitting = true;
    for (const i of wins.values()) i.allowClose = true;
    app.quit();
  });
}

app.on('before-quit', (e?: Electron.Event) => {
  log.info(`before-quit (${wins.size} window(s))`);
  // also when no window is left: the last one was closed a moment ago, which is what made the app quit
  if (!quitting) persistWindows(true);
  if (!quitting && wins.size > 0 && e) {
    quitting = true;
    e.preventDefault();
    for (const i of wins.values()) sendTo(i.win, 'app:before-close');
    setTimeout(() => {
      for (const i of wins.values()) i.allowClose = true;
      app.quit();
    }, 4000);
    return;
  }
  quitting = true;
  settings?.flush();
  for (const w of workers.values()) w.kill();
});
app.on('window-all-closed', () => {
  // Automations that run on a clock keep the app alive in the background, when the person allowed that.
  if (!quitting && settings.get().automationBackground && backgroundRoots().length > 0) {
    log.info(`all windows closed; staying in the background for the automations of ${backgroundRoots().length} workspace(s)`);
    ensureTray();
    return;
  }
  app.quit();
});
