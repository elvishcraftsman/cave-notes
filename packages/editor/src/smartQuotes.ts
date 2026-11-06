import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { type ChangeSpec, EditorSelection, type EditorState, type Extension, Prec, Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * Smart quotes: typing " or ' writes a curly quote. Undo straight afterwards turns it back into the plain
 * character the key actually types (a second undo then removes it).
 *
 * How the undo works: the straight character is inserted first, and a second transaction, kept as an undo step of
 * its own (isolateHistory), swaps it for the curly one. Undoing that step is exactly "back to straight".
 *
 * Pairing: a double quote typed where text is not touching it (empty line, after a space, before a space or the end
 * of the line) writes a matching pair with the cursor between; typing the closing quote
 * then steps over the one that is already there. Typed against text, or as a single quote (which is mostly an
 * apostrophe), only the one character is written.
 *
 * Left alone (the key types the plain character, as it did before): code, frontmatter, HTML, link destinations
 * and titles, and the inside of [[wikilinks]].
 */

export const LEFT_DOUBLE = '\u201C';
export const RIGHT_DOUBLE = '\u201D';
export const LEFT_SINGLE = '\u2018';
export const RIGHT_SINGLE = '\u2019';

const BLOCKS = new Set(['FencedCode', 'CodeBlock', 'Frontmatter', 'HTMLBlock', 'CommentBlock']);
const INLINES = new Set(['InlineCode', 'HTMLTag', 'URL', 'Autolink', 'LinkReference']);
/** characters a quote can open after (besides the start of the line) */
const OPENERS = /[\s([{<\u2014\u2013\u201C\u2018]/;
/** the only characters an opening double quote may sit in front of and still get its closing partner (white space, or the end of the line) */
const PAIR_BEFORE = /\s/;

export function plainContext(state: EditorState, pos: number, before: string): boolean {
  const tree = syntaxTree(state);
  for (let n: SyntaxNode | null = tree.resolveInner(pos, -1); n; n = n.parent) if (BLOCKS.has(n.name)) return true;
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 0); n; n = n.parent) if (INLINES.has(n.name)) return true;
  if (/\[\[[^\]\n]*$/.test(before)) return true; // inside a wikilink
  if (/\]\([^)\n]*$/.test(before)) return true; // inside a link's (destination "title")
  if (/<[A-Za-z/!][^>\n]*$/.test(before)) return true; // inside an HTML tag or autolink
  return false;
}

/** Whether a quote typed after `before` opens a quotation (as opposed to closing one or being an apostrophe). */
function opens(before: string): boolean {
  let i = before.length;
  while (i > 0 && /[*_~]/.test(before[i - 1] as string)) i--; // emphasis marks do not count: *"hi"* opens after the *
  return i === 0 || OPENERS.test(before[i - 1] as string);
}

const typed = (changes: ChangeSpec, selection: EditorSelection): TransactionSpec => ({ changes, selection, userEvent: 'input.type', scrollIntoView: true });
const swapped = (changes: ChangeSpec, selection: EditorSelection): TransactionSpec => ({
  changes,
  selection,
  userEvent: 'input.type',
  scrollIntoView: true,
  annotations: isolateHistory.of('full'),
});

/**
 * The transactions (to dispatch one after the other) that typing `ch` should make, or null to leave the key to the
 * editor's ordinary handling.
 */
export function smartQuoteSpecs(state: EditorState, ch: '"' | "'"): TransactionSpec[] | null {
  if (state.selection.ranges.length !== 1) return null;
  const main = state.selection.main;
  const doc = state.doc;
  const line = doc.lineAt(main.from);
  const before = doc.sliceString(line.from, main.from);
  if (plainContext(state, main.from, before)) return null;
  const [open, close] = ch === '"' ? [LEFT_DOUBLE, RIGHT_DOUBLE] : [LEFT_SINGLE, RIGHT_SINGLE];

  // text selected: put the quotes around it
  if (!main.empty) {
    const a = main.from;
    const b = main.to;
    const sel = main.anchor < main.head ? EditorSelection.single(a + 1, b + 1) : EditorSelection.single(b + 1, a + 1);
    return [typed([{ from: a, insert: ch }, { from: b, insert: ch }], sel), swapped([{ from: a, to: a + 1, insert: open }, { from: b + 1, to: b + 2, insert: close }], sel)];
  }

  const p = main.from;
  const after = doc.sliceString(p, Math.min(line.to, p + 1));
  const prev = before.slice(-1);
  const isOpening = opens(before);

  // the closing quote of a pair is already there: step over it
  if (ch === '"' && after === RIGHT_DOUBLE && (prev === LEFT_DOUBLE || !isOpening)) {
    return [{ selection: EditorSelection.single(p + 1), scrollIntoView: true, userEvent: 'select' }];
  }

  const at = EditorSelection.single(p + 1);
  if (ch === '"' && isOpening && (after === '' || PAIR_BEFORE.test(after))) {
    return [typed({ from: p, insert: '""' }, at), swapped([{ from: p, to: p + 1, insert: open }, { from: p + 1, to: p + 2, insert: close }], at)];
  }
  return [typed({ from: p, insert: ch }, at), swapped({ from: p, to: p + 1, insert: isOpening ? open : close }, at)];
}

/**
 * A phone keyboard's autocorrect (it's for its) puts the whole word in at once, through the keyboard's composition, so the
 * quote key handler above never sees the apostrophe. This finds the straight apostrophes between two letters in the word just
 * before the cursor (ignoring one trailing space) and returns the transaction that makes them curly, or null when there are none.
 */
export function curlyApostrophesBefore(state: EditorState): TransactionSpec | null {
  const main = state.selection.main;
  if (state.selection.ranges.length !== 1 || !main.empty) return null;
  const line = state.doc.lineAt(main.from);
  const before = state.doc.sliceString(line.from, main.from);
  const trimmed = before.replace(/\s$/, '');
  const word = /[\p{L}\p{N}'\u2019]+$/u.exec(trimmed);
  if (!word) return null;
  const changes: ChangeSpec[] = [];
  for (let i = 1; i < word[0].length - 1; i++) {
    if (word[0][i] !== "'" || !/\p{L}/u.test(word[0][i - 1] as string) || !/\p{L}/u.test(word[0][i + 1] as string)) continue;
    const at = line.from + word.index + i;
    if (!plainContext(state, at, state.doc.sliceString(line.from, at))) changes.push({ from: at, to: at + 1, insert: RIGHT_SINGLE });
  }
  if (changes.length === 0) return null;
  return { changes, userEvent: 'input.type', annotations: isolateHistory.of('full') };
}

/** After input that may have come from the keyboard's autocorrect, tidy the apostrophes of the word just typed. */
function composedApostrophes(): Extension {
  const pending = new WeakSet<EditorView>();
  const schedule = (view: EditorView): void => {
    if (pending.has(view)) return;
    pending.add(view);
    setTimeout(() => {
      pending.delete(view);
      if (view.composing || view.state.readOnly) return;
      const spec = curlyApostrophesBefore(view.state);
      if (spec) view.dispatch(spec);
    }, 0);
  };
  return [
    EditorView.updateListener.of((u) => {
      if (!u.docChanged || u.view.composing) return;
      for (const tr of u.transactions) {
        const ev = tr.annotation(Transaction.userEvent) ?? '';
        if (!/^input(\.type|\.complete|\.compose)*$/.test(ev)) continue; // not paste, drop, undo, or our own other edits
        let inserted = false;
        tr.changes.iterChanges((_a, _b, _c, _d, text) => {
          if (text.length > 0 && text.sliceString(0).includes("'")) inserted = true;
        });
        if (inserted) schedule(u.view);
      }
    }),
    EditorView.domEventHandlers({
      compositionend: (_e, view) => {
        schedule(view);
        return false;
      },
    }),
  ];
}

/** The extension: handles " and ' as they are typed, ahead of the bracket auto-closer. */
export function smartQuotes(): Extension {
  return [
    Prec.high(
      EditorView.inputHandler.of((view, from, to, text) => {
        if ((text !== '"' && text !== "'") || view.composing) return false;
        const main = view.state.selection.main;
        if (from !== main.from || to !== main.to) return false;
        const specs = smartQuoteSpecs(view.state, text);
        if (!specs) return false;
        for (const spec of specs) view.dispatch(spec);
        return true;
      }),
    ),
    composedApostrophes(),
  ];
}
