import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { plainContext } from './smartQuotes';

/**
 * Dashes: typing "--" writes an en dash (–) and a third hyphen turns that into an em dash (—).
 * Undo straight afterwards gives the hyphens back, the same way smart quotes do.
 *
 * Left alone: code, frontmatter, HTML, link destinations (see plainContext), table rows, and a dash that starts
 * a line (a "---" there is a horizontal rule or the frontmatter fence, and "--" can underline a heading).
 */

export const EN_DASH = '\u2013';
export const EM_DASH = '\u2014';

const inTable = (state: EditorState, pos: number, lineText: string): boolean => {
  if (/^\s*\|/.test(lineText)) return true;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'Table') return true;
  return false;
};

/**
 * What typing "-" at `pos` (cursor, nothing selected) should do: 'en' replaces the hyphen before the cursor and the
 * new one with an en dash, 'em' replaces the en dash before the cursor and the new hyphen with an em dash, null
 * leaves the key alone.
 */
export function dashAction(state: EditorState, pos: number): 'en' | 'em' | null {
  const line = state.doc.lineAt(pos);
  const before = state.doc.sliceString(line.from, pos);
  if (before.length === 0) return null;
  const prev = before.slice(-1);
  if (prev !== '-' && prev !== EN_DASH) return null;
  // a line made of dashes so far (rule, setext underline, list marker plus dash) is Markdown, not typography
  const lead = before.replace(/^[ \t>]*/, '');
  if (/^[-–]+$/.test(lead)) return null;
  if (inTable(state, pos, line.text)) return null;
  if (plainContext(state, pos, before)) return null;
  if (prev === EN_DASH) return 'em';
  // "--": make sure the hyphen before the cursor is not the end of a longer run we should leave alone (e.g. "----")
  if (before.length >= 2 && before.slice(-2, -1) === '-') return null;
  return 'en';
}

export function dashes(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== '-' || view.composing) return false;
      const main = view.state.selection.main;
      if (from !== main.from || to !== main.to || !main.empty) return false;
      if (view.state.selection.ranges.length !== 1) return false;
      const action = dashAction(view.state, main.from);
      if (!action) return false;
      const p = main.from;
      const at = EditorSelection.single(p + 1);
      // the plain hyphen goes in first, then a step of its own swaps it (and the one before) for the dash
      view.dispatch({ changes: { from: p, insert: '-' }, selection: at, userEvent: 'input.type', scrollIntoView: true });
      const dash = action === 'en' ? EN_DASH : EM_DASH;
      view.dispatch({
        changes: { from: p - 1, to: p + 1, insert: dash },
        selection: EditorSelection.single(p),
        userEvent: 'input.type',
        scrollIntoView: true,
        annotations: isolateHistory.of('full'),
      });
      return true;
    }),
  );
}
