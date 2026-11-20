import { isViewportSelection } from '../src/selectAll';
import { runScopeHandlers } from '@codemirror/view';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor, isHtmlSelection, selectAllAsHtml, selectAllAsText, showFormatMenu, closeFormatMenu } from '../src/index';

function make(text: string, readOnly = false, renderHtml?: (md: string) => string): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, ...(renderHtml ? { renderHtml } : {}) });
  ed.load(text, { readOnly });
  return ed;
}

const copyEvent = (): { e: Event; data: Record<string, string> } => {
  const data: Record<string, string> = {};
  const e = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { setData: (k: string, v: string) => void (data[k] = v), getData: (k: string) => data[k] ?? '' } });
  return { e, data };
};

suite('select all', () => {
  const ctrlA = (ed: NoteEditor): void => void runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }), 'editor');

  it('Ctrl+A selects the paragraph first, then all of the text', () => {
    const text = '# T\n\nfirst line\nsecond line\n\nlast';
    const ed = make(text);
    const at = text.indexOf('second');
    ed.view.dispatch({ selection: { anchor: at + 2 } });
    ctrlA(ed);
    let s = ed.state.selection.main;
    expect([s.from, s.to]).toEqual([text.indexOf('first'), text.indexOf('\n\nlast')]);
    ctrlA(ed);
    s = ed.state.selection.main;
    expect([s.from, s.to]).toEqual([0, ed.text().length]);
    expect(isHtmlSelection(ed.view)).toBe(false);
  });

  it('Ctrl+A on a page that is one paragraph selects it all at once', () => {
    const ed = make('only one paragraph\nof two lines');
    ctrlA(ed);
    const s = ed.state.selection.main;
    expect([s.from, s.to]).toEqual([0, ed.text().length]);
  });

  it('as HTML copies the page as HTML and the Markdown as plain text', () => {
    const ed = make('# T\n\nsome *text*', false, (md) => `<html-of>${md.length}</html-of>`);
    selectAllAsHtml(ed.view);
    expect(isHtmlSelection(ed.view)).toBe(true);
    const { e, data } = copyEvent();
    ed.view.contentDOM.dispatchEvent(e);
    expect(data['text/plain']).toBe('# T\n\nsome *text*');
    expect(data['text/html']).toBe('<html-of>16</html-of>');
    // moving the selection takes the HTML mode away
    ed.view.dispatch({ selection: { anchor: 2 } });
    expect(isHtmlSelection(ed.view)).toBe(false);
  });

  it('as text leaves copying to the editor', () => {
    const ed = make('abc');
    selectAllAsText(ed.view);
    const { e, data } = copyEvent();
    ed.view.contentDOM.dispatchEvent(e);
    expect(data['text/html']).toBeUndefined();
  });

  it('the right-click menu has the select buttons and the list indent buttons; a read-only page gets select and copy only', () => {
    const ed = make('- a\n- b');
    showFormatMenu(ed.view, 10, 10);
    const labels = [...document.querySelectorAll('.cm-format-menu .cm-format-btn')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Select all text', 'Select all as HTML', 'Indent list item', 'Outdent list item']));
    closeFormatMenu();
    const ro = make('# Doc', true);
    showFormatMenu(ro.view, 10, 10, undefined, undefined, { selectOnly: true });
    const roLabels = [...document.querySelectorAll('.cm-format-menu .cm-format-btn')].map((b) => b.getAttribute('aria-label'));
    expect(roLabels).toEqual(['Copy', 'Select all text', 'Select all as HTML']);
    closeFormatMenu();
  });
});

suite('the phone\u2019s own Select all on a long page', () => {
  it('is told by a selection of exactly the drawn part, when the page goes on beyond it', () => {
    expect(isViewportSelection({ from: 100, to: 900 }, { from: 100, to: 900 }, 5000)).toBe(true);
    expect(isViewportSelection({ from: 0, to: 900 }, { from: 0, to: 900 }, 5000)).toBe(true);
    expect(isViewportSelection({ from: 0, to: 5000 }, { from: 0, to: 5000 }, 5000)).toBe(false); // all is drawn already
    expect(isViewportSelection({ from: 120, to: 900 }, { from: 100, to: 900 }, 5000)).toBe(false);
    expect(isViewportSelection({ from: 100, to: 100 }, { from: 100, to: 100 }, 5000)).toBe(false);
  });
});
