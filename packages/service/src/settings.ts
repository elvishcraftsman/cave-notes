import { BUILTIN_STYLES, cleanStyleSet } from '@cave-notes/core-export';
import type { Settings } from './api';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark', // dark is the default
  recent: [],
  found: [],
  scanFolders: [],
  scanIgnore: [],
  scanAuto: true,
  noteExts: ['.md'],
  noteCreate: '.md',
  showNestedWorkspaces: true,
  hideBareFolders: false,
  nestedInNewTab: true,
  childrenFilter: 'all',
  spellcheck: true,
  fixCapitals: true,
  synonyms: true,
  indexAllWorkspaces: true,
  dictionary: [],
  disabledPlugins: [],
  updateMode: 'install',
  updateUrl: '',
  lastUpdateCheck: 0,
  presentScreen: 'auto',
  presenterWindow: false,
  presenterScreen: 'auto',
  firstDayOfWeek: 0,
  tableWordLimit: 22,
  globalsEnabled: true,
  lastWorkspace: null,
  showLeft: true,
  showRight: true,
  leftWidth: 280,
  rightWidth: 300,
  rightTab: 'outline',
  childrenDocked: false,
  bounds: null,
  maximized: false,
  autoCollapse: true,
  autoCollapseSeconds: 10,
  newPageDefault: 'nested',
  fontStyle: 'sans',
  fontSizes: { sans: null, serif: null, mono: null },
  outlineOrderedLists: true,
  orderedListStyles: ['I.', 'A.', '1.', 'a.', 'i.', '1)', 'a)', 'i)'],
  bulletGlyphs: ['\u2022', '\u25E6', '\u25AA'],
  hierarchicalLists: true,
  wrapCode: false,
  dropAction: 'move',
  dropActionOtherDrive: 'same',
  exportStyles: [],
  exportStyle: 'Clean',
  exportFormat: 'docx',
  defaultAccent: null,
  conflictMerge: 'ask',
  automationShell: false,
  automationJs: false,
  automationJsAsk: true,
  automationBackground: false,
  deviceName: '',
  openExternal: 'tab',
  tabs: [],
  activeTab: 0,
  windows: [],
};

const HEX = /^#[0-9a-f]{6}$/i;

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 40;
/** A text size in px kept within reason (whole and half pixels). */
export const cleanFontSize = (n: number): number => Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n * 2) / 2));

/** One size for each of the three typefaces, or null when the value is not an object of sizes. */
export function cleanFontSizes(x: unknown): { sans: number | null; serif: number | null; mono: number | null } | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const one = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? cleanFontSize(v) : null);
  return { sans: one(r.sans), serif: one(r.serif), mono: one(r.mono) };
}

/** Marker styles for hierarchical numbered lists: 1 a A i I with . or ), at most 8 levels. Null if none is usable. */
export function cleanOrderedStyles(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.filter((e): e is string => typeof e === 'string' && /^(1|a|A|i|I)[.)]$/.test(e.trim())).map((e) => e.trim()).slice(0, 8);
  return out.length > 0 ? out : null;
}

/** Bullet glyphs: short strings without spaces, at most 8 levels. Null if none is usable. */
export function cleanBulletGlyphs(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.filter((e): e is string => typeof e === 'string' && e.trim().length > 0 && [...e.trim()].length <= 2 && !/\s/.test(e.trim())).map((e) => e.trim()).slice(0, 8);
  return out.length > 0 ? out : null;
}

/** The style sets a person made: checked, at most 30, names unique and not those of the built-in sets. */
export function cleanExportStyles(x: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(x)) return [];
  const seen = new Set(BUILTIN_STYLES.map((b) => b.name.toLowerCase()));
  const out: Array<Record<string, unknown>> = [];
  for (const raw of x.slice(0, 30)) {
    const s = cleanStyleSet(raw);
    if (seen.has(s.name.toLowerCase())) continue;
    seen.add(s.name.toLowerCase());
    out.push(s as unknown as Record<string, unknown>);
  }
  return out;
}

/** Plugins the person turned off on this computer: `workspace folder|rule id`, no repeats, at most 500. */
export function cleanDisabledPlugins(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return [...new Set(x.filter((e): e is string => typeof e === 'string' && e.includes('|') && e.length < 1000))].slice(0, 500);
}

/** The user's dictionary: single words without spaces, no repeats (case-insensitive), sorted, at most 5000. */
export function cleanDictionary(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of x) {
    if (typeof e !== 'string') continue;
    const w = e.trim();
    if (w === '' || w.length > 60 || /\s/.test(w) || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= 5000) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Check a list of note extensions: each `.name`, lower case, no repeats; the creation extension joins the list. */
export function cleanNoteTypes(exts: unknown, create: unknown): { exts: string[]; create: string } | null {
  if (!Array.isArray(exts)) return null;
  const fix = (e: unknown): string | null => {
    if (typeof e !== 'string') return null;
    const x = e.trim().toLowerCase().replace(/^\.+/, '');
    return /^[a-z0-9][a-z0-9_-]{0,14}$/.test(x) ? `.${x}` : null;
  };
  const list: string[] = [];
  for (const e of exts) {
    const c = fix(e);
    if (c && !list.includes(c)) list.push(c);
  }
  if (list.length === 0) return null;
  const made = fix(create) ?? list[0]!;
  if (!list.includes(made)) list.push(made);
  return { exts: list, create: made };
}

/**
 * The preferences that travel in an exported settings file (everything except what belongs to this machine and this
 * session: recent folders, window size, tabs and windows). Each one is checked, and anything wrong is left out.
 */
export function portableSettings(raw: unknown): Partial<Settings> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (r.theme === 'dark' || r.theme === 'light') out.theme = r.theme;
  for (const k of ['showLeft', 'showRight', 'childrenDocked', 'autoCollapse', 'outlineOrderedLists'] as const) {
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  }
  if (typeof r.hierarchicalLists === 'boolean') out.hierarchicalLists = r.hierarchicalLists;
  if (typeof r.wrapCode === 'boolean') out.wrapCode = r.wrapCode;
  if (r.dropAction === 'move' || r.dropAction === 'copy') out.dropAction = r.dropAction;
  if (r.dropActionOtherDrive === 'same' || r.dropActionOtherDrive === 'move' || r.dropActionOtherDrive === 'copy') out.dropActionOtherDrive = r.dropActionOtherDrive;
  if (Array.isArray(r.exportStyles)) out.exportStyles = cleanExportStyles(r.exportStyles);
  const ols = cleanOrderedStyles(r.orderedListStyles);
  if (ols) out.orderedListStyles = ols;
  const bgs = cleanBulletGlyphs(r.bulletGlyphs);
  if (bgs) out.bulletGlyphs = bgs;
  if (r.fontStyle === 'sans' || r.fontStyle === 'serif') out.fontStyle = r.fontStyle;
  else if (r.serifBody === true) out.fontStyle = 'serif'; // an older settings file
  const sizes = cleanFontSizes(r.fontSizes);
  if (sizes) out.fontSizes = sizes;
  else if (typeof r.fontSize === 'number' && Number.isFinite(r.fontSize)) {
    // an older settings file had one size, for the typeface then chosen
    out.fontSizes = { sans: null, serif: null, mono: null, [out.fontStyle ?? 'sans']: cleanFontSize(r.fontSize) };
  }
  for (const k of ['leftWidth', 'rightWidth'] as const) {
    if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = Math.max(200, Math.min(520, Math.round(r[k] as number)));
  }
  if (typeof r.autoCollapseSeconds === 'number' && Number.isFinite(r.autoCollapseSeconds)) out.autoCollapseSeconds = Math.max(1, Math.min(3600, Math.round(r.autoCollapseSeconds)));
  if (r.rightTab === 'outline' || r.rightTab === 'links') out.rightTab = r.rightTab;
  if (r.newPageDefault === 'top' || r.newPageDefault === 'sibling' || r.newPageDefault === 'nested') out.newPageDefault = r.newPageDefault;
  if (r.conflictMerge === 'ask' || r.conflictMerge === 'auto' || r.conflictMerge === 'never') out.conflictMerge = r.conflictMerge;
  if (r.openExternal === 'tab' || r.openExternal === 'window') out.openExternal = r.openExternal;
  for (const k of ['scanAuto', 'showNestedWorkspaces', 'hideBareFolders', 'nestedInNewTab'] as const) {
    if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  }
  if (r.childrenFilter === 'notes' || r.childrenFilter === 'all') out.childrenFilter = r.childrenFilter;
  if (typeof r.firstDayOfWeek === 'number' && Number.isInteger(r.firstDayOfWeek) && r.firstDayOfWeek >= 0 && r.firstDayOfWeek <= 6) out.firstDayOfWeek = r.firstDayOfWeek;
  if (typeof r.globalsEnabled === 'boolean') out.globalsEnabled = r.globalsEnabled;
  if (typeof r.spellcheck === 'boolean') out.spellcheck = r.spellcheck;
  if (typeof r.fixCapitals === 'boolean') out.fixCapitals = r.fixCapitals;
  if (typeof r.synonyms === 'boolean') out.synonyms = r.synonyms;
  if (typeof r.indexAllWorkspaces === 'boolean') out.indexAllWorkspaces = r.indexAllWorkspaces;
  if (Array.isArray(r.dictionary)) out.dictionary = cleanDictionary(r.dictionary);
  if (Array.isArray(r.disabledPlugins)) out.disabledPlugins = cleanDisabledPlugins(r.disabledPlugins);
  if (typeof r.presentScreen === 'string') out.presentScreen = /^(auto|\d{1,12})$/.test(r.presentScreen) ? r.presentScreen : 'auto';
  if (typeof r.presenterScreen === 'string') out.presenterScreen = /^(auto|\d{1,12})$/.test(r.presenterScreen) ? r.presenterScreen : 'auto';
  if (typeof r.presenterWindow === 'boolean') out.presenterWindow = r.presenterWindow;
  if (typeof r.tableWordLimit === 'number' && Number.isInteger(r.tableWordLimit) && r.tableWordLimit >= 4 && r.tableWordLimit <= 200) out.tableWordLimit = r.tableWordLimit;
  for (const k of ['scanFolders', 'scanIgnore'] as const) {
    if (Array.isArray(r[k])) out[k] = (r[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.startsWith('/'));
  }
  const nt = cleanNoteTypes(r.noteExts, r.noteCreate);
  if (nt) {
    out.noteExts = nt.exts;
    out.noteCreate = nt.create;
  }
  if (r.defaultAccent === null) out.defaultAccent = null;
  else if (typeof r.defaultAccent === 'string' && HEX.test(r.defaultAccent)) out.defaultAccent = r.defaultAccent.toLowerCase();
  return out;
}

/** Small JSON settings file, loaded synchronously at startup and saved with a short debounce. */

/** The settings a stored file stands for: each value checked, with the default for whatever is missing or invalid. */
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const v = { ...DEFAULT_SETTINGS, ...raw, theme: raw.theme === 'light' ? 'light' : 'dark' } as Settings;
  v.autoCollapseSeconds = Math.max(1, Math.min(3600, Math.round(Number(v.autoCollapseSeconds)) || DEFAULT_SETTINGS.autoCollapseSeconds));
  if (!['top', 'sibling', 'nested'].includes(v.newPageDefault)) v.newPageDefault = 'nested';
  v.outlineOrderedLists = typeof raw.outlineOrderedLists === 'boolean' ? raw.outlineOrderedLists : true;
  v.orderedListStyles = cleanOrderedStyles(raw.orderedListStyles) ?? DEFAULT_SETTINGS.orderedListStyles;
  v.bulletGlyphs = cleanBulletGlyphs(raw.bulletGlyphs) ?? DEFAULT_SETTINGS.bulletGlyphs;
  v.hierarchicalLists = typeof raw.hierarchicalLists === 'boolean' ? raw.hierarchicalLists : DEFAULT_SETTINGS.hierarchicalLists;
  v.wrapCode = raw.wrapCode === true;
  if (v.dropAction !== 'move' && v.dropAction !== 'copy') v.dropAction = 'move';
  if (!['same', 'move', 'copy'].includes(v.dropActionOtherDrive)) v.dropActionOtherDrive = 'same';
  v.exportStyles = cleanExportStyles(raw.exportStyles);
  if (typeof v.exportStyle !== 'string' || !v.exportStyle) v.exportStyle = 'Clean';
  if (!['docx', 'odt', 'pdf'].includes(v.exportFormat)) v.exportFormat = 'docx';
  if (!['ask', 'auto', 'never'].includes(v.conflictMerge)) v.conflictMerge = 'ask';
  v.automationShell = raw.automationShell === true;
  v.automationJs = raw.automationJs === true;
  v.automationJsAsk = raw.automationJsAsk !== false;
  v.automationBackground = raw.automationBackground === true;
  v.spellcheck = raw.spellcheck !== false;
  v.fixCapitals = raw.fixCapitals !== false;
  v.synonyms = raw.synonyms !== false;
  v.indexAllWorkspaces = raw.indexAllWorkspaces !== false;
  v.dictionary = cleanDictionary(raw.dictionary);
  v.disabledPlugins = cleanDisabledPlugins(raw.disabledPlugins);
  if (v.updateMode !== 'install' && v.updateMode !== 'notify' && v.updateMode !== 'off') v.updateMode = 'install';
  v.updateUrl = typeof raw.updateUrl === 'string' ? raw.updateUrl.trim().slice(0, 500) : '';
  v.lastUpdateCheck = typeof raw.lastUpdateCheck === 'number' && Number.isFinite(raw.lastUpdateCheck) && raw.lastUpdateCheck > 0 ? Math.floor(raw.lastUpdateCheck) : 0;
  v.presentScreen = typeof raw.presentScreen === 'string' && /^(auto|\d{1,12})$/.test(raw.presentScreen) ? raw.presentScreen : 'auto';
  v.presenterScreen = typeof raw.presenterScreen === 'string' && /^(auto|\d{1,12})$/.test(raw.presenterScreen) ? raw.presenterScreen : 'auto';
  v.presenterWindow = raw.presenterWindow === true;
  v.deviceName = typeof raw.deviceName === 'string' ? raw.deviceName.trim().slice(0, 40) : '';
  if (v.openExternal !== 'tab' && v.openExternal !== 'window') v.openExternal = 'tab';
  if (typeof v.defaultAccent !== 'string' || !HEX.test(v.defaultAccent)) v.defaultAccent = null;
  if (v.fontStyle !== 'sans' && v.fontStyle !== 'serif') v.fontStyle = (raw as { serifBody?: unknown }).serifBody === true ? 'serif' : 'sans';
  const legacySize = (raw as { fontSize?: unknown }).fontSize;
  v.fontSizes = cleanFontSizes(raw.fontSizes) ?? { sans: null, serif: null, mono: null, ...(typeof legacySize === 'number' && Number.isFinite(legacySize) ? { [v.fontStyle]: cleanFontSize(legacySize) } : {}) };
  delete (v as { fontSize?: unknown }).fontSize;
  const goodTabs = (list: unknown): Settings['tabs'] => (Array.isArray(list) ? list.filter((t) => t && typeof t.root === 'string').map((t) => ({ root: t.root as string, path: typeof t.path === 'string' ? t.path : null, ...(t.single === true ? { single: true } : {}) })) : []);
  v.tabs = goodTabs(v.tabs);
  const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((p): p is string => typeof p === 'string' && p.startsWith('/')) : []);
  v.found = strs(v.found);
  v.scanFolders = strs(v.scanFolders);
  v.scanIgnore = strs(v.scanIgnore);
  for (const k of ['scanAuto', 'showNestedWorkspaces', 'hideBareFolders', 'nestedInNewTab'] as const) if (typeof v[k] !== 'boolean') v[k] = DEFAULT_SETTINGS[k];
  if (v.childrenFilter !== 'notes' && v.childrenFilter !== 'all') v.childrenFilter = 'all';
  if (!Number.isInteger(v.firstDayOfWeek) || v.firstDayOfWeek < 0 || v.firstDayOfWeek > 6) v.firstDayOfWeek = 0;
  if (!Number.isInteger(v.tableWordLimit) || v.tableWordLimit < 4 || v.tableWordLimit > 200) v.tableWordLimit = DEFAULT_SETTINGS.tableWordLimit;
  const nt = cleanNoteTypes(v.noteExts, v.noteCreate) ?? { exts: DEFAULT_SETTINGS.noteExts, create: DEFAULT_SETTINGS.noteCreate };
  v.noteExts = nt.exts;
  v.noteCreate = nt.create;
  v.windows = (Array.isArray(v.windows) ? v.windows : [])
    .map((w) => ({ tabs: goodTabs(w?.tabs), activeTab: Number.isInteger(w?.activeTab) ? w.activeTab : 0 }))
    .filter((w) => w.tabs.length > 0);
  return v;
}
