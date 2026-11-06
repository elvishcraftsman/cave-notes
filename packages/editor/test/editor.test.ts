import { describe, expect, it, vi } from 'vitest';
import { NoteEditor, toggleWrap } from '../src/index';

function make(opts: Partial<ConstructorParameters<typeof NoteEditor>[0]> = {}): { ed: NoteEditor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return { ed: new NoteEditor({ parent: el, ...opts }), el };
}

describe('NoteEditor', () => {
  it('loads text, reports changes and the outline', () => {
    const onChange = vi.fn();
    const onOutline = vi.fn();
    const { ed } = make({ onChange, onOutline });
    ed.load('# Title\n\n## Sub\n');
    expect(ed.text()).toBe('# Title\n\n## Sub\n');
    expect(onOutline).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ text: 'Title' })]));
    ed.view.dispatch({ changes: { from: ed.text().length, insert: '\n## More' } });
    expect(onChange).toHaveBeenLastCalledWith('# Title\n\n## Sub\n\n## More');
    expect(ed.outline().map((h) => h.text)).toEqual(['Title', 'Sub', 'More']);
    ed.destroy();
  });

  it('keeps separate undo history per state', () => {
    const { ed } = make();
    ed.load('one');
    ed.view.dispatch({ changes: { from: 3, insert: ' two' } });
    const saved = ed.state;
    ed.load('other page');
    expect(ed.text()).toBe('other page');
    ed.setState(saved);
    expect(ed.text()).toBe('one two');
    ed.destroy();
  });

  it('scrolls to a heading by link fragment', () => {
    const { ed } = make();
    ed.load('# A\n\ntext\n\n## Target Heading\n\nmore');
    expect(ed.scrollToHeading('target-heading')).toBe(true);
    expect(ed.state.doc.lineAt(ed.state.selection.main.head).text).toBe('## Target Heading');
    expect(ed.scrollToHeading('missing')).toBe(false);
    ed.destroy();
  });

  it('renders hidden syntax in the DOM when the cursor is elsewhere', () => {
    const { ed, el } = make();
    ed.load('# Title\n\nSome **bold** text');
    ed.view.dispatch({ selection: { anchor: ed.text().length } });
    expect(el.querySelector('.cm-h1')).not.toBeNull();
    expect(el.querySelector('.cm-strong')?.textContent).toBe('bold');
    expect(el.textContent).not.toContain('**');
    expect(el.textContent).not.toContain('# Title');
    expect(el.textContent).not.toContain('**'); // unfocused: nothing is revealed
    ed.view.dispatch({ selection: { anchor: 2 } });
    expect(el.textContent).not.toContain('# Title');
    ed.focus();
    ed.view.dispatch({ selection: { anchor: 3 } }); // focused, with the cursor in the heading: its marker shows
    expect(el.textContent).toContain('# Title');
    ed.destroy();
  });

  it('toggles a task checkbox when its widget is clicked', () => {
    const { ed, el } = make();
    ed.load('- [ ] buy milk\n\n');
    ed.view.dispatch({ selection: { anchor: ed.text().length } });
    const box = el.querySelector('input.cm-task-checkbox') as HTMLInputElement;
    expect(box).not.toBeNull();
    box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ed.text()).toBe('- [x] buy milk\n\n');
    (el.querySelector('input.cm-task-checkbox') as HTMLInputElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ed.text()).toBe('- [ ] buy milk\n\n');
    ed.destroy();
  });

  it('restyles links when statuses change', () => {
    let status: 'ok' | 'broken' = 'ok';
    const { ed, el } = make({ linkStatus: () => status });
    ed.load('[[Page]] and more text\n\nend');
    ed.view.dispatch({ selection: { anchor: ed.text().length } });
    expect(el.querySelector('.cm-wikilink-broken')).toBeNull();
    status = 'broken';
    ed.refreshLinks();
    expect(el.querySelector('.cm-wikilink-broken')?.textContent).toBe('Page');
    ed.destroy();
  });

  it('Ctrl+S calls onSave', () => {
    const onSave = vi.fn();
    const { ed, el } = make({ onSave });
    ed.load('x');
    ed.focus();
    el.querySelector('.cm-content')?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSave).toHaveBeenCalledTimes(1);
    ed.destroy();
  });
});

describe('toggleWrap', () => {
  const run = (doc: string, from: number, to: number, marker: string): { text: string; from: number; to: number } => {
    const { ed } = make();
    ed.load(doc);
    ed.view.dispatch({ selection: { anchor: from, head: to } });
    toggleWrap(marker)(ed.view);
    const r = ed.state.selection.main;
    const out = { text: ed.text(), from: r.from, to: r.to };
    ed.destroy();
    return out;
  };

  it('wraps a selection and keeps it selected', () => {
    expect(run('make bold now', 5, 9, '**')).toEqual({ text: 'make **bold** now', from: 7, to: 11 });
  });

  it('unwraps when the surrounding markers are present', () => {
    expect(run('make **bold** now', 7, 11, '**')).toEqual({ text: 'make bold now', from: 5, to: 9 });
  });

  it('unwraps when the selection includes the markers', () => {
    expect(run('make **bold** now', 5, 13, '**').text).toBe('make bold now');
  });

  it('inserts a pair at an empty cursor', () => {
    expect(run('x ', 2, 2, '*')).toEqual({ text: 'x **', from: 3, to: 3 });
  });
});

describe('NoteEditor plain mode (settings files)', () => {
  const yaml = '# Comment, not a title\nstatus:\n  options: [open, done]\n- item\n';

  it('shows a settings file as plain text: no outline, no title, no Markdown styling', () => {
    const onOutline = vi.fn();
    const { ed, el } = make({ onOutline });
    ed.load(yaml, { plain: true });
    expect(ed.isPlain).toBe(true);
    expect(ed.text()).toBe(yaml);
    expect(ed.outline()).toEqual([]);
    expect(ed.firstH1()).toBeNull();
    expect(onOutline).toHaveBeenLastCalledWith([]);
    expect(el.querySelector('.cm-heading, .cm-h1, [class*="heading"]')).toBeNull();
    // the text can be edited, and edits keep reporting an empty outline
    ed.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(onOutline).toHaveBeenLastCalledWith([]);
  });

  it('goes back to Markdown for the next page, and a saved plain state stays plain', () => {
    const { ed } = make();
    ed.load(yaml, { plain: true });
    const saved = ed.state;
    ed.load('# Title\n\ntext');
    expect(ed.isPlain).toBe(false);
    expect(ed.outline().length).toBe(1);
    ed.setState(saved);
    expect(ed.isPlain).toBe(true);
    expect(ed.outline()).toEqual([]);
  });

  it('has no formatting menu or attribute bar', async () => {
    const { ed, el } = make();
    ed.load(yaml, { plain: true });
    ed.view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.cm-format-menu')).toBeNull();
    expect(el.querySelector('.cm-attrbar')).toBeNull();
  });
});
