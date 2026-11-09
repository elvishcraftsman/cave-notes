import { describe, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

const TABLE = '| a | b |\n| --- | --- |\n| one | two |\n';
const DOC = `intro\n\n${TABLE}\nend\n`;

function make(readOnly = false): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(DOC, { readOnly });
  return ed;
}
const inTable = (ed: NoteEditor): number => DOC.indexOf('one') + 1;
const widgets = (ed: NoteEditor): number => ed.view.dom.querySelectorAll('.cm-table, table').length;

describe('a table found by find and replace', () => {
  it('stays a table while the focus is not in the editor, and shows its code when it is', async () => {
    const ed = make();
    await Promise.resolve();
    ed.view.dispatch({ selection: { anchor: 0 } });
    expect(widgets(ed)).toBeGreaterThan(0);
    // the search panel has the focus (the editor does not): a match inside the table selects it, the table stays drawn
    ed.view.dispatch({ selection: { anchor: inTable(ed), head: inTable(ed) + 3 } });
    expect(ed.view.hasFocus).toBe(false);
    expect(widgets(ed)).toBeGreaterThan(0);
    // focused: the cursor in the table shows the Markdown, as before
    ed.view.contentDOM.dispatchEvent(new FocusEvent('focus'));
    ed.view.focus();
    ed.view.dispatch({ selection: { anchor: inTable(ed) } });
    expect(ed.view.state.doc.toString()).toBe(DOC);
  });

  it('is never turned into code in a read-only page', async () => {
    const ed = make(true);
    await Promise.resolve();
    ed.view.dispatch({ selection: { anchor: inTable(ed), head: inTable(ed) + 3 } });
    expect(widgets(ed)).toBeGreaterThan(0);
  });
});
