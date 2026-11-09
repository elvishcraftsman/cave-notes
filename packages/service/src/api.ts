/** The contract between the renderer, the main process and the workspace worker. */

export interface TreeItem {
  path: string;
  name: string;
  exists: boolean;
  hasChildren: boolean;
  /** `hidden` names the page tree (`tree`, `all`, `true`): kept out of the tree */
  hidden?: boolean;
  /** `template: true`: a template page (`hidden: all` unless it says otherwise, so only in the tree when hidden pages are shown) */
  template?: boolean;
  /** hidden from the tree (`hidden: files`, `all` or `true`, or a template): present only when the tree shows hidden pages */
  unlisted?: boolean;
  /** `icon: name` in its attributes: an icon of the bundled set, shown in the tree and the gallery */
  icon?: string;
  /** a folder that is a workspace of its own (it holds `.cave-notes`): where it is on disk */
  workspaceRoot?: string;
}

/** A file in a page's folder that is not a note. `path` is relative to the workspace. */
export interface FileItem {
  path: string;
  name: string;
  size: number;
}

/** Which files are notes: their extensions (with the dot, lower case) and the one new notes get. */
export interface NoteTypes {
  exts: string[];
  create: string;
}

/** The typeface of page text: the interface font, or Libertinus Serif. */
export type FontStyle = 'sans' | 'serif';

/** The three typefaces the editor uses: page text in sans-serif or serif (see FontStyle), and monospace for code. */
export type FontKind = 'sans' | 'serif' | 'mono';
/** A text size in px for each typeface; null means automatic. */
export type FontSizes = Record<FontKind, number | null>;

/** How a workspace looks (tab colour and icon, page text). Saved in the workspace's .cave-notes folder. */
export interface WorkspaceAppearance {
  /** accent colour as #rrggbb, or null for none */
  color: string | null;
  /** name of one of the app's icons, or null for the default */
  icon: string | null;
  /** typeface of page text in this workspace, or null to follow the app's default */
  fontStyle: FontStyle | null;
  /** size in px of each typeface in this workspace; null for one that follows the app's default */
  fontSizes: FontSizes;
  /** named paragraph styles (`styles:`; lengths in cm) and extra CSS (`css:`) of this workspace */
  styles?: Record<string, Record<string, unknown>>;
  css?: string;
  /** `presentation-themes:` and `presentation-rules:` of this workspace, as written */
  presentation?: { themes?: Record<string, unknown>; rules?: unknown[] };
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  /** set when the workspace was already open (in another window) and has finished indexing: its page count */
  indexed?: number;
  /** one Markdown file opened on its own (`root` is then the file's own path) */
  single?: boolean;
  /** a workspace's own `.cave-notes` folder opened as a lightweight workspace, to edit its settings files and templates */
  config?: boolean;
  /** the built-in documentation: a lightweight workspace over the bundled docs folder, read only and shown fully rendered */
  docs?: boolean;
}

export interface PageData {
  path: string;
  /** false for a virtual page (a folder with no page file yet) */
  exists: boolean;
  text: string;
  /** sha1 of the file bytes, null when there is no file */
  hash: string | null;
  /** modification time of the file (0 when there is none) */
  mtimeMs?: number;
}

/** One remembered version of a page. */
export interface HistoryEntry {
  id: string;
  t: number;
  source: 'saved' | 'disk' | 'merged' | 'conflict-copy' | 'discarded' | 'before-restore';
  size: number;
}

export type ConflictMerge = 'ask' | 'auto' | 'never';

export type WriteResult = { ok: true; hash: string } | { ok: false; conflict: true; diskHash: string | null };

export type LinkStatus = 'ok' | 'broken' | 'ambiguous' | 'external' | 'file' | 'pending';

export interface LinkInfo {
  kind: 'page' | 'file' | 'web' | 'workspace' | 'other';
  syntax: 'md' | 'wiki';
  embed: boolean;
  raw: string;
  target: string;
  fragment: string | null;
  url: string | null;
  text: string | null;
  line: number;
  status: LinkStatus;
  targetPath: string | null;
  resolvedPage: string | null;
}

export interface BacklinkInfo {
  fromPath: string;
  fromTitle: string;
  line: number;
  text: string | null;
}

export interface PageInfo {
  path: string;
  title: string;
  isVirtual: boolean;
  attributes: Record<string, Array<{ type: string; text: string }>>;
  diagnostics: Array<{ kind: string; message: string }>;
}

export interface PlanEdit {
  start: number;
  end: number;
  line: number;
  column: number;
  oldText: string;
  newText: string;
  kind: 'md' | 'wiki';
}

export interface LinkPlan {
  id: string;
  noop: boolean;
  root: string;
  createdAt: string;
  move: { from: string; to: string };
  pageMoves: Array<{ from: string; to: string; exists: boolean }>;
  files: Array<{ path: string; newPath: string; sourceHash: string; edits: PlanEdit[] }>;
  warnings: Array<{ file: string; line: number | null; message: string }>;
  summary: { pagesMoved: number; filesEdited: number; linksRewritten: number; warnings: number };
}

export interface ApplyResult {
  id: string;
  from: string;
  to: string;
  pageMoves: Array<{ from: string; to: string; exists: boolean }>;
  filesEdited: number;
  linksRewritten: number;
}

export type ResolvedLink =
  | { kind: 'page'; status: 'ok'; path: string; fragment: string | null }
  | { kind: 'page'; status: 'broken'; name: string; fragment: string | null }
  | { kind: 'page'; status: 'ambiguous'; name: string; candidates: string[]; fragment: string | null }
  | { kind: 'file'; absPath: string }
  | { kind: 'web'; url: string }
  | { kind: 'workspace'; workspace: string; target: string; fragment: string | null }
  | { kind: 'other' };

export interface PageSuggestion {
  /** text to insert inside [[ ]] */
  label: string;
  path: string;
  title: string;
}

export interface SearchResult {
  id: number;
  path: string;
  title: string;
  isVirtual: boolean;
  mtimeMs: number;
  rank: number | null;
  snippet: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number | null;
  errors: string[];
}

/** A search and replace over the pages: what to find, what to put, where to look (see replace.ts). */
export interface ReplaceRequest {
  find: string;
  replace: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  /** `text`, `headings`, `attributes`, `code`: the kinds of lines to look in */
  kinds: string[];
  /** also match, and rename, the pages' names */
  names: boolean;
  /** a search (as in the search pane) that picks the pages; empty: every page */
  pages: string;
}

export interface ReplaceMatch {
  id: string;
  line: number;
  kind: string;
  start: number;
  end: number;
  matched: string;
  replacement: string;
  before: string;
  after: string;
}

export interface ReplacePage {
  path: string;
  title: string;
  matches: ReplaceMatch[];
  /** the name the page would get, when its name matches */
  rename: string | null;
}

export interface ReplaceFound {
  pages: ReplacePage[];
  /** matches and renames, all pages */
  total: number;
  /** more than could be listed: the rest is not shown (and not changed unless asked for again) */
  truncated: boolean;
  /** why the search cannot run (a regular expression that is not one) */
  error: string | null;
}

export interface ReplaceChoice {
  path: string;
  /** the ids of the matches to replace (all of them: null) */
  matches: string[] | null;
  rename: boolean;
}

export interface ReplaceDone {
  matches: number;
  pages: number;
  renamed: number;
  /** what could not be changed, with the reason */
  failed: string[];
}

/** Where an attribute of a page comes from. */
export type AttributeOrigin =
  | { kind: 'page' }
  | { kind: 'children'; page: string }
  | { kind: 'inherited'; page: string }
  | { kind: 'workspace' }
  | { kind: 'other' };
export interface AttributeSource {
  key: string;
  value: string;
  source: AttributeOrigin;
}

/** One page in a database view: its title and the attributes asked for. */
export interface ViewRow {
  path: string;
  title: string;
  isVirtual: boolean;
  mtimeMs: number;
  attrs: Record<string, Array<{ type: string; text: string; num: number | null }>>;
  /** colour from the view's colour rules */
  color?: string;
  /** pages named through a relation, by column name (see SavedQueries) */
  related?: Record<string, Array<{ path: string; title: string; workspace?: string }>>;
  /** the name of the workspace this page is in, when the view shows a saved query of another workspace */
  workspace?: string;
}

/** A named query saved in the workspace file (`queries` of .cave-notes/workspace.yaml). */
export interface PageSource {
  name: string;
  ext: string;
  file: string | null;
  dir: string | null;
}

export interface SavedQuery {
  name: string;
  query: string;
  title?: string;
}

/**
 * Pages of query `from` name pages of query `to` in `attribute`; shown as the column `name`. `reverse` is the column of
 * the other side. With `backattribute` the relation is mutual: the pages named name the page back in that attribute,
 * and editing one side edits the other. `multiple` / `backmultiple`: one page or several in each attribute.
 */
export interface RelationDef {
  name: string;
  reverse?: string;
  from: string;
  to: string;
  attribute: string;
  multiple?: boolean;
  backattribute?: string;
  backname?: string;
  backmultiple?: boolean;
}

/** A page named in a relation. */
export interface RelationPage {
  path: string;
  title: string;
  /** the workspace (its folder name) of a page that is not in this one */
  workspace?: string;
}

/** What a person decides when a change to a relation runs into something. */
export type RelationResolution = 'replace' | 'skip' | 'one-sided';

/**
 * Something that stops a change to a mutual relation from simply going through. `taken`: the page to link has room for
 * one page only and already names another (`holder`). `unwritable`: the other page cannot be changed (it has no file,
 * its attributes cannot be read, it changed meanwhile). `action` says whether a link was being made or taken away.
 */
export interface RelationConflict {
  id: string;
  kind: 'taken' | 'unwritable';
  action: 'link' | 'unlink';
  page: RelationPage;
  reason?: string;
  holder?: { path: string | null; title: string };
}

export interface RelationEditRequest {
  page: string;
  relation: string;
  /** `forward`: the column named by `name`; `back`: the one named by `backname` */
  side: 'forward' | 'back';
  /** every page of this workspace the attribute should name afterwards */
  values: string[];
  /** the pages of other workspaces it should name too (the window found them in those workspaces; the worker cannot) */
  foreign?: Array<{ workspace: string; path: string }>;
  /** the workspaces on this computer, to find the files of pages named in other workspaces */
  workspaces?: Array<{ name: string; root: string }>;
  /** answers to conflicts an earlier call reported, by conflict id */
  resolutions?: Record<string, RelationResolution>;
}

export type RelationEditResult = { ok: true; changed: string[]; changedForeign?: Array<{ workspace: string; path: string }> } | { ok: false; conflicts: RelationConflict[] } | { ok: false; error: string };

export interface SavedQueries {
  queries: SavedQuery[];
  relations: RelationDef[];
  warnings: string[];
}

export interface ViewData {
  rows: ViewRow[];
  total: number | null;
  errors: string[];
}

export type AttrValue = string | number | boolean | string[];

export interface AttributeKey {
  key: string;
  type: string;
  pages: number;
  declared?: boolean;
  /** a list attribute (tags): one row per item */
  list?: boolean;
  values?: string[];
}

export interface IndexStats {
  pages: number;
  virtualPages: number;
  links: number;
  brokenLinks: number;
  ambiguousLinks: number;
}

export interface WorkspaceState {
  expanded: string[];
  lastPage: string | null;
}

export interface DeleteInfo {
  /** absolute paths to move to the trash */
  trash: string[];
  /** page paths that will disappear (the page and its descendants) */
  pages: string[];
  /** links from pages outside the subtree that will become broken */
  backlinks: number;
}

/** Methods served by the workspace worker. */
export interface AutomationStatus {
  /** false when the workspace has no automations file, or it is not usable */
  enabled: boolean;
  rules: Array<{ id: string; name: string; enabled: boolean; runs: 'once' | 'everywhere'; device: string | null; triggers: string[]; usesShell: boolean }>;
  problems: Array<{ level: string; message: string }>;
  pending: number;
  device: { id: string; name: string };
}

/** A rule whose criteria (`where`, `require`, `unless`) an open page meets, with the rule as it is written. */
export interface AutomationRuleHit {
  id: string;
  name: string;
  triggers: string[];
  definition: string;
}

export interface AutomationLogEntry {
  t: number;
  rule: string;
  path: string | null;
  trigger: string;
  status: 'done' | 'skipped' | 'failed' | 'dry';
  detail: string;
  steps: Array<{ action: string; status: string; detail: string }>;
  dry: boolean;
}

export interface WorkerApi {
  openWorkspace(root: string, opts?: { file?: string; config?: boolean; docs?: boolean; dataDir?: string; notes?: NoteTypes; firstDay?: number }): Promise<WorkspaceInfo>;
  closeWorkspace(): Promise<void>;
  /** Sub-pages of a page (null = top level). Pages hidden from the tree (and templates) are left out; `unlisted: true` brings them (templates included) back. */
  /** `bareFolders: false` leaves out folders that hold no notes (the page tree can be set to do that; the sub-page bar never does). */
  listChildren(parent: string | null, opts?: { includeHidden?: boolean; forChildren?: boolean; workspaces?: boolean; unlisted?: boolean; bareFolders?: boolean }): Promise<TreeItem[]>;
  /** Files in a page's folder that are not notes (null = the workspace's top folder). */
  listFiles(parent: string | null): Promise<FileItem[]>;
  /** Absolute path of a file inside the workspace, for opening it with another program. */
  filePath(rel: string): Promise<string>;
  /** This workspace's own note types (null: it follows the app's choice) and the ones in effect. */
  getNoteTypes(): Promise<{ own: NoteTypes | null; effective: NoteTypes }>;
  setNoteTypes(types: NoteTypes | null, appDefault: NoteTypes): Promise<void>;
  /** The app's default changed: a workspace that follows it switches too. */
  applyAppNoteTypes(types: NoteTypes): Promise<void>;
  /** A sub-folder became or stopped being a workspace: look at the folder again. */
  rescan(): Promise<void>;
  /** Look for changes made outside the app and update the index; the tree and the pages are not touched. */
  refreshIndex(): Promise<void>;
  /** The automations of this workspace: its rules, problems found in the rules file, and what waits its turn. */
  automationStatus(): Promise<AutomationStatus>;
  /** The rules whose criteria this page meets. */
  automationRulesFor(path: string): Promise<AutomationRuleHit[]>;
  /** What the automations did lately, newest first. */
  automationLog(limit?: number): Promise<AutomationLogEntry[]>;
  /** Run one rule now. `dry` (the default) changes nothing and reports what would happen. */
  automationRun(ruleId: string, opts?: { dry?: boolean; path?: string | null; limit?: number }): Promise<Array<{ path: string | null; status: string; detail: string }>>;
  /** Read the rules file again. */
  automationReload(): Promise<void>;
  /**
   * A button in the page `path` was clicked: run the rule its `automation:` link names for that page. Only rules that list `on: button`
   * can be started this way. `refused` = the rule was not started (no such rule, no `button` trigger, another computer's rule); `skipped` = it
   * ran but the page did not meet its conditions; `done` / `failed` as for any run.
   */
  automationButton(ruleId: string, path: string): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; steps: Array<{ action: string; status: string; detail: string }> }>;
  /** The rules that show in the Plugins menu (`on: { plugin: "Name" }`), with the questions each asks first. */
  automationPlugins(): Promise<PluginInfo[]>;
  /** Take a plugin out: a workspace plugin is removed from its settings file, a default one from the app config folder. */
  uninstallPlugin(id: string): Promise<UninstallResult>;
  /** Bring back the default plugins (and templates) that were uninstalled. */
  restoreDefaultPlugins(): Promise<number>;
  /**
   * Run a plugin on `text` (the selection, or the whole page when `selection` is false) with the answers to its questions.
   * Nothing is written: the changed text comes back for the window to put into the editor.
   */
  /** The questions of a plugin with their `${ }` filled in for the text it is about to work on. */
  automationPluginAsk(ruleId: string, path: string, text: string, selection: boolean): Promise<PluginAsk[]>;
  /** `cursor` is the cursor's offset in `text` (null if there is none). */
  automationPlugin(ruleId: string, path: string, text: string, selection: boolean, answers: Record<string, unknown>, cursor: number | null): Promise<PluginResult>;
  /** (main process only) the answer to an 'automation:shell' request. */
  /** (main process only) the answer to an 'automation:js' request: may the script run? */
  automationJsResult(id: string, answer: { allowed: boolean; reason?: string }): Promise<void>;
  automationShellResult(id: string, result: { code: number; stdout?: string; stderr?: string; timedOut?: boolean; denied?: boolean; reason?: string }): Promise<void>;
  /** (main process only) the name of this computer changed. */
  automationSetDevice(name: string): Promise<void>;
  /** The day weeks start on changed (0 = Sunday): `$now.week` and views follow. */
  setFirstDay(day: number): Promise<void>;
  /** Index the pages of one folder that the index does not know yet (or knows in an older state), ahead of the full scan. */
  syncFolder(parent: string | null): Promise<void>;
  /** Copy a page and its sub-pages next to it: `Name.md` becomes `Name.1.md` (`Name.1.md` becomes `Name.2.md`), the title unchanged. Returns the new page. */
  duplicatePage(p: string): Promise<string>;
  /** where a page is on disk: its file and its folder of sub-pages (either may be missing) */
  pageSource(p: string): Promise<PageSource>;
  /** copy a page with everything under it into this workspace under `parent` (null = top level); the source may be in another workspace */
  copyPageIn(src: PageSource, parent: string | null): Promise<string>;
  /** whether a page (or folder) of this name already exists under `parent` (null = the top level) */
  pageNameTaken(parent: string | null, name: string): Promise<boolean>;
  /** Every attribute of a page, its value as text and where it is set (the page itself, a `children:` block of a page above, the workspace ...). */
  attributeSources(path: string): Promise<AttributeSource[]>;
  /** settings that other workspaces on this computer offer to all workspaces and this one has not been asked about */
  /** one workspace's offer, to ask about it (again) */
  globalsOffer(source: string): Promise<{ source: string; name: string; hash: string; summary: string[] } | null>;
  globalsPending(): Promise<Array<{ source: string; name: string; hash: string; summary: string[] }>>;
  /** the answer for one such offer: the workspaces that take it, and all the workspaces the question covered */
  globalsDecide(source: string, hash: string, apply: string[], asked: string[]): Promise<void>;
  globalsEnable(enabled: boolean): Promise<void>;
  /** create a page whose file name is the title with `.1`, `.2` … added until it is free; the content (and so the title) is as given */
  createPageNumbered(parent: string | null, name: string, content: string, mergeDefault?: boolean): Promise<string>;
  /** The YAML that Workspace Preferences edits as text. */
  getWorkspaceYaml(): Promise<Record<YamlSection, string>>;
  /** the export style sets other workspaces share with this one (`export-style: !global` there) */
  getInheritedExportStyles(): Promise<string>;
  /** the export style sets of this workspace (.cave-notes/export-styles.yaml) */
  getExportStyles(): Promise<string>;
  setExportStyles(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Save one part of it; text that is not valid is refused with the reason and nothing is written. */
  /** `warning`: saved, but something in it is not understood (a schema entry with a type or values it cannot use). */
  setWorkspaceYaml(section: YamlSection, text: string): Promise<{ ok: true; warning?: string } | { ok: false; error: string }>;
  /** The page to highlight in the tree for an open page: itself, or its nearest ancestor that is not hidden (null: none). */
  treeAnchor(path: string): Promise<string | null>;
  /** Put a page in front of `before` among its siblings (null = last) by giving the siblings `order` numbers. */
  reorderPage(path: string, before: string | null): Promise<{ written: number }>;
  getAppearance(): Promise<WorkspaceAppearance>;
  setAppearance(patch: Partial<WorkspaceAppearance>): Promise<WorkspaceAppearance>;
  readPage(path: string): Promise<PageData>;
  /**
   * Save a page. `baseHash` is the hash of the text this edit grew from; a different hash on disk means someone else
   * changed the file (a hash of one of this app's own earlier saves does not count). `deferIndex` answers as soon as
   * the file is written and refreshes the search index afterwards, so a busy index never delays a save.
   */
  writePage(path: string, text: string, baseHash: string | null, opts?: { deferIndex?: boolean }): Promise<WriteResult>;
  /** `template`: a template name to start from, null for none; left out, the parents' default template (if any) is used when no content is given */
  createPage(parent: string | null, name: string, content?: string, template?: string | null, mergeDefault?: boolean): Promise<string>;
  /** the templates usable for sub-pages of `parent` (null = top level) and the default one */
  /** make `.cave-notes` with its templates folder and any missing settings file (stubs that are only comments); answers its path */
  ensureConfigFolder(): Promise<string>;
  templatesFor(parent: string | null): Promise<{ templates: Array<{ name: string; where: string }>; default: string | null }>;
  /** what `page` would contain if made from the template; nothing is written */
  templateText(page: string, name: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** what `![[target#heading]]` on page `from` shows (`named`: `![[@target]]`) */
  /** Work out an expression from the text of page `path`: formulas, sums and counts over a query, values of other pages. */
  evaluateExpression(path: string | null, expr: string): Promise<{ ok: true; text: string; list: string[]; kind: 'number' | 'text' | 'date' | 'bool' | 'list' | 'empty' } | { ok: false; error: string }>;
  resolveEmbed(from: string, target: string, heading: string | null, named: boolean): Promise<{ ok: true; text: string; source: string } | { ok: false; error: string }>;
  /** change the source of an embed */
  saveEmbed(from: string, target: string, heading: string | null, named: boolean, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  promoteVirtual(path: string, content?: string): Promise<string>;
  planMove(from: string, newParent: string | null, newName?: string): Promise<LinkPlan>;
  applyPlan(plan: LinkPlan): Promise<ApplyResult>;
  undoLast(): Promise<{ id: string; restored: string[]; skipped: string[] }>;
  lastMove(): Promise<{ id: string; from: string; to: string } | null>;
  deleteInfo(path: string): Promise<DeleteInfo>;
  afterDelete(pages: string[]): Promise<void>;
  pageInfo(path: string): Promise<PageInfo | null>;
  links(path: string): Promise<LinkInfo[]>;
  backlinks(path: string): Promise<BacklinkInfo[]>;
  resolveLink(link: { syntax: 'md' | 'wiki'; target: string; fragment?: string | null }, fromPath: string): Promise<ResolvedLink>;
  suggestPages(query: string, limit?: number): Promise<PageSuggestion[]>;
  /** pages shown in the tree whose title or name contain every word of the query, as tree paths (the tree's find box) */
  findPagePaths(query: string, limit?: number): Promise<string[]>;
  search(query: string, opts?: { limit?: number; offset?: number }): Promise<SearchResponse>;
  /** Where a search and replace would change things, without changing anything. */
  replaceFind(req: ReplaceRequest): Promise<ReplaceFound>;
  /** Make the changes of the chosen matches and renames (the same request that was previewed). */
  replaceApply(req: ReplaceRequest, choices: ReplaceChoice[]): Promise<ReplaceDone>;
  attributeKeys(): Promise<AttributeKey[]>;
  attributeValues(key: string, query?: string): Promise<Array<{ value: string; type: string; count: number }>>;
  /** Pages matching a query with their attributes (null = all attributes), for database views. */
  /** `offset` and `limit` pick a page of the results; `colors` are rules whose queries colour the rows they match */
  queryView(query: string, attrs: string[] | null, limit?: number, offset?: number, colors?: Array<{ when: string; color: string }>): Promise<ViewData>;
  /** The saved queries and relations of the workspace. */
  savedQueries(): Promise<SavedQueries>;
  /** Save a query under a name in the workspace file (replacing one of that name). */
  saveQuery(name: string, query: string): Promise<SavedQueries>;
  /** Make the page's title say `title`: its first `# Heading` (or, when it has none, a frontmatter `title`). Nothing else changes. */
  setPageTitle(path: string, title: string): Promise<WriteResult>;
  /** Set (or remove, with null) one frontmatter attribute of a page, keeping the rest of the file as it is. */
  setAttribute(path: string, key: string, value: AttrValue | null): Promise<WriteResult>;
  /** Give a non-note file attributes through the `files:` block of `page` (null removes one). */
  setFileAttributes(page: string, filePath: string, attrs: Record<string, AttrValue | null>): Promise<WriteResult>;
  /** Move a non-note file into the folder of page `newParent` (null: top level); its listed attributes go with it. */
  moveFile(filePath: string, newParent: string | null): Promise<{ path: string; attributes: 'none' | 'moved' | 'left' }>;
  /** Fill an existing page from a template: its own content stays, the template adds what is missing. */
  mergeTemplateInto(page: string, name: string): Promise<WriteResult>;
  /** The attributes (frontmatter, minus `template`) a template would give a page. */
  templateAttributes(page: string, name: string): Promise<{ ok: true; attrs: Record<string, AttrValue> } | { ok: false; error: string }>;
  /** Change what a relation attribute names, and the other side of a mutual relation with it. Nothing is written when the answer is `conflicts`. */
  editRelation(req: RelationEditRequest): Promise<RelationEditResult>;
  /** Pages a relation could name for the text typed so far (titles starting with it), for the autocomplete. */
  relationCandidates(relation: string, side: 'forward' | 'back', text: string, exclude: string[]): Promise<RelationPage[]>;
  stats(): Promise<IndexStats>;
  /** How to treat sync conflict copies (Syncthing's `.sync-conflict-` files): merged in at once, asked about, or left alone. */
  setSyncOptions(opts: { conflictMerge: ConflictMerge }): Promise<void>;
  /** Merge every conflict copy found in the workspace into its page now. Returns how many were merged. */
  mergeConflictCopies(): Promise<number>;
  /** Remembered versions of a page, newest first. */
  historyList(path: string): Promise<HistoryEntry[]>;
  historyRead(path: string, id: string): Promise<string | null>;
  /** Remember a text (for example what is about to be discarded). */
  snapshot(path: string, text: string, source: HistoryEntry['source']): Promise<void>;
  /** Texts a page has had, newest first: candidates for the common ancestor of two diverged versions. */
  historyTexts(path: string, limit?: number): Promise<string[]>;
  getState(): Promise<WorkspaceState>;
  setState(patch: Partial<WorkspaceState>): Promise<void>;
  absolutePath(path: string): Promise<string>;
  /** Copy a file from anywhere into the folder of a page (so it becomes a child of it); a taken name gets `.1`, `.2` … `rel` is the path to write in a link in that page. */
  importFile(page: string, srcAbs: string): Promise<{ path: string; rel: string }>;
  /** `rel` (as `importFile` gives it) when the file already is in the folder of the page, where an import would put it; else null. Nothing needs copying then. */
  fileInPage(page: string, srcAbs: string): Promise<string | null>;
  /**
   * Put a file or folder from outside into the folder of `parent` (null = top level), moved or copied: `same` is the
   * action when it is on the same drive as the workspace, `other` when it is not. A taken name gets `.1`, `.2` …
   */
  importExternal(parent: string | null, srcAbs: string, actions: { same: 'move' | 'copy'; other: 'move' | 'copy' }): Promise<{ name: string; action: 'move' | 'copy' }>;
}

/** The tabs of one window, in order, so they come back at the next start. */
export interface WindowState {
  /** `single`: one Markdown file opened on its own (root is the file's path, path is its name) */
  tabs: Array<{ root: string; path: string | null; single?: boolean }>;
  activeTab: number;
  /** files given on the command line, to open once the tabs are back */
  files?: string[];
}

/** What a folder or file handed to the running app (command line, "open with") opens in. */
export type ExternalOpen = 'tab' | 'window';

/** The parts of a workspace's YAML that Workspace Preferences edits as text. */
export type YamlSection = 'attributes' | 'files' | 'queries' | 'relations' | 'schema' | 'automations';

export interface Settings {
  theme: 'dark' | 'light';
  recent: string[];
  lastWorkspace: string | null;
  showLeft: boolean;
  showRight: boolean;
  leftWidth: number;
  rightWidth: number;
  rightTab: 'outline' | 'links';
  /** keep the sub-page bar under the editor expanded */
  childrenDocked: boolean;
  bounds: { width: number; height: number } | null;
  /** the window was maximized when the app last closed (a new window starts that way) */
  maximized: boolean;
  /** collapse branches of the page tree that have nothing open in them any more */
  autoCollapse: boolean;
  /** ...after this many seconds */
  autoCollapseSeconds: number;
  /** where "New Page" puts the page: at the top level, beside the open page, or inside it */
  newPageDefault: 'top' | 'sibling' | 'nested';
  /** the default typeface of page text (a workspace can choose its own) */
  fontStyle: FontStyle;
  /** the default size in px of each of the three typefaces; null picks one that suits it */
  fontSizes: FontSizes;
  /** numbered-list items are listed in the outline sidebar too, under their heading, in a lighter colour */
  outlineOrderedLists: boolean;
  /** marker style of each level of a hierarchical numbered list: 1. a. A. i. I. (or with a closing bracket) */
  orderedListStyles: string[];
  /** the bullet drawn at each level of a hierarchical bulleted list */
  bulletGlyphs: string[];
  /** nested list items take the style of their level when they are indented or outdented */
  hierarchicalLists: boolean;
  /** wrap long lines in code blocks and plain-text files (off: they scroll sideways) */
  wrapCode: boolean;
  /** files dragged in from outside the app: moved or copied; `dropActionOtherDrive` 'same' follows `dropAction` */
  dropAction: 'move' | 'copy';
  dropActionOtherDrive: 'same' | 'move' | 'copy';
  /** the style sets you made for exporting pages (see core-export), the one used last, and the last format */
  exportStyles: Array<Record<string, unknown>>;
  exportStyle: string;
  exportFormat: 'docx' | 'odt' | 'pdf';
  /** accent colour (#rrggbb) for the tab and title bar of a workspace that has none of its own; null for none */
  defaultAccent: string | null;
  /** a folder or file opened from outside while Cave Notes is already running: in a new tab of the current window, or in a new window */
  openExternal: ExternalOpen;
  /** workspaces found by looking through the folders below (on top of the ones opened before) */
  found: string[];
  /** folders to look through for workspaces; none: the home folder */
  scanFolders: string[];
  /** folders (and everything in them) to leave out of that search */
  scanIgnore: string[];
  /** look for workspaces now and then in the background */
  scanAuto: boolean;
  /** the icon each workspace chose, remembered so menus can show it for workspaces that are not open */
  workspaceIcons?: Record<string, string>;
  /** file extensions (with the dot) that are notes, and the one new notes are made with; a workspace may choose its own */
  noteExts: string[];
  noteCreate: string;
  /** show a workspace that sits inside this one as a folder in the page tree */
  showNestedWorkspaces: boolean;
  /** keep folders that hold no notes out of the page tree (they stay in the sub-page bar) */
  hideBareFolders: boolean;
  /** open such a workspace in a new tab when it is chosen (otherwise it replaces the current tab) */
  nestedInNewTab: boolean;
  /** the sub-page bar lists notes only, or every file in the folder */
  childrenFilter: 'notes' | 'all';
  /** underline misspelt words in the editor and offer corrections in its right-click menu */
  spellcheck: boolean;
  /** right-clicking a single word offers synonyms to replace it with */
  synonyms: boolean;
  /** every workspace on this computer is opened in the background and kept indexed, so that what one asks of another is current */
  indexAllWorkspaces: boolean;
  /** words the spell checker accepts (the user's own dictionary; it travels in an exported settings file) */
  dictionary: string[];
  /** plugins turned off on this computer (from their dialogs), as `workspace folder|rule id`; they stay in the Plugins menu, dimmed, until turned on again */
  disabledPlugins: string[];
  /** AppImage updates: `install` downloads a newer one and puts it in place of this one, `notify` only says there is one, `off` never looks */
  updateMode: 'install' | 'notify' | 'off';
  /** where to look for updates instead of the project's GitHub releases: a GitHub repository address, or the address of a small JSON file (see docs/updates.md); empty: the default */
  updateUrl: string;
  /** when the last look for an update was made (milliseconds since 1970); this computer only */
  lastUpdateCheck: number;
  /** the screen a presentation is shown on: `auto` (a screen other than the one with the app, if there is one) or a screen's id */
  presentScreen: string;
  /** also open a presenter window (the next slide and the notes) */
  presenterWindow: boolean;
  /** the screen of the presenter window: `auto` (the screen with the app) or a screen's id */
  presenterScreen: string;
  /** the day weeks start on in calendars and in `$now.week` (0 = Sunday ... 6 = Saturday) */
  firstDayOfWeek: number;
  /** tables widen a column until no word is broken, but not past this many letters (longer words break) */
  tableWordLimit: number;
  /** use settings other workspaces offer to all workspaces (`!global`), after asking; off switches the feature off completely */
  globalsEnabled: boolean;
  /** what to do with Syncthing conflict copies: merge them into the page and delete them, ask the first time, or leave them */
  conflictMerge: ConflictMerge;
  /** automations may run shell commands (each new command still asks first). Off unless switched on here; never part of an exported settings file */
  automationShell: boolean;
  /** automations may run JavaScript (each new script still asks first unless `automationJsAsk` is off). Off unless switched on here; never part of an exported settings file */
  automationJs: boolean;
  /** ask before a rule's script runs for the first time, and again when it changes (on by default; this computer only) */
  automationJsAsk: boolean;
  /** keep running in the background (no window) so automations with times and dates still run; the app is then ended from its tray icon or by opening it again and quitting */
  automationBackground: boolean;
  /** how this computer is named in `devices:` of the automations file; empty: the computer's own name */
  deviceName: string;
  /** the open tabs of the (single) window of older versions; only read once, to migrate */
  tabs: Array<{ root: string; path: string | null }>;
  activeTab: number;
  /** one entry per open window, so every window comes back at the next start */
  windows: WindowState[];
}

/** One log the log screen can show. `all` is every one of them in turn (its path is empty). */
export interface LogSource {
  id: string;
  label: string;
  path: string;
}

/** Methods served by the Electron main process. */
/** What the updater is doing (see apps/desktop/src/main/update-manager.ts). */
export interface UpdateStatus {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  latest: string | null;
  notes: string | null;
  progress: number | null;
  message: string;
  lastCheck: number;
  canInstall: boolean;
}

export interface MainApi {
  chooseWorkspace(): Promise<string | null>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** A workspace is now open in a tab: allow its files to be shown and trashed. Returns the id used in cave-asset URLs. */
  attachWorkspace(root: string): Promise<{ id: string }>;
  /** No tab uses this workspace any more: stop its worker. */
  detachWorkspace(root: string): Promise<void>;
  openPath(absPath: string): Promise<string>;
  /** The app's own config folder (its plugins and templates, copied from what ships with the app), made when missing. */
  appConfigFolder(): Promise<string>;
  /** Show a file (one just exported, say) selected in the system file manager. */
  showInFolder(absPath: string): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  /** The app's version, and what the updater is doing. */
  updateStatus(): Promise<UpdateStatus>;
  /** Look for a newer AppImage now (the daily look happens by itself). */
  checkForUpdate(): Promise<UpdateStatus>;
  /** Download the newer AppImage that was found and put it in this one's place. */
  installUpdate(): Promise<UpdateStatus>;
  /** Start the app again (after an update was put in place). */
  restartApp(): Promise<void>;
  /** Is this folder a workspace, and which workspace (if any) is it inside? */
  workspaceStatus(folder: string): Promise<{ isWorkspace: boolean; containing: string | null }>;
  /** Make a folder a workspace of its own. `copySettingsFrom`: the workspace to take schema and shared settings from. */
  promoteFolder(folder: string, copySettingsFrom: string | null): Promise<void>;
  /** Delete a workspace's .cave-notes folder (it must not be open in any tab). */
  removeWorkspace(root: string): Promise<void>;
  /** Look for workspaces now; returns the list found. */
  scanWorkspaces(): Promise<string[]>;
  trash(absPaths: string[]): Promise<void>;
  setTitle(title: string): Promise<void>;
  setTheme(theme: 'dark' | 'light'): Promise<void>;
  closeNow(): Promise<void>;
  /** The tabs this window starts with. */
  getWindowInit(): Promise<WindowState>;
  /** This window's tabs changed: remember them. */
  setWindowTabs(tabs: WindowState['tabs'], activeTab: number): Promise<void>;
  /** Is this path a file (not a folder)? Used to tell "open a file" from "open a folder". */
  isFile(absPath: string): Promise<boolean>;
  /** The folder holding the built-in documentation (opened as a read-only workspace). */
  docsFolder(): Promise<string>;
  /** The logs there are now (the application log, and the automation log of each open workspace) and the folder that holds the application log. */
  logSources(): Promise<{ dir: string; sources: LogSource[] }>;
  /** The text of one log (the end of it, when it is large), or of all of them (`all`). */
  readLog(id: string): Promise<{ id: string; label: string; text: string }>;
  /** Open a new window, optionally showing one tab. */
  newWindow(tab?: { root: string; path: string | null; single?: boolean } | null): Promise<void>;
  /** A tab was dragged out of this window and dropped at a screen position: hand it to the Cave Notes window there, or to a new one. */
  moveTabToWindow(tab: { root: string; path: string | null; single?: boolean }, screenX: number, screenY: number): Promise<void>;
  /**
   * The Run button of a code block marked sh, bash, zsh or shell. The first time in a workspace the person is asked whether to run
   * scripts from it (the answer is kept in the app's data folder). The script runs in the page's folder; the answer holds its exit code and output.
   */
  runScript(root: string, page: string, code: string, lang: string, terminal?: boolean): Promise<{ ran: boolean; code?: number | null; output?: string; timedOut?: boolean; stopped?: boolean; reason?: string; terminal?: boolean }>;
  /** Stop the script this window is running. */
  stopScript(): Promise<void>;
  /** Forget which commands automations may run and which workspaces may run scripts (Preferences). */
  forgetScriptApprovals(): Promise<void>;
  /** Show a file or folder of an open workspace in the system file manager. Returns an error message, or '' when done. */
  revealPath(absPath: string): Promise<string>;
  /** The icon the system shows for a file inside an open workspace, as a data address (null if there is none). */
  fileIcon(absPath: string): Promise<string | null>;
  /** Colour of this window's title bar (and so of the window buttons drawn on it); null for the theme's own. */
  setHeaderColor(color: string | null): Promise<void>;
  /** Ask where to save, and write the preferences (not tabs, windows or recent folders) there. False if cancelled. */
  exportSettings(): Promise<boolean>;
  /** Make a Word, OpenDocument or PDF file of a page and ask where to save it. Resolves to the saved path, or null if cancelled. */
  /** the export style sets kept for all workspaces (YAML text; empty if there is none yet) */
  getGlobalExportStyles(): Promise<string>;
  setGlobalExportStyles(text: string): Promise<void>;
  /** the bundled fonts: their families and where the files are (a folder URL, for @font-face) */
  bundledFonts(): Promise<{ url: string; families: Array<{ family: string; files: Array<{ file: string; weight: number; italic: boolean }> }> }>;
  /** copy the bundled fonts to a folder the person picks; the folder, or null if cancelled */
  saveFonts(): Promise<string | null>;
  /** install the bundled fonts for this user (~/.local/share/fonts); a message saying how it went */
  installFonts(): Promise<string>;
  /** Save a presentation made by the renderer as a PDF or an HTML file (images are put inside the file); null if cancelled. */
  /** The screens of this computer. */
  getDisplays(): Promise<Array<{ id: string; label: string; primary: boolean; width: number; height: number; hasApp: boolean }>>;
  /** Show a presentation full screen in its own window (and the presenter's window, if asked for). Resolves when it is closed. */
  presentStart(req: { html: string; presenterHtml: string | null; screen: string; presenterScreen: string }): Promise<void>;
  exportPresentation(req: { html: string; format: 'pdf' | 'html'; defaultName: string }): Promise<string | null>;
  exportDocument(req: { format: 'docx' | 'odt' | 'pdf'; markdown: string; title: string; style: Record<string, unknown>; defaultName: string }): Promise<string | null>;
  /** Ask for a settings file and apply it. Returns what was applied, or null if cancelled. Throws if the file is not a settings file. */
  importSettings(): Promise<Partial<Settings> | null>;
}

/** Events carry the root of the workspace they come from as a second argument (see RawBridge.on). */
export interface WorkerEvents {
  /** (main process only) an automation wants a system notification. */
  'automation:notify': { title: string; body: string; path: string | null };
  /** (main process only) an automation wants to run a shell command. The answer comes back through `automationShellResult`. */
  'automation:shell': { id: string; root: string; spec: { ruleId: string; command: string | null; argv: string[] | null; cwd: string | null; timeoutMs: number; env: Record<string, string>; page: string; template: { command: string | null; argv: string[] | null; cwd: string | null; env: Record<string, unknown> } } };
  /** (main process only) an automation wants to run a script. The answer comes back through `automationJsResult`. */
  'automation:js': { id: string; root: string; ruleId: string; code: string; page: string };
  /** An automation rule ran (not a dry run) and did something, or failed. Shown as a message. */
  'automation:ran': { rule: string; path: string | null; status: 'done' | 'failed'; detail: string; steps: Array<{ action: string; status: string; detail: string }> };
  /** (main process only) whether this workspace has automations, and whether some of them depend on the clock. */
  'automation:active': { active: boolean; timed: boolean };
  /** Children of these pages changed on disk (or everything, after indexing). */
  'tree:changed': { parents: Array<string | null> | 'all' };
  /** A page file changed on disk (hash is null when it was deleted). */
  'page:changed': { path: string; hash: string | null };
  /** The index has new data for this page (after a save or a change on disk). */
  'index:updated': { path: string | null };
  'index:status': { state: 'indexing' | 'ready'; pages: number; files?: number; ms?: number; /** 0-100 while indexing, 100 when ready */ percent?: number; /** what the index is doing now */ phase?: 'scan' | 'parse' | 'finish' | 'ready' };
  /** A page file was moved or renamed on disk (same content, new place). */
  'page:moved': { from: string; to: string; hash: string };
  /** Sync conflict copies were found and the setting says to ask first: the pages they belong to. */
  'sync:conflicts': { pages: string[] };
  /** A conflict copy was merged into its page (and removed). `conflicts` counts spots where both versions were kept. */
  'sync:merged': { path: string; conflicts: number };
}

export interface WindowEvents {
  /** Another window changed these settings. */
  'settings:changed': Partial<Settings>;
  /** A tab was dropped on this window from another one. */
  'window:adopt-tab': { root: string; path: string | null; single?: boolean };
  /** A file was handed to the running app (command line, "open with"). */
  'window:open-file': { path: string };
}

export interface MenuEvents {
  'menu:open-folder': undefined;
  'menu:new-page': undefined;
  'menu:toggle-left': undefined;
  'menu:toggle-right': undefined;
  'menu:toggle-theme': undefined;
  'menu:export': undefined;
  'menu:undo-move': undefined;
  'menu:preferences': undefined;
  'menu:new-tab': undefined;
  'menu:close-tab': undefined;
  'menu:next-tab': undefined;
  'menu:shortcuts': undefined;
  'menu:documentation': undefined;
  'menu:logs': undefined;
  'menu:about': undefined;
  'menu:prev-tab': undefined;
  'app:before-close': undefined;
  /** the updater's state changed */
  'app:update': UpdateStatus;
}

export type EventMap = WorkerEvents & MenuEvents & WindowEvents;

/**
 * What this platform can do, so the shared window can leave out what would only fail. Desktop has all of it; the Android app
 * lists what it has (see DESKTOP_CAPABILITIES for the meaning of each). A missing entry counts as false.
 */
export interface Capabilities {
  /** more than one window, and dragging a tab out into another */
  windows: boolean;
  /** show a file in the file manager, open it in the program that handles it, ask the system for a file's icon */
  systemFileActions: boolean;
  /** run shell scripts from code blocks and shell commands from automations */
  shell: boolean;
  /** JavaScript rules in automations */
  scriptRules: boolean;
  /** export a page as Word, OpenDocument or PDF */
  exportDocuments: boolean;
  /** several workspaces open at once, found by scanning the disk, with links between them */
  multiWorkspace: boolean;
  /** pages changed by other programs show up by themselves (a file watcher) */
  fileWatching: boolean;
  /** a hardware keyboard and mouse are expected (shortcuts, hover, right-click) */
  keyboardAndMouse: boolean;
}

export const DESKTOP_CAPABILITIES: Capabilities = {
  windows: true,
  systemFileActions: true,
  shell: true,
  scriptRules: true,
  exportDocuments: true,
  multiWorkspace: true,
  fileWatching: true,
  keyboardAndMouse: true,
};

/** What the preload script exposes as window.cave: a raw, whitelisted pipe. The renderer wraps it in typed proxies. */
export interface RawBridge {
  /** `root` says which workspace a 'ws' call is for. */
  invoke(kind: 'main' | 'ws', method: string, args: unknown[], root?: string): Promise<Envelope<unknown>>;
  /** `root` is the workspace an event came from (undefined for menu events). */
  on(event: string, cb: (payload: unknown, root?: string) => void): () => void;
  platform: string;
  /** The path on disk of a file dropped onto the window (empty when it has none). */
  pathForFile?(file: File): string;
  /** Spell checker of the window: suggestions for a misspelt word, null when the word is fine or checking is off. */
  spell?: { suggestions(word: string): string[] | null };
}

export const MAIN_METHODS = [
  'chooseWorkspace', 'getSettings', 'setSettings', 'attachWorkspace', 'detachWorkspace', 'openPath', 'appConfigFolder', 'showInFolder', 'openExternal', 'updateStatus', 'checkForUpdate', 'installUpdate', 'restartApp',
  'workspaceStatus', 'promoteFolder', 'removeWorkspace', 'scanWorkspaces', 'trash', 'setTitle', 'setTheme', 'closeNow', 'getWindowInit', 'setWindowTabs', 'newWindow', 'moveTabToWindow', 'revealPath', 'fileIcon', 'runScript', 'stopScript', 'forgetScriptApprovals', 'setHeaderColor', 'exportSettings', 'exportDocument', 'exportPresentation', 'getDisplays', 'presentStart', 'getGlobalExportStyles', 'setGlobalExportStyles', 'bundledFonts', 'saveFonts', 'installFonts', 'importSettings', 'isFile', 'docsFolder', 'logSources', 'readLog',
] as const satisfies ReadonlyArray<keyof MainApi>;

export const WORKER_METHODS = [
  'openWorkspace', 'closeWorkspace', 'listChildren', 'listFiles', 'filePath', 'getNoteTypes', 'setNoteTypes', 'applyAppNoteTypes', 'setFirstDay', 'syncFolder', 'duplicatePage', 'pageSource', 'copyPageIn', 'pageNameTaken', 'attributeSources', 'templatesFor', 'ensureConfigFolder', 'templateText', 'resolveEmbed', 'evaluateExpression', 'saveEmbed', 'globalsPending', 'globalsOffer', 'globalsDecide', 'globalsEnable', 'createPageNumbered', 'getWorkspaceYaml', 'setWorkspaceYaml', 'getExportStyles', 'setExportStyles', 'rescan', 'refreshIndex', 'treeAnchor', 'reorderPage', 'getAppearance', 'setAppearance', 'readPage', 'writePage', 'createPage', 'promoteVirtual',
  'planMove', 'applyPlan', 'undoLast', 'lastMove', 'deleteInfo', 'afterDelete', 'pageInfo', 'links', 'backlinks',
  'resolveLink', 'suggestPages', 'findPagePaths', 'getInheritedExportStyles', 'search', 'replaceFind', 'replaceApply', 'attributeKeys', 'attributeValues', 'queryView', 'savedQueries', 'saveQuery', 'setAttribute', 'setFileAttributes', 'moveFile', 'mergeTemplateInto', 'templateAttributes', 'editRelation', 'relationCandidates', 'setPageTitle', 'stats', 'getState', 'setState',
  'absolutePath', 'importFile', 'fileInPage', 'importExternal', 'setSyncOptions', 'mergeConflictCopies', 'historyList', 'historyRead', 'snapshot', 'historyTexts',
  'automationStatus', 'automationRulesFor', 'automationLog', 'automationRun', 'automationButton', 'automationPlugins', 'uninstallPlugin', 'restoreDefaultPlugins', 'automationPluginAsk', 'automationPlugin', 'automationReload',
] as const satisfies ReadonlyArray<keyof WorkerApi>;

/** One question of a plugin (`ask:` of a rule). */
export interface PluginAsk {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'info';
  default: string | number | boolean | null;
  options: string[] | null;
  min: number | null;
  max: number | null;
}

/** A rule listed in the Plugins menu. */
export interface PluginInfo {
  id: string;
  label: string;
  ask: PluginAsk[];
  /** a plugin another workspace offers to all that this one has not accepted: choosing it asks first */
  pending?: { source: string; name: string };
  /** `workspace`: written in this workspace's settings (or accepted from another); `default`: comes with the app (see the app config folder) */
  origin?: 'workspace' | 'default';
  /** for a default plugin: its file in the app config folder, such as `plugins/number-headings.yaml` */
  file?: string;
}

export interface UninstallResult {
  ok: boolean;
  /** a sentence for the person */
  message: string;
}

export interface PluginResult {
  status: 'done' | 'failed' | 'skipped' | 'refused';
  detail: string;
  /** the text after the plugin (the same as it was given when nothing changed) */
  text: string;
  changed: boolean;
  /** where the script left the cursor or selection, as offsets in the returned text (null: leave it where it is) */
  selection?: { anchor: number; head: number } | null;
}

export const EVENT_NAMES = [
  'tree:changed', 'page:changed', 'index:updated', 'index:status', 'page:moved', 'sync:conflicts', 'sync:merged', 'automation:ran',
  'settings:changed', 'window:adopt-tab', 'window:open-file',
  'menu:open-folder', 'menu:new-page', 'menu:toggle-left', 'menu:toggle-right', 'menu:toggle-theme', 'menu:export',
  'menu:undo-move', 'menu:preferences', 'menu:new-tab', 'menu:close-tab', 'menu:next-tab', 'menu:prev-tab', 'menu:shortcuts', 'menu:documentation', 'menu:logs', 'menu:about', 'app:before-close', 'app:update',
] as const satisfies ReadonlyArray<keyof EventMap>;

/** Serializable error crossing a process boundary. */
export interface WireError {
  message: string;
  code?: string;
  name?: string;
  details?: unknown;
}

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: WireError };
