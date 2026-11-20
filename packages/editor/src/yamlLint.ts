import { RESERVED_FRONTMATTER, RESERVED_VIEW, type SchemaHint } from './yamlHints';

/** One thing wrong (or doubtful) in a frontmatter block or a ```view block, with where it is in that block's YAML. */
export interface LintProblem {
  /** line of the YAML, from 0 */
  line: number;
  /** columns of the line the underline covers */
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface LintHost {
  /** the names of saved queries (for `query: !Name`) */
  savedQueries?: string[];
}

const KEY = /^(\s*)(- +)?([A-Za-z_][\w.-]*)(\s*:)[ \t]*(.*)$/;
const VIEW_TYPES = ['table', 'list', 'gallery', 'kanban', 'calendar'];
const HIDDEN_WORDS = new Set(['tree', 'files', 'children', 'search', 'queries', 'query', 'all', 'true', 'false']);
const KEYWORDS = new Set(['inherit', 'default', 'original', 'none']);
const BOOL = new Set(['true', 'false', 'yes', 'no']);

interface Entry {
  line: number;
  indent: number;
  dash: boolean;
  key: string;
  keyFrom: number;
  keyTo: number;
  value: string;
  valueFrom: number;
  valueTo: number;
}

/** The "key: value" lines of some YAML, with the columns of key and value (a comment and quotes are not part of the value). */
function entries(body: string): Entry[] {
  const out: Entry[] = [];
  body.split('\n').forEach((text, line) => {
    const m = KEY.exec(text);
    if (!m) return;
    const indent = m[1]!.length;
    const dash = (m[2] ?? '').length;
    const keyFrom = indent + dash;
    const raw = m[5]!.replace(/\s+#.*$/, '');
    const trimmed = raw.trim();
    const valueFrom = text.length - m[5]!.length + (raw.length - raw.trimStart().length);
    out.push({
      line,
      indent,
      dash: dash > 0,
      key: m[3]!,
      keyFrom,
      keyTo: keyFrom + m[3]!.length,
      value: trimmed.replace(/^(["'])(.*)\1$/, '$2'),
      valueFrom,
      valueTo: valueFrom + trimmed.length,
    });
  });
  return out;
}

const isNumber = (s: string): boolean => s !== '' && Number.isFinite(Number(s));
const isDate = (s: string): boolean => /^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/.test(s);
const isLink = (s: string): boolean => /^\[\[.+\]\]$/.test(s) || /^\[.*\]\(.*\)$/.test(s);

/** Mistakes in the names and values Cave Notes reads from a page's frontmatter, and values that do not fit the schema. */
export function lintFrontmatter(body: string, schema: Map<string, SchemaHint>): LintProblem[] {
  const out: LintProblem[] = [];
  const add = (e: Entry, from: number, to: number, message: string, severity: 'error' | 'warning' = 'warning'): void => void out.push({ line: e.line, from, to, message, severity });
  const all = entries(body);
  const lines = body.split('\n');
  for (const e of all) {
    const key = e.key.toLowerCase();
    const top = e.indent === 0 && !e.dash;
    const empty = e.value === '';
    if (top) {
      if (key === 'order' && !empty && !isNumber(e.value)) add(e, e.valueFrom, e.valueTo, '\u201corder\u201d must be a number, such as 3.');
      if ((key === 'template' || key === 'ignoreindicators') && !empty && !BOOL.has(e.value.toLowerCase())) add(e, e.valueFrom, e.valueTo, `\u201c${e.key}\u201d is true or false.`);
      if (key === 'hidden' && !empty && !e.value.startsWith('[')) {
        for (const w of e.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
          if (!HIDDEN_WORDS.has(w)) add(e, e.valueFrom, e.valueTo, `\u201c${w}\u201d does not hide anything. Use tree, children, search, queries, all or true.`);
        }
      }
      if ((key === 'children' || key === 'files') && !empty) add(e, e.valueFrom, e.valueTo, `\u201c${e.key}:\u201d holds attributes: write them indented on the lines below it, not after the colon.`, 'error');
      if (key === 'children' && empty) {
        const next = lines.slice(e.line + 1).find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
        if (next === undefined || !/^\s+\S/.test(next)) add(e, e.keyFrom, e.keyTo, '\u201cchildren:\u201d has no attributes below it, so it hands nothing down.');
      }
      // a value that does not fit what the schema declares for the attribute
      const a = schema.get(key);
      if (a && !(key in RESERVED_FRONTMATTER) && !empty && !KEYWORDS.has(e.value.toLowerCase()) && !e.value.startsWith('[') && !e.value.startsWith('{') && !e.value.startsWith('|') && !e.value.startsWith('>') && !isLink(e.value)) {
        if (a.schemaType === 'enum' && a.values && !a.values.some((v) => v.toLowerCase() === e.value.toLowerCase())) add(e, e.valueFrom, e.valueTo, `\u201c${e.value}\u201d is not one of the choices for ${e.key}: ${a.values.join(', ')}.`);
        else if (a.schemaType === 'number' && !isNumber(e.value)) add(e, e.valueFrom, e.valueTo, `${e.key} is a number in the schema.`);
        else if (a.schemaType === 'bool' && !BOOL.has(e.value.toLowerCase())) add(e, e.valueFrom, e.valueTo, `${e.key} is true or false in the schema.`);
        else if (a.schemaType === 'date' && !isDate(e.value)) add(e, e.valueFrom, e.valueTo, `${e.key} is a date in the schema, written like 2026-11-19.`);
      }
    } else {
      if (key === 'defaults' && !empty && !['default', 'inherit', 'original', 'none'].includes(e.value.toLowerCase()) && !e.value.startsWith('[')) add(e, e.valueFrom, e.valueTo, '\u201cdefaults\u201d is default, inherit, original, none or a [[Page]].');
      if (key === 'inheritance' && !empty && !['all', 'children'].includes(e.value.toLowerCase())) add(e, e.valueFrom, e.valueTo, '\u201cinheritance\u201d is all or children.');
    }
  }
  return out;
}

interface ViewEntries {
  settings: Map<string, Entry>;
  first: number;
}

/** The settings of each view in a block: one for a plain block, one per "- " item under `views:`. */
function viewsOf(all: Entry[]): ViewEntries[] {
  const segmented = all.some((e) => e.key === 'views' && e.indent === 0);
  if (!segmented) return [{ settings: new Map(all.filter((e) => e.indent === 0 && !e.dash).map((e) => [e.key, e])), first: all[0]?.line ?? 0 }];
  const views: ViewEntries[] = [];
  let itemDash = -1;
  let itemCol = -1;
  for (const e of all) {
    if (e.key === 'views' && e.indent === 0) continue;
    if (e.dash && (itemDash < 0 || e.indent <= itemDash)) {
      itemDash = e.indent;
      itemCol = e.keyFrom;
      views.push({ settings: new Map(), first: e.line });
    }
    if (views.length > 0 && e.keyFrom === itemCol) views[views.length - 1]!.settings.set(e.key, e);
  }
  return views;
}

/** Mistakes in a ```view block: unknown settings, values that cannot work, and lines a kind of view needs. */
export function lintView(body: string, host: LintHost = {}): LintProblem[] {
  const out: LintProblem[] = [];
  const all = entries(body);
  const views = viewsOf(all);
  const known = new Set([...Object.keys(RESERVED_VIEW), 'open']);
  const names = new Set(views.map((v) => v.settings.get('name')?.value.toLowerCase()).filter((n): n is string => !!n));
  const saved = new Set((host.savedQueries ?? []).map((n) => n.toLowerCase()));
  const add = (e: Entry, from: number, to: number, message: string, severity: 'error' | 'warning' = 'warning'): void => void out.push({ line: e.line, from, to, message, severity });
  for (const v of views) {
    const type = (v.settings.get('type')?.value || 'table').toLowerCase();
    for (const [key, e] of v.settings) {
      if (!known.has(key) && key !== 'views') add(e, e.keyFrom, e.keyTo, `\u201c${key}\u201d is not a view setting, so it is ignored.`);
    }
    const tEntry = v.settings.get('type');
    if (tEntry && !VIEW_TYPES.includes(type)) add(tEntry, tEntry.valueFrom, tEntry.valueTo, `Unknown view type \u201c${tEntry.value}\u201d. Use ${VIEW_TYPES.join(', ')}.`, 'error');
    const anchor = tEntry ?? v.settings.values().next().value ?? undefined;
    const at = (message: string): void => {
      if (anchor) add(anchor, anchor.keyFrom, anchor.keyTo, message);
    };
    if (type === 'kanban' && !v.settings.get('group')?.value) at('A board needs \u201cgroup: <attribute>\u201d: its values make the columns. Until then the view asks you to pick one.');
    if (type === 'calendar' && !v.settings.get('date')?.value) at('A calendar needs \u201cdate: <attribute>\u201d to place pages on days.');
    for (const key of ['limit', 'pageSize']) {
      const e = v.settings.get(key);
      if (e && e.value !== '' && (!isNumber(e.value) || Number(e.value) < (key === 'limit' ? 1 : 0))) add(e, e.valueFrom, e.valueTo, `\u201c${key}\u201d is a number${key === 'limit' ? ' from 1' : ', 0 or more'}.`, 'error');
    }
    const gd = v.settings.get('groupDir');
    if (gd && gd.value !== '' && !['asc', 'desc'].includes(gd.value.toLowerCase())) add(gd, gd.valueFrom, gd.valueTo, '\u201cgroupDir\u201d is asc or desc.');
    const rf = v.settings.get('relationFiles');
    if (rf && rf.value !== '' && !['link', 'skip'].includes(rf.value.toLowerCase())) add(rf, rf.valueFrom, rf.valueTo, '\u201crelationFiles\u201d is link or skip.');
    const q = v.settings.get('query');
    const bang = q ? /^!(?:"([^"]+)"|(\S+))/.exec(q.value) : null;
    const called = bang ? (bang[1] ?? bang[2])! : '';
    if (q && bang && !names.has(called.toLowerCase()) && !saved.has(called.toLowerCase())) add(q, q.valueFrom, q.valueTo, `There is no view or saved query called \u201c${called}\u201d.`);
  }
  return out;
}
