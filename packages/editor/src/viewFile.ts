import { type Extension, Annotation, Facet } from '@codemirror/state';
import { type ViewUpdate, EditorView, ViewPlugin } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { textDiff } from './canvas';

/**
 * A view file (`.view`) shown as a database view filling the editor, instead of as text.
 *
 * Like a canvas, the document stays the file's text and is the one source of truth: the view is a widget drawn beside the
 * (hidden) text area, and each change it makes is an ordinary transaction, so undo, saving, history and sync work as for any page.
 */

/** What the view may do to the file it is drawn from. */
export interface ViewFileApi {
  /** Replace the whole file text. */
  setText(next: string): void;
  /** Show the file's raw text for editing (the view is hidden until `showView` is called by the "Show as a view" button). */
  edit(): void;
  readonly readOnly: boolean;
}

/** The app supplies this to draw a view file; the editor gives it a place to draw and the way back to the document. */
export interface ViewFileEditorHost {
  mount(el: HTMLElement, text: string, api: ViewFileApi): { update(text: string): void; destroy(): void };
}

export interface ViewFileModeOptions {
  host: ViewFileEditorHost;
  readOnly?: boolean;
  onSave?: () => void;
}

/** Marks the transactions the view itself made, so that they are not drawn again from the text. */
const fromViewFile = Annotation.define<boolean>();

class ViewFilePlugin {
  private readonly wrap: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly handle: { update(text: string): void; destroy(): void };

  constructor(private readonly view: EditorView, o: ViewFileModeOptions) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-viewfile-wrap';
    this.handle = o.host.mount(wrap, view.state.doc.toString(), {
      readOnly: o.readOnly === true,
      setText: (next) => {
        const change = textDiff(view.state.doc.toString(), next);
        if (change) view.dispatch({ changes: change, annotations: fromViewFile.of(true), userEvent: 'input.type.viewfile' });
      },
      edit: () => this.raw(true),
    });
    this.wrap = wrap;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pill-button small cm-viewfile-back';
    back.textContent = 'Show as a view';
    back.onclick = () => this.raw(false);
    this.back = back;
    view.dom.append(wrap, back);
    // undo, redo and save belong to the editor; the keys never reach the hidden text
    wrap.addEventListener('keydown', (e) => {
      const field = (e.target as HTMLElement).closest('textarea, input, [contenteditable="true"], .cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (!field && mod && (k === 'z' || k === 'y')) {
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

  private raw(on: boolean): void {
    this.view.dom.classList.toggle('cm-viewfile-raw', on);
    if (on) this.view.focus();
  }

  update(u: ViewUpdate): void {
    if (!u.docChanged || u.transactions.some((t) => t.annotation(fromViewFile))) {
      if (u.docChanged) this.handle.update(u.state.doc.toString());
      return;
    }
    this.handle.update(u.state.doc.toString());
  }

  destroy(): void {
    this.handle.destroy();
    this.wrap.remove();
    this.back.remove();
  }
}

/** True in the state of a document shown as a view file. */
export const viewFileFlag = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

/** Show the document as a view that fills the editor. */
export function viewFileMode(o: ViewFileModeOptions): Extension {
  return [
    ViewPlugin.define((view) => new ViewFilePlugin(view, o)),
    EditorView.editorAttributes.of({ class: 'cm-viewfile' }),
    viewFileFlag.of(true),
    o.readOnly ? EditorView.editable.of(false) : [],
  ];
}

export const viewFileTheme = EditorView.baseTheme({
  '&.cm-viewfile': { height: '100%', position: 'relative' },
  // the text stays in the document, out of sight, until the file is edited as text
  '&.cm-viewfile .cm-scroller': { display: 'none' },
  '&.cm-viewfile.cm-viewfile-raw .cm-scroller': { display: 'flex' },
  '.cm-viewfile-wrap': { position: 'absolute', inset: '0', overflow: 'auto', padding: '0' },
  '&.cm-viewfile.cm-viewfile-raw .cm-viewfile-wrap': { display: 'none' },
  '.cm-viewfile-back': { display: 'none', position: 'absolute', top: '8px', right: '12px', zIndex: '5' },
  '&.cm-viewfile.cm-viewfile-raw .cm-viewfile-back': { display: 'inline-flex' },
});
