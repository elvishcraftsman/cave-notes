import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery,
} from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';

/** Most matches counted; beyond it the panel says "10000+". */
const COUNT_CAP = 10000;

export interface MatchCount {
  /** how many matches (capped) */
  total: number;
  capped: boolean;
  /** 1-based number of the match the selection is on, or 0 when it is on none */
  current: number;
}

/** Count the matches of the query in the document and find which one the selection is on. */
export function countMatches(state: import('@codemirror/state').EditorState, query: SearchQuery): MatchCount {
  if (!query.search || !query.valid) return { total: 0, capped: false, current: 0 };
  const sel = state.selection.main;
  const cur = query.getCursor(state) as unknown as Iterator<{ from: number; to: number }>;
  let total = 0;
  let current = 0;
  for (let r = cur.next(); !r.done; r = cur.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    if (total >= COUNT_CAP) return { total, capped: true, current };
  }
  return { total, capped: false, current };
}

/** The text of the counter: "3 of 12", "12 results", "No results" or nothing while the field is empty. */
export function countLabel(c: MatchCount, hasText: boolean, valid: boolean): string {
  if (!hasText) return '';
  if (!valid) return 'Invalid pattern';
  if (c.total === 0) return 'No results';
  const total = c.capped ? `${c.total}+` : String(c.total);
  return c.current > 0 ? `${c.current} of ${total}` : c.total === 1 ? '1 result' : `${total} results`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/**
 * The find and replace bar. Same engine as CodeMirror's own, but: it is drawn with the app's colours in both themes,
 * its close button sits in the row (never over the fields), and it says how many matches there are and which one the
 * selection is on. Typing selects the first match at or after the cursor, so the page follows the search.
 */
export function createSearchPanel(view: EditorView): Panel {
  const dom = el('div', 'cm-findbar');
  dom.addEventListener('keydown', (e) => onKey(e));

  const top = el('div', 'cm-find-row');
  const searchField = el('input', 'cm-find-input');
  searchField.type = 'text';
  searchField.name = 'search';
  searchField.placeholder = 'Find';
  searchField.setAttribute('aria-label', 'Find');
  searchField.setAttribute('main-field', 'true');
  searchField.spellcheck = false;
  const counter = el('span', 'cm-find-count');
  counter.setAttribute('aria-live', 'polite');

  const button = (name: string, label: string, title: string, run: () => void): HTMLButtonElement => {
    const b = el('button', 'cm-find-btn');
    b.type = 'button';
    b.name = name;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', run);
    return b;
  };
  const toggle = (name: string, label: string, title: string): HTMLButtonElement => {
    const b = button(name, label, title, () => {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      b.classList.toggle('on', b.getAttribute('aria-pressed') === 'true');
      commit(true);
    });
    b.setAttribute('aria-pressed', 'false');
    b.classList.add('cm-find-toggle');
    return b;
  };
  const prev = button('prev', '↑', 'Previous match (Shift+Enter)', () => findPrevious(view));
  const next = button('next', '↓', 'Next match (Enter)', () => findNext(view));
  const caseBtn = toggle('case', 'Aa', 'Match case');
  const reBtn = toggle('re', '.*', 'Regular expression');
  const wordBtn = toggle('word', 'W', 'Whole word');
  const close = button('close', '×', 'Close (Esc)', () => {
    closeSearchPanel(view);
    view.focus();
  });
  close.classList.add('cm-find-close');
  top.append(searchField, counter, prev, next, caseBtn, wordBtn, reBtn, close);

  const bottom = el('div', 'cm-find-row cm-replace-row');
  const replaceField = el('input', 'cm-find-input');
  replaceField.type = 'text';
  replaceField.name = 'replace';
  replaceField.placeholder = 'Replace with';
  replaceField.setAttribute('aria-label', 'Replace with');
  replaceField.spellcheck = false;
  const replaceOne = button('replace', 'Replace', 'Replace this match', () => replaceNext(view));
  const replaceEvery = button('replaceAll', 'Replace all', 'Replace every match', () => replaceAll(view));
  bottom.append(replaceField, replaceOne, replaceEvery);
  dom.append(top, bottom);

  const readOnly = (): boolean => view.state.readOnly;
  // a page that cannot be changed (the documentation) can be searched but not replaced in: no replace row
  if (readOnly()) {
    bottom.hidden = true;
    dom.classList.add('cm-find-readonly');
  }

  /** Put the fields' values into the editor's search state. `select` also moves to the first match at or after the cursor. */
  function commit(select: boolean): void {
    const q = new SearchQuery({
      search: searchField.value,
      caseSensitive: caseBtn.getAttribute('aria-pressed') === 'true',
      regexp: reBtn.getAttribute('aria-pressed') === 'true',
      wholeWord: wordBtn.getAttribute('aria-pressed') === 'true',
      replace: replaceField.value,
    });
    if (!q.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(q) });
    if (select) selectFirst(q);
    refresh();
  }

  function selectFirst(q: SearchQuery): void {
    if (!q.search || !q.valid) return;
    const from = view.state.selection.main.from;
    const cur = q.getCursor(view.state) as unknown as Iterator<{ from: number; to: number }>;
    let first: { from: number; to: number } | null = null;
    for (let r = cur.next(); !r.done; r = cur.next()) {
      first ??= r.value;
      if (r.value.from >= from) {
        first = r.value;
        break;
      }
    }
    if (!first) return;
    view.dispatch({ selection: EditorSelection.range(first.from, first.to), effects: EditorView.scrollIntoView(first.from, { y: 'center' }), userEvent: 'select.search' });
  }

  function refresh(): void {
    const q = getSearchQuery(view.state);
    const c = countMatches(view.state, q);
    counter.textContent = countLabel(c, q.search !== '', q.valid);
    counter.classList.toggle('none', q.search !== '' && (c.total === 0 || !q.valid));
    searchField.classList.toggle('bad', q.search !== '' && !q.valid);
    replaceOne.disabled = replaceEvery.disabled = readOnly() || c.total === 0;
    replaceField.disabled = readOnly();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearchPanel(view);
      view.focus();
    } else if (e.key === 'Enter' && e.target === searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === 'Enter' && e.target === replaceField) {
      e.preventDefault();
      if (!readOnly()) replaceNext(view);
    } else if ((e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g')) && !e.altKey) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    }
    if (e.key !== 'Tab') e.stopPropagation();
  }

  searchField.addEventListener('input', () => commit(true));
  replaceField.addEventListener('input', () => commit(false));

  const sync = (): void => {
    const q = getSearchQuery(view.state);
    if (searchField.value !== q.search) searchField.value = q.search;
    if (replaceField.value !== q.replace) replaceField.value = q.replace;
    for (const [b, on] of [[caseBtn, q.caseSensitive], [reBtn, q.regexp], [wordBtn, q.wholeWord]] as const) {
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    }
    refresh();
  };
  sync();

  return {
    dom,
    top: true,
    mount() {
      searchField.select();
    },
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) sync();
    },
  };
}
