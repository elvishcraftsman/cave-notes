import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/**
 * Where two computers edited the same words, the page keeps both versions between marker lines:
 *
 *   <<<<<<< conflict: both versions kept
 *   (version A)
 *   =======
 *   (version B)
 *   >>>>>>> end of conflict
 *
 * The editor shows these as two boxes, A and B, that can be edited like the rest of the page, with Keep A, Keep B and
 * Keep Both in the corner. The marker lines stay in the text (so nothing about the file changes) but are drawn as headers.
 */
export const CONFLICT_OPEN = '<<<<<<< conflict: both versions kept';
export const CONFLICT_MID = '=======';
export const CONFLICT_CLOSE = '>>>>>>> end of conflict';

export interface Conflict {
  /** line numbers (1-based) of the three marker lines */
  open: number;
  mid: number;
  close: number;
}

const OPEN_LINE = /^<{7} conflict\b.*$/;
const MID_LINE = /^={7}[ \t]*$/;
const CLOSE_LINE = /^>{7} end of conflict[ \t]*$/;

/**
 * The conflicts in a page: an opening line, a middle line and a closing line, in that order. Marker lines in fenced code are
 * not conflicts (a page that explains them), but a fence that is only in one of the two versions (one version opens a code
 * block that the page closes after the conflict) does not hide the conflict: once the three lines are all there, what is
 * between them is not looked at for fences.
 */
export function findConflicts(state: EditorState): Conflict[] {
  const out: Conflict[] = [];
  const doc = state.doc;
  let code: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (code === null && OPEN_LINE.test(text)) {
      let mid = 0;
      for (let k = n + 1; k <= doc.lines; k++) {
        const t = doc.line(k).text;
        if (OPEN_LINE.test(t)) break; // another one begins: this one is not closed
        if (!mid && MID_LINE.test(t)) mid = k;
        else if (mid && CLOSE_LINE.test(t)) {
          out.push({ open: n, mid, close: k });
          n = k;
          break;
        }
      }
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (f) code = code === null ? f[1]![0]! : code === f[1]![0] ? null : code;
  }
  return out;
}

export type Keep = 'a' | 'b' | 'both';

/** What a conflict is replaced by: version A, version B, or A and B one after the other. */
export function resolveConflict(state: EditorState, c: Conflict, keep: Keep): { from: number; to: number; insert: string } {
  const doc = state.doc;
  const from = doc.line(c.open).from;
  const lineEnd = doc.line(c.close).to;
  const to = Math.min(doc.length, lineEnd + 1); // the line break after the closing marker goes too
  const part = (a: number, b: number): string => (b < a ? '' : doc.sliceString(doc.line(a).from, doc.line(b).to));
  const A = part(c.open + 1, c.mid - 1);
  const B = part(c.mid + 1, c.close - 1);
  const pieces = keep === 'a' ? [A] : keep === 'b' ? [B] : [A, B];
  const text = pieces.filter((p) => p !== '').join('\n');
  const hadBreak = lineEnd < doc.length;
  return { from, to, insert: text === '' ? '' : text + (hadBreak ? '\n' : '') };
}

class HeaderWidget extends WidgetType {
  constructor(
    readonly side: 'a' | 'b',
    readonly editable: boolean,
  ) {
    super();
  }
  override eq(o: HeaderWidget): boolean {
    return o.side === this.side && o.editable === this.editable;
  }
  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = `cm-conflict-head cm-conflict-head-${this.side}`;
    const label = document.createElement('span');
    label.className = 'cm-conflict-label';
    label.textContent = this.side === 'a' ? 'Version A' : 'Version B';
    bar.append(label);
    if (this.side === 'a' && this.editable) {
      const buttons = document.createElement('span');
      buttons.className = 'cm-conflict-buttons';
      for (const [keep, text, title] of [
        ['a', 'Keep A', 'Keep version A and drop version B'],
        ['b', 'Keep B', 'Keep version B and drop version A'],
        ['both', 'Keep Both', 'Keep both versions, one after the other'],
      ] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-conflict-button';
        b.textContent = text;
        b.title = title;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const line = view.state.doc.lineAt(view.posAtDOM(bar)).number;
          const c = findConflicts(view.state).find((x) => line >= x.open && line <= x.close);
          if (c) view.dispatch({ changes: resolveConflict(view.state, c, keep), userEvent: 'input.conflict' });
        });
        buttons.append(b);
      }
      bar.append(buttons);
    }
    return bar;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class EndWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'cm-conflict-end';
    return d;
  }
  override eq(): boolean {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const editable = !state.readOnly;
  const doc = state.doc;
  const block = (n: number, widget: WidgetType): void => {
    const l = doc.line(n);
    ranges.push(Decoration.replace({ widget, block: true }).range(l.from, l.to));
  };
  for (const c of findConflicts(state)) {
    block(c.open, new HeaderWidget('a', editable));
    for (let n = c.open + 1; n < c.mid; n++) ranges.push(Decoration.line({ class: 'cm-conflict-line cm-conflict-a' }).range(doc.line(n).from));
    block(c.mid, new HeaderWidget('b', editable));
    for (let n = c.mid + 1; n < c.close; n++) ranges.push(Decoration.line({ class: 'cm-conflict-line cm-conflict-b' }).range(doc.line(n).from));
    block(c.close, new EndWidget());
  }
  return Decoration.set(ranges, true);
}

export const conflictsTheme = EditorView.baseTheme({
  '.cm-conflict-head': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '3px 10px', fontSize: '0.78em', fontFamily: 'var(--ui-font, sans-serif)', borderRadius: '8px 8px 0 0', marginTop: '6px' },
  '.cm-conflict-head-a': { background: 'color-mix(in srgb, #3584e4 28%, transparent)', color: 'inherit' },
  '.cm-conflict-head-b': { background: 'color-mix(in srgb, #e5a50a 30%, transparent)', color: 'inherit', marginTop: '0', borderRadius: '0' },
  '.cm-conflict-label': { fontWeight: '700' },
  '.cm-conflict-buttons': { display: 'inline-flex', gap: '6px' },
  '.cm-conflict-button': { font: 'inherit', fontSize: '0.95em', padding: '1px 9px', borderRadius: '6px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer', opacity: '0.85' },
  '.cm-conflict-button:hover': { opacity: '1', background: 'color-mix(in srgb, currentColor 14%, transparent)' },
  '.cm-conflict-end': { height: '8px', borderRadius: '0 0 8px 8px', marginBottom: '6px', background: 'color-mix(in srgb, #e5a50a 30%, transparent)' },
  '.cm-line.cm-conflict-a': { background: 'color-mix(in srgb, #3584e4 11%, transparent)', paddingLeft: '10px', paddingRight: '10px' },
  '.cm-line.cm-conflict-b': { background: 'color-mix(in srgb, #e5a50a 12%, transparent)', paddingLeft: '10px', paddingRight: '10px' },
});

export function conflicts(): Extension {
  return [
    StateField.define<DecorationSet>({
      create: (s) => build(s),
      update: (v, tr) => (tr.docChanged || tr.startState.readOnly !== tr.state.readOnly ? build(tr.state) : v),
      provide: (f) => EditorView.decorations.from(f),
    }),
    conflictsTheme,
  ];
}
