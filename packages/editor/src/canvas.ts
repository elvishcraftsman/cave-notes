import { type ChangeSpec, type Extension, Annotation, Facet } from '@codemirror/state';
import { type ViewUpdate, EditorView, ViewPlugin } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { CanvasView, parseCanvas, serializeCanvas, type Canvas, type CanvasHost } from '@cave-notes/ui-canvas';

/**
 * A `.canvas` file (JSON Canvas, as Obsidian writes it) shown as a canvas instead of as text.
 *
 * The editor works the way it does for a database view block: the document stays the JSON text and is the one source of
 * truth, and the canvas is a widget drawn over all of it. Every finished change on the canvas is an ordinary transaction on
 * the document, so undo and redo, saving, history, sync and conflict handling all work as they do for any page, and
 * nothing here needs a copy of the file's contents.
 */

/** What the app provides to draw the inside of nodes; the editor adds how changes reach the document. */
export type CanvasEditorHost = Omit<CanvasHost, 'onChange'>;

export interface CanvasModeOptions {
  host: CanvasEditorHost;
  readOnly?: boolean;
  /** Ctrl+S on the canvas */
  onSave?: () => void;
  /** The canvas on screen, when it is made (`present`) and when it goes: for panes beside it that show and change its objects. */
  onCanvas?: (cv: CanvasView, present: boolean) => void;
}

/**
 * Marks the transactions the canvas itself made, so that they are not sent back to it. They are tagged `input.type.canvas`: the
 * history joins quick changes of that kind into one undo step (typing in a node, a run of nudges).
 */
const fromCanvas = Annotation.define<boolean>();

const views = new WeakMap<EditorView, CanvasView>();

/** The canvas shown in an editor, if it is in canvas mode. */
export const canvasViewOf = (view: EditorView): CanvasView | null => views.get(view) ?? null;

/** The smallest change that turns `from` into `to`: what is common at the start and the end stays, so one node edited is one small change. */
export function textDiff(from: string, to: string): ChangeSpec | null {
  if (from === to) return null;
  let a = 0;
  const max = Math.min(from.length, to.length);
  while (a < max && from.charCodeAt(a) === to.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && from.charCodeAt(from.length - 1 - b) === to.charCodeAt(to.length - 1 - b)) b++;
  return { from: a, to: from.length - b, insert: to.slice(a, to.length - b) };
}

/**
 * The canvas is put beside the editor's text area, not inside it: the text area is an editable region, and editors in cards
 * (each with its own focus, caret and selection) must not sit in the middle of another one.
 */
class CanvasPlugin {
  private readonly wrap: HTMLElement;
  private readonly cv: CanvasView;
  private onCanvas: CanvasModeOptions['onCanvas'];

  constructor(private readonly view: EditorView, o: CanvasModeOptions) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-canvas-wrap';
    const parsed = parseCanvas(view.state.doc.toString());
    const canvas: Canvas = parsed.ok ? parsed.canvas : { nodes: [], edges: [] };
    this.cv = new CanvasView(
      wrap,
      {
        ...o.host,
        onChange: (next) => {
          const change = textDiff(view.state.doc.toString(), serializeCanvas(next));
          if (change) view.dispatch({ changes: change, annotations: fromCanvas.of(true), userEvent: 'input.type.canvas' });
        },
      },
      canvas,
      { readOnly: o.readOnly === true },
    );
    this.wrap = wrap;
    view.dom.append(wrap);
    views.set(view, this.cv);
    o.onCanvas?.(this.cv, true);
    this.onCanvas = o.onCanvas;
    // undo, redo and save are the editor's; they are done here because the keys never reach the (hidden) text
    wrap.addEventListener('keydown', (e) => {
      const field = (e.target as HTMLElement).closest('.cm-editor, textarea, input');
      const nested = !!field && field !== view.dom && wrap.contains(field); // an editor inside a card
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (!nested && mod && (k === 'z' || k === 'y')) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo(view);
        else undo(view);
      } else if (mod && k === 's') {
        e.preventDefault();
        o.onSave?.();
      }
      e.stopPropagation();
    });
  }

  /** The text changed other than by the canvas (undo, a sync, a restore): show it. */
  update(u: ViewUpdate): void {
    if (!u.docChanged || u.transactions.some((t) => t.annotation(fromCanvas))) return;
    const parsed = parseCanvas(u.state.doc.toString());
    if (parsed.ok) this.cv.setCanvas(parsed.canvas);
  }

  destroy(): void {
    this.onCanvas?.(this.cv, false);
    this.cv.destroy();
    this.wrap.remove();
    if (views.get(this.view) === this.cv) views.delete(this.view);
  }
}

/** Show the document as a canvas. */
export function canvasMode(o: CanvasModeOptions): Extension {
  return [
    ViewPlugin.define((view) => new CanvasPlugin(view, o)),
    EditorView.editorAttributes.of({ class: 'cm-canvas' }),
    canvasFlag.of(true),
    o.readOnly ? EditorView.editable.of(false) : [],
  ];
}

/** True in the state of a document shown as a canvas. */
export const canvasFlag = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

export const canvasTheme = EditorView.baseTheme({
  '&.cm-canvas': { height: '100%', position: 'relative' },
  // the text stays in the document, out of sight; the canvas covers the editor
  '&.cm-canvas .cm-scroller': { display: 'none' },
  '.cm-canvas-wrap': { position: 'absolute', inset: '0' },
});
