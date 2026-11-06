import { undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { describe as suite, expect, it } from 'vitest';
import { closeFormatMenu, NoteEditor, showFormatMenu, synonymsAt, type ThesaurusHost } from '../src/index';

function make(text: string): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text);
  return ed;
}

/** knows `big` and `Big`, not the little words */
const thesaurus: ThesaurusHost = {
  synonyms: (w) => (w.toLowerCase() === 'big' ? ['large', 'great'] : w.toLowerCase() === 'happy' ? ['glad'] : null),
};
const at = (ed: NoteEditor, marker: string): number => ed.text().indexOf(marker) + 1;

suite('synonyms for the word under a right-click', () => {
  it('offers what the thesaurus has for an ordinary word', () => {
    const ed = make('a big house');
    expect(synonymsAt(ed.view, 3, thesaurus)).toEqual({ word: 'big', from: 2, to: 5, options: ['large', 'great'] });
  });
  it('offers nothing for words the thesaurus skips, or without a thesaurus', () => {
    const ed = make('a big house');
    expect(synonymsAt(ed.view, 0, thesaurus)).toBeNull(); // "a"
    expect(synonymsAt(ed.view, 3, undefined)).toBeNull();
    expect(synonymsAt(ed.view, null, thesaurus)).toBeNull();
  });
  it('offers nothing for words with digits', () => {
    const ed = make('big2 house');
    expect(synonymsAt(ed.view, 1, thesaurus)).toBeNull();
  });
  it('works on a selection of exactly one word, and on nothing else', () => {
    const ed = make('a big happy house');
    ed.view.dispatch({ selection: EditorSelection.range(2, 5) });
    expect(synonymsAt(ed.view, 3, thesaurus)?.word).toBe('big');
    ed.view.dispatch({ selection: EditorSelection.range(2, 11) }); // two words
    expect(synonymsAt(ed.view, 3, thesaurus)).toBeNull();
    ed.view.dispatch({ selection: EditorSelection.range(2, 4) }); // part of a word
    expect(synonymsAt(ed.view, 3, thesaurus)).toBeNull();
  });
  it('stays out of code, addresses, page links and front matter', () => {
    for (const [text, marker] of [
      ['say `big` now', 'ig` '],
      ['```\nbig\n```\n', 'ig\n'],
      ['see <https://example.com/big/page> now', 'big/'],
      ['see https://example.com/big now', 'big now'],
      ['go to [[big page]] now', 'ig page'],
      ['[x](https://example.com/big)', 'big)'],
      ['---\ntitle: big\n---\n\ntext', 'ig\n---'],
    ] as const) {
      const ed = make(text);
      expect(synonymsAt(ed.view, at(ed, marker), thesaurus), text).toBeNull();
    }
  });
  it('still works around those places', () => {
    const ed = make('---\ntitle: x\n---\n\na big thing and `code`');
    expect(synonymsAt(ed.view, at(ed, 'ig thing'), thesaurus)?.word).toBe('big');
    const link = make('a [big](https://example.com) link');
    expect(synonymsAt(link.view, at(link, 'ig]'), thesaurus)?.word).toBe('big');
    const dashes = make('a big --- dash');
    expect(synonymsAt(dashes.view, 3, thesaurus)?.word).toBe('big');
  });
});

suite('the synonym list under the toolbar', () => {
  const open = (ed: NoteEditor, pos: number): HTMLElement => {
    showFormatMenu(ed.view, 10, 10, undefined, synonymsAt(ed.view, pos, thesaurus)!);
    return document.querySelector('.cm-synonym-list') as HTMLElement;
  };

  it('hangs below the toolbar with a title and one entry per synonym', () => {
    const ed = make('a big house');
    const list = open(ed, 3);
    expect(list.querySelector('.cm-synonym-title')?.textContent).toContain('big');
    expect([...list.querySelectorAll('.cm-synonym .cm-format-sub-label')].map((e) => e.textContent)).toEqual(['large', 'great']);
    expect(document.querySelector('.cm-format-menu')!.contains(list)).toBe(true);
    closeFormatMenu();
    expect(document.querySelector('.cm-synonym-list')).toBeNull();
  });
  it('choosing one replaces the word and puts the cursor after it', () => {
    const ed = make('a big house');
    (open(ed, 3).querySelector('.cm-synonym') as HTMLElement).click();
    expect(ed.text()).toBe('a large house');
    expect(ed.view.state.selection.main.head).toBe(7);
    expect(document.querySelector('.cm-format-menu')).toBeNull();
  });
  it('the replacement is one undo step', () => {
    const ed = make('a big house');
    (open(ed, 3).querySelector('.cm-synonym') as HTMLElement).click();
    expect(ed.text()).toBe('a large house');
    undo(ed.view);
    expect(ed.text()).toBe('a big house');
  });
  it('is not shown beside spelling suggestions', () => {
    const ed = make('a big house');
    const spelling = { target: { word: 'big', from: 2, to: 5, suggestions: ['bag'] }, host: { check: () => null, addWord: () => undefined } };
    showFormatMenu(ed.view, 10, 10, spelling, synonymsAt(ed.view, 3, thesaurus)!);
    expect(document.querySelector('.cm-synonym-list')).toBeNull();
    expect(document.querySelector('.cm-spell-list')).not.toBeNull();
    closeFormatMenu();
  });
});
