import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { plainContext } from './smartQuotes';

/**
 * Accidental double capitals: a word typed as THis (the shift key held a moment too long) becomes This when the word ends
 * (a space or a punctuation mark is typed after it). Only a word of two capitals followed by small letters is changed, and
 *
 *  - not when the small letters are just an "s" (HIs, PCs, IDs, URLs ... may be abbreviations in the plural),
 *  - not the units MHz, GHz, MPa, kPa and the like,
 *  - not in code, links, addresses, frontmatter or inside [[wikilinks]],
 *  - not when something that belongs to a name or address is stuck to the word (a letter, digit, _ . / @ # - before it).
 *
 * The correction is a step of its own, so Undo straight afterwards brings back what was typed.
 */

const WORD_END = /^[\s.,;:!?)\]}"\u201D\u2019\u2026]$/;
const UNIT = /^[MGTPEZY](?:Hz|Pa|Bq|Gy|Sv|Wb)$/;

/** The corrected word, or null when the word is left as it is. */
export function fixedCapitals(word: string): string | null {
  const m = /^([A-Z])([A-Z])([a-z]+)$/.exec(word);
  if (!m) return null;
  if (m[3] === 's') return null;
  if (UNIT.test(word)) return null;
  return m[1]! + m[2]!.toLowerCase() + m[3]!;
}

export function fixDoubleCapitals(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (view.composing || from !== to || !WORD_END.test(text)) return false;
      const { state } = view;
      const main = state.selection.main;
      if (state.selection.ranges.length !== 1 || !main.empty || main.from !== from) return false;
      const line = state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      const m = /([A-Za-z]{3,})$/.exec(before);
      if (!m) return false;
      const word = m[1]!;
      const start = from - word.length;
      const prev = before.length > word.length ? before[before.length - word.length - 1]! : '';
      if (prev && /[\p{L}\p{N}_./@#\-:\\]/u.test(prev)) return false;
      const fixed = fixedCapitals(word);
      if (!fixed) return false;
      if (plainContext(state, from, before)) return false;
      // the typed character goes in first; the correction follows as a step of its own
      view.dispatch({ changes: { from, insert: text }, selection: EditorSelection.single(from + text.length), userEvent: 'input.type', scrollIntoView: true });
      view.dispatch({
        changes: { from: start, to: from, insert: fixed },
        selection: EditorSelection.single(from + text.length),
        userEvent: 'input.type',
        annotations: isolateHistory.of('full'),
      });
      return true;
    }),
  );
}
