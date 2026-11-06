import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import YAML from 'yaml';
import { yamlTokens } from './yamlHighlight';

/** What the names Cave Notes itself reads in a page's frontmatter mean (shown when the pointer rests on one). */
export const RESERVED_FRONTMATTER: Record<string, string> = {
  title: 'The page\u2019s title when it has no # heading.',
  icon: 'The name of an icon from the bundled set, shown for this page in the page tree and in galleries (right-click the page: Set Icon\u2026).',
  aliases: 'Other names that [[wikilinks]] may use for this page.',
  order: 'A number: pages with one come first in the page tree, lowest first.',
  hidden: 'Where to hide this page: tree, children (the sub-page bar), search, a list like tree, children, or all / true for all three. false or nothing shows it everywhere. Views still list it.',
  exportStyle: 'The export style set this page is exported in (Preferences \u2192 Export Styles). With it, the sidebar counts pages as well as words. children: can hand it down.',
  presentationTheme: 'Makes this page a presentation in this slide theme; the sidebar counts slides.',
  unlisted: 'true keeps this page out of the page tree, search and every view (unless the query names unlisted). children: can hand it down.',
  template: 'true makes this page a template for new pages (and unlisted, unless it says unlisted: false).',
  children: 'Attributes that every sub-page, at any depth, gets unless it sets its own.',
  files: 'Attributes for the files of this page\u2019s folder that are not notes.',
  defaults: 'Where a children: block starts from: default (the workspace\u2019s values), inherit (also this page\u2019s own) or none (a blank slate).',
  inheritance: 'children: reaches only the next level down instead of every level.',
};

/** What the values `default`, `inherit` and `none` mean when they stand where an attribute\u2019s value goes. */
export const RESERVED_VALUES: Record<string, string> = {
  default: 'Take the workspace\u2019s value for this attribute.',
  inherit: 'Take the parent page\u2019s value for this attribute.',
  original: 'Take the workspace\u2019s own value for this attribute, forgetting what the pages above set.',
  none: 'No value: leave this attribute out here.',
};

/** What the settings of a ```view block mean. */
export const RESERVED_VIEW: Record<string, string> = {
  views: 'A list of views, each starting with "- ". Several views become tabs; each has its own name, type and query.',
  name: 'The name shown on the view\u2019s tab (leave it empty for just the icon). Another view can start its query with !Name to take this one\u2019s query.',
  type: 'How the pages are shown: table, list, gallery, kanban or calendar.',
  title: 'A heading shown above the view.',
  query: 'Which pages appear (the same query language as search). $this is this page.',
  sort: 'The order of the rows: attribute names, each with - in front for descending, separated by commas.',
  group: 'The attribute that groups rows (tables, lists) or makes the columns (boards).',
  groupDir: 'desc puts the last group first.',
  date: 'Calendars: the date attribute that places a page on a day.',
  cover: 'Galleries: an attribute holding an image path.',
  columns: 'Which properties show, in order.',
  newFields: 'The fields the + New row asks for, in order. Without it, the row asks for the shown properties (columns).',
  limit: 'The most rows to load.',
  pageSize: 'Rows per page (0 shows everything up to the limit).',
  when: 'A colour rule\u2019s condition: a query (with $now, $this \u2026) that a page must match.',
  color: 'A colour rule\u2019s colour: a name (red, orange, yellow, green, blue, purple, brown, gray) or #rrggbb.',
  colors: 'Colour rules: the first whose query matches a page colours its row.',
  relationFiles: 'link or skip: what a relation column does with a page or file that cannot name this page back (a file that is not a note). link links it from this side only; skip leaves it out. Without it you are asked.',
  noDuplicateWarning: 'true creates a page whose name is taken without asking first (its file gets .1, .2 \u2026).',
};

/** The explanation of a frontmatter name (names are not case-sensitive), or undefined. */
export function reservedFrontmatter(name: string): string | undefined {
  return RESERVED_FRONTMATTER[name] ?? RESERVED_FRONTMATTER[name.toLowerCase()];
}

/** The first problem in a piece of YAML, or null when it reads fine (an empty block is fine). */
export function yamlProblem(text: string, view = false): string | null {
  if (text.trim() === '') return null;
  // `query: !Name` is a view shortcode, which YAML would read as a tag
  if (view) text = text.replace(/^(\s*(?:-[ \t]+)?query:[ \t]*)(!.*?)([ \t]+#.*)?$/gm, (_m, h: string, v: string, c?: string) => `${h}${JSON.stringify(v.trim())}${c ?? ''}`);
  if (view && /^view[ \t]*:/m.test(text) && YAML.parseDocument(text).errors.some((x) => x.code === 'DUPLICATE_KEY')) return 'several views are a list now: use "views:" and start each view with "- "';
  const e = YAML.parseDocument(text).errors[0];
  if (!e) return null;
  const line = e.linePos?.[0]?.line;
  return `${e.message.split('\n')[0]}${line ? ` (line ${line})` : ''}`;
}

/** The YAML between the `---` lines of a frontmatter block's text. */
export function frontmatterBody(text: string): string {
  const lines = text.split('\n');
  const end = lines.length > 1 && /^(---|\.\.\.)\s*$/.test(lines[lines.length - 1]!) ? lines.length - 1 : lines.length;
  return lines.slice(1, end).join('\n');
}

const KEY = /^(\s*)(- +)?([A-Za-z_][\w.-]*)(\s*:)(\s*)(.*)$/;

function addHints(state: EditorState, out: Array<Range<Decoration>>, from: number, to: number, kind: 'frontmatter' | 'view', bodyFrom: number, bodyTo: number): void {
  const doc = state.doc;
  const names: Record<string, string> = kind === 'frontmatter' ? new Proxy(RESERVED_FRONTMATTER, { get: (t, k) => (typeof k === 'string' ? reservedFrontmatter(k) : undefined) }) : RESERVED_VIEW;
  // whether we are inside a nested block, so only the names that nest (defaults, inheritance) count there
  const first = doc.lineAt(bodyFrom).number;
  const last = doc.lineAt(Math.max(bodyFrom, bodyTo - 1)).number;
  const segmented = kind === 'view' && /^views[ \t]*:/m.test(doc.sliceString(bodyFrom, bodyTo));
  // in a block of several views the settings stand in the `- ` items of `views:`: the item\u2019s own column is the top level
  let itemDash = -1;
  let itemCol = -1;
  for (let n = first; n <= last && n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from < bodyFrom && n !== first) continue;
    const m = KEY.exec(line.text);
    if (!m) continue;
    const [, indent = '', dash = '', key = '', , gap = '', value = ''] = m;
    const keyFrom = line.from + indent.length + dash.length;
    let nested: boolean;
    if (kind === 'view' && segmented) {
      if (dash.length > 0 && key !== 'views' && (itemDash < 0 || indent.length <= itemDash)) {
        itemDash = indent.length;
        itemCol = indent.length + dash.length;
      }
      const top = key === 'views' ? indent.length === 0 : dash.length > 0 ? indent.length === itemDash : indent.length === itemCol;
      nested = !top;
    } else nested = indent.length > 0 || (dash.length > 0 && !(kind === 'view' && key === 'when'));
    if (kind === 'view' && key === 'when') nested = false;
    const tip = names[key] && (kind === 'view' ? !nested || key === 'when' : !nested || key === 'defaults' || key === 'inheritance') ? names[key] : undefined;
    if (tip) out.push(Decoration.mark({ class: 'cm-yaml-reserved', attributes: { title: tip } }).range(keyFrom, keyFrom + key.length));
    const v = value.replace(/\s+#.*$/, '').trim();
    if (kind === 'frontmatter' && v in RESERVED_VALUES && key !== 'defaults') {
      const vFrom = line.from + m[0].length - value.length;
      out.push(Decoration.mark({ class: 'cm-yaml-reserved', attributes: { title: RESERVED_VALUES[v]! } }).range(vFrom, vFrom + v.length));
    } else if (kind === 'frontmatter' && key === 'defaults') {
      const vFrom = line.from + m[0].length - value.length - gap.length + gap.length;
      if (['default', 'inherit', 'original', 'none'].includes(v)) out.push(Decoration.mark({ class: 'cm-yaml-reserved', attributes: { title: RESERVED_VALUES[v]! } }).range(vFrom, vFrom + v.length));
    }
  }
  void from;
  void to;
}

/** Colour the YAML between `from` and `to`. */
function addColours(state: EditorState, out: Array<Range<Decoration>>, from: number, to: number): void {
  if (to <= from) return;
  for (const t of yamlTokens(state.doc.sliceString(from, to))) out.push(Decoration.mark({ class: `cm-y-${t.cls}` }).range(from + t.from, from + t.to));
}

function build(state: EditorState): DecorationSet {
  const out: Array<Range<Decoration>> = [];
  const doc = state.doc;
  const flag = (from: number, to: number, problem: string): void => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = a; n <= b; n++) {
      const cls = `cm-yaml-bad${n === a ? ' cm-yaml-bad-first' : ''}${n === b ? ' cm-yaml-bad-last' : ''}`;
      out.push(Decoration.line({ class: cls, attributes: { title: `Invalid YAML: ${problem}` } }).range(doc.line(n).from));
    }
  };
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Frontmatter') {
        const text = doc.sliceString(ref.from, ref.to);
        const body = frontmatterBody(text);
        const problem = yamlProblem(body);
        if (problem) flag(ref.from, ref.to, problem);
        const first = doc.lineAt(ref.from);
        const last = doc.lineAt(Math.max(ref.from, ref.to - 1));
        const closed = last.number > first.number && /^(---|\.\.\.)\s*$/.test(last.text);
        addHints(state, out, ref.from, ref.to, 'frontmatter', Math.min(first.to + 1, ref.to), closed ? last.from : ref.to);
        addColours(state, out, Math.min(first.to + 1, ref.to), closed ? last.from : ref.to);
        return false;
      }
      if (ref.name === 'FencedCode') {
        const info = /^\s*(?:```|~~~)\s*([^\s`]*)/.exec(doc.lineAt(ref.from).text);
        const lang = info?.[1]?.toLowerCase();
        if (!lang || !['view', 'yaml', 'yml'].includes(lang)) return false;
        const first = doc.lineAt(ref.from);
        const last = doc.lineAt(ref.to);
        const innerFrom = Math.min(first.to + 1, ref.to);
        const closed = last.number > first.number && /^\s*(```|~~~)\s*$/.test(last.text) && last.from >= innerFrom;
        const innerTo = closed ? last.from : ref.to;
        addColours(state, out, innerFrom, innerTo);
        if (lang !== 'view') return false;
        const problem = yamlProblem(doc.sliceString(innerFrom, innerTo), true);
        if (problem) flag(ref.from, ref.to, problem);
        addHints(state, out, ref.from, ref.to, 'view', innerFrom, innerTo);
        return false;
      }
      return undefined;
    },
  });
  return Decoration.set(out, true);
}

/**
 * While the raw text of a frontmatter block or a ```view block is on screen: wrong YAML gets a red outline and an
 * "Invalid YAML" tag in the bottom right corner (drawn over the block, so nothing moves while you type), and the
 * names and values Cave Notes itself reads are styled and explain themselves when the pointer rests on them.
 */
export function yamlHints(): Extension {
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/**
 * A whole document that is YAML (a workspace settings file, shown as plain text): the same colours as in a frontmatter block, and a
 * red outline with an "Invalid YAML" tag when it does not read as YAML.
 */
export function yamlDocument(): Extension {
  const buildAll = (state: EditorState): DecorationSet => {
    const out: Array<Range<Decoration>> = [];
    const doc = state.doc;
    const text = doc.toString();
    addColours(state, out, 0, doc.length);
    const problem = yamlProblem(text);
    if (problem && doc.length > 0) {
      for (let n = 1; n <= doc.lines; n++) {
        const cls = `cm-yaml-bad${n === 1 ? ' cm-yaml-bad-first' : ''}${n === doc.lines ? ' cm-yaml-bad-last' : ''}`;
        out.push(Decoration.line({ class: cls, attributes: { title: `Invalid YAML: ${problem}` } }).range(doc.line(n).from));
      }
    }
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: buildAll,
    update: (value, tr) => (tr.docChanged ? buildAll(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
