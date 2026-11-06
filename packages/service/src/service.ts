import type { FSWatcher } from 'node:fs';
import { fs, fsSync, host as machine, path, sha1 as sha1Of, utf8Bytes, utf8Text } from '@cave-notes/platform';
import { classifyDestination, parse as parseMarkdown, splitWorkspaceTarget } from '@cave-notes/core-md';
import { buildLookup, openIndex, resolvePageLink, setWeekStart, type Index, type Lookup } from '@cave-notes/core-index';
import { applyPlan, listJournal, planMove, undo } from '@cave-notes/core-links';
import { conflictOriginal, HistoryStore, isConflictName, mergeDocuments, pickBase } from '@cave-notes/core-sync';
import { namedStylesFromYaml, parseStyleSetsYaml } from '@cave-notes/core-export';
import { configureNotes, defaultNoteExt, isNoteFile, noteExtOf, noteExtensions, normalizeName, normalizePagePath, pageFolder, pageName, parentPage, type Tree } from '@cave-notes/core-tree';
import type { PageSource,
  FileItem, NoteTypes, ApplyResult, DeleteInfo, IndexStats, LinkInfo, LinkPlan, PageData, PageInfo, PageSuggestion, ResolvedLink,
  SearchResponse, TreeItem, WireError, WorkerApi, WorkerEvents, WorkspaceAppearance, WorkspaceInfo, WorkspaceState, WriteResult, BacklinkInfo, AttributeKey, AttrValue, ViewData, SavedQueries,
  RelationEditRequest, RelationEditResult, RelationPage, ReplaceChoice, ReplaceDone, ReplaceFound, ReplacePage, ReplaceRequest,
  ConflictMerge, FontSizes, HistoryEntry, AutomationStatus, AutomationRuleHit, AutomationLogEntry, YamlSection, PluginInfo, PluginAsk, PluginResult, UninstallResult } from './api';
import YAML from 'yaml';
import { log, timed } from './log';
import { REPLACE_KINDS, applyMatches, compileFind, findMatches, matchName, type ReplaceKind, type ReplaceOptions } from './replace';
import { watchWorkspace } from '#watcher';
import { editRelation as runRelationEdit, foreignKey, foreignParts, type RelationHost } from './relations';
import { defaultTemplateName, findTemplate, instantiate, listTemplates, mergeWithTemplate, type TemplateInfo } from './templates';
import { embeddedText, replaceEmbedded } from '@cave-notes/core-md';
import { parseAutomations } from '@cave-notes/core-automation';
import { describe as describeOffer, inheritedFor, pendingFor, publishOffer, readConsent, readOffers, writeConsent } from './globals';
import { AutomationRunner, defaultDeviceName, type AutomationDeps } from './automation';
import { CONFIG_NOTES, configCreateExt, ensureConfigFolder, isConfigRoot } from './config-folder';
import { INFO_DIR, STATE_FILE, editSection, editYaml, infoPath, readSections, readSettings, rulesText, setKey } from './workspace-file';
import { homeFor, readConfig } from '@cave-notes/core-index/config';
import { loadDefaultPlugins, removeDefaultPlugin, removeRuleFromFile, removedDefaults, seedDefaults, type DefaultPlugins } from './app-config';

const sha1 = (data: Uint8Array | string): string => sha1Of(data);
const posix = path.posix;

type Emit = <K extends keyof WorkerEvents>(event: K, payload: WorkerEvents[K]) => void;

export interface ServiceOptions {
  /** parse in this many worker threads while indexing (default: up to 3, leaving a core for the UI) */
  workers?: number;
  /** debounce for file-system events in ms */
  watchDebounceMs?: number;
  /** how long a vanished page file waits for a file with the same content to appear (a move) before it counts as deleted */
  moveGraceMs?: number;
  /** the database driver for the search index (default better-sqlite3; Android passes sqlite-wasm) */
  driver?: unknown;
  /** called with the index file's path before it is opened, so a platform whose database lives in memory can restore its snapshot */
  prepareIndex?: (dbPath: string) => Promise<void>;
}

/** What cannot be done in the built-in documentation (reading, searching and the view state of the tree still work). */
const READ_ONLY_METHODS = new Set([
  'setNoteTypes', 'duplicatePage', 'copyPageIn', 'createPageNumbered', 'setWorkspaceYaml', 'setExportStyles', 'reorderPage', 'setAppearance',
  'writePage', 'createPage', 'promoteVirtual', 'planMove', 'applyPlan', 'undoLast', 'afterDelete', 'saveQuery', 'setAttribute', 'setFileAttributes', 'moveFile', 'mergeTemplateInto', 'editRelation',
  'setPageTitle', 'importFile', 'importExternal', 'saveEmbed', 'snapshot', 'mergeConflictCopies', 'ensureConfigFolder',
]);

interface Open {
  root: string;
  index: Index;
  tree: Tree;
  stopWatching: () => Promise<void>;
  lookup: Lookup | null;
  rowsById: Map<number, unknown> | null;
  statePath: string;
  dataDir: string;
  state: WorkspaceState;
  stateTimer: NodeJS.Timeout | null;
  /** the background indexing run, so closing can wait for it before closing the database */
  indexing: Promise<void>;
  /** true while that background run is still going (moves log it: a plan made before indexing ends reads many files) */
  indexingNow: boolean;
  /** which pages are hidden from the tree, as one string, to notice when that changes */
  hiddenSig: string;
  /** a fingerprint of the settings taken from other workspaces, to notice when they change */
  inheritedSig: string;
  /** the automation rules taken from other workspaces */
  inheritedRules: unknown[] | undefined;
  /** the plugins that come with the app, read from the app config folder (null: there is none, or this workspace takes none) */
  defaultPlugins?: DefaultPlugins | null;
  /** a fingerprint of them, to notice when a file there changed */
  defaultsSig?: string;
  /** export style sets taken from other workspaces (`export-style: !global`), as a map by name */
  inheritedExport?: Record<string, unknown>;
  /** set when one Markdown file is open on its own: its file name (the workspace is then its folder, and nothing is saved beside it) */
  single: string | null;
  /** set when the workspace's own `.cave-notes` folder is open to edit its files: no index, schema, globals or automations */
  config: boolean;
  /** the built-in documentation: nothing in it can be changed */
  docs: boolean;
  history: HistoryStore;
  /** pages the app has read or written: only their disk changes are remembered in the history */
  tracked: Set<string>;
  conflictMerge: ConflictMerge;
  /** pages the person was already asked about (conflict copies), so the question is not repeated */
  asked: Set<string>;
  /** page files that vanished and might turn up elsewhere (a move) */
  pending: Map<string, { hash: string; timer: NodeJS.Timeout | null }>;
  /** the automation engine of this workspace (once it has an automations file and the index is ready) */
  automation: AutomationRunner | null;
  /** how this computer is called in the automations file */
  deviceName: string;
}

/** Everything the app needs from a workspace, behind one object. No Electron dependency. */
/** What the worker has been busy with since the last time it was read (see entry.ts: one summary line a minute). */
export const activity = { batches: 0, files: 0 };

/** The workspace's named paragraph styles and extra CSS, left out when there are none. */
function appearanceStyles(raw: Record<string, unknown>): { styles?: Record<string, Record<string, unknown>>; css?: string; presentation?: { themes?: Record<string, unknown>; rules?: unknown[] } } {
  const styles = namedStylesFromYaml(raw.styles, 'cm') as Record<string, Record<string, unknown>>;
  const css = typeof raw.css === 'string' ? raw.css.slice(0, 20000) : '';
  const themes = raw['presentation-themes'];
  const rules = raw['presentation-rules'];
  const presentation = {
    ...(themes && typeof themes === 'object' && !Array.isArray(themes) ? { themes: themes as Record<string, unknown> } : {}),
    ...(Array.isArray(rules) ? { rules } : {}),
  };
  return { ...(Object.keys(styles).length ? { styles } : {}), ...(css ? { css } : {}), ...(Object.keys(presentation).length ? { presentation } : {}) };
}

export class WorkspaceService implements WorkerApi {
  private ws: Open | null = null;
  /** hashes of files we just wrote, so the watcher does not report our own saves as external edits */
  private recentWrites = new Map<string, string>();
  /** The hashes of the last few texts this app saved to each page: a file holding one of them was written by us. */
  private ownWrites = new Map<string, string[]>();
  /** Saves of one page run one after another. */
  private writeChains = new Map<string, Promise<unknown>>();
  /** Pages whose index entry is to be refreshed after a save that did not wait for it. */
  private refreshPending = new Set<string>();
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly emit: Emit,
    private readonly options: ServiceOptions = {},
  ) {}

  private get open(): Open {
    if (!this.ws) throw Object.assign(new Error('No workspace is open'), { code: 'NO_WORKSPACE' });
    return this.ws;
  }

  private abs(rel: string): string {
    return path.join(this.open.root, ...rel.split('/'));
  }

  /** Dispatch for the RPC layer. */
  async call(method: string, args: unknown[]): Promise<unknown> {
    const fn = (this as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function' || method.startsWith('_') || method === 'call') {
      throw Object.assign(new Error(`Unknown method ${method}`), { code: 'BAD_METHOD' });
    }
    if (this.ws?.docs && READ_ONLY_METHODS.has(method)) {
      throw Object.assign(new Error('The documentation is read only.'), { code: 'READ_ONLY' });
    }
    return (fn as (...a: unknown[]) => unknown).apply(this, args);
  }

  // ---------------------------------------------------------------- workspace

  async openWorkspace(rootDir: string, opts: { file?: string; config?: boolean; docs?: boolean; dataDir?: string; notes?: NoteTypes; deviceName?: string; firstDay?: number; globalDir?: string; globalsEnabled?: boolean; appConfigDir?: string; shippedDefaultsDir?: string } = {}): Promise<WorkspaceInfo> {
    await this.closeWorkspace();
    const root = path.resolve(rootDir);
    const tOpen = performance.now();
    log.info(`opening workspace root=${root}${opts.file ? ` single=${opts.file}` : ''}`);
    const st = await fs.stat(root).catch(() => null);
    if (!st?.isDirectory()) {
      log.error(`cannot open: not a folder (or not readable): ${root}`);
      throw Object.assign(new Error(`Not a folder: ${root}`), { code: 'NOT_A_FOLDER' });
    }

    // which files are notes: this workspace's own choice, else the app's
    const docs = opts.docs === true;
    const config = docs || opts.config === true || (!opts.file && isConfigRoot(root));
    const own = opts.file || config ? null : await this.readNoteTypes(root);
    const notes = docs ? { exts: ['.md'], create: '.md' } : config ? CONFIG_NOTES : (own ?? opts.notes ?? { exts: ['.md'], create: '.md' });
    configureNotes({ exts: notes.exts, defaultExt: notes.create });
    setWeekStart(opts.firstDay ?? 0);
    // Everything that belongs to one computer (search index, view state, history, undo journals) lives in the app's own
    // data folder, never in the workspace, so no sync tool has to be told to leave it alone.
    const dataDir = opts.dataDir ?? path.join(machine.tmpdir(), 'cave-notes-data', sha1(root).slice(0, 16));

    const cores = machine.cpuCount();
    const single = opts.file ?? null;
    const lite = !!single || config;
    let progressSink: ((p: { phase?: 'scan' | 'parse' | 'finish'; fraction?: number }) => void) | null = null;
    const dbPath = lite ? ':memory:' : path.join(dataDir, 'index.db');
    if (!lite) await this.options.prepareIndex?.(dbPath);
    const index = await openIndex(root, {
      ignore: ['node_modules'],
      ...(this.options.driver ? { driver: this.options.driver } : {}),
      workers: lite ? 0 : (this.options.workers ?? Math.max(0, Math.min(3, cores - 1))),
      dbPath,
      // a big first index runs in parts; one line per part (a few seconds each) shows it advancing
      onProgress: (p: { phase?: 'scan' | 'parse' | 'finish'; done?: number; parts?: number; fraction?: number }) => {
        if (p.done !== undefined) log.info(`indexing: part ${p.done} of ${p.parts} (${Math.round((performance.now() - tOpen) / 1000)} s since opening, rss ${machine.rssMB()} MB)`);
        progressSink?.(p);
      },
      ...(single ? { only: [single] } : {}),
    });
    log.info(`index opened in ${Math.round(performance.now() - tOpen)} ms: db=${path.join(dataDir, 'index.db')} noteExts=${notes.exts.join(',')} parseThreads=${single ? 0 : (this.options.workers ?? Math.max(0, Math.min(3, cores - 1)))}`);
    const statePath = path.join(dataDir, STATE_FILE);
    let state: WorkspaceState = { expanded: [], lastPage: null };
    try {
      state = { ...state, ...(YAML.parse(await fs.readFile(statePath, 'utf8')) as object) };
    } catch {
      /* first run */
    }

    const o: Open = {
      root, index, tree: index.tree, stopWatching: async () => {}, lookup: null, rowsById: null, statePath, state, stateTimer: null,
      indexing: Promise.resolve(), indexingNow: false, hiddenSig: '', inheritedSig: '', inheritedRules: undefined, single, config, docs,
      history: new HistoryStore(path.join(dataDir, 'history')),
      dataDir, tracked: new Set(), conflictMerge: 'never', asked: new Set(), pending: new Map(),
      automation: null, deviceName: opts.deviceName?.trim() || defaultDeviceName(),
    };
    progressSink = (p) => this.onIndexProgress(o, p);
    this.ws = o;
    this.globalDir = lite ? null : (opts.globalDir ?? null);
    this.appConfigDir = lite || single || config ? null : (opts.appConfigDir ?? null);
    this.shippedDefaultsDir = opts.shippedDefaultsDir ?? null;
    this.globalsEnabled = opts.globalsEnabled !== false;
    o.inheritedSig = '';
    await this.refreshGlobals(o).catch((e) => log.warn('globally global settings could not be read', e));
    const stopFiles = watchWorkspace(root, (b) => void this.onFilesChanged(b.files, b.folders, b.schema, b.others, b.automations), this.options.watchDebounceMs ?? 150, single ?? undefined);
    const stopGlobals = this.watchGlobals(o);
    o.stopWatching = async () => {
      stopGlobals();
      await stopFiles();
    };

    // Index in the background; the tree already works from the disk.
    o.indexing = this.indexInBackground(o);
    log.info(`workspace open after ${Math.round(performance.now() - tOpen)} ms (indexing continues in the background)`);
    if (docs) return { root, name: 'Documentation', config: true, docs: true };
    if (config) return { root, name: `${path.basename(path.dirname(root))} (config)`, config: true };
    return single ? { root, name: pageName(single), single: true } : { root, name: path.basename(root) };
  }

  private globalDir: string | null = null;
  /** the app's own settings folder (its plugins and templates), and the folder with what ships with the app */
  private appConfigDir: string | null = null;
  private shippedDefaultsDir: string | null = null;
  /** the app's own templates (see app-config.ts), offered in every workspace */
  private get appTemplates(): string | null {
    return this.appConfigDir ? path.join(this.appConfigDir, 'templates') : null;
  }
  private globalsEnabled = true;

  /** Read the settings other workspaces offer and this person approved, and give them to the index. */
  private async refreshGlobals(o: Open): Promise<boolean> {
    const dir = this.globalsEnabled ? this.globalDir : null;
    let inherited = {};
    if (dir && !o.single && !o.config) {
      await publishOffer(dir, o.root, await readSettings(infoPath(o.root)));
      inherited = inheritedFor(o.root, await readOffers(dir), await readConsent(dir));
    } else if (this.globalDir && !this.globalsEnabled) {
      // switched off completely: this workspace publishes nothing either
      await fs.rm(path.join(this.globalDir, `offer-${sha1(o.root).slice(0, 16)}.json`), { force: true }).catch(() => undefined);
    }
    const sig = JSON.stringify(inherited);
    if (sig === o.inheritedSig) return false;
    o.inheritedSig = sig;
    o.inheritedRules = (inherited as { rules?: unknown[] }).rules;
    o.inheritedExport = (inherited as { exportStyles?: Record<string, unknown> }).exportStyles;
    await o.index.setInherited(inherited);
    if (o.automation) void o.automation.reload().catch(() => undefined);
    return true;
  }

  /**
   * What other workspaces offer lives in files in the app's data folder, and this workspace only read them when it opened
   * or when its own settings changed. Watching that folder lets a change made in one open workspace reach the others at
   * once, just as it reaches its own.
   */
  private watchGlobals(o: Open): () => void {
    const dir = this.globalsEnabled ? this.globalDir : null;
    if (!dir || o.single || o.config) return () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;
    const changed = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (this.ws !== o) return;
        void this.refreshGlobals(o)
          .then(async (moved) => {
            if (!moved || this.ws !== o) return;
            o.lookup = null;
            this.emit('index:updated', { path: null });
            await this.ensureAutomation(o);
          })
          .catch(() => undefined);
      }, 60);
    };
    try {
      fsSync.mkdirSync(dir, { recursive: true });
      watcher = fsSync.watch(dir, (_e, name) => {
        if (!name || /^(offer-.*\.json|consent\.json)$/.test(String(name))) changed();
      });
      watcher.on('error', () => undefined);
    } catch {
      /* no watching here: the offers are still read when settings change */
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }

  /** reloadSchema, after publishing this workspace's own offer and picking up what it may take from the others */
  private async reloadSchemas(o: Open): Promise<{ changed: boolean; warnings: string[] }> {
    const moved = await this.refreshGlobals(o).catch(() => false);
    const r = (await o.index.reloadSchema()) as { changed: boolean; warnings: string[] };
    return moved ? { ...r, changed: true } : r;
  }

  /** Offers of other workspaces this one has not been asked about yet. */
  async globalsPending(): Promise<Array<{ source: string; name: string; hash: string; summary: string[] }>> {
    const o = this.open;
    if (!this.globalsEnabled || !this.globalDir || o.single || o.config) return [];
    const offers = await readOffers(this.globalDir);
    return pendingFor(o.root, offers, await readConsent(this.globalDir)).map((x) => ({ source: x.root, name: x.name, hash: x.hash, summary: describeOffer(x.sections) }));
  }

  /** Record the answer for one offer: `apply` are the workspaces that take it, `asked` every workspace the question covered. */
  async globalsDecide(source: string, hash: string, apply: string[], asked: string[]): Promise<void> {
    const o = this.open;
    if (!this.globalDir) return;
    const consent = await readConsent(this.globalDir);
    const cur = consent[source];
    const same = cur && cur.hash === hash;
    consent[source] = {
      hash,
      apply: [...new Set([...(same ? cur.apply.filter((r) => !asked.includes(r)) : []), ...apply])],
      decided: [...new Set([...(same ? cur.decided : []), ...asked])],
    };
    await writeConsent(this.globalDir, consent);
    if (await this.refreshGlobals(o)) {
      o.lookup = null;
      this.emit('index:updated', { path: null });
      await this.ensureAutomation(o); // shared rules may be the first this workspace has
    }
  }

  /** The app preference "use globally global settings" changed. */
  async globalsEnable(enabled: boolean): Promise<void> {
    this.globalsEnabled = enabled;
    const o = this.open;
    o.inheritedSig = '\u0000'; // force the index to take what is now (not) approved
    await this.refreshGlobals(o);
    o.lookup = null;
    this.emit('index:updated', { path: null });
  }

  /** Turn the indexer's phase and fraction into one percentage (scan 0-5, parse 5-92, finish 92-99) and tell the windows, at most 4 times a second. */
  private lastProgressAt = 0;
  private onIndexProgress(o: Open, p: { phase?: 'scan' | 'parse' | 'finish'; fraction?: number }): void {
    if (this.ws !== o || !o.indexingNow) return;
    const f = Math.max(0, Math.min(1, p.fraction ?? 0));
    const range = p.phase === 'scan' ? [0, 5] : p.phase === 'finish' ? [92, 99] : [5, 92];
    const percent = Math.min(99, Math.round(range[0]! + f * (range[1]! - range[0]!)));
    const now = performance.now();
    if (now - this.lastProgressAt < 250 && f !== 0) return;
    this.lastProgressAt = now;
    this.emit('index:status', { state: 'indexing', pages: o.index.stats().pages, percent, phase: p.phase ?? 'parse' });
  }

  private async indexInBackground(o: Open): Promise<void> {
    const t0 = performance.now();
    if (o.config && !o.docs) {
      // nothing to index: the tree reads the folder from disk, and there is no search here
      this.emit('index:status', { state: 'ready', pages: 0, ms: 0 });
      this.emit('tree:changed', { parents: 'all' });
      return;
    }
    this.emit('index:status', { state: 'indexing', pages: o.index.stats().pages, percent: 0, phase: 'scan' });
    o.indexingNow = true;
    try {
      const stats = await o.index.reconcile();
      log.info(`indexing done in ${Math.round(performance.now() - t0)} ms`, stats ?? '');
    } catch (e) {
      if (this.ws === o) log.error('indexing failed', e);
    } finally {
      o.indexingNow = false;
    }
    if (this.ws !== o) return;
    o.lookup = null;
    o.hiddenSig = [...o.index.hiddenPaths()].join('\n');
    { const st = o.index.stats(); this.emit('index:status', { state: 'ready', pages: st.pages, files: st.files, ms: performance.now() - t0, percent: 100, phase: 'ready' }); }
    this.emit('tree:changed', { parents: 'all' });
    this.emit('index:updated', { path: null });
    if (!o.single) await this.ensureAutomation(o);
  }

  // ---------------------------------------------------------------- automations

  private automationDeps(): AutomationDeps {
    return {
      search: (q, opts) => this.search(q, opts),
      pageInfo: (p) => this.pageInfo(p),
      readPage: (p) => this.readPage(p),
      writePage: (p, t, h) => this.writePage(p, t, h),
      createPage: (parent, name, content) => this.createPage(parent, name, content),
      planMove: (from, parent, name) => this.planMove(from, parent, name),
      applyPlan: (plan) => this.applyPlan(plan),
      resolveLink: (link, from) => this.resolveLink(link, from),
      setFrontmatterValue,
    };
  }

  /** Start the engine when the workspace has an automations file; read the file again when it has one already. */
  private async ensureAutomation(o: Open): Promise<void> {
    if (o.single || o.config) return;
    try {
      await this.refreshDefaultPlugins(o);
      if (o.automation) {
        await o.automation.reload();
        return;
      }
      if ((await rulesText(infoPath(o.root), o.inheritedRules, o.defaultPlugins?.rules)) === null) return;
      const runner = await AutomationRunner.create(this.automationDeps(), { root: o.root, dataDir: o.dataDir, deviceName: o.deviceName, inheritedRules: () => o.inheritedRules, defaultRules: () => o.defaultPlugins?.rules, emit: this.emit });
      if (this.ws !== o) return;
      o.automation = runner;
      log.info(`automations: starting for ${o.root} on "${o.deviceName}" (device ${runner.deviceId})`);
      await runner.start();
    } catch (e) {
      log.error('automations failed to start', e);
    }
  }

  async automationStatus(): Promise<AutomationStatus> {
    const a = this.open.automation;
    if (!a) return { enabled: false, rules: [], problems: [], pending: 0, device: { id: '', name: this.open.deviceName } };
    return { enabled: true, ...a.status() };
  }

  /** The rules (with their definitions) whose criteria this page meets. */
  async automationRulesFor(p: string): Promise<AutomationRuleHit[]> {
    return (await this.open.automation?.rulesFor(p)) ?? [];
  }

  async automationLog(limit = 100): Promise<AutomationLogEntry[]> {
    return this.open.automation?.recent(limit) ?? [];
  }

  async automationRun(ruleId: string, opts: { dry?: boolean; path?: string | null; limit?: number } = {}): Promise<Array<{ path: string | null; status: string; detail: string }>> {
    const a = this.open.automation;
    if (!a) throw Object.assign(new Error('This workspace has no automation rules (rules: in a settings file of .cave-notes).'), { code: 'NO_AUTOMATIONS' });
    const out = await a.runRule(ruleId, opts);
    return out.map((r) => ({ path: r.path, status: r.status, detail: r.detail }));
  }

  /**
   * A button (`[=Label](automation:rule-id)`) in the page `p` was clicked. The page is looked at again first, so the rule sees what
   * the person just typed (the window saves the page before it asks). Answers with what happened; it never throws for a rule that did not run.
   */
  async automationButton(ruleId: string, p: string): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; steps: Array<{ action: string; status: string; detail: string }> }> {
    const a = this.open.automation;
    if (!a) return { status: 'refused', detail: 'This workspace has no automation rules (a “rules:” list in a settings file of .cave-notes), so the button has nothing to run.', steps: [] };
    const page = normalizePagePath(p);
    await this.refreshQueue.catch(() => undefined);
    await this.open.index.refresh([page]).catch(() => undefined);
    return a.runButton(ruleId, page);
  }

  /**
   * The Plugins menu: this workspace's own, and the plugins another workspace offers to all (a `rules:` entry tagged `!global`)
   * that this one has not accepted. Those are listed with `pending` set: choosing one asks first.
   */
  /** Read the plugins that come with the app again; true when they are not what they were. */
  private async refreshDefaultPlugins(o: Open): Promise<boolean> {
    if (!this.appConfigDir || o.single || o.config) return false;
    await seedDefaults(this.shippedDefaultsDir, this.appConfigDir).catch((e) => log.warn(`app defaults: ${(e as Error).message}`));
    const loaded = await loadDefaultPlugins(this.appConfigDir);
    for (const p of loaded.problems) log.warn(`app plugin file skipped: ${p}`);
    const sig = JSON.stringify(loaded.rules);
    const changed = sig !== (o.defaultsSig ?? '[]');
    o.defaultPlugins = loaded;
    o.defaultsSig = sig;
    return changed;
  }

  async automationPlugins(): Promise<PluginInfo[]> {
    const o = this.open;
    if (await this.refreshDefaultPlugins(o)) await this.ensureAutomation(o);
    const shipped = o.defaultPlugins?.fileOf ?? new Map<string, string>();
    const own = new Set<string>();
    if (shipped.size > 0) {
      const cfg = await readConfig(infoPath(o.root)).catch(() => null);
      for (const r of [...(((cfg?.sections as { rules?: unknown[] } | undefined)?.rules) ?? []), ...(o.inheritedRules ?? [])]) {
        const id = (r as { id?: unknown } | null)?.id;
        if (typeof id === 'string') own.add(id);
      }
    }
    const out = ((o.automation?.plugins() ?? []) as PluginInfo[]).map((p) => (shipped.has(p.id) && !own.has(p.id) ? { ...p, origin: 'default' as const, file: shipped.get(p.id)! } : { ...p, origin: 'workspace' as const }));
    if (!this.globalsEnabled || !this.globalDir || o.single || o.config) return orderPlugins(out);
    const have = new Set(out.map((p) => p.id));
    const consent = await readConsent(this.globalDir);
    for (const off of await readOffers(this.globalDir)) {
      const c = consent[off.root];
      if (off.root === o.root || (c && c.hash === off.hash && c.apply.includes(o.root))) continue;
      const rules = off.sections.rules;
      if (!rules?.length) continue;
      for (const r of parseAutomations(YAML.stringify({ rules })).rules as Array<{ id: string; name: string; ask: PluginInfo['ask']; enabled: boolean; triggers: Array<{ kind: string; label?: string | null }> }>) {
        const t = r.triggers.find((x) => x.kind === 'plugin');
        if (!t || !r.enabled || have.has(r.id)) continue;
        have.add(r.id);
        out.push({ id: r.id, label: t.label ?? r.name, ask: r.ask, pending: { source: off.root, name: off.name }, origin: 'workspace' });
      }
    }
    return orderPlugins(out);
  }

  /** The offer of one workspace, to ask about it again (even if it was answered before). */
  async globalsOffer(source: string): Promise<{ source: string; name: string; hash: string; summary: string[] } | null> {
    if (!this.globalDir) return null;
    const x = (await readOffers(this.globalDir)).find((f) => f.root === source);
    return x ? { source: x.root, name: x.name, hash: x.hash, summary: describeOffer(x.sections) } : null;
  }

  /** Take a plugin out. Written in a settings file: removed from that file. Shipped with the app: its file in the app config folder goes (and is not copied back). */
  async uninstallPlugin(id: string): Promise<UninstallResult> {
    const o = this.open;
    const plugin = (await this.automationPlugins()).find((p) => p.id === id);
    if (!plugin) return { ok: false, message: 'There is no such plugin.' };
    if (plugin.pending) return { ok: false, message: `This plugin is offered by the workspace “${plugin.pending.name}”. Remove it there, or leave it off here.` };
    if (plugin.origin === 'default') {
      if (!this.appConfigDir || !(await removeDefaultPlugin(this.appConfigDir, id))) return { ok: false, message: 'The plugin’s file could not be found in the app config folder.' };
      await this.ensureAutomation(o);
      return { ok: true, message: `“${plugin.label}” was uninstalled. Plugins > All plugins can bring back the ones that come with the app.` };
    }
    const dir = infoPath(o.root);
    const cfg = await readConfig(dir);
    let done = false;
    for (const f of cfg.files) if (!f.error && f.keys.includes('rules') && (await removeRuleFromFile(path.join(dir, f.name), id))) done = true;
    if (!done) return { ok: false, message: 'This plugin comes from another workspace’s shared settings, so it cannot be removed here.' };
    await this.ensureAutomation(o);
    return { ok: true, message: `“${plugin.label}” was removed from the workspace’s settings.` };
  }

  /** Copy back the plugins and templates that came with the app and were deleted. How many came back. */
  async restoreDefaultPlugins(): Promise<number> {
    if (!this.appConfigDir) return 0;
    const gone = (await removedDefaults(this.shippedDefaultsDir, this.appConfigDir)).length;
    await seedDefaults(this.shippedDefaultsDir, this.appConfigDir, { restore: true });
    await this.ensureAutomation(this.open);
    return gone;
  }

  async automationPluginAsk(ruleId: string, p: string, text: string, selection: boolean): Promise<PluginAsk[]> {
    const a = this.open.automation;
    if (!a) return [];
    return (await a.pluginQuestions(ruleId, { path: normalizePagePath(p), text, selection })) as PluginAsk[];
  }

  async automationPlugin(ruleId: string, p: string, text: string, selection: boolean, answers: Record<string, unknown>, cursor: number | null = null): Promise<PluginResult> {
    const a = this.open.automation;
    if (!a) return { status: 'refused', detail: 'This workspace has no automation rules (a “rules:” list in a settings file of .cave-notes).', text, changed: false };
    return a.runPlugin(ruleId, { path: normalizePagePath(p), text, selection, answers, cursor });
  }

  async automationReload(): Promise<void> {
    await this.ensureAutomation(this.open);
  }

  async automationShellResult(id: string, result: { code: number; stdout?: string; stderr?: string; timedOut?: boolean; denied?: boolean; reason?: string }): Promise<void> {
    this.ws?.automation?.shellResult(id, result);
  }

  async automationJsResult(id: string, answer: { allowed: boolean; reason?: string }): Promise<void> {
    this.ws?.automation?.jsResult(id, answer);
  }

  async automationSetDevice(name: string): Promise<void> {
    const o = this.ws;
    if (!o) return;
    o.deviceName = name.trim() || defaultDeviceName();
    o.automation?.setDeviceName(o.deviceName);
  }

  async setFirstDay(day: number): Promise<void> {
    setWeekStart(day);
    if (this.ws) this.emit('index:updated', { path: null });
  }

  async closeWorkspace(): Promise<void> {
    const o = this.ws;
    if (!o) return;
    log.info(`closing workspace root=${o.root}`);
    this.ws = null;
    if (o.stateTimer) {
      clearTimeout(o.stateTimer);
      await this.writeState(o);
    }
    await o.stopWatching();
    await o.automation?.stop().catch(() => undefined);
    for (const p of o.pending.values()) if (p.timer) clearTimeout(p.timer);
    o.pending.clear();
    // Let a still-running indexing pass finish before the database goes away, without making the
    // caller (e.g. switching workspaces) wait for it.
    void o.indexing.finally(() => o.index.close());
    this.recentWrites.clear();
    this.ownWrites.clear();
    this.refreshPending.clear();
  }

  private async onFilesChanged(files: Set<string>, folders: Set<string>, schema = false, others = false, automations = false): Promise<void> {
    const o = this.ws;
    if (!o) return;
    const tBatch = performance.now();
    activity.batches++;
    activity.files += files.size + folders.size;
    log.debug(`file changes: ${files.size} note file(s), ${folders.size} folder(s)${schema ? ', schema' : ''}${others ? ', other files' : ''}${files.size + folders.size <= 6 ? ` [${[...files, ...folders].join(' | ')}]` : ''}`);
    try {
      await this.handleChanges(o, files, folders, schema, others);
      if (automations && this.ws === o) await this.ensureAutomation(o);
    } finally {
      const ms = Math.round(performance.now() - tBatch);
      if (ms > 1000) log.warn(`handling ${files.size + folders.size} file change(s) took ${ms} ms`);
    }
  }

  private async handleChanges(o: Open, files: Set<string>, folders: Set<string>, schema: boolean, others: boolean): Promise<void> {
    if (others) {
      try {
        await o.index.syncFiles();
      } catch (e) {
        log.error('file attributes failed', e);
      }
      if (this.ws !== o) return;
      this.emit('index:updated', { path: null });
      this.emit('tree:changed', { parents: 'all' });
    }
    if (schema) {
      try {
        if ((await this.reloadSchemas(o)).changed) {
          o.lookup = null;
          this.emit('index:updated', { path: null });
        }
      } catch (e) {
        log.error('schema reload failed', e);
      }
    }
    const copies = [...files].filter((f) => isConflictName(f));
    const real = [...files].filter((f) => !isConflictName(f));
    const pages = new Set<string>([...real, ...folders]);
    // what the index knew about these files before it looks again (to tell moves from deletions)
    const known = new Map<string, string | null>(real.map((f) => [f, o.index.pageHash(f)]));
    try {
      await o.index.refresh([...pages]);
    } catch (e) {
      log.error('refresh failed', e);
    }
    if (this.ws !== o) return;
    o.lookup = null;
    const parents = new Set<string | null>();
    for (const p of pages) parents.add(parentPage(p));
    if (!this.checkHidden(o)) this.emit('tree:changed', { parents: [...parents] });

    const disk = new Map<string, { hash: string; text: string } | null>();
    for (const f of real) {
      try {
        const buf = await fs.readFile(this.abs(f));
        disk.set(f, { hash: sha1(buf), text: utf8Text(buf) });
      } catch {
        disk.set(f, null);
      }
    }
    // a file that vanished may have been moved: look for one with the same content that appeared
    const added = real.filter((f) => disk.get(f) && !known.get(f));
    for (const f of real) {
      if (disk.get(f)) {
        const waiting = o.pending.get(f);
        if (waiting?.timer) clearTimeout(waiting.timer);
        o.pending.delete(f);
      } else if (known.get(f)) o.pending.set(f, { hash: known.get(f) as string, timer: null });
    }
    const moved = new Set<string>();
    for (const to of added) {
      const hash = (disk.get(to) as { hash: string }).hash;
      const same = [...o.pending].filter(([, v]) => v.hash === hash);
      const from = (same.find(([p]) => posix.basename(p) === posix.basename(to)) ?? same[0])?.[0];
      if (from === undefined) continue;
      const entry = o.pending.get(from);
      if (entry?.timer) clearTimeout(entry.timer);
      o.pending.delete(from);
      moved.add(to);
      o.tracked.delete(from);
      o.tracked.add(to);
      void o.history.rename(from, to).catch(() => {});
      this.emit('page:moved', { from, to, hash });
    }
    for (const [p, v] of o.pending) {
      if (v.timer) continue;
      v.timer = setTimeout(() => {
        if (o.pending.get(p) !== v) return;
        o.pending.delete(p);
        if (this.ws === o) this.emit('page:changed', { path: p, hash: null });
      }, this.options.moveGraceMs ?? 1200);
    }

    // which of these files hold what this app itself wrote (a person's save, or a rule's write), before the loop below forgets it
    const ours = new Set(real.filter((f) => {
      const d = disk.get(f);
      return d !== null && d !== undefined && (this.recentWrites.get(f) === d.hash || this.isOwnWrite(f, d.hash));
    }));
    for (const f of real) {
      const d = disk.get(f);
      if (!d || moved.has(f)) continue;
      if (ours.has(f)) continue; // our own save
      // Somebody else wrote this. Forget what we saved before: if they put the file back to one of those texts, that is news too.
      this.recentWrites.delete(f);
      this.ownWrites.delete(f);
      if (o.tracked.has(f)) await o.history.add(f, d.text, 'disk').catch(() => {});
      this.emit('page:changed', { path: f, hash: d.hash });
    }
    this.emit('index:updated', { path: null });
    // the automations look at every change, the person's own saves and their own writes included; they are told which are ours,
    // because the computer where the edit was made is the one that acts first (a deletion leaves nothing to compare, so it says nothing)
    o.automation?.changes(
      real.map((f) => ({
        path: f,
        kind: !disk.get(f) ? ('deleted' as const) : !known.get(f) ? ('created' as const) : ('modified' as const),
        ...(disk.get(f) ? { origin: ours.has(f) ? ('local' as const) : ('external' as const) } : {}),
      })),
    );
    if (copies.length > 0) await this.handleCopies(o, copies);
  }

  // ---------------------------------------------------------------- sync conflict copies

  private async handleCopies(o: Open, copies: string[]): Promise<void> {
    if (o.conflictMerge === 'auto') {
      for (const c of copies) await this.mergeCopy(o, c).catch((e) => log.error(`merging a conflict copy failed (${c})`, e));
    } else if (o.conflictMerge === 'ask') {
      const fresh = [...new Set(copies.map((c) => conflictOriginal(c) as string))].filter((p) => !o.asked.has(p));
      for (const p of fresh) o.asked.add(p);
      if (fresh.length > 0) this.emit('sync:conflicts', { pages: fresh });
    }
  }

  /**
   * Merge one conflict copy into its page and delete it. The copy's text and the page's text both go to the
   * history first, the merged text is written only if the page has not changed meanwhile (else the merge is
   * redone), and the copy is removed last: a failure anywhere leaves the copy where it was.
   */
  private async mergeCopy(o: Open, copy: string): Promise<boolean> {
    const orig = conflictOriginal(copy);
    if (!orig) return false;
    let copyText: string;
    let copyTime: number;
    try {
      copyText = await fs.readFile(this.abs(copy), 'utf8');
      copyTime = (await fs.stat(this.abs(copy))).mtimeMs;
    } catch {
      return false;
    }
    await o.history.add(orig, copyText, 'conflict-copy', copyTime);
    for (let attempt = 0; attempt < 4; attempt++) {
      let buf: Uint8Array;
      let mainTime: number;
      try {
        buf = await fs.readFile(this.abs(orig));
        mainTime = (await fs.stat(this.abs(orig))).mtimeMs;
      } catch {
        // the page itself is gone: the copy takes its place
        await fs.rename(this.abs(copy), this.abs(orig));
        await o.index.refresh([orig]);
        this.emit('page:changed', { path: orig, hash: sha1(utf8Bytes(copyText)) });
        this.emit('sync:merged', { path: orig, conflicts: 0 });
        return true;
      }
      const mainText = utf8Text(buf);
      await o.history.add(orig, mainText, 'disk');
      let result = mainText;
      let conflicts = 0;
      if (mainText !== copyText) {
        const earlier = (await o.history.texts(orig, 16)).filter((t) => t !== mainText && t !== copyText);
        const r = mergeDocuments({ base: pickBase(earlier, mainText, copyText), local: mainText, remote: copyText, localTime: mainTime, remoteTime: copyTime });
        result = r.text;
        conflicts = r.conflicts;
      }
      if (result !== mainText) {
        const w = await this.writePage(orig, result, sha1(buf));
        if (!w.ok) continue; // changed while merging: do it again with what is there now
        await o.history.add(orig, result, 'merged');
        this.emit('page:changed', { path: orig, hash: w.hash });
      }
      await fs.rm(this.abs(copy), { force: true });
      this.emit('sync:merged', { path: orig, conflicts });
      return true;
    }
    return false;
  }

  private async findCopies(o: Open): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(path.join(o.root, ...dir.split('/').filter(Boolean)), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory() && !o.single) await walk(rel);
        else if (e.isFile() && isNoteFile(e.name.replace(/\.sync-conflict-[^/]*?(\.[^./]+)?$/, '$1') || e.name) && isConflictName(e.name) && (!o.single || conflictOriginal(rel) === o.single)) out.push(rel);
      }
    };
    await walk('');
    return out;
  }

  async setSyncOptions(opts: { conflictMerge: ConflictMerge }): Promise<void> {
    const o = this.open;
    o.conflictMerge = opts.conflictMerge;
    o.asked.clear();
    if (o.conflictMerge === 'never') return;
    void this.findCopies(o).then((c) => (this.ws === o && c.length > 0 ? this.handleCopies(o, c) : undefined)).catch(() => {});
  }

  async mergeConflictCopies(): Promise<number> {
    const o = this.open;
    let n = 0;
    for (const c of await this.findCopies(o)) if (await this.mergeCopy(o, c).catch(() => false)) n++;
    return n;
  }

  // ---------------------------------------------------------------- version history

  async historyList(p: string): Promise<HistoryEntry[]> {
    return (await this.open.history.list(normalizePagePath(p))) as HistoryEntry[];
  }
  async historyRead(p: string, id: string): Promise<string | null> {
    return this.open.history.read(normalizePagePath(p), id);
  }
  async historyTexts(p: string, limit = 12): Promise<string[]> {
    return this.open.history.texts(normalizePagePath(p), limit);
  }
  async snapshot(p: string, text: string, source: HistoryEntry['source']): Promise<void> {
    const page = normalizePagePath(p);
    this.open.tracked.add(page);
    await this.open.history.add(page, text, source);
  }

  /** Did the set of hidden pages change (an edit to `hidden` or to a parent's `children` defaults)? Then the whole tree is refreshed. */
  private checkHidden(o: Open): boolean {
    const sig = [...o.index.hiddenPaths()].join('\n');
    if (sig === o.hiddenSig) return false;
    o.hiddenSig = sig;
    this.emit('tree:changed', { parents: 'all' });
    return true;
  }

  // ---------------------------------------------------------------- tree

  async listChildren(parent: string | null, opts: { includeHidden?: boolean; forChildren?: boolean; workspaces?: boolean; unlisted?: boolean; bareFolders?: boolean } = {}): Promise<TreeItem[]> {
    const o = this.open;
    const items = await o.tree.listChildren(parent, { workspaces: opts.workspaces === true, bareFolders: opts.bareFolders !== false });
    const hiddenOnly = o.index.hiddenOnlyPaths(parent);
    // the children pane lists hidden and unlisted pages too, except those whose `hidden` names it
    const hiddenFromChildren = opts.forChildren ? o.index.hiddenOnlyPaths(parent, 'children') : null;
    // unlisted pages (templates among them) keep out of the tree like `hidden` ones, unless they are being shown
    const unlisted = o.index.unlistedPaths(parent);
    const templates = o.index.templatePaths(parent);
    const icons = o.index.iconPaths(parent);
    const count = o.index.db.prepare('SELECT COUNT(*) AS n FROM pages WHERE parent_path = ?');
    const out: TreeItem[] = [];
    for (const i of items) {
      // a workspace inside this one wears the icon assigned to it in its own settings
      let nestedIcon: string | null = null;
      if (i.workspace) {
        try {
          nestedIcon = appearanceOf(await readSections(infoPath(path.join(o.root, ...pageFolder(i.path).split('/'))))).icon;
        } catch {
          /* unreadable settings: the default icon */
        }
      }
      const isUnlisted = unlisted.has(i.path);
      const shownUnlisted = isUnlisted && opts.unlisted === true;
      const isHidden = (hiddenOnly.has(i.path) || isUnlisted) && !shownUnlisted;
      if (hiddenFromChildren?.has(i.path)) continue;
      if (isHidden && !opts.includeHidden) continue;
      let hasChildren = i.hasChildren;
      if (hasChildren && !opts.includeHidden) {
        // a page whose sub-pages are all hidden has nothing to expand
        const h = new Set([...o.index.hiddenOnlyPaths(i.path), ...(opts.unlisted ? [] : o.index.unlistedPaths(i.path))]);
        if (h.size > 0 && (count.get(i.path) as { n: number }).n - h.size <= 0) hasChildren = false;
      }
      out.push({
        path: i.path, name: i.name, exists: i.exists, hasChildren, ...(isHidden ? { hidden: true } : {}),
        ...(shownUnlisted ? { unlisted: true } : {}), ...(shownUnlisted && templates.has(i.path) ? { template: true } : {}),
        ...(i.workspace ? (nestedIcon ? { icon: nestedIcon } : {}) : icons.has(i.path) ? { icon: icons.get(i.path)! } : {}),
        ...(i.workspace ? { workspaceRoot: path.join(o.root, ...pageFolder(i.path).split('/')) } : {}),
      });
    }
    return out;
  }

  /** Make the workspace's `.cave-notes` folder, its templates folder and any missing settings file; the folder's path is the answer. */
  async ensureConfigFolder(): Promise<string> {
    const o = this.open;
    if (o.single || o.config) throw Object.assign(new Error('There is no workspace here to open the settings folder of.'), { code: 'NO_WORKSPACE' });
    return ensureConfigFolder(o.root);
  }

  /**
   * Make the index agree with what is in one folder, without waiting for the rest of the workspace: the pages
   * that are not indexed yet (made by hand, by a sync tool, by an older version) or changed since are indexed now.
   * Cheap when nothing changed. Tells the windows when the index moved, so views of the folder refresh.
   */
  async syncFolder(parent: string | null): Promise<void> {
    const o = this.open;
    if (o.single || o.config) return;
    const items = await o.tree.listChildren(parent, { withChildFlag: false });
    const row = o.index.db.prepare('SELECT mtime_ms AS m FROM pages WHERE path = ?');
    const stale: string[] = [];
    for (const i of items) {
      if (!i.exists) continue;
      const r = row.get(i.path) as { m: number } | undefined;
      if (!r) {
        stale.push(i.path);
        continue;
      }
      const st = await fs.stat(this.absDir(i.path)).catch(() => null);
      if (st && Math.abs(st.mtimeMs - r.m) > 1) stale.push(i.path);
    }
    if (stale.length === 0) return;
    await o.index.refresh(stale);
    this.emit('index:updated', { path: null });
  }

  async treeAnchor(p: string): Promise<string | null> {
    const o = this.open;
    const page = normalizePagePath(p);
    const chain: string[] = [];
    for (let x: string | null = page; x !== null; x = parentPage(x)) chain.unshift(x);
    let anchor: string | null = null;
    for (const x of chain) {
      if (o.index.hiddenPaths(parentPage(x)).has(x)) return anchor;
      anchor = x;
    }
    return anchor;
  }

  async reorderPage(p: string, before: string | null): Promise<{ written: number }> {
    const o = this.open;
    const page = normalizePagePath(p);
    const parent = parentPage(page);
    const all = await o.tree.listChildren(parent, { withChildFlag: false });
    const moved = all.find((i) => i.path === page);
    if (!moved) throw Object.assign(new Error('That page no longer exists.'), { code: 'NOT_FOUND' });
    if (!moved.exists) throw Object.assign(new Error(`“${moved.name}” is a folder without a page of its own. Create its page first.`), { code: 'NEEDS_PAGE' });
    const list = all.filter((i) => i.path !== page);
    let at = before === null ? list.length : list.findIndex((i) => i.path === before);
    if (at < 0) at = list.length;
    list.splice(at, 0, moved);

    const stored = new Map<string, number | null>();
    for (const r of o.index.db.prepare('SELECT path, sort_order AS o FROM pages WHERE parent_path IS ?').all(parent) as Array<{ path: string; o: number | null }>) stored.set(r.path, r.o);
    const orderOf = (path: string): number | null => (path === page ? null : (stored.get(path) ?? null));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    // Pages with an `order` sort first, the rest by name. Find the shortest front part of the list that
    // has to carry numbers so that the rest is already in name order and has no number of its own.
    let k = list.length;
    while (k > 0) {
      const item = list[k - 1]!;
      const tail = list.slice(k - 1);
      const sorted = tail.every((t, i) => i === 0 || collator.compare(tail[i - 1]!.name, t.name) <= 0);
      if (item.path === page || orderOf(item.path) !== null || !sorted) break;
      k--;
    }
    const front = list.slice(0, k);
    const stuck = front.find((i) => !i.exists);
    if (stuck) throw Object.assign(new Error(`“${stuck.name}” is a folder without a page of its own, so the pages around it cannot be put in order. Create its page first.`), { code: 'NEEDS_PAGE' });

    const wanted = new Map<string, number>();
    const at2 = front.findIndex((i) => i.path === page);
    const others = front.filter((i) => i.path !== page);
    const nums = others.map((i) => orderOf(i.path));
    const prevN = at2 > 0 ? (nums[at2 - 1] ?? undefined) : undefined;
    const nextN = at2 < others.length ? (nums[at2] ?? undefined) : undefined;
    const increasing = nums.every((n, i) => n !== null && (i === 0 || n > (nums[i - 1] as number)));
    if (increasing) {
      const v = prevN === undefined && nextN === undefined ? 1 : prevN === undefined ? (nextN as number) - 1 : nextN === undefined ? prevN + 1 : (prevN + (nextN as number)) / 2;
      wanted.set(page, v);
    } else {
      front.forEach((i, n) => wanted.set(i.path, n + 1));
    }
    let written = 0;
    for (const [path, value] of wanted) {
      if (orderOf(path) === value) continue;
      const r = await this.setAttribute(path, 'order', value);
      if (r.ok) written++;
    }
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    return { written };
  }

  // ---------------------------------------------------------------- how a workspace looks

  async getAppearance(): Promise<WorkspaceAppearance> {
    // the config folder wears its workspace's colour (the root here is the .cave-notes folder itself) and a gear
    if (this.open.docs) return { color: null, icon: 'book', fontStyle: null, fontSizes: noSizes() };
    if (this.open.config) return { ...appearanceOf(await readSections(this.open.root)), icon: 'settings' };
    if (this.open.single) return { color: null, icon: null, fontStyle: null, fontSizes: noSizes() };
    return appearanceOf(await readSections(infoPath(this.open.root)));
  }

  async setAppearance(patch: Partial<WorkspaceAppearance>): Promise<WorkspaceAppearance> {
    const o = this.open;
    if (o.config) return this.getAppearance();
    if (o.single) return { color: null, icon: null, fontStyle: null, fontSizes: noSizes() };
    const dir = infoPath(o.root);
    if ('color' in patch) await editSection(dir, 'color', (doc) => setKey(doc, 'color', validColor(patch.color)));
    if ('icon' in patch) await editSection(dir, 'icon', (doc) => setKey(doc, 'icon', validIcon(patch.icon)));
    if ('fontStyle' in patch) await editSection(dir, 'font', (doc) => setKey(doc, 'font', validFont(patch.fontStyle)));
    if (patch.fontSizes) {
      const change = patch.fontSizes;
      await editSection(dir, 'fontSizes', (doc) => {
        const now = sizesOf((doc.toJS() as Record<string, unknown> | null) ?? {});
        const next = { ...now, ...Object.fromEntries((['sans', 'serif', 'mono'] as const).filter((k) => k in change).map((k) => [k, validSize(change[k])])) };
        const kept = Object.fromEntries((['sans', 'serif', 'mono'] as const).filter((k) => next[k] !== null).map((k) => [k, next[k]]));
        doc.delete('fontSize'); // (the one size of an older file now lives in fontSizes)
        setKey(doc, 'fontSizes', Object.keys(kept).length ? kept : null);
      });
    }
    return appearanceOf(await readSections(dir));
  }

  // ---------------------------------------------------------------- which files are notes

  private async readNoteTypes(root: string): Promise<NoteTypes | null> {
    const raw = (await readSections(infoPath(root))).notes as { extensions?: unknown; create?: unknown } | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const exts = Array.isArray(raw.extensions) ? raw.extensions.filter((x): x is string => typeof x === 'string') : [];
    if (exts.length === 0) return null;
    return { exts, create: typeof raw.create === 'string' ? raw.create : exts[0]! };
  }

  /** The workspace's own choice of note types (null: it follows the app's preference), and what is in effect now. */
  async getNoteTypes(): Promise<{ own: NoteTypes | null; effective: NoteTypes }> {
    const o = this.open;
    return { own: o.single || o.config ? null : await this.readNoteTypes(o.root), effective: { exts: noteExtensions(), create: defaultNoteExt() } };
  }

  /** Give this workspace its own note types, or (null) let it follow the app again. The tree and index are rebuilt. */
  async setNoteTypes(types: NoteTypes | null, appDefault: NoteTypes): Promise<void> {
    const o = this.open;
    if (o.single || o.config) return;
    await editSection(infoPath(o.root), 'notes', (doc) => setKey(doc, 'notes', types ? { extensions: types.exts, create: types.create } : null));
    const next = types ?? appDefault;
    configureNotes({ exts: next.exts, defaultExt: next.create });
    await o.index.rebuild();
    o.lookup = null;
    this.emit('tree:changed', { parents: 'all' });
    this.emit('index:updated', { path: null });
  }

  /** Make the app's default apply to a workspace that follows it. */
  async applyAppNoteTypes(types: NoteTypes): Promise<void> {
    const o = this.open;
    if (o.single || o.config || (await this.readNoteTypes(o.root))) return;
    const same = JSON.stringify(types.exts) === JSON.stringify(noteExtensions()) && types.create === defaultNoteExt();
    if (same) return;
    configureNotes({ exts: types.exts, defaultExt: types.create });
    await o.index.rebuild();
    o.lookup = null;
    this.emit('tree:changed', { parents: 'all' });
    this.emit('index:updated', { path: null });
  }

  /** Re-read the folder after a sub-folder became (or stopped being) a workspace of its own. */
  async rescan(): Promise<void> {
    const o = this.open;
    await o.index.reconcile();
    o.lookup = null;
    this.emit('tree:changed', { parents: 'all' });
    this.emit('index:updated', { path: null });
  }

  /** Look for changes made outside the app (a sync tool, a network folder) and update the index. Cheap when nothing changed. */
  async refreshIndex(): Promise<void> {
    const o = this.open;
    if (o.single || o.config || o.docs) return;
    await o.index.reconcile();
  }

  /** The files in a page's folder that are not notes (images, documents ...), for the sub-page bar. */
  async listFiles(parent: string | null): Promise<FileItem[]> {
    const o = this.open;
    if (o.single || o.config) return [];
    const rel = parent === null ? '' : pageFolder(normalizePagePath(parent));
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(this.absDir(rel), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: FileItem[] = [];
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.') || isNoteFile(e.name) || isConflictName(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      const st = await fs.stat(this.absDir(p)).catch(() => null);
      out.push({ path: p, name: e.name, size: st?.size ?? 0 });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** The absolute path of any file inside the workspace (not only notes), for opening it elsewhere. */
  async filePath(rel: string): Promise<string> {
    if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((x) => x === '..')) throw Object.assign(new Error('Not a path inside the workspace'), { code: 'INVALID_PATH' });
    return this.absDir(rel);
  }

  private absDir(rel: string): string {
    return rel === '' ? this.open.root : path.join(this.open.root, ...rel.split('/'));
  }

  // ---------------------------------------------------------------- pages

  async readPage(p: string): Promise<PageData> {
    const page = normalizePagePath(p);
    try {
      const buf = await fs.readFile(this.abs(page));
      const mtimeMs = (await fs.stat(this.abs(page))).mtimeMs;
      const o = this.open;
      o.tracked.add(page);
      void o.history.add(page, utf8Text(buf), 'disk', mtimeMs).catch(() => {});
      return { path: page, exists: true, text: utf8Text(buf), hash: sha1(buf), mtimeMs };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') {
        await this.explainMissing(page, (e as NodeJS.ErrnoException).code ?? '');
        return { path: page, exists: false, text: '', hash: null };
      }
      log.error(`readPage failed page=${page}`, e);
      throw e;
    }
  }

  /**
   * A page the app asked for is not on disk. Say exactly what is and is not there, so a log shows whether the
   * folder, the file or the whole workspace went missing (a moved folder, an unmounted drive, a sync still catching up).
   */
  private async explainMissing(page: string, code: string): Promise<void> {
    const o = this.ws;
    if (!o) return;
    const file = this.abs(page);
    const dir = path.dirname(file);
    const exists = async (x: string): Promise<boolean> => fs.stat(x).then(() => true, () => false);
    const stem = pageFolder(page);
    let siblings = '';
    try {
      const names = await fs.readdir(dir);
      const base = path.basename(file).normalize('NFC');
      const near = names.filter((n) => n.normalize('NFC').toLowerCase() === base.toLowerCase());
      siblings = near.length > 0 ? ` same-name-different-spelling=${JSON.stringify(near)}` : ` dir-entries=${names.length}`;
    } catch {
      siblings = ' dir-unreadable';
    }
    log.warn(
      `readPage: ${code} page=${page} abs=${file} root-exists=${await exists(o.root)} dir-exists=${await exists(dir)} folder-of-pages-exists=${await exists(this.abs(stem))} ` +
        `index-knows-page=${o.index.getPage(page) !== null}${siblings}`,
    );
  }

  private noteOwnWrite(page: string, hash: string): void {
    const list = this.ownWrites.get(page) ?? [];
    if (list[list.length - 1] !== hash) list.push(hash);
    while (list.length > 16) list.shift();
    this.ownWrites.set(page, list);
  }

  private isOwnWrite(page: string, hash: string | null): boolean {
    return hash !== null && (this.ownWrites.get(page)?.includes(hash) ?? false);
  }

  /**
   * Saves of the same page never overlap: a save that was slow (and that the window gave up waiting for) must have
   * landed before the next one looks at the file, or the next one would mistake it for somebody else's edit.
   */
  writePage(p: string, text: string, baseHash: string | null, opts?: { deferIndex?: boolean }): Promise<WriteResult> {
    const page = normalizePagePath(p);
    const run = (this.writeChains.get(page) ?? Promise.resolve()).then(
      () => this.writePageNow(page, text, baseHash, opts?.deferIndex === true),
      () => this.writePageNow(page, text, baseHash, opts?.deferIndex === true),
    );
    const tail = run.catch(() => undefined);
    this.writeChains.set(page, tail);
    void tail.then(() => {
      if (this.writeChains.get(page) === tail) this.writeChains.delete(page);
    });
    return run;
  }

  private async writePageNow(page: string, text: string, baseHash: string | null, deferIndex: boolean): Promise<WriteResult> {
    const o = this.open;
    const file = this.abs(page);
    let diskHash: string | null = null;
    try {
      diskHash = sha1(await fs.readFile(file));
    } catch {
      /* new file */
    }
    if (diskHash === null && baseHash !== null) {
      // The file was loaded from disk, so it existed, and now it is gone: moved or deleted by another program.
      // Writing now would quietly bring back a file (and its folders) the person just took away; report it instead.
      log.info(`writePage: file vanished since it was read, not recreating it page=${page}`);
      return { ok: false, conflict: true, diskHash: null };
    }
    if (diskHash !== null && baseHash !== null && diskHash !== baseHash) {
      if (this.isOwnWrite(page, diskHash)) {
        // an earlier save of ours that the caller did not hear back about (it was slow): not another person's edit
        log.info(`writePage: disk holds an earlier save of this app, saving over it page=${page} (disk=${diskHash.slice(0, 8)} base=${baseHash.slice(0, 8)})`);
      } else {
        log.info(`writePage: disk changed since it was read, not saving page=${page} (disk=${diskHash.slice(0, 8)} base=${baseHash.slice(0, 8)})`);
        return { ok: false, conflict: true, diskHash };
      }
    }

    const data = utf8Bytes(text);
    const hash = sha1(data);
    this.recentWrites.set(page, hash);
    this.noteOwnWrite(page, hash);
    const tmp = `${file}.cave-tmp-${machine.pid()}`;
    let mode: number | undefined;
    try {
      mode = (await fs.stat(file)).mode & 0o7777;
    } catch {
      /* new */
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, data, mode === undefined ? undefined : { mode });
    await fs.rename(tmp, file);
    o.tracked.add(page);
    await o.history.add(page, text, 'saved').catch(() => {});
    if (deferIndex) this.refreshAfterSave(o, page);
    else {
      await timed(`writePage index refresh page=${page}`, () => o.index.refresh([page]), 1000);
      o.lookup = null;
      this.checkHidden(o);
      this.emit('index:updated', { path: page });
    }
    return { ok: true, hash };
  }

  /** Refresh one page's index entry without making a save wait for it. Several saves of a page share one refresh. */
  private refreshAfterSave(o: Open, page: string): void {
    if (this.refreshPending.has(page)) return; // the refresh reads the file when it runs, so it sees the newest text
    this.refreshPending.add(page);
    this.refreshQueue = this.refreshQueue.then(async () => {
      this.refreshPending.delete(page);
      if (this.ws !== o) return;
      try {
        await timed(`index refresh after save page=${page}`, () => o.index.refresh([page]), 1000);
      } catch (e) {
        log.warn(`index refresh after save failed page=${page}: ${(e as Error).message}`);
        return;
      }
      if (this.ws !== o) return;
      o.lookup = null;
      this.checkHidden(o);
      this.emit('index:updated', { path: page });
    });
  }

  /**
   * A `children:` block (or the workspace) can give a date attribute the value `$today`, or `$today+7d`. Inheritance can only hand
   * down fixed values, so the day is filled in here, once, when a page is made: the new page gets its own date, which then stays.
   */
  private async stampTodayDefaults(o: Open, created: string): Promise<void> {
    const rows = o.index.db.prepare("SELECT a.key AS key, a.text_value AS text FROM attrs a JOIN pages p ON p.id = a.page_id WHERE p.path = ?").all(created) as Array<{ key: string; text: string }>;
    const todo = rows.filter((r) => /^\$today(?:[+-]\d+[dwmy])?$/i.test(String(r.text).trim()));
    if (todo.length === 0) return;
    const now = new Date();
    let page = await this.readPage(created);
    for (const r of todo) {
      const m = /^\$today(?:([+-])(\d+)([dwmy]))?$/i.exec(String(r.text).trim());
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (m && m[2]) {
        const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
        const u = (m[3] ?? "d").toLowerCase();
        if (u === 'd') d.setDate(d.getDate() + n);
        else if (u === 'w') d.setDate(d.getDate() + 7 * n);
        else if (u === 'm') d.setMonth(d.getMonth() + n);
        else d.setFullYear(d.getFullYear() + n);
      }
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const text = setFrontmatterValue(page.text, r.key, iso);
      if (text === page.text) continue;
      const w = await this.writePage(page.path, text, page.hash);
      if (!w.ok) return;
      page = await this.readPage(created);
    }
    await o.index.refresh([created]);
  }

  async createPage(parent: string | null, name: string, content?: string, template?: string | null, mergeDefault?: boolean): Promise<string> {
    const o = this.open;
    const stem = normalizeName(name);
    // no text given: start from the template asked for (null: none), else the one the parents name for their sub-pages.
    // Text given by a view (mergeDefault): its attributes are laid over the default template's page.
    const ext = o.config && !o.docs ? configCreateExt(parent) : defaultNoteExt();
    let text = content;
    if ((text === undefined || mergeDefault) && template !== null && ext === defaultNoteExt()) {
      const want = template ?? (await defaultTemplateName(o.root, parent));
      const t = want ? await findTemplate(o.root, parent, want, this.appTemplates) : null;
      if (t) {
        const made = instantiate(t.text, name.trim() || stem);
        text = content === undefined ? made : mergeWithTemplate(made, content);
      }
    }
    const created = await o.tree.createPage(parent, stem, text ?? (ext === '.md' ? `# ${stem}\n\n` : ''), ext);
    await o.index.refresh([created]);
    await this.stampTodayDefaults(o, created);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    this.emit('index:updated', { path: created });
    return created;
  }

  /** The templates offered for sub-pages of `parent` (null = top level), and the one new sub-pages start from by default. */
  async templatesFor(parent: string | null): Promise<{ templates: Array<{ name: string; where: string }>; default: string | null }> {
    const o = this.open;
    const list: TemplateInfo[] = await listTemplates(o.root, parent, this.appTemplates);
    return {
      templates: list.map((t) => ({ name: t.name, where: t.abs ? 'the app' : t.rel.startsWith('.cave-notes/') ? 'the workspace' : t.rel })),
      default: await defaultTemplateName(o.root, parent),
    };
  }

  /** What `page` would contain if it were made from the template `name`. Nothing is written. */
  async templateText(page: string, name: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const o = this.open;
    const p = normalizePagePath(page);
    const t = await findTemplate(o.root, parentPage(p), name, this.appTemplates);
    if (!t) return { ok: false, error: `There is no template called “${name}” here.` };
    const row = this.getLookup().byPath.get(p);
    return { ok: true, text: instantiate(t.text, row?.title ?? pageName(p)) };
  }

  /** Where an embed points: the file and (for `@name`) the template found for the page it sits on. */
  private async embedSource(from: string, target: string, named: boolean): Promise<{ abs: string; rel: string | null } | { error: string }> {
    const o = this.open;
    const here = normalizePagePath(from);
    if (named) {
      const t = await findTemplate(o.root, parentPage(here), target, this.appTemplates);
      if (!t) return { error: `There is no block called “${target}” here.` };
      return { abs: t.abs ?? this.abs(t.rel), rel: t.abs || t.rel.startsWith('.cave-notes/') ? null : t.rel };
    }
    const r = await this.resolveLink({ syntax: 'wiki', target }, here);
    if (r.kind === 'page' && r.status === 'ok') return { abs: this.abs(r.path), rel: r.path };
    if (r.kind === 'page' && r.status === 'ambiguous') return { error: `“${target}” could mean several pages.` };
    return { error: `There is no page called “${target}”.` };
  }

  /** The text an embed `![[target#heading]]` placed on page `from` shows (and where it comes from). */
  async resolveEmbed(from: string, target: string, heading: string | null, named: boolean): Promise<{ ok: true; text: string; source: string } | { ok: false; error: string }> {
    const src = await this.embedSource(from, target, named);
    if ('error' in src) return { ok: false, error: src.error };
    let text: string;
    try {
      text = await fs.readFile(src.abs, 'utf8');
    } catch {
      return { ok: false, error: 'That file could not be read.' };
    }
    const r = embeddedText(text, heading);
    return r.ok ? { ok: true, text: r.text, source: src.rel ?? `${target}` } : { ok: false, error: r.error };
  }

  /** Change the source of an embed: the text under its heading (or the whole page body) becomes `text`. */
  async saveEmbed(from: string, target: string, heading: string | null, named: boolean, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const src = await this.embedSource(from, target, named);
    if ('error' in src) return { ok: false, error: src.error };
    let buf: Uint8Array;
    try {
      buf = await fs.readFile(src.abs);
    } catch {
      return { ok: false, error: 'That file could not be read.' };
    }
    const next = replaceEmbedded(utf8Text(buf), heading, text);
    if (next === null) return { ok: false, error: `There is no heading “${heading}” there.` };
    if (src.rel) {
      const w = await this.writePage(src.rel, next, sha1(buf));
      return w.ok ? { ok: true } : { ok: false, error: 'The page changed on disk meanwhile; try again.' };
    }
    try {
      await fs.access(src.abs);
    } catch {
      return { ok: false, error: 'That file is no longer there.' };
    }
    await fs.writeFile(src.abs, next);
    return { ok: true };
  }

  /** Is there a page or folder with this name where a page of that name would go? */
  async pageNameTaken(parent: string | null, name: string): Promise<boolean> {
    const o = this.open;
    const stem = normalizeName(name);
    const dir = parent === null ? '' : pageFolder(parent);
    const rel = (n: string): string => (dir ? `${dir}/${n}` : n);
    const exists = (r: string): Promise<boolean> => fs.stat(this.absDir(r)).then(() => true, () => false);
    if (await exists(rel(stem))) return true;
    for (const ext of [...new Set([defaultNoteExt(), '.md', '.txt'])]) if (await exists(rel(`${stem}${ext}`))) return true;
    void o;
    return false;
  }

  /** A page that gets the first free `Name.1`, `Name.2` … as its file name while its own text keeps the plain title. */
  async createPageNumbered(parent: string | null, name: string, content: string, mergeDefault?: boolean): Promise<string> {
    const o = this.open;
    const stem = normalizeName(name);
    let n = 1;
    while (await this.pageNameTaken(parent, `${stem}.${n}`)) n++;
    let text = content;
    if (mergeDefault) {
      const want = await defaultTemplateName(o.root, parent);
      const t = want ? await findTemplate(o.root, parent, want, this.appTemplates) : null;
      if (t) text = mergeWithTemplate(instantiate(t.text, name.trim() || stem), content);
    }
    const created = await o.tree.createPage(parent, `${stem}.${n}`, text);
    await o.index.refresh([created]);
    await this.stampTodayDefaults(o, created);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    this.emit('index:updated', { path: created });
    return created;
  }

  /**
   * A copy of a page (and of its sub-pages) next to it. The file name gets `.1` added, or its number goes up when it
   * ends in `.number` already, to the first one that is free; the text, title included, is copied exactly.
   */
  async duplicatePage(p: string): Promise<string> {
    const o = this.open;
    if (o.single) throw Object.assign(new Error('A file opened on its own cannot be duplicated here.'), { code: 'NO_WORKSPACE' });
    const page = normalizePagePath(p);
    const parent = parentPage(page);
    const ext = noteExtOf(page) ?? '';
    const stem = pageName(page);
    const m = /^(.*)\.(\d+)$/.exec(stem);
    const base = m ? m[1]! : stem;
    const dir = parent === null ? '' : pageFolder(parent);
    const rel = (name: string): string => (dir ? `${dir}/${name}` : name);
    const taken = async (name: string): Promise<boolean> =>
      (await fs.stat(this.absDir(rel(`${name}${ext}`))).then(() => true, () => false)) || (await fs.stat(this.absDir(rel(name))).then(() => true, () => false));
    let n = m ? Number(m[2]) + 1 : 1;
    while (await taken(`${base}.${n}`)) n++;
    const name = `${base}.${n}`;
    const created = rel(`${name}${ext}`);
    const hasFile = await fs.stat(this.absDir(page)).then((s) => s.isFile(), () => false);
    if (hasFile) await fs.copyFile(this.absDir(page), this.absDir(created), fs.constants.COPYFILE_EXCL);
    const folder = pageFolder(page);
    const copies: string[] = hasFile ? [created] : [];
    if (await fs.stat(this.absDir(folder)).then((s) => s.isDirectory(), () => false)) {
      const target = rel(name);
      await fs.cp(this.absDir(folder), this.absDir(target), { recursive: true, errorOnExist: true, force: false, filter: (src) => !path.basename(src).startsWith('.') });
      const walk = async (d: string): Promise<void> => {
        for (const e of await fs.readdir(this.absDir(d), { withFileTypes: true })) {
          const r = `${d}/${e.name}`;
          if (e.isDirectory() && !e.name.startsWith('.')) await walk(r);
          else if (e.isFile() && isNoteFile(e.name)) copies.push(r);
        }
      };
      await walk(target);
    }
    await o.index.refresh(copies.length ? copies : [created]);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    this.emit('index:updated', { path: created });
    return created;
  }

  /** Where a page lives on disk (for copying it, here or into another workspace). */
  async pageSource(p: string): Promise<PageSource> {
    const page = normalizePagePath(p);
    const file = this.absDir(page);
    const dir = this.absDir(pageFolder(page));
    const hasFile = await fs.stat(file).then((s) => s.isFile(), () => false);
    const hasDir = await fs.stat(dir).then((s) => s.isDirectory(), () => false);
    if (!hasFile && !hasDir) throw Object.assign(new Error(`Page not found: ${page}`), { code: 'NOT_FOUND' });
    return { name: pageName(page), ext: noteExtOf(page) ?? '', file: hasFile ? file : null, dir: hasDir ? dir : null };
  }

  /**
   * Copy a page (and everything under it) from `src` (see pageSource, possibly of another workspace) under `parent`
   * (null = the top level). A name that is taken gets `.1`, `.2` … Returns the new page's path.
   */
  async copyPageIn(src: PageSource, parent: string | null): Promise<string> {
    const o = this.open;
    if (o.single) throw Object.assign(new Error('A file opened on its own cannot receive pages.'), { code: 'NO_WORKSPACE' });
    if (parent !== null && (await o.tree.status(normalizePagePath(parent))) === null) throw Object.assign(new Error(`Destination not found: ${parent}`), { code: 'NOT_FOUND' });
    const dir = parent === null ? '' : pageFolder(normalizePagePath(parent));
    const rel = (name: string): string => (dir ? `${dir}/${name}` : name);
    const ext = src.ext || defaultNoteExt();
    const taken = async (name: string): Promise<boolean> =>
      (await fs.stat(this.absDir(rel(`${name}${ext}`))).then(() => true, () => false)) || (await fs.stat(this.absDir(rel(name))).then(() => true, () => false));
    let name = src.name;
    for (let n = 1; await taken(name); n++) name = `${src.name}.${n}`;
    const created = rel(`${name}${ext}`);
    await fs.mkdir(this.absDir(dir), { recursive: true });
    const copies: string[] = [];
    if (src.file) {
      await fs.copyFile(src.file, this.absDir(created), fs.constants.COPYFILE_EXCL);
      copies.push(created);
    }
    if (src.dir) {
      const target = rel(name);
      await fs.cp(src.dir, this.absDir(target), { recursive: true, errorOnExist: true, force: false, filter: (from) => !path.basename(from).startsWith('.') });
      const walk = async (d: string): Promise<void> => {
        for (const e of await fs.readdir(this.absDir(d), { withFileTypes: true })) {
          const r = `${d}/${e.name}`;
          if (e.isDirectory() && !e.name.startsWith('.')) await walk(r);
          else if (e.isFile() && isNoteFile(e.name)) copies.push(r);
        }
      };
      await walk(target);
    }
    await o.index.refresh(copies.length ? copies : [created]);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    this.emit('index:updated', { path: created });
    return created;
  }

  async importExternal(parent: string | null, srcAbs: string, actions: { same: 'move' | 'copy'; other: 'move' | 'copy' }): Promise<{ name: string; action: 'move' | 'copy' }> {
    const o = this.open;
    if (o.single) throw Object.assign(new Error('A file opened on its own cannot receive files.'), { code: 'NO_WORKSPACE' });
    if (parent !== null && (await o.tree.status(normalizePagePath(parent))) === null) throw Object.assign(new Error(`Destination not found: ${parent}`), { code: 'NOT_FOUND' });
    const st = await fs.stat(srcAbs);
    const dir = parent === null ? '' : pageFolder(normalizePagePath(parent));
    const destDir = this.absDir(dir);
    await fs.mkdir(destDir, { recursive: true });
    const srcDir = path.dirname(srcAbs);
    if (path.resolve(srcDir) === path.resolve(destDir)) throw Object.assign(new Error('It is already in that folder.'), { code: 'EXISTS' });
    if (st.isDirectory() && (path.resolve(destDir) + path.sep).startsWith(path.resolve(srcAbs) + path.sep)) throw Object.assign(new Error('A folder cannot go into itself.'), { code: 'INVALID' });
    const action = (await fs.stat(destDir)).dev === st.dev ? actions.same : actions.other;
    const ext = st.isFile() ? path.extname(srcAbs) : '';
    const stem = path.basename(srcAbs, ext);
    let name = `${stem}${ext}`;
    for (let n = 1; await fs.stat(path.join(destDir, name)).then(() => true, () => false); n++) name = `${stem}.${n}${ext}`;
    const dest = path.join(destDir, name);
    if (action === 'move') {
      try {
        await fs.rename(srcAbs, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        await fs.cp(srcAbs, dest, { recursive: true, errorOnExist: true, force: false });
        await fs.rm(srcAbs, { recursive: true, force: true });
      }
    } else await fs.cp(srcAbs, dest, { recursive: true, errorOnExist: true, force: false });
    const rel = (dir ? `${dir}/` : '') + name;
    const notes: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await fs.readdir(this.absDir(d), { withFileTypes: true })) {
        const r = `${d}/${e.name}`;
        if (e.isDirectory() && !e.name.startsWith('.')) await walk(r);
        else if (e.isFile() && isNoteFile(e.name)) notes.push(r);
      }
    };
    if (st.isDirectory()) await walk(rel);
    else if (isNoteFile(name)) notes.push(rel);
    if (notes.length) await o.index.refresh(notes);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parent] });
    this.emit('index:updated', { path: notes[0] ?? null });
    return { name, action };
  }

  async promoteVirtual(p: string, content?: string): Promise<string> {
    const o = this.open;
    const page = normalizePagePath(p);
    const stem = pageName(page);
    const done = await o.tree.promoteVirtual(page, content ?? (page.toLowerCase().endsWith('.md') ? `# ${stem}\n\n` : ''));
    await o.index.refresh([done]);
    o.lookup = null;
    this.emit('tree:changed', { parents: [parentPage(done)] });
    this.emit('index:updated', { path: done });
    return done;
  }

  // ---------------------------------------------------------------- moves, renames, delete

  async planMove(from: string, newParent: string | null, newName?: string): Promise<LinkPlan> {
    const o = this.open;
    // Moves are logged step by step at info level (not just debug): a move that fails or hangs is hard to reproduce.
    const t0 = performance.now();
    const rss = (): number => machine.rssMB();
    log.info(`move: planning ${from} -> ${newParent ?? '(top level)'}${newName === undefined ? '' : ` as ${newName}`} in ${o.root} (indexing ${o.indexingNow ? 'STILL RUNNING' : 'finished'}, rss ${rss()} MB)`);
    try {
      const plan = (await planMove({ tree: o.tree, index: o.index, from, newParent, ...(newName === undefined ? {} : { newName }), reconcile: false, onStep: (m: string) => log.info(`move: ${m}`) })) as LinkPlan;
      log.info(`move: planned in ${Math.round(performance.now() - t0)} ms${plan.noop ? ' (nothing to do)' : ''}, rss ${rss()} MB`);
      return plan;
    } catch (e) {
      const err = e as Error & { code?: string; details?: unknown };
      log.error(`move: planning ${from} -> ${newParent ?? '(top level)'} FAILED after ${Math.round(performance.now() - t0)} ms: ${err.code ?? ''} ${err.message}${err.details ? ` details=${JSON.stringify(err.details)}` : ''}`, err);
      throw e;
    }
  }

  async applyPlan(plan: LinkPlan): Promise<ApplyResult> {
    const o = this.open;
    const t0 = performance.now();
    let res: ApplyResult;
    try {
      res = (await applyPlan(plan, { tree: o.tree, index: o.index, journalDir: path.join(o.dataDir, 'journal'), onStep: (m: string) => log.info(`move: ${m}`) })) as ApplyResult;
    } catch (e) {
      const err = e as Error & { code?: string; details?: unknown; cause?: unknown };
      log.error(`move: applying ${plan.move.from} -> ${plan.move.to} FAILED after ${Math.round(performance.now() - t0)} ms: ${err.code ?? ''} ${err.message}${err.cause ? ` cause=${(err.cause as Error).message ?? String(err.cause)}` : ''}`, err);
      throw e;
    }
    o.lookup = null;
    const parents = new Set<string | null>([parentPage(plan.move.from), parentPage(plan.move.to)]);
    this.emit('tree:changed', { parents: [...parents] });
    this.emit('index:updated', { path: null });
    log.info(`move: applied ${plan.move.from} -> ${plan.move.to} in ${Math.round(performance.now() - t0)} ms (${res.filesEdited} file(s) edited, ${res.linksRewritten} link(s) rewritten)`);
    return res;
  }

  async undoLast(): Promise<{ id: string; restored: string[]; skipped: string[] }> {
    const o = this.open;
    const res = await undo({ tree: o.tree, index: o.index, journalDir: path.join(o.dataDir, 'journal') });
    o.lookup = null;
    this.emit('tree:changed', { parents: 'all' });
    this.emit('index:updated', { path: null });
    return res;
  }

  async lastMove(): Promise<{ id: string; from: string; to: string } | null> {
    const j = (await listJournal(this.open.root, { journalDir: path.join(this.open.dataDir, 'journal') })).find((x) => x.state === 'applied');
    return j ? { id: j.id, from: j.move.from, to: j.move.to } : null;
  }

  async deleteInfo(p: string): Promise<DeleteInfo> {
    const o = this.open;
    const page = normalizePagePath(p);
    const status = await o.tree.status(page);
    if (!status) throw Object.assign(new Error(`Page not found: ${page}`), { code: 'NOT_FOUND' });
    const pages = [page, ...(await o.tree.descendants(page)).map((d) => d.path)];
    const prefix = `${pageFolder(page)}/`;
    const inside = (x: string): boolean => x === page || x.startsWith(prefix);
    let backlinks = 0;
    for (const pg of pages) backlinks += o.index.backlinks(pg).filter((b) => !inside(b.fromPath)).length;

    const trash: string[] = [];
    if (status === 'page') trash.push(this.abs(page));
    const folder = this.abs(pageFolder(page));
    if (await fs.stat(folder).then((s) => s.isDirectory(), () => false)) trash.push(folder);
    return { trash, pages, backlinks };
  }

  async afterDelete(pages: string[]): Promise<void> {
    const o = this.open;
    await o.index.refresh(pages);
    o.lookup = null;
    const parents = new Set<string | null>(pages.map((x) => parentPage(x)));
    this.emit('tree:changed', { parents: [...parents] });
    this.emit('index:updated', { path: null });
  }

  // ---------------------------------------------------------------- reading the index

  async pageInfo(p: string): Promise<PageInfo | null> {
    const info = this.open.index.getPage(normalizePagePath(p));
    if (!info) return null;
    return { path: info.path, title: info.title, isVirtual: info.isVirtual, attributes: info.attributes, diagnostics: info.diagnostics };
  }

  async links(p: string): Promise<LinkInfo[]> {
    return this.open.index.links(normalizePagePath(p)) as LinkInfo[];
  }

  async backlinks(p: string): Promise<BacklinkInfo[]> {
    return this.open.index.backlinks(normalizePagePath(p));
  }

  private getLookup(): Lookup {
    const o = this.open;
    if (!o.lookup) {
      const rows = o.index.allPageRows();
      o.lookup = buildLookup(rows);
      o.rowsById = new Map(rows.map((r) => [r.id, r]));
    }
    return o.lookup;
  }

  async resolveLink(link: { syntax: 'md' | 'wiki'; target: string; fragment?: string | null }, fromPath: string): Promise<ResolvedLink> {
    const o = this.open;
    const from = normalizePagePath(fromPath);
    const fragment = link.fragment ?? null;

    let target = link.target;
    if (link.syntax === 'wiki') {
      const w = splitWorkspaceTarget(target);
      if (w) return { kind: 'workspace', workspace: w.workspace, target: w.target, fragment };
    }
    if (link.syntax === 'md') {
      const c = classifyDestination(link.target);
      if (c.kind === 'workspace') return { kind: 'workspace', workspace: c.workspace ?? '', target: c.target, fragment: c.fragment ?? fragment };
      if (c.kind === 'web') return { kind: 'web', url: c.url ?? link.target };
      if (c.kind === 'other') return { kind: 'other' };
      if (c.kind === 'file') {
        const abs = path.isAbsolute(c.target) ? c.target : path.resolve(o.root, ...posix.dirname(from).split('/'), c.target);
        return { kind: 'file', absPath: abs };
      }
      if (o.single) return { kind: 'file', absPath: path.resolve(o.root, ...posix.dirname(from).split('/').filter((x) => x !== '.'), c.target.replace(/^\//, '')) };
      target = c.target; // a page path (relative, or root-relative with a leading "/")
    }

    const lookup = this.getLookup();
    const fromRow = lookup.byPath.get(from);
    const r = resolvePageLink({ syntax: link.syntax, target, fragment }, from, fromRow, lookup);
    if (r.status === 'ok' && r.row) return { kind: 'page', status: 'ok', path: r.row.path, fragment };
    if (r.status === 'ambiguous') return { kind: 'page', status: 'ambiguous', name: target, candidates: r.candidates ?? [], fragment };
    return { kind: 'page', status: 'broken', name: pageName(target.endsWith('.md') || isNoteFile(target) ? target : `${target}.md`), fragment };
  }

  async suggestPages(query: string, limit = 12): Promise<PageSuggestion[]> {
    const db = this.open.index.db;
    const q = query.trim();
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = q
      ? db
          .prepare(
            `SELECT p.path, p.title, p.name,
                    (SELECT COUNT(*) FROM pages d WHERE lower(d.name) = lower(p.name)) AS dup
               FROM pages p
              WHERE p.title LIKE @c ESCAPE '\\' OR p.name LIKE @c ESCAPE '\\'
                 OR p.id IN (SELECT page_id FROM page_aliases WHERE alias LIKE @c ESCAPE '\\')
              ORDER BY (p.name LIKE @s ESCAPE '\\' OR p.title LIKE @s ESCAPE '\\') DESC, length(p.title), p.path
              LIMIT @limit`,
          )
          .all({ c: `%${esc}%`, s: `${esc}%`, limit })
      : db
          .prepare(
            `SELECT p.path, p.title, p.name, (SELECT COUNT(*) FROM pages d WHERE lower(d.name) = lower(p.name)) AS dup
               FROM pages p WHERE p.is_virtual = 0 ORDER BY p.mtime_ms DESC LIMIT @limit`,
          )
          .all({ limit });
    return rows.map((r: { path: string; title: string; name: string; dup: number }) => ({
      label: r.dup > 1 ? r.path.slice(0, -3) : r.name,
      path: r.path,
      title: r.title,
    }));
  }

  /**
   * The pages shown in the tree whose title or file name contain every word of the query (words in "quotes" stay together),
   * as tree paths, in tree order. For the tree's own find box.
   */
  async findPagePaths(query: string, limit = 200): Promise<string[]> {
    const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2] ?? '').trim()).filter(Boolean);
    if (!terms.length) return [];
    const db = this.open.index.db;
    const where = terms.map((_, i) => `(p.title LIKE @t${i} ESCAPE '\\' OR p.name LIKE @t${i} ESCAPE '\\')`).join(' AND ');
    const args: Record<string, string | number> = { limit: limit * 2 };
    terms.forEach((t, i) => (args[`t${i}`] = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
    const rows = db.prepare(`SELECT p.path FROM pages p WHERE p.is_virtual = 0 AND ${where} ORDER BY p.path LIMIT @limit`).all(args) as Array<{ path: string }>;
    const out: string[] = [];
    for (const r of rows) {
      // only pages the tree shows (not hidden or unlisted ones)
      if ((await this.treeAnchor(r.path)) === r.path) out.push(r.path);
      if (out.length >= limit) break;
    }
    return out;
  }

  async search(query: string, opts: { limit?: number; offset?: number } = {}): Promise<SearchResponse> {
    const r = this.open.index.search(query, { ...opts, hideFrom: 'search' }); // `hidden: search` keeps a page out of here
    return { results: r.results, total: r.total, errors: r.errors };
  }

  // ---------------------------------------------------------------- search and replace

  private replaceOptions(r: ReplaceRequest): ReplaceOptions {
    const kinds = r.kinds.filter((k): k is ReplaceKind => (REPLACE_KINDS as string[]).includes(k));
    return { find: r.find, replace: r.replace, regex: r.regex, matchCase: r.matchCase, wholeWord: r.wholeWord, kinds, names: r.names };
  }

  /** The pages a replace looks at: those the search picks, or every page that is a file of its own. */
  private replacePaths(r: ReplaceRequest): string[] {
    const o = this.open;
    if (r.pages.trim() !== '') {
      const found = o.index.search(r.pages, { limit: 5000, count: false }) as { results: Array<{ path: string; isVirtual: boolean; isFile: boolean }> };
      return found.results.filter((x) => !x.isVirtual && !x.isFile).map((x) => x.path);
    }
    return (o.index.db.prepare('SELECT path FROM pages WHERE is_virtual = 0 ORDER BY path').all() as Array<{ path: string }>).map((x) => x.path);
  }

  async replaceFind(req: ReplaceRequest): Promise<ReplaceFound> {
    const o = this.replaceOptions(req);
    const c = compileFind(o);
    if (c && 'error' in c) return { pages: [], total: 0, truncated: false, error: c.error };
    if (!c) return { pages: [], total: 0, truncated: false, error: null };
    const paths = this.replacePaths(req);
    const pages: ReplacePage[] = [];
    let total = 0;
    let truncated = false;
    const LIMIT = 5000;
    let next = 0;
    const work = async (): Promise<void> => {
      while (next < paths.length && !truncated) {
        const path = paths[next++]!;
        let text = '';
        try {
          text = utf8Text(await fs.readFile(this.abs(path)));
        } catch {
          continue; // gone since the index saw it
        }
        const matches = o.kinds.length ? findMatches(text, o, LIMIT) : [];
        const rename = o.names ? matchName(pageName(path), o) : null;
        if (matches.length === 0 && rename === null) continue;
        total += matches.length + (rename === null ? 0 : 1);
        pages.push({ path, title: pageName(path), matches, rename });
        if (total >= LIMIT) truncated = true;
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    pages.sort((a, b) => a.path.localeCompare(b.path));
    return { pages, total, truncated, error: null };
  }

  async replaceApply(req: ReplaceRequest, choices: ReplaceChoice[]): Promise<ReplaceDone> {
    const o = this.replaceOptions(req);
    const done: ReplaceDone = { matches: 0, pages: 0, renamed: 0, failed: [] };
    if (!compileFind(o) || 'error' in (compileFind(o) as object)) return done;
    for (const ch of choices) {
      if (!o.kinds.length || (ch.matches !== null && ch.matches.length === 0)) continue;
      try {
        const page = await this.readPage(ch.path);
        if (!page.exists) continue;
        const r = applyMatches(page.text, o, ch.matches === null ? null : new Set(ch.matches));
        if (r.count === 0) continue;
        const w = await this.writePage(ch.path, r.text, page.hash);
        if (w.ok) {
          done.matches += r.count;
          done.pages++;
        } else done.failed.push(`${ch.path}: the page changed while this was going on, so it was left alone`);
      } catch (e) {
        done.failed.push(`${ch.path}: ${(e as Error).message}`);
      }
    }
    // names last, the deepest pages first (renaming a page moves the pages under it)
    const renames = choices.filter((c) => c.rename).sort((a, b) => b.path.split('/').length - a.path.split('/').length);
    for (const ch of renames) {
      const next = matchName(pageName(ch.path), o);
      if (next === null || next.trim() === '') continue;
      try {
        const plan = await this.planMove(ch.path, parentPage(ch.path), next);
        if (!plan.noop) {
          await this.applyPlan(plan);
          done.renamed++;
        }
      } catch (e) {
        done.failed.push(`${ch.path}: ${(e as Error).message}`);
      }
    }
    return done;
  }

  async attributeKeys(): Promise<AttributeKey[]> {
    return this.open.index.attributeKeys();
  }

  async attributeValues(key: string, query = ''): Promise<Array<{ value: string; type: string; count: number }>> {
    return this.open.index.attributeValues(key, { query });
  }

  async queryView(query: string, attrs: string[] | null, limit = 200, offset = 0, colorRules: Array<{ when: string; color: string }> | null = []): Promise<ViewData> {
    const o = this.open;
    const colors = colorRules ?? []; // an argument left out arrives as null over the wire, which a default value does not catch
    const r = o.index.search(query, { limit: Math.max(1, Math.min(1000, limit)), offset: Math.max(0, offset) });
    const want = attrs ? new Set(attrs) : null;
    const rows = r.results.map((x: { path: string; title: string; isVirtual: boolean; mtimeMs: number }) => {
      const info = o.index.getPage(x.path);
      const out: ViewData['rows'][number]['attrs'] = {};
      if (info) {
        for (const [k, v] of Object.entries(info.attributes)) {
          if (!want || want.has(k)) out[k] = v.map((e) => ({ type: e.type, text: e.text, num: e.num ?? null }));
        }
      }
      // every page has a file name and type, though nobody wrote them anywhere
      if (!x.isVirtual) {
        const name = x.path.split('/').pop() ?? x.path;
        if (!want || want.has('filename')) out.filename = [{ type: 'string', text: name, num: null }];
        const dot = name.lastIndexOf('.');
        if (dot > 0 && (!want || want.has('filetype'))) out.filetype = [{ type: 'string', text: name.slice(dot + 1).toLowerCase(), num: null }];
      }
      return { path: x.path, title: x.title, isVirtual: x.isVirtual, mtimeMs: x.mtimeMs, attrs: out } as ViewData['rows'][number];
    });
    if (o.index.relations.length > 0 && rows.length > 0) {
      const related = o.index.relatedFor(rows.map((x) => x.path));
      for (const row of rows) if (related[row.path]) row.related = related[row.path];
    }
    // colour rules: a page takes the colour of the first rule whose query it also matches
    if (colors.length > 0 && rows.length > 0) {
      const base = query.replace(/(^|\s)sort:\S+/g, ' ').trim();
      const shown = new Set(rows.map((x) => x.path));
      const left = new Set(shown);
      for (const rule of colors) {
        if (left.size === 0) break;
        const hit = o.index.search(`(${base}) (${rule.when})`, { limit: 5000 });
        for (const m of hit.results as Array<{ path: string }>) {
          if (!left.has(m.path)) continue;
          left.delete(m.path);
          const row = rows.find((x) => x.path === m.path);
          if (row) (row as { color?: string }).color = rule.color;
        }
      }
    }
    return { rows, total: r.total, errors: r.errors, ...(colors.length > 0 ? {} : {}) };
  }

  /** The text of one section as it is written in the file that has it (comments kept); put together from several files when more than one has it. */
  private async sectionText(dir: string, cfg: Awaited<ReturnType<typeof readSettings>>, key: string): Promise<string> {
    const owners = cfg.owners[key] ?? [];
    if (owners.length === 0) return '';
    const show = (v: unknown): string => (v === undefined || v === null ? '' : `${YAML.stringify(v, { lineWidth: 0 }).trimEnd()}\n`);
    if (owners.length > 1) return show(cfg.sections[key]);
    const doc = YAML.parseDocument(await fs.readFile(path.join(dir, owners[0]!), 'utf8').catch(() => ''));
    const node = doc.get(key, true);
    if (node === undefined || node === null) return '';
    return `${(YAML.isNode(node) ? new YAML.Document(node.clone()).toString({ lineWidth: 0 }) : YAML.stringify(node, { lineWidth: 0 })).trimEnd()}\n`;
  }

  /** Put a section (a parsed YAML node, or null to remove it) into the file that has it. A section spread over several files is gathered into the first. */
  private async putSection(dir: string, key: string, node: unknown | null): Promise<void> {
    const cfg = await readSettings(dir);
    const owners = cfg.owners[key] ?? [];
    if (node === null) {
      for (const name of owners) await editYaml(path.join(dir, name), (doc) => doc.delete(key));
      return;
    }
    await editSection(dir, key, (doc) => doc.set(key, node));
    for (const name of owners.filter((n) => n !== homeFor(cfg, key))) await editYaml(path.join(dir, name), (doc) => doc.delete(key));
  }

  /** The YAML behind Workspace Preferences: sections of the settings files (which file holds which does not matter). */
  async getWorkspaceYaml(): Promise<Record<YamlSection, string>> {
    const dir = infoPath(this.open.root);
    const cfg = await readSettings(dir);
    const part = (key: string): Promise<string> => this.sectionText(dir, cfg, key);
    const indent = (t: string): string => `${t.replace(/^(?=.)/gm, '  ').trimEnd()}\n`;
    const settings = await part('settings');
    const rules = await part('rules');
    return {
      attributes: await part('attributes'),
      files: await part('files'),
      queries: await part('queries'),
      relations: await part('relations'),
      schema: await part('schema'),
      automations: [settings && `settings:\n${indent(settings)}`, rules && `rules:\n${indent(rules)}`].filter(Boolean).join(''),
    };
  }

  /** The styles for exporting pages that this workspace keeps (the `export-style` section), as the text of that section. */
  async getExportStyles(): Promise<string> {
    const dir = infoPath(this.open.root);
    return this.sectionText(dir, await readSettings(dir), 'export-style');
  }

  /** The export style sets other workspaces share (`export-style: !global`) and this one takes, as YAML text. */
  async getInheritedExportStyles(): Promise<string> {
    const m = this.open.inheritedExport;
    return m && Object.keys(m).length ? YAML.stringify(m) : '';
  }

  async setExportStyles(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const o = this.open;
    if (o.single || o.config) return { ok: false, error: 'There is no workspace to keep this in here.' };
    const { errors } = parseStyleSetsYaml(text);
    if (errors.length > 0) return { ok: false, error: errors[0]! };
    const parsed = YAML.parseDocument(text);
    await this.putSection(infoPath(o.root), 'export-style', text.trim() === '' || parsed.contents === null ? null : parsed.contents);
    return { ok: true };
  }

  /** Save one of them. Text that is not YAML (or not the right kind of YAML) is refused with the reason, and nothing is written. */
  async setWorkspaceYaml(section: YamlSection, text: string): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
    const o = this.open;
    if (o.single || o.config) return { ok: false, error: 'There is no workspace to keep this in here.' };
    const parsed = YAML.parseDocument(text);
    if (parsed.errors.length > 0) {
      const e = parsed.errors[0]!;
      const at = e.linePos?.[0] ? ` (line ${e.linePos[0].line})` : '';
      return { ok: false, error: `${e.message.split('\n')[0]}${at}` };
    }
    const blank = text.trim() === '' || parsed.contents === null;
    if (section === 'relations') {
      if (!blank && !YAML.isSeq(parsed.contents)) return { ok: false, error: 'Relations are a list: each starts with a dash (- name: …).' };
    } else if (!blank && !YAML.isMap(parsed.contents)) return { ok: false, error: 'This has to be a list of names with values (name: value).' };
    const dir = infoPath(o.root);
    if (section === 'automations') {
      // the rules and the engine's settings: `rules:` and `settings:`
      const map = blank ? null : (parsed.contents as YAML.YAMLMap);
      for (const item of map?.items ?? []) {
        const k = String((item.key as { value?: unknown })?.value ?? item.key);
        if (k !== 'rules' && k !== 'settings') return { ok: false, error: `“${k}” is not something automations has: only rules: and settings: go here.` };
      }
      await this.putSection(dir, 'rules', map?.get('rules', true) ?? null);
      await this.putSection(dir, 'settings', map?.get('settings', true) ?? null);
      await this.ensureAutomation(o);
      return { ok: true };
    }
    // the box holds what goes under the section's name; the whole `schema:` block pasted in is understood too
    let contents: unknown = blank ? null : parsed.contents;
    if (!blank && section !== 'relations' && YAML.isMap(parsed.contents) && parsed.contents.items.length === 1) {
      const only = parsed.contents.items[0]!;
      if (String((only.key as { value?: unknown })?.value ?? only.key) === section && YAML.isMap(only.value)) contents = only.value;
    }
    await this.putSection(dir, section, contents);
    const r = await this.reloadSchemas(o);
    o.lookup = null;
    this.emit('index:updated', { path: null });
    const warning = section === 'schema' && r.warnings?.length ? r.warnings.slice(0, 3).join('; ') : undefined;
    return warning ? { ok: true, warning } : { ok: true };
  }

  async savedQueries(): Promise<SavedQueries> {
    const idx = this.open.index;
    return { queries: idx.savedQueries, relations: idx.relations, warnings: idx.globalsWarnings };
  }

  async saveQuery(name: string, query: string): Promise<SavedQueries> {
    const o = this.open;
    const clean = name.trim();
    if (o.single || o.config) throw Object.assign(new Error('There is no workspace to keep queries in here.'), { code: 'NO_WORKSPACE' });
    if (!clean || /["\\\n]/.test(clean)) throw Object.assign(new Error('Give the query a name without quotation marks or backslashes.'), { code: 'BAD_NAME' });
    await editSection(infoPath(o.root), 'queries', (doc) => {
      const current = doc.get('queries');
      if (current && typeof (current as { items?: unknown }).items !== 'undefined') {
        for (const pair of [...((current as { items: Array<{ key: { value?: unknown } }> }).items)]) {
          if (String(pair.key?.value ?? '').toLowerCase() === clean.toLowerCase()) doc.deleteIn(['queries', pair.key.value]);
        }
      }
      doc.setIn(['queries', clean], query.trim());
    });
    await o.index.reloadSchema();
    this.emit('index:updated', { path: null });
    return this.savedQueries();
  }

  /** Fill a page that already has content from a template: what the page has stays, the template adds what is missing. */
  async mergeTemplateInto(page: string, name: string): Promise<WriteResult> {
    const t = await this.templateText(page, name);
    if (!t.ok) throw Object.assign(new Error(t.error), { code: 'NO_TEMPLATE' });
    const pg = await this.readPage(page);
    if (!pg.exists) throw Object.assign(new Error('This page has no file yet. Create the page first.'), { code: 'NO_FILE' });
    const text = mergeWithTemplate(t.text, pg.text);
    if (text === pg.text) return { ok: true, hash: pg.hash ?? '' };
    return this.writePage(pg.path, text, pg.hash);
  }

  async templateAttributes(page: string, name: string): Promise<{ ok: true; attrs: Record<string, AttrValue> } | { ok: false; error: string }> {
    const r = await this.templateText(page, name);
    if (!r.ok) return r;
    const m = FRONTMATTER.exec(r.text);
    const raw = m?.[1] ? (YAML.parse(m[1]) as unknown) : null;
    const attrs: Record<string, AttrValue> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (k === 'template' || k === 'files' || !/^[A-Za-z_][\w-]*$/.test(k) || v === null || v === undefined) continue;
        attrs[k] = v as AttrValue;
      }
    }
    return { ok: true, attrs };
  }

  /** The page whose own folder holds `dir` (the page that lists the files of that folder), or null. */
  private pageOfFolder(dir: string): string | null {
    for (const [p, row] of this.getLookup().byPath) if (!(row as { isVirtual?: boolean }).isVirtual && pageFolder(p) === dir) return p;
    return null;
  }

  /**
   * Give a file that is not a note attributes, by writing them into the `files:` block of `page` (a null value
   * takes one away). A bare name is used when the file sits in the page's own folder, else a path from the workspace root.
   */
  async setFileAttributes(page: string, filePath: string, attrs: Record<string, AttrValue | null>): Promise<WriteResult> {
    for (const k of Object.keys(attrs)) {
      if (!/^[A-Za-z_][\w-]*$/.test(k)) throw Object.assign(new Error(`"${k}" is not a valid attribute name.`), { code: 'BAD_ATTRIBUTE' });
    }
    const pg = await this.readPage(page);
    if (!pg.exists) throw Object.assign(new Error('This page has no file yet. Create the page first.'), { code: 'NO_FILE' });
    const text = setFileEntryText(pg.text, fileKeyCandidates(pg.path, filePath), attrs);
    if (text === pg.text) return { ok: true, hash: pg.hash ?? '' };
    return this.writePage(pg.path, text, pg.hash);
  }

  /**
   * Move a file that is not a note into the folder of page `newParent` (null: the top level). Its attributes, when a
   * page lists them in a `files:` block, move with it: the entry goes from the page that listed it to the new parent
   * page (or to workspace.yaml for the top level). Returns the new path and whether the attributes came along.
   */
  async moveFile(filePath: string, newParent: string | null): Promise<{ path: string; attributes: 'none' | 'moved' | 'left' }> {
    const o = this.open;
    const from = filePath.replace(/^\/+/, '');
    const name = from.split('/').pop()!;
    const toDir = newParent === null ? '' : pageFolder(normalizePagePath(newParent));
    const to = toDir ? `${toDir}/${name}` : name;
    if (to === from) return { path: from, attributes: 'none' };
    if (await fs.stat(this.absDir(to)).then(() => true, () => false)) throw Object.assign(new Error(`There is already a file called “${name}” there.`), { code: 'EXISTS' });
    if (isNoteFile(name)) throw Object.assign(new Error('This is a note: move it as a page.'), { code: 'IS_NOTE' });

    // find the attributes first, while the file is still where its page expects it
    const oldDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const oldPage = oldDir ? this.pageOfFolder(oldDir) : null;
    let carried: Record<string, unknown> | null = null;
    let carriedFrom: string | null = null;
    for (const cand of oldPage ? [oldPage] : []) {
      const pg = await this.readPage(cand);
      const found = pg.exists ? readFileEntry(pg.text, fileKeyCandidates(pg.path, from)) : null;
      if (found) {
        carried = found;
        carriedFrom = pg.path;
      }
    }

    await fs.mkdir(this.absDir(toDir), { recursive: true });
    try {
      await fs.rename(this.absDir(from), this.absDir(to));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
      await fs.copyFile(this.absDir(from), this.absDir(to), fs.constants.COPYFILE_EXCL);
      await fs.unlink(this.absDir(from));
    }

    let attributes: 'none' | 'moved' | 'left' = 'none';
    if (carried && carriedFrom) {
      attributes = 'left';
      try {
        const nulls = Object.fromEntries(Object.keys(carried).map((k) => [k, null as AttrValue | null]));
        const src = await this.readPage(carriedFrom);
        const cleared = setFileEntryText(src.text, fileKeyCandidates(src.path, from), nulls);
        if (newParent === null) {
          await editSection(infoPath(o.root), 'files', (doc) => {
            for (const [k, v] of Object.entries(carried!)) doc.setIn(['files', to, k], v);
          });
          await this.writePage(src.path, cleared, src.hash);
          attributes = 'moved';
        } else {
          const dest = await this.readPage(newParent);
          if (dest.exists) {
            const withIt = setFileEntryText(dest.text, fileKeyCandidates(dest.path, to), carried as Record<string, AttrValue | null>);
            const w = await this.writePage(dest.path, withIt, dest.hash);
            if (w.ok) {
              await this.writePage(src.path, cleared, src.hash);
              attributes = 'moved';
            }
          }
        }
      } catch {
        attributes = 'left';
      }
    }
    await o.index.refresh([...(oldPage ? [oldPage] : []), ...(newParent ? [normalizePagePath(newParent)] : [])]).catch(() => undefined);
    this.emit('index:updated', { path: null });
    return { path: to, attributes };
  }

  async setAttribute(p: string, key: string, value: AttrValue | null): Promise<WriteResult> {
    if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(key)) throw Object.assign(new Error(`"${key}" is not a valid attribute name.`), { code: 'BAD_ATTRIBUTE' });
    const page = await this.readPage(p);
    if (!page.exists) throw Object.assign(new Error('This page has no file yet. Create the page first.'), { code: 'NO_FILE' });
    const text = setFrontmatterValue(page.text, key, value);
    if (text === page.text) return { ok: true, hash: page.hash ?? '' };
    return this.writePage(page.path, text, page.hash);
  }

  /** The pages of a saved query. */
  private savedMembers(name: string): Set<string> {
    return new Set(this.open.index.search(`saved:${JSON.stringify(name)}`, { limit: 5000, count: false }).results.map((r: { path: string }) => r.path));
  }

  private relationNamed(name: string): ReturnType<Index['relations']['find']> {
    const l = name.toLowerCase();
    return this.open.index.relations.find((r) => r.name.toLowerCase() === l || (r.backname ?? r.reverse ?? '').toLowerCase() === l);
  }

  async editRelation(req: RelationEditRequest): Promise<RelationEditResult> {
    const o = this.open;
    const rel = this.relationNamed(req.relation);
    if (!rel) return { ok: false, error: `There is no relation called “${req.relation}”.` };
    const cache = new Map<string, Set<string>>();
    const ownName = path.basename(o.root);
    const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
    // the other workspaces on this computer, by name: a page named in one is found by its file
    const others = new Map((req.workspaces ?? []).filter((w) => !sameName(w.name, ownName)).map((w) => [w.name.toLowerCase(), w]));
    const exts = ['', '.md', '.markdown', '.txt'];
    const foreignInfo = (key: string): { name: string; root: string; path: string } | null => {
      const f = foreignParts(key);
      const w = f ? others.get(f.workspace) : undefined;
      return f && w ? { name: w.name, root: w.root, path: f.path } : null;
    };
    const foreignAbs = (i: { root: string; path: string }): string => path.join(i.root, ...i.path.split('/'));
    const localResolve = (ref: string): { path: string; title: string } | null => {
      const row = o.index.resolveRef(ref);
      return row ? { path: row.path, title: row.title } : null;
    };
    /** a page of another workspace, found by its path there (a plain name cannot be looked up without that workspace's index) */
    const foreignResolve = (workspace: string, target: string): { path: string; title: string } | null => {
      const w = others.get(workspace.trim().toLowerCase());
      if (!w) return null;
      const rest = target.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (!rest || rest.split('/').includes('..')) return null;
      for (const ext of exts) {
        const p = `${rest}${ext}`;
        try {
          if (fsSync.statSync(path.join(w.root, ...p.split('/'))).isFile()) return { path: foreignKey(w.name, p), title: pageName(p) };
        } catch {
          /* not that one */
        }
      }
      return null;
    };
    const noExt = (p: string): string => p.replace(/\.(md|markdown|txt)$/i, '');

    // ---- pages that are not notes (an .odt, a PDF ...): their attributes are not in the file but in the `files:` block of the page
    // of the folder they are in, or in the workspace settings for a file at the top. A relation reads and writes them there.
    interface Where { root: string; rel: string; foreign: boolean }
    interface Home { note: string | null; notePath: string | null; names: string[]; yamlDir: string | null }
    const whereOf = (p: string): Where | null => {
      if (foreignParts(p)) {
        const i = foreignInfo(p);
        return i ? { root: i.root, rel: i.path, foreign: true } : null;
      }
      return { root: o.root, rel: p, foreign: false };
    };
    const isFileAt = (w: Where): boolean => !isNoteFile(w.rel.split('/').pop() ?? '');
    const fileHome = async (w: Where): Promise<Home | null> => {
      const dir = w.rel.includes('/') ? w.rel.slice(0, w.rel.lastIndexOf('/')) : '';
      if (dir === '') return { note: null, notePath: null, names: [w.rel, `/${w.rel}`], yamlDir: infoPath(w.root) };
      const local = w.foreign ? null : this.pageOfFolder(dir);
      for (const rel of local ? [local] : ['.md', '.markdown', '.txt'].map((e) => `${dir}${e}`)) {
        const abs = path.join(w.root, ...rel.split('/'));
        if (await fs.stat(abs).then((st) => st.isFile(), () => false)) return { note: abs, notePath: rel, names: fileKeyCandidates(rel, w.rel), yamlDir: null };
      }
      return null;
    };
    const entryOf = async (home: Home): Promise<{ entry: Record<string, unknown>; text: string | null }> => {
      if (home.note) {
        const text = await fs.readFile(home.note, 'utf8');
        return { entry: readFileEntry(text, home.names) ?? {}, text };
      }
      const files = (await readSections(home.yamlDir!)).files as Record<string, unknown> | undefined;
      const hit = files && typeof files === 'object' ? home.names.find((n) => files[n] && typeof files[n] === 'object') : undefined;
      return { entry: hit ? ({ ...(files![hit] as object) } as Record<string, unknown>) : {}, text: null };
    };
    /** the attributes of the file as the front matter of a page, which is what the relation code reads and changes */
    const asFrontmatter = (entry: Record<string, unknown>): string => (Object.keys(entry).length === 0 ? '---\n---\n' : `---\n${YAML.stringify(entry)}---\n`);
    // (the hash is of the file's own attributes, so that two files of one folder can be changed in one go)
    const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, stable(x)])) : v);
    const entryHash = (entry: Record<string, unknown>): string => sha1(utf8Bytes(JSON.stringify(stable(entry))));
    const readFileSide = async (w: Where): Promise<{ exists: boolean; text: string; hash: string | null }> => {
      const home = await fileHome(w);
      if (!home) return { exists: false, text: '', hash: null };
      if (!w.foreign && !(await fs.stat(this.abs(w.rel)).then(() => true, () => false))) return { exists: false, text: '', hash: null };
      if (w.foreign && !(await fs.stat(path.join(w.root, ...w.rel.split('/'))).then(() => true, () => false))) return { exists: false, text: '', hash: null };
      const { entry } = await entryOf(home);
      return { exists: true, text: asFrontmatter(entry), hash: entryHash(entry) };
    };
    const writeFileSide = async (w: Where, text: string, base: string | null): Promise<{ ok: boolean; hash?: string; conflict?: boolean }> => {
      const home = await fileHome(w);
      if (!home) return { ok: false };
      try {
        const cur = await entryOf(home);
        if (base !== null && entryHash(cur.entry) !== base) return { ok: false, conflict: true };
        const m = FRONTMATTER.exec(text);
        const parsed = m?.[1] ? (YAML.parse(m[1]) as unknown) : {};
        const next = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        const diff: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(cur.entry[k])) diff[k] = v;
        for (const k of Object.keys(cur.entry)) if (!(k in next)) diff[k] = null;
        if (Object.keys(diff).length === 0) return { ok: true, hash: entryHash(cur.entry) };
        if (home.note) {
          const buf = await fs.readFile(home.note);
          const out = setFileEntryText(utf8Text(buf), home.names, diff);
          if (w.foreign) {
            const data = utf8Bytes(out);
            const mode = (await fs.stat(home.note)).mode & 0o7777;
            const tmp = `${home.note}.cave-tmp-${machine.pid()}`;
            await fs.writeFile(tmp, data, { mode });
            await fs.rename(tmp, home.note);
          } else {
            const r = await this.writePage(home.notePath!, out, sha1(buf));
            if (!r.ok) return { ok: false, conflict: true };
          }
        } else {
          const key = home.names.find((n) => n in cur.entry) ?? home.names[0]!;
          const files = (await readSections(home.yamlDir!)).files as Record<string, unknown> | undefined;
          const at = files ? (home.names.find((n) => files[n] && typeof files[n] === 'object') ?? key) : key;
          await editSection(home.yamlDir!, 'files', (doc) => {
            for (const [k, v] of Object.entries(diff)) {
              if (v === null) doc.deleteIn(['files', at, k]);
              else doc.setIn(['files', at, k], v);
            }
            const entry = doc.getIn(['files', at], true);
            if (YAML.isMap(entry) && entry.items.length === 0) doc.deleteIn(['files', at]);
            const all = doc.get('files', true);
            if (YAML.isMap(all) && all.items.length === 0) doc.delete('files');
          });
        }
        return { ok: true, hash: entryHash(next) };
      } catch {
        return { ok: false };
      }
    };
    const host: RelationHost = {
      members: (name) => cache.get(name) ?? cache.set(name, this.savedMembers(name)).get(name)!,
      resolve: (ref, within) => {
        const w = splitWorkspaceTarget(ref);
        if (w) return sameName(w.workspace, ownName) ? localResolve(w.target) : foreignResolve(w.workspace, w.target);
        return within ? foreignResolve(within, ref) : localResolve(ref);
      },
      titleOf: (p) => (foreignParts(p) ? pageName(foreignParts(p)!.path) : ((o.index.getPage(p)?.title as string | undefined) ?? pageName(p))),
      describe: (p) => {
        const f = foreignInfo(p);
        if (f) return { path: p, title: pageName(f.path), workspace: f.name };
        return { path: p, title: (o.index.getPage(p)?.title as string | undefined) ?? pageName(p) };
      },
      linkFor: (p, within) => {
        const f = foreignInfo(p);
        if (f) return sameName(within ?? '', f.name) ? `[[${noExt(f.path)}]]` : `[[${f.name}::${noExt(f.path)}]]`;
        // a page of this workspace, written in a file of another one: its path, with this workspace's name in front
        if (within) return `[[${ownName}::${noExt(p)}]]`;
        // a file that is not a note is linked by its path, with its extension
        if (!isNoteFile(p.split('/').pop() ?? '')) return `[[${p}]]`;
        const name = pageName(p);
        const hit = o.index.resolveRef(name);
        return `[[${hit?.path === p ? name : p.replace(/\.[^./]+$/, '')}]]`;
      },
      read: async (p) => {
        const w = whereOf(p);
        if (w && isFileAt(w)) return readFileSide(w);
        const f = foreignParts(p);
        let abs: string;
        if (f) {
          const info = foreignInfo(p);
          if (!info) return { exists: false, text: '', hash: null };
          abs = foreignAbs(info);
        } else abs = this.abs(normalizePagePath(p));
        try {
          const buf = await fs.readFile(abs);
          return { exists: true, text: utf8Text(buf), hash: sha1(buf) };
        } catch {
          return { exists: false, text: '', hash: null };
        }
      },
      write: async (p, text, base) => {
        const w = whereOf(p);
        if (w && isFileAt(w)) return writeFileSide(w, text, base);
        const info = foreignInfo(p);
        if (foreignParts(p)) {
          if (!info) return { ok: false };
          // a file of another workspace: written in place, and only if it is still what was read (that workspace sees the change as it sees any other)
          const file = foreignAbs(info);
          try {
            const now = sha1(await fs.readFile(file));
            if (base !== null && now !== base) return { ok: false, conflict: true };
            const data = utf8Bytes(text);
            const mode = (await fs.stat(file)).mode & 0o7777;
            const tmp = `${file}.cave-tmp-${machine.pid()}`;
            await fs.writeFile(tmp, data, { mode });
            await fs.rename(tmp, file);
            return { ok: true, hash: sha1(data) };
          } catch {
            return { ok: false };
          }
        }
        const r = await this.writePage(p, text, base);
        return r.ok ? { ok: true, hash: r.hash } : { ok: false, conflict: true };
      },
      setValue: (text, key, value) => setFrontmatterValue(text, key, value),
    };
    // the pages of other workspaces the cell names, as keys (a name that no workspace here has cannot be written to, and is refused)
    const wanted: string[] = [];
    for (const f of req.foreign ?? []) {
      const hit = foreignResolve(f.workspace, f.path);
      if (!hit) return { ok: false, error: `The page “${f.path}” of the workspace “${f.workspace}” cannot be found on this computer.` };
      wanted.push(hit.path);
    }
    const r = await runRelationEdit(host, rel as never, { ...req, values: [...req.values, ...wanted] });
    if (!r.ok) return r;
    const changed = r.changed.filter((c) => !foreignParts(c));
    const changedForeign = r.changed.flatMap((c) => {
      const f = foreignInfo(c);
      return f ? [{ workspace: f.name, path: f.path }] : [];
    });
    if (changed.length > 0) this.emit('index:updated', { path: null });
    return { ok: true, changed, ...(changedForeign.length > 0 ? { changedForeign } : {}) };
  }

  async relationCandidates(relation: string, side: 'forward' | 'back', text: string, exclude: string[]): Promise<RelationPage[]> {
    const rel = this.relationNamed(relation);
    if (!rel) return [];
    const words = text.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[":()]/g, ''));
    const q = `saved:${JSON.stringify(side === 'forward' ? rel.to : rel.from)} ${words.map((w) => `title:${w}`).join(' ')} sort:title`;
    const skip = new Set(exclude);
    return this.open.index
      .search(q, { limit: 40, count: false })
      .results.filter((r: { path: string }) => !skip.has(r.path))
      .slice(0, 12)
      .map((r: { path: string; title: string }) => ({ path: r.path, title: r.title }));
  }

  async setPageTitle(p: string, title: string): Promise<WriteResult> {
    const page = await this.readPage(p);
    if (!page.exists) throw Object.assign(new Error('This page has no file yet. Create the page first.'), { code: 'NO_FILE' });
    const clean = title.replace(/[\r\n]+/g, ' ').trim();
    const parsed = parseMarkdown(page.text) as { headings: Array<{ level: number; line: number }>; frontmatter: { data: Record<string, unknown> } };
    const h1 = parsed.headings.find((h) => h.level === 1);
    let text = page.text;
    if (h1) {
      const lines = text.split('\n');
      const raw = lines[h1.line - 1] ?? '';
      const cr = raw.endsWith('\r') ? '\r' : '';
      lines[h1.line - 1] = (/^\s{0,3}#/.test(raw) ? `# ${clean}` : clean) + cr;
      text = lines.join('\n');
    } else if (typeof parsed.frontmatter?.data?.title === 'string') text = setFrontmatterValue(text, 'title', clean);
    if (text === page.text) return { ok: true, hash: page.hash ?? '' };
    return this.writePage(page.path, text, page.hash);
  }

  async stats(): Promise<IndexStats> {
    return this.open.index.stats();
  }

  // ---------------------------------------------------------------- per-workspace UI state

  async getState(): Promise<WorkspaceState> {
    return this.open.state;
  }

  async setState(patch: Partial<WorkspaceState>): Promise<void> {
    const o = this.open;
    o.state = { ...o.state, ...patch };
    if (o.stateTimer) clearTimeout(o.stateTimer);
    o.stateTimer = setTimeout(() => {
      o.stateTimer = null;
      void this.writeState(o);
    }, 400);
  }

  private async writeState(o: Open): Promise<void> {
    if (o.single) return;
    try {
      await fs.mkdir(path.dirname(o.statePath), { recursive: true });
      await fs.writeFile(o.statePath, YAML.stringify(o.state));
    } catch {
      /* not worth failing for */
    }
  }

  /** Is this file already in the folder of the page, where an import would put it? Then its link text; else null. */
  async fileInPage(page: string, srcAbs: string): Promise<string | null> {
    const o = this.open;
    if (o.single || o.config) return null;
    const folder = pageFolder(normalizePagePath(page));
    const dest = this.absDir(`${folder}/${path.basename(srcAbs)}`);
    // the same file, by its real location (a link or a differently written path still counts)
    const [a, b] = await Promise.all([fs.realpath(srcAbs).catch(() => null), fs.realpath(dest).catch(() => null)]);
    return a !== null && a === b ? `${posix.basename(folder)}/${path.basename(srcAbs)}` : null;
  }

  /** Copy a file into the folder of a page (making it a child of that page). A file that already is there is not copied again. */
  async importFile(page: string, srcAbs: string): Promise<{ path: string; rel: string }> {
    const o = this.open;
    if (o.single || o.config) throw Object.assign(new Error('A file opened on its own cannot hold files.'), { code: 'NO_WORKSPACE' });
    const p = normalizePagePath(page);
    const base = path.basename(srcAbs);
    const st = await fs.stat(srcAbs).catch(() => null);
    if (!st || !st.isFile()) throw Object.assign(new Error(`${base} is not a file`), { code: 'NOT_FOUND' });
    const folder = pageFolder(p);
    const there = await this.fileInPage(p, srcAbs);
    if (there) return { path: `${folder}/${base}`, rel: there };
    await fs.mkdir(this.absDir(folder), { recursive: true });
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let name = base;
    for (let n = 1; await fs.stat(this.absDir(`${folder}/${name}`)).then(() => true, () => false); n++) name = `${stem}.${n}${ext}`;
    const rel = `${folder}/${name}`;
    await fs.copyFile(srcAbs, this.absDir(rel), fs.constants.COPYFILE_EXCL);
    if (isNoteFile(name)) {
      await o.index.refresh([rel]);
      o.lookup = null;
    }
    this.emit('tree:changed', { parents: [p] });
    return { path: rel, rel: `${posix.basename(folder)}/${name}` };
  }

  /** Where a page is on disk. A folder without a page of its own (no file) answers with the folder itself. */
  async absolutePath(p: string): Promise<string> {
    // a file that is not a note (a picture, a PDF) has no page path to check: it is simply where it is
    if (!isNoteFile(p) && p !== '' && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '' || s === '.' || s === '..')) return this.absDir(p);
    const page = normalizePagePath(p);
    const file = this.abs(page);
    const hasFile = await fs.stat(file).then((s) => s.isFile(), () => false);
    if (!hasFile && (await fs.stat(this.absDir(page)).then((s) => s.isDirectory(), () => false))) return this.absDir(page);
    return file;
  }
}

/** Make an error safe to send across a process boundary. */
export function toWireError(e: unknown): WireError {
  const err = e as { message?: string; code?: string; name?: string; details?: unknown };
  return {
    message: err?.message ?? String(e),
    ...(err?.code ? { code: err.code } : {}),
    ...(err?.name ? { name: err.name } : {}),
    ...(err?.details !== undefined ? { details: JSON.parse(JSON.stringify(err.details ?? null, (_k, v) => (typeof v === 'object' && v instanceof Error ? v.message : v))) } : {}),
  };
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Set or remove one frontmatter key, leaving the rest of the file (comments, order, body) as it was. */
export function setFrontmatterValue(text: string, key: string, value: AttrValue | null): string {
  const bad = (): never => {
    throw Object.assign(new Error('The frontmatter of this page could not be read, so it was not changed.'), { code: 'BAD_FRONTMATTER' });
  };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = FRONTMATTER.exec(text);
  if (!m) {
    if (value === null) return text;
    const doc = new YAML.Document({});
    doc.setIn(key.split('.'), value);
    return `---${eol}${doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()}${eol}---${eol}${text}`;
  }
  const doc = YAML.parseDocument(m[1] ?? '');
  if (doc.errors.length > 0) return bad();
  if (!YAML.isMap(doc.contents)) {
    if ((m[1] ?? '').trim() === '') doc.contents = doc.createNode({}) as never;
    else return bad();
  }
  const path = key.split('.');
  if (value === null) doc.deleteIn(path);
  else doc.setIn(path, value);
  const body = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  return `---${eol}${body ? body + eol : ''}---${eol}${text.slice(m[0].length)}`;
}

/** The names a page may use for a file in its `files:` block, most readable first. */
function fileKeyCandidates(page: string, filePath: string): string[] {
  const file = filePath.replace(/^\/+/, '');
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const name = file.split('/').pop()!;
  const own = pageFolder(page);
  return [...(dir === own ? [name] : []), `/${file}`, file].filter((x, i, arr) => arr.indexOf(x) === i);
}

function filesDoc(text: string): { doc: YAML.Document; m: RegExpExecArray | null; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = FRONTMATTER.exec(text);
  const doc = YAML.parseDocument(m?.[1] ?? '');
  if (doc.errors.length > 0 || (!YAML.isMap(doc.contents) && (m?.[1] ?? '').trim() !== '')) {
    throw Object.assign(new Error('The frontmatter of this page could not be read, so it was not changed.'), { code: 'BAD_FRONTMATTER' });
  }
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  return { doc, m, eol };
}

/** The attributes the `files:` block of a page's frontmatter lists for a file (under any of `names`), or null. */
function readFileEntry(text: string, names: string[]): Record<string, unknown> | null {
  try {
    const { doc } = filesDoc(text);
    const files = doc.get('files');
    if (!YAML.isMap(files)) return null;
    for (const n of names) {
      const v = files.get(n, true);
      if (YAML.isMap(v)) return (v.toJSON() as Record<string, unknown>) ?? {};
    }
  } catch {
    // unreadable frontmatter: nothing to carry
  }
  return null;
}

/** Set (or, for null, remove) attributes of one file in the `files:` map of the frontmatter; an emptied entry goes away. */
function setFileEntryText(text: string, names: string[], attrs: Record<string, AttrValue | null | unknown>): string {
  const { doc, m, eol } = filesDoc(text);
  let files = doc.get('files', true);
  if (files !== undefined && !YAML.isMap(files)) {
    throw Object.assign(new Error('This page lists its files as a list; change it to a name: attributes map first.'), { code: 'FILES_IS_LIST' });
  }
  const existing = YAML.isMap(files) ? names.find((n) => (files as YAML.YAMLMap).has(n)) : undefined;
  const key = existing ?? names[0]!;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) doc.deleteIn(['files', key, k]);
    else doc.setIn(['files', key, k], v);
  }
  files = doc.get('files', true);
  if (YAML.isMap(files)) {
    const entry = files.get(key, true);
    if (YAML.isMap(entry) && entry.items.length === 0) files.delete(key);
    if (files.items.length === 0) doc.delete('files');
  }
  const body = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const bodyText = body === '{}' ? '' : body;
  if (!m) return bodyText ? `---${eol}${bodyText}${eol}---${eol}${text}` : text;
  return `---${eol}${bodyText ? bodyText + eol : ''}---${eol}${text.slice(m[0].length)}`;
}

const validColor = (c: unknown): string | null => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
const validIcon = (i: unknown): string | null => (typeof i === 'string' && /^[a-z0-9-]{1,64}$/.test(i) ? i : null);
const validFont = (f: unknown): 'sans' | 'serif' | null => (f === 'sans' || f === 'serif' ? f : null);
const validSize = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.max(10, Math.min(40, Math.round(n * 2) / 2)) : null);
const noSizes = (): FontSizes => ({ sans: null, serif: null, mono: null });
const sizesOf = (raw: Record<string, unknown>): FontSizes => {
  const r = raw.fontSizes && typeof raw.fontSizes === 'object' && !Array.isArray(raw.fontSizes) ? (raw.fontSizes as Record<string, unknown>) : {};
  const out: FontSizes = { sans: validSize(r.sans), serif: validSize(r.serif), mono: validSize(r.mono) };
  // a workspace file from before there was a size for each typeface: its one size belongs to the typeface it chose
  const old = validSize(raw.fontSize);
  if (old !== null && out.sans === null && out.serif === null && out.mono === null) out[raw.font === 'serif' ? 'serif' : 'sans'] = old;
  return out;
};
const appearanceOf = (raw: Record<string, unknown>): WorkspaceAppearance => ({ color: validColor(raw.color), icon: validIcon(raw.icon), fontStyle: validFont(raw.font), fontSizes: sizesOf(raw), ...appearanceStyles(raw) });

/** The order of the Plugins menu: the person's own first (as written), then those other workspaces offer, then the ones that come with the app, by name. */
export function orderPlugins(list: PluginInfo[]): PluginInfo[] {
  const own = list.filter((p) => p.origin !== 'default' && !p.pending);
  const offered = list.filter((p) => p.pending);
  const shipped = list.filter((p) => p.origin === 'default').sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  return [...own, ...offered, ...shipped];
}
