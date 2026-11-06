import { describe as suite, expect, it } from 'vitest';
import { activeFormats, NoteEditor, toggleBlock, toggleInline } from '../src/index';
import { runScopeHandlers } from '@codemirror/view';

function make(text: string, lists: ConstructorParameters<typeof NoteEditor>[0]['lists'] = {}): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, lists });
  const a = text.indexOf('‸');
  const b = text.lastIndexOf('‸');
  const plain = text.replaceAll('‸', '');
  ed.load(plain);
  if (a >= 0) ed.view.dispatch({ selection: a === b ? { anchor: a } : { anchor: a, head: b - 1 } });
  return ed;
}
const press = (ed: NoteEditor, key: string): void => {
  runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');
};

suite('inline formats', () => {
  it('report and toggle bold, italic, strike, code and links', () => {
    const ed = make('say ‸hello‸ there');
    expect(activeFormats(ed.state).inline.size).toBe(0);
    toggleInline(ed.view, 'bold');
    expect(ed.text()).toBe('say **hello** there');
    expect(activeFormats(ed.state).inline.has('bold')).toBe(true);
    toggleInline(ed.view, 'italic');
    expect(ed.text()).toBe('say ***hello*** there');
    expect([...activeFormats(ed.state).inline].sort()).toEqual(['bold', 'italic']);
    toggleInline(ed.view, 'bold');
    expect(ed.text()).toBe('say *hello* there');
    toggleInline(ed.view, 'italic');
    expect(ed.text()).toBe('say hello there');
    toggleInline(ed.view, 'strike');
    expect(ed.text()).toBe('say ~~hello~~ there');
    expect(activeFormats(ed.state).inline.has('strike')).toBe(true);
    toggleInline(ed.view, 'strike');
    toggleInline(ed.view, 'code');
    expect(ed.text()).toBe('say `hello` there');
    toggleInline(ed.view, 'code');
    toggleInline(ed.view, 'link');
    expect(ed.text()).toBe('say [hello]() there');
  });

  it('turns a link back into its text', () => {
    const ed = make('see [‸text‸](http://x.y) now');
    expect(activeFormats(ed.state).inline.has('link')).toBe(true);
    toggleInline(ed.view, 'link');
    expect(ed.text()).toBe('see text now');
  });

  it('works on the word at a bare cursor', () => {
    const ed = make('one tw‸o three');
    toggleInline(ed.view, 'bold');
    expect(ed.text()).toBe('one **two** three');
  });
});

suite('block formats', () => {
  it('toggles headings, quotes and plain paragraphs', () => {
    const ed = make('‸title');
    toggleBlock(ed.view, 'h2');
    expect(ed.text()).toBe('## title');
    expect(activeFormats(ed.state).block.has('h2')).toBe(true);
    toggleBlock(ed.view, 'h3');
    expect(ed.text()).toBe('### title');
    toggleBlock(ed.view, 'h3');
    expect(ed.text()).toBe('title');
    toggleBlock(ed.view, 'quote');
    expect(ed.text()).toBe('> title');
    expect(activeFormats(ed.state).block.has('quote')).toBe(true);
    toggleBlock(ed.view, 'quote');
    expect(ed.text()).toBe('title');
  });

  it('turns lines into lists of each kind and back', () => {
    const ed = make('‸a\nb\nc‸');
    toggleBlock(ed.view, 'bullet');
    expect(ed.text()).toBe('- a\n- b\n- c');
    expect(activeFormats(ed.state).block.has('bullet')).toBe(true);
    toggleBlock(ed.view, 'decimal');
    expect(ed.text()).toBe('1. a\n2. b\n3. c');
    toggleBlock(ed.view, 'alpha');
    expect(ed.text()).toBe('a. a\nb. b\nc. c');
    toggleBlock(ed.view, 'ROMAN');
    expect(ed.text()).toBe('I. a\nII. b\nIII. c');
    expect(activeFormats(ed.state).block.has('ROMAN')).toBe(true);
    toggleBlock(ed.view, 'ROMAN');
    expect(ed.text()).toBe('a\nb\nc');
    toggleBlock(ed.view, 'task');
    expect(ed.text()).toBe('- [ ] a\n- [ ] b\n- [ ] c');
    expect(activeFormats(ed.state).block.has('task')).toBe(true);
  });

  it('wraps and unwraps code blocks', () => {
    const ed = make('‸x');
    toggleBlock(ed.view, 'codeblock');
    expect(ed.text()).toBe('```\nx\n```');
    toggleBlock(ed.view, 'codeblock');
    expect(ed.text()).toBe('x');
  });
});

suite('hierarchical lists', () => {
  it('restyles a list tree by level when made hierarchical, and plain again when toggled off', () => {
    const ed = make('1. a\n   1. b\n      1. c‸');
    toggleBlock(ed.view, 'decimal-h');
    expect(ed.text()).toBe('1. a\n   a. b\n      i. c');
    expect(activeFormats(ed.state).block.has('decimal-h')).toBe(true);
    toggleBlock(ed.view, 'decimal-h');
    expect(ed.text()).toBe('1. a\n   1. b\n      1. c');
  });

  it('uses the styles the user defined', () => {
    const ed = make('1. a\n   1. b‸', { orderedStyles: ['I.', 'A.'] });
    toggleBlock(ed.view, 'decimal-h');
    expect(ed.text()).toBe('I. a\n   A. b');
  });

  it('with the default on, Tab and Shift-Tab give an item the style of its level', () => {
    const ed = make('1. a\n2. b‸\n3. c', { hierarchicalDefault: true });
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. a\n   a. b\n2. c');
    const el = ed.view;
    el.dispatch({ selection: { anchor: ed.text().indexOf('b') } });
    runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }), 'editor');
    expect(ed.text()).toBe('1. a\n2. b\n3. c');
  });

  it('without the default, nesting keeps the marker', () => {
    const ed = make('1. a\n2. b‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. a\n   1. b');
  });

  it('changes bullets by level and draws them differently', () => {
    const ed = make('- a\n  - b\n    - c‸');
    toggleBlock(ed.view, 'bullet-h');
    expect(ed.text()).toBe('- a\n  * b\n    + c');
    expect(activeFormats(ed.state).block.has('bullet-h')).toBe(true);
  });
});

suite('the menu', () => {
  it('opens on right-click with the applied formats pressed, and a click toggles', async () => {
    const { showFormatMenu } = await import('../src/index');
    const ed = make('say ‸**hi**‸ there');
    ed.view.dispatch({ selection: { anchor: 6, head: 8 } });
    showFormatMenu(ed.view, 10, 10);
    const menu = document.querySelector('.cm-format-menu')!;
    const btn = (f: string): HTMLElement => menu.querySelector<HTMLElement>(`[data-format="${f}"]`)!;
    expect(btn('bold').getAttribute('aria-pressed')).toBe('true');
    expect(btn('italic').getAttribute('aria-pressed')).toBe('false');
    // icons, not words: the names are in the tooltips and labels
    expect(btn('code').textContent).toBe('');
    expect(btn('code').title).toContain('Ctrl+E');
    btn('bold').click();
    expect(ed.text()).toBe('say hi there');
    expect(document.querySelector('.cm-format-menu')).toBeNull();
  });

  it('has drop-downs beside the list buttons for the variants', async () => {
    const { showFormatMenu } = await import('../src/index');
    const ed = make('first‸');
    showFormatMenu(ed.view, 10, 10);
    const menu = document.querySelector('.cm-format-menu')!;
    const carets = menu.querySelectorAll<HTMLElement>('.cm-format-caret');
    expect(carets.length).toBe(2);
    expect(document.querySelector('.cm-format-sub')).toBeNull();
    carets[1]!.click(); // numbered lists
    const items = [...document.querySelectorAll<HTMLElement>('.cm-format-sub-item')].map((i) => i.dataset.format);
    expect(items).toEqual(['decimal', 'decimal-h', 'alpha', 'ALPHA', 'roman', 'ROMAN']);
    document.querySelector<HTMLElement>('.cm-format-sub-item[data-format="roman"]')!.click();
    expect(ed.text()).toMatch(/^i\. first/);
    expect(document.querySelector('.cm-format-menu')).toBeNull();
  });

  it('shows the heading level in use and offers the others', async () => {
    const { showFormatMenu } = await import('../src/index');
    const ed = make('## Title‸');
    showFormatMenu(ed.view, 10, 10);
    const heading = document.querySelector<HTMLElement>('.cm-format-heading')!;
    expect(heading.textContent).toBe('H2');
    heading.click();
    expect(document.querySelector('.cm-format-sub-item[data-format="h2"]')!.getAttribute('aria-checked')).toBe('true');
    document.querySelector<HTMLElement>('.cm-format-sub-item[data-format="h3"]')!.click();
    expect(ed.text()).toBe('### Title');
  });

  it('closes the list first and the bar second on Escape', async () => {
    const { showFormatMenu } = await import('../src/index');
    const ed = make('x‸');
    showFormatMenu(ed.view, 10, 10);
    await new Promise((r) => setTimeout(r, 5));
    document.querySelector<HTMLElement>('.cm-format-heading')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cm-format-sub')).toBeNull();
    expect(document.querySelector('.cm-format-menu')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cm-format-menu')).toBeNull();
  });
});

suite('a task list is not also a bulleted list', () => {
  it('reports task alone for a task item and bullet alone for a plain one', () => {
    const task = make('- [ ] a‸');
    expect([...activeFormats(task.state).block]).toContain('task');
    expect([...activeFormats(task.state).block]).not.toContain('bullet');
    const plain = make('- b‸');
    expect([...activeFormats(plain.state).block]).toContain('bullet');
  });
});
