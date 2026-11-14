/**
 * CriticMarkup highlights and comments in the editor:
 *
 *   {==highlighted text==}            a highlight
 *   {==highlighted text==}{>>why<<}   a highlight with a comment (the comment follows the highlight directly)
 *   {>>a comment<<}                   a comment on a point in the text
 *
 * Away from the cursor the braces are hidden: a highlight is shown with a background and a comment as a small speech bubble
 * that shows its text on hover. With the cursor in one, the whole thing shows as it is written, to edit. The sidebar lists
 * them (`annotationsOf`), and the comment button of the selection menu adds one, or takes the one at the cursor away.
 */
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, RangeSetBuilder, StateField, type Transaction } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view';

export interface Annotation {
  /** the whole thing, from `{==` or `{>>` to the end */
  from: number;
  to: number;
  /** the highlighted text (empty for a comment on its own) */
  text: string;
  hlFrom: number;
  hlTo: number;
  /** the comment (null for a highlight without one) */
  comment: string | null;
  cFrom: number;
  cTo: number;
  /** 1-based line of the start */
  line: number;
}

const BODY = String.raw`((?:(?!\n[ \t]*\n)[\s\S])*?)`;
const RE = new RegExp(String.raw`\{==${BODY}==\}(?:\{>>${BODY}<<\})?|\{>>${BODY}<<\}`, 'g');

const inCode = (state: EditorState, pos: number): boolean => {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (/Code|Frontmatter|Comment|HTMLBlock/.test(n.name)) return true;
  }
  return false;
};

/** The highlights and comments of a document, in order (not those in code, the front matter or an HTML comment). */
export function annotationsOf(state: EditorState): Annotation[] {
  const doc = state.doc;
  if (doc.length > 2_000_000) return [];
  const text = doc.toString();
  if (!text.includes('{==') && !text.includes('{>>')) return [];
  const out: Annotation[] = [];
  RE.lastIndex = 0;
  for (let m = RE.exec(text); m; m = RE.exec(text)) {
    if (inCode(state, m.index)) continue;
    const from = m.index;
    const to = from + m[0].length;
    if (m[1] !== undefined) {
      const hlFrom = from + 3;
      const hlTo = hlFrom + m[1].length;
      const hasComment = m[2] !== undefined;
      out.push({ from, to, text: m[1], hlFrom, hlTo, comment: hasComment ? m[2]! : null, cFrom: hasComment ? hlTo + 6 : hlTo + 3, cTo: hasComment ? hlTo + 6 + m[2]!.length : hlTo + 3, line: doc.lineAt(from).number });
    } else {
      const cFrom = from + 3;
      out.push({ from, to, text: '', hlFrom: from, hlTo: from, comment: m[3]!, cFrom, cTo: cFrom + m[3]!.length, line: doc.lineAt(from).number });
    }
  }
  return out;
}

/** The annotation the cursor is in or touching, if any. */
export function annotationAt(state: EditorState, pos: number = state.selection.main.head): Annotation | null {
  return annotationsOf(state).find((a) => pos >= a.from && pos <= a.to) ?? null;
}

class Bubble extends WidgetType {
  constructor(readonly comment: string, readonly from: number, readonly to: number) {
    super();
  }
  override eq(o: Bubble): boolean {
    return o.comment === this.comment && o.from === this.from && o.to === this.to;
  }
  override toDOM(view: EditorView): HTMLElement {
    const b = document.createElement('span');
    b.className = 'cm-critic-bubble';
    b.title = this.comment || 'Comment';
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', `Comment: ${this.comment}`);
    b.textContent = '💬';
    // a click puts the cursor in the comment, which shows it as written
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.to - 3 }, scrollIntoView: true });
      view.focus();
    });
    return b;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const hide = Decoration.replace({});
const hlMark = Decoration.mark({ class: 'cm-critic-hl' });
const rawMark = Decoration.mark({ class: 'cm-critic-raw' });
const rawComment = Decoration.mark({ class: 'cm-critic-comment-src' });

function build(state: EditorState): DecorationSet {
  const list = annotationsOf(state);
  if (list.length === 0) return Decoration.none;
  const sel = state.selection.main;
  const b = new RangeSetBuilder<Decoration>();
  for (const a of list) {
    const active = sel.from <= a.to && sel.to >= a.from;
    const hasHl = a.hlTo > a.hlFrom || a.text !== '' || state.sliceDoc(a.from, a.from + 3) === '{==';
    if (hasHl && state.sliceDoc(a.from, a.from + 3) === '{==') {
      if (active) b.add(a.from, a.from + 3, rawMark);
      else b.add(a.from, a.from + 3, hide);
      if (a.hlTo > a.hlFrom) b.add(a.hlFrom, a.hlTo, hlMark);
      if (active) b.add(a.hlTo, a.hlTo + 3, rawMark);
      else b.add(a.hlTo, a.hlTo + 3, hide);
    }
    if (a.comment !== null) {
      const start = a.cFrom - 3;
      if (active) {
        b.add(start, a.cFrom, rawMark);
        if (a.cTo > a.cFrom) b.add(a.cFrom, a.cTo, rawComment);
        b.add(a.cTo, a.to, rawMark);
      } else b.add(start, a.to, Decoration.replace({ widget: new Bubble(a.comment, start, a.to) }));
    }
  }
  return b.finish();
}

const field = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (deco, tr: Transaction) => (tr.docChanged || tr.selection ? build(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

/** Add a comment: on the selected text (it becomes a highlight with the comment after it), or at the cursor. The cursor goes into the comment. */
export function insertComment(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const open = text ? `{==${text}==}{>>` : '{>>';
  view.dispatch({
    changes: { from, to, insert: `${open}<<}` },
    selection: { anchor: from + open.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

/** Take an annotation away: a highlight goes back to plain text; a comment on its own is deleted. */
export function removeAnnotation(view: EditorView, a: Annotation): boolean {
  view.dispatch({ changes: { from: a.from, to: a.to, insert: a.text }, userEvent: 'delete' });
  return true;
}

/** The comment button: removes the highlight and comment at the cursor, or adds one. */
export function toggleComment(view: EditorView): boolean {
  const a = annotationAt(view.state);
  if (a) return removeAnnotation(view, a);
  return insertComment(view);
}

export function criticMarkup(): Extension {
  return [
    field,
    keymap.of([{ key: 'Mod-Alt-m', run: toggleComment }]),
    EditorView.baseTheme({
      '.cm-critic-hl': { backgroundColor: 'rgba(255, 214, 0, 0.35)', borderRadius: '2px' },
      '.cm-critic-raw': { opacity: '0.55', fontFamily: 'var(--code-font, monospace)' },
      '.cm-critic-comment-src': { backgroundColor: 'rgba(120, 160, 255, 0.18)', borderRadius: '2px', fontStyle: 'italic' },
      '.cm-critic-bubble': { cursor: 'pointer', fontSize: '0.8em', verticalAlign: 'super', lineHeight: '0', margin: '0 1px', userSelect: 'none' },
    }),
  ];
}
