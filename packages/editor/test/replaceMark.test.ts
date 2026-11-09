import { EditorView } from '@codemirror/view';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

function make(text: string, options: { smartQuotes?: boolean } = {}): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, ...options });
  ed.load(text);
  return ed;
}

/** Type a character the way the browser reports it: through the editor's input handlers, then the plain insert if none took it. */
function type(ed: NoteEditor, ch: string): void {
  const { from, to } = ed.view.state.selection.main;
  for (const h of ed.view.state.facet(EditorView.inputHandler)) if (h(ed.view, from, to, ch, () => ed.view.state.update({ changes: { from, to, insert: ch } }))) return;
  ed.view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length } });
}
const select = (ed: NoteEditor, from: number, to: number): void => ed.view.dispatch({ selection: { anchor: from, head: to } });

suite('typing a quote or bracket over a lone wrapping mark', () => {
  it('replaces a bracket with the one typed instead of wrapping it', () => {
    const ed = make('call (now) ok');
    select(ed, 5, 6);
    type(ed, '[');
    expect(ed.text()).toBe('call [now) ok');
    select(ed, 9, 10);
    type(ed, ']');
    expect(ed.text()).toBe('call [now] ok');
  });

  it('replaces a curly quote with a straight bracket, and a bracket with a quote', () => {
    const ed = make('say \u201Chi\u201D ok');
    select(ed, 4, 5);
    type(ed, '(');
    expect(ed.text()).toBe('say (hi\u201D ok');
    select(ed, 7, 8);
    type(ed, ')');
    expect(ed.text()).toBe('say (hi) ok');
  });

  it('a quote typed over a quote comes out as the right curly quote for its place', () => {
    const ed = make('say \u201Chi\u201D ok');
    select(ed, 4, 5);
    type(ed, "'");
    select(ed, 7, 8);
    type(ed, "'");
    expect(ed.text()).toBe('say \u2018hi\u2019 ok');
  });

  it('keeps the straight character when smart quotes are off', () => {
    const ed = make('say "hi" ok', { smartQuotes: false });
    select(ed, 4, 5);
    type(ed, "'");
    expect(ed.text()).toBe("say 'hi\" ok");
  });

  it('one undo puts the old mark back', () => {
    const ed = make('call (now) ok');
    select(ed, 5, 6);
    type(ed, '[');
    expect(ed.text()).toBe('call [now) ok');
    ed.undo?.();
    expect(ed.text()).toBe('call (now) ok');
  });

  it('still wraps a selection that is more than a lone mark', () => {
    const ed = make('call now ok');
    select(ed, 5, 8);
    type(ed, '(');
    expect(ed.text()).toBe('call (now) ok');
  });

  it('does not touch an ordinary selected letter or a second selected mark', () => {
    const ed = make('a (b) c');
    select(ed, 0, 1);
    type(ed, '(');
    expect(ed.text()).toBe('(a) (b) c');
  });
});
