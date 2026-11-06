// Everything the shared window needs from the outside world, on Android: the MainApi (settings, workspaces, folders), one
// service Web Worker per open workspace, and the events that come back from them.
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { createWebWorkerHost, type WebWorkerHost } from '@cave-notes/service/web-host';
import { scanForWorkspaces, scanRoots } from '@cave-notes/service/scan';
import { promoteFolder, removeWorkspace, workspaceStatus } from '@cave-notes/service/workspaces';
import { DESKTOP_CAPABILITIES, type Capabilities, type EventMap, type MainApi, type WorkerApi } from '@cave-notes/service/api';
import { capabilitiesOf, CaveError, partialMainApi, type Deps } from '../../desktop/src/renderer/bridge';
import { AndroidSettings } from './androidSettings';
import { CaveFs } from './caveFs';
import { chooseFolder } from './folderPicker';
import { limitFs } from './limitFs';
import { PhoneLog } from './phoneLog';
import { createPluginFs } from './pluginFs';

/** What this app can do today. Flags go to true as the matching feature is built (see apps/mobile/PLAN.md). */
export const ANDROID_CAPABILITIES: Capabilities = {
  ...Object.fromEntries(Object.keys(DESKTOP_CAPABILITIES).map((k) => [k, false])),
  keyboardAndMouse: false,
} as unknown as Capabilities;

const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};

interface Attached {
  id: string;
  host: WebWorkerHost;
  opened: Promise<unknown> | null;
}

export async function createAndroidDeps(): Promise<{ deps: Deps; settings: AndroidSettings; plog: PhoneLog; flush: () => Promise<void> }> {
  const fs = createPluginFs(CaveFs);
  const paths = await CaveFs.appPaths();
  // the app's own files (settings, log) go through a layer of their own: a write through the layer the service uses makes it
  // forget the listings it has just been given, which is what indexing runs on
  const own = createPluginFs(CaveFs);
  const settings = new AndroidSettings(own, `${paths.files}/settings.json`);
  await settings.load();
  const plog = new PhoneLog(own, `${paths.files}/logs`, '/storage/emulated/0/Download/cave-notes-log.txt');
  await plog.start();
  plog.line('INFO', 'main', `settings loaded: ${settings.get().tabs.length} tab(s) saved, active ${settings.get().activeTab}`);

  // ---- events: from the workers (with the workspace they came from) to whoever listens
  type Listener = (payload: unknown, root?: string) => void;
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, payload: unknown, root?: string): void => {
    for (const l of listeners.get(event) ?? []) l(payload, root);
  };

  // ---- one worker per open workspace
  let wasm: Uint8Array | null = null;
  const attached = new Map<string, Attached>();
  // what a worker asks of the files goes through the page's main thread: a few operations at a time, so the page stays usable
  const workerFs = limitFs(fs, { onDone: (op, target, wait, run, bytes, state) => plog.fsDone(op, target, wait, run, bytes, state) });
  const startHost = async (root: string): Promise<WebWorkerHost> => {
    wasm ??= new Uint8Array(await (await fetch('sqlite3.wasm')).arrayBuffer());
    const worker = new Worker('service-worker.js');
    worker.addEventListener('error', (e) => console.error(`[service worker] ${e.message}`));
    const host = createWebWorkerHost({
      worker: worker as never,
      fs: workerFs as never,
      init: { wasmBinary: wasm.slice(), host: { hostname: settings.get().deviceName || 'Android', homedir: '/storage/emulated/0', tmpdir: paths.cache, cpuCount: navigator.hardwareConcurrency }, logLevel: 'info', logTag: `ws:${root.split('/').pop() ?? ''}`, logToHost: true },
    });
    host.onLog((line) => plog.raw(line));
    host.onEvent((event, payload) => emit(event, payload, root));
    await host.ready;
    return host;
  };

  /** Read the whole folder tree in one call, so that what the service asks for next is answered from it (see pluginFs.primeTree). */
  const prime = async (root: string, why: string): Promise<void> => {
    const end = plog.begin(`list the whole folder ${root.split('/').pop()} (${why})`, 0);
    try {
      const r = await workerFs.primeTree(root);
      end(`${r.count} entries${r.truncated ? ', cut short: listed folder by folder instead' : ''}`);
    } catch (e) {
      end(`failed: ${(e as Error).message}; listed folder by folder instead`);
    }
  };

  const wsFor = (root: string): WorkerApi => {
    const a = attached.get(root);
    if (!a) throw new CaveError('This workspace is not open', 'NOT_ATTACHED');
    return new Proxy(a.host.api, {
      get(target, method: string) {
        if (method === 'openWorkspace') {
          return (given: string) => {
            a.opened ??= prime(root, 'open')
              .then(() => target.openWorkspace(given, {
                dataDir: `${paths.files}/index/${hash(root)}`,
                notes: { exts: settings.get().noteExts, create: settings.get().noteCreate },
                deviceName: settings.get().deviceName,
                firstDay: settings.get().firstDayOfWeek,
                globalsEnabled: false,
              } as never))
              .catch((err: unknown) => {
                a.opened = null;
                throw err;
              });
            return a.opened;
          };
        }
        if (method === 'closeWorkspace') return async () => undefined; // closed when the tab goes (detachWorkspace)
        if (method === 'rescan' || method === 'refreshIndex') return (...args: unknown[]) => prime(root, method).then(() => (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args));
        const fn = (target as unknown as Record<string, unknown>)[method];
        if (typeof fn !== 'function') return fn;
        // every call to the service is timed: the slow ones are logged, and a freeze report says which were going on
        const quick = /^(getAttributeValues|searchSuggest|pageSuggestions)$/.test(method);
        return (...args: unknown[]) => {
          const name = root.split('/').pop() ?? '';
          const end = plog.begin(`${method} ${name}${typeof args[0] === 'string' ? ' ' + args[0] : ''}`, quick ? 1500 : 400);
          const result = (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          void Promise.resolve(result).then(
            (v) => end(typeof v === 'string' ? `(${Math.round(v.length / 1024)} KB)` : undefined),
            () => end('(failed)'),
          );
          return result;
        };
      },
    }) as WorkerApi;
  };

  /** false until the saved tabs have been reopened; see setWindowTabs */
  let sessionRestored = settings.get().tabs.length === 0;
  const base: Partial<MainApi> = {
    async chooseWorkspace() {
      const picked = await chooseFolder(settings.get().lastWorkspace, 'Open a folder as a workspace');
      return picked;
    },
    async getSettings() {
      return settings.get();
    },
    async setSettings(patch) {
      return settings.set(patch);
    },
    async attachWorkspace(root) {
      let a = attached.get(root);
      if (!a) {
        a = { id: hash(root), host: await startHost(root), opened: null };
        attached.set(root, a);
        settings.remember(root);
      }
      return { id: a.id };
    },
    async detachWorkspace(root) {
      const a = attached.get(root);
      if (!a) return;
      attached.delete(root);
      try {
        await a.host.api.closeWorkspace();
        await a.host.saveIndex();
      } finally {
        a.host.terminate();
      }
    },
    async openPath() {
      return 'Opening files in other apps is not available yet';
    },
    async openExternal(url) {
      window.open(url, '_system');
      return true;
    },
    workspaceStatus: (folder) => workspaceStatus(folder),
    async promoteFolder(folder, copySettingsFrom) {
      await promoteFolder(folder, copySettingsFrom);
    },
    async removeWorkspace(root) {
      await removeWorkspace(root);
    },
    async scanWorkspaces() {
      const s = settings.get();
      const found = await scanForWorkspaces(scanRoots(s.scanFolders), s.scanIgnore);
      settings.set({ found });
      return found;
    },
    async trash(absPaths) {
      // the system has no trash for these folders, so keep what is deleted in the app's own folder for a while
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (const p of absPaths) {
        const dest = `${paths.files}/trash/${stamp}/${p.replace(/^.*\//, '')}`;
        await fs.mkdir(dest.replace(/\/[^/]*$/, ''), { recursive: true });
        await fs.cp(p, dest, { recursive: true });
        await fs.rm(p, { recursive: true, force: true });
      }
    },
    async setTitle(title) {
      document.title = title;
    },
    async setTheme(theme) {
      document.documentElement.dataset.theme = theme;
      settings.set({ theme });
    },
    async setHeaderColor() {},
    async closeNow() {
      await settings.flush();
      void CapApp.exitApp();
    },
    async getWindowInit() {
      const s = settings.get();
      plog.line('INFO', 'main', `session: reopening ${s.tabs.length} tab(s)${s.tabs.length ? ': ' + s.tabs.map((t) => `${t.root.split('/').pop()}${t.path ? '/' + t.path : ''}`).join(', ') : ''}`);
      return { tabs: s.tabs, activeTab: s.activeTab };
    },
    async setWindowTabs(tabs, activeTab) {
      // Nothing is written for "no tabs" before the saved ones have been reopened (the first call of a start is made while the
      // window is still empty), and the session goes to storage at once: the app can be stopped any moment in the background.
      if (tabs.length === 0 && !sessionRestored) return;
      sessionRestored = true;
      const before = JSON.stringify(settings.get().tabs) + settings.get().activeTab;
      settings.set({ tabs, activeTab });
      if (before !== JSON.stringify(tabs) + activeTab) {
        plog.line('DEBUG', 'main', `session saved: ${tabs.length} tab(s)`);
        void settings.flush();
      }
    },
    async isFile(absPath) {
      const s = await fs.stat(absPath).catch(() => null);
      return !!s && s.isFile();
    },
    async readLog(id: string) {
      return { id: String(id), label: 'Cave Notes on this phone', text: (await plog.read()) || '(the log is empty)\n' };
    },
    async logSources() {
      return { dir: `${paths.files}/logs`, sources: [{ id: 'app', label: 'Cave Notes on this phone', path: plog.file }] };
    },
    async bundledFonts() {
      return { url: '', families: [] };
    },
    async getGlobalExportStyles() {
      return '';
    },
    async setGlobalExportStyles() {},
    async getDisplays() {
      return [];
    },
    async forgetScriptApprovals() {},
  };

  const deps: Deps = {
    main: partialMainApi(base),
    wsFor,
    on: ((event: keyof EventMap, cb: Listener) => {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    }) as Deps['on'],
    platform: 'android',
    capabilities: ANDROID_CAPABILITIES,
    // the files are real files on the phone, which the WebView can show through Capacitor's file route
    assetUrl: (root, segments) => Capacitor.convertFileSrc(`file://${root.replace(/\/+$/, '')}/${segments.join('/')}`),
  };

  // going to the background: write what is in memory (the search index of each open workspace, the preferences) to storage
  // and coming back after a while: Syncthing may have changed files meanwhile (nothing watches the folder on Android), so each
  // open workspace reads its folder again (only the files whose time or size changed are read)
  let hiddenAt = 0;
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    plog.lifecycle(isActive);
    if (!isActive) {
      hiddenAt = Date.now();
      void settings.flush();
      for (const a of attached.values()) void a.host.saveIndex();
      return;
    }
    if (!hiddenAt || Date.now() - hiddenAt < 8000) return;
    hiddenAt = 0;
    for (const [root, a] of attached) if (a.opened) void wsFor(root).rescan().catch((e: Error) => console.warn(`[rescan] ${e.message}`));
  });

  void capabilitiesOf;
  return { deps, settings, plog, flush: () => settings.flush() };
}
