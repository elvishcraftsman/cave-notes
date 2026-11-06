import type { Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorView } from '@codemirror/view';
import { installFormatMenuStyles } from './theme';
import { selectAllAsHtml, selectAllAsText } from './selectAll';
import { canIndentListItems, canOutdentListItems, indentListItems, outdentListItems } from './lists';
import { insertViewBlock } from './commands';
import { insertTable } from './tables';
import { activeFormats, type BlockFormat, type InlineFormat, toggleBlock, toggleInline } from './formatting';

/**
 * The formatting menu: right-click in the text, or release the mouse with text selected. It is a short, wide bar of
 * icon buttons (tooltips carry the names and shortcuts) with the applied formats pressed in. Headings, bulleted
 * lists and numbered lists have a drop-down beside them for their variants (hierarchical, lettered, Roman ...).
 * Plain DOM so it works anywhere; it is styled with the host's CSS variables (see .cm-format-menu in theme.ts).
 */

type IconKey = 'table' | 'grid' | 'code' | 'link' | 'quote' | 'codeblock' | 'bullets' | 'numbers' | 'tasks' | 'chevron' | 'check' | 'indent' | 'outdent' | 'selectall' | 'selecthtml' | 'copy';

/** 16px grid, 1.5px strokes, currentColor: the same style as the app's own symbolic icons. */
const ICON_PATHS: Record<IconKey, string> = {
  table: 'M2.5 3h11v10h-11z M2.5 6.5h11 M6.5 6.5V13',
  grid: 'M2.5 3h11v10h-11z M2.5 8h11 M8 3v10',
  code: 'M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5',
  link: 'M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8 M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8',
  quote: 'M3 3v10 M6.5 4.5h7 M6.5 8h7 M6.5 11.5h4.5',
  codeblock: 'M2.5 3h11v10h-11z M6.2 6.4L4.7 8l1.5 1.6 M9.8 6.4L11.3 8 9.8 9.6',
  bullets: 'M6 4.5h7.5 M6 8h7.5 M6 11.5h7.5 M2.5 4.5h.1 M2.5 8h.1 M2.5 11.5h.1',
  numbers: 'M6.5 4.5H14 M6.5 8H14 M6.5 11.5H14 M2.2 3.6l1.1-.7v3 M2 7.6c.2-.9 1.9-.9 1.9.1 0 .8-1.9 1.4-1.9 2.1h2 M2 11.3c.3-.6 1.9-.6 1.9.3 0 .5-.6.7-.9.7.4 0 1 .2 1 .8 0 .9-1.7 1-2 .2',
  tasks: 'M2.5 2.5h6v6h-6z M4 5.5l1.4 1.4 2.2-2.6 M11 5.5h2.5 M2.5 12h11',
  chevron: 'M4 6.5L8 10.5 12 6.5',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  indent: 'M2.5 3.5h11 M8 7.5h5.5 M8 11.5h5.5 M2.5 6.2L5.3 8.5 2.5 10.8',
  selectall: 'M2.5 2.5h11v11h-11z M5.5 6h5 M5.5 8h5 M5.5 10h3',
  selecthtml: 'M2.5 2.5h11v11h-11z M6 5.5L4.5 8 6 10.5 M10 5.5L11.5 8 10 10.5',
  copy: 'M5.5 5.5h8v8h-8z M2.5 10.5v-8h8',
  outdent: 'M2.5 3.5h11 M8 7.5h5.5 M8 11.5h5.5 M5.3 6.2L2.5 8.5 5.3 10.8',
};

function svg(key: IconKey, size = 16): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', '0 0 16 16');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.5');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICON_PATHS[key]);
  el.appendChild(path);
  return el;
}

interface Tool {
  /** the name, for the tooltip and screen readers */
  label: string;
  hint?: string;
  /** a letter drawn in a style of its own, or an icon */
  glyph?: { text: string; cls: string };
  icon?: IconKey;
  inline?: InlineFormat;
  block?: BlockFormat;
}

interface Variant {
  block: BlockFormat;
  /** what the list looks like, in monospace */
  sample: string;
  label: string;
}

const INLINE: Tool[] = [
  { label: 'Bold', hint: 'Ctrl+B', glyph: { text: 'B', cls: 'cm-glyph-bold' }, inline: 'bold' },
  { label: 'Italic', hint: 'Ctrl+I', glyph: { text: 'I', cls: 'cm-glyph-italic' }, inline: 'italic' },
  { label: 'Strikethrough', hint: 'Ctrl+Shift+X', glyph: { text: 'S', cls: 'cm-glyph-strike' }, inline: 'strike' },
  { label: 'Code', hint: 'Ctrl+E', icon: 'code', inline: 'code' },
  { label: 'Link', hint: 'Ctrl+K', icon: 'link', inline: 'link' },
];

const HEADINGS: Variant[] = [
  { block: 'paragraph', sample: '¶', label: 'Paragraph' },
  { block: 'h1', sample: 'H1', label: 'Heading 1' },
  { block: 'h2', sample: 'H2', label: 'Heading 2' },
  { block: 'h3', sample: 'H3', label: 'Heading 3' },
  { block: 'h4', sample: 'H4', label: 'Heading 4' },
];

const QUOTE: Tool = { label: 'Quote', icon: 'quote', block: 'quote' };
const CODEBLOCK: Tool = { label: 'Code block', icon: 'codeblock', block: 'codeblock' };
const TASKS: Tool = { label: 'Task list', icon: 'tasks', block: 'task' };

const BULLET_VARIANTS: Variant[] = [
  { block: 'bullet', sample: '• • •', label: 'Bulleted' },
  { block: 'bullet-h', sample: '• ◦ ▪', label: 'Bullets by level' },
];

const NUMBER_VARIANTS: Variant[] = [
  { block: 'decimal', sample: '1. 2. 3.', label: 'Numbered' },
  { block: 'decimal-h', sample: '1. 1.1.', label: 'Numbers by level' },
  { block: 'alpha', sample: 'a. b. c.', label: 'Lettered' },
  { block: 'ALPHA', sample: 'A. B. C.', label: 'Capital letters' },
  { block: 'roman', sample: 'i. ii. iii.', label: 'Roman' },
  { block: 'ROMAN', sample: 'I. II. III.', label: 'Capital Roman' },
];

/** The kinds a numbered list can have, for the main button of its split (the "by level" style is an addition to one of them). */
const NUMBER_KINDS: BlockFormat[] = ['decimal', 'alpha', 'ALPHA', 'roman', 'ROMAN'];

/** What the editor needs from a spell checker: suggestions for a word that is spelled wrong, and a way to keep a word. */
export interface SpellHost {
  /** Suggestions for the word, or null when it is spelled right (or checking is off). */
  check(word: string): string[] | null;
  /** Add the word to the user's dictionary. */
  addWord(word: string): void;
}

/** The misspelt word under a right-click, with its place in the document. */
export interface SpellTarget {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}'\u2019]/u;

/** The word around a document position (letters, digits and inner apostrophes), or null. */
export function wordAround(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let a = pos - line.from;
  let b = a;
  while (a > 0 && WORD_CHAR.test(text[a - 1]!)) a--;
  while (b < text.length && WORD_CHAR.test(text[b]!)) b++;
  // apostrophes and quotes at the edges belong to the sentence, not the word
  while (a < b && /['\u2019]/.test(text[a]!)) a++;
  while (b > a && /['\u2019]/.test(text[b - 1]!)) b--;
  if (a >= b) return null;
  return { word: text.slice(a, b), from: line.from + a, to: line.from + b };
}

/** The word at `pos`, if the spell checker says it is wrong. */
export function misspeltAt(view: EditorView, pos: number | null, spell: SpellHost | undefined): SpellTarget | null {
  if (!spell || pos === null) return null;
  const w = wordAround(view, pos);
  if (!w || /^\d+$/.test(w.word)) return null;
  const suggestions = spell.check(w.word);
  return suggestions ? { ...w, suggestions } : null;
}

/** What the editor needs from a thesaurus: replacements for one word, already in the word's own form and capitals. */
export interface ThesaurusHost {
  /** Synonyms for the word, best first; null when the word is not worth a menu (an article, a preposition ...) or unknown. */
  synonyms(word: string): string[] | null;
}

/** The word under a right-click and what could replace it. */
export interface SynonymTarget {
  word: string;
  from: number;
  to: number;
  options: string[];
}

/** Parts of a page whose words are not prose: code, links, addresses, comments and the like. */
const NOT_PROSE = /^(FencedCode|CodeBlock|InlineCode|CodeText|CodeInfo|URL|Autolink|HTMLTag|HTMLBlock|Comment|CommentBlock|ProcessingInstruction|LinkReference|LinkLabel|Image)$/;

/**
 * Synonyms for the one word under a right-click. A selection counts when it is exactly one word; otherwise the word at the
 * click. Nothing is offered inside code, addresses, [[page links]] or front matter, or when the selection is longer than a word.
 */
export function synonymsAt(view: EditorView, pos: number | null, thesaurus: ThesaurusHost | undefined): SynonymTarget | null {
  if (!thesaurus || pos === null) return null;
  const sel = view.state.selection.main;
  let w: { word: string; from: number; to: number } | null;
  if (!sel.empty) {
    const picked = wordAround(view, sel.from);
    // the selection has to be that single word, nothing more
    if (!picked || picked.from !== sel.from || picked.to !== sel.to || pos < sel.from || pos > sel.to) return null;
    w = picked;
  } else w = wordAround(view, pos);
  if (!w || /\d/.test(w.word)) return null;
  const line = view.state.doc.lineAt(w.from);
  // inside [[...]]: changing the word would change where the link goes
  const before = line.text.slice(0, w.from - line.from);
  const after = line.text.slice(w.to - line.from);
  if (before.lastIndexOf('[[') > before.lastIndexOf(']]') && after.includes(']]')) return null;
  // front matter: a block between two --- lines at the very top of the page
  if (/^---\s*$/.test(view.state.doc.line(1).text)) {
    for (let n = 2; n <= view.state.doc.lines; n++) {
      if (/^(---|\.\.\.)\s*$/.test(view.state.doc.line(n).text)) {
        if (line.number <= n) return null;
        break;
      }
    }
  }
  for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(w.from, 1); node; node = node.parent) {
    if (NOT_PROSE.test(node.name)) return null;
  }
  const options = thesaurus.synonyms(w.word);
  return options && options.length > 0 ? { ...w, options } : null;
}

let open: { el: HTMLElement; dock: boolean; close: () => void } | null = null;

export function closeFormatMenu(): void {
  open?.close();
  open = null;
}

/**
 * Show the menu with its top left corner at (x, y), in page coordinates. With `dock` (touch) it instead spans the bottom edge
 * of the window, and has Indent / Outdent buttons for list items, which a phone keyboard has no Tab key for.
 */
export function showFormatMenu(view: EditorView, x: number, y: number, spelling?: { target: SpellTarget; host: SpellHost }, synonyms?: SynonymTarget, opts: { dock?: boolean; selectOnly?: boolean } = {}): void {
  const dock = opts.dock === true;
  closeFormatMenu();
  installFormatMenuStyles();
  const active = activeFormats(view.state);
  const menu = document.createElement('div');
  menu.className = 'cm-format-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Formatting');

  let sub: HTMLElement | null = null;
  let subOwner: HTMLElement | null = null;
  let spellList: HTMLElement | null = null;
  const closeSub = (): void => {
    if (spellList) spellList.style.display = '';
    sub?.remove();
    subOwner?.setAttribute('aria-expanded', 'false');
    sub = null;
    subOwner = null;
  };

  const run = (apply: () => void): void => {
    closeFormatMenu();
    apply();
    view.focus();
  };
  // keep the selection and focus in the editor while clicking
  const keepFocus = (b: HTMLElement): void => b.addEventListener('mousedown', (ev) => ev.preventDefault());

  const tip = (t: { label: string; hint?: string }): string => (t.hint ? `${t.label} (${t.hint})` : t.label);

  /** A button for one format. */
  const tool = (t: Tool, on: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-format-btn' + (on ? ' cm-format-on' : '');
    b.title = tip(t);
    b.setAttribute('aria-label', t.label);
    b.setAttribute('aria-pressed', String(on));
    b.dataset.format = t.inline ?? t.block!;
    if (t.glyph) {
      const g = document.createElement('span');
      g.className = `cm-glyph ${t.glyph.cls}`;
      g.textContent = t.glyph.text;
      b.appendChild(g);
    } else b.appendChild(svg(t.icon!));
    keepFocus(b);
    b.addEventListener('click', () => run(() => (t.inline ? toggleInline(view, t.inline) : toggleBlock(view, t.block!))));
    return b;
  };

  /** The drop-down list of a split button: each variant with a sample of how it looks, the applied one ticked. */
  const openSub = (owner: HTMLElement, variants: Variant[]): void => {
    closeSub();
    if (spellList) spellList.style.display = 'none';
    const list = document.createElement('div');
    list.className = 'cm-format-sub';
    list.setAttribute('role', 'menu');
    for (const v of variants) {
      const on = active.block.has(v.block);
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'cm-format-sub-item' + (on ? ' cm-format-on' : '');
      it.setAttribute('role', 'menuitemcheckbox');
      it.setAttribute('aria-checked', String(on));
      it.dataset.format = v.block;
      const tick = document.createElement('span');
      tick.className = 'cm-format-sub-tick';
      if (on) tick.appendChild(svg('check', 12));
      const sample = document.createElement('span');
      sample.className = 'cm-format-sub-sample';
      sample.textContent = v.sample;
      const label = document.createElement('span');
      label.className = 'cm-format-sub-label';
      label.textContent = v.label;
      it.append(tick, sample, label);
      keepFocus(it);
      it.addEventListener('click', () => run(() => toggleBlock(view, v.block)));
      list.appendChild(it);
    }
    menu.appendChild(list);
    owner.setAttribute('aria-expanded', 'true');
    sub = list;
    subOwner = owner;
    const anchor = (owner.parentElement ?? owner).getBoundingClientRect();
    const r = list.getBoundingClientRect();
    const below = anchor.bottom + 2;
    const top = below + r.height > window.innerHeight - 4 && anchor.top - r.height - 2 > 4 ? anchor.top - r.height - 2 : below;
    list.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - r.width - 4))}px`;
    list.style.top = `${top}px`;
  };

  /** A caret button that opens a list of variants. */
  const caret = (variants: Variant[], label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-format-btn cm-format-caret';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.appendChild(svg('chevron', 12));
    keepFocus(b);
    b.addEventListener('click', () => {
      if (subOwner === b) closeSub();
      else openSub(b, variants);
    });
    return b;
  };

  /** An icon button with a drop-down beside it: the button switches the main format, the drop-down offers the variants. */
  const split = (main: Tool, mainFormat: BlockFormat, variants: Variant[], more: string, anyOn: boolean): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'cm-format-split';
    const b = tool({ ...main, block: mainFormat }, anyOn);
    b.classList.add('cm-format-split-main');
    wrap.append(b, caret(variants, more));
    return wrap;
  };

  const group = (...kids: HTMLElement[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'cm-format-group';
    g.setAttribute('role', 'group');
    g.append(...kids);
    return g;
  };
  const divider = (): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'cm-format-divider';
    d.setAttribute('role', 'separator');
    return d;
  };

  // text styles
  const styles = group(...INLINE.map((t) => tool(t, active.inline.has(t.inline!))));

  // heading level: one button that shows the level in use and opens the list
  const level = HEADINGS.find((h) => h.block !== 'paragraph' && active.block.has(h.block));
  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'cm-format-btn cm-format-heading' + (level ? ' cm-format-on' : '');
  heading.title = 'Heading level';
  heading.setAttribute('aria-label', 'Heading level');
  heading.setAttribute('aria-haspopup', 'menu');
  heading.setAttribute('aria-expanded', 'false');
  const hg = document.createElement('span');
  hg.className = 'cm-glyph cm-glyph-heading';
  hg.textContent = level ? level.sample : 'H';
  heading.append(hg, svg('chevron', 12));
  keepFocus(heading);
  heading.addEventListener('click', () => {
    if (subOwner === heading) closeSub();
    else openSub(heading, HEADINGS);
  });
  const blocks = group(heading, tool(QUOTE, active.block.has('quote')), tool(CODEBLOCK, active.block.has('codeblock')));

  // lists
  const bulletOn = active.block.has('bullet');
  const numberKind = NUMBER_KINDS.find((k) => active.block.has(k));
  /** A button that does something to the selection rather than toggling a format; dimmed (and inert) when there is nothing for it to do. */
  const action = (label: string, icon: IconKey, enabled: boolean, act: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-format-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-disabled', String(!enabled));
    b.dataset.format = icon;
    b.appendChild(svg(icon));
    keepFocus(b);
    b.addEventListener('click', () => {
      if (enabled) run(act);
    });
    return b;
  };
  const lists = group(
    split({ label: 'Bulleted list', icon: 'bullets' }, 'bullet', BULLET_VARIANTS, 'More bulleted lists', bulletOn),
    split({ label: 'Numbered list', icon: 'numbers' }, numberKind ?? 'decimal', NUMBER_VARIANTS, 'More numbered lists', !!numberKind),
    tool(TASKS, active.block.has('task')),
    action('Outdent list item', 'outdent', canOutdentListItems(view.state), () => outdentListItems(view)),
    action('Indent list item', 'indent', canIndentListItems(view.state), () => indentListItems(view)),
  );

  // a database view goes in from here (it is not in the main menu)
  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.className = 'cm-format-btn';
  viewBtn.title = 'Insert database view (Ctrl+Alt+V)';
  viewBtn.setAttribute('aria-label', 'Insert database view');
  viewBtn.dataset.format = 'database-view';
  viewBtn.appendChild(svg('table'));
  keepFocus(viewBtn);
  viewBtn.addEventListener('click', () => run(() => insertViewBlock(view)));
  // a table (2 by 2, to be filled in and grown from its own grips)
  const tableBtn = document.createElement('button');
  tableBtn.type = 'button';
  tableBtn.className = 'cm-format-btn';
  tableBtn.title = 'Insert table';
  tableBtn.setAttribute('aria-label', 'Insert table');
  tableBtn.dataset.format = 'table';
  tableBtn.appendChild(svg('grid'));
  keepFocus(tableBtn);
  tableBtn.addEventListener('click', () => run(() => insertTable(view)));
  const inserts = group(tableBtn, viewBtn);

  // two rows: text styles and blocks above, lists and inserts below
  const row = (...kids: HTMLElement[]): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'cm-format-row';
    r.append(...kids);
    return r;
  };
  const selects = group(
    action('Select all text', 'selectall', true, () => selectAllAsText(view)),
    action('Select all as HTML', 'selecthtml', true, () => selectAllAsHtml(view)),
  );
  if (opts.selectOnly) {
    // a page that cannot change: nothing to format, but its text can still be selected and copied
    const copy = action('Copy', 'copy', !view.state.selection.main.empty, () => document.execCommand('copy'));
    menu.append(row(group(copy), divider(), selects));
  } else menu.append(row(styles, divider(), blocks), row(lists, divider(), inserts, divider(), selects));

  if (dock) menu.classList.add('cm-format-dock');
  document.body.appendChild(menu);
  if (!dock) {
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  }

  /** Hang a list under the toolbar (above it when there is no room below). */
  const hang = (list: HTMLElement): void => {
    menu.appendChild(list);
    const mr = menu.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    const below = mr.bottom + 2;
    const top = below + lr.height > window.innerHeight - 4 && mr.top - lr.height - 2 > 4 ? mr.top - lr.height - 2 : below;
    list.style.left = `${Math.max(4, Math.min(mr.left, window.innerWidth - lr.width - 4))}px`;
    list.style.top = `${top}px`;
    spellList = list;
  };
  /** One entry of such a list. */
  const entry = (list: HTMLElement, label: string, cls: string, act: () => void): void => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = `cm-format-sub-item ${cls}`;
    it.setAttribute('role', 'menuitem');
    const l = document.createElement('span');
    l.className = 'cm-format-sub-label';
    l.textContent = label;
    it.appendChild(l);
    keepFocus(it);
    it.addEventListener('click', () => run(act));
    list.appendChild(it);
  };

  // a word that is spelled wrong: its suggestions and "Add to Dictionary" hang under the toolbar
  if (spelling) {
    const { target, host } = spelling;
    const list = document.createElement('div');
    list.className = 'cm-format-sub cm-spell-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', `Spelling: ${target.word}`);
    if (target.suggestions.length === 0) {
      const none = document.createElement('div');
      none.className = 'cm-spell-none';
      none.textContent = 'No suggestions';
      list.appendChild(none);
    }
    for (const sug of target.suggestions.slice(0, 6)) {
      entry(list, sug, 'cm-spell-suggestion', () => view.dispatch({ changes: { from: target.from, to: target.to, insert: sug }, selection: { anchor: target.from + sug.length } }));
    }
    const rule = document.createElement('div');
    rule.className = 'cm-spell-rule';
    list.appendChild(rule);
    entry(list, 'Add to Dictionary', 'cm-spell-add', () => host.addWord(target.word));
    hang(list);
  } else if (synonyms) {
    // a word that is spelled right: other words that could stand in its place
    const list = document.createElement('div');
    list.className = 'cm-format-sub cm-spell-list cm-synonym-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', `Synonyms for ${synonyms.word}`);
    const title = document.createElement('div');
    title.className = 'cm-synonym-title';
    title.textContent = `Synonyms for \u201c${synonyms.word}\u201d`;
    list.appendChild(title);
    for (const alt of synonyms.options) {
      entry(list, alt, 'cm-synonym', () => view.dispatch({ changes: { from: synonyms.from, to: synonyms.to, insert: alt }, selection: { anchor: synonyms.from + alt.length } }));
    }
    hang(list);
  }

  const onDown = (ev: Event): void => {
    if (!menu.contains(ev.target as Node)) closeFormatMenu();
  };
  const buttons = (): HTMLElement[] => {
    const items = sub ? [...sub.querySelectorAll<HTMLElement>('.cm-format-sub-item')] : [];
    return items.length > 0 ? items : [...menu.querySelectorAll<HTMLElement>('.cm-format-btn')];
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (sub) {
        const owner = subOwner;
        closeSub();
        owner?.focus();
      } else {
        closeFormatMenu();
        view.focus();
      }
      return;
    }
    // arrow keys move through the buttons once focus is in the menu (Tab gets there)
    const inMenu = menu.contains(document.activeElement);
    if (!inMenu) return;
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step = (d: number): void => {
      ev.preventDefault();
      list[(at + d + list.length) % list.length]?.focus();
    };
    if (sub) {
      if (ev.key === 'ArrowDown') step(1);
      else if (ev.key === 'ArrowUp') step(-1);
    } else if (ev.key === 'ArrowRight') step(1);
    else if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'ArrowDown' && (document.activeElement as HTMLElement).getAttribute('aria-haspopup')) {
      ev.preventDefault();
      (document.activeElement as HTMLElement).click();
      menu.querySelector<HTMLElement>('.cm-format-sub:not(.cm-spell-list) .cm-format-sub-item')?.focus();
    }
  };
  // after this click has finished, so the mouseup that opened a selection menu does not close it
  const arm = setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeFormatMenu);
  }, 0);
  open = {
    el: menu,
    dock,
    close: () => {
      // a menu closed before it was armed must not leave listeners behind
      clearTimeout(arm);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closeFormatMenu);
      menu.remove();
    },
  };
}

export interface FormatMenuOptions {
  /** Also show the menu when the mouse is released with text selected (default true). */
  onSelection?: boolean;
  /** Spell checker behind the suggestions on a misspelt word. */
  spell?: SpellHost;
  /** Thesaurus behind the synonyms offered for a word that is spelled right. */
  thesaurus?: ThesaurusHost;
}

/**
 * Right-click (and, optionally, selecting text with the mouse) opens the menu. On a touch screen a long press is left to the
 * system, which selects the word; the menu then appears along the bottom edge once a selection has settled.
 */
export function formatMenu(options: FormatMenuOptions = {}): Extension {
  /** what the last pointer in the editor was: 'mouse', 'pen' or 'touch' */
  let lastPointer = 'mouse';
  let settle: ReturnType<typeof setTimeout> | undefined;
  return [
    EditorView.domEventHandlers({
      pointerdown: (e) => {
        lastPointer = e.pointerType || lastPointer;
        return false;
      },
      contextmenu: (e, view) => {
        const readOnly = view.state.readOnly; // nothing to format in a page that cannot change: only select and copy
        if (lastPointer === 'touch') return false; // a long press selects a word: do not take it away
        e.preventDefault();
        // right-clicking outside the selection puts the cursor there first, as in any text editor
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const sel = view.state.selection.main;
        if (pos !== null && (pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } });
        if (readOnly) {
          showFormatMenu(view, e.clientX, e.clientY, undefined, undefined, { selectOnly: true });
          return true;
        }
        const target = misspeltAt(view, pos, options.spell);
        const synonyms = target ? null : synonymsAt(view, pos, options.thesaurus);
        showFormatMenu(view, e.clientX, e.clientY, target && options.spell ? { target, host: options.spell } : undefined, synonyms ?? undefined);
        return true;
      },
      mouseup: (e, view) => {
        if (options.onSelection === false || view.state.readOnly || e.button !== 0 || view.state.selection.main.empty) return false;
        if (lastPointer === 'touch') return false; // touch has its own menu, below
        const to = view.state.selection.main.to;
        const c = view.coordsAtPos(to);
        // let the selection settle (a double click selects a word on the second mouseup)
        setTimeout(() => {
          if (view.state.selection.main.empty || !view.hasFocus) return;
          showFormatMenu(view, c ? c.left : e.clientX, (c ? c.bottom : e.clientY) + 6);
        }, 0);
        return false;
      },
      keydown: () => {
        if (open) closeFormatMenu();
        return false;
      },
    }),
    // touch: show the menu along the bottom once the selection has stopped moving (the handles are still being dragged until then),
    // and take it away when the selection goes
    EditorView.updateListener.of((u) => {
      if (options.onSelection === false || lastPointer !== 'touch') return;
      if (!u.selectionSet && !u.focusChanged && !u.docChanged) return;
      const view = u.view;
      clearTimeout(settle);
      if (view.state.readOnly || view.state.selection.main.empty || !view.hasFocus) {
        if (open?.dock) closeFormatMenu();
        return;
      }
      settle = setTimeout(() => {
        if (view.state.readOnly || view.state.selection.main.empty || !view.hasFocus) return;
        // The system's own "Select all" selects what is drawn, and a long page is drawn a part at a time: a selection that is
        // exactly the drawn part of a longer page was meant to be all of it.
        {
          const m = view.state.selection.main;
          const vp = view.viewport;
          if (m.from === vp.from && m.to === vp.to && (vp.from > 0 || vp.to < view.state.doc.length) && m.to - m.from > 200) {
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
            return;
          }
        }
        // a single word that is selected (a long press selects one): its spelling or synonyms hang above the docked menu
        const sel = view.state.selection.main;
        const target = misspeltAt(view, sel.from + 1 <= sel.to ? sel.from + 1 : sel.from, options.spell);
        const wholeWord = !!target && target.from === sel.from && target.to === sel.to;
        const syn = wholeWord ? null : synonymsAt(view, sel.from + 1 <= sel.to ? sel.from + 1 : sel.from, options.thesaurus);
        const synWhole = !!syn && syn.from === sel.from && syn.to === sel.to;
        showFormatMenu(view, 0, 0, wholeWord && target && options.spell ? { target, host: options.spell } : undefined, synWhole ? syn : undefined, { dock: true });
      }, 350);
    }),
    // keep the line being edited above the docked menu
    EditorView.scrollMargins.of(() => (open?.dock ? { bottom: open.el.offsetHeight } : null)),
  ];
}
