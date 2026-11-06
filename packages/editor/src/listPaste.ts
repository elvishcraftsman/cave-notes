import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { formatMarker, parseMarker } from './listMarkers';

/**
 * Pasting into a list takes on the list. Text copied with its Markdown marker (`- item`, `1. item`, `> quote`,
 * `# Heading`, `- [ ] task`) and pasted into a bulleted, numbered or task list item loses that first marker, so it becomes
 * the item's text instead of a second marker after the item's own. When several list lines are pasted, the others take
 * the kind of list they land in (bullets, numbers or tasks), keeping their nesting. Anywhere else (a paragraph, a block
 * quote, a heading, code) text is pasted as it is, so a list pasted into a block quote stays a list.
 */

/** a list item's line, up to where its text starts: indent, marker, and checkbox */
const ITEM_LINE = /^(\s*)((?:[-*+]|\d+[.)]|[A-Za-z]{1,8}[.)]))\s+(\[[ xX]\]\s+)?/;
/** the same for pasted text, where only bullets and numbers count as list markers (`A. Smith` is a sentence) */
const PASTED_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
/** a pasted line that is an item of any kind: bullets, numbers, letters and Roman numerals (these only in a pasted list, see below) */
const ANY_ITEM = /^(\s*)([-*+]|\d+[.)]|[A-Za-z]{1,8}[.)])\s+(\[[ xX]\]\s+)?/;
/** the marker of other blocks at the start of pasted text: a block quote or a heading */
const PASTED_BLOCK = /^(\s*)(?:>+\s?|#{1,6}\s+)/;

const inCode = (state: EditorState, pos: number): boolean => {
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent as typeof n) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
    if (!n.parent) break;
  }
  return false;
};

/** The pasted text as it should go into the list item at the cursor; the text itself when it should not change. */
export function listPasteText(state: EditorState, text: string): string {
  if (state.selection.ranges.length !== 1) return text;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  const target = ITEM_LINE.exec(line.text);
  // the cursor has to be in the item's text (after its marker)
  if (!target || sel.from < line.from + target[0].length || inCode(state, sel.from)) return text;
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  // `A. Smith went home` is a sentence; but a first line with a lettered or Roman marker that has list lines after it is a list
  const firstAny = ANY_ITEM.exec(first);
  const listy = !!firstAny && /^[A-Za-z]/.test(firstAny[2]!) && lines.slice(1).some((l) => ANY_ITEM.test(l));
  const asItem = PASTED_ITEM.exec(first) ?? (listy ? firstAny : null);
  const asBlock = asItem ? null : PASTED_BLOCK.exec(first);
  if (!asItem && !asBlock) return text;
  const out = [first.slice((asItem ?? asBlock)![0].length)];

  // the kind of list it lands in: what the other pasted items should become
  const targetIndent = target[1]!;
  const marker = target[2]!;
  const task = target[3] !== undefined;
  const ordered = /^[\dA-Za-z]/.test(marker);
  const delim = ordered ? marker.slice(-1) : '';
  const tmk = ordered ? parseMarker(marker) : null;
  let n = tmk ? tmk.value : 0;
  const baseIndent = (asItem ? asItem[1]! : '').length;
  // a numbered item pasted into a numbered item: what is under it keeps its markers and its levels, and moves by the difference
  // in the width of the two first markers (the text of "II. " starts further in than that of "I. ")
  const srcOrdered = !!asItem && /^[\dA-Za-z]/.test(asItem[2]!);
  const shift = ordered && srcOrdered ? marker.length + 1 - (asItem![0].length - asItem![1]!.length - (asItem![3]?.length ?? 0)) : 0;
  for (const l of lines.slice(1)) {
    const m = (asItem && (srcOrdered || listy) ? ANY_ITEM : PASTED_ITEM).exec(l);
    if (!m) {
      // a continuation line of an item moves with the items
      out.push(shift !== 0 && /^\s+\S/.test(l) ? ' '.repeat(Math.max(0, /^\s*/.exec(l)![0].length + shift)) + l.trimStart() : l);
      continue;
    }
    const rel = Math.max(0, m[1]!.length - baseIndent);
    const own = /^[\dA-Za-z]/.test(m[2]!);
    if (ordered && own && srcOrdered && rel > 0) {
      // a lower level of a pasted numbered list keeps its own marker
      out.push(`${' '.repeat(Math.max(0, targetIndent.length + rel + shift))}${m[2]} ${task ? '[ ] ' : ''}${l.slice(m[0].length)}`);
      continue;
    }
    const indent = targetIndent + ' '.repeat(rel);
    // only items of the same level as the one pasted get numbered along; deeper ones are bulleted or numbered from 1
    const mark = ordered ? (tmk && rel === 0 ? formatMarker(tmk.kind, tmk.upper, ++n, tmk.delim) : `1${delim}`) : marker.length === 1 ? marker : '-';
    out.push(`${indent}${mark} ${task ? '[ ] ' : ''}${l.slice(m[0].length)}`);
  }
  return out.join('\n');
}

export function listPaste(): Extension {
  return EditorView.clipboardInputFilter.of((text, state) => listPasteText(state, text));
}
