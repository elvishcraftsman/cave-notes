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
  it('Ctrl+A selects all of the text', () => {
    const ed = make('# T\n\nsome text');
    runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }), 'editor');
    const s = ed.state.selection.main;
    expect([s.from, s.to]).toEqual([0, ed.text().length]);
    expect(isHtmlSelection(ed.view)).toBe(false);
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
