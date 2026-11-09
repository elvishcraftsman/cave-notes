import { afterEach, beforeEach, describe as suite, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { canIndentListItems, canOutdentListItems, closeFormatMenu, NoteEditor } from '../src/index';
import { curlyApostrophesBefore } from '../src/smartQuotes';
import { listSupport } from '../src/lists';
import { markdownSupport } from '../src/index';

function make(text: string, opts: Partial<ConstructorParameters<typeof NoteEditor>[0]> = {}): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, ...opts });
  const a = text.indexOf('‸');
  const b = text.lastIndexOf('‸');
  ed.load(text.replaceAll('‸', ''));
  if (a >= 0) ed.view.dispatch({ selection: a === b ? { anchor: a } : { anchor: a, head: b - 1 } });
  return ed;
}

const pointer = (ed: NoteEditor, type: string): void => {
  const e = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: type });
  ed.view.contentDOM.dispatchEvent(e);
};
const menu = (): HTMLElement | null => document.querySelector('.cm-format-menu');
const button = (label: string): HTMLElement | null => document.querySelector(`.cm-format-menu [aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  document.hasFocus = () => true;
});
afterEach(() => {
  closeFormatMenu();
  vi.useRealTimers();
});

suite('can indent / can outdent', () => {
  const state = (doc: string, at: number): EditorState => EditorState.create({ doc, selection: { anchor: at }, extensions: [markdownSupport(), listSupport()] });
  it('indent needs an item above to nest under; outdent needs a nested item', () => {
    const doc = '- a\n- b\n  - c\n';
    expect(canIndentListItems(state(doc, 1))).toBe(false); // first item
    expect(canIndentListItems(state(doc, 6))).toBe(true); // b can go under a
    expect(canOutdentListItems(state(doc, 6))).toBe(false); // b is top level
    expect(canOutdentListItems(state(doc, 13))).toBe(true); // c is nested
    expect(canIndentListItems(state('just text', 3))).toBe(false);
    expect(canOutdentListItems(state('just text', 3))).toBe(false);
  });
});

suite('touch selection menu', () => {
  it('a long press (contextmenu after a touch) is left to the system, so the word gets selected', () => {
    const ed = make('hello ‸world');
    pointer(ed, 'touch');
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    ed.view.contentDOM.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it('a right click with a mouse still opens the floating menu', () => {
    const ed = make('hello ‸world');
    pointer(ed, 'mouse');
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    ed.view.contentDOM.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    expect(menu()!.classList.contains('cm-format-dock')).toBe(false);
    expect(button('Indent list item')).not.toBeNull(); // the right-click menu has Indent and Outdent too
    expect(button('Select all text')).not.toBeNull();
  });

  it('after a touch selection settles, the menu docks along the bottom with Indent and Outdent', () => {
    vi.useFakeTimers();
    const ed = make('- a\n- b\n  - c\n');
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 6, head: 7 } }); // "b"
    expect(menu()).toBeNull(); // not yet: the handles may still be moving
    vi.advanceTimersByTime(400);
    expect(menu()).not.toBeNull();
    expect(menu()!.classList.contains('cm-format-dock')).toBe(true);
    expect(button('Indent list item')!.getAttribute('aria-disabled')).toBe('false');
    expect(button('Outdent list item')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('Indent nests the selected item under the one above, Outdent undoes it', () => {
    vi.useFakeTimers();
    const ed = make('- a\n- b\n');
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 6, head: 7 } });
    vi.advanceTimersByTime(400);
    button('Indent list item')!.click();
    expect(ed.text()).toBe('- a\n  - b\n');
    vi.advanceTimersByTime(400);
    expect(button('Outdent list item')!.getAttribute('aria-disabled')).toBe('false');
    button('Outdent list item')!.click();
    expect(ed.text()).toBe('- a\n- b\n');
  });

  it('a disabled Indent button does nothing', () => {
    vi.useFakeTimers();
    const ed = make('- a\n- b\n');
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 2, head: 3 } }); // first item
    vi.advanceTimersByTime(400);
    button('Indent list item')!.click();
    expect(ed.text()).toBe('- a\n- b\n');
  });

  it('the docked menu goes away when the selection is dropped', () => {
    vi.useFakeTimers();
    const ed = make('hello world');
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 0, head: 5 } });
    vi.advanceTimersByTime(400);
    expect(menu()).not.toBeNull();
    ed.view.dispatch({ selection: { anchor: 3 } });
    expect(menu()).toBeNull();
  });

  it('a mouse selection does not bring up the docked menu', () => {
    vi.useFakeTimers();
    const ed = make('hello world');
    ed.view.focus();
    pointer(ed, 'mouse');
    ed.view.dispatch({ selection: { anchor: 0, head: 5 } });
    vi.advanceTimersByTime(400);
    expect(menu()).toBeNull();
  });
});

suite('apostrophes from the keyboard autocorrect', () => {
  const st = (doc: string, at = doc.length): EditorState => EditorState.create({ doc, selection: { anchor: at }, extensions: [markdownSupport()] });
  const fixed = (doc: string, at?: number): string => {
    const s = st(doc, at);
    const spec = curlyApostrophesBefore(s);
    return spec ? s.update(spec).state.doc.toString() : doc;
  };

  it('curls an apostrophe between letters in the word before the cursor', () => {
    expect(fixed("it's")).toBe('it\u2019s');
    expect(fixed("say don't")).toBe('say don\u2019t');
    expect(fixed("it's ")).toBe('it\u2019s '); // one trailing space
    expect(fixed("they're, we're")).toBe("they're, we\u2019re"); // only the last word
  });

  it('leaves alone what is not an apostrophe between letters', () => {
    expect(fixed("'tis")).toBe("'tis");
    expect(fixed("rock 'n'")).toBe("rock 'n'");
    expect(fixed("cats'")).toBe("cats'");
    expect(fixed('plain words')).toBe('plain words');
    expect(fixed("1'2")).toBe("1'2"); // digits are not letters
  });

  it('leaves code alone', () => {
    expect(fixed("`it's`", 5)).toBe("`it's`");
    expect(fixed("```\nit's", 8)).toBe("```\nit's");
  });

  it('after a keyboard commit (composition) the word gets its curly apostrophe', () => {
    vi.useFakeTimers();
    const ed = make('say ‸');
    ed.view.dispatch({ changes: { from: 4, insert: "it's" }, selection: { anchor: 8 }, userEvent: 'input.type.compose' });
    vi.advanceTimersByTime(10);
    expect(ed.text()).toBe('say it\u2019s');
  });

  it('pasted text is not rewritten', () => {
    vi.useFakeTimers();
    const ed = make('say ‸');
    ed.view.dispatch({ changes: { from: 4, insert: "it's" }, selection: { anchor: 8 }, userEvent: 'input.paste' });
    vi.advanceTimersByTime(10);
    expect(ed.text()).toBe("say it's");
  });

  it('does nothing when smart quotes are off', () => {
    vi.useFakeTimers();
    const ed = make('say ‸', { smartQuotes: false });
    ed.view.dispatch({ changes: { from: 4, insert: "it's" }, selection: { anchor: 8 }, userEvent: 'input.type.compose' });
    vi.advanceTimersByTime(10);
    expect(ed.text()).toBe("say it's");
  });
});

suite('touch: a selected word brings its synonyms', () => {
  it('shows them above the docked menu, and replaces the word when one is chosen', () => {
    vi.useFakeTimers();
    const ed = make('a big house', { thesaurus: { synonyms: (w) => (w === 'big' ? ['large', 'great'] : null) } });
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 2, head: 5 } }); // "big"
    vi.advanceTimersByTime(400);
    const items = [...document.querySelectorAll('.cm-synonym-list .cm-synonym')] as HTMLElement[];
    expect(items.map((i) => i.textContent)).toEqual(['large', 'great']);
    items[0]!.click();
    expect(ed.text()).toBe('a large house');
  });

  it('shows none when the selection is more than the one word', () => {
    vi.useFakeTimers();
    const ed = make('a big house', { thesaurus: { synonyms: (w) => (w === 'big' ? ['large'] : null) } });
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 2, head: 11 } });
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.cm-synonym-list')).toBeNull();
    expect(menu()).not.toBeNull();
  });
});

suite('touch: select all', () => {
  it('the docked menu has a Select all text that selects the whole page', () => {
    vi.useFakeTimers();
    const ed = make('first line\nsecond line\nthird line');
    ed.view.focus();
    pointer(ed, 'touch');
    ed.view.dispatch({ selection: { anchor: 0, head: 5 } });
    vi.advanceTimersByTime(400);
    const btn = [...document.querySelectorAll('.cm-format-dock .cm-format-btn')].find((b) => (b as HTMLElement).title === 'Select all text') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(ed.view.state.selection.main).toMatchObject({ from: 0, to: ed.text().length });
  });
});
