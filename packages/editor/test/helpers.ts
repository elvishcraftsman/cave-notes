import { EditorSelection, EditorState } from '@codemirror/state';
import { computeDecorations, markdownSupport, type LivePreviewOptions } from '../src/index';

export interface Described {
  hidden: string[];
  marks: string[];
  lines: string[];
  widgets: string[];
  state: EditorState;
}

/** `‸` in the text marks the cursor (removed from the document). */
export function describe(textWithCursor: string, options: LivePreviewOptions = {}): Described {
  const cursor = textWithCursor.indexOf('‸');
  const doc = cursor < 0 ? textWithCursor : textWithCursor.replace('‸', '');
  const state = EditorState.create({
    doc,
    selection: cursor < 0 ? EditorSelection.cursor(doc.length) : EditorSelection.cursor(cursor),
    extensions: [markdownSupport()],
  });
  const set = computeDecorations(state, [{ from: 0, to: doc.length }], options);
  const out: Described = { hidden: [], marks: [], lines: [], widgets: [], state };
  set.between(0, doc.length, (from, to, value) => {
    const kind = value.constructor.name;
    const cls = (value.spec as { class?: string }).class;
    const widget = (value.spec as { widget?: object }).widget;
    if (kind === 'LineDecoration') out.lines.push(`${state.doc.lineAt(from).number}:${cls}`);
    else if (kind === 'MarkDecoration') out.marks.push(`${cls}:${doc.slice(from, to)}`);
    else if (widget) out.widgets.push(`${widget.constructor.name}:${doc.slice(from, to)}`);
    else out.hidden.push(doc.slice(from, to));
  });
  return out;
}
