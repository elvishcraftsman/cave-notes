import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NoteEditor, computeDecorations, fullRender, markdownSupport } from '../src/index';

const FENCED = '# Title\n\nSome text\n\n```yaml\nkey: value\n```\n\nafter';

function hiddenAndLines(text: string, cursor: number): { hidden: string[]; lines: string[] } {
  const state = EditorState.create({ doc: text, selection: EditorSelection.cursor(cursor), extensions: [markdownSupport(), fullRender.of(true)] });
  const set = computeDecorations(state, [{ from: 0, to: text.length }], {}, true);
  const hidden: string[] = [];
  const lines: string[] = [];
  set.between(0, text.length, (from, to, value) => {
    const cls = (value.spec as { class?: string }).class;
    if (value.constructor.name === 'LineDecoration') lines.push(`${state.doc.lineAt(from).number}:${cls}`);
    else if (!(value.spec as { widget?: object }).widget && value.constructor.name !== 'MarkDecoration') hidden.push(text.slice(from, to));
  });
  return { hidden, lines };
}

describe('fully rendered pages (the built-in documentation)', () => {
  it('hide the fence lines of a code block', () => {
    const d = hiddenAndLines(FENCED, text(FENCED).length);
    expect(d.hidden).toEqual(expect.arrayContaining(['```yaml', '```']));
    expect(d.lines).toEqual(expect.arrayContaining(['5:cm-fence-hidden', '7:cm-fence-hidden']));
    expect(d.lines).toContain('6:cm-codeblock');
  });

  it('never reveal syntax at the cursor, even inside a heading or a fence', () => {
    for (const at of [3, FENCED.indexOf('yaml'), FENCED.indexOf('key')]) {
      const d = hiddenAndLines(FENCED, at);
      expect(d.hidden).toContain('# ');
      expect(d.hidden).toContain('```yaml');
    }
  });
});

const text = (s: string): string => s;

describe('read-only NoteEditor', () => {
  const make = (): NoteEditor => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new NoteEditor({ parent: el });
  };

  it('refuses every change, however it is made', () => {
    const ed = make();
    ed.load('# Doc\n\n- [ ] task', { readOnly: true });
    expect(ed.view.state.readOnly).toBe(true);
    ed.view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(ed.text()).toBe('# Doc\n\n- [ ] task');
    ed.destroy();
  });

  it('does not tidy the page when it opens', () => {
    const ed = make();
    ed.load('Text[^2] and[^1]\n\n[^1]: one\n[^2]: two\n', { readOnly: true });
    expect(ed.text()).toBe('Text[^2] and[^1]\n\n[^1]: one\n[^2]: two\n');
    ed.destroy();
  });

  it('a page loaded afterwards without the flag is editable again', () => {
    const ed = make();
    ed.load('one', { readOnly: true });
    ed.load('two');
    ed.view.dispatch({ changes: { from: 3, insert: '!' } });
    expect(ed.text()).toBe('two!');
    ed.destroy();
  });
});
