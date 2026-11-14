import { runScopeHandlers } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

/** An editor with `text`; `‸` marks the cursor. */
function make(text: string): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  const at = text.indexOf('‸');
  ed.load(at < 0 ? text : text.replace('‸', ''));
  if (at >= 0) ed.view.dispatch({ selection: { anchor: at } });
  return ed;
}

const press = (ed: NoteEditor, key: string, mods: { shift?: boolean; alt?: boolean } = {}): void => {
  runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true }), 'editor');
};

/** the text with the cursor put back in as ‸ */
const show = (ed: NoteEditor): string => {
  const t = ed.text();
  const p = ed.state.selection.main.head;
  return t.slice(0, p) + '‸' + t.slice(p);
};


import { annotationsOf, annotationAt, toggleComment, insertComment } from '../src/index';

suite('CriticMarkup annotations', () => {
  it('finds highlights, highlights with comments, and comments on their own, but not in code', () => {
    const ed = make('A {==marked==}{>>why<<} and {==plain==} and {>>lone<<}.\n\n`{==code==}`\n\n```\n{>>fenced<<}\n```\n');
    const list = annotationsOf(ed.view.state);
    expect(list.map((a) => [a.text, a.comment])).toEqual([['marked', 'why'], ['plain', null], ['', 'lone']]);
    expect(list[0]!.line).toBe(1);
    expect(ed.annotations()).toHaveLength(3);
  });

  it('the comment button highlights the selection and puts the cursor in the comment', () => {
    const ed = make('Say hello now');
    ed.view.dispatch({ selection: { anchor: 4, head: 9 } });
    insertComment(ed.view);
    expect(ed.text()).toBe('Say {==hello==}{>><<} now');
    expect(ed.view.state.selection.main.head).toBe('Say {==hello==}{>>'.length);
    const a = annotationAt(ed.view.state)!;
    expect(a.text).toBe('hello');
    expect(a.comment).toBe('');
  });

  it('with nothing selected it adds a comment at the cursor', () => {
    const ed = make('Say ‸now');
    insertComment(ed.view);
    expect(ed.text()).toBe('Say {>><<}now');
  });

  it('pressing it again in one takes it away: a highlight goes back to text, a lone comment goes', () => {
    const ed = make('A {==marked==}{>>why‸<<} b {>>lone<<}.');
    toggleComment(ed.view);
    expect(ed.text()).toBe('A marked b {>>lone<<}.');
    ed.view.dispatch({ selection: { anchor: ed.text().indexOf('lone') } });
    toggleComment(ed.view);
    expect(ed.text()).toBe('A marked b .');
  });

  it('removeAnnotationAt removes the one that starts there (the sidebar and its menu use it)', () => {
    const ed = make('{==a==}{>>1<<} {==b==}{>>2<<}');
    ed.removeAnnotationAt(annotationsOf(ed.view.state)[1]!.from);
    expect(ed.text()).toBe('{==a==}{>>1<<} b');
  });
});
