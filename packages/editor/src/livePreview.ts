import { FootnoteDefWidget, FootnoteRefWidget, footnoteDisplay, footnoteScanOf } from './footnotes';
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, Facet, StateEffect, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { blockWidgets } from './blocks';
import { tableCopy } from './tables';
import { isHierarchical, listConfig, listDepth, rootListOf } from './lists';

/**
 * Live preview: Markdown syntax is hidden except where the cursor is. Block markers (heading
 * hashes, quote bars, list bullets) are revealed for the line being edited; inline syntax
 * (emphasis, code, links, wikilinks) is revealed while the selection touches that construct.
 */

export type LinkStatus = 'ok' | 'broken' | 'ambiguous' | 'unknown';

export interface LivePreviewOptions {
  /** Status of a wikilink by its written target (e.g. "Grace#Sub"), to style broken links. */
  linkStatus?: (raw: string) => LinkStatus;
  /** Turn an image path from the note into a loadable URL, or null to show the alt text instead. */
  resolveAsset?: (href: string) => string | null;
}

/**
 * True in the state of a page shown fully rendered, as in the built-in documentation: no syntax is ever revealed
 * (not at the cursor, not in focus), and the lines of fenced blocks that hold only the ``` marks are hidden.
 */
export const fullRender = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

/** Re-run decorations after external data (link statuses) changed. */
export const refreshPreview = StateEffect.define<null>();

const WIKILINK = /(!?)\[\[([^[\]\n]+)\]\]/g;
/** `automation:rule-id`: the destination of a button that runs an automation rule (letters, digits and - _ . as in a rule's id) */
export const AUTOMATION_LINK = /^automation:\s*([A-Za-z0-9][\w.-]{0,63})\s*$/i;
/** width in em of the marker column of a bullet item: numbered items get the same room unless their marker is longer */
const MARKER_WIDTH = 1.4;
const HIDDEN_FOR_WIKILINKS = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'Frontmatter', 'HTMLBlock', 'CommentBlock', 'HTMLTag']);

// ---------------------------------------------------------------- widgets

class BulletWidget extends WidgetType {
  constructor(readonly glyph = '\u2022') {
    super();
  }
  override eq(other: BulletWidget): boolean {
    return other.glyph === this.glyph;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-bullet';
    el.textContent = this.glyph;
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-checkbox';
    box.setAttribute('aria-label', this.checked ? 'Completed' : 'Not completed');
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const from = this.pos;
      const current = view.state.doc.sliceString(from, from + 3);
      if (!/^\[[ xX]\]$/.test(current)) return;
      view.dispatch({ changes: { from: from + 1, to: from + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  override toDOM(): HTMLElement {
    // The widget's own root element must never be swapped: the editor would read the swap as typing and write the
    // replacement text ("🖼 name") into the page in place of the image link. Only what is inside the wrapper changes.
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-wrap';
    const img = document.createElement('img');
    img.className = 'cm-image';
    img.src = this.src;
    img.alt = this.alt;
    img.draggable = false;
    img.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'cm-image-missing';
      fallback.textContent = this.alt ? `🖼 ${this.alt}` : '🖼 image not found';
      img.replaceWith(fallback);
    });
    wrap.append(img);
    return wrap;
  }
}

const HIDE = Decoration.replace({});
const line = (cls: string): Decoration => Decoration.line({ class: cls });
const mark = (cls: string, attributes?: Record<string, string>): Decoration =>
  Decoration.mark({ class: cls, ...(attributes ? { attributes } : {}) });

// ---------------------------------------------------------------- the computation

/** Decorations for the given document ranges. Pure: used by the plugin and by tests. */
export function computeDecorations(
  state: EditorState,
  ranges: ReadonlyArray<{ from: number; to: number }>,
  options: LivePreviewOptions = {},
  /** false while the editor is not focused: nothing is "being edited", so all syntax stays hidden */
  reveal = true,
): DecorationSet {
  const out: Array<Range<Decoration>> = [];
  const doc = state.doc;
  const sel = state.selection.ranges;
  const full = state.facet(fullRender);
  if (full) reveal = false;

  // A bulleted list that follows the hierarchy draws a different bullet at each level (decided once per list tree).
  const hierarchical = new Map<number, boolean>();
  const bulletGlyph = (item: SyntaxNode): string => {
    const list = item.parent;
    const root = list ? rootListOf(list) : null;
    if (!list || !root) return '\u2022';
    let hier = hierarchical.get(root.from);
    if (hier === undefined) {
      hier = isHierarchical(state, root);
      hierarchical.set(root.from, hier);
    }
    if (!hier) return '\u2022';
    const glyphs = state.facet(listConfig).bulletGlyphs;
    return glyphs[listDepth(list) % glyphs.length] ?? '\u2022';
  };

  const touches = (from: number, to: number): boolean => reveal && sel.some((r) => r.from <= to && r.to >= from);
  const activeLine = (pos: number): boolean => {
    if (!reveal) return false;
    const n = doc.lineAt(pos).number;
    return sel.some((r) => doc.lineAt(r.from).number <= n && doc.lineAt(r.to).number >= n);
  };
  const add = (d: Decoration, from: number, to?: number): void => {
    out.push(to === undefined ? d.range(from) : d.range(from, to));
  };
  const hide = (from: number, to: number): void => {
    if (to > from) add(HIDE, from, to);
  };
  const lines = (from: number, to: number, cls: string): void => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(Math.max(from, to - 1)).number; n++) {
      add(line(cls), doc.line(n).from);
    }
  };

  const tree = syntaxTree(state);
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const node = ref.node;
        const name = ref.name;
        const { from, to } = ref;

        // ---- headings
        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = name.slice(-1);
          lines(from, to, `cm-heading cm-h${level}`);
          const m = node.getChild('HeaderMark');
          if (m && !activeLine(from)) hide(m.from, Math.min(m.to + 1, doc.lineAt(m.from).to));
          return;
        }
        if (/^SetextHeading[12]$/.test(name)) {
          lines(from, to, `cm-heading cm-h${name.slice(-1)}`);
          return;
        }

        switch (name) {
          case 'Frontmatter':
            lines(from, to, 'cm-frontmatter');
            return false;
          case 'FencedCode':
            lines(from, to, 'cm-codeblock');
            add(line('cm-codeblock-first'), doc.lineAt(from).from);
            add(line('cm-codeblock-last'), doc.lineAt(Math.max(from, to - 1)).from);
            if (full) {
              // the opening line (``` and the language) and the closing line carry nothing to read: hide them
              const open = doc.lineAt(from);
              const marks = node.getChildren('CodeMark');
              add(line('cm-fence-hidden'), open.from);
              hide(open.from, open.to);
              const last = marks.length > 1 ? marks[marks.length - 1] : null;
              if (last && doc.lineAt(last.from).number > open.number) {
                const close = doc.lineAt(last.from);
                add(line('cm-fence-hidden'), close.from);
                hide(close.from, close.to);
              }
              return false;
            }
            for (const m of node.getChildren('CodeMark')) add(mark('cm-fence'), m.from, m.to);
            return false;
          case 'CodeBlock':
            lines(from, to, 'cm-codeblock');
            return false;
          case 'HorizontalRule':
            lines(from, to, 'cm-hr-line');
            if (!activeLine(from)) hide(from, to);
            return false;
          case 'Blockquote':
            lines(from, to, 'cm-quote');
            return;
          case 'QuoteMark':
            if (!activeLine(from)) hide(from, Math.min(to + 1, doc.lineAt(from).to));
            return;
          case 'ListItem':
            decorateListItem(node);
            return;
          case 'ListMark': {
            // Every other state of a marker is covered by the "cm-list-prefix cm-list-mark" box that decorateListItem draws
            // (a second mark over part of the same text would split that box in two, and each half would take the minimum width).
            const parent = node.parent?.parent?.name;
            if (parent === 'BulletList' && !activeLine(from)) {
              // a task item is drawn with its checkbox alone: no bullet in front of it
              if (node.parent?.getChild('Task')) hide(from, to);
              else add(Decoration.replace({ widget: new BulletWidget(bulletGlyph(node.parent!)) }), from, to);
            }
            return;
          }
          case 'TaskMarker': {
            const checked = /\[[xX]\]/.test(doc.sliceString(from, to));
            if (checked) add(line('cm-task-done'), doc.lineAt(from).from);
            if (!activeLine(from)) add(Decoration.replace({ widget: new CheckboxWidget(checked, from) }), from, to);
            return;
          }
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            const cls = { StrongEmphasis: 'cm-strong', Emphasis: 'cm-em', Strikethrough: 'cm-strike', InlineCode: 'cm-inline-code' }[name];
            add(mark(cls as string), from, to);
            if (!touches(from, to)) {
              for (const m of node.getChildren(name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) {
                hide(m.from, m.to);
              }
            }
            return;
          }
          case 'Link': {
            decorateLink(node, touches(from, to));
            return false;
          }
          case 'Image': {
            decorateImage(node, touches(from, to));
            return false;
          }
          case 'Autolink': {
            add(mark(`cm-link${externalClass(doc.sliceString(from, to).replace(/^<|>$/g, ''))}`), from, to);
            if (!touches(from, to)) for (const m of node.getChildren('LinkMark')) hide(m.from, m.to);
            return false;
          }
          case 'URL':
            if (node.parent?.name !== 'Link' && node.parent?.name !== 'Image') add(mark(`cm-link cm-url${externalClass(doc.sliceString(from, to))}`), from, to);
            return;
          case 'LinkReference':
            if (doc.sliceString(from, from + 2) === '[^') return false; // a footnote definition: drawn by footnotes()
            add(mark('cm-link-definition'), from, to);
            return false;
          case 'HTMLBlock':
          case 'HTMLTag':
          case 'CommentBlock':
            add(mark('cm-html'), from, to);
            return false;
          case 'TableDelimiter':
            add(mark('cm-table-delimiter'), from, to);
            return;
          case 'TableHeader':
            add(mark('cm-table-header'), from, to);
            return;
          default:
        }
        return;
      },
    });

    wikilinks(range.from, range.to);
  }

  /**
   * Lists: every nesting level indents by a fixed step, and a wrapped or continued line lines up with
   * the text of the first line (a hanging indent the width of the marker). The raw leading spaces
   * are collapsed to nothing so the indent depends on the depth alone.
   */
  function decorateListItem(node: SyntaxNode): void {
    const markNode = node.getChild('ListMark');
    if (!markNode) return;
    const ordered = node.parent?.name === 'OrderedList';
    const task = node.getChild('Task')?.getChild('TaskMarker') ?? null;
    /** the marker column of an item: as wide as a bullet's, or wider for a long marker ("10.", "viii.") */
    const widthOf = (item: SyntaxNode): number => {
      const m = item.getChild('ListMark');
      let len = m ? m.to - m.from : 1;
      const isOrdered = item.parent?.name === 'OrderedList';
      // the items of a numbered list share the room of the longest marker (I. II. III. IV.), so that their text lines up
      if (isOrdered && item.parent) for (const sib of item.parent.getChildren('ListItem')) {
        const sm = sib.getChild('ListMark');
        if (sm) len = Math.max(len, sm.to - sm.from);
      }
      const t = item.getChild('Task')?.getChild('TaskMarker') ?? null;
      // a task item has its checkbox where other items have their bullet, so an unordered one has no marker column of its own
      return (isOrdered ? Math.max(MARKER_WIDTH, 0.5 * len + 0.4) : t ? 0 : MARKER_WIDTH) + (t ? 1.5 : 0);
    };
    // A nested item starts exactly where the text of the item it is under starts, whatever kind of marker that has.
    let base = 0;
    for (let p = node.parent; p; p = p.parent) if (p.name === 'ListItem') base += widthOf(p);
    const w = widthOf(node);
    const em = (n: number): string => `${Math.round(n * 100) / 100}em`;
    const first = doc.lineAt(markNode.from);
    const nested = node.getChild('BulletList') ?? node.getChild('OrderedList');
    const lastNumber = Math.max(first.number, nested ? doc.lineAt(nested.from).number - 1 : doc.lineAt(Math.max(node.from, node.to - 1)).number);
    for (let n = first.number; n <= lastNumber; n++) {
      const ln = doc.line(n);
      const isFirst = n === first.number;
      const style = `padding-left:${em(base + w)};${isFirst ? `text-indent:-${em(w)}` : ''}`;
      add(Decoration.line({ class: isFirst ? 'cm-li cm-li-first' : 'cm-li', attributes: { style } }), ln.from);
      const lead = /^[ \t]+/.exec(ln.text)?.[0].length ?? 0;
      if (lead > 0) add(mark('cm-list-indent'), ln.from, ln.from + lead);
    }
    // The marker (and the checkbox) get a fixed width, so the text always starts `w` in from the item's own indent.
    const spacesAfter = (pos: number): number => {
      let e = pos;
      while (e < first.to && doc.sliceString(e, e + 1) === ' ') e++;
      return e;
    };
    const wMarker = w - (task ? 1.5 : 0);
    if (activeLine(first.from)) {
      // raw text on the line being edited: one box over "- [ ] " keeps the text where it is
      add(mark('cm-list-prefix cm-list-mark', { style: `min-width:${em(w)}` }), markNode.from, spacesAfter((task ?? markNode).to));
    } else {
      // drawn bullets and checkboxes are as wide as their share of the prefix, so the spaces after them go
      const afterMark = spacesAfter(markNode.to);
      if (ordered) add(mark('cm-list-prefix cm-list-mark', { style: `min-width:${em(wMarker)}` }), markNode.from, afterMark);
      else if (afterMark > markNode.to) hide(markNode.to, afterMark);
      if (task) {
        const afterTask = spacesAfter(task.to);
        if (afterTask > task.to) hide(task.to, afterTask);
      }
    }
  }

  function decorateLink(node: SyntaxNode, editing: boolean): void {
    const marks = node.getChildren('LinkMark');
    const open = marks[0];
    const close = marks[1];
    const url = node.getChild('URL');
    const href = url ? doc.sliceString(url.from, url.to) : '';
    // Without a destination this is "[text]" or "[text][label]": a reference link (resolved by a
    // definition we cannot see here) or just brackets, e.g. the inside of a [[wikilink]]. Leave it alone.
    if (!url || !open || !close) {
      if (node.getChild('LinkLabel') && open && close) add(mark('cm-link'), open.to, close.from);
      return;
    }
    // `[=Label](automation:rule-id)` is a button that runs an automation rule for this page. It is always drawn as a button
    // (the `=` is optional here); one click runs it, and the cursor entering it shows the text
    const label = doc.sliceString(open.to, close.from);
    const rule = AUTOMATION_LINK.exec(href.replace(/^<|>$/g, ''));
    if (rule && !editing) {
      const eqa = /^\s*=\s?/.exec(label);
      hide(open.from, open.to + (eqa ? eqa[0].length : 0));
      add(mark('cm-link cm-wikilink-button cm-automation-button', { 'data-automation': rule[1]!, 'data-wikilink-button': '1', title: `Run the automation “${rule[1]}”` }), open.to + (eqa ? eqa[0].length : 0), close.from);
      hide(close.from, node.to);
      return;
    }
    // `[=Label](page.md)` is drawn as a button, like `[[Page|=Label]]`: one click follows it; the cursor entering it shows the text
    const eq = !editing ? /^\s*=\s?/.exec(label) : null;
    if (eq) {
      hide(open.from, open.to + eq[0].length);
      add(mark('cm-link cm-wikilink-button', { 'data-href': href, 'data-wikilink-button': '1' }), open.to + eq[0].length, close.from);
      hide(close.from, node.to);
      return;
    }
    add(mark(`cm-link${externalClass(href)}`, { 'data-href': href }), open.to, close.from);
    if (editing) {
      add(mark('cm-link-syntax'), open.from, open.to);
      add(mark('cm-link-syntax'), close.from, node.to);
    } else {
      hide(open.from, open.to);
      hide(close.from, node.to);
    }
  }

  function decorateImage(node: SyntaxNode, editing: boolean): void {
    const url = node.getChild('URL');
    if (!url) return; // "![x]" without a destination: a reference, or the inside of ![[an embed]]
    let href = doc.sliceString(url.from, url.to);
    if (href.length > 1 && href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    const marks = node.getChildren('LinkMark');
    const alt = marks[0] && marks[1] ? doc.sliceString(marks[0].to, marks[1].from) : '';
    const src = href && options.resolveAsset ? options.resolveAsset(href) : null;
    const singleLine = doc.lineAt(node.from).number === doc.lineAt(node.to).number;
    if (!editing && src && singleLine) {
      add(Decoration.replace({ widget: new ImageWidget(src, alt) }), node.from, node.to);
    } else if (!editing && singleLine && marks[0] && marks[1]) {
      add(mark('cm-image-alt'), marks[0].to, marks[1].from);
      hide(node.from, marks[0].to);
      hide(marks[1].from, node.to);
    } else {
      add(mark('cm-link-syntax'), node.from, node.to);
    }
  }

  function wikilinks(from: number, to: number): void {
    const start = doc.lineAt(from).from;
    const end = doc.lineAt(to).to;
    const text = doc.sliceString(start, end);
    if (!text.includes('[[')) return;
    WIKILINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK.exec(text)) !== null) {
      const a = start + m.index;
      const b = a + m[0].length;
      if (a > start && text[m.index - 1] === '\\') continue;
      let inCode = false;
      for (let n: SyntaxNode | null = tree.resolveInner(a + 1, 1); n; n = n.parent) {
        if (HIDDEN_FOR_WIKILINKS.has(n.name)) {
          inCode = true;
          break;
        }
      }
      if (inCode) continue;

      const embed = m[1] === '!';
      const inner = m[2] ?? '';
      const innerStart = a + (embed ? 3 : 2);
      const pipe = inner.indexOf('|');
      const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
      // Workspace::Page is a page of another workspace: marked as such, and neither broken nor ambiguous here
      const elsewhere = !embed && /^[^:/\\|#?[\]]+?\s*::\s*\S/.test(target);
      const status = elsewhere ? 'unknown' : options.linkStatus?.(target) ?? 'unknown';
      const cls = `cm-wikilink${elsewhere ? ' cm-wikilink-workspace' : ''}${status === 'broken' ? ' cm-wikilink-broken' : status === 'ambiguous' ? ' cm-wikilink-ambiguous' : ''}`;

      if (touches(a, b)) {
        add(mark(`${cls} cm-wikilink-raw`), a, b);
      } else if (pipe >= 0) {
        // `[[Page|=Label]]` is drawn as a button: one click goes to the page; the cursor entering it shows the text
        const button = /^\s*=/.test(inner.slice(pipe + 1));
        const labelFrom = innerStart + pipe + 1 + (button ? (/^\s*=\s*/.exec(inner.slice(pipe + 1))?.[0].length ?? 0) : 0);
        hide(a, labelFrom);
        add(mark(button ? `${cls} cm-wikilink-button` : cls, button ? { 'data-wikilink': target, 'data-wikilink-button': '1' } : { 'data-wikilink': target }), labelFrom, b - 2);
        hide(b - 2, b);
      } else {
        hide(a, innerStart);
        add(mark(cls, { 'data-wikilink': target }), innerStart, b - 2);
        hide(b - 2, b);
      }
    }
  }

  function footnotes(from: number, to: number): void {
    const scan = footnoteScanOf(doc);
    if (scan.refs.length === 0 && scan.defs.length === 0) return;
    const shown = footnoteDisplay(doc);
    const hasDef = new Set(scan.defs.map((d) => d.label));
    for (const r of scan.refs) {
      if (r.to < from || r.from > to) continue;
      if (touches(r.from, r.to)) add(mark('cm-footnote-raw'), r.from, r.to);
      else add(Decoration.replace({ widget: new FootnoteRefWidget(r.label, shown.ref.get(r.from) ?? '?', hasDef.has(r.label)) }), r.from, r.to);
    }
    const seen = new Set<string>();
    for (const d of scan.defs) {
      if (d.to < from || d.from > to) continue;
      const startLine = doc.lineAt(d.from).number;
      const endLine = doc.lineAt(d.to).number;
      for (let n = startLine; n <= endLine; n++) add(line('cm-footnote-def'), doc.line(n).from);
      const n = shown.def.get(d.label);
      if (n === undefined || seen.has(d.label)) continue; // not in use: stays as it is written
      seen.add(d.label);
      if (activeLine(d.from)) add(mark('cm-footnote-raw'), d.labelFrom - 2, d.bodyFrom);
      else add(Decoration.replace({ widget: new FootnoteDefWidget(d.label, n) }), d.from, d.bodyFrom);
    }
  }

  for (const range of ranges) footnotes(range.from, range.to);

  return Decoration.set(out, true);
}

// ---------------------------------------------------------------- extension

const ATOMIC = Decoration.mark({});

/**
 * The stretch from the start of each bullet item's line to the start of its text: the indent, the "-" and the
 * spaces after it. The cursor treats each as one unit, so there is a single place to stand in front of the text and
 * one arrow press crosses the marker (before, the cursor stopped between the "-" and the space).
 */
export function computeAtomicRanges(state: EditorState, ranges: ReadonlyArray<{ from: number; to: number }>): DecorationSet {
  const out: Array<Range<Decoration>> = [];
  const doc = state.doc;
  const tree = syntaxTree(state);
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        if (ref.name !== 'ListItem' || ref.node.parent?.name !== 'BulletList') return;
        const markNode = ref.node.getChild('ListMark');
        if (!markNode) return;
        const line = doc.lineAt(markNode.from);
        let start = markNode.from;
        while (start > line.from && /[ \t]/.test(doc.sliceString(start - 1, start))) start--;
        let end = markNode.to;
        while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++;
        if (end > start) out.push(ATOMIC.range(start, end));
      },
    });
  }
  return Decoration.set(out, true);
}


/** The mark that goes with a link to somewhere else: another workspace, or the web (each gets its own sign after the text). */
function externalClass(href: string): string {
  if (/^cave:\/\//i.test(href)) return ' cm-link-workspace';
  if (/^(https?:|mailto:|www\.)/i.test(href)) return ' cm-link-web';
  return '';
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = computeDecorations(view.state, view.visibleRanges, options, view.hasFocus);
        this.atomic = computeAtomicRanges(view.state, view.visibleRanges);
      }
      update(u: ViewUpdate): void {
        const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshPreview)));
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || refreshed) {
          this.decorations = computeDecorations(u.view.state, u.view.visibleRanges, options, u.view.hasFocus);
        }
        if (u.docChanged || u.viewportChanged || refreshed) this.atomic = computeAtomicRanges(u.view.state, u.view.visibleRanges);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
    },
  );
  return [plugin, blockWidgets(), tableCopy()];
}
