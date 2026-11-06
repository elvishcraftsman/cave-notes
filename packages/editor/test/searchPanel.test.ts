import { openSearchPanel, search } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { countLabel, countMatches, createSearchPanel } from '../src/searchPanel';
import { SearchQuery } from '@codemirror/search';

const make = (doc: string): EditorView => {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [search({ top: true, createPanel: createSearchPanel })] }), parent: document.body });
  openSearchPanel(view);
  return view;
};
const type = (view: EditorView, value: string): void => {
  const input = view.dom.querySelector<HTMLInputElement>('.cm-findbar input[name=search]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const count = (view: EditorView): string => view.dom.querySelector('.cm-find-count')!.textContent ?? '';

describe('find bar', () => {
  it('counts matches and says which one is selected', () => {
    const view = make('one two one three one');
    type(view, 'one');
    expect(count(view)).toBe('1 of 3');
    view.dom.querySelector<HTMLButtonElement>('button[name=next]')!.click();
    expect(count(view)).toBe('2 of 3');
    view.dom.querySelector<HTMLButtonElement>('button[name=next]')!.click();
    view.dom.querySelector<HTMLButtonElement>('button[name=next]')!.click();
    expect(count(view)).toBe('1 of 3');
    type(view, 'zzz');
    expect(count(view)).toBe('No results');
    type(view, '');
    expect(count(view)).toBe('');
    view.destroy();
  });

  it('keeps the close button in the row and follows the options', () => {
    const view = make('Aa aa');
    const row = view.dom.querySelector('.cm-find-row')!;
    expect(row.querySelector('button[name=close]')).not.toBeNull();
    type(view, 'aa');
    expect(count(view)).toBe('1 of 2');
    view.dom.querySelector<HTMLButtonElement>('button[name=case]')!.click();
    expect(count(view)).toBe('1 of 1');
    view.destroy();
  });

  it('has labels for the odd cases', () => {
    expect(countLabel({ total: 0, capped: false, current: 0 }, true, false)).toBe('Invalid pattern');
    expect(countLabel({ total: 5, capped: false, current: 0 }, true, true)).toBe('5 results');
    expect(countLabel({ total: 10000, capped: true, current: 0 }, true, true)).toBe('10000+ results');
    const s = EditorState.create({ doc: 'a a a' });
    expect(countMatches(s, new SearchQuery({ search: 'a' })).total).toBe(3);
  });
});

describe('find bar on a read-only page (the documentation)', () => {
  it('finds and counts, but has no replace row', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'one two one', extensions: [EditorState.readOnly.of(true), search({ top: true, createPanel: createSearchPanel })] }),
      parent: document.body,
    });
    openSearchPanel(view);
    type(view, 'one');
    expect(count(view)).toBe('1 of 2');
    const bar = view.dom.querySelector<HTMLElement>('.cm-findbar')!;
    expect(bar.classList.contains('cm-find-readonly')).toBe(true);
    expect(bar.querySelector<HTMLElement>('.cm-replace-row')!.hidden).toBe(true);
  });
});
