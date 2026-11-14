import type { Annotation } from '@cave-notes/editor';
import type { CanvasView } from '@cave-notes/ui-canvas';
import { computed, effect, signal } from '@preact/signals';
import type { EditorState } from '@codemirror/state';
import { CONFLICT_OPEN, mergeDocuments, pickBase, textChanges } from '@cave-notes/core-sync/pure';
import { BackgroundIndexer } from './background';
import { type FollowableLink, NoteEditor, type OutlineItem, type SpellHost, type ThesaurusHost, findFirstH1 } from '@cave-notes/editor';
import { SearchSession, setSort, toggleToken, type SessionState } from '@cave-notes/ui-search';
import { type DropPlan, type DropZone, TreeModel, type TreeAction } from '@cave-notes/ui-tree';
import { expandSaved, newPageContent, newPageDefaults, placementOf, savedViewTemplate, sortRowsBy, splitForeign, withoutSort, type Row } from '@cave-notes/ui-views';
import YAML from 'yaml';
import { BUILTIN_STYLES, countWords, imagesInLines, paginate, parseDoc, renderHtml, splitSlides, withImageAttrs, type ImageAttrs, type ImageRef, cleanRules, cleanStyleSet, editorCss, namedList, parseStyleSetsYaml, renderSlidesHtml, SLIDE_PT, setSlideLayout, slideCss, themeWarnings, themesFromConfig, type PlacedSlide, type SlideTheme, type StyleSet } from '@cave-notes/core-export';
import type { ReplaceFound, FileItem, PageSource, NoteTypes, WindowState, ApplyResult, AttrValue, AttributeKey, AutomationRuleHit, BacklinkInfo, ConflictMerge, FontKind, FontStyle, HistoryEntry, LinkInfo, LinkPlan, MainApi, PageSuggestion, RelationConflict, RelationPage, RelationResolution, SavedQueries, SearchResult, Settings, TreeItem, ViewData, ViewRow, WorkerApi, WorkerEvents, WorkspaceAppearance, WorkspaceInfo, YamlSection, PluginInfo, PluginAsk, UpdateStatus, ImportKind, ImportRequest, ImportResult } from '../shared/api';
import { type Deps, capabilitiesOf, explain } from './bridge';
import { accentRoles, headerColorFor } from './color';
import { drawerPane, narrow } from './layout';
import { isNoteName, pageTitleOf, parseNoteTypes, relativeLinkPath, stripExt } from './paths';

export type Theme = 'dark' | 'light';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export type DialogSpec =
  | { kind: 'globals'; offers: Array<{ source: string; name: string; hash: string; summary: string[] }>; workspaces: string[]; current: string }
  | { kind: 'help'; page?: HelpPage }
  | { kind: 'plugins' }
  | { kind: 'import'; what: ImportKind }
  | { kind: 'prompt'; title: string; body?: string; label: string; value: string; confirm: string; /** an extra drop-down under the text box; its choice is the second argument of `submit` */ select?: { label: string; options: Array<{ label: string; value: string }>; value: string }; submit: (value: string, choice?: string) => Promise<string | null> }
  | { kind: 'confirm'; title: string; body: string; details?: string[]; confirm: string; destructive?: boolean; /** a tick box; `apply` runs when the dialog is confirmed with it ticked */ check?: { label: string; apply: () => void }; resolve: (ok: boolean) => void }
  | { kind: 'plugin-ask'; plugin: PluginInfo | null; title: string; fields: PluginAsk[]; confirm: string; submit: (answers: Record<string, unknown>) => Promise<string | null> }
  | { kind: 'plan'; title: string; plan: LinkPlan; confirm: string; resolve: (ok: boolean) => void }
  | { kind: 'choose'; title: string; body: string; options: Array<{ label: string; detail?: string; value: string }>; /** a tick box; `apply` gets the option picked when it was ticked (not for Cancel) */ remember?: { label: string; values: string[]; apply: (value: string) => void }; resolve: (value: string | null) => void }
  | { kind: 'preferences'; tab?: 'app' | 'workspace'; page?: string }
  | { kind: 'export'; markdown: string; title: string; path: string }
  | { kind: 'presentation'; present: boolean }
  | { kind: 'history'; path: string }
  | { kind: 'transfer'; paths: string[]; mode: 'move' | 'copy' }
  | { kind: 'export-styles' }
  | { kind: 'exported'; path: string }
  | { kind: 'page-icon'; path: string };

export type NewPageMode = 'top' | 'sibling' | 'nested';

/** The pages of the Help window. */
export type HelpPage = 'docs' | 'shortcuts' | 'logs' | 'about';

/** One tab: a page (or none yet) of one workspace. */
export interface Tab {
  id: string;
  /** the workspace folder, or for a single file opened on its own the file's own path */
  root: string;
  path: string | null;
  single?: boolean;
}

/** The pages a tab has shown, for the back and forward buttons. */
interface Nav {
  entries: string[];
  index: number;
  /** the last step was a quick one (arrowing through the tree): the next quick step replaces it */
  soft: boolean;
  at: number;
}

/** A page name made from a title: what a file name cannot hold is dropped (so are question marks and a trailing dot; the title keeps them). */
export function nameFromTitle(title: string): string {
  return title.replace(/\?/g, '').replace(/[/\\\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/\.+$/, '').trim();
}

/** A workspace that is open in at least one tab. */
/** What the index is doing: shown in the file tree header. */
export interface IndexInfo { state: 'indexing' | 'ready'; pages: number; files?: number; percent?: number; phase?: string }

/** One progress bar under the page tree: a workspace and how far its index is. */
export interface IndexBar { root: string; name: string; color: string | null; index: IndexInfo; front: boolean }

interface Session {
  root: string;
  info: WorkspaceInfo;
  ws: WorkerApi;
  tree: TreeModel;
  /** host name of its cave-asset URLs */
  assetId: string;
  index: IndexInfo;
  /** one Markdown file opened on its own: no page tree, no sub-pages */
  single: boolean;
  /** a workspace's `.cave-notes` folder opened to edit its files: no search, templates or workspace settings */
  config: boolean;
  /** the built-in documentation: read only, shown fully rendered */
  docs: boolean;
  lastMove: boolean;
  expandedTimer: ReturnType<typeof setTimeout> | null;
}

const EMPTY_LOOK: WorkspaceAppearance = { color: null, icon: null, fontStyle: null, fontSizes: { sans: null, serif: null, mono: null } };

/** Text size (px) of each typeface when none is chosen: Libertinus Serif sets a little smaller than the interface font, so it gets a little more; code is a touch smaller than the page text. */
export const AUTO_FONT_SIZE = { sans: 17, serif: 18.5, mono: 15 } as const;

export interface CurrentPage {
  path: string;
  /** false for a virtual page: a folder that has no page file yet */
  exists: boolean;
}

const AUTOSAVE_MS = 700;
/** A save that has had no answer after this long is given up on (see queueSave). */
const SAVE_TIMEOUT_MS = 20_000;
const STATE_CACHE = 30;

/** Replace the `from` page (or anything under its folder) by the matching path under `to`. */
export function mapPath(p: string, from: string, to: string): string {
  if (p === from) return to;
  const folder = stripExt(from);
  return p.startsWith(`${folder}/`) ? stripExt(to) + p.slice(folder.length) : p;
}

/** What a table remembers about relation links that cannot be made on both sides (`relationFiles` of the view), and how to remember a new answer. */
export interface RelationMemory {
  mode?: 'link' | 'skip' | null;
  remember?: (mode: 'link' | 'skip') => void;
}

export class Controller {
  // ---- UI state
  readonly settings = signal<Settings>({
    theme: 'dark', recent: [], found: [], scanFolders: [], scanIgnore: [], scanAuto: true, noteExts: ['.md'], noteCreate: '.md', showNestedWorkspaces: true, hideBareFolders: false, nestedInNewTab: true, childrenFilter: 'all', spellcheck: true, fixCapitals: true, synonyms: true, indexAllWorkspaces: true, dictionary: [], disabledPlugins: [], updateMode: 'install', updateUrl: '', lastUpdateCheck: 0, presentScreen: 'auto', presenterWindow: false, presenterScreen: 'auto', firstDayOfWeek: 0, tableWordLimit: 22, globalsEnabled: true,
    lastWorkspace: null, showLeft: true, showRight: true, leftWidth: 280, rightWidth: 300, rightTab: 'outline', childrenDocked: false, bounds: null, maximized: false,
    autoCollapse: true, autoCollapseSeconds: 10, newPageDefault: 'nested', fontStyle: 'sans', fontSizes: { sans: null, serif: null, mono: null }, outlineOrderedLists: true, orderedListStyles: ['I.', 'A.', '1.', 'a.', 'i.', '1)', 'a)', 'i)'], bulletGlyphs: ['\u2022', '\u25E6', '\u25AA'], hierarchicalLists: true, wrapCode: false, dropAction: 'move', dropActionOtherDrive: 'same', exportStyles: [], exportStyle: 'Clean', exportFormat: 'docx', defaultAccent: null, conflictMerge: 'ask', automationShell: false, automationJs: false, automationJsAsk: true, automationBackground: false, deviceName: '', openExternal: 'tab', tabs: [], activeTab: 0, windows: [],
  });
  // ---- tabs and workspaces
  readonly tabs = signal<Tab[]>([]);
  readonly activeTabId = signal<string | null>(null);
  /** accent colour and icon of every open workspace, by root */
  readonly looks = signal<Record<string, WorkspaceAppearance>>({});
  readonly workspace = signal<WorkspaceInfo | null>(null);
  readonly current = signal<CurrentPage | null>(null);
  readonly saveState = signal<'saved' | 'dirty' | 'saving' | 'conflict'>('saved');
  readonly conflict = signal<{ diskHash: string | null } | null>(null);
  readonly outline = signal<OutlineItem[]>([]);
  /** The canvas on screen (when the open page is a `.canvas`), for the objects and properties in the right sidebar. */
  readonly canvasView = signal<CanvasView | null>(null);
  /** Counts up whenever that canvas, its selection or its mode changes, so panes that show it redraw. */
  readonly canvasTick = signal(0);
  private canvasUnsub: (() => void) | null = null;
  setCanvasView(cv: CanvasView, present: boolean): void {
    if (!present) {
      if (this.canvasView.value !== cv) return;
      this.canvasUnsub?.();
      this.canvasUnsub = null;
      this.canvasView.value = null;
    } else {
      this.canvasUnsub?.();
      this.canvasView.value = cv;
      this.canvasUnsub = cv.subscribe(() => void this.canvasTick.value++);
    }
    this.canvasTick.value++;
  }
  readonly activeHeading = signal(-1);
  /** the theme the open page's front matter names with `presentationTheme:`; null when the page is not a presentation */
  readonly presentationTheme = signal<string | null>(null);
  /** Words, and (when the page names an `exportStyle`) pages or (in a presentation) slides, of the open page: shown under the outline. */
  readonly docStats = signal<{ path: string; words: number; pages: number | null; slides: number | null; style: string | null; missing: boolean }>({ path: '', words: 0, pages: null, slides: null, style: null, missing: false });
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private statsRun = 0;
  private exportYamlRoot: string | null = null;
  /** an `exportStyle` the page gets from the pages above it (`children:`), asked of the index once per page */
  private inheritedStyle: { path: string; value: string | null } | null = null;
  /** the page is scrolled well down (shows the return-to-top button) */
  readonly scrolledDown = signal(false);
  /** the page tree's find box: null while closed; `hits` are tree paths, `index` the one that Enter would open */
  readonly treeFind = signal<{ query: string; hits: string[]; index: number } | null>(null);
  /** branches the find box opened itself (and so may close again), as opposed to those the person had open */
  private findOpened = new Set<string>();
  private findSeq = 0;
  readonly links = signal<LinkInfo[]>([]);
  /** The automation rules whose criteria the open page meets (shown by the indicator in the editor's corner). */
  readonly automationHits = signal<{ path: string; hits: AutomationRuleHit[] }>({ path: '', hits: [] });
  readonly backlinks = signal<BacklinkInfo[]>([]);
  readonly indexStatus = signal<IndexInfo>({ state: 'ready', pages: 0 });
  /** bumped whenever any workspace's index progress (or the set of open workspaces) changes: the bars under the tree redraw */
  readonly indexTick = signal(0);
  readonly toasts = signal<Toast[]>([]);
  readonly dialog = signal<DialogSpec | null>(null);
  /** The menu of a right-clicked link in the editor (null: none). */
  /** the right-click menu of a page, wherever pages are listed (tree, sub-page bar, search, views) */
  /** the right-click menu of a file that is not a note (in the sub-page bar): the file and the page whose bar it is in */
  readonly fileMenu = signal<{ x: number; y: number; file: FileItem; page: string } | null>(null);
  /** The popover of a page's indicator dot in the tree (`indicatorText:`): its text, with the ways to get rid of it. */
  readonly indicatorPop = signal<{ x: number; y: number; path: string; text: string } | null>(null);
  /** The CriticMarkup highlights and comments of the open page (the Annotations tab of the right sidebar). */
  readonly annotations = signal<Annotation[]>([]);
  /**
   * Something that keeps the window from being used for a while (opening a big workspace, say): a small dialog with a progress
   * circle says what is going on. It only shows once the wait has lasted a moment, so quick things do not make it flash.
   */
  readonly busy = signal<{ label: string; fraction: number | null } | null>(null);
  private readonly busyStack: Array<{ label: string; fraction: number | null }> = [];

  async withBusy<T>(label: string, fn: (set: (fraction: number | null, label?: string) => void) => Promise<T>, delayMs = 400): Promise<T> {
    const token = { label, fraction: null as number | null };
    let shown = false;
    const publish = (): void => {
      const top = this.busyStack[this.busyStack.length - 1];
      this.busy.value = top ? { label: top.label, fraction: top.fraction } : null;
    };
    const timer = setTimeout(() => {
      shown = true;
      this.busyStack.push(token);
      publish();
    }, delayMs);
    const set = (fraction: number | null, l?: string): void => {
      token.fraction = fraction;
      if (l) token.label = l;
      if (shown) publish();
    };
    try {
      return await fn(set);
    } finally {
      clearTimeout(timer);
      if (shown) {
        const i = this.busyStack.indexOf(token);
        if (i >= 0) this.busyStack.splice(i, 1);
        publish();
      }
    }
  }

  readonly pageMenu = signal<{ x: number; y: number; path: string; workspace?: string; paths?: string[] } | null>(null);
  /** the pages ticked with Ctrl or Shift in the page tree or the sub-page bar (empty: just the one that is open or selected) */
  readonly multi = signal<string[]>([]);
  /** where a Shift-click range starts */
  multiAnchor: string | null = null;
  /** the pages being dragged together (more than one), for the tree and the sub-page bar to drop */
  dragPaths: string[] = [];
  readonly linkMenu = signal<{ x: number; y: number; link: FollowableLink; target: { kind: 'page'; path: string } | { kind: 'file'; abs: string } | { kind: 'broken' } } | null>(null);
  readonly treeTick = signal(0);
  readonly lastMoveAvailable = signal(false);
  readonly theme = computed(() => this.settings.value.theme);
  /** colour the header bar takes on: the accent of the shown tab's workspace, blended into the theme's header colour (null: the theme's own) */
  readonly headerColor = computed(() => {
    const tab = this.tabs.value.find((t) => t.id === this.activeTabId.value);
    return tab ? headerColorFor(this.settings.value.theme, this.accentOf(tab.root)) : null;
  });
  /** the colour a workspace's tabs wear: its own, else the preference */
  accentOf(root: string): string | null {
    return this.looks.value[root]?.color ?? this.settings.value.defaultAccent;
  }

  // ---- sub-pages bar and database views
  /** direct children of the open page */
  readonly children = signal<TreeItem[]>([]);
  /** files in the open page's folder that are not notes (images, documents ...) */
  readonly folderFiles = signal<FileItem[]>([]);
  /** The system's icon for each kind of file (by extension) shown in the sub-page bar; kinds without one use the app's own icon. */
  readonly fileIcons = signal<Record<string, string>>({});
  private iconAsked = new Set<string>();
  /** the workspace that holds the file shown on its own (null: none, or it is not in one) */
  readonly fileWorkspace = signal<string | null>(null);
  /** the editor is scrolled as far down as it goes (or has nothing to scroll) */
  readonly atBottom = signal(true);
  /** bumped (debounced) whenever the index changed, so views re-run their queries */
  readonly viewTick = signal(0);
  /** bumped when the source of an embed (`![[…]]`) was edited, so every embed redraws */
  readonly embedTick = signal(0);
  private viewTickTimer: ReturnType<typeof setTimeout> | null = null;
  private childrenSeq = 0;

  // ---- search (M7)
  readonly searchOpen = signal(false);
  /** unlisted pages (templates among them) are shown in the page tree (they are hidden from it otherwise) */
  readonly showTemplates = signal(false);
  /** which pane of the left sidebar each tab was showing (true: search), so a tab comes back to its own */
  private readonly tabSearchPane = new Map<string, boolean>();
  /** which right-sidebar pane (outline or links) each tab last had open */
  private readonly tabRightPane = new Map<string, 'outline' | 'links' | 'annotations'>();
  /** which sidebars each tab had open, and how wide: a tab (and a window) keeps its own; a new tab starts like the one it came from */
  /** which branches of the page tree each tab had open: tabs of one workspace do not share them, and a new tab starts with its source's */
  private readonly tabExpanded = new Map<string, string[]>();
  private readonly tabSidebars = new Map<string, Pick<Settings, 'showLeft' | 'showRight' | 'leftWidth' | 'rightWidth'>>();
  readonly searchQuery = signal('');
  readonly searchSel = signal(0);
  /** bumped to ask the search box to take focus */
  readonly searchFocusTick = signal(0);
  readonly searchState = signal<SessionState<SearchResult>>({ query: '', loading: false, results: [], total: null, errors: [], searched: false, failure: null });
  readonly facetKeys = signal<AttributeKey[]>([]);

  // ---- search and replace (the search pane's Replace part)
  /** what is being looked for and where; `found` is the preview, `picked` the matches that will be changed (`path`+NUL+id, or `path`+NUL+name) */
  readonly replaceState = signal<{
    on: boolean;
    find: string;
    replace: string;
    regex: boolean;
    matchCase: boolean;
    wholeWord: boolean;
    kinds: { text: boolean; headings: boolean; attributes: boolean; code: boolean };
    names: boolean;
    found: ReplaceFound | null;
    loading: boolean;
    failure: string | null;
    picked: Set<string>;
    /** the search pane's own search picks the pages (empty: all) */
  }>({ on: false, find: '', replace: '', regex: false, matchCase: false, wholeWord: false, kinds: { text: true, headings: true, attributes: true, code: true }, names: false, found: null, loading: false, failure: null, picked: new Set() });
  private replaceSeq = 0;
  private replaceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly session: SearchSession<SearchResult>;
  private searchRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- collaborators
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Map<string, Promise<Session>>();
  private active: Session | null = null;
  private readonly noTree = new TreeModel({ load: async () => [] });
  private tabSeq = 1;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------- every workspace, indexed in the background

  /** Calls waiting for the index of a session to be ready. */
  private readonly indexWaiters = new Map<Session, Array<() => void>>();
  /** when a view here last asked a workspace other than this one: only then does a change over there matter to what is shown */
  private foreignAskedAt = 0;
  private otherTickTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves when the session's index is ready (at once for none), or after five minutes whatever it is doing. */
  private whenIndexed(sess: Session | null): Promise<void> {
    if (!sess || sess.index.state === 'ready') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 5 * 60_000);
      const list = this.indexWaiters.get(sess) ?? [];
      list.push(done);
      this.indexWaiters.set(sess, list);
    });
  }

  private readonly background = new BackgroundIndexer({
    list: async () => {
      const s = this.settings.value;
      return [...new Set([...s.recent, ...s.found])];
    },
    open: async (root) => {
      // only a folder that still is a workspace: opening a plain folder here would make it one
      if (!(await this.main.workspaceStatus(root)).isWorkspace) throw new Error('it is not a workspace any more');
      const sess = await this.ensureSession(root);
      if (sess.single || sess.config || sess.docs) throw new Error('it is not a workspace');
      await this.whenIndexed(sess);
    },
    refresh: async (root) => {
      const sess = this.sessions.get(root);
      // (the workspace in front is left alone: its own watcher keeps it current, and a look would show as indexing in its header)
      if (sess && sess !== this.active && !sess.single && !sess.config && !sess.docs) await sess.ws.refreshIndex();
    },
    frontReady: () => this.whenIndexed(this.active),
    enabled: () => this.settings.value.indexAllWorkspaces,
  });

  /** The setting was switched: start keeping every workspace indexed, or stop and close the ones only kept for that. */
  private applyBackgroundSetting(): void {
    if (this.settings.value.indexAllWorkspaces) {
      this.background.start();
      this.background.poke();
      return;
    }
    this.background.stop();
    for (const root of this.background.release()) {
      if (!this.tabs.value.some((t) => t.root === root)) void this.releaseSession(root);
    }
  }
  /** a page is being dragged in the tree: do not collapse anything meanwhile */
  dragging = false;
  /** the view whose New button should take focus once it is drawn again (a view in dynamic content is redrawn after a save) */
  newFocus: { query: string; at: number } | null = null;
  private editorRef: NoteEditor | null = null;
  /** the editor of the page area; setting it tells it whether to list numbered-list items in the outline */
  get editor(): NoteEditor | null {
    return this.editorRef;
  }
  set editor(ed: NoteEditor | null) {
    this.editorRef = ed;
    ed?.setOutlineLists(this.settings.value.outlineOrderedLists);
    ed?.setWrapCode(this.settings.value.wrapCode);
    this.applyListOptions();
  }
  /** Ctrl+F outside the editor (the tree, the outline, the page itself): find in the open page. False when there is none. */
  findInPage(): boolean {
    if (!this.editorRef || !this.current.value || this.dialog.value) return false;
    this.editorRef.openFind();
    return true;
  }
  /** Files or folders dragged in from outside onto the page tree or the sub-page bar: moved or copied into `parent`, by the preferences. */
  async dropExternal(files: File[], parent: string | null): Promise<void> {
    if (!this.workspace.value || files.length === 0) return;
    const sess = this.active;
    if (!sess || sess.single) { this.toast('Files cannot be dropped here.'); return; }
    const s = this.settings.value;
    const actions = { same: s.dropAction, other: s.dropActionOtherDrive === 'same' ? s.dropAction : s.dropActionOtherDrive };
    let ok = 0;
    let verb = '';
    const failed: string[] = [];
    for (const f of files) {
      const abs = this.deps.pathForFile?.(f) ?? '';
      if (!abs) { failed.push(`${f.name} (could not tell where it is on disk)`); continue; }
      try {
        const r = await this.ws.importExternal(parent, abs, actions);
        ok++;
        verb = r.action === 'move' ? 'Moved' : 'Copied';
      } catch (e) {
        failed.push(`${f.name} (${explain(e)})`);
      }
    }
    const where = parent ? stripExt(parent).split('/').pop() : this.workspace.value.name;
    if (ok > 0) {
      await this.tree.refresh([parent]);
      this.viewTick.value++;
      void this.loadChildren();
    }
    if (failed.length === 0) this.toast(`${verb} ${ok === 1 ? `“${files[0]!.name}”` : `${ok} files`} to “${where}”.`);
    else this.toast(`${ok > 0 ? `${verb} ${ok}; ` : ''}Could not add ${failed.join('; ')}.`);
  }

  /** Alt+Z: wrap or unwrap long lines in code blocks and plain-text files. */
  toggleWrapCode(): void {
    this.setPreferences({ wrapCode: !this.settings.value.wrapCode });
  }
  /** Give the editor the list styles of the preferences. */
  private applyListOptions(): void {
    const s = this.settings.value;
    this.editorRef?.setListOptions({ orderedStyles: s.orderedListStyles, bulletGlyphs: s.bulletGlyphs, hierarchicalDefault: s.hierarchicalLists });
  }
  private readonly outlineLists = computed(() => this.settings.value.outlineOrderedLists);

  /** The page tree of the workspace shown. */
  get tree(): TreeModel {
    return this.active?.tree ?? this.noTree;
  }

  private baseHash: string | null = null;
  /** the text of the page as last known to be on disk (loaded or saved): the common ancestor when disk and editor both changed */
  private baseText = '';
  /** how many times in a row a save had to merge first */
  private mergeTries = 0;
  /** the first heading's text when it was last settled; a change of it (after leaving the line) offers to rename the page */
  private h1Baseline: string | null = null;
  private asking = { rename: false, deleted: false, conflicts: false };
  private navs = new Map<string, Nav>();
  readonly navTick = signal(0);
  readonly canGoBack = computed(() => {
    this.navTick.value;
    this.activeTabId.value;
    const n = this.navs.get(this.activeTabId.value ?? '');
    return !!n && n.index > 0 && !this.activeTab?.single;
  });
  readonly canGoForward = computed(() => {
    this.navTick.value;
    this.activeTabId.value;
    const n = this.navs.get(this.activeTabId.value ?? '');
    return !!n && n.index < n.entries.length - 1 && !this.activeTab?.single;
  });
  /** the shown tab is one file opened on its own */
  readonly activeSingle = computed(() => !!this.tabs.value.find((t) => t.id === this.activeTabId.value)?.single);
  /** the shown tab is a workspace's `.cave-notes` folder, opened to edit its files */
  readonly activeConfig = computed(() => {
    const tab = this.tabs.value.find((t) => t.id === this.activeTabId.value);
    return !!tab && !!this.sessions.get(tab.root)?.config;
  });
  /** the shown tab is the built-in documentation (a workspace that is read only, but can be searched) */
  readonly activeDocs = computed(() => {
    const tab = this.tabs.value.find((t) => t.id === this.activeTabId.value);
    return !!tab && !!this.sessions.get(tab.root)?.docs;
  });
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** The newest write sent to the workspace, settled or not: a save the window gave up waiting for may still be running. */
  private lastWrite: Promise<unknown> = Promise.resolve();
  private openSeq = 0;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private toastId = 1;
  private statusByTarget = new Map<string, string>();
  private states = new Map<string, { state: EditorState; hash: string | null; text: string; scroll: number; anchor: ReturnType<NoteEditor['scrollSnapshot']>; line: number }>();
  /** Where pages were scrolled to when their saved state had to be dropped (the file changed): the line at the top. */
  private scrollLines = new Map<string, number>();
  private linksTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];

  /** What this device can do: parts of the window that need more than it has are not shown. */
  readonly caps: ReturnType<typeof capabilitiesOf>;

  constructor(private readonly deps: Deps) {
    this.caps = capabilitiesOf(deps);
    this.session = new SearchSession<SearchResult>({
      run: (q, o) => this.ws.search(q, { limit: o.limit }),
      onChange: (st) => {
        this.searchState.value = st;
        if (this.searchSel.value >= st.results.length) this.searchSel.value = Math.max(0, st.results.length - 1);
      },
    });
  }

  get ws(): WorkerApi {
    if (!this.active) throw new Error('No workspace is open');
    return this.active.ws;
  }

  private stateKey(path: string, root: string | undefined = this.active?.root): string {
    return `${root ?? ''}\u0000${path}`;
  }
  private get main() {
    return this.deps.main;
  }

  // ---------------------------------------------------------------- startup

  async init(): Promise<void> {
    if (this.caps.appUpdates) void this.main.updateStatus().then((st) => { this.update.value = st; }).catch(() => undefined);
    const s = await this.main.getSettings();
    this.settings.value = s;
    this.applyThemeToDom(s.theme);
    void this.loadFonts();

    const on = this.deps.on;
    this.disposers.push(
      // the title bar (and the window buttons on it) follow the header colour
      effect(() => void this.main.setHeaderColor(this.headerColor.value).catch(() => {})),
      // buttons and highlights take the shown tab's accent too (the same shade as the shown tab)
      effect(() => {
        const tab = this.tabs.value.find((t) => t.id === this.activeTabId.value);
        const r = tab ? accentRoles(this.settings.value.theme, this.accentOf(tab.root)) : null;
        const st = document.documentElement.style;
        for (const [k, v] of [['--accent-bg', r?.active], ['--accent-fg', r?.activeFg], ['--accent-color', r?.text], ['--headerbar-bg', r?.header], ['--headerbar-fg', r?.headerFg], ['--header-pressed-bg', r?.active], ['--header-pressed-fg', r?.activeFg]] as const) {
          if (v) st.setProperty(k, v);
          else st.removeProperty(k);
        }
      }),
      // the text of pages: the shown tab's workspace decides, else the app's defaults
      effect(() => this.applyTypography()),
      effect(() => {
        void this.current.value;
        setTimeout(() => this.refreshPresentation(), 250);
      }),
      effect(() => {
        void this.current.value;
        void this.exportYaml.value;
        this.inheritedStyle = null;
        this.scheduleStats(300);
      }),
      // numbered-list items in the outline follow the preference
      effect(() => {
        const on = this.outlineLists.value;
        const ed = this.editorRef;
        if (!ed) return;
        ed.setOutlineLists(on);
        this.outline.value = ed.outline(); this.annotations.value = ed.annotations();
      }),
      on('settings:changed', (patch) => this.onSettingsChanged(patch)),
      on('window:adopt-tab', (t) => void this.adoptTab(t.root, t.path, t.single)),
      on('tree:changed', ({ parents }, root) => void this.onTreeChanged(parents, root)),
      on('page:changed', (e, root) => void this.onPageChanged(e.path, e.hash, root)),
      on('page:moved', (e, root) => void this.onPageMoved(e.from, e.to, e.hash, root)),
      on('sync:conflicts', (e, root) => void this.onConflictCopies(e.pages, root)),
      on('sync:merged', (e, root) => this.onCopyMerged(e.path, e.conflicts, root)),
      on('automation:ran', (e, root) => this.onAutomationRan(e, root)),
      on('window:open-file', (e) => void this.openFile(e.path)),
      on('index:updated', ({ path }, root) => this.onIndexUpdated(path, root)),
      on('index:status', (st, root) => this.onIndexStatus(st, root)),
      on('app:update', (st) => { this.update.value = st; }),
      on('menu:open-folder', () => void this.chooseWorkspace()),
      on('menu:new-page', () => void this.newPage()),
      on('menu:new-tab', () => void this.newTab()),
      on('menu:close-tab', () => void this.closeTab()),
      on('menu:next-tab', () => this.cycleTab(1)),
      on('menu:prev-tab', () => this.cycleTab(-1)),
      on('menu:preferences', () => this.openPreferences()),
      on('menu:shortcuts', () => this.openShortcuts()),
      on('menu:logs', () => this.openLogs()),
      on('menu:about', () => this.openAbout()),
      on('menu:documentation', () => this.openHelp('docs')),
      on('menu:toggle-left', () => this.toggleLeft()),
      on('menu:toggle-right', () => this.toggleRight()),
      on('menu:toggle-theme', () => void this.toggleTheme()),
      on('menu:export', () => this.openExport()),
      on('menu:undo-move', () => void this.undoMove()),
      on('app:before-close', () => void this.flush().finally(() => void this.main.closeNow())),
    );
    this.sweepTimer = setInterval(() => this.sweepIdleBranches(), 1000);
    // A safety net for file events that never came (a sync tool replacing files, a network folder): the open page
    // is compared with its file when the window gets the focus back and every few seconds.
    const look = (): void => void this.checkDiskNow();
    window.addEventListener('focus', look);
    document.addEventListener('visibilitychange', look);
    const poll = setInterval(look, 4000);
    this.disposers.push(() => {
      window.removeEventListener('focus', look);
      document.removeEventListener('visibilitychange', look);
      clearInterval(poll);
    });
    const init = await this.main.getWindowInit();
    await this.restoreTabs(init);
    for (const f of init.files ?? []) await this.openFile(f);
    // the workspace in front is indexed first; the others follow, one at a time, and are kept watched
    if (this.settings.value.indexAllWorkspaces) this.background.start();
  }

  dispose(): void {
    this.background.stop();
    for (const d of this.disposers) d();
    this.disposers = [];
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ---------------------------------------------------------------- theme, typography & layout

  private applyThemeToDom(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
  }

  /** The typeface and size of page text for a workspace: its own choice where it has one, else the app's default. */
  typographyOf(root: string | null | undefined): { style: FontStyle; size: number; mono: number | null } {
    const look = root ? this.looks.value[root] : undefined;
    const s = this.settings.value;
    const style = look?.fontStyle ?? s.fontStyle;
    const sizeOf = (kind: FontKind): number | null => look?.fontSizes?.[kind] ?? s.fontSizes?.[kind] ?? null;
    // (monospace has no automatic size here: code follows the page text until one is chosen)
    return { style, size: sizeOf(style) ?? AUTO_FONT_SIZE[style], mono: sizeOf('mono') };
  }

  private applyTypography(): void {
    const tab = this.tabs.value.find((t) => t.id === this.activeTabId.value);
    const { style, size, mono } = this.typographyOf(tab?.root);
    const el = document.documentElement;
    el.dataset.serif = style === 'serif' ? 'on' : 'off';
    el.style.setProperty('--editor-font-size', `${size}px`);
    if (mono === null) el.style.removeProperty('--mono-font-size');
    else el.style.setProperty('--mono-font-size', `${mono}px`);
    el.style.setProperty('--vb-word-max', String(this.settings.value.tableWordLimit ?? 22));
    // the workspace's named paragraph styles (`::: name` blocks) and its own CSS
    const look = tab?.root ? this.looks.value[tab.root] : undefined;
    let tag = document.getElementById('cn-workspace-css') as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'cn-workspace-css';
      document.head.append(tag);
    }
    tag.textContent = `${editorCss(namedList({ styles: (look?.styles ?? {}) as StyleSet['styles'] }))}\n${(look?.css ?? '').replace(/<\/style/gi, '')}`;
  }

  /** A style set with the workspace's own named styles and CSS under it (the set's win), for previews and export. */
  withWorkspaceStyles(set: StyleSet): StyleSet {
    const look = this.active ? this.looks.value[this.active.root] : undefined;
    if (!look || (!look.css && !Object.keys(look.styles ?? {}).length)) return set;
    return { ...set, styles: { ...((look.styles ?? {}) as StyleSet['styles']), ...set.styles }, css: [look.css ?? '', set.css ?? ''].filter(Boolean).join('\n') };
  }

  async setTheme(theme: Theme): Promise<void> {
    this.settings.value = { ...this.settings.value, theme };
    this.applyThemeToDom(theme);
    await this.main.setTheme(theme);
  }

  toggleTheme(): Promise<void> {
    return this.setTheme(this.theme.value === 'dark' ? 'light' : 'dark');
  }

  /** The icon a workspace chose, kept in the settings so the menus can show it while the workspace is closed. */
  private rememberIcon(root: string, look: WorkspaceAppearance): void {
    const known = this.settings.value.workspaceIcons ?? {};
    if ((known[root] ?? null) === (look.icon ?? null)) return;
    const { [root]: _old, ...rest } = known;
    this.patchSettings({ workspaceIcons: look.icon ? { ...rest, [root]: look.icon } : rest });
  }

  /** The icon a workspace chose (open or not), or null for the default. */
  iconOf(root: string): string | null {
    const icon = this.looks.value[root]?.icon ?? this.settings.value.workspaceIcons?.[root] ?? null;
    return icon;
  }

  private patchSettings(patch: Partial<Settings>): void {
    this.settings.value = { ...this.settings.value, ...patch };
    void this.main.setSettings(patch);
  }
  /** Another window changed a shared setting (theme, sidebar widths, preferences). */
  private onSettingsChanged(patch: Partial<Settings>): void {
    // which sidebars are open and how wide belongs to each window and tab: another window's choice is not ours
    const { showLeft: _l, showRight: _r, leftWidth: _lw, rightWidth: _rw, ...rest } = patch;
    patch = rest;
    this.settings.value = { ...this.settings.value, ...patch };
    if (patch.theme) this.applyThemeToDom(patch.theme);
    if (patch.conflictMerge) this.pushSyncOptions();
  }

  /** What to do with sync conflict copies; passed on to every open workspace. */
  setConflictMerge(v: ConflictMerge): void {
    this.patchSettings({ conflictMerge: v });
    this.pushSyncOptions();
  }
  private pushSyncOptions(): void {
    const conflictMerge = this.settings.value.conflictMerge;
    for (const sess of new Set(this.sessions.values())) void sess.ws.setSyncOptions({ conflictMerge }).catch(() => {});
  }

  toggleLeft(): void {
    this.patchSettings({ showLeft: !this.settings.value.showLeft });
  }
  toggleRight(): void {
    // a narrow window has no right sidebar: the outline is a pane of the one drawer
    if (narrow.value) {
      const open = this.settings.value.showLeft;
      if (open && drawerPane.value === (this.settings.value.rightTab === 'links' ? 'links' : 'outline')) return this.toggleLeft();
      drawerPane.value = this.settings.value.rightTab === 'links' ? 'links' : 'outline';
      if (!open) this.toggleLeft();
      return;
    }
    this.patchSettings({ showRight: !this.settings.value.showRight });
  }
  goToAnnotation(a: Annotation): void {
    this.editor?.goToAnnotation(a);
  }

  removeAnnotation(a: Annotation): void {
    this.editor?.removeAnnotationAt(a.from);
    if (this.editor) this.annotations.value = this.editor.annotations();
  }

  setRightTab(rightTab: 'outline' | 'links' | 'annotations'): void {
    this.patchSettings({ rightTab });
  }
  setWidths(leftWidth: number, rightWidth: number): void {
    this.patchSettings({ leftWidth, rightWidth });
  }

  // ---------------------------------------------------------------- workspaces

  /** Workspaces to offer when opening one: the one holding the file shown on its own first, then recent ones, then those found on disk. */
  workspaceChoices(): string[] {
    const s = this.settings.value;
    const all = [...s.recent, ...s.found.filter((f) => !s.recent.includes(f))];
    const fw = this.fileWorkspace.value;
    const rest = all.filter((r) => r !== fw);
    return fw && !this.tabs.value.some((t) => t.root === fw) ? [fw, ...rest] : rest;
  }

  /** Which workspace (if any) the file shown on its own sits in. */
  private async resolveFileWorkspace(file: string): Promise<void> {
    const dir = file.slice(0, file.lastIndexOf('/')) || '/';
    try {
      const st = await this.main.workspaceStatus(dir);
      this.fileWorkspace.value = st.isWorkspace ? dir : st.containing;
    } catch {
      this.fileWorkspace.value = null;
    }
  }

  /** Ask before a folder inside a workspace becomes a workspace of its own. 'keep': copy the settings; 'fresh': start empty; null: cancelled. */
  private askPromote(name: string, outerName: string | null): Promise<'keep' | 'fresh' | null> {
    const inside = outerName ? ` It is inside the workspace “${outerName}”.` : '';
    return this.choose({
      title: `Make “${name}” its own workspace?`,
      body: `${inside} As a workspace of its own, its notes will no longer inherit attributes from “${outerName ?? 'the workspace around it'}” and will not show up in that workspace’s queries or search. A .cave-notes folder is added to it; none of your notes change.`.trim(),
      options: [
        { label: 'Make it a workspace and keep the settings', detail: `Copies the schema, saved queries and shared attributes of “${outerName ?? 'the workspace'}”`, value: 'keep' },
        { label: 'Make it a workspace with fresh settings', detail: 'Starts without a schema, saved queries or shared attributes', value: 'fresh' },
      ],
    }).then((v) => (v === 'keep' || v === 'fresh' ? v : null));
  }

  /** Open any folder. One that is not a workspace yet becomes one; inside another workspace that needs a yes first. */
  async openFolder(folder: string): Promise<void> {
    try {
      const st = await this.main.workspaceStatus(folder);
      if (!st.isWorkspace && st.containing) {
        const outerName = st.containing.split('/').pop() || st.containing;
        const choice = await this.askPromote(folder.split('/').pop() || folder, outerName);
        if (!choice) return;
        await this.main.promoteFolder(folder, choice === 'keep' ? st.containing : null);
      }
    } catch (e) {
      this.toast(explain(e));
      return;
    }
    await this.openWorkspace(folder);
  }

  /** The context menu's "Make Workspace": the folder of a page becomes a workspace of its own. */
  async promotePage(page: string): Promise<void> {
    const sess = this.active;
    if (!sess || this.activeSingle.value) return;
    const folder = `${sess.root}/${stripExt(page)}`;
    const choice = await this.askPromote(pageTitleOf(page), sess.info.name);
    if (!choice) return;
    try {
      await this.main.promoteFolder(folder, choice === 'keep' ? sess.root : null);
      this.toast(`“${pageTitleOf(page)}” is now a workspace of its own.`, { label: 'Open', run: () => void this.openWorkspace(folder) });
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** A workspace inside the shown one was chosen in the page tree. */
  async openNestedWorkspace(root: string): Promise<void> {
    const from = this.activeTab;
    await this.openWorkspace(root);
    if (!this.settings.value.nestedInNewTab && from && from.root !== root && this.tabs.value.some((t) => t.id === from.id)) await this.closeTab(from.id);
  }

  /** Stop a folder being a workspace: delete its .cave-notes folder, after a warning. */
  async removeWorkspace(root: string): Promise<void> {
    const name = root.split('/').pop() || root;
    const ok = await this.confirm({
      title: `Stop using “${name}” as a workspace?`,
      body: 'This deletes the .cave-notes folder inside it. Your notes and other files are not touched.',
      details: ['Its saved queries, shared attributes, schema and appearance (colour, icon, page text) are deleted', 'The search index is deleted (it is rebuilt if you open the folder again)', 'If it is inside another workspace, its notes become part of that one again'],
      confirm: 'Remove Workspace Data',
      destructive: true,
    });
    if (!ok) return;
    for (const t of this.tabs.value.filter((x) => x.root === root)) await this.closeTab(t.id);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.main.removeWorkspace(root);
        this.toast(`“${name}” is no longer a workspace.`);
        return;
      } catch (e) {
        if (attempt < 6 && /Close the tabs/.test(String((e as Error).message))) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        this.toast(explain(e));
        return;
      }
    }
  }

  /** Look for workspaces on disk now. */
  async scanNow(): Promise<number> {
    try {
      return (await this.main.scanWorkspaces()).length;
    } catch (e) {
      this.toast(explain(e));
      return 0;
    }
  }

  // ---------------------------------------------------------------- note types

  /** This workspace's own note types and the ones in effect (for the preferences dialog). */
  readonly noteTypes = signal<{ own: NoteTypes | null; effective: NoteTypes } | null>(null);

  async loadNoteTypes(): Promise<void> {
    try {
      this.noteTypes.value = this.activeSingle.value || !this.workspace.value ? null : await this.ws.getNoteTypes();
    } catch {
      this.noteTypes.value = null;
    }
  }

  /** The app's choice of which files are notes, from the text people type (".md .txt" or "md, txt"). */
  setAppNoteTypes(text: string, create: string): void {
    const nt = parseNoteTypes(text, create);
    if (!nt) {
      this.toast('Give at least one file type, like md or txt.');
      return;
    }
    this.patchSettings({ noteExts: nt.exts, noteCreate: nt.create });
    setTimeout(() => void this.loadNoteTypes(), 400);
  }

  /** This workspace's own choice (null: follow the app's). */
  async setWorkspaceNoteTypes(text: string | null, create: string): Promise<void> {
    const s = this.settings.value;
    let own: NoteTypes | null = null;
    if (text !== null) {
      const nt = parseNoteTypes(text, create);
      if (!nt) {
        this.toast('Give at least one file type, like md or txt.');
        return;
      }
      own = nt;
    }
    try {
      await this.ws.setNoteTypes(own, { exts: s.noteExts, create: s.noteCreate });
      await this.loadNoteTypes();
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- preferences

  /** Open the export dialog for the page on screen (what is in the editor now, saved or not). */
  openExport(): void {
    const cur = this.current.value;
    if (!cur?.exists) return;
    this.dialog.value = { kind: 'export', markdown: this.editorRef?.text() ?? '', title: pageTitleOf(cur.path), path: cur.path };
  }

  /** Make the file. Resolves true when one was saved. */
  // ---- export styles and fonts

  /** The YAML of the export style files: for all workspaces, and for this one. */
  readonly exportYaml = signal<{ global: string; workspace: string; shared?: string; globalFiles?: string }>({ global: '', workspace: '', shared: '', globalFiles: '' });
  /** @font-face rules of the bundled fonts (for previews) */
  readonly fontCss = signal('');
  readonly bundledFamilies = signal<string[]>([]);

  async loadExportStyles(): Promise<void> {
    const global = await this.main.getGlobalExportStyles().catch(() => '');
    const workspace = this.active && !this.active.single ? await this.ws.getExportStyles().catch(() => '') : '';
    const shared = this.active && !this.active.single ? await this.ws.getInheritedExportStyles().catch(() => '') : '';
    const globalFiles = await this.main.getGlobalStyleFiles().catch(() => '');
    this.exportYaml.value = { global, workspace, shared, globalFiles };
    this.exportYamlRoot = this.active?.root ?? '';
  }

  /** Save one of the two style files; a message when the text is not good, else null. */
  async saveExportStyles(scope: 'global' | 'workspace', text: string): Promise<string | null> {
    try {
      if (scope === 'global') await this.main.setGlobalExportStyles(text);
      else {
        const r = await this.ws.setExportStyles(text);
        if (!r.ok) return r.error;
      }
      this.exportYaml.value = { ...this.exportYaml.value, [scope]: text };
      return null;
    } catch (e) {
      return explain(e);
    }
  }

  /** Every style set there is: built in, for all workspaces, and for this workspace (a later one with the same name wins). */
  exportStyleSets(over?: { global?: string; workspace?: string }): Array<{ set: StyleSet; origin: 'built in' | 'all workspaces' | 'this workspace' }> {
    const y = this.exportYaml.value;
    const out = new Map<string, { set: StyleSet; origin: 'built in' | 'all workspaces' | 'this workspace' }>();
    for (const b of BUILTIN_STYLES) out.set(b.name.toLowerCase(), { set: b, origin: 'built in' });
    for (const legacy of this.settings.value.exportStyles) {
      const c = cleanStyleSet(legacy);
      out.set(c.name.toLowerCase(), { set: c, origin: 'all workspaces' });
    }
    for (const x of parseStyleSetsYaml(y.globalFiles ?? '').sets) out.set(x.name.toLowerCase(), { set: x, origin: 'all workspaces' });
    const g = parseStyleSetsYaml(over?.global ?? y.global);
    for (const x of g.sets) out.set(x.name.toLowerCase(), { set: x, origin: 'all workspaces' });
    const sh = parseStyleSetsYaml(y.shared ?? '', [...BUILTIN_STYLES, ...g.sets]);
    for (const x of sh.sets) out.set(x.name.toLowerCase(), { set: x, origin: 'all workspaces' });
    const w = parseStyleSetsYaml(over?.workspace ?? y.workspace, [...BUILTIN_STYLES, ...g.sets, ...sh.sets]);
    for (const x of w.sets) out.set(x.name.toLowerCase(), { set: x, origin: 'this workspace' });
    return [...out.values()];
  }

  openExportStyles(): void {
    void this.loadExportStyles().then(() => {
      this.dialog.value = { kind: 'export-styles' };
    });
  }

  /** Make the bundled fonts available to the app's own pages (previews), once. */
  async loadFonts(): Promise<void> {
    if (this.fontCss.value) return;
    try {
      const { url, families } = await this.main.bundledFonts();
      this.bundledFamilies.value = families.map((f) => f.family);
      this.fontCss.value = families
        .flatMap((f) => f.files.map((x) => `@font-face{font-family:'${f.family}';font-weight:${x.weight};font-style:${x.italic ? 'italic' : 'normal'};src:url('${url}${x.file.split('/').map(encodeURIComponent).join('/')}')}`))
        .join('\n');
      const el = document.createElement('style');
      el.id = 'bundled-fonts';
      el.textContent = this.fontCss.value;
      document.head.appendChild(el);
    } catch {
      /* no bundled fonts: the system's are used */
    }
  }

  async saveFonts(): Promise<void> {
    try {
      const dir = await this.main.saveFonts();
      if (dir) this.toast(`Fonts saved in ${dir}. Open the fonts there to install them.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  async installFonts(): Promise<void> {
    try {
      this.toast(await this.main.installFonts());
    } catch (e) {
      this.toast(explain(e));
    }
  }

  async exportPage(req: { format: 'docx' | 'odt' | 'pdf'; markdown: string; title: string; style: Record<string, unknown> }): Promise<boolean> {
    try {
      const saved = await this.main.exportDocument({ ...req, style: this.withWorkspaceStyles(req.style as unknown as StyleSet) as unknown as Record<string, unknown>, defaultName: req.title });
      if (saved) this.exportDone(saved);
      return saved !== null;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  /** A file was exported: say where it is, and offer to show it in the file manager or open it with its program. */
  private exportDone(file: string): void {
    if (!this.caps.systemFileActions) {
      this.toast(`Saved ${file.split('/').pop()}.`);
      return;
    }
    this.dialog.value = { kind: 'exported', path: file };
  }

  /** From the "exported" dialog: show the file in the file manager. */
  async showExported(file: string): Promise<void> {
    const err = await this.main.showInFolder(file).catch((e) => explain(e));
    if (err) this.toast(err);
  }

  /** From the "exported" dialog: open the file with the program the system has for it. */
  async openExported(file: string): Promise<void> {
    const err = await this.main.openPath(file).catch((e) => explain(e));
    if (err) this.toast(err);
  }

  openPreferences(page?: string): void {
    this.dialog.value = page ? { kind: 'preferences', page } : { kind: 'preferences' };
  }

  /** The list of keyboard shortcuts (Help > Keyboard Shortcuts). */
  /** Open a web address in the user's browser. */
  openUrl(url: string): void {
    void this.main.openExternal(url);
  }

  /** The Help window (documentation, keyboard shortcuts, logs, about), at one of its pages. */
  openHelp(page: HelpPage = 'docs'): void {
    this.dialog.value = { kind: 'help', page };
  }

  openAbout(): void {
    this.openHelp('about');
  }

  openShortcuts(): void {
    this.openHelp('shortcuts');
  }

  /** The log screen: all the logs as plain text. */
  openLogs(): void {
    this.openHelp('logs');
  }

  logSources(): ReturnType<MainApi['logSources']> {
    return this.main.logSources();
  }

  readLog(id: string): ReturnType<MainApi['readLog']> {
    return this.main.readLog(id);
  }

  /** Show a folder in the system file manager (the log folder, from the log screen). */
  async showFolder(abs: string): Promise<void> {
    await this.main.openPath(abs);
  }

  /** Change one or more preferences (from the preferences dialog). */
  setPreferences(patch: Partial<Pick<Settings, 'autoCollapse' | 'autoCollapseSeconds' | 'newPageDefault' | 'fontStyle' | 'fontSizes' | 'outlineOrderedLists' | 'exportStyles' | 'exportStyle' | 'exportFormat' | 'orderedListStyles' | 'bulletGlyphs' | 'hierarchicalLists' | 'wrapCode' | 'dropAction' | 'dropActionOtherDrive' | 'defaultAccent' | 'openExternal' | 'showNestedWorkspaces' | 'hideBareFolders' | 'nestedInNewTab' | 'scanAuto' | 'scanFolders' | 'scanIgnore' | 'automationShell' | 'automationJs' | 'automationJsAsk' | 'automationBackground' | 'deviceName' | 'firstDayOfWeek' | 'tableWordLimit' | 'globalsEnabled' | 'spellcheck' | 'synonyms' | 'indexAllWorkspaces' | 'fixCapitals' | 'dictionary' | 'disabledPlugins' | 'updateMode' | 'updateUrl' | 'presentScreen' | 'presenterWindow' | 'presenterScreen'>>): void {
    const next = { ...patch };
    if (next.autoCollapseSeconds !== undefined) next.autoCollapseSeconds = Math.max(1, Math.min(3600, Math.round(Number(next.autoCollapseSeconds)) || 10));
    if (next.globalsEnabled !== undefined && next.globalsEnabled !== this.settings.value.globalsEnabled) {
      void this.ws.globalsEnable(next.globalsEnabled).then(() => (next.globalsEnabled ? this.checkGlobals() : undefined)).catch(() => undefined);
    }
    if (next.tableWordLimit !== undefined) next.tableWordLimit = Math.max(4, Math.min(200, Math.round(Number(next.tableWordLimit)) || 22));
    if (next.fontSizes) {
      const clean = (n: number | null): number | null => (n == null ? null : Math.max(10, Math.min(40, Math.round(Number(n) * 2) / 2)) || null);
      next.fontSizes = { sans: clean(next.fontSizes.sans), serif: clean(next.fontSizes.serif), mono: clean(next.fontSizes.mono) };
    }
    this.patchSettings(next);
    if (next.indexAllWorkspaces !== undefined) this.applyBackgroundSetting();
    if (next.wrapCode !== undefined) this.editorRef?.setWrapCode(next.wrapCode);
    if (next.fixCapitals !== undefined) this.editorRef?.setFixCapitals(next.fixCapitals);
    if (next.orderedListStyles || next.bulletGlyphs || next.hierarchicalLists !== undefined) this.applyListOptions();
    if (next.showNestedWorkspaces !== undefined || next.hideBareFolders !== undefined) for (const sess of new Set(this.sessions.values())) void this.onTreeChanged('all', sess.root);
  }

  /** The spell checker behind the editor's right-click menu: suggestions for a wrong word, and the user's own dictionary. */
  readonly spellHost: SpellHost = {
    check: (word) => {
      const s = this.settings.value;
      if (!s.spellcheck || !this.deps.spell) return null;
      const lower = word.toLowerCase();
      if (s.dictionary.some((w) => w.toLowerCase() === lower)) return null;
      return this.deps.spell(word);
    },
    addWord: (word) => this.addToDictionary(word),
  };

  /** The thesaurus behind the editor's right-click menu: synonyms for a single word, unless they are switched off. */
  readonly thesaurusHost: ThesaurusHost = {
    synonyms: (word) => (this.settings.value.synonyms ? (this.deps.thesaurus?.(word) ?? null) : null),
  };

  /** Put words in the dictionary (several can be pasted at once). Returns how many were new. */
  addToDictionary(...words: string[]): number {
    const have = this.settings.value.dictionary;
    const known = new Set(have.map((w) => w.toLowerCase()));
    const fresh: string[] = [];
    for (const raw of words.flatMap((w) => w.split(/\s+/))) {
      const w = raw.trim();
      if (w === '' || w.length > 60 || known.has(w.toLowerCase())) continue;
      known.add(w.toLowerCase());
      fresh.push(w);
    }
    if (fresh.length > 0) this.setPreferences({ dictionary: [...have, ...fresh].sort((a, b) => a.localeCompare(b)) });
    return fresh.length;
  }

  removeFromDictionary(word: string): void {
    this.setPreferences({ dictionary: this.settings.value.dictionary.filter((w) => w !== word) });
  }

  /** Save the preferences to a file the person picks. */
  async exportSettings(): Promise<void> {
    try {
      if (await this.main.exportSettings()) this.toast('Settings exported.');
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Load preferences from a file the person picks. */
  async importSettings(): Promise<void> {
    try {
      const patch = await this.main.importSettings();
      if (!patch) return;
      this.onSettingsChanged(patch);
      this.toast('Settings imported.');
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- workspaces (sessions)

  /** Open a workspace's worker and tree, once, however many tabs use it. */
  private ensureSession(rootArg: string): Promise<Session> {
    const known = this.sessions.get(rootArg);
    if (known) return Promise.resolve(known);
    let p = this.opening.get(rootArg);
    if (!p) {
      const name = rootArg.split('/').filter(Boolean).pop() ?? rootArg;
      p = this.withBusy(`Opening ${name}`, (set) => this.startSession(rootArg, set)).finally(() => this.opening.delete(rootArg));
      this.opening.set(rootArg, p);
    }
    return p;
  }

  private async startSession(rootArg: string, progress: (fraction: number | null, label?: string) => void = () => {}): Promise<Session> {
    const { id } = await this.main.attachWorkspace(rootArg);
    progress(0.1, 'Reading the folder');
    const ws = this.deps.wsFor(rootArg);
    let info: WorkspaceInfo;
    try {
      // this is the long step on a big folder: its progress is not known, so the circle turns without filling
      progress(null);
      info = await ws.openWorkspace(rootArg);
      progress(0.85, 'Opening the pages');
    } catch (e) {
      await this.main.detachWorkspace(rootArg).catch(() => {});
      throw e;
    }
    const tree = new TreeModel({ load: (p) => ws.listChildren(p, { workspaces: this.settings.value.showNestedWorkspaces, bareFolders: !this.settings.value.hideBareFolders, unlisted: this.showTemplates.value }) });
    const sess: Session = { root: info.root, info, ws, tree, single: !!info.single, config: !!info.config, docs: !!info.docs, assetId: id, index: info.indexed !== undefined ? { state: 'ready', pages: info.indexed, percent: 100 } : { state: 'indexing', pages: 0, percent: 0 }, lastMove: false, expandedTimer: null };
    tree.subscribe(() => {
      if (this.active === sess) this.treeTick.value++;
      this.scheduleExpandedSave(sess);
    });
    void ws.setSyncOptions({ conflictMerge: this.settings.value.conflictMerge }).catch(() => {});
    const st = await ws.getState();
    await tree.init(st.expanded);
    progress(0.97);
    this.sessions.set(info.root, sess);
    if (info.root !== rootArg) this.sessions.set(rootArg, sess);
    this.indexTick.value++;
    const look = await ws.getAppearance().catch(() => EMPTY_LOOK);
    this.looks.value = { ...this.looks.value, [info.root]: look };
    this.rememberIcon(info.root, look);
    void ws.lastMove().then((m) => (sess.lastMove = !!m)).catch(() => {});
    return sess;
  }

  /**
   * One entry per workspace that is open in the background or in a tab, the one in front first, for the progress bars at
   * the bottom of the page pane. `size` is what is known of the workspace's weight (pages plus files) so the bars can be
   * drawn to scale.
   */
  indexBars(): IndexBar[] {
    void this.indexTick.value;
    const seen = new Set<Session>();
    const out: IndexBar[] = [];
    const add = (sess: Session | null | undefined): void => {
      if (!sess || seen.has(sess) || sess.single || sess.config || sess.docs) return;
      seen.add(sess);
      const look = this.looks.value[sess.root];
      out.push({ root: sess.root, name: sess.info.name, color: look?.color ?? null, index: sess.index, front: sess === this.active });
    };
    add(this.active);
    for (const sess of this.sessions.values()) add(sess);
    return out;
  }

  private async releaseSession(root: string): Promise<void> {
    const sess = this.sessions.get(root);
    if (!sess) return;
    for (const [k, v] of [...this.sessions]) if (v === sess) this.sessions.delete(k);
    this.indexTick.value++;
    if (sess.expandedTimer) clearTimeout(sess.expandedTimer);
    await sess.ws.setState({ expanded: [...sess.tree.expanded] }).catch(() => {});
    await sess.ws.closeWorkspace().catch(() => {});
    await this.main.detachWorkspace(sess.root).catch(() => {});
    const { [sess.root]: _gone, ...rest } = this.looks.value;
    this.looks.value = rest;
    for (const k of [...this.states.keys()]) if (k.startsWith(`${sess.root}\u0000`)) this.states.delete(k);
  }

  private scheduleExpandedSave(sess: Session): void {
    if (sess.expandedTimer) clearTimeout(sess.expandedTimer);
    sess.expandedTimer = setTimeout(() => void sess.ws.setState({ expanded: [...sess.tree.expanded] }).catch(() => {}), 500);
  }

  /** Make a session the one shown: its tree, its index status, an empty page area. */
  private setActive(sess: Session | null): void {
    const changed = this.active !== sess;
    this.active = sess;
    this.workspace.value = sess?.info ?? null;
    this.indexStatus.value = sess?.index ?? { state: 'ready', pages: 0 };
    this.lastMoveAvailable.value = sess?.lastMove ?? false;
    if (changed) {
      this.resetSearch();
      this.searchOpen.value = false;
    }
    this.openSeq++;
    this.baseHash = null;
    this.baseText = '';
    this.h1Baseline = null;
    this.conflict.value = null;
    this.saveState.value = 'saved';
    this.current.value = null;
    this.children.value = [];
    this.outline.value = []; this.annotations.value = [];
    this.links.value = [];
    this.backlinks.value = [];
    this.treeTick.value++;
  }

  // ---------------------------------------------------------------- tabs

  private makeTab(root: string, path: string | null, single = false): Tab {
    return { id: `t${this.tabSeq++}`, root, path, ...(single ? { single: true } : {}) };
  }

  /** The folder name of an open workspace. */
  nameOf(root: string): string | null {
    return this.sessions.get(root)?.info.name ?? null;
  }

  get activeTab(): Tab | null {
    return this.tabs.value.find((t) => t.id === this.activeTabId.value) ?? null;
  }

  private updateActiveTab(patch: Partial<Pick<Tab, 'path'>>): void {
    const id = this.activeTabId.value;
    this.tabs.value = this.tabs.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.persistTabs();
  }

  private persistTabs(): void {
    const tabs = this.tabs.value;
    void this.main.setWindowTabs(
      tabs.map((t) => ({ root: t.root, path: t.path, ...(t.single ? { single: true } : {}) })),
      Math.max(0, tabs.findIndex((t) => t.id === this.activeTabId.value)),
    );
  }

  /** Bring the tabs of the last session back. The shown one opens first, the others load in the background. */
  private async restoreTabs(init: WindowState): Promise<void> {
    const saved = init.tabs;
    if (saved.length === 0) return;
    const wanted = Math.max(0, Math.min(saved.length - 1, init.activeTab));
    const tabs = saved.map((t) => this.makeTab(t.root, t.path, t.single));
    this.tabs.value = tabs;
    const order = [wanted, ...saved.map((_, i) => i).filter((i) => i !== wanted)];
    let shown = false;
    const failed: string[] = [];
    for (const i of order) {
      const tab = tabs[i]!;
      try {
        const sess = await this.ensureSession(tab.root);
        this.tabs.value = this.tabs.value.map((t) => (t.id === tab.id ? { ...t, root: sess.root } : t));
        if (!shown) {
          shown = true;
          await this.activateTab(tab.id, { force: true });
        }
      } catch (e) {
        const err = e as { code?: string; message?: string };
        console.warn(`[restore] could not reopen ${tab.root}: ${err.code ?? ''} ${err.message ?? e}`);
        // The tab is dropped either way (there is nothing to show), but a failure other than a missing folder is reported.
        if (err.code !== 'NOT_A_FOLDER') failed.push(tab.root);
        this.tabs.value = this.tabs.value.filter((t) => t.id !== tab.id);
      }
    }
    if (failed.length > 0) this.toast(`Could not reopen ${failed.map((r) => r.split('/').pop()).join(', ')}. Details are in the log (Help > Copy Diagnostic Report).`);
    this.persistTabs();
  }

  async chooseWorkspace(): Promise<void> {
    const root = await this.main.chooseWorkspace();
    if (root) await this.openFolder(root);
  }

  /** Open a folder as a workspace in a tab of its own (or go to its tab when it is already open). */
  async openWorkspace(root: string, quiet = false): Promise<void> {
    try {
      const sess = await this.ensureSession(root);
      const existing = this.tabs.value.find((t) => t.root === sess.root);
      if (existing) {
        await this.activateTab(existing.id);
        return;
      }
      const st = await sess.ws.getState();
      const tab = this.makeTab(sess.root, st.lastPage);
      this.tabs.value = [...this.tabs.value, tab];
      await this.activateTab(tab.id);
    } catch (e) {
      if (!quiet) this.toast(explain(e));
    }
  }

  /** In a workspace's settings folder the YAML files are edited as plain text, not as Markdown. */
  /** Is the page a canvas (a `.canvas` file, drawn as a canvas instead of as text)? */
  private isCanvasPage(path: string): boolean {
    return /\.canvas$/i.test(path);
  }

  /** A file that a canvas card shows was opened: a page opens as a page, anything else with its own program. */
  async openCanvasFile(path: string): Promise<void> {
    const info = await this.ws.pageInfo(path).catch(() => null);
    if (info) {
      await this.openPage(info.path, { nav: 'push', reveal: true });
      return;
    }
    const abs = await this.ws.filePath(path).catch(() => null);
    if (abs) await this.main.openPath(abs);
  }

  private isPlainPage(path: string): boolean {
    return !!this.active?.config && /\.ya?ml$/i.test(path);
  }

  /** Is the shown workspace the built-in documentation (read only, shown fully rendered)? */
  private get readOnlyPages(): boolean {
    return !!this.active?.docs;
  }

  /** Is this tab's workspace the built-in documentation? */
  isDocsRoot(root: string): boolean {
    return !!this.sessions.get(root)?.docs;
  }

  /** Help > Documentation: the bundled docs as a read-only workspace in a tab, starting at the introduction. */
  async openDocumentation(page = '01-introduction.md'): Promise<void> {
    try {
      const root = await this.main.docsFolder();
      const had = this.tabs.value.find((t) => t.root === root);
      await this.openWorkspace(root);
      if (!had || page !== '01-introduction.md') await this.openPage(page, { reveal: true });
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Help > Documentation: save the documentation as one .zip, to upload to an AI chat for help. */
  async saveDocsZip(): Promise<void> {
    try {
      const file = await this.main.saveDocsZip();
      if (file) this.toast(`Documentation saved as ${file}.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** The app's own settings folder (its plugins and templates), in a tab, to edit them. */
  async openAppConfigFolder(): Promise<void> {
    try {
      await this.openWorkspace(await this.main.appConfigFolder());
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---- updates

  /** What the updater is doing (null before the main process has said). */
  readonly update = signal<UpdateStatus | null>(null);

  async checkForUpdate(): Promise<void> {
    this.update.value = { ...(this.update.value ?? (await this.main.updateStatus())), phase: 'checking', message: '' };
    this.update.value = await this.main.checkForUpdate();
  }

  async installUpdate(): Promise<void> {
    this.update.value = await this.main.installUpdate();
  }

  restartApp(): void {
    void this.main.restartApp();
  }

  /** Is this tab's workspace a settings (`.cave-notes`) folder? */
  isConfigRoot(root: string): boolean {
    return !!this.sessions.get(root)?.config;
  }

  /** Show or hide the template pages in the page trees (all open workspaces). */
  toggleTemplates(): void {
    this.showTemplates.value = !this.showTemplates.value;
    for (const sess of new Set(this.sessions.values())) void this.onTreeChanged('all', sess.root);
  }

  /**
   * Open the shown workspace's `.cave-notes` folder in a tab of its own, as if it were a workspace, to edit its settings files
   * and templates. The folder is made first when it is missing; no files are made for you.
   */
  async openConfigFolder(): Promise<void> {
    const sess = this.active;
    if (!sess || sess.single || sess.config) return;
    try {
      const dir = await sess.ws.ensureConfigFolder();
      await this.openWorkspace(dir);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** A new tab on the shown workspace, showing the same page. */
  async newTab(): Promise<void> {
    const cur = this.activeTab;
    if (!cur) {
      await this.chooseWorkspace();
      return;
    }
    await this.openInNewTab(cur.path ?? undefined);
  }

  /** Open a page of the shown workspace in a new tab next to the active one. */
  async openInNewTab(path?: string): Promise<void> {
    const cur = this.activeTab;
    if (!cur) return;
    const tab = this.makeTab(cur.root, path ?? null);
    const at = this.tabs.value.findIndex((t) => t.id === cur.id);
    const next = [...this.tabs.value];
    next.splice(at + 1, 0, tab);
    this.tabs.value = next;
    await this.activateTab(tab.id);
  }

  /**
   * Open a Markdown file in a tab of its own (from the command line, or handed to the running app). A file inside a
   * workspace that is open here opens as that workspace's page; any other opens on its own, without its folder.
   */
  async openFile(abs: string): Promise<void> {
    try {
      if (!(await this.main.isFile(abs))) {
        this.toast(`Cannot open ${abs.split('/').pop()}: it is not one of the note types (${this.settings.value.noteExts.join(', ')}).`);
        return;
      }
      for (const sess of new Set(this.sessions.values())) {
        if (sess.single || !abs.startsWith(`${sess.root}/`)) continue;
        const page = abs.slice(sess.root.length + 1);
        const existing = this.tabs.value.find((t) => t.root === sess.root && t.path === page);
        if (existing) await this.activateTab(existing.id);
        else {
          const tab = this.makeTab(sess.root, page);
          this.tabs.value = [...this.tabs.value, tab];
          await this.activateTab(tab.id);
        }
        return;
      }
      const have = this.tabs.value.find((t) => t.single && t.root === abs);
      if (have) {
        await this.activateTab(have.id);
        return;
      }
      const sess = await this.ensureSession(abs);
      const tab = this.makeTab(sess.root, abs.split('/').pop() ?? abs, true);
      this.tabs.value = [...this.tabs.value, tab];
      await this.activateTab(tab.id);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- back and forward (per tab)

  private recordNav(path: string, mode: 'push' | 'soft' | 'skip'): void {
    const id = this.activeTabId.value;
    if (!id) return;
    let n = this.navs.get(id);
    if (!n) {
      n = { entries: [path], index: 0, soft: false, at: 0 };
      this.navs.set(id, n);
    } else if (n.entries[n.index] !== path && mode !== 'skip') {
      const now = Date.now();
      if (mode === 'soft' && n.soft && now - n.at < 1500) n.entries[n.index] = path;
      else {
        n.entries = [...n.entries.slice(0, n.index + 1), path].slice(-100);
        n.index = n.entries.length - 1;
      }
      n.soft = mode === 'soft';
      n.at = now;
    }
    this.navTick.value++;
  }

  /** Go back (-1) or forward (+1) in the shown tab's own history, skipping pages that no longer exist. */
  async stepHistory(delta: -1 | 1): Promise<void> {
    const n = this.navs.get(this.activeTabId.value ?? '');
    if (!n || this.activeTab?.single) return;
    for (let i = n.index + delta; i >= 0 && i < n.entries.length; i += delta) {
      const page = n.entries[i]!;
      if (!(await this.ws.pageInfo(page).catch(() => null))) continue;
      n.index = i;
      n.soft = false;
      this.navTick.value++;
      await this.openPage(page, { nav: 'skip', reveal: true });
      return;
    }
  }

  async activateTab(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const tab = this.tabs.value.find((t) => t.id === id);
    if (!tab) return;
    if (this.activeTabId.value === id && !opts.force) return;
    await this.flush();
    this.saveEditorState();
    let sess: Session;
    try {
      sess = await this.ensureSession(tab.root);
    } catch (e) {
      this.toast(explain(e));
      await this.removeTab(id);
      return;
    }
    const leaving = this.activeTabId.value;
    if (leaving && leaving !== id) {
      this.tabSearchPane.set(leaving, this.searchOpen.value);
      this.tabRightPane.set(leaving, this.settings.value.rightTab);
      const { showLeft, showRight, leftWidth, rightWidth } = this.settings.value;
      this.tabSidebars.set(leaving, { showLeft, showRight, leftWidth, rightWidth });
      const was = this.tabs.value.find((t) => t.id === leaving);
      const wasSess = was ? this.sessions.get(was.root) : undefined;
      if (wasSess) this.tabExpanded.set(leaving, wasSess.tree.expandedPaths());
    }
    this.activeTabId.value = id;
    if (!this.altSwitch) this.promoteMru(id);
    this.setActive(sess);
    // each tab remembers its own side panes: file tree vs. search on the left, outline vs. links on the right
    this.searchOpen.value = !!this.tabSearchPane.get(id);
    const right = this.tabRightPane.get(id);
    if (right && right !== this.settings.value.rightTab) this.setRightTab(right);
    const bars = this.tabSidebars.get(id);
    if (bars) this.settings.value = { ...this.settings.value, ...bars }; // only this window's view: not saved, not sent to other windows
    // a tab opened from another page starts with that tab's open branches (nothing stored yet: the tree is as it is); from then on it is free
    const open = this.tabExpanded.get(id);
    if (open) await sess.tree.setExpanded(open);
    if (tab.single) void this.resolveFileWorkspace(tab.root);
    else this.fileWorkspace.value = null;
    this.persistTabs();
    void this.main.setTitle(tab.path ? (stripExt(tab.path).split('/').pop() ?? '') : sess.info.name);
    this.navTick.value++;
    if (tab.path) await this.openPage(tab.path, { force: true, nav: 'skip' });
  }

  /** Ask about settings other workspaces offer to every workspace, when this one has not been asked yet. */
  async checkGlobals(): Promise<void> {
    if (!this.settings.value.globalsEnabled || this.dialog.value) return;
    const root = this.workspace.value?.root;
    if (!root) return;
    const offers = await this.ws.globalsPending().catch(() => []);
    if (offers.length === 0) return;
    const s = this.settings.value;
    const workspaces = [...new Set([root, ...s.recent, ...s.found])];
    this.dialog.value = { kind: 'globals', offers, workspaces, current: root };
  }

  /** Tabs from the most recently used to the least. Alt+W walks this list, as Alt+Tab does for windows. */
  private tabMru: string[] = [];
  private altSwitch: { order: string[]; index: number } | null = null;

  private promoteMru(id: string): void {
    this.tabMru = [id, ...this.tabMru.filter((x) => x !== id)];
  }

  /**
   * One press of Alt+W (Shift+Alt+W goes the other way): the first press jumps to the tab used just before this one, each
   * further press while Alt stays down goes one tab deeper into the list. Letting go of Alt keeps the tab and makes it the
   * most recently used (see altSwitchEnd).
   */
  altSwitchStep(dir: 1 | -1): void {
    const tabs = this.tabs.value;
    if (tabs.length < 2) return;
    if (!this.altSwitch) {
      const ids = tabs.map((t) => t.id);
      const cur = this.activeTabId.value;
      const rest = [...new Set([...this.tabMru, ...ids])].filter((id) => ids.includes(id) && id !== cur);
      this.altSwitch = { order: cur ? [cur, ...rest] : rest, index: 0 };
    }
    const sw = this.altSwitch;
    sw.index = (sw.index + dir + sw.order.length) % sw.order.length;
    void this.activateTab(sw.order[sw.index]!);
  }

  altSwitchEnd(): void {
    const sw = this.altSwitch;
    if (!sw) return;
    this.altSwitch = null;
    const id = sw.order[sw.index];
    if (id) this.promoteMru(id);
  }

  /** Move the keyboard between the page tree and the editor (F6). */
  toggleTreeEditorFocus(): void {
    const active = document.activeElement as HTMLElement | null;
    const inEditor = !!active?.closest('.cm-editor');
    if (inEditor) {
      if (!this.settings.value.showLeft) this.toggleLeft();
      // let the sidebar draw first when it was hidden
      requestAnimationFrame(() => {
        const tree = document.querySelector<HTMLElement>('.sidebar.left .tree');
        const search = document.querySelector<HTMLElement>('.sidebar.left input[type=search], .sidebar.left .search-input');
        (this.searchOpen.value ? search ?? tree : tree)?.focus();
      });
    } else this.editor?.focus();
  }

  cycleTab(delta: number): void {
    const tabs = this.tabs.value;
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === this.activeTabId.value);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    if (next) void this.activateTab(next.id);
  }

  /** Close a tab (default: the active one). Closing the last tab of a workspace closes the workspace. */
  async closeTab(id: string | null = this.activeTabId.value): Promise<void> {
    if (!id) return;
    if (id === this.activeTabId.value) {
      await this.flush();
      if (this.saveState.value === 'conflict') {
        const ok = await this.confirm({ title: 'Close this tab?', body: 'This page has changes that could not be saved because it changed on disk.', confirm: 'Close Tab', destructive: true });
        if (!ok) return;
      }
    }
    await this.removeTab(id);
  }

  async closeOtherTabs(keep: string): Promise<void> {
    for (const t of this.tabs.value) if (t.id !== keep) await this.closeTab(t.id);
  }

  private async removeTab(id: string): Promise<void> {
    const tabs = this.tabs.value;
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const gone = tabs[i]!;
    this.navs.delete(id);
    this.tabSearchPane.delete(id);
    this.tabRightPane.delete(id);
    this.tabSidebars.delete(id);
    this.tabExpanded.delete(id);
    const rest = tabs.filter((t) => t.id !== id);
    this.tabMru = this.tabMru.filter((x) => x !== id);
    const wasActive = this.activeTabId.value === id;
    this.tabs.value = rest;
    if (wasActive) {
      this.saveEditorState();
      const next = rest[Math.min(i, rest.length - 1)];
      if (next) await this.activateTab(next.id, { force: true });
      else {
        this.activeTabId.value = null;
        this.setActive(null);
        void this.main.setTitle('');
      }
    }
    if (!rest.some((t) => t.root === gone.root) && !this.background.keeping.has(gone.root)) await this.releaseSession(gone.root);
    this.persistTabs();
  }

  /**
   * Move a tab to another window: the Cave Notes window under the pointer when it is dropped on one (screen
   * position given), or a new window. Does nothing for the only tab of a window.
   */
  async tearOffTab(id: string, screenX?: number, screenY?: number): Promise<void> {
    const tab = this.tabs.value.find((t) => t.id === id);
    if (!tab || this.tabs.value.length < 2) return;
    await this.flush(); // only the shown page can have unsaved changes
    const target = { root: tab.root, path: tab.path, ...(tab.single ? { single: true } : {}) };
    try {
      if (screenX === undefined || screenY === undefined) await this.main.newWindow(target);
      else await this.main.moveTabToWindow(target, screenX, screenY);
    } catch (e) {
      this.toast(explain(e));
      return;
    }
    await this.removeTab(id);
  }

  /** A tab arrived from another window: show it here. */
  async adoptTab(root: string, path: string | null, single = false): Promise<void> {
    try {
      const sess = await this.ensureSession(root);
      const tab = this.makeTab(sess.root, path, single);
      this.tabs.value = [...this.tabs.value, tab];
      await this.activateTab(tab.id);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  moveTab(id: string, toIndex: number): void {
    const tabs = [...this.tabs.value];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, t!);
    this.tabs.value = tabs;
    this.persistTabs();
  }

  // ---------------------------------------------------------------- workspace appearance

  /** Preferences, on the tab of the open workspace. */
  openWorkspacePreferences(): void {
    if (this.active?.config) return this.openPreferences(); // the settings folder is no workspace of its own
    this.dialog.value = { kind: 'preferences', tab: 'workspace' };
  }

  async loadWorkspaceYaml(): Promise<Record<YamlSection, string>> {
    try {
      return await this.ws.getWorkspaceYaml();
    } catch (e) {
      this.toast(explain(e));
      return { attributes: '', files: '', queries: '', relations: '', schema: '', automations: '' };
    }
  }

  async saveWorkspaceYaml(section: YamlSection, text: string): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
    try {
      return await this.ws.setWorkspaceYaml(section, text);
    } catch (e) {
      return { ok: false, error: explain(e) };
    }
  }

  async setWorkspaceLook(root: string, patch: Partial<WorkspaceAppearance>): Promise<void> {
    const sess = this.sessions.get(root) ?? (this.active && this.active.root === root ? this.active : undefined);
    if (!sess) {
      this.toast('That workspace is not open any more, so its preferences cannot be changed.');
      return;
    }
    // Show the change at once: the worker may be busy (indexing a large workspace) and the window must not look frozen meanwhile.
    const before = this.looks.value[sess.root];
    if (before) {
      const next: WorkspaceAppearance = { ...before, ...patch, fontSizes: { ...before.fontSizes, ...(patch.fontSizes ?? {}) } };
      this.looks.value = { ...this.looks.value, [sess.root]: next };
    }
    try {
      const look = await sess.ws.setAppearance(patch);
      this.looks.value = { ...this.looks.value, [sess.root]: look };
      this.rememberIcon(sess.root, look);
    } catch (e) {
      if (before) this.looks.value = { ...this.looks.value, [sess.root]: before };
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- collapsing idle branches

  private sweepIdleBranches(): void {
    const s = this.settings.value;
    if (!s.autoCollapse || this.dragging || this.dialog.value) return;
    // on a phone the tree is a drawer: the seconds count only while it is closed, starting over each time it is put away
    if (narrow.value && s.showLeft && drawerPane.value === 'pages') {
      for (const sess of new Set(this.sessions.values())) sess.tree.resetIdle();
      return;
    }
    const now = Date.now();
    for (const sess of new Set(this.sessions.values())) {
      // the tree on show belongs to the active tab: it keeps the way to its own page, and other tabs' pages do not hold branches open
      const activeId = this.activeTabId.value;
      const keep = this.tabs.value.filter((t) => t.root === sess.root && t.path && (this.active !== sess || t.id === activeId)).map((t) => t.path as string);
      if (this.active === sess && sess.tree.selected) keep.push(sess.tree.selected);
      // the page on screen always holds its own branch, whatever the tab list says at this moment
      const cur = this.current.value?.path;
      if (this.active === sess && cur) keep.push(cur);
      sess.tree.sweepIdle(keep, now, s.autoCollapseSeconds * 1000);
    }
  }

  // ---------------------------------------------------------------- events from the worker

  private sessionOf(root: string | undefined): Session | null {
    return root ? (this.sessions.get(root) ?? null) : null;
  }

  private async onTreeChanged(parents: Array<string | null> | 'all', root: string | undefined): Promise<void> {
    const sess = this.sessionOf(root);
    if (!sess) return;
    await sess.tree.refresh(parents === 'all' ? sess.tree.loadedParents() : parents).catch(() => {});
    if (this.active !== sess) return;
    void this.loadChildren();
    const cur = this.current.value;
    if (cur) void this.revealInTree(cur.path, false);
  }

  private onIndexStatus(st: IndexInfo, root: string | undefined): void {
    const sess = this.sessionOf(root);
    if (!sess) return;
    sess.index = { state: st.state, pages: st.pages, ...(st.files !== undefined ? { files: st.files } : {}), percent: st.state === 'ready' ? 100 : st.percent ?? 0, ...(st.phase ? { phase: st.phase } : {}) };
    if (this.active === sess) this.indexStatus.value = sess.index;
    this.indexTick.value++;
    if (st.state === 'ready') {
      for (const done of this.indexWaiters.get(sess) ?? []) done();
      this.indexWaiters.delete(sess);
    }
    if (st.state === 'ready' && this.active === sess) void this.checkGlobals();
  }

  private async onPageChanged(path: string, hash: string | null, root: string | undefined): Promise<void> {
    // The saved state of a page that is not shown (cursor, undo history, scroll) stays when the file is as it was left,
    // which is what an event for our own save looks like. A file that really changed loses its state, but not its place.
    const key = this.stateKey(path, root);
    const kept = this.states.get(key);
    if (kept && !(hash !== null && kept.hash === hash)) {
      this.states.delete(key);
      this.scrollLines.set(key, kept.line);
      while (this.scrollLines.size > STATE_CACHE) this.scrollLines.delete(this.scrollLines.keys().next().value as string);
    }
    const sess = this.sessionOf(root);
    const cur = this.current.value;
    if (!sess || this.active !== sess || !cur || cur.path !== path) return;
    await this.saving; // a save in flight may be what changed the file
    if (hash === this.baseHash) return;
    if (hash === null) {
      await this.onDeletedOnDisk(path);
      return;
    }
    await this.mergeFromDisk();
  }

  /** Is the open page's file different from what this window last saw or saved? Then take the change in. */
  private async checkDiskNow(): Promise<void> {
    const cur = this.current.value;
    if (!cur?.exists || !this.editor || this.asking.deleted || this.saveState.value === 'conflict' || document.visibilityState === 'hidden') return;
    try {
      await this.saving;
      await this.mergeFromDisk();
    } catch {
      /* the next look tries again */
    }
  }

  /**
   * The file changed on disk while a page is open. If nothing here was typed since it was loaded or saved, the
   * new text just replaces it. Otherwise both changes are merged (against the text both grew from, or the closest
   * earlier version if that one is not known any more) and applied in place; nothing the person typed is
   * dropped, and what was in the editor is kept in the page history first.
   */
  private async mergeFromDisk(depth = 0): Promise<boolean> {
    const cur = this.current.value;
    const ed = this.editor;
    if (!cur?.exists || !ed) return false;
    const path = cur.path;
    let data;
    try {
      data = await this.ws.readPage(path);
    } catch {
      return false;
    }
    if (this.current.value?.path !== path || !data.exists) return false;
    if (data.hash === this.baseHash) return true;
    const local = ed.text();
    const localH1 = ed.firstH1()?.text ?? null;
    const remoteH1 = findFirstH1(data.text.split('\n'))?.text ?? null;
    const keepH1 = (): void => {
      // a title changed on the other side is not something to ask about; one changed here still is
      if (localH1 === this.h1Baseline) this.h1Baseline = remoteH1;
    };

    if (local === this.baseText) {
      ed.applyChanges(textChanges(local, data.text));
      this.baseText = data.text;
      this.baseHash = data.hash;
      keepH1();
      this.setClean();
      this.toast('Updated: this page changed on disk.');
      return true;
    }

    void this.ws.snapshot(path, local, 'discarded').catch(() => {});
    const earlier = [this.baseText, ...(await this.ws.historyTexts(path, 12).catch(() => [] as string[]))].filter((t) => t !== local && t !== data.text);
    const merged = mergeDocuments({ base: pickBase(earlier, local, data.text), local, remote: data.text, localTime: Date.now(), remoteTime: data.mtimeMs ?? 0 });
    if (this.current.value?.path !== path || ed.text() !== local) {
      // typing went on meanwhile: again with the newer text, but not for ever
      if (depth >= 5) {
        console.warn(`[merge] gave up merging ${path} after ${depth} tries: the text kept changing`);
        return false;
      }
      return this.mergeFromDisk(depth + 1);
    }
    ed.applyChanges(textChanges(local, merged.text));
    this.baseText = data.text;
    this.baseHash = data.hash;
    keepH1();
    if (merged.text === data.text) this.setClean();
    else {
      if (this.saveState.value !== 'conflict') this.saveState.value = 'dirty';
      this.conflict.value = null;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => void this.flush(), 120);
    }
    if (merged.conflicts > 0) {
      this.toast(`Merged changes from disk. In ${merged.conflicts === 1 ? 'one place' : `${merged.conflicts} places`} both versions were edited; both are kept.`, { label: 'Show', run: () => this.showConflict() });
    } else this.toast('Merged changes from disk into this page.');
    return true;
  }

  private setClean(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.conflict.value = null;
    this.saveState.value = 'saved';
    if (this.editor) this.outline.value = this.editor.outline(); if (this.editor) this.annotations.value = this.editor.annotations();
    void this.loadLinks();
  }

  /** Scroll to the first place where a merge kept both versions. */
  showConflict(): void {
    const ed = this.editor;
    if (!ed) return;
    const at = ed.text().indexOf(CONFLICT_OPEN);
    if (at >= 0) {
      ed.scrollToCentered(at);
      ed.focus();
    }
  }

  /** The open page's file is gone. Whatever is in the editor is kept in the history first; then the person decides. */
  private async onDeletedOnDisk(path: string): Promise<void> {
    const ed = this.editor;
    if (!ed || this.asking.deleted) return;
    this.asking.deleted = true;
    try {
      const text = ed.text();
      const dirty = text !== this.baseText;
      await this.ws.snapshot(path, text, dirty ? 'discarded' : 'disk').catch(() => {});
      const name = stripExt(path).split('/').pop();
      const pick = await this.choose({
        title: `“${name}” was deleted on disk`,
        body: dirty ? 'It has changes that were not saved yet.' : 'Another program, or a sync, removed its file.',
        options: [
          { label: 'Keep this page', detail: 'Save it again, as it is open here', value: 'keep' },
          { label: 'Close it', detail: 'Let it go. A copy stays in the page history.', value: 'close' },
        ],
      });
      if (this.current.value?.path !== path) return;
      if (pick === 'close') {
        this.openSeq++;
        this.saveState.value = 'saved';
        this.current.value = null;
        this.children.value = [];
        this.outline.value = []; this.annotations.value = [];
        this.links.value = [];
        this.backlinks.value = [];
        this.updateActiveTab({ path: null });
        await this.tree.refresh(this.tree.loadedParents()).catch(() => {});
      } else {
        // 'keep', and also a dialog dismissed any other way: never lose the page by accident
        const res = await this.ws.writePage(path, ed.text(), null);
        if (res.ok) {
          this.baseHash = res.hash;
          this.baseText = ed.text();
          this.setClean();
          this.toast('Saved again.');
        }
      }
    } finally {
      this.asking.deleted = false;
    }
  }

  /** A page file was moved or renamed on disk: tabs and history follow it, and an open page stays open. */
  private async onPageMoved(from: string, to: string, hash: string, root: string | undefined): Promise<void> {
    const sess = this.sessionOf(root);
    if (!sess) return;
    for (const k of [...this.states.keys()]) if (k === this.stateKey(from, root)) this.states.delete(k);
    this.remapRoot(sess.root, (p) => (p === from ? to : p));
    if (this.active !== sess) return;
    const cur = this.current.value;
    if (cur?.path === from) {
      this.current.value = { path: to, exists: true };
      void this.main.setTitle(stripExt(to).split('/').pop() ?? '');
      void this.ws.setState({ lastPage: to });
      if (hash !== this.baseHash) await this.mergeFromDisk();
      await this.tree.refresh(this.tree.loadedParents()).catch(() => {});
      await this.revealInTree(to, true);
      void this.loadChildren();
      void this.loadLinks();
      this.toast(`“${stripExt(from).split('/').pop()}” was moved to “${stripExt(to)}”.`);
    }
  }

  /** The worker found sync conflict copies and the setting says to ask: ask once, remember the answer. */
  private async onConflictCopies(pages: string[], root: string | undefined): Promise<void> {
    if (!this.sessionOf(root) || this.asking.conflicts || this.settings.value.conflictMerge !== 'ask') return;
    this.asking.conflicts = true;
    try {
      const names = pages.slice(0, 3).map((p) => `“${stripExt(p).split('/').pop()}”`).join(', ');
      const pick = await this.choose({
        title: 'Sync conflict copies found',
        body: `Syncthing kept a second version of ${names}${pages.length > 3 ? ` and ${pages.length - 3} more` : ''}, because the page was edited in two places. Merge such copies into their page automatically, and delete them? Nothing is lost: both versions go to the page history, and edits that clash are kept side by side.`,
        options: [
          { label: 'Always merge them in', detail: 'Merge, then delete the copy. Changeable in Preferences.', value: 'auto' },
          { label: 'Leave them alone', detail: 'Never touch conflict copies. Changeable in Preferences.', value: 'never' },
        ],
      });
      if (pick === 'auto' || pick === 'never') this.setConflictMerge(pick);
    } finally {
      this.asking.conflicts = false;
    }
  }

  /** An automation rule ran: say what it did, so a page that changes by itself is no surprise. */
  private onAutomationRan(e: WorkerEvents['automation:ran'], root: string | undefined): void {
    if (!this.sessionOf(root)) return;
    const page = e.path ? stripExt(e.path).split('/').pop() : null;
    const where = page ? ` on “${page}”` : '';
    if (e.status === 'failed') {
      // a script or command that was not allowed: the link goes to where the permission is, not to the page
      const blocked = /switched off in Preferences|you refused this|Preferences can forget/.test(e.detail);
      this.toast(`Automation “${e.rule}” failed${where}: ${e.detail || 'see the automation log'}`, blocked ? { label: 'Permissions', run: () => this.openPreferences('sync') } : e.path ? { label: 'Show', run: () => void this.openPage(e.path!) } : undefined);
      return;
    }
    const did = e.steps.filter((s) => s.status === 'done').map((s) => (s.detail && s.detail !== 'ran' ? s.detail : s.action.replace(/_/g, ' ')));
    this.toast(`Automation “${e.rule}” ran${where}${did.length > 0 ? `: ${did.join('; ')}` : ''}`, e.path ? { label: 'Show', run: () => void this.openPage(e.path!) } : undefined);
  }

  private onCopyMerged(path: string, conflicts: number, root: string | undefined): void {
    if (!this.sessionOf(root)) return;
    const name = stripExt(path).split('/').pop();
    this.toast(
      conflicts > 0 ? `Merged a sync conflict copy into “${name}”. Where both versions were edited, both are kept.` : `Merged a sync conflict copy into “${name}”.`,
      conflicts > 0 ? { label: 'Show', run: () => void this.openPage(path).then(() => this.showConflict()) } : undefined,
    );
  }

  private onIndexUpdated(path: string | null, root: string | undefined): void {
    const sess = this.sessionOf(root);
    if (sess && this.active !== sess) {
      // another workspace changed: views here that ask it (saved:Workspace::name) and relations that name its pages may be out of date
      if (Date.now() - this.foreignAskedAt < 10 * 60_000) {
        if (this.otherTickTimer) clearTimeout(this.otherTickTimer);
        this.otherTickTimer = setTimeout(() => {
          this.otherTickTimer = null;
          this.viewTick.value++;
        }, 2000);
      }
      return;
    }
    if (!sess) return;
    if (this.viewTickTimer) clearTimeout(this.viewTickTimer);
    this.viewTickTimer = setTimeout(() => {
      this.viewTickTimer = null;
      this.viewTick.value++;
    }, 120);
    if (this.searchOpen.value && this.searchQuery.value.trim()) {
      if (this.searchRefreshTimer) clearTimeout(this.searchRefreshTimer);
      this.searchRefreshTimer = setTimeout(() => this.session.refresh(), 250);
    }
    const cur = this.current.value;
    if (!cur || (path !== null && path !== cur.path && !this.links.value.length)) return;
    if (this.linksTimer) clearTimeout(this.linksTimer);
    this.linksTimer = setTimeout(() => void this.loadLinks(), 120);
  }

  // ---------------------------------------------------------------- pages

  /** The editor registers itself here when it mounts. */
  attachEditor(editor: NoteEditor): void {
    this.editor = editor;
    // The editor is created once a workspace is on screen, which can be after the first page was already read
    // (opening a workspace, or restoring tabs at start): without this the page is "open" but the editor stays blank.
    const cur = this.current.value;
    if (cur?.exists) {
      editor.load(this.baseText, { plain: this.isPlainPage(cur.path), readOnly: this.readOnlyPages, canvas: this.isCanvasPage(cur.path) });
      this.outline.value = editor.outline(); this.annotations.value = editor.annotations();
      requestAnimationFrame(() => this.updateActiveHeading());
    }
  }

  private saveEditorState(): void {
    const cur = this.current.value;
    if (!cur || !cur.exists || !this.editor) return;
    const key = this.stateKey(cur.path);
    this.states.delete(key);
    this.states.set(key, { state: this.editor.state, hash: this.baseHash, text: this.baseText, scroll: this.editor.scrollTop, anchor: this.editor.scrollSnapshot(), line: this.editor.topLine() });
    while (this.states.size > STATE_CACHE) this.states.delete(this.states.keys().next().value as string);
  }

  /** Open a page after a short pause, so holding an arrow key stays smooth. Any explicit openPage cancels it. */
  openSoon(path: string, ms = 90, reveal = true): void {
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => {
      this.navTimer = null;
      void this.openPage(path, { reveal, nav: 'soft' });
    }, ms);
  }

  /**
   * Show a page in the editor. The page tree follows it: its ancestors open and it is selected (for a
   * hidden page, its nearest visible ancestor), unless `reveal: false` says the tree is where this came from.
   * `cursor: 'end'` puts the cursor under the last line (a page that was just created).
   */
  async openPage(path: string, opts: { fragment?: string | null; focus?: boolean; reveal?: boolean; force?: boolean; cursor?: 'end'; nav?: 'push' | 'soft' | 'skip' } = {}): Promise<void> {
    if (this.navTimer) {
      clearTimeout(this.navTimer);
      this.navTimer = null;
    }
    const cur = this.current.value;
    if (cur?.path === path && !opts.force) {
      if (opts.fragment) this.editor?.scrollToHeading(opts.fragment);
      if (opts.focus) this.editor?.focus();
      return;
    }
    const seq = ++this.openSeq;
    await this.flush();
    if (seq !== this.openSeq) return;
    this.saveEditorState();

    let data;
    try {
      data = await this.ws.readPage(path);
    } catch (e) {
      this.toast(explain(e));
      return;
    }
    if (seq !== this.openSeq) return;

    if (!data.exists && !(await this.ws.pageInfo(path).catch(() => ({ path })))) {
      // neither a file nor a folder of pages: it was deleted or moved away
      console.warn(`[openPage] page not found: ${path} in workspace ${this.active?.root ?? '?'} (see the worker's "readPage: ENOENT" line just before this for what is on disk)`);
      this.toast(`“${stripExt(path).split('/').pop()}” no longer exists.`);
      if (seq === this.openSeq && this.current.value === null) this.updateActiveTab({ path: null });
      return;
    }
    this.conflict.value = null;
    this.saveState.value = 'saved';
    this.baseHash = data.hash;
    this.baseText = data.text;
    this.mergeTries = 0;
    this.current.value = { path, exists: data.exists };
    this.updateActiveTab({ path });
    this.recordNav(path, opts.nav ?? 'push');
    this.statusByTarget = new Map();

    const ed = this.editor;
    if (ed) {
      const cached = this.states.get(this.stateKey(path));
      let restore: (() => void) | null = null;
      if (data.exists && cached && cached.hash === data.hash) {
        ed.setState(cached.state);
        // back to the line that was at the top, not to a pixel offset: heights of views and images are only estimates until drawn
        restore = () => ed.restoreScroll(cached.anchor);
      } else {
        ed.load(data.exists ? data.text : '', { plain: this.isPlainPage(path), readOnly: this.readOnlyPages, canvas: this.isCanvasPage(path) });
        // the page changed while it was away (or it was never open here): stay near where it was left
        const line = data.exists ? this.scrollLines.get(this.stateKey(path)) : undefined;
        if (line && line > 1) restore = () => ed.scrollToLine(line);
      }
      this.h1Baseline = data.exists ? (findFirstH1(data.text.split('\n'))?.text ?? null) : null;
      this.outline.value = ed.outline(); this.annotations.value = ed.annotations();
      if (restore && !opts.fragment) {
        restore();
        // and again once the page has been laid out (the editor may not have been visible yet)
        requestAnimationFrame(() => {
          if (seq === this.openSeq) restore?.();
        });
      }
    }
    await this.revealInTree(path, opts.reveal !== false);

    void this.loadLinks();
    void this.ws.setState({ lastPage: path });
    void this.main.setTitle(stripExt(path).split('/').pop() ?? '');
    if (opts.fragment) ed?.scrollToHeading(opts.fragment);
    if (data.exists && opts.cursor === 'end') ed?.focusEnd();
    else if (opts.focus && data.exists) ed?.focus();

    // The note is on screen. Only now the sub-page bar: the folder is read from disk, and the index is brought up to date
    // for just this folder, so new files show at once instead of after the whole workspace has been indexed.
    void this.loadChildren().then(() => {
      if (seq !== this.openSeq) return;
      return this.ws.syncFolder(path).catch(() => undefined);
    });
  }

  /** Make the tree show where the open page is (see openPage). Without `expand`, only the selection follows. */
  private async revealInTree(path: string, expand: boolean): Promise<void> {
    const sess = this.active;
    if (!sess) return;
    if (!expand) {
      sess.tree.select(sess.tree.get(path) ? path : sess.tree.selected);
      if (sess.tree.get(path)) return;
    }
    try {
      const anchor = await sess.ws.treeAnchor(path);
      if (this.active !== sess) return;
      if (anchor === null) sess.tree.select(null);
      else if (expand) await sess.tree.reveal(anchor);
      else sess.tree.select(anchor);
    } catch {
      sess.tree.select(sess.tree.get(path) ? path : null);
    }
  }

  private async reloadCurrent(): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    const data = await this.ws.readPage(cur.path);
    this.baseHash = data.hash;
    this.baseText = data.text;
    this.h1Baseline = data.exists ? (findFirstH1(data.text.split('\n'))?.text ?? null) : null;
    this.conflict.value = null;
    this.saveState.value = 'saved';
    this.current.value = { path: cur.path, exists: data.exists };
    this.editor?.load(data.exists ? data.text : '', { plain: this.isPlainPage(cur.path), readOnly: this.readOnlyPages, canvas: this.isCanvasPage(cur.path) });
    if (this.editor) this.outline.value = this.editor.outline(); if (this.editor) this.annotations.value = this.editor.annotations();
    void this.loadLinks();
  }

  async createVirtualPage(): Promise<void> {
    const cur = this.current.value;
    if (!cur || cur.exists) return;
    try {
      await this.ws.promoteVirtual(cur.path);
      await this.openPage(cur.path, { force: true, cursor: 'end' });
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- saving

  /** Called by the editor on every change. */
  // ---- word, page and slide counts

  scheduleStats(delay = 600): void {
    if (this.statsTimer) clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => void this.refreshStats(), delay);
  }

  /** The `exportStyle` of the open page: its own (as typed, saved or not), else the one `children:` hands down. */
  private async exportStyleOf(path: string, text: string): Promise<string | null> {
    const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text.slice(0, 8000));
    const own = fm ? /^exportStyle[ \t]*:[ \t]*(.*?)[ \t]*$/im.exec(fm[1]!) : null;
    if (own) {
      const v = own[1]!.replace(/^["']|["']$/g, '').trim();
      return v === '' || /^(none|default)$/i.test(v) ? null : v;
    }
    if (this.inheritedStyle?.path !== path) {
      const info = await this.ws.pageInfo(path).catch(() => null);
      const key = info ? Object.keys(info.attributes).find((k) => k.toLowerCase() === 'exportstyle') : undefined;
      const v = key ? (info!.attributes[key]?.[0]?.text ?? '').trim() : '';
      this.inheritedStyle = { path, value: v === '' ? null : v };
    }
    return this.inheritedStyle.value;
  }

  /** The style set an `exportStyle` names (null: there is none of that name). */
  exportStyleNamed(name: string): StyleSet | null {
    const hit = this.exportStyleSets().find((x) => x.set.name.toLowerCase() === name.toLowerCase());
    return hit ? this.withWorkspaceStyles(hit.set) : null;
  }

  /** How many pages the text makes in a style: laid out out of sight with the engine that prints, so it is what a PDF gets. */
  private async countPages(markdown: string, style: StyleSet, title: string): Promise<number | null> {
    await this.loadFonts();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:900px;border:0;visibility:hidden;pointer-events:none';
    frame.srcdoc = renderHtml(parseDoc(markdown), style, { title, paged: true, css: this.fontCss.value });
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    document.body.append(frame);
    try {
      await Promise.race([loaded, new Promise<void>((r) => setTimeout(r, 5000))]);
      const doc = frame.contentDocument;
      if (!doc) return null;
      await doc.fonts.ready.catch(() => undefined);
      return paginate(doc, style, title, { sheets: false });
    } finally {
      frame.remove();
    }
  }

  private async refreshStats(): Promise<void> {
    const cur = this.current.value;
    const ed = this.editorRef;
    const run = ++this.statsRun;
    if (!cur?.exists || !ed) {
      this.docStats.value = { path: '', words: 0, pages: null, slides: null, style: null, missing: false };
      return;
    }
    const text = ed.text();
    const slides = this.presentationTheme.value ? splitSlides(text).length : null;
    const style = slides === null ? await this.exportStyleOf(cur.path, text) : null;
    if (run !== this.statsRun) return;
    const keep = this.docStats.value.path === cur.path && this.docStats.value.style === style ? this.docStats.value.pages : null;
    this.docStats.value = { path: cur.path, words: countWords(text), pages: keep, slides, style, missing: false };
    if (!style) return;
    if (this.exportYamlRoot !== (this.active?.root ?? '')) {
      await this.loadExportStyles();
      if (run !== this.statsRun) return;
    }
    const set = this.exportStyleNamed(style);
    const pages = await this.countPages(text, set ?? this.withWorkspaceStyles(BUILTIN_STYLES[0]!), pageTitleOf(cur.path)).catch(() => null);
    if (run !== this.statsRun) return;
    this.docStats.value = { path: cur.path, words: this.docStats.value.words, pages, slides: null, style, missing: set === null };
  }

  /** Read `presentationTheme:` from the front matter of the open page (what makes a page a presentation). */
  refreshPresentation(): void {
    const text = this.editorRef?.text().slice(0, 6000) ?? '';
    const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    const m = fm ? /^presentationTheme[ \t]*:[ \t]*(.*?)[ \t]*$/m.exec(fm[1]!) : null;
    const v = m ? m[1]!.replace(/^["']|["']$/g, '').trim() : '';
    const next = v === '' ? null : v;
    if (this.presentationTheme.value !== next) this.presentationTheme.value = next;
  }

  /** The themes of this workspace: the built-in ones, then its own (`presentation-themes:`). */
  presentationThemes(): SlideTheme[] {
    const look = this.active ? this.looks.value[this.active.root] : undefined;
    return themesFromConfig(look?.presentation?.themes);
  }

  /** Put the open page's markdown through the editor, as the smallest change that gets there (so undo and the cursor stay sensible). */
  private rewriteEditor(next: string): void {
    const ed = this.editorRef;
    if (!ed) return;
    const prev = ed.text();
    if (prev === next) return;
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    ed.applyChanges([{ from: a, to: prev.length - b, insert: next.slice(a, next.length - b) }], { undoable: true });
  }

  /** Give slide `index` another layout (null: let the rules decide again). Edits the page itself. */
  setSlideLayout(index: number, layout: string | null): void {
    const ed = this.editorRef;
    if (ed) this.rewriteEditor(setSlideLayout(ed.text(), index, layout));
  }

  /** Change which theme the page asks for, in its front matter. */
  setPresentationTheme(name: string): void {
    const ed = this.editorRef;
    if (!ed) return;
    const text = ed.text();
    const fm = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(text);
    if (!fm) return;
    const line = /^presentationTheme[ \t]*:.*$/m;
    const body = line.test(fm[2]!) ? fm[2]!.replace(line, `presentationTheme: ${name}`) : `${fm[2]}\npresentationTheme: ${name}`;
    this.rewriteEditor(`${fm[1]}${body}${fm[3]}${text.slice(fm[0].length)}`);
    this.refreshPresentation();
  }

  /** The pictures written in a slide's lines, in order (the ones in code are not pictures). */
  slidePictures(from: number, to: number): ImageRef[] {
    return imagesInLines(this.editorRef?.text() ?? '', from, to);
  }

  /** The page's text with the settings of one picture of a slide changed (`null` takes a setting away), without changing the page. */
  withPictureSettings(from: number, to: number, which: number, patch: { [K in keyof ImageAttrs]?: ImageAttrs[K] | null }): string | null {
    const text = this.editorRef?.text() ?? '';
    const ref = imagesInLines(text, from, to)[which];
    return ref ? withImageAttrs(text, ref, patch) : null;
  }

  /** Change the settings of one picture of a slide in the page itself (crop, size, expand to the slide's height, background). */
  setPictureSettings(from: number, to: number, which: number, patch: { [K in keyof ImageAttrs]?: ImageAttrs[K] | null }): void {
    const next = this.withPictureSettings(from, to, which, patch);
    if (next !== null) this.rewriteEditor(next);
  }

  /** The size of a picture of the page, and an address to show it by (for the crop window). */
  measurePicture(url: string): Promise<{ w: number; h: number; src: string } | null> {
    const src = this.assetUrl(url);
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, src });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /** The image sizes of a page, found by loading each picture (so that portrait and landscape can be told apart). */
  private async measureImages(markdown: string): Promise<Map<string, { w: number; h: number }>> {
    const urls = new Set<string>();
    for (const m of markdown.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)/g)) urls.add(m[1]!.replace(/^<|>$/g, ''));
    const sizes = new Map<string, { w: number; h: number }>();
    await Promise.all(
      [...urls].map(
        (u) =>
          new Promise<void>((resolve) => {
            const src = this.assetUrl(u);
            if (!src) return resolve();
            const img = new Image();
            img.onload = () => {
              sizes.set(u, { w: img.naturalWidth, h: img.naturalHeight });
              resolve();
            };
            img.onerror = () => resolve();
            img.src = src;
          }),
      ),
    );
    return sizes;
  }

  /** The open page as a presentation: its HTML, how each slide was laid out, and what in the theme will not carry over to other formats. */
  async buildPresentation(start = 0, forFile = false, markdownOverride?: string): Promise<{ html: string; presenter: string; placed: PlacedSlide[]; slides: string[]; css: string; theme: SlideTheme; warnings: string[] }> {
    const md = markdownOverride ?? this.editorRef?.text() ?? '';
    const themes = this.presentationThemes();
    const want = (this.presentationTheme.value ?? '').toLowerCase();
    const theme = themes.find((t) => t.name.toLowerCase() === want) ?? themes[0]!;
    const sizes = await this.measureImages(md);
    const look = this.active ? this.looks.value[this.active.root] : undefined;
    const { html, presenter, placed, slides } = renderSlidesHtml(md, theme, {
      title: this.current.value ? pageTitleOf(this.current.value.path) : 'Presentation',
      rules: cleanRules(look?.presentation?.rules),
      imageSrc: (u) => this.assetUrl(u.replace(/^<|>$/g, '')),
      imageSize: (u) => sizes.get(u.replace(/^<|>$/g, '')) ?? null,
      start,
    });
    const warnings = themeWarnings(theme);
    if (!themes.some((t) => t.name.toLowerCase() === want)) warnings.unshift(`There is no theme called “${this.presentationTheme.value}”, so “${theme.name}” is used.`);
    void forFile;
    return { html, presenter, placed, slides, css: slideCss(theme, '.deck-scope'), theme, warnings };
  }

  /** The screens of this computer (for the presentation settings). */
  listDisplays(): ReturnType<MainApi['getDisplays']> {
    return this.main.getDisplays();
  }

  /** Show the presentation full screen in its own window, with the presenter's window if the settings ask for it. */
  async startPresenting(start = 0): Promise<void> {
    if (!this.current.value) return;
    const s = this.settings.value;
    const built = await this.buildPresentation(start);
    this.closeDialog();
    try {
      await this.main.presentStart({ html: built.html, presenterHtml: s.presenterWindow ? built.presenter : null, screen: s.presentScreen, presenterScreen: s.presenterScreen });
    } catch (e) {
      this.toast(explain(e));
    }
  }

  async exportPresentation(format: 'pdf' | 'html'): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    const { html } = await this.buildPresentation(0, true);
    try {
      const saved = await this.main.exportPresentation({ html, format, defaultName: pageTitleOf(cur.path) });
      if (saved) this.exportDone(saved);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  openPresentation(present: boolean): void {
    this.refreshPresentation();
    if (!this.presentationTheme.value) return;
    if (present) void this.startPresenting(0);
    else this.dialog.value = { kind: 'presentation', present: false };
  }

  onEditorChange(): void {
    this.refreshPresentation();
    this.scheduleStats();
    const cur = this.current.value;
    if (!cur?.exists) return;
    if (this.saveState.value !== 'conflict') this.saveState.value = 'dirty';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  /** Save now if there is anything to save. Calls are serialized. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.queueSave(false);
  }

  /**
   * Saves run one after another. A save that gets no answer must not block the ones behind it for ever: that would
   * freeze everything that waits for a flush (opening pages, switching tabs, closing) while the editor itself,
   * which does not wait, kept working. So each save gets a deadline, and a failure never breaks the chain.
   */
  private queueSave(overwrite: boolean): Promise<void> {
    const run = async (): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      try {
        await Promise.race([
          this.doSave(overwrite),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('The workspace did not answer in time.'), { code: 'SAVE_TIMEOUT' })), SAVE_TIMEOUT_MS);
          }),
        ]);
      } catch (e) {
        const late = (e as { code?: string }).code === 'SAVE_TIMEOUT';
        console.error(`[save] ${late ? 'still waiting for the workspace' : 'failed'} after ${Math.round(performance.now() - started)} ms: ${(e as Error).message}`);
        // On a timeout the write is still running and settles the state itself when it is done; marking the page
        // dirty only makes the next autosave queue up behind it (doSave waits for lastWrite).
        if (this.saveState.value === 'saving' && !late) this.saveState.value = 'dirty';
        this.toast(late ? 'Saving is taking a while: the workspace is busy. Your text is safe in the editor and will be saved.' : `Could not save yet: ${explain(e)} Your text is still in the editor.`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    this.saving = this.saving.then(run);
    return this.saving;
  }

  private async doSave(overwrite = false): Promise<void> {
    // A save that timed out is not over: it is still on its way to the disk, and this one must not start before it
    // has landed (its answer is what moves the base hash on). Wait for it without any deadline of its own; the
    // callers that wait for flush() have their own.
    await this.lastWrite;
    const cur = this.current.value;
    const ed = this.editor;
    if (!cur?.exists || !ed || this.saveState.value === 'saved') return;
    if (this.saveState.value === 'conflict' && !overwrite) return;
    const text = ed.text();
    this.saveState.value = 'saving';
    try {
      const pending = this.ws.writePage(cur.path, text, overwrite ? null : this.baseHash, { deferIndex: true });
      this.lastWrite = pending.then(() => undefined, () => undefined);
      const res = await pending;
      if (!res.ok) {
        // the file changed since it was loaded: merge what is on disk into the editor and save again
        if (this.mergeTries++ < 4 && (await this.mergeFromDisk())) return;
        this.conflict.value = { diskHash: res.diskHash };
        this.saveState.value = 'conflict';
        return;
      }
      this.mergeTries = 0;
      this.baseHash = res.hash;
      this.baseText = text;
      this.conflict.value = null;
      // If the user typed more while we were saving, stay dirty and save again.
      if (this.current.value?.path === cur.path && ed.text() !== text) {
        this.saveState.value = 'dirty';
        this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
      } else this.saveState.value = 'saved';
    } catch (e) {
      this.saveState.value = 'dirty';
      this.toast(`Could not save: ${explain(e)}`);
    }
  }

  async resolveConflict(choice: 'reload' | 'overwrite'): Promise<void> {
    if (choice === 'reload') {
      await this.reloadCurrent();
      return;
    }
    await this.queueSave(true);
  }

  // ---------------------------------------------------------------- links

  private async loadLinks(): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    try {
      const [links, backlinks] = await Promise.all([this.ws.links(cur.path), this.ws.backlinks(cur.path)]);
      if (this.current.value?.path !== cur.path) return;
      this.links.value = links;
      this.backlinks.value = backlinks;
      this.statusByTarget = new Map(links.filter((l) => l.syntax === 'wiki').map((l) => [l.target, l.status]));
      this.editor?.refreshLinks();
    } catch {
      /* the page may have just been removed */
    }
    try {
      const hits = await this.ws.automationRulesFor(cur.path);
      if (this.current.value?.path !== cur.path) return;
      if (hits.length > 0 || this.automationHits.value.hits.length > 0 || this.automationHits.value.path !== cur.path) this.automationHits.value = { path: cur.path, hits };
    } catch {
      /* no automations here, or the page just went */
    }
  }

  /** Status of a wikilink by target, for the editor's colouring. */
  wikiStatus = (target: string): 'ok' | 'broken' | 'ambiguous' | 'unknown' => {
    const s = this.statusByTarget.get(target);
    return s === 'ok' || s === 'broken' || s === 'ambiguous' ? s : 'unknown';
  };

  suggest = async (query: string): Promise<PageSuggestion[]> => {
    if (!this.workspace.value) return [];
    return this.ws.suggestPages(query, 12);
  };

  /** Where an image path written in the current page lives, as a URL the window may load. */
  assetUrl = (href: string): string | null => {
    const cur = this.current.value;
    return cur ? this.assetUrlFor(cur.path, href) : null;
  };

  /** Same, for an image path written in any page. */
  assetUrlFor = (pagePath: string, href: string): string | null => {
    const cur = { path: pagePath };
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
    const dir = cur.path.includes('/') ? cur.path.slice(0, cur.path.lastIndexOf('/')) : '';
    const parts = (href.startsWith('/') ? href.slice(1) : `${dir}/${decodeURIComponent(href)}`).split('/');
    const out: string[] = [];
    for (const p of parts) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (!out.pop()) return null;
      } else out.push(p);
    }
    if (!this.active) return null;
    const encoded = out.map(encodeURIComponent);
    if (this.deps.assetUrl) return this.deps.assetUrl(this.active.root, encoded);
    // `from` and `href` say which page asked for which link: if the file is not where the link points, the app looks in the
    // page's own folder too (a bare `pic.jpg` for a file that lives beside the page's children), and the log says who asked
    return `cave-asset://${this.active.assetId}/${encoded.join('/')}?from=${encodeURIComponent(pagePath)}&href=${encodeURIComponent(href)}`;
  };

  /** Follow a link written in the current page (from Ctrl+click). */
  /** Buttons being run right now (rule + page), so a second click while one is running does nothing. */
  private runningButtons = new Set<string>();

  /** The rules of the Plugins menu in the open workspace. */
  readonly plugins = signal<PluginInfo[]>([]);

  /** Add a plugin, export style or template from files: the window asks what and where. */
  openImport(what: ImportKind): void {
    this.dialog.value = { kind: 'import', what };
  }

  async pickImportFiles(mode: 'file' | 'folder'): Promise<string[]> {
    return this.main.pickImportFiles(mode).catch(() => []);
  }

  /** The paths of files dropped on the window (what the system gave Electron). */
  pathsOfDropped(files: FileList | File[]): string[] {
    return [...files].map((f) => this.deps.pathForFile?.(f) ?? '').filter(Boolean);
  }

  async runImport(req: Omit<ImportRequest, 'workspaceRoot'>): Promise<ImportResult> {
    const r = await this.main.importFromFile({ ...req, ...(this.active ? { workspaceRoot: this.active.root } : {}) }).catch((e) => ({ ok: false, message: explain(e), added: [] }));
    if (r.ok) {
      this.toast(r.message);
      if (req.kind === 'plugin') await this.refreshPlugins();
      else if (req.kind === 'style') await this.loadExportStyles();
    }
    return r;
  }

  async refreshPlugins(): Promise<void> {
    try {
      this.plugins.value = this.workspace.value && !this.activeSingle.value ? await this.ws.automationPlugins() : [];
    } catch {
      this.plugins.value = [];
    }
  }

  /**
   * Run a plugin from the Plugins menu. It works on the selected text, or on the whole page when nothing is selected; the questions
   * of its `ask:` come first. The changed text goes into the editor as a single change, so Undo takes all of it back.
   */
  private pluginKey(plugin: PluginInfo): string {
    return `${this.active?.root ?? ''}|${plugin.id}`;
  }

  /** A plugin the person turned off (from its dialog) on this computer. */
  isPluginOff(plugin: PluginInfo): boolean {
    return this.settings.value.disabledPlugins.includes(this.pluginKey(plugin));
  }

  /** Turn a plugin off or on again, for this workspace on this computer; the rule itself stays in the workspace untouched. */
  setPluginOff(plugin: PluginInfo, off: boolean): void {
    const key = this.pluginKey(plugin);
    const rest = this.settings.value.disabledPlugins.filter((k) => k !== key);
    this.setPreferences({ disabledPlugins: off ? [...rest, key] : rest });
    this.toast(off ? `“${plugin.label}” is turned off. It stays in the Plugins menu, dimmed: choose it there to turn it on.` : `“${plugin.label}” is turned on.`);
  }

  /** The window listing every plugin, to turn them on and off or uninstall them. */
  async openPluginsDialog(): Promise<void> {
    await this.refreshPlugins();
    this.dialog.value = { kind: 'plugins' };
  }

  /** Uninstall a plugin after asking. A plugin of the workspace is taken out of its settings file; one that comes with the app, out of the app's config folder. */
  async uninstallPlugin(plugin: PluginInfo): Promise<void> {
    const shipped = plugin.origin === 'default';
    const ok = await this.confirm({
      title: `Uninstall “${plugin.label}”?`,
      body: shipped ? 'It comes with the app. Its file is deleted from the app config folder, and it is not copied back when the app updates. “Restore default plugins” brings it back.' : 'Its rule is deleted from this workspace’s settings file (the rest of the file is left as it is). Syncing carries this to your other computers.',
      confirm: 'Uninstall',
      destructive: true,
    });
    if (!ok) return;
    try {
      const r = await this.ws.uninstallPlugin(plugin.id);
      this.toast(r.message);
    } catch (e) {
      this.toast(explain(e));
    }
    await this.refreshPlugins();
  }

  /** Bring back the plugins that come with the app and were uninstalled. */
  async restoreDefaultPlugins(): Promise<void> {
    try {
      const n = await this.ws.restoreDefaultPlugins();
      this.toast(n === 0 ? 'All the default plugins are installed already.' : n === 1 ? 'One default plugin was restored.' : `${n} default plugins were restored.`);
    } catch (e) {
      this.toast(explain(e));
    }
    await this.refreshPlugins();
  }

  /** A plugin to run as soon as the question about accepting its workspace's settings has been answered with yes. */
  private pluginAfterGlobals: string | null = null;

  /** The question about accepting settings from other workspaces was answered: take up a plugin that was waiting for it. */
  async afterGlobalsAnswered(): Promise<void> {
    const id = this.pluginAfterGlobals;
    this.pluginAfterGlobals = null;
    await this.refreshPlugins();
    const plugin = id ? this.plugins.value.find((p) => p.id === id && !p.pending) : undefined;
    if (plugin) await this.runPlugin(plugin);
  }

  async runPlugin(plugin: PluginInfo): Promise<void> {
    if (plugin.pending) {
      // a plugin another workspace offers: nothing of it runs before the person has said yes to taking it
      const offer = await this.ws.globalsOffer(plugin.pending.source).catch(() => null);
      const root = this.workspace.value?.root;
      if (!offer || !root) return;
      const s = this.settings.value;
      this.pluginAfterGlobals = plugin.id;
      this.dialog.value = { kind: 'globals', offers: [offer], workspaces: [...new Set([root, ...s.recent, ...s.found])], current: root };
      return;
    }
    if (this.isPluginOff(plugin)) {
      this.setPluginOff(plugin, false);
      return;
    }
    const ed = this.editorRef;
    const cur = this.current.value;
    if (!ed || !cur) {
      this.toast('Open a page first: a plugin works on its text.');
      return;
    }
    const go = async (answers: Record<string, unknown>): Promise<string | null> => {
      const sel = ed.view.state.selection.main;
      const hasSel = !sel.empty;
      const from = hasSel ? sel.from : 0;
      const to = hasSel ? sel.to : ed.view.state.doc.length;
      const before = ed.view.state.doc.sliceString(from, to);
      try {
        const res = await this.ws.automationPlugin(plugin.id, cur.path, before, hasSel, answers, Math.max(0, Math.min(sel.head - from, before.length)));
        if (res.status === 'failed' || res.status === 'refused') return res.detail || 'The plugin did not run.';
        if (!res.changed) {
          if (res.selection && ed.view.state.doc.sliceString(from, to) === before) {
            // the script only moved the cursor or the selection
            ed.view.dispatch({ selection: { anchor: from + res.selection.anchor, head: from + res.selection.head }, scrollIntoView: true });
            ed.view.focus();
            return null;
          }
          if (plugin.ask.length > 0 && plugin.ask.every((q) => q.type === 'info')) return null; // it only showed a message
          this.toast(res.detail ? `${plugin.label}: ${res.detail}` : `${plugin.label}: nothing to change.`);
          return null;
        }
        // the text may have been typed into while the plugin ran: only apply when the range is still what it was given
        if (ed.view.state.doc.sliceString(from, to) !== before) return 'The text changed while the plugin ran. Try again.';
        ed.view.dispatch({ changes: { from, to, insert: res.text }, selection: res.selection ? { anchor: from + res.selection.anchor, head: from + res.selection.head } : hasSel ? { anchor: from, head: from + res.text.length } : undefined, userEvent: 'input.plugin', scrollIntoView: true });
        ed.view.focus();
        this.toast(`${plugin.label}: done${hasSel ? ' (on the selection)' : ' (on the whole page)'}.`);
        return null;
      } catch (e) {
        return explain(e);
      }
    };
    if (plugin.ask.length === 0) {
      const err = await go({});
      if (err) this.toast(err);
      return;
    }
    // the questions may show something worked out from the text (`${words}`), so they are filled in just before they are shown
    const sel = ed.view.state.selection.main;
    let fields = plugin.ask;
    try {
      fields = await this.ws.automationPluginAsk(plugin.id, cur.path, sel.empty ? ed.view.state.doc.toString() : ed.view.state.doc.sliceString(sel.from, sel.to), !sel.empty);
    } catch {
      /* the questions as written will do */
    }
    this.dialog.value = { kind: 'plugin-ask', plugin, title: plugin.label, fields, confirm: fields.every((q) => q.type === 'info') ? 'OK' : 'Run', submit: go };
  }

  /**
   * A button `[=Label](automation:rule-id)` was clicked. The page is saved first so the rule sees what was just typed. A run that
   * did happen announces itself (the toast of every automation run); one that did not is explained here.
   */
  async runAutomationButton(ruleId: string): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    const key = `${ruleId}|${cur.path}`;
    if (this.runningButtons.has(key)) return;
    this.runningButtons.add(key);
    try {
      await this.flush();
      // a rule with questions (`ask:`) shows them first and runs when they are answered
      const q = await this.ws.automationButtonAsk(ruleId, cur.path).catch(() => ({ title: ruleId, ask: [] as PluginAsk[] }));
      const finish = (res: { status: string; detail: string }): string | null => {
        if (res.status === 'refused') return res.detail;
        if (res.status === 'skipped') this.toast(`“${ruleId}” did not run here: ${res.detail}`);
        return null; // a run that happened (done or failed) is announced by the automation toast
      };
      if (q.ask.length > 0) {
        const path = cur.path;
        this.dialog.value = {
          kind: 'plugin-ask',
          plugin: null,
          title: q.title,
          fields: q.ask,
          confirm: q.ask.every((f) => f.type === 'info') ? 'OK' : 'Run',
          submit: async (answers) => {
            await this.flush();
            try {
              return finish(await this.ws.automationButton(ruleId, path, answers));
            } catch (e) {
              return explain(e);
            }
          },
        };
        return;
      }
      const res = await this.ws.automationButton(ruleId, cur.path);
      const err = finish(res);
      if (err) this.toast(err);
    } catch (e) {
      this.toast(explain(e));
    } finally {
      this.runningButtons.delete(key);
    }
  }

  /** The Run button of a shell code block in the shown page. Asks the first time in a workspace; see the main process. */
  async runCodeBlock(req: { code: string; lang: string; terminal?: boolean }): Promise<{ ran: boolean; code?: number | null; output?: string; timedOut?: boolean; stopped?: boolean; reason?: string; terminal?: boolean }> {
    const cur = this.current.value;
    const sess = this.active;
    if (!cur || !sess) return { ran: false, reason: 'There is no page open.' };
    if (sess.docs) return { ran: false, reason: 'Scripts cannot be run from the documentation. Copy it instead.' };
    await this.flush();
    return this.main.runScript(sess.root, cur.path, req.code, req.lang, req.terminal);
  }

  /** Preferences: forget what was allowed and what was refused: shell commands, scripts, and the workspaces that may run scripts. */
  async forgetScriptApprovals(): Promise<void> {
    await this.main.forgetScriptApprovals();
    this.toast('Forgotten, the approvals and the refusals. Commands and scripts will ask again.');
  }

  stopCodeBlock(): void {
    void this.main.stopScript();
  }

  async followLink(link: FollowableLink, newTab = false): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    // Ctrl+click on the text of an automation button runs it, as clicking the button does
    const auto = /^automation:\s*([A-Za-z0-9][\w.-]{0,63})\s*$/i.exec(link.target);
    if (auto) {
      await this.runAutomationButton(auto[1]!);
      return;
    }
    if (link.target === '' && link.fragment) {
      this.editor?.scrollToHeading(link.fragment);
      return;
    }
    await this.followResolved(await this.ws.resolveLink({ syntax: link.syntax, target: link.target, fragment: link.fragment }, cur.path), newTab, () => this.editor?.cursorIntoLink(link));
  }

  /** Follow a link from the links panel (already resolved by the index where possible). */
  async followIndexed(l: LinkInfo): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    if (l.kind === 'page' && l.status === 'ok' && l.resolvedPage) {
      await this.openPage(l.resolvedPage, { fragment: l.fragment, focus: true });
      return;
    }
    if (l.kind === 'page' && l.target === '' && l.fragment) {
      this.editor?.scrollToHeading(l.fragment);
      return;
    }
    await this.followResolved(await this.ws.resolveLink({ syntax: l.kind === 'workspace' ? 'md' : l.syntax, target: l.kind === 'web' || l.kind === 'other' || l.kind === 'workspace' ? (l.url ?? l.raw) : l.target, fragment: l.fragment }, cur.path));
  }

  /** The root of the workspace called `name` (its folder name), among those open and those found on the computer. */
  private async workspaceRootByName(name: string): Promise<string | null> {
    const want = name.trim().toLowerCase();
    const leaf = (r: string): string => r.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!.toLowerCase();
    for (const r of this.sessions.keys()) if (leaf(r) === want) return r;
    const found = await this.main.scanWorkspaces().catch(() => [] as string[]);
    return found.find((r) => leaf(r) === want) ?? null;
  }

  /**
   * What a link to another workspace (`[[Theology::Writings/Grace]]`, `[[Sync::1. Main Document.odt]]`) points at, for showing it:
   * a page (with its title) or a file that is not a note (its name), or null when the workspace or the target is not found.
   */
  async describeForeign(workspace: string, target: string): Promise<{ path: string; title: string; file: boolean } | null> {
    const root = await this.workspaceRootByName(workspace);
    if (!root || !target) return null;
    try {
      const there = await this.ensureSession(root);
      const bare = target.replace(/\.(md|markdown|mdx|txt)$/i, '');
      const asPath = await there.ws.resolveLink({ syntax: 'md', target, fragment: null }, 'index.md').catch(() => null);
      if (asPath && asPath.kind === 'file') return { path: target, title: target.split('/').pop() ?? target, file: true };
      const r = await there.ws.resolveLink({ syntax: 'wiki', target: bare.includes('/') ? `/${bare.replace(/^\//, '')}` : bare, fragment: null }, 'index.md');
      if (r.kind === 'file') return { path: target, title: target.split('/').pop() ?? target, file: true };
      const path = r.kind === 'page' && r.status === 'ok' ? r.path : r.kind === 'page' && r.status === 'ambiguous' ? r.candidates[0]! : null;
      if (!path) return null;
      const info = await there.ws.pageInfo(path).catch(() => null);
      return { path, title: info?.title ?? pageTitleOf(path), file: false };
    } catch {
      return null;
    }
  }

  /** Follow a link to a page of another workspace: that workspace opens in its own tab (if it is not open yet) with the page shown. */
  async openWorkspaceLink(workspace: string, target: string, fragment: string | null): Promise<void> {
    const root = await this.workspaceRootByName(workspace);
    if (!root) {
      this.toast(`There is no workspace called “${workspace}”.`);
      return;
    }
    const bare = target.replace(/\.(md|markdown|mdx|txt)$/i, '');
    const link = { syntax: 'wiki' as const, target: bare.includes('/') ? `/${bare.replace(/^\//, '')}` : bare, fragment };
    // a file that is not a note (an .odt, a PDF) is opened by the program for it, without moving to that workspace
    if (target) {
      try {
        const there = await this.ensureSession(root);
        // a path as the workspace lists it (`Docs/report.odt`) is read as a Markdown link from the top folder; a name alone as a wiki link
        const asPath = await there.ws.resolveLink({ syntax: 'md', target, fragment: null }, 'index.md').catch(() => null);
        const peek = asPath && asPath.kind === 'file' ? asPath : await there.ws.resolveLink(link, 'index.md');
        if (peek.kind === 'file') {
          const err = await this.main.openPath(peek.absPath);
          if (err) this.toast(`Could not open the file: ${err}`);
          return;
        }
        // a file that is not a note, named by its path in that workspace: open it from there even when no link style finds it
        if (!isNoteName(target, this.settings.value.noteExts) && !target.startsWith('/') && !target.split('/').includes('..')) {
          const abs = await there.ws.filePath(target).catch(() => null);
          if (abs) {
            const err = await this.main.openPath(abs);
            if (!err) return;
          }
        }
      } catch {
        /* fall through: opening the workspace reports what is wrong */
      }
    }
    await this.openWorkspace(root);
    const sess = this.sessions.get(root);
    if (!sess || !target) return;
    try {
      const r = await sess.ws.resolveLink(link, 'index.md');
      if (r.kind === 'page' && r.status === 'ok') await this.openPage(r.path, { fragment, focus: true });
      else if (r.kind === 'page' && r.status === 'ambiguous') await this.openPage(r.candidates[0]!, { fragment, focus: true });
      else this.toast(`“${bare}” is not in the workspace “${workspace}”.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  private async followResolved(r: Awaited<ReturnType<WorkerApi['resolveLink']>>, newTab = false, editLink?: () => void): Promise<void> {
    switch (r.kind) {
      case 'page':
        if (r.status === 'ok') {
          if (newTab) await this.openInNewTab(r.path);
          else await this.openPage(r.path, { fragment: r.fragment, focus: true });
        }
        else if (r.status === 'ambiguous') {
          const pick = await this.choose({
            title: `“${r.name}” matches several pages`,
            body: 'Choose the page you meant:',
            options: r.candidates.map((c) => ({ label: stripExt(c), value: c })),
          });
          if (pick) await this.openPage(pick, { fragment: r.fragment, focus: true });
        } else if (this.activeSingle.value) this.toast(`“${r.name}” is not here: this file is open on its own, without its folder.`);
        else await this.offerCreate(r.name, editLink);
        break;
      case 'workspace':
        await this.openWorkspaceLink(r.workspace, r.target, r.fragment);
        break;
      case 'file': {
        if (this.activeSingle.value && isNoteName(r.absPath, this.settings.value.noteExts) && (await this.main.isFile(r.absPath))) {
          await this.openFile(r.absPath); // a link from one file to another Markdown file opens it in a tab of its own
          break;
        }
        const err = await this.main.openPath(r.absPath);
        if (err) this.toast(`Could not open the file: ${err}`);
        break;
      }
      case 'web':
        if (!(await this.main.openExternal(r.url))) this.toast('That link cannot be opened.');
        break;
      default:
        this.toast('That kind of link is not opened for safety.');
    }
  }

  /**
   * A page for a name typed into a list of pages to choose from, made on the spot: under the open page (or under the page that
   * the pages of a relation are `under:`), with what the query of those pages implies (a relation to `kind:project` makes a
   * page with `kind: project`, so that it is one of the pages the relation can name). Returns the page, or null when it was not made.
   */
  async createNamedPage(title: string, relation?: { name: string; side: 'forward' | 'back' }): Promise<RelationPage | null> {
    const t = title.trim();
    if (!t) return null;
    try {
      const cur = this.current.value?.path ?? null;
      let defaults: { attrs: Record<string, string>; under: string | null } = { attrs: {}, under: null };
      const rel = relation ? this.saved.value.relations.find((r) => r.name === relation.name) : undefined;
      const q = rel ? this.saved.value.queries.find((x) => x.name === (relation!.side === 'forward' ? rel.to : rel.from)) : undefined;
      if (q) defaults = newPageDefaults(q.query);
      let parent: string | null = cur;
      if (defaults.under) {
        if (cur && stripExt(cur) === defaults.under) parent = cur;
        else {
          const r = await this.ws.resolveLink({ syntax: 'wiki', target: defaults.under }, cur ?? '');
          if (r.kind === 'page' && r.status === 'ok') parent = r.path;
        }
      }
      const name = nameFromTitle(t);
      const content = Object.keys(defaults.attrs).length > 0 ? newPageContent(t, defaults.attrs) : undefined;
      const taken = name !== '' && (await this.ws.pageNameTaken(parent, name));
      const path = taken ? await this.ws.createPageNumbered(parent, name, content ?? `# ${t}\n`, true) : await this.ws.createPage(parent, t, content, undefined, true);
      await this.tree.refresh([parent]);
      this.viewTick.value++;
      return { path, title: t };
    } catch (e) {
      this.toast(explain(e));
      return null;
    }
  }

  /** The `[[` list's "Create page": the text typed is already a link in the page; make the page and go to it. */
  async createLinkedPage(name: string): Promise<void> {
    await this.flush(); // the link just written is saved before the page is left
    const made = await this.createNamedPage(name);
    if (made) await this.openPage(made.path, { reveal: true, cursor: 'end' });
  }

  private async offerCreate(name: string, editLink?: () => void): Promise<void> {
    const cur = this.current.value;
    if (!cur) return;
    const where = stripExt(cur.path).split('/').pop();
    if (editLink) {
      const pick = await this.choose({
        title: `There is no page called “${name}”`,
        body: 'The link points at nothing. Create the page, or correct the link.',
        options: [
          { label: 'Create the Page', detail: `It will be created inside “${where}”`, value: 'create' },
          { label: 'Edit the Link', detail: 'Put the cursor in the link to change it', value: 'edit' },
        ],
      });
      if (pick === 'edit') editLink();
      if (pick !== 'create') return;
    } else {
      const ok = await this.confirm({
        title: `Create “${name}”?`,
        body: `There is no page called “${name}”. It will be created inside “${where}”.`,
        confirm: 'Create',
      });
      if (!ok) return;
    }
    try {
      const created = await this.ws.createPage(cur.path, name.split('/').pop() ?? name);
      await this.tree.refresh([cur.path]);
      await this.openPage(created, { reveal: true, cursor: 'end' });
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** The warning of a broken link in the links panel: put the cursor in that link, in the editor, to correct it. */
  editBrokenLink(l: LinkInfo): void {
    if (!this.editor?.cursorIntoLinkOnLine(l.line, l.target, l.syntax)) this.toast('That link could not be found in the text any more.');
  }

  /** A link right-clicked in the editor: find out what it points at, then show the menu. Returns true when a menu will show. */
  openLinkMenu(link: FollowableLink, e: MouseEvent): boolean {
    const cur = this.current.value;
    if (!cur) return false;
    if (link.target === '') return false; // a same-page anchor
    const at = { x: e.clientX, y: e.clientY };
    void (async () => {
      try {
        const r = await this.ws.resolveLink({ syntax: link.syntax, target: link.target, fragment: link.fragment }, cur.path);
        let target: NonNullable<Controller['linkMenu']['value']>['target'] = { kind: 'broken' };
        if (r.kind === 'page' && r.status === 'ok') target = { kind: 'page', path: r.path };
        else if (r.kind === 'file') target = { kind: 'file', abs: r.absPath };
        else if (r.kind !== 'page') return;
        this.linkMenu.value = { ...at, link, target };
      } catch (err) {
        this.toast(explain(err));
      }
    })();
    return true;
  }

  async revealLinkTarget(t: { kind: 'page'; path: string } | { kind: 'file'; abs: string }): Promise<void> {
    if (t.kind === 'page') await this.revealPage(t.path);
    else {
      const err = await this.main.revealPath(t.abs);
      if (err) this.toast(`Could not show it in the file manager: ${err}`);
    }
  }

  // ---------------------------------------------------------------- files dropped on the editor

  /** `dest` as it is written in a Markdown link: in <angle brackets> when it has spaces. */
  private linkDest(dest: string): string {
    const clean = dest.replace(/[<>]/g, (c) => (c === '<' ? '%3C' : '%3E')).replace(/\n/g, ' ');
    return /[\s()]/.test(clean) ? `<${clean}>` : clean;
  }

  private static readonly EMBEDDABLE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

  /** Files dropped on the text at `pos`: ask what to do with each, then write the links. */
  async dropFiles(files: File[], pos: number | null): Promise<void> {
    const cur = this.current.value;
    const sess = this.active;
    if (!cur?.exists || !sess) return;
    const pageAtStart = cur.path;
    const lines: string[] = [];
    for (const f of files) {
      const abs = this.deps.pathForFile?.(f) ?? '';
      const name = f.name;
      if (!abs) {
        this.toast(`Could not tell where “${name}” is on disk.`);
        continue;
      }
      try {
        const canCopy = !sess.single && !sess.config;
        const image = Controller.EMBEDDABLE.test(name);
        // a file that already is in the folder of the page is not copied there again, and there is nothing to ask about copying
        const inPlace = canCopy ? await this.ws.fileInPage(pageAtStart, abs) : null;
        let embed = false;
        let copy = false;
        if (inPlace) {
          if (image) {
            const pick = await this.choose({
              title: `Embed “${name}”?`,
              body: 'The image can be shown in the page. It is already in the folder of this page, so it is not copied again.',
              options: [
                { label: 'Embed the Image', detail: 'Shows it in the text', value: 'embed' },
                { label: 'Don’t Embed', detail: 'Add it as a link instead', value: 'link' },
              ],
            });
            if (pick === null) continue;
            embed = pick === 'embed';
          }
          if (this.current.value?.path !== pageAtStart) {
            this.toast('The page was changed before the file could be added.');
            return;
          }
          lines.push(`${embed ? '!' : ''}[${inPlace.split('/').pop() ?? name}](${this.linkDest(inPlace)})`);
          continue;
        }
        if (image && canCopy) {
          const pick = await this.choose({
            title: `Embed “${name}”?`,
            body: 'The image can be shown in the page. It is copied into the page as a child of it, and linked from here.',
            options: [
              { label: 'Embed the Image', detail: 'Shows it in the text', value: 'embed' },
              { label: 'Don’t Embed', detail: 'Add it as a link instead', value: 'link' },
            ],
          });
          if (pick === null) continue;
          embed = pick === 'embed';
          copy = embed;
        }
        if (!embed) {
          if (canCopy) {
            const pick = await this.choose({
              title: `Add “${name}”`,
              body: 'How should the file be linked?',
              options: [
                { label: 'Copy It into the Page', detail: 'Kept as a child of this page, and linked from here', value: 'copy' },
                { label: 'Link to the Original', detail: 'The file stays where it is', value: 'external' },
              ],
            });
            if (pick === null) continue;
            copy = pick === 'copy';
          }
        }
        if (this.current.value?.path !== pageAtStart) {
          this.toast('The page was changed before the file could be added.');
          return;
        }
        if (copy) {
          const r = await this.ws.importFile(pageAtStart, abs);
          const label = r.rel.split('/').pop() ?? name;
          lines.push(`${embed ? '!' : ''}[${label}](${this.linkDest(r.rel)})`);
        } else {
          const url = `file://${abs.split('/').map(encodeURIComponent).join('/')}`;
          lines.push(`[${name}](${url})`);
        }
      } catch (e) {
        this.toast(explain(e));
      }
    }
    if (lines.length === 0 || !this.editor) return;
    this.editor.insertText(lines.join('\n'), pos ?? undefined);
    await this.tree.refresh([pageAtStart]).catch(() => undefined);
    void this.loadChildren();
  }

  /** The folder of the workspace shown now. */
  activeRoot(): string | null {
    return this.active?.root ?? null;
  }

  /** A page dragged into the text of the open page becomes a link to it, at the place it was dropped. From another workspace it is a link to that workspace. */
  async dropPageInEditor(path: string, pos: number | null, fromRoot = ''): Promise<void> {
    const cur = this.current.value;
    if (!cur?.exists || !this.editor) return;
    try {
      if (fromRoot && this.active && fromRoot !== this.active.root) {
        const leaf = fromRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? fromRoot;
        this.editor.insertText(`[[${leaf}::${stripExt(path)}]]`, pos ?? undefined);
        return;
      }
      const name = stripExt(path).split('/').pop() ?? path;
      // the short form when the name is enough to find the page; otherwise the path
      const hit = await this.ws.resolveLink({ syntax: 'wiki', target: name }, cur.path);
      const target = hit.kind === 'page' && hit.status === 'ok' && hit.path === path ? name : stripExt(path);
      this.editor.insertText(`[[${target}]]`, pos ?? undefined);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /**
   * A file that is not a note, dragged from the sub-page bar into the text: a link to it, written relative to the page (an
   * image can be embedded instead). From another workspace there is no way to write a link that will keep working, so it says so.
   */
  async dropWorkspaceFileInEditor(filePath: string, pos: number | null, fromRoot = ''): Promise<void> {
    const cur = this.current.value;
    if (!cur?.exists || !this.editor) return;
    if (fromRoot && this.active && fromRoot !== this.active.root) {
      this.toast('That file is in another workspace, so it cannot be linked from here.');
      return;
    }
    const name = filePath.split('/').pop() ?? filePath;
    let embed = false;
    if (Controller.EMBEDDABLE.test(name)) {
      const pick = await this.choose({
        title: `Embed “${name}”?`,
        body: 'The image can be shown in the page.',
        options: [
          { label: 'Embed the Image', detail: 'Shows it in the text', value: 'embed' },
          { label: 'Don’t Embed', detail: 'Add it as a link instead', value: 'link' },
        ],
      });
      if (pick === null) return;
      embed = pick === 'embed';
    }
    if (this.current.value?.path !== cur.path || !this.editor) {
      this.toast('The page was changed before the file could be added.');
      return;
    }
    this.editor.insertText(`${embed ? '!' : ''}[${name}](${this.linkDest(relativeLinkPath(cur.path, filePath))})`, pos ?? undefined);
  }

  /** The values a page has of one attribute in its own frontmatter (lists as they are written). */
  private async ownValues(path: string, key: string): Promise<string[]> {
    const page = await this.ws.readPage(path);
    const fm = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(page.text)?.[1];
    if (!fm) return [];
    const doc = YAML.parse(fm) as Record<string, unknown> | null;
    const v = doc?.[key];
    if (v === undefined || v === null) return [];
    return (Array.isArray(v) ? v : [v]).map(String);
  }

  /** Whether a page already stands where a view's place filter (`under:`, `children:` ...) wants its pages. */
  private async fitsPlace(path: string, req: { key: 'under' | 'children' | 'parent' | 'over'; value: string }): Promise<boolean> {
    const cur = this.current.value?.path ?? '';
    for (const v of req.value.split(',')) {
      const r = await this.ws.resolveLink({ syntax: 'wiki', target: v.trim() }, cur);
      if (r.kind !== 'page' || r.status !== 'ok') continue;
      const folder = stripExt(r.path);
      const mine = stripExt(path);
      const dir = mine.includes('/') ? mine.slice(0, mine.lastIndexOf('/')) : '';
      if (req.key === 'under' && mine.startsWith(`${folder}/`)) return true;
      if (req.key === 'children' && dir === folder) return true;
      if (req.key === 'parent' && mine === (folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '')) return true;
      if (req.key === 'over' && folder.startsWith(`${mine}/`)) return true;
    }
    return false;
  }

  /**
   * Pages dropped on a database view get what the view needs of its pages: the attribute values its filters name,
   * and, when it was dropped in a group (a board column, a calendar day), that group's value. If the view wants its
   * pages in a place (`under:`) and a page is not there, nothing is changed: that would mean moving the file.
   */
  async dropPagesOnView(paths: string[], query: string, group?: { key: string; value: string | null }): Promise<boolean> {
    const pages = [...new Set(paths)].filter((p) => !!p);
    if (pages.length === 0) return false;
    for (const p of pages) {
      for (const req of placementOf(query)) {
        if (!(await this.fitsPlace(p, req))) {
          const name = pageTitleOf(p) ?? stripExt(p).split('/').pop() ?? p;
          this.toast(`“${name}” was not added: this view only shows pages ${req.key === 'under' ? 'below' : req.key === 'children' ? 'directly below' : req.key === 'parent' ? 'that are the parent of' : 'above'} “${req.value.split(',')[0]}”, and getting it there would mean moving the file.`);
          return false;
        }
      }
    }
    const keys = this.facetKeys.value;
    const want = new Map<string, string | null>(Object.entries(newPageDefaults(query).attrs));
    if (group) want.set(group.key, group.value);
    if (want.size === 0) {
      this.toast('Nothing was changed: this view’s filters do not name an attribute that a page would need to appear in it.');
      return false;
    }
    let done = 0;
    for (const p of pages) {
      let ok = true;
      for (const [k, v] of want) {
        const info = keys.find((x) => x.key === k);
        let value: AttrValue | null;
        if (v === null) value = null;
        else if (info?.list) value = [...new Set([...(await this.ownValues(p, k).catch(() => [] as string[])), v])];
        else if (info?.type === 'number' && v.trim() !== '' && Number.isFinite(Number(v))) value = Number(v);
        else if (info?.type === 'bool') value = v === 'true';
        else value = v;
        ok = (await this.setPageAttribute(p, k, value)) && ok;
      }
      if (ok) done++;
    }
    this.viewTick.value++;
    if (done < pages.length) this.toast(`${done} of ${pages.length} pages were changed.`);
    return done > 0;
  }

  /** Look up the system icon of this kind of file once (a file of each extension stands for all of them). */
  async ensureFileIcon(f: FileItem): Promise<void> {
    const ext = (/\.([^./]+)$/.exec(f.name)?.[1] ?? '').toLowerCase();
    const key = `${this.active?.root ?? ''}|${ext}`;
    if (ext === '' || this.iconAsked.has(key) || !this.active) return;
    this.iconAsked.add(key);
    try {
      const abs = await this.ws.absolutePath(f.path);
      const url = await this.main.fileIcon(abs);
      if (url) this.fileIcons.value = { ...this.fileIcons.value, [ext]: url };
    } catch {
      /* the app's own icon stays */
    }
  }

  /** Show the page of a tab (not only the shown one) in the system file manager. */
  async revealTab(id: string): Promise<void> {
    const tab = this.tabs.value.find((t) => t.id === id);
    if (!tab) return;
    try {
      const sess = this.sessions.get(tab.root);
      const abs = tab.single ? tab.root : tab.path === null ? tab.root : await (sess?.ws ?? this.ws).absolutePath(tab.path);
      const err = await this.main.revealPath(abs);
      if (err) this.toast(`Could not show it in the file manager: ${err}`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- sub-pages and views

  /** Load the open page's direct children (for the bar under the editor). */
  async loadChildren(): Promise<void> {
    const cur = this.current.value;
    const seq = ++this.childrenSeq;
    if (!cur) {
      this.children.value = [];
      return;
    }
    try {
      const [kids, files] = await Promise.all([this.ws.listChildren(cur.path, { includeHidden: true, forChildren: true }), this.ws.listFiles(cur.path).catch(() => [] as FileItem[])]);
      if (seq === this.childrenSeq) {
        this.children.value = kids;
        this.folderFiles.value = files;
      }
    } catch {
      if (seq === this.childrenSeq) {
        this.children.value = [];
        this.folderFiles.value = [];
      }
    }
  }

  setChildrenFilter(filter: 'notes' | 'all'): void {
    this.patchSettings({ childrenFilter: filter });
  }

  /** A file in the page's folder that is not a note: open it with the program the system has for it. */
  async openFolderFile(f: FileItem): Promise<void> {
    try {
      const err = await this.main.openPath(await this.ws.filePath(f.path));
      if (err) this.toast(`Could not open ${f.name}: ${err}`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  toggleChildrenDock(): void {
    this.patchSettings({ childrenDocked: !this.settings.value.childrenDocked });
  }

  insertViewBlock(template?: string): void {
    this.editor?.insertViewBlock(template);
  }

  /** The workspace's saved queries and relations, for view blocks and the Insert menu. */
  readonly saved = signal<SavedQueries>({ queries: [], relations: [], warnings: [] });

  async refreshSavedQueries(): Promise<void> {
    try {
      this.saved.value = await this.ws.savedQueries();
    } catch {
      /* no workspace open */
    }
  }

  /** Insert a view block that shows a saved query. */
  insertSavedQuery(name: string): void {
    this.insertViewBlock(savedViewTemplate(name));
  }

  /** Ask for a name, then keep `query` under it in the workspace file. Resolves with the name, or null if cancelled. */
  saveQueryAs(query: string, suggestion = ''): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialog.value = {
        kind: 'prompt',
        title: 'Save query',
        body: 'The query is kept in the workspace file, so any view in this workspace can use it as saved:name.',
        label: 'Name',
        value: suggestion,
        confirm: 'Save',
        submit: async (value) => {
          try {
            this.saved.value = await this.ws.saveQuery(value, query);
            resolve(value.trim());
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        },
      };
    });
  }

  /** Ctrl+Click on a saved query: its definition in a box, to change (saved under the same name). */
  async editSavedQuery(name: string): Promise<void> {
    await this.refreshSavedQueries();
    const q = this.saved.value.queries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!q) {
      this.toast(`There is no saved query called “${name}”.`);
      return;
    }
    this.dialog.value = {
      kind: 'prompt',
      title: `Edit query “${q.name}”`,
      body: 'Every view that uses saved:' + q.name + ' changes with it.',
      label: 'Query',
      value: q.query,
      confirm: 'Save',
      submit: async (value) => {
        if (!value.trim()) return 'Enter a query.';
        try {
          this.saved.value = await this.ws.saveQuery(q.name, value);
          this.viewTick.value++;
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
    };
  }

  /**
   * Pages matching a view's query, with their attributes. `saved:Workspace::name` terms run the saved query of that
   * workspace there; they can be one of the alternatives of an OR (`status:todo OR saved:Theology::open-tasks`).
   * Those pages are shown, not edited, and open their own workspace.
   */
  async queryView(query: string, attrs: string[] | null, limit?: number, offset?: number, colors?: Array<{ when: string; color: string }>): Promise<ViewData> {
    const here = this.active;
    if (!here || !/saved:/i.test(query) || !query.includes('::')) return this.ws.queryView(query, attrs, limit, offset, colors);
    return this.queryAcross(here, query, attrs, limit, offset, colors, []);
  }

  /** Run a query in `sess`, with its saved queries of other workspaces run in theirs, and join the pages. */
  private async queryAcross(sess: Session, query: string, attrs: string[] | null, limit: number | undefined, offset: number | undefined, colors: Array<{ when: string; color: string }> | undefined, stack: string[]): Promise<ViewData> {
    let text = query;
    if (stack.length > 0 && /saved:/i.test(text)) {
      // a query that came from another workspace: its own saved queries may lead to yet another workspace
      const names = new Map((await sess.ws.savedQueries()).queries.map((q) => [q.name.toLowerCase(), q.query]));
      const errs: string[] = [];
      const expanded = expandSaved(text, names, errs);
      if (splitForeign(expanded).foreign.length > 0) text = expanded;
    }
    const split = splitForeign(text);
    if (split.foreign.length > 0) this.foreignAskedAt = Date.now();
    if (split.foreign.length === 0) {
      return split.errors.length ? { ...(await sess.ws.queryView(text, attrs, limit, offset, colors)), errors: split.errors } : sess.ws.queryView(text, attrs, limit, offset, colors);
    }
    if (stack.length >= 6) return { rows: [], total: 0, errors: ['Saved queries of other workspaces lead too far into each other.'] };
    const leaf = (r: string): string => r.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!;
    const errors = [...split.errors];
    // the order of the view (or of the query written here) replaces any order a saved query of another workspace brings
    const withSort = (q: string): string => [split.sort.length ? withoutSort(q) : q, ...split.sort].join(' ').trim();
    const local: string[] = split.local ? [split.local] : [];
    const remote: Array<{ workspace: string; sess: Session; query: string; key: string }> = [];
    for (const f of split.foreign) {
      const root = await this.workspaceRootByName(f.workspace);
      if (!root) {
        errors.push(`There is no workspace called “${f.workspace}”.`);
        continue;
      }
      if (root === sess.root) {
        local.push(`saved:${JSON.stringify(f.name)}`); // a name for this very workspace: an ordinary saved query
        continue;
      }
      const other = await this.ensureSession(root);
      const found = (await other.ws.savedQueries()).queries.find((q) => q.name.toLowerCase() === f.name.toLowerCase());
      if (!found) {
        errors.push(`The workspace “${f.workspace}” has no saved query “${f.name}”.`);
        continue;
      }
      const key = `${root}\u0000${found.name.toLowerCase()}`;
      if (stack.includes(key)) {
        errors.push(`The saved query “${f.workspace}::${found.name}” uses itself.`);
        continue;
      }
      remote.push({ workspace: leaf(root), sess: other, query: found.query, key });
    }
    const parts: Array<() => Promise<ViewData>> = [];
    const localQuery = local.length > 0 ? withSort(local.join(' OR ')) : '';
    const single = (localQuery ? 1 : 0) + remote.length === 1;
    // with one part the page asked for is fetched as it is; with several, each gives its first `offset + limit` pages and they are merged
    const want = single ? { limit, offset } : { limit: limit === undefined ? undefined : (offset ?? 0) + limit, offset: 0 };
    if (localQuery) parts.push(() => sess.ws.queryView(localQuery, attrs, want.limit, want.offset, colors));
    for (const r of remote) {
      parts.push(async () => {
        const d = await this.queryAcross(r.sess, withSort(r.query), attrs, want.limit, want.offset, colors, [...stack, r.key]);
        return { ...d, rows: d.rows.map((row) => ({ ...row, workspace: row.workspace ?? r.workspace })) };
      });
    }
    const results = await Promise.all(parts.map((run) => run().catch((e: unknown) => ({ rows: [] as ViewRow[], total: 0, errors: [e instanceof Error ? e.message : String(e)] }))));
    for (const r of results) errors.push(...r.errors);
    if (results.length === 1) return { rows: results[0]!.rows, total: results[0]!.total, errors };
    const seen = new Set<string>();
    let rows = results.flatMap((r) => r.rows).filter((r) => {
      const k = `${r.workspace ?? ''}\u0000${r.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    rows = (sortRowsBy(rows as Row[], split.sortSpec || 'title') as ViewRow[]);
    const start = offset ?? 0;
    const total = results.some((r) => r.total === null) ? null : results.reduce((n, r) => n + (r.total ?? 0), 0) - (results.reduce((n, r) => n + r.rows.length, 0) - seen.size);
    return { rows: limit === undefined ? rows.slice(start) : rows.slice(start, start + limit), total, errors };
  }

  async refreshFacetKeys(): Promise<void> {
    void this.refreshSavedQueries();
    try {
      this.facetKeys.value = await this.ws.attributeKeys();
    } catch {
      /* keep the old list */
    }
  }

  async ensureFacetKeys(): Promise<AttributeKey[]> {
    if (this.facetKeys.value.length === 0) {
      try {
        this.facetKeys.value = await this.ws.attributeKeys();
      } catch {
        /* none */
      }
    }
    return this.facetKeys.value;
  }

  // ---------------------------------------------------------------- title and file name

  /** The cursor left the first heading's line, or the editor lost focus: if the heading's text changed, offer to rename the page to match. */
  onEditorLineChange(): void {
    void this.checkTitleRename(false);
    requestAnimationFrame(() => this.updateActiveHeading());
  }
  onEditorBlur(): void {
    void this.checkTitleRename(true);
  }

  private async checkTitleRename(blur: boolean): Promise<void> {
    const ed = this.editor;
    const cur = this.current.value;
    if (!ed || !cur?.exists || this.activeSingle.value || this.asking.rename || this.dialog.value) return;
    const h = ed.firstH1();
    if (!h) return;
    if (!blur && ed.hasFocus() && ed.cursorLine() === h.line) return; // still typing in it
    if (h.text === this.h1Baseline) return;
    const name = nameFromTitle(h.text);
    const old = stripExt(cur.path).split('/').pop() ?? '';
    this.h1Baseline = h.text; // asked once per wording, whatever the answer
    if (!name || name === old) return;
    this.asking.rename = true;
    try {
      const ok = await this.confirm({
        title: 'Rename the page to match?',
        body: `The title is now “${h.text}”. Rename the page “${old}” to “${name}” too? Links to it are updated.`,
        confirm: 'Rename',
      });
      if (!ok || this.current.value?.path !== cur.path) return;
      await this.renameTo(cur.path, name);
    } finally {
      this.asking.rename = false;
      if (!blur) ed.focus();
    }
  }

  /** Rename a page's file (links to it are updated, as with Rename Page). */
  private async renameTo(path: string, name: string): Promise<boolean> {
    try {
      await this.flush();
      const plan = await this.ws.planMove(path, this.tree.parentPath(path), name);
      if (plan.noop) return true;
      return (await this.confirmAndApply(plan, 'Renamed')) !== null;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  /** Edit a page's title from a view: the heading is rewritten and the file renamed to match. */
  async setPageTitle(path: string, title: string): Promise<boolean> {
    const clean = title.trim();
    const name = nameFromTitle(clean);
    if (!name) {
      this.toast('A page needs a name.');
      return false;
    }
    const isCurrent = this.current.value?.path === path;
    if (isCurrent) await this.flush();
    try {
      const r = await this.ws.setPageTitle(path, clean);
      if (!r.ok) {
        this.toast('That page changed on disk. Try again.');
        return false;
      }
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
    const old = stripExt(path).split('/').pop() ?? '';
    if (name !== old) return this.renameTo(path, name);
    if (isCurrent) await this.reloadCurrent();
    return true;
  }

  // ---------------------------------------------------------------- page history

  openHistory(): void {
    const cur = this.current.value;
    if (cur?.exists) this.dialog.value = { kind: 'history', path: cur.path };
  }
  pageHistory(path: string): Promise<HistoryEntry[]> {
    return this.ws.historyList(path).catch(() => []);
  }
  pageHistoryText(path: string, id: string): Promise<string | null> {
    return this.ws.historyRead(path, id).catch(() => null);
  }
  /** Put an earlier version into the editor as an ordinary edit (undoable); the text it replaces is kept in the history. */
  async restoreVersion(text: string): Promise<void> {
    const ed = this.editor;
    const cur = this.current.value;
    if (!ed || !cur?.exists) return;
    await this.ws.snapshot(cur.path, ed.text(), 'before-restore').catch(() => {});
    ed.applyChanges(textChanges(ed.text(), text), { undoable: true });
    this.closeDialog();
    this.toast('Version restored. It is saved like any other edit.');
  }

  /** Change one frontmatter attribute of a page (drag a card to another column, drop on a day). */
  async setPageAttribute(path: string, key: string, value: AttrValue | null): Promise<boolean> {
    const isCurrent = this.current.value?.path === path;
    if (isCurrent) await this.flush();
    try {
      const r = await this.ws.setAttribute(path, key, value);
      if (!r.ok) {
        this.toast('That page changed on disk. Try again.');
        return false;
      }
      if (isCurrent) await this.reloadCurrent();
      return true;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  /** The pages a relation cell may offer for the text typed so far. */
  async relationCandidates(relation: string, side: 'forward' | 'back', text: string, exclude: string[]): Promise<RelationPage[]> {
    const here = (exclude.filter((k) => !k.includes('\u0000')));
    const [local, other] = await Promise.all([this.ws.relationCandidates(relation, side, text, here).catch(() => [] as RelationPage[]), this.foreignCandidates(relation, side, text, exclude).catch(() => [] as RelationPage[])]);
    return [...local, ...other.slice(0, 8)];
  }

  /** The workspaces on this computer: those open and those known from before, by folder name (the first of a name wins). */
  private knownWorkspaces(): Array<{ name: string; root: string }> {
    const leaf = (r: string): string => r.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!;
    const seen = new Set<string>();
    const out: Array<{ name: string; root: string }> = [];
    for (const root of [...new Set(this.sessions.values())].filter((x) => !x.single && !x.config && !x.docs).map((x) => x.root).concat(this.settings.value.recent, this.settings.value.found)) {
      const name = leaf(root);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, root });
    }
    return out;
  }

  /**
   * Pages of other workspaces a relation could name: the ones the saved query on its other side finds there (it can hold
   * `saved:Workspace::name` terms), narrowed by the start of the words typed.
   */
  private async foreignCandidates(relation: string, side: 'forward' | 'back', text: string, exclude: string[]): Promise<RelationPage[]> {
    const here = this.active;
    if (!here) return [];
    const saved = await here.ws.savedQueries();
    const l = relation.toLowerCase();
    const rel = saved.relations.find((r) => r.name.toLowerCase() === l || (r.backname ?? r.reverse ?? '').toLowerCase() === l);
    if (!rel) return [];
    const expanded = expandSaved(`saved:${JSON.stringify(side === 'forward' ? rel.to : rel.from)}`, new Map(saved.queries.map((q) => [q.name.toLowerCase(), q.query])), []);
    if (!expanded.includes('::')) return [];
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const skip = new Set(exclude);
    const data = await this.queryAcross(here, expanded, null, 400, 0, undefined, []);
    return data.rows
      .filter((r) => r.workspace && !skip.has(`${r.workspace.toLowerCase()}\u0000${r.path}`))
      .filter((r) => words.every((w) => r.title.toLowerCase().split(/\s+/).some((t) => t.startsWith(w))))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => ({ path: r.path, title: r.title, workspace: r.workspace! }));
  }

  /**
   * Change what a relation cell names, and the other side of a mutual relation with it. When something is in the way
   * (a page that can hold one link only and already has one, a page that cannot be changed) the person is asked what
   * to do, one question at a time, and nothing is written until all are answered. Returns false when it was cancelled or failed.
   */
  async editRelation(page: string, pageTitle: string, relation: string, side: 'forward' | 'back', pages: RelationPage[], memory: RelationMemory = {}): Promise<boolean> {
    // one change at a time: a second one starts from the file the first one wrote, never from the file as it was before it
    const turn = this.relationTurn.then(() => this.runRelationEdit(page, pageTitle, relation, side, pages, memory));
    this.relationTurn = turn.then(() => undefined, () => undefined);
    return turn;
  }
  private relationTurn: Promise<void> = Promise.resolve();

  private async runRelationEdit(page: string, pageTitle: string, relation: string, side: 'forward' | 'back', pages: RelationPage[], memory: RelationMemory): Promise<boolean> {
    const values = pages.filter((p) => !p.workspace).map((p) => p.path);
    const foreign = pages.filter((p) => p.workspace).map((p) => ({ workspace: p.workspace!, path: p.path }));
    const resolutions: Record<string, RelationResolution> = {};
    try {
      await this.flush();
      for (let round = 0; round < 8; round++) {
        const r = await this.ws.editRelation({ page, relation, side, values, foreign, workspaces: this.knownWorkspaces(), resolutions });
        if (r.ok) {
          if (r.changed.includes(this.current.value?.path ?? '\u0000')) await this.reloadCurrent();
          return true;
        }
        if ('error' in r) {
          this.toast(r.error);
          return false;
        }
        for (const c of r.conflicts) {
          const answer = await this.askRelationConflict(c, pageTitle, memory);
          if (!answer) return false;
          resolutions[c.id] = answer;
        }
      }
      this.toast('The relation could not be changed. Nothing was changed.');
      return false;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  private async askRelationConflict(c: RelationConflict, here: string, memory: RelationMemory): Promise<RelationResolution | null> {
    const t = c.page.workspace ? `${c.page.title} (in ${c.page.workspace})` : c.page.title;
    const cancel = { label: 'Cancel the change', detail: 'Leave everything as it was', value: 'cancel' };
    const holderPage = c.id.startsWith('holder\u0000');
    let pick: string | null;
    if (c.kind === 'taken') {
      const q = c.holder?.title ?? 'another page';
      pick = await this.choose({
        title: `“${t}” already has a link`,
        body: `In this relation “${t}” can be linked to one page only, and it is linked to “${q}”. Linking it to “${here}” means “${q}” loses it.`,
        options: [
          { label: `Move it to “${here}”`, detail: `“${q}” stops naming “${t}”`, value: 'replace' },
          { label: `Don’t link “${t}”`, detail: 'The rest of your change still happens', value: 'skip' },
          cancel,
        ],
      });
    } else if (holderPage) {
      pick = await this.choose({
        title: `“${t}” can’t be updated`,
        body: `Moving the link would also take it away from “${t}”, but ${c.reason ?? 'it cannot be changed'}. If you go on, “${t}” keeps naming a page that no longer names it back.`,
        options: [
          { label: 'Move it anyway', detail: `“${t}” is left as it is`, value: 'one-sided' },
          { label: 'Don’t move it', detail: 'The rest of your change still happens', value: 'skip' },
          cancel,
        ],
      });
    } else if (c.action === 'link') {
      // the table says what to do with a page or file that cannot name this page back: no need to ask
      if (memory.mode === 'link') return 'one-sided';
      if (memory.mode === 'skip') return 'skip';
      pick = await this.choose({
        ...(memory.remember ? { remember: { label: 'Do this every time in this table', values: ['one-sided', 'skip'], apply: (v: string) => memory.remember!(v === 'one-sided' ? 'link' : 'skip') } } : {}),
        title: `“${t}” can’t be updated`,
        body: `“${t}” can’t name “${here}” back because ${c.reason ?? 'it cannot be changed'}. You can still link it from “${here}”, but the two pages will disagree until it is fixed.`,
        options: [
          { label: `Link it from “${here}” only`, value: 'one-sided' },
          { label: `Don’t link “${t}”`, detail: 'The rest of your change still happens', value: 'skip' },
          cancel,
        ],
      });
    } else {
      pick = await this.choose({
        title: `“${t}” can’t be updated`,
        body: `“${t}” can’t be changed because ${c.reason ?? 'it cannot be changed'}, so it would keep naming “${here}” after the link is removed here.`,
        options: [
          { label: `Remove it from “${here}” only`, detail: `“${t}” keeps its side of the link`, value: 'one-sided' },
          { label: 'Keep the link', detail: 'The rest of your change still happens', value: 'skip' },
          cancel,
        ],
      });
    }
    return pick === 'replace' || pick === 'skip' || pick === 'one-sided' ? pick : null;
  }

  // ---------------------------------------------------------------- search

  openSearch(prefill?: string): void {
    if (!this.workspace.value || (this.active?.config && !this.active.docs)) return; // the settings folder is not indexed
    if (!this.settings.value.showLeft) this.patchSettings({ showLeft: true });
    this.searchOpen.value = true;
    this.searchFocusTick.value++;
    if (prefill !== undefined) this.setSearchQuery(prefill, true);
    void this.ws.attributeKeys().then((k) => (this.facetKeys.value = k)).catch(() => {});
    void this.refreshSavedQueries();
  }

  /** Search result → the file tree: switch to the Files pane and show where the page is. */
  async revealResultInTree(path: string): Promise<void> {
    this.searchOpen.value = false;
    // a note is opened as well as selected in the tree (openPage reveals it); other files are only shown
    if (isNoteName(path, this.settings.value.noteExts)) await this.openPage(path, { reveal: true });
    else await this.revealInTree(path, true);
  }

  /** Open the Files pane. */
  showFiles(): void {
    if (this.searchOpen.value) this.closeSearch();
  }

  /** Close the panel and bring the tree back to the page that is open. */
  /** The request a replace is made with. */
  private replaceRequest(): Parameters<WorkerApi['replaceFind']>[0] {
    const r = this.replaceState.value;
    return { find: r.find, replace: r.replace, regex: r.regex, matchCase: r.matchCase, wholeWord: r.wholeWord, kinds: (Object.keys(r.kinds) as Array<keyof typeof r.kinds>).filter((k) => r.kinds[k]), names: r.names, pages: this.searchQuery.value };
  }

  /** Change what a replace looks for or where; the preview is made again shortly after (not while a person is still typing). */
  setReplace(patch: Partial<ReturnType<Controller['replaceState']['peek']>>): void {
    this.replaceState.value = { ...this.replaceState.value, ...patch };
    if (this.replaceTimer) clearTimeout(this.replaceTimer);
    if (!this.replaceState.value.on) return;
    this.replaceTimer = setTimeout(() => void this.runReplaceFind(), 350);
  }

  /** Look for what would be replaced (nothing is changed). Every match is chosen at first. */
  async runReplaceFind(): Promise<void> {
    const r = this.replaceState.value;
    if (!this.ws || r.find === '') {
      this.replaceState.value = { ...r, found: null, loading: false, failure: null, picked: new Set() };
      return;
    }
    const seq = ++this.replaceSeq;
    this.replaceState.value = { ...r, loading: true, failure: null };
    try {
      const found = await this.ws.replaceFind(this.replaceRequest());
      if (seq !== this.replaceSeq) return;
      const picked = new Set<string>();
      for (const p of found.pages) {
        for (const m of p.matches) picked.add(`${p.path}\0${m.id}`);
        if (p.rename !== null) picked.add(`${p.path}\0name`);
      }
      this.replaceState.value = { ...this.replaceState.value, found, loading: false, failure: found.error, picked };
    } catch (e) {
      if (seq === this.replaceSeq) this.replaceState.value = { ...this.replaceState.value, loading: false, failure: explain(e) };
    }
  }

  /** Choose or leave out one match (`id`), a page's name (`name`), or all of a page's changes (`null`). */
  toggleReplacePick(path: string, id: string | null, on?: boolean): void {
    const r = this.replaceState.value;
    const picked = new Set(r.picked);
    const page = r.found?.pages.find((p) => p.path === path);
    if (!page) return;
    const keys = id === null ? [...page.matches.map((m) => `${path}\0${m.id}`), ...(page.rename !== null ? [`${path}\0name`] : [])] : [`${path}\0${id}`];
    const turnOn = on ?? !keys.every((k) => picked.has(k));
    for (const k of keys) {
      if (turnOn) picked.add(k);
      else picked.delete(k);
    }
    this.replaceState.value = { ...r, picked };
  }

  /** Make the chosen replacements, after asking. The pages changed keep their old text in their history. */
  async applyReplace(): Promise<void> {
    const r = this.replaceState.value;
    const ws = this.ws;
    if (!ws || !r.found) return;
    const choices = r.found.pages
      .map((p) => ({ path: p.path, matches: p.matches.filter((m) => r.picked.has(`${p.path}\0${m.id}`)).map((m) => m.id), rename: p.rename !== null && r.picked.has(`${p.path}\0name`) }))
      .filter((c) => c.matches.length > 0 || c.rename);
    const count = choices.reduce((n, c) => n + c.matches.length + (c.rename ? 1 : 0), 0);
    if (count === 0) return;
    const ok = await new Promise<boolean>((resolve) => {
      this.dialog.value = {
        kind: 'confirm',
        title: `Replace ${count.toLocaleString()} ${count === 1 ? 'match' : 'matches'}?`,
        body: `${choices.length === 1 ? 'One page' : `${choices.length} pages`} will be changed. Their earlier text stays in each page’s history.${r.names ? ' Pages whose names change are renamed, and links to them are updated.' : ''}`,
        confirm: 'Replace',
        destructive: true,
        resolve,
      };
    });
    if (!ok) return;
    try {
      await this.flush();
      const done = await ws.replaceApply(this.replaceRequest(), choices);
      this.toast(`${done.matches.toLocaleString()} ${done.matches === 1 ? 'match' : 'matches'} replaced in ${done.pages} ${done.pages === 1 ? 'page' : 'pages'}${done.renamed ? `; ${done.renamed} renamed` : ''}${done.failed.length ? `. Not changed: ${done.failed.slice(0, 3).join('; ')}${done.failed.length > 3 ? '…' : ''}` : '.'}`);
    } catch (e) {
      this.toast(`Replace failed: ${explain(e)}`);
    }
    await this.runReplaceFind();
  }

  /** Open a page at a match (the first one of a page when no line is given). */
  async openReplaceMatch(path: string, line?: number): Promise<void> {
    await this.openPage(path);
    const ed = this.editorRef;
    if (ed && line) {
      const at = ed.text().split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
      ed.scrollToCentered(at);
    }
  }

  closeSearch(): void {
    this.searchOpen.value = false;
    const cur = this.current.value;
    if (cur) void this.revealInTree(cur.path, true);
  }

  toggleSearch(): void {
    if (this.searchOpen.value) this.closeSearch();
    else this.openSearch();
  }

  private resetSearch(): void {
    this.searchQuery.value = '';
    this.searchSel.value = 0;
    this.session.setQuery('');
    this.facetKeys.value = [];
  }

  setSearchQuery(text: string, immediate = false): void {
    this.searchQuery.value = text;
    this.searchSel.value = 0;
    this.session.setQuery(text, immediate);
    if (this.replaceState.value.on) this.setReplace({}); // the pages it looks in changed
  }

  /** Add the filter token (e.g. `status:draft`) to the query, or remove it if present. */
  toggleSearchToken(token: string): void {
    this.setSearchQuery(toggleToken(this.searchQuery.value, token), true);
    this.searchFocusTick.value++;
  }

  setSearchSort(sort: string | null): void {
    this.setSearchQuery(setSort(this.searchQuery.value, sort), true);
  }

  moveSearchSelection(delta: number, preview = true): void {
    const n = this.searchState.value.results.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, this.searchSel.value + delta));
    this.searchSel.value = i;
    const hit = this.searchState.value.results[i];
    if (hit && preview) this.openSoon(hit.path);
  }

  async openSearchResult(index: number, focus: boolean): Promise<void> {
    const hit = this.searchState.value.results[index];
    if (!hit) return;
    this.searchSel.value = index;
    await this.openPage(hit.path, { focus });
    if (focus) this.editor?.focus();
  }

  facetValues(key: string, query: string = this.searchQuery.value): Promise<Array<{ value: string; type: string; count: number }>> {
    return this.ws.attributeValues(key, query);
  }

  // ---------------------------------------------------------------- tree actions

  async onTreeAction(a: TreeAction): Promise<void> {
    switch (a.type) {
      case 'open':
        await this.openPage(a.path);
        break;
      case 'focus-editor':
        await this.openPage(a.path, { focus: true });
        this.editor?.focus();
        break;
      case 'rename':
        await this.renamePage(a.path);
        break;
      case 'delete':
        await this.deletePage(a.path);
        break;
      case 'new-child':
        await this.newPageIn(a.path);
        break;
    }
  }

  /** Where "New Page" puts a page by default: the preference, except in a settings folder, whose files sit at the top level. */
  get newPageMode(): NewPageMode {
    return this.active?.config && !this.active.docs ? 'top' : this.settings.value.newPageDefault;
  }

  /** "New Page": where it goes comes from the preference unless a mode is given. */
  async newPage(mode?: NewPageMode): Promise<void> {
    if (!this.workspace.value) return;
    const m = mode ?? this.newPageMode;
    const ref = this.current.value?.path ?? this.tree.selected;
    const parent = m === 'top' || !ref ? null : m === 'nested' ? ref : this.tree.parentPath(ref);
    await this.newPageIn(parent);
  }

  /** Can "beside this page" mean anything? Not for a top-level page (that is the top level). */
  get canAddBeside(): boolean {
    const ref = this.current.value?.path ?? this.tree.selected;
    return !!ref && this.tree.parentPath(ref) !== null;
  }

  /**
   * Fill the page `path` from a template: pick one of those on offer for it, and (when the page already has something
   * written) confirm before it is replaced. The change goes through the editor, so Undo brings the old text back.
   */
  async applyTemplate(path: string): Promise<void> {
    if (!this.workspace.value) return;
    if (this.current.value?.path !== path) await this.openPage(path);
    const view = this.editor?.view;
    if (!view || this.current.value?.path !== path) return;
    const { templates } = await this.ws.templatesFor(this.tree.parentPath(path));
    if (templates.length === 0) { this.toast('There are no templates for this page. Make a page with “template: true” in its attributes (inside the parent page, or in .cave-notes/templates).'); return; }
    const name = await new Promise<string | null>((resolve) => {
      this.dialog.value = { kind: 'choose', title: 'Apply a template', body: 'The page is filled from the template you pick.', options: templates.map((t) => ({ label: t.name, detail: t.where, value: t.name })), resolve };
    });
    if (!name) return;
    const r = await this.ws.templateText(path, name);
    if (!r.ok) { this.toast(r.error); return; }
    const text = view.state.doc.toString();
    const body = text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '').replace(/^#[ \t].*$/m, '').trim();
    const hasFrontmatter = /^---[ \t]*\r?\n/.test(text);
    if (body !== '' || hasFrontmatter) {
      const go = await new Promise<boolean>((resolve) => {
        this.dialog.value = { kind: 'confirm', title: 'Replace this page’s content?', body: `“${name}” replaces everything on this page, attributes included. You can undo it with Ctrl+Z.`, confirm: 'Replace', destructive: true, resolve };
      });
      if (!go) return;
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.text }, selection: { anchor: view.state.doc.length } });
    view.focus();
  }

  /** Make a canvas where a page would go (the same placement as New Page). */
  async newCanvas(mode?: NewPageMode): Promise<void> {
    if (!this.workspace.value) return;
    const m = mode ?? this.newPageMode;
    const ref = this.current.value?.path ?? this.tree.selected;
    const parent = m === 'top' || !ref ? null : m === 'nested' ? ref : this.tree.parentPath(ref);
    const where = parent ? stripExt(parent).split('/').pop() : this.workspace.value.name;
    this.dialog.value = {
      kind: 'prompt',
      title: 'New Canvas',
      body: parent ? `It will be created inside “${where}”.` : 'It will be created at the top level.',
      label: 'Name',
      value: '',
      confirm: 'Create',
      submit: async (name) => {
        const typed = name.trim().replace(/\.canvas$/i, '');
        if (!typed) return 'Enter a name.';
        try {
          const created = await this.ws.createPage(parent, `${typed}.canvas`);
          if (parent) await this.tree.expand(parent);
          await this.tree.refresh([parent]);
          await this.openPage(created, { reveal: true });
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  async newPageIn(target: string | null): Promise<void> {
    if (!this.workspace.value) return;
    const where = target ? stripExt(target).split('/').pop() : this.workspace.value.name;
    // templates on offer for a page made here (the drop-down is left out when there are none)
    const offer = await this.ws.templatesFor(target).catch(() => ({ templates: [], default: null as string | null }));
    const hasDefault = !!offer.default && offer.templates.some((t) => t.name.toLowerCase() === offer.default!.toLowerCase());
    const select = offer.templates.length === 0 && !this.caps.windows ? undefined : {
      label: 'Start from',
      value: '',
      options: [
        { label: hasDefault ? `Default (${offer.default})` : 'Blank page', value: '' },
        ...(hasDefault ? [{ label: 'Blank page', value: '__none__' }] : []),
        // with a default template the choice is the default or a blank page; otherwise any template on offer
        ...(hasDefault ? [] : offer.templates.map((t) => ({ label: `${t.name} (${t.where})`, value: t.name }))),
        ...(this.caps.windows ? [{ label: 'Add a template from a file…', value: '__import__' }] : []),
      ],
    };
    this.dialog.value = {
      kind: 'prompt',
      title: 'New Page',
      ...(select ? { select } : {}),
      body: target ? `It will be created inside “${where}”.` : 'It will be created at the top level.',
      label: 'Name',
      value: '',
      confirm: 'Create',
      submit: async (name, choice) => {
        if (!name.trim()) return 'Enter a name.';
        try {
          const created = await this.ws.createPage(target, name, undefined, choice === '__none__' ? null : choice ? choice : undefined);
          if (target) await this.tree.expand(target);
          await this.tree.refresh([target]);
          await this.openPage(created, { reveal: true, cursor: 'end' });
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  /**
   * Make a page from a view's "New" row: inside the page `under` names (when the view looks under one), else at the
   * top level. The page is not opened; it appears in the view. Resolves false (and tells the person why) on failure.
   */
  async createViewPage(title: string, content: string, under: string | null, opts: { quiet?: boolean; rememberQuiet?: () => void } = {}): Promise<boolean> {
    try {
      const cur = this.current.value?.path ?? null;
      // a page made with a view's New button goes under the page its `under:` names; with no `under:` it goes
      // under the page that holds the view
      let parent: string | null = null;
      if (under) {
        if (cur && stripExt(cur) === under) parent = cur;
        else {
          const r = await this.ws.resolveLink({ syntax: 'wiki', target: under }, cur ?? '');
          if (r.kind === 'page' && r.status === 'ok') parent = r.path;
          else {
            this.toast(`There is no page “${under}” to create it under.`);
            return false;
          }
        }
      } else parent = cur;
      const name = nameFromTitle(title);
      const taken = name !== '' && (await this.ws.pageNameTaken(parent, name));
      if (taken && !opts.quiet) {
        const go = await new Promise<boolean>((resolve) => {
          this.dialog.value = {
            kind: 'confirm',
            title: 'A page with this name exists',
            body: `There is already a page called “${name}” here. Create another one anyway? Its file will be named “${name}.1” (or the next free number); its title stays “${title.trim()}”.`,
            confirm: 'Create anyway',
            ...(opts.rememberQuiet ? { check: { label: 'Don’t warn me about this again in this view', apply: opts.rememberQuiet } } : {}),
            resolve,
          };
        });
        if (!go) return false;
      }
      if (taken) await this.ws.createPageNumbered(parent, name, content, true);
      else await this.ws.createPage(parent, title, content, undefined, true);
      await this.tree.refresh([parent]);
      this.viewTick.value++;
      void this.loadChildren(); // the sub-page bar of the open page shows the new page at once
      return true;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  async renamePage(path: string): Promise<void> {
    const old = stripExt(path).split('/').pop() ?? '';
    this.dialog.value = {
      kind: 'prompt',
      title: 'Rename Page',
      body: 'Links to this page are updated automatically.',
      label: 'Name',
      value: old,
      confirm: 'Rename',
      submit: async (name) => {
        if (!name.trim()) return 'Enter a name.';
        try {
          await this.flush();
          const plan = await this.ws.planMove(path, this.tree.parentPath(path), name);
          if (plan.noop) return null;
          this.dialog.value = null;
          await this.confirmAndApply(plan, 'Renamed');
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  /** Move `path` under `newParent` (null = top level), e.g. after a drag and drop. */
  /** Move a page under another one (null = top level). Returns its new path, or null if nothing moved. */
  async movePage(path: string, newParent: string | null): Promise<string | null> {
    if (this.tree.parentPath(path) === newParent) return null;
    // one move at a time: asking again while the first is still being planned only queues more work behind it
    if (this.movePlanning) {
      this.toast('Still checking the links for the previous move. Please wait for it to finish.');
      return null;
    }
    this.movePlanning = true;
    const slow = setTimeout(() => this.toast('Checking which links the move changes…'), 1500);
    try {
      await this.flush();
      const plan = await this.ws.planMove(path, newParent);
      clearTimeout(slow);
      this.movePlanning = false;
      if (plan.noop) return null;
      const res = await this.confirmAndApply(plan, 'Moved');
      return res ? mapPath(path, res.from, res.to) : null;
    } catch (e) {
      this.toast(explain(e));
      return null;
    } finally {
      clearTimeout(slow);
      this.movePlanning = false;
    }
  }

  private movePlanning = false;

  /**
   * A page dropped in the tree: onto a row (`into`: becomes its last sub-page) or between rows
   * (`before`/`after`: lands there among the siblings, which get `order` numbers if needed).
   */
  async dropPage(src: string, plan: DropPlan, zone: DropZone): Promise<void> {
    const sess = this.active;
    if (!sess) return;
    const noPage = this.tree.get(src)?.exists === false;
    try {
      let path = src;
      if (this.tree.parentPath(src) !== plan.parent) {
        const moved = await this.movePage(src, plan.parent);
        if (!moved) return;
        path = moved;
      }
      if (zone === 'into') return;
      // a folder without a page of its own has no file to hold an `order`: it moves, with everything in it, and stays by name
      if (noPage) return;
      await this.flush();
      await sess.ws.reorderPage(path, plan.before);
      this.states.delete(this.stateKey(path));
      await sess.tree.refresh(sess.tree.loadedParents());
      if (this.current.value?.path === path) await this.reloadCurrent();
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Show the link changes if there are any worth reviewing, then apply the plan. */
  private async confirmAndApply(plan: LinkPlan, verb: string): Promise<ApplyResult | null> {
    if (plan.summary.linksRewritten > 0 || plan.summary.warnings > 0) {
      const ok = await new Promise<boolean>((resolve) => {
        this.dialog.value = { kind: 'plan', title: `${verb === 'Renamed' ? 'Rename' : 'Move'} Page`, plan, confirm: verb === 'Renamed' ? 'Rename' : 'Move', resolve };
      });
      if (!ok) return null;
    }
    let res: ApplyResult;
    try {
      res = await this.ws.applyPlan(plan);
    } catch (e) {
      this.toast(explain(e));
      return null;
    }
    const to = stripExt(res.to).split('/').pop();
    const n = res.linksRewritten;
    this.toast(`${verb} “${to}”${n ? `. ${n} link${n === 1 ? '' : 's'} updated.` : '.'}`, { label: 'Undo', run: () => void this.undoMove() });
    void this.refreshLastMove();
    // Follow the open page to its new place; its text may also have changed (rewritten links).
    const cur = this.current.value;
    this.states.clear();
    this.remapTabs((p) => mapPath(p, res.from, res.to));
    if (cur) {
      const moved = mapPath(cur.path, res.from, res.to);
      await this.tree.refresh(this.tree.loadedParents());
      await this.openPage(moved, { force: true, reveal: true });
    } else await this.tree.refresh(this.tree.loadedParents());
    return res;
  }

  /** Pages moved or renamed: the other tabs of this workspace follow them. */
  private remapTabs(map: (path: string) => string): void {
    const root = this.active?.root;
    this.remapRoot(root, map);
  }

  private remapRoot(root: string | undefined, map: (path: string) => string): void {
    this.tabs.value = this.tabs.value.map((t) => (t.root === root && t.path ? { ...t, path: map(t.path) } : t));
    for (const t of this.tabs.value) {
      const n = this.navs.get(t.id);
      if (n && t.root === root) n.entries = n.entries.map(map);
    }
    this.navTick.value++;
    this.persistTabs();
  }

  async undoMove(): Promise<void> {
    try {
      await this.flush();
      const last = await this.ws.lastMove();
      if (!last) {
        this.toast('Nothing to undo.');
        return;
      }
      await this.ws.undoLast();
      this.states.clear();
      const cur = this.current.value;
      await this.tree.refresh(this.tree.loadedParents());
      this.remapTabs((p) => mapPath(p, last.to, last.from));
      if (cur) await this.openPage(mapPath(cur.path, last.to, last.from), { force: true, reveal: true });
      this.toast('Undone.');
      void this.refreshLastMove();
    } catch (e) {
      this.toast(explain(e));
    }
  }

  private async refreshLastMove(): Promise<void> {
    const sess = this.active;
    if (!sess) return;
    sess.lastMove = !!(await sess.ws.lastMove().catch(() => null));
    if (this.active === sess) this.lastMoveAvailable.value = sess.lastMove;
  }

  /** Show a page of the shown workspace in the system file manager (a page without a file shows its folder). */
  async revealPage(path: string): Promise<void> {
    try {
      const abs = await this.ws.absolutePath(path);
      const err = await this.main.revealPath(abs);
      if (err) this.toast(`Could not show it in the file manager: ${err}`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Show a file of the page's folder in the system file manager. */
  async revealFile(f: FileItem): Promise<void> {
    try {
      const err = await this.main.revealPath(await this.ws.filePath(f.path));
      if (err) this.toast(`Could not show it in the file manager: ${err}`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Add a folder to the list of folders searched for workspaces, or to the list left out of that search. */
  async addScanFolder(which: 'scanFolders' | 'scanIgnore'): Promise<void> {
    const dir = await this.main.chooseWorkspace();
    if (!dir) return;
    const list = this.settings.value[which];
    if (!list.includes(dir)) this.setPreferences({ [which]: [...list, dir] });
  }

  removeScanFolder(which: 'scanFolders' | 'scanIgnore', dir: string): void {
    this.setPreferences({ [which]: this.settings.value[which].filter((d) => d !== dir) });
  }

  /** Show the shown workspace's folder in the system file manager. */
  async revealWorkspace(): Promise<void> {
    const root = this.active?.root;
    if (!root) return;
    const err = await this.main.revealPath(root);
    if (err) this.toast(`Could not show it in the file manager: ${err}`);
  }

  /**
   * The page to show once `gone` (page paths about to be trashed) is out of the tree: the row right below the
   * deleted one (past its sub-pages), else the row above it, else nothing.
   */
  private neighborAfterDelete(anchor: string, gone: string[]): string | null {
    const rows = this.tree.rows;
    const at = rows.findIndex((r) => r.path === anchor);
    if (at < 0) return null;
    const out = new Set(gone);
    for (let i = at + 1; i < rows.length; i++) if (!out.has(rows[i]!.path)) return rows[i]!.path;
    for (let i = at - 1; i >= 0; i--) if (!out.has(rows[i]!.path)) return rows[i]!.path;
    return null;
  }

  /** After a delete took the open page away: show `next` (the page below it in the tree), or an empty tab. */
  private async afterOpenPageDeleted(next: string | null): Promise<void> {
    this.updateActiveTab({ path: null });
    if (next) {
      try {
        await this.openPage(next, { force: true, reveal: true, nav: 'push' });
        return;
      } catch {
        /* fall through to the empty state */
      }
    }
    this.tree.select(null);
  }

  async deletePage(path: string, opts: { confirmed?: boolean; quiet?: boolean } = {}): Promise<void> {
    try {
      const info = await this.ws.deleteInfo(path);
      const name = stripExt(path).split('/').pop();
      const subs = info.pages.length - 1;
      const details: string[] = [];
      if (subs > 0) details.push(`This also moves ${subs} sub-page${subs === 1 ? '' : 's'} to the trash.`);
      if (info.backlinks > 0) details.push(`${info.backlinks} link${info.backlinks === 1 ? '' : 's'} from other pages will stop working.`);
      const ok = opts.confirmed
        ? true
        : await this.confirm({
            title: `Move “${name}” to the trash?`,
            body: 'You can restore it from the trash later.',
            details,
            confirm: 'Move to Trash',
            destructive: true,
          });
      if (!ok) return;
      const cur = this.current.value;
      const inside = cur && info.pages.includes(cur.path);
      const next = inside ? this.neighborAfterDelete(path, info.pages) : null;
      if (inside) {
        this.openSeq++;
        this.saveState.value = 'saved'; // never save into a page that is being deleted
        this.current.value = null;
        this.children.value = [];
        this.outline.value = []; this.annotations.value = [];
        this.links.value = [];
        this.backlinks.value = [];
      } else await this.flush();
      await this.main.trash(info.trash);
      await this.ws.afterDelete(info.pages);
      for (const p of info.pages) this.states.delete(this.stateKey(p));
      await this.tree.refresh(this.tree.loadedParents());
      if (inside) await this.afterOpenPageDeleted(next);
      if (!opts.quiet) this.toast(`Moved “${name}” to the trash.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  // ---------------------------------------------------------------- several pages at once (from a view)

  /** Of a selection, the pages that are not inside another selected page (those go along with it). */
  private topmost(paths: string[]): string[] {
    const roots = paths.map((q) => `${stripExt(q)}/`);
    return paths.filter((p) => !roots.some((r) => p.startsWith(r)));
  }

  /** Copy pages next to themselves (`Name.md` → `Name.1.md`); the title stays as it was. */
  async duplicatePages(paths: string[]): Promise<string[]> {
    const made: string[] = [];
    try {
      await this.flush();
      for (const p of this.topmost(paths)) made.push(await this.ws.duplicatePage(p));
      await this.tree.refresh(this.tree.loadedParents());
      this.viewTick.value++;
      void this.loadChildren();
      if (made.length > 0) this.toast(made.length === 1 ? `Duplicated as “${stripExt(made[0]!).split('/').pop()}”.` : `Duplicated ${made.length} pages.`);
    } catch (e) {
      this.toast(explain(e));
    }
    return made;
  }

  /** Move several pages to the trash after one question. */
  async deletePages(paths: string[]): Promise<boolean> {
    const top = this.topmost(paths);
    if (top.length === 0) return false;
    if (top.length === 1) {
      await this.deletePage(top[0]!);
      this.viewTick.value++;
      return true;
    }
    try {
      const infos = await Promise.all(top.map((p) => this.ws.deleteInfo(p)));
      const pages = infos.reduce((n, i) => n + i.pages.length, 0);
      const backlinks = infos.reduce((n, i) => n + i.backlinks, 0);
      const details = [`${top.length} pages${pages > top.length ? `, with ${pages - top.length} sub-page${pages - top.length === 1 ? '' : 's'},` : ''} go to the trash.`];
      if (backlinks > 0) details.push(`${backlinks} link${backlinks === 1 ? '' : 's'} from other pages will stop working.`);
      const ok = await this.confirm({ title: `Move ${top.length} pages to the trash?`, body: 'You can restore them from the trash later.', details, confirm: 'Move to Trash', destructive: true });
      if (!ok) return false;
      const cur = this.current.value;
      const inside = cur && infos.some((i) => i.pages.includes(cur.path));
      const allGone = infos.flatMap((i) => i.pages);
      const next = inside ? this.neighborAfterDelete(top[0]!, allGone) : null;
      if (inside) {
        this.openSeq++;
        this.saveState.value = 'saved';
        this.current.value = null;
        this.children.value = [];
        this.outline.value = []; this.annotations.value = [];
        this.links.value = [];
        this.backlinks.value = [];
      } else await this.flush();
      for (const info of infos) {
        await this.main.trash(info.trash);
        await this.ws.afterDelete(info.pages);
        for (const p of info.pages) this.states.delete(this.stateKey(p));
      }
      await this.tree.refresh(this.tree.loadedParents());
      if (inside) await this.afterOpenPageDeleted(next);
      this.viewTick.value++;
      this.toast(`Moved ${top.length} pages to the trash.`);
      return true;
    } catch (e) {
      this.toast(explain(e));
      return false;
    }
  }

  /** Open the Move to / Copy to picker: any page of this workspace, or of another one. */
  /** Open the page menu for a page at the pointer of a context-menu event. */
  openFileMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void }, file: FileItem): void {
    e.preventDefault();
    e.stopPropagation?.();
    const page = this.current.value?.path;
    if (!page) return;
    this.fileMenu.value = { x: e.clientX, y: e.clientY, file, page };
  }

  /** Ask for attributes ("name: value", one per line; an empty value removes it) and give them to a file that is not a note. */
  assignFileAttributes(page: string, file: FileItem): void {
    this.dialog.value = {
      kind: 'prompt',
      title: `Attributes of “${file.name}”`,
      body: 'One per line, as name: value. Leave the value empty to remove an attribute. They are kept in this page’s files: block.',
      label: 'Attributes',
      value: '',
      confirm: 'Save',
      submit: async (value) => {
        const attrs: Record<string, AttrValue | null> = {};
        for (const raw of value.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          const i = line.indexOf(':');
          if (i <= 0) return `“${line}” is not in the form name: value.`;
          const k = line.slice(0, i).trim();
          const v = line.slice(i + 1).trim();
          attrs[k] = v === '' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v.includes(',') ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
        }
        if (Object.keys(attrs).length === 0) return 'Enter at least one attribute.';
        try {
          const r = await this.ws.setFileAttributes(page, file.path, attrs);
          if (!r.ok) return 'The page changed while you were typing. Try again.';
          this.viewTick.value++;
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  /** Give a file that is not a note the attributes of a template. */
  async assignFileFromTemplate(page: string, file: FileItem): Promise<void> {
    try {
      const { templates } = await this.ws.templatesFor(this.tree.parentPath(page));
      if (templates.length === 0) { this.toast('There are no templates for this page.'); return; }
      const name = await new Promise<string | null>((resolve) => {
        this.dialog.value = { kind: 'choose', title: 'Attributes from a template', body: `“${file.name}” gets the attributes of the template you pick.`, options: templates.map((t) => ({ label: t.name, detail: t.where, value: t.name })), resolve };
      });
      if (!name) return;
      const r = await this.ws.templateAttributes(page, name);
      if (!r.ok) { this.toast(r.error); return; }
      if (Object.keys(r.attrs).length === 0) { this.toast(`“${name}” has no attributes to give.`); return; }
      const w = await this.ws.setFileAttributes(page, file.path, r.attrs);
      if (!w.ok) { this.toast('The page changed meanwhile. Try again.'); return; }
      this.viewTick.value++;
      this.toast(`“${file.name}” now has the attributes of “${name}”.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Move a file that is not a note under a page (null: top level). Its attributes go with it. */
  async moveFileInto(filePath: string, parent: string | null): Promise<void> {
    try {
      await this.flush();
      const r = await this.ws.moveFile(filePath, parent);
      await this.tree.refresh(this.tree.loadedParents());
      void this.loadChildren();
      this.viewTick.value++;
      const name = r.path.split('/').pop();
      this.toast(r.attributes === 'left' ? `Moved “${name}”, but its attributes could not follow it: they are still listed in the old page.` : `Moved “${name}”.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  /** Ctrl/Cmd-click toggles a page in the selection, Shift-click takes the range from the anchor. `order` is the pages as listed. */
  selectWith(path: string, order: string[], mod: { ctrl: boolean; shift: boolean }): boolean {
    if (!mod.ctrl && !mod.shift) {
      if (this.multi.value.length) this.multi.value = [];
      this.multiAnchor = path;
      return false;
    }
    const cur = this.multi.value;
    const anchor = this.multiAnchor ?? this.tree.selected ?? this.current.value?.path ?? path;
    if (mod.shift && order.includes(anchor)) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(path);
      this.multi.value = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else {
      const base = cur.length ? cur : [anchor].filter((p) => p !== path && order.includes(p));
      this.multi.value = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
      this.multiAnchor = path;
    }
    return true;
  }

  /** Move several pages under one parent (null: top level), skipping any that would end up inside themselves. */
  async movePagesTo(paths: string[], parent: string | null): Promise<void> {
    const top = this.topmost(paths).filter((p) => parent === null || (p !== parent && !stripExt(parent).startsWith(`${stripExt(p)}/`)));
    for (const p of top) await this.movePage(p, parent);
    this.multi.value = [];
  }

  /** The right-click menu for several pages at once. */
  openPagesMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void }, paths: string[]): void {
    e.preventDefault();
    e.stopPropagation?.();
    this.pageMenu.value = { x: e.clientX, y: e.clientY, path: paths[0]!, paths };
  }

  /** Rename several pages: "find => replace" on the names (nothing before the arrow adds a prefix). */
  renamePages(paths: string[]): void {
    const top = this.topmost(paths);
    this.dialog.value = {
      kind: 'prompt',
      title: `Rename ${top.length} pages`,
      body: 'Type find => replace, for example “Draft => Final”. With nothing before the arrow, the text is put in front of each name. Links are updated.',
      label: 'Rename',
      value: '',
      confirm: 'Rename',
      submit: async (value) => {
        const m = /^(.*?)\s*=>\s*(.*)$/.exec(value);
        if (!m) return 'Write it as find => replace.';
        const [, find, repl] = m as unknown as [string, string, string];
        try {
          await this.flush();
          this.dialog.value = null;
          let done = 0;
          for (const p of top) {
            const name = stripExt(p).split('/').pop() ?? '';
            const next = find === '' ? `${repl}${name}` : name.split(find).join(repl);
            if (next === name || next.trim() === '') continue;
            const plan = await this.ws.planMove(p, this.tree.parentPath(p), next);
            if (plan.noop) continue;
            await this.ws.applyPlan(plan);
            done++;
          }
          await this.tree.refresh(this.tree.loadedParents());
          void this.loadChildren();
          this.viewTick.value++;
          this.multi.value = [];
          this.toast(done === 0 ? 'No name matched.' : `Renamed ${done} page${done === 1 ? '' : 's'}.`);
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  /** Fill several pages from one template: what each page has stays; the template adds what is missing. */
  async applyTemplateToPages(paths: string[]): Promise<void> {
    const top = this.topmost(paths);
    if (top.length === 0) return;
    try {
      const { templates } = await this.ws.templatesFor(this.tree.parentPath(top[0]!));
      if (templates.length === 0) { this.toast('There are no templates for these pages.'); return; }
      const name = await new Promise<string | null>((resolve) => {
        this.dialog.value = { kind: 'choose', title: 'Apply a template', body: `${top.length} pages are filled from the template you pick. What they already have is kept.`, options: templates.map((t) => ({ label: t.name, detail: t.where, value: t.name })), resolve };
      });
      if (!name) return;
      await this.flush();
      let done = 0;
      for (const p of top) {
        const r = await this.ws.mergeTemplateInto(p, name).catch(() => null);
        if (r?.ok) done++;
      }
      this.viewTick.value++;
      this.toast(`“${name}” applied to ${done} of ${top.length} pages.`);
    } catch (e) {
      this.toast(explain(e));
    }
  }

  openPageMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation?(): void }, path: string, workspace?: string): void {
    e.preventDefault();
    e.stopPropagation?.();
    this.pageMenu.value = { x: e.clientX, y: e.clientY, path, ...(workspace ? { workspace } : {}) };
  }

  openIndicator(e: { clientX: number; clientY: number; stopPropagation?(): void }, path: string, text: string): void {
    e.stopPropagation?.();
    this.indicatorPop.value = { x: e.clientX, y: e.clientY, path, text };
  }

  private async refreshParentOf(path: string): Promise<void> {
    const i = path.lastIndexOf('/');
    await this.tree.refresh([i < 0 ? null : path.slice(0, i) + (/\.[^./]+$/.exec(path)?.[0] ?? '.md')]);
    this.viewTick.value++;
  }

  /** Dismiss the indicator of a page: its `indicatorText` property goes. */
  async dismissIndicator(path: string): Promise<void> {
    this.indicatorPop.value = null;
    if (await this.setPageAttribute(path, 'indicatorText', null)) await this.refreshParentOf(path);
  }

  /** The page never shows an indicator again (`ignoreIndicators: true`); "Show Indicators Again" in its menu undoes this. */
  async ignoreIndicators(path: string): Promise<void> {
    this.indicatorPop.value = null;
    if (await this.setPageAttribute(path, 'ignoreIndicators', true)) {
      await this.refreshParentOf(path);
      this.toast('That page will not show indicators. Its menu has “Show Indicators Again”.');
    }
  }

  async unignoreIndicators(path: string): Promise<void> {
    if (await this.setPageAttribute(path, 'ignoreIndicators', null)) await this.refreshParentOf(path);
  }

  /** Ask which icon a page should wear in the tree and the gallery (the `icon` attribute). */
  openPageIcon(path: string): void {
    this.dialog.value = { kind: 'page-icon', path };
  }

  /** Give a page an icon of the bundled set, or take it away (null). */
  async setPageIcon(path: string, icon: string | null): Promise<void> {
    if (!(await this.setPageAttribute(path, 'icon', icon))) return;
    const i = path.lastIndexOf('/');
    await this.tree.refresh([i < 0 ? null : path.slice(0, i) + (/\.[^./]+$/.exec(path)?.[0] ?? '.md')]);
    this.viewTick.value++;
  }

  openTransfer(paths: string[], mode: 'move' | 'copy'): void {
    const top = this.topmost(paths);
    if (top.length === 0 || !this.active) return;
    this.dialog.value = { kind: 'transfer', paths: top, mode };
  }

  /** The workspaces a page can be sent to: this one first, then the ones known on this computer. */
  transferWorkspaces(): Array<{ root: string; name: string }> {
    const here = this.active?.root;
    const roots = [...(here ? [here] : []), ...this.workspaceChoices().filter((r) => r !== here)];
    return roots.map((root) => ({ root, name: root === here ? (this.workspace.value?.name ?? root) : (this.nameOf(root) ?? (root.split('/').pop() || root)) }));
  }

  /** The pages directly under `parent` (null: the top level) of any workspace, for the picker. */
  async transferChildren(root: string, parent: string | null): Promise<TreeItem[]> {
    const sess = this.active?.root === root ? this.active : await this.ensureSession(root);
    return sess.ws.listChildren(parent, {});
  }

  /** Move or copy pages under `parent` of the workspace `root`. Returns a message when it did not work, else null. */
  async transferTo(paths: string[], mode: 'move' | 'copy', root: string, parent: string | null): Promise<string | null> {
    const src = this.active;
    if (!src) return 'No workspace is open.';
    const same = root === src.root;
    try {
      await this.flush();
      if (same) {
        for (const p of paths) if (parent !== null && (parent === p || parent.startsWith(`${stripExt(p)}/`))) return 'A page cannot go into itself.';
      }
      if (same && mode === 'move') {
        this.dialog.value = null;
        for (const p of paths) await this.movePage(p, parent);
        this.viewTick.value++;
        void this.loadChildren();
        return null;
      }
      const dest = same ? src : await this.ensureSession(root);
      const made: string[] = [];
      for (const p of paths) made.push(await dest.ws.copyPageIn(await src.ws.pageSource(p), parent));
      if (mode === 'move') for (const p of paths) await this.deletePage(p, { confirmed: true, quiet: true });
      await dest.tree.refresh(dest.tree.loadedParents());
      this.dialog.value = null;
      this.viewTick.value++;
      void this.loadChildren();
      const where = same ? '' : ` in “${dest.info.name}”`;
      const first = stripExt(made[0]!).split('/').pop();
      this.toast(made.length === 1 ? `${mode === 'move' ? 'Moved' : 'Copied'} “${first}”${where}.` : `${mode === 'move' ? 'Moved' : 'Copied'} ${made.length} pages${where}.`);
      return null;
    } catch (e) {
      return explain(e);
    }
  }

  /** Ask where to, then move several pages under that page (empty: top level). */
  movePagesDialog(paths: string[]): void {
    const top = this.topmost(paths);
    if (top.length === 0) return;
    this.dialog.value = {
      kind: 'prompt',
      title: top.length === 1 ? 'Move Page' : `Move ${top.length} Pages`,
      body: 'The name of the page to move them under. Leave it empty for the top level. Links to them are updated.',
      label: 'Under page',
      value: '',
      confirm: 'Move',
      submit: async (name) => {
        try {
          let parent: string | null = null;
          if (name.trim()) {
            const r = await this.ws.resolveLink({ syntax: 'wiki', target: name.trim() }, this.current.value?.path ?? '');
            if (r.kind !== 'page' || r.status !== 'ok') return `There is no page called “${name.trim()}”.`;
            parent = r.path;
          }
          this.dialog.value = null;
          for (const p of top) await this.movePage(p, parent);
          this.viewTick.value++;
          void this.loadChildren();
          return null;
        } catch (e) {
          return explain(e);
        }
      },
    };
  }

  /** Set one attribute (null: take it away) on several pages. Returns how many were changed. */
  async setAttributeOnPages(paths: string[], key: string, value: AttrValue | null): Promise<number> {
    let done = 0;
    for (const p of paths) if (await this.setPageAttribute(p, key, value)) done++;
    this.viewTick.value++;
    if (done < paths.length) this.toast(`${done} of ${paths.length} pages were changed.`);
    return done;
  }

  // ---------------------------------------------------------------- find in the tree

  openTreeFind(first = ''): void {
    if (!this.treeFind.value) {
      this.treeFind.value = { query: '', hits: [], index: 0 };
      this.findOpened = new Set();
    }
    if (first) void this.setTreeFind(first);
  }

  /** New text in the box: open the branches that hold matching pages and close those that no longer do. */
  async setTreeFind(query: string): Promise<void> {
    const sess = this.active;
    if (!sess) return;
    const seq = ++this.findSeq;
    this.treeFind.value = { query, hits: this.treeFind.value?.hits ?? [], index: 0 };
    const hits = query.trim() === '' ? [] : await sess.ws.findPagePaths(query, 200);
    if (seq !== this.findSeq || this.active !== sess || !this.treeFind.value) return;
    const tree = sess.tree;
    const before = new Set(tree.expandedPaths());
    const need = new Set<string>();
    for (const h of hits) for (let p = h; ; ) { const up = tree.parentPath(p); if (up === null) break; need.add(up); p = up; }
    // the branch the open page is on stays open
    const cur = this.current.value?.path;
    const keepOpen = new Set<string>();
    if (cur) for (let p: string | null = cur; p !== null; p = tree.parentPath(p)) keepOpen.add(p);
    for (const h of hits) {
      try {
        await tree.reveal(h);
      } catch {
        /* a branch that cannot load is skipped */
      }
      if (seq !== this.findSeq) return;
    }
    for (const p of tree.expandedPaths()) if (!before.has(p)) this.findOpened.add(p);
    for (const p of [...this.findOpened]) {
      if (need.has(p)) continue;
      this.findOpened.delete(p);
      if (!keepOpen.has(p)) tree.collapse(p);
    }
    // a new text starts at its first result
    this.treeFind.value = { query, hits, index: 0 };
    if (hits.length) tree.select(hits[0] ?? null);
  }

  /** Up and down in the box: another result, without opening it. */
  moveTreeFind(delta: number): void {
    const f = this.treeFind.value;
    if (!f || !f.hits.length) return;
    const index = (f.index + delta + f.hits.length) % f.hits.length;
    this.treeFind.value = { ...f, index };
    this.tree.select(f.hits[index] ?? null);
  }

  /** Close the box; with `open`, open the selected result first. */
  closeTreeFind(open: boolean, path?: string): void {
    const f = this.treeFind.value;
    this.treeFind.value = null;
    this.findSeq++;
    this.findOpened = new Set();
    const target = path ?? f?.hits[f.index];
    if (open && target) void this.openPage(target, { reveal: false });
  }

  // ---------------------------------------------------------------- outline

  goToHeading(item: OutlineItem): void {
    this.editor?.scrollToPos(item.from);
    this.editor?.focus();
  }

  updateActiveHeading(): void {
    const i = this.editor?.activeHeadingIndex() ?? -1;
    if (i !== this.activeHeading.value) this.activeHeading.value = i;
  }

  setOutline(items: OutlineItem[]): void {
    this.outline.value = items;
  }

  // ---------------------------------------------------------------- toasts & dialogs

  toast(text: string, action?: Toast['action']): void {
    const id = this.toastId++;
    this.toasts.value = [...this.toasts.value.slice(-2), { id, text, ...(action ? { action } : {}) }];
    setTimeout(() => this.dismissToast(id), action ? 9000 : 5000);
  }
  dismissToast(id: number): void {
    this.toasts.value = this.toasts.value.filter((t) => t.id !== id);
  }

  confirm(o: { title: string; body: string; details?: string[]; confirm: string; destructive?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      this.dialog.value = { kind: 'confirm', ...o, resolve };
    });
  }

  choose(o: { title: string; body: string; options: Array<{ label: string; detail?: string; value: string }>; remember?: { label: string; values: string[]; apply: (value: string) => void } }): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialog.value = { kind: 'choose', ...o, resolve };
    });
  }

  closeDialog(): void {
    const d = this.dialog.value;
    this.dialog.value = null;
    if (d && (d.kind === 'choose' || d.kind === 'confirm' || d.kind === 'plan')) {
      if (d.kind === 'choose') d.resolve(null);
      else d.resolve(false);
    }
  }
}
