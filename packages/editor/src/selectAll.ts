import { type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/**
 * Select all, two ways. As text (Ctrl+A, and the right-click menu) the whole document is selected and copying gives the
 * Markdown. As HTML (the right-click menu) the same selection is made, but copying also puts the page as it is drawn on the
 * clipboard as HTML, so pasting into a word processor or a mail keeps the formatting; the plain-text flavour is still the Markdown.
 */

/** Turns the Markdown of the page into HTML; without one the page as drawn is copied. */
export type HtmlRenderer = (markdown: string) => string;

/** The editors whose whole text was selected "as HTML", until the selection or the text changes. */
const htmlSelected = new WeakSet<EditorView>();

const selectWhole = (view: EditorView): void => {
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
};

export function selectAllAsText(view: EditorView): boolean {
  htmlSelected.delete(view);
  selectWhole(view);
  return true;
}

export function selectAllAsHtml(view: EditorView): boolean {
  selectWhole(view);
  htmlSelected.add(view);
  return true;
}

/** Is the whole text selected, and was it selected as HTML? */
export function isHtmlSelection(view: EditorView): boolean {
  const s = view.state.selection.main;
  return htmlSelected.has(view) && s.from === 0 && s.to === view.state.doc.length;
}

const escapeHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page as drawn: the editor's own DOM without its classes and widgets' scaffolding. Only when all of the page is drawn. */
function drawnHtml(view: EditorView): string {
  const doc = view.state.doc;
  const vp = view.viewport;
  if (vp.from > 0 || vp.to < doc.length) {
    // a long page is drawn a part at a time: the rest is only text
    return doc.toString().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  }
  const clone = view.contentDOM.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.cm-cursor, .cm-widgetBuffer').forEach((n) => n.remove());
  const strip = (el: Element): void => {
    for (const a of [...el.attributes]) if (a.name === 'class' || a.name === 'style' || a.name === 'contenteditable' || a.name === 'draggable' || a.name.startsWith('aria-') || a.name.startsWith('data-')) el.removeAttribute(a.name);
  };
  strip(clone);
  clone.querySelectorAll('*').forEach(strip);
  return `<div>${clone.innerHTML}</div>`;
}

export function selectAll(renderHtml?: HtmlRenderer): Extension {
  return [
    // the editor's own: select all of the text, whatever part of a long page is drawn
    Prec.high(keymap.of([{ key: 'Mod-a', run: selectAllAsText, preventDefault: true }])),
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged) return;
      if (htmlSelected.has(u.view) && !isHtmlSelection(u.view)) htmlSelected.delete(u.view);
    }),
    EditorView.domEventHandlers({
      copy: (e, view) => {
        if (!e.clipboardData || !isHtmlSelection(view)) return false;
        const markdown = view.state.doc.toString();
        let html: string;
        try {
          html = renderHtml ? renderHtml(markdown) : drawnHtml(view);
        } catch {
          return false;
        }
        e.clipboardData.setData('text/plain', markdown);
        e.clipboardData.setData('text/html', html);
        e.preventDefault();
        return true;
      },
    }),
  ];
}
