import { syntaxTree } from '@codemirror/language';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorSelection, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/**
 * The cursor sits just inside the end of a span written with `marker` (`*italic|*`): the position after the closing marker, or null.
 * (A word processor's Ctrl+I there moves on past the end of the italics; this does the same.)
 */
function closingMarkerEnd(view: EditorView, marker: string): number | null {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length !== 1) return null;
  const pos = sel.head;
  const doc = state.doc;
  const len = marker.length;
  if (doc.sliceString(pos, pos + len) !== marker) return null;
  // the marker that ends the span, not the first half of a longer one (`**bold|**` is not the end of an italic `*`)
  if (marker.length === 1 && doc.sliceString(pos + len, pos + len + 1) === marker) return null;
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (/^(Emphasis|StrongEmphasis|Strikethrough|InlineCode)$/.test(n.name) && n.to === pos + len && n.from < pos && doc.sliceString(n.to - len, n.to) === marker) return pos + len;
    }
  }
  return null;
}

/**
 * Wrap the selection in `marker` (e.g. "**"), or unwrap it if already wrapped. No selection: insert a pair, except at the
 * end of a span written with that marker, where the cursor just moves past the closing marker.
 */
export function toggleWrap(marker: string): (view: EditorView) => boolean {
  return (view) => {
    const { state } = view;
    const past = closingMarkerEnd(view, marker);
    if (past !== null) {
      view.dispatch({ selection: EditorSelection.cursor(past), scrollIntoView: true, userEvent: 'select' });
      return true;
    }
    const tr = state.changeByRange((range) => {
      const doc = state.doc;
      const len = marker.length;
      const before = doc.sliceString(Math.max(0, range.from - len), range.from);
      const after = doc.sliceString(range.to, Math.min(doc.length, range.to + len));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }
      const inner = doc.sliceString(range.from, range.to);
      if (inner.length >= len * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: inner.slice(len, inner.length - len) },
          range: EditorSelection.range(range.from, range.to - len * 2),
        };
      }
      if (range.empty) {
        return { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + len) };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** Turn the selection into a Markdown link and put the cursor in the destination. */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const insert = `[${text}]()`;
    const cursor = range.from + insert.length - 1;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
}

const VIEW_TEMPLATE = 'type: table\nquery: under:$this\n';

/** Insert an empty database view block after the current line (or on it, when it is blank). */
export const insertViewBlock = (view: import('@codemirror/view').EditorView, template: string = VIEW_TEMPLATE): boolean => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const block = '```view\n' + template + '```\n';
  if (line.text.trim() === '') {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: block }, selection: { anchor: line.from + block.length }, scrollIntoView: true });
  } else {
    view.dispatch({ changes: { from: line.to, insert: '\n\n' + block }, selection: { anchor: line.to + 2 + block.length }, scrollIntoView: true });
  }
  return true;
};

/**
 * Typing the third backtick of an opening code fence (alone at the start of a line) adds the closing
 * fence on the next line and leaves the cursor after the opening one, ready for a language name.
 */
export function fenceAutoClose(): Extension {
  return Prec.highest(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== '`' || from !== to) return false;
      const { state } = view;
      const line = state.doc.lineAt(from);
      if (from !== line.to) return false;
      const m = /^( {0,3})``$/.exec(line.text);
      if (!m) return false;
      // already inside a fenced block (typing a closing fence), or a fence follows: leave it alone
      for (let n = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent as typeof n) {
        if (n.name === 'FencedCode') return false;
        if (!n.parent) break;
      }
      if (line.number < state.doc.lines && /^\s*(```|~~~)/.test(state.doc.line(line.number + 1).text)) return false;
      // text on the very next line (nothing but one line break between): the fence is going around it, so do not add a closing one
      if (line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim() !== '') return false;
      view.dispatch({
        changes: { from, to, insert: `\`\n${m[1]}\`\`\`` },
        selection: { anchor: from + 1 },
        scrollIntoView: true,
        userEvent: 'input.type',
      });
      return true;
    }),
  );
}

/**
 * Typing an opening character ( [ { ` ' " writes its closing partner only where the text around the cursor is white space (or
 * the start or end of the text). Next to other text just the typed character is written: `(` typed before a word is a lone `(`.
 */
export function pairOnlyBesideSpace(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (!/^[([{`'"]$/.test(text) || from !== to || view.composing) return false;
      const { state } = view;
      if (state.selection.ranges.length !== 1 || state.selection.main.from !== from || !state.selection.main.empty) return false;
      const next = state.doc.sliceString(from, from + 1);
      const prev = from > 0 ? state.doc.sliceString(from - 1, from) : '';
      // stepping over a closing character that is already there is the bracket handler's job
      if (next === text && /[`'"]/.test(text)) return false;
      const spaceNext = next === '' || /\s/.test(next);
      // the characters that open and close with themselves need space before them too (a lone ` after a word ends a code span)
      const spacePrev = prev === '' || /\s/.test(prev);
      if (spaceNext && (spacePrev || /[([{]/.test(text))) return false;
      view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, scrollIntoView: true, userEvent: 'input.type' });
      return true;
    }),
  );
}

const BARE_MARKER = /^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/;

/**
 * Enter at the very start of a list item's text pushes the item down and leaves a new empty item above it.
 * The stock Markdown command trims the new item to a bare marker ("-" with nothing after it), which is no
 * longer a list item you can type into. This keeps the space after the marker.
 */
export function listEnterKeepsSpace(): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          const { state } = view;
          const sel = state.selection.main;
          const line = state.doc.lineAt(sel.head);
          const atItemStart = sel.empty && BARE_MARKER.test(line.text.slice(0, sel.head - line.from)) && sel.head < line.to && line.text.slice(sel.head - line.from).trim() !== '';
          if (!atItemStart || line.text.slice(0, sel.head - line.from).trim() === '') return false;
          if (!insertNewlineContinueMarkup(view)) return false;
          // the line that was just left behind: put back the space after its marker
          const now = view.state;
          const prev = now.doc.lineAt(now.selection.main.head).number - 1;
          if (prev >= 1) {
            const pl = now.doc.line(prev);
            if (BARE_MARKER.test(pl.text) && !/\s$/.test(pl.text)) view.dispatch({ changes: { from: pl.to, insert: ' ' } });
          }
          return true;
        },
      },
    ]),
  );
}
