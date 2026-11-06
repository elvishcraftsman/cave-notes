import { describe as suite, expect, it } from 'vitest';
import { closeFormatMenu, misspeltAt, NoteEditor, showFormatMenu, wordAround, type SpellHost } from '../src/index';

function make(text: string, spell?: SpellHost): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, ...(spell ? { spell } : {}) });
  ed.load(text);
  return ed;
}

const host = (added: string[] = []): SpellHost => ({
  check: (w) => (w.toLowerCase() === 'teh' ? ['the', 'tea', 'ten'] : w.toLowerCase() === 'zzzz' ? [] : null),
  addWord: (w) => void added.push(w),
});

suite('the word under a click', () => {
  it('stops at spaces and punctuation, and keeps inner apostrophes', () => {
    const ed = make('say don’t, (teh) ‘quoted’ now');
    expect(wordAround(ed.view, 6)).toEqual({ word: 'don’t', from: 4, to: 9 });
    expect(wordAround(ed.view, 12)).toEqual({ word: 'teh', from: 12, to: 15 });
    expect(wordAround(ed.view, 20)?.word).toBe('quoted');
    expect(wordAround(ed.view, 3)?.word).toBe('say');
  });
  it('finds nothing in the gap between words', () => {
    const ed = make('a   b');
    expect(wordAround(ed.view, 2)).toBeNull();
  });
  it('asks the spell checker, and only for words', () => {
    const ed = make('teh cat 123');
    expect(misspeltAt(ed.view, 1, host())?.suggestions).toEqual(['the', 'tea', 'ten']);
    expect(misspeltAt(ed.view, 5, host())).toBeNull();
    expect(misspeltAt(ed.view, 9, host())).toBeNull();
    expect(misspeltAt(ed.view, null, host())).toBeNull();
    expect(misspeltAt(ed.view, 1, undefined)).toBeNull();
  });
});

suite('the spelling part of the right-click menu', () => {
  const open = (ed: NoteEditor, at: number, h: SpellHost): HTMLElement => {
    const target = misspeltAt(ed.view, at, h)!;
    showFormatMenu(ed.view, 10, 10, { target, host: h });
    return document.querySelector('.cm-spell-list') as HTMLElement;
  };

  it('lists the suggestions and Add to Dictionary', () => {
    const ed = make('I saw teh dog');
    const list = open(ed, 8, host());
    const labels = [...list.querySelectorAll('.cm-format-sub-label')].map((e) => e.textContent);
    expect(labels).toEqual(['the', 'tea', 'ten', 'Add to Dictionary']);
    closeFormatMenu();
    expect(document.querySelector('.cm-spell-list')).toBeNull();
  });

  it('a suggestion replaces the word', () => {
    const ed = make('I saw teh dog');
    const list = open(ed, 8, host());
    (list.querySelector('.cm-spell-suggestion') as HTMLElement).click();
    expect(ed.text()).toBe('I saw the dog');
    expect(document.querySelector('.cm-format-menu')).toBeNull();
  });

  it('Add to Dictionary hands the word over and leaves the text alone', () => {
    const added: string[] = [];
    const ed = make('I saw teh dog');
    const list = open(ed, 8, host(added));
    (list.querySelector('.cm-spell-add') as HTMLElement).click();
    expect(added).toEqual(['teh']);
    expect(ed.text()).toBe('I saw teh dog');
  });

  it('says so when there is no suggestion, and still offers to add', () => {
    const ed = make('xx zzzz yy');
    const list = open(ed, 4, host());
    expect(list.querySelector('.cm-spell-none')?.textContent).toBe('No suggestions');
    expect(list.querySelector('.cm-spell-add')).not.toBeNull();
    closeFormatMenu();
  });

  it('a right-click on a correct word shows the toolbar only', () => {
    const ed = make('I saw the dog', host());
    ed.view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(document.querySelector('.cm-format-menu')).not.toBeNull();
    expect(document.querySelector('.cm-spell-list')).toBeNull();
    closeFormatMenu();
  });
});
