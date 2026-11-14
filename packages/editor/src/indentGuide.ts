/**
 * A small line at the left edge of the text, shown only on the line the cursor is on, and only when that line is not a list
 * item and starts with white space: it shows how much white space there is. (It used to be a faint line down the whole page.)
 */
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** A list marker at the start of a line (after any quote marks): a bullet, a number, a letter or Roman numeral, a task box. */
const LIST_START = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)]|[A-Za-z]{1,6}[.)])(?:[ \t]|$)/;

/** Whether the guide shows for this text of a line. */
export function wantsIndentGuide(text: string): boolean {
  return /^[ \t]+\S/.test(text) && !LIST_START.test(text);
}

const mark = Decoration.line({ class: 'cm-indent-guide' });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  if (wantsIndentGuide(line.text)) b.add(line.from, line.from, mark);
  return b.finish();
}

export function indentGuide(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate): void {
          if (u.docChanged || u.selectionSet) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.baseTheme({
      // a hairline just left of the text, as tall as the line
      '.cm-indent-guide': { boxShadow: '-2px 0 0 0 color-mix(in srgb, var(--view-fg, currentColor) 40%, transparent)' },
    }),
  ];
}
