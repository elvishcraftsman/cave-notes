/**
 * Minimal type declarations for the JavaScript core packages (only what the app uses).
 * The packages themselves are documented JavaScript with JSDoc.
 */
declare module '@cave-notes/core-tree' {
  export interface TreeListItem {
    path: string;
    name: string;
    exists: boolean;
    hasFolder: boolean;
    hasChildren: boolean;
    workspace?: boolean;
  }
  export interface Tree {
    root: string;
    listChildren(parent: string | null, opts?: { withChildFlag?: boolean; workspaces?: boolean; bareFolders?: boolean }): Promise<TreeListItem[]>;
    isWorkspaceDir(rel: string): Promise<boolean>;
    allPages(parent?: string | null): AsyncGenerator<TreeListItem>;
    descendants(path: string): Promise<Array<{ path: string; exists: boolean }>>;
    status(path: string): Promise<'page' | 'virtual' | null>;
    createPage(parent: string | null, name: string, content?: string, ext?: string): Promise<string>;
    promoteVirtual(path: string, content?: string): Promise<string>;
    planMove(from: string, newParent: string | null, newName?: string): Promise<unknown>;
    movePage(from: string, newParent: string | null, newName?: string): Promise<unknown>;
  }
  export function openTree(root: string, options?: Record<string, unknown>): Tree;
  export function configureNotes(o: { exts?: string[]; defaultExt?: string }): void;
  export function noteExtensions(): string[];
  export function defaultNoteExt(): string;
  export function isNoteFile(name: string): boolean;
  export function noteExtOf(name: string): string | null;
  export function extOf(p: string): string;
  export function cleanExt(e: string): string | null;
  export function normalizePagePath(p: string): string;
  export function normalizeName(n: string): string;
  export function fileStem(n: string): string;
  export function parentPage(p: string): string | null;
  export function pageName(p: string): string;
  export function pageFolder(p: string): string;
  export class TreeError extends Error {
    code: string;
    details: unknown;
  }
}

declare module '@cave-notes/core-md' {
  export function parse(source: string): unknown;
  export function setPageExtensions(exts: string[]): void;
  export function parseEmbeds(text: string): Array<{ from: number; to: number; raw: string; target: string; heading: string | null; named: boolean }>;
  export function stripFrontmatter(text: string): string;
  export function findSection(text: string, heading: string): { from: number; to: number; text: string } | null;
  export function embeddedText(pageText: string, heading: string | null): { ok: true; text: string } | { ok: false; error: string };
  export function replaceEmbedded(pageText: string, heading: string | null, newText: string): string | null;
  export function classifyDestination(dest: string): {
    kind: 'page' | 'file' | 'web' | 'workspace' | 'other';
    /** for a link to another workspace: its name */
    workspace?: string;
    target: string;
    fragment: string | null;
    url: string | null;
    hasPath: boolean;
  };
  /** `Workspace::Page` (the inside of a wikilink, without label and heading): the workspace and the page in it, or null */
  export function splitWorkspaceTarget(target: string): { workspace: string; target: string } | null;
}

declare module '@cave-notes/core-index' {
  import type { Tree } from '@cave-notes/core-tree';
  export function setWeekStart(day: number): void;
  export function offered(config: { shared?: Record<string, unknown> }): Record<string, unknown>;
  export interface PageRow {
    id: number;
    path: string;
    name: string;
    title: string;
    parsedTitle: string | null;
    isVirtual: boolean;
    aliases: string[];
  }
  export interface Lookup {
    byPath: Map<string, PageRow>;
    byStem: Map<string, PageRow[]>;
    byTitle: Map<string, PageRow[]>;
  }
  export function buildLookup(rows: PageRow[]): Lookup;
  /** A link written as `[[Page]]` or `[label](Page.md)`: the page it names, or null. */
  export function linkTarget(raw: unknown): { text: string; target: string } | null;
  export function resolvePageLink(
    link: { syntax: 'md' | 'wiki'; target: string; fragment?: string | null },
    fromPath: string,
    fromRow: PageRow | null | undefined,
    lookup: Lookup,
  ): { status: 'ok' | 'broken' | 'ambiguous'; row: PageRow | null; targetPath: string | null; candidates?: string[] };
  export interface IndexLink {
    kind: 'page' | 'file' | 'web' | 'other';
    syntax: 'md' | 'wiki';
    embed: boolean;
    raw: string;
    target: string;
    fragment: string | null;
    url: string | null;
    text: string | null;
    line: number;
    status: string;
    targetPath: string | null;
    resolvedPage: string | null;
  }
  export interface Index {
    root: string;
    tree: Tree;
    db: { prepare(sql: string): { all(...args: unknown[]): any[]; get(...args: unknown[]): any; run(...args: unknown[]): any }; transaction<T>(fn: () => T): () => T };
    reconcile(): Promise<Record<string, number>>;
    rebuild(): Promise<Record<string, number>>;
    syncFiles(): Promise<void>;
    refresh(paths: string[]): Promise<Record<string, number>>;
    getPage(path: string): { path: string; title: string; isVirtual: boolean; attributes: Record<string, Array<{ type: string; text: string; num: number | null }>>; diagnostics: Array<{ kind: string; message: string }> } | null;
    links(path: string): IndexLink[];
    backlinks(path: string): Array<{ fromPath: string; fromTitle: string; line: number; text: string | null }>;
    allPageRows(): PageRow[];
    search(query: string, opts?: { limit?: number; offset?: number; count?: boolean; hideFrom?: 'tree' | 'children' | 'search' | 'queries' }): { results: any[]; total: number | null; errors: string[] };
    /** The page a path, file name, title or alias points at. */
    resolveRef(ref: string): { path: string; title: string } | null;
    attributeKeys(): any[];
    attributeValues(key: string, opts?: { query?: string; limit?: number }): any[];
    stats(): { pages: number; files: number; virtualPages: number; links: number; brokenLinks: number; ambiguousLinks: number };
    /** pages kept out of the tree (`hidden: true`, own or inherited); with a parent (null = top level) only its direct children */
    hiddenPaths(parent?: string | null): Set<string>;
    /** the pages whose `hidden` keeps them out of `area` (default: the page tree) */
    readonly globals: Record<string, unknown>;
    stateOf(path: string): { attributes: Record<string, unknown>; blocks: Array<{ defaults: string; link?: string; inheritance: string; attrs: Record<string, unknown> }> } | null;
    hiddenOnlyPaths(parent?: string | null, area?: 'tree' | 'children' | 'search'): Set<string>;
    templatePaths(parent?: string | null): Set<string>;
    /** the icon pages ask for with `icon: name` (path -> icon name); with a parent only its direct children */
    iconPaths(parent?: string | null): Map<string, string>;
    readonly savedQueries: Array<{ name: string; query: string; title?: string }>;
    readonly relations: Array<{ name: string; reverse?: string; from: string; to: string; attribute: string; multiple: boolean; backattribute?: string; backname?: string; backmultiple?: boolean }>;
    readonly globalsWarnings: string[];
    relatedFor(paths: string[]): Record<string, Record<string, Array<{ path: string; title: string }>>>;
    /** stored content hash (sha1) of a page, or null */
    pageHash(path: string): string | null;
    reloadSchema(): Promise<{ changed: boolean; warnings: string[] }>;
    setInherited(inherited: unknown): Promise<void>;
    close(): Promise<void>;
  }
  export function openIndex(root: string, options?: Record<string, unknown>): Promise<Index>;
}

declare module '@cave-notes/core-links' {
  import type { Index } from '@cave-notes/core-index';
  import type { Tree } from '@cave-notes/core-tree';
  export function planMove(o: { tree: Tree; index: Index; from: string; newParent?: string | null; newName?: string; reconcile?: boolean; onStep?: (message: string) => void }): Promise<any>;
  export function applyPlan(plan: any, o: { tree: Tree; index?: Index; journalDir?: string; onStep?: (message: string) => void }): Promise<any>;
  export function undo(o: { tree: Tree; index?: Index; id?: string; force?: boolean; journalDir?: string }): Promise<{ id: string; restored: string[]; skipped: string[] }>;
  export function listJournal(root: string, o?: { journalDir?: string }): Promise<Array<{ id: string; state: string; createdAt: string; move: { from: string; to: string } }>>;
  export class LinksError extends Error {
    code: string;
    details: unknown;
  }
}

declare module '@cave-notes/core-sync' {
  export function mergeDocuments(o: { base: string; local: string; remote: string; localTime?: number; remoteTime?: number }): { text: string; conflicts: number; lost: string[] };
  export function pickBase(candidates: string[], a: string, b: string): string;
  export function isConflictName(name: string): boolean;
  export function conflictOriginal(path: string): string | null;
  export const CONFLICT_OPEN: string;
  export function splitFrontmatter(text: string): { front: string; body: string };
  export class HistoryStore {
    constructor(dir: string, opts?: { maxPerFile?: number; maxFiles?: number });
    add(rel: string, text: string, source: string, t?: number): Promise<{ id: string; t: number; source: string; size: number } | null>;
    list(rel: string): Promise<Array<{ id: string; t: number; source: string; size: number }>>;
    read(rel: string, id: string): Promise<string | null>;
    texts(rel: string, limit?: number): Promise<string[]>;
    rename(from: string, to: string): Promise<void>;
  }
}

declare module '@cave-notes/core-sync' {
  export function textChanges(from: string, to: string): Array<{ from: number; to: number; insert: string }>;
}

declare module '@cave-notes/core-sync/pure' {
  export * from '@cave-notes/core-sync';
}

declare module '@cave-notes/core-automation' {
  export class DateValue {
    constructor(ms: number, withTime: boolean);
    readonly ms: number;
    readonly dateOnly: boolean;
    toString(): string;
  }
  export function isDateValue(v: unknown): v is DateValue;
  export function startOfDay(v: DateValue): DateValue;
  export function parseDateValue(s: string): DateValue | null;
  export function parseExpr(src: string): unknown;
  export function evalExpr(tree: unknown, ctx: Record<string, unknown>): unknown;
  export function rewritePageRefs(src: string): string;
  export function hostCalls(tree: unknown): Array<{ kind: 'query' | 'page'; name: string; args: string[]; key: string }>;
  export function queryValue(name: string, args: string[], data: { count: number; titles: string[]; values: Array<{ type: string; text: string; num: number | null }> }): unknown;
  export function stringifyValue(v: unknown): string;
  export interface AutomationPageInfo {
    path: string;
    title: string;
    mtimeMs: number;
    attrs: Record<string, Array<{ type: string; text: string; num?: number }>>;
  }
  export interface ShellSpec {
    ruleId: string;
    command: string | null;
    argv: string[] | null;
    cwd: string | null;
    timeoutMs: number;
    env: Record<string, string>;
    page: string;
    template: { command: string | null; argv: string[] | null; cwd: string | null; env: Record<string, unknown> };
  }
  export interface JsSpec {
    ruleId: string;
    code: string;
    input: unknown;
    timeoutMs: number;
    page: string;
  }
  /** What running a script gives back: its value and log lines, an error, or a refusal from the host. */
  export type JsResult = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string; denied?: undefined } | { denied: true; reason: string; ok?: undefined };
  export function runSandbox(code: string, input: unknown, options?: { timeoutMs?: number; memoryMb?: number }): Promise<JsResult>;
  export interface ShellResult {
    code: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    denied?: boolean;
    reason?: string;
  }
  export interface DeviceFile {
    id: string;
    name?: string;
    seen: number;
    version?: number;
    fired?: Record<string, number>;
  }
  export interface AutomationHost {
    root: string;
    now(): Date;
    search(query: string, thisPath?: string): Promise<{ paths: string[]; errors: string[] }>;
    pageInfo(path: string): Promise<AutomationPageInfo | null>;
    absolutePath(path: string): string;
    resolvePage(ref: string, fromPath: string): Promise<string | null>;
    readText(path: string): Promise<{ text: string; hash: string } | null>;
    writeText(path: string, text: string, baseHash?: string): Promise<{ ok: boolean }>;
    setProperties(path: string, changes: Record<string, unknown>): Promise<{ changed: boolean }>;
    createPage(spec: { parent: string | null; name: string; content: string | null; path?: string }): Promise<{ path: string; created: boolean }>;
    movePage(path: string, destination: string): Promise<{ moved: boolean; to?: string; reason?: string }>;
    notify(n: { title: string; body: string; path: string | null }): Promise<void> | void;
    /** a rule ran (not a dry run) and did something or failed */
    onRun?(entry: LogEntry): void;
    shell(spec: ShellSpec): Promise<ShellResult>;
    js?(spec: JsSpec): Promise<JsResult>;
    installAutomations?(spec: { ruleId: string; owner: string; file: string; content: string | null; remove: boolean; page: string }): Promise<{ changed?: boolean; created?: boolean; detail?: string; error?: string; denied?: boolean; reason?: string }>;
    loadState(): Promise<unknown>;
    saveState(state: unknown): Promise<void>;
    readDevices(): Promise<DeviceFile[]>;
    writeDevice(device: DeviceFile): Promise<void>;
    appendLog(entry: unknown): void;
  }
  export interface LogEntry {
    t: number;
    rule: string;
    path: string | null;
    trigger: string;
    status: 'done' | 'skipped' | 'failed' | 'dry';
    detail: string;
    steps: Array<{ action: string; status: string; detail: string }>;
    dry: boolean;
  }
  export interface RuleSummary {
    id: string;
    name: string;
    enabled: boolean;
    runs: 'once' | 'everywhere';
    device: string | null;
    triggers: string[];
    usesShell: boolean;
  }
  /** The rules of an automations file, checked (only what the Plugins menu needs is typed here). */
  export function parseAutomations(text: string): { rules: Array<Record<string, unknown>>; warnings: string[]; errors: string[] };
  export class AutomationEngine {
    deviceName: string;
    constructor(o: { host: AutomationHost; deviceId: string; deviceName?: string; log?: (level: string, msg: string) => void });
    load(text: string | null): Promise<{ rules: number; problems: Array<{ level: string; message: string }> }>;
    reload(text: string | null): Promise<{ rules: number; problems: Array<{ level: string; message: string }> }>;
    start(): Promise<void>;
    tick(): Promise<void>;
    catchUp(): Promise<void>;
    onChanges(changes: Array<{ path: string; kind: 'created' | 'modified' | 'deleted'; origin?: 'local' | 'external' }>, moves?: Array<{ from: string; to: string }>): Promise<void>;
    runNow(ruleId: string, o?: { dry?: boolean; path?: string | null; limit?: number }): Promise<Array<{ path: string | null; status: string; detail: string; steps?: unknown[] }>>;
    plugins(): Array<{ id: string; label: string; ask: unknown[] }>;
    pluginQuestions(ruleId: string, opts: { path: string | null; text: string; selection: boolean }): Promise<unknown[]>;
    runPlugin(ruleId: string, opts: { path: string | null; text: string; selection: boolean; answers: Record<string, unknown> }): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; text: string; changed: boolean }>;
    buttonQuestions(ruleId: string, opts: { path: string | null }): Promise<{ title: string; ask: unknown[] }>;
    runButton(ruleId: string, path: string | null, answers?: Record<string, unknown>): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; steps: Array<{ action: string; status: string; detail: string }> }>;
    log(limit?: number): LogEntry[];
    rulesFor(path: string): Promise<Array<{ id: string; name: string; triggers: string[]; definition: string }>>;
    status(): { rules: RuleSummary[]; problems: Array<{ level: string; message: string }>; pending: number; device: { id: string; name: string } };
    flush(): Promise<void>;
  }
}

declare module '@cave-notes/core-index/config' {
  export function mergeSection(own: unknown, present: boolean, inherited: unknown, kind: 'map' | 'seq'): any;
  export interface WorkspaceConfig {
    dir: string;
    files: Array<{ name: string; keys: string[]; error?: string }>;
    /** each section, from all files put together */
    sections: Record<string, any>;
    /** the sections some file has, even empty ones */
    present: Set<string>;
    globalKeys: Set<string>;
    /** what is tagged `!global` (a whole section, or single entries), kept apart from `sections` */
    shared: Record<string, any>;
    /** the files that have each section */
    owners: Record<string, string[]>;
    warnings: string[];
    invalid: boolean;
  }
  export const SECTIONS: Record<string, 'map' | 'seq' | 'scalar'>;
  export const DEFAULT_FILE: Record<string, string>;
  export function configFileNames(names: string[]): string[];
  export function parseConfig(files: Array<{ name: string; text: string }>): Omit<WorkspaceConfig, 'dir'>;
  export function readConfig(dir: string): Promise<WorkspaceConfig>;
  export function readConfigSync(dir: string): WorkspaceConfig;
  export function homeFor(config: Pick<WorkspaceConfig, 'files' | 'owners'>, key: string): string;
}

declare module '@cave-notes/core-index/driver-sqlite-wasm' {
  export interface SqliteWasmDriver {
    name: 'sqlite-wasm';
    sqliteVersion: string;
    open(path: string): unknown;
    destroy(path: string): void;
    /** snapshot every open database that changed since its last snapshot; returns how many were saved */
    snapshotAll(): number;
    /** resolves when no database is open */
    allClosed(): Promise<void>;
  }
  export function createSqliteWasmDriver(
    sqlite3: unknown,
    opts?: { snapshots?: Map<string, Uint8Array>; onSnapshot?: (path: string, bytes: Uint8Array) => void },
  ): SqliteWasmDriver;
}
