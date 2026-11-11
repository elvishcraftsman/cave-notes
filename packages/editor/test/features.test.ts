import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';
import { describe } from './helpers';

function make(text = ''): { ed: NoteEditor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text);
  return { ed, el };
}

/** Type like the browser does: the editor's input handlers first (in order), then plain insertion. */
function type(ed: NoteEditor, text: string): void {
  for (const ch of text) {
    const { from, to } = ed.state.selection.main;
    const handlers = ed.state.facet(EditorView.inputHandler);
    if (handlers.some((h) => h(ed.view, from, to, ch, () => ed.state.update({ changes: { from, to, insert: ch } })))) continue;
    ed.view.dispatch(ed.state.update(ed.state.replaceSelection(ch), { userEvent: 'input.type' }));
  }
}

suite('lists', () => {
  it('marks list lines, with a deeper indent for each nesting level', async () => {
    const { computeDecorations } = await import('../src/index');
    const { EditorState, EditorSelection } = await import('@codemirror/state');
    const { markdownSupport } = await import('../src/index');
    const doc = '- one\n  more of one\n  - two\n    - three';
    const state = EditorState.create({ doc: doc + '\n\n', selection: EditorSelection.cursor(doc.length + 2), extensions: [markdownSupport()] });
    const set = computeDecorations(state, [{ from: 0, to: state.doc.length }]);
    const styles = new Map<number, string>();
    const marks: string[] = [];
    set.between(0, state.doc.length, (from, to, v) => {
      const spec = v.spec as { class?: string; attributes?: { style?: string } };
      if (v.constructor.name === 'LineDecoration' && spec.class?.includes('cm-li')) styles.set(state.doc.lineAt(from).number, spec.attributes?.style ?? '');
      if (v.constructor.name === 'MarkDecoration') marks.push(`${spec.class}:${JSON.stringify(state.doc.sliceString(from, to))}`);
    });
    expect(styles.get(1)).toBe('padding-left:1.4em;text-indent:-1.4em');
    // a continued line of "one" lines up with the text of its first line: same left padding, no hanging
    expect(styles.get(2)).toBe('padding-left:1.4em;');
    expect(styles.get(3)).toBe('padding-left:2.8em;text-indent:-1.4em');
    expect(styles.get(4)).toBe('padding-left:4.2em;text-indent:-1.4em');
    // leading spaces collapse, and the marker plus its space is the fixed-width prefix
    expect(marks).toContain('cm-list-indent:"  "');
    expect(marks).toContain('cm-list-indent:"    "');
    // the cursor is on the last line, so the first lines draw their bullet; its space is hidden
    expect(marks.filter((m) => m.startsWith('cm-list-prefix'))).toEqual([]);
  });

  it('gives numbered markers the room bullets get, and tasks room for the checkbox', async () => {
    const { computeDecorations, markdownSupport } = await import('../src/index');
    const { EditorState, EditorSelection } = await import('@codemirror/state');
    const doc = '1. a\n- [ ] b\n\n';
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [markdownSupport()] });
    const styles: string[] = [];
    computeDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (_f, _t, v) => {
      const spec = v.spec as { class?: string; attributes?: { style?: string } };
      if (v.constructor.name === 'LineDecoration' && spec.class?.includes('cm-li-first')) styles.push(spec.attributes?.style ?? '');
    });
    expect(styles[0]).toBe('padding-left:1.4em;text-indent:-1.4em');
    expect(styles[1]).toBe('padding-left:1.5em;text-indent:-1.5em');
  });
});

suite('code fences', () => {
  it('typing the third backtick adds the closing fence on the next line', () => {
    const { ed } = make('');
    type(ed, '```');
    expect(ed.text()).toBe('```\n```');
    expect(ed.state.selection.main.head).toBe(3);
    type(ed, 'js');
    expect(ed.text()).toBe('```js\n```');
  });

  it('does not add a second fence when one already follows', () => {
    const { ed } = make('\n```\nx\n```');
    ed.view.dispatch({ selection: { anchor: 0 } });
    type(ed, '```');
    expect(ed.text()).toBe('```\n```\nx\n```');
  });
});

suite('closing partners are only written beside white space', () => {
  const at = (ed: NoteEditor, pos: number): void => ed.view.dispatch({ selection: { anchor: pos } });

  it('writes the pair on an empty line, after a space and before a space', () => {
    const a = make('');
    type(a.ed, '(');
    expect(a.ed.text()).toBe('()');
    const b = make('a  b');
    at(b.ed, 2);
    type(b.ed, '`');
    expect(b.ed.text()).toBe('a `` b');
  });

  it('writes only the typed character before other text', () => {
    for (const [ch, doc] of [['`', 'word'], ['(', 'word'], ['[', 'word'], ['{', 'word'], ['`', ')'], ['(', ')'], ['`', '.']] as const) {
      const { ed } = make(doc);
      at(ed, 0);
      type(ed, ch);
      expect(ed.text()).toBe(ch + doc);
    }
  });

  it('a tick right after a word or punctuation is alone as well', () => {
    const { ed } = make('word');
    at(ed, 4);
    type(ed, '`');
    expect(ed.text()).toBe('word`');
    const e2 = make('(');
    at(e2.ed, 1);
    type(e2.ed, '`');
    expect(e2.ed.text()).toBe('(`');
  });

  it('a double quote before a closing bracket is a single curly quote', () => {
    const { ed } = make('()');
    at(ed, 1);
    type(ed, '"');
    expect(ed.text()).toBe('(\u201C)');
  });

  it('typing three ticks above a line of text does not add a closing fence', () => {
    const { ed } = make('\ncode here');
    at(ed, 0);
    type(ed, '```');
    expect(ed.text()).toBe('```\ncode here');
    // a blank line between: the fence still closes
    const b = make('\n\ncode');
    at(b.ed, 0);
    type(b.ed, '```');
    expect(b.ed.text()).toBe('```\n```\n\ncode');
  });
});

suite('the formatting shortcuts at the end of a span', () => {
  const press = (ed: NoteEditor, key: string): void => {
    ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
  };
  const cursorAt = (text: string): { ed: NoteEditor } => {
    const pos = text.indexOf('‸');
    const { ed } = make(text.replace('‸', ''));
    ed.view.dispatch({ selection: { anchor: pos } });
    return { ed };
  };

  it('Ctrl+I just inside the closing * moves the cursor past it', () => {
    const { ed } = cursorAt('say *hello‸* now');
    press(ed, 'i');
    expect(ed.text()).toBe('say *hello* now');
    expect(ed.state.selection.main.head).toBe(11);
  });

  it('works for bold, strikethrough and code, too', () => {
    for (const [doc, key, expectHead] of [['**bold‸** x', 'b', 8], ['~~gone‸~~ x', 'X', 8], ['`code‸` x', 'e', 6]] as const) {
      const { ed } = cursorAt(doc);
      if (key === 'X') ed.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      else press(ed, key);
      expect(ed.text()).toBe(doc.replace('‸', ''));
      expect(ed.state.selection.main.head).toBe(expectHead);
    }
  });

  it('inside bold, Ctrl+I at the end does not jump into the middle of the closing **', () => {
    const { ed } = cursorAt('**bold‸**');
    press(ed, 'i');
    expect(ed.text()).not.toBe('**bold**');
  });
});

suite('attributes bar', () => {
  it('shows an Add attributes button and an info button above the text, only when there are no attributes', () => {
    const { ed, el } = make('# Title\n');
    expect(el.querySelector('.cm-attr-add')).not.toBeNull();
    expect(el.querySelector('.cm-attr-info')).not.toBeNull();
    ed.load('---\nstatus: draft\n---\n# Title\n');
    expect(el.querySelector('.cm-attr-add')).toBeNull();
    expect(el.querySelector('.cm-attr-info')).not.toBeNull();
  });

  it('clicking Add attributes writes a frontmatter block with an empty line and puts the cursor there', () => {
    const { ed, el } = make('# Title\n');
    (el.querySelector('.cm-attr-add') as HTMLElement).click();
    expect(ed.text()).toBe('---\n\n---\n# Title\n');
    expect(ed.state.selection.main.head).toBe(4);
    expect(ed.hasAttributes()).toBe(true);
    expect(ed.addAttributes()).toBe(false);
  });

  it('the info button opens and closes the syntax help', () => {
    const { el } = make('# Title\n');
    const info = el.querySelector('.cm-attr-info') as HTMLElement;
    expect(el.querySelector('.cm-attr-help')).toBeNull();
    info.click();
    const help = el.querySelector('.cm-attr-help');
    expect(help?.textContent).toContain('defaults: inherit');
    expect(help?.textContent).toContain('hidden: all');
    (el.querySelector('.cm-attr-info') as HTMLElement).click();
    expect(el.querySelector('.cm-attr-help')).toBeNull();
  });
});

suite('cursor placement', () => {
  it('focusEnd puts the cursor under the title of a new page', () => {
    const { ed } = make('# New\n\n');
    ed.focusEnd();
    expect(ed.state.selection.main.head).toBe(ed.text().length);
    expect(ed.state.doc.lineAt(ed.state.selection.main.head).number).toBe(3);
  });
});

suite('Enter at the start of a list item', () => {
  const press = (ed: NoteEditor): void => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    runScopeHandlers(ed.view, ev, 'editor');
  };
  it('leaves an empty item above, with the space after its marker', () => {
    for (const [doc, pos, want] of [
      ['- foo', 2, '- \n- foo'],
      ['1. foo', 3, '1. \n2. foo'],
      ['- [ ] foo', 6, '- [ ] \n- [ ] foo'],
      ['  - foo', 4, '  - \n  - foo'],
    ] as Array<[string, number, string]>) {
      const { ed } = make(doc);
      ed.view.dispatch({ selection: { anchor: pos } });
      press(ed);
      expect(ed.text()).toBe(want);
      // the cursor stays with the pushed-down text
      expect(ed.state.doc.lineAt(ed.state.selection.main.head).text.trim().endsWith('foo')).toBe(true);
    }
  });
  it('still splits an item in the middle as before', () => {
    const { ed } = make('- foo bar');
    ed.view.dispatch({ selection: { anchor: 6 } });
    press(ed);
    expect(ed.text()).toBe('- foo\n- bar');
  });
});

suite('dashes', () => {
  it('two hyphens make an en dash and three an em dash', () => {
    const { ed } = make('word');
    ed.view.dispatch({ selection: { anchor: 4 } });
    type(ed, '--');
    expect(ed.text()).toBe('word\u2013');
    type(ed, '-');
    expect(ed.text()).toBe('word\u2014');
    type(ed, '-');
    expect(ed.text()).toBe('word\u2014-');
  });

  it('undo gives the hyphens back', async () => {
    const { undo } = await import('@codemirror/commands');
    const { ed } = make('a ');
    ed.view.dispatch({ selection: { anchor: 2 } });
    type(ed, '--');
    expect(ed.text()).toBe('a \u2013');
    undo(ed.view);
    expect(ed.text()).toBe('a --');
  });

  it('leaves rules, frontmatter fences, tables and code alone', () => {
    const rule = make('');
    type(rule.ed, '---');
    expect(rule.ed.text()).toBe('---');
    const table = make('| a |\n| ');
    table.ed.view.dispatch({ selection: { anchor: table.ed.text().length } });
    type(table.ed, '---');
    expect(table.ed.text()).toBe('| a |\n| ---');
    const code = make('`x`');
    code.ed.view.dispatch({ selection: { anchor: 2 } });
    type(code.ed, '--');
    expect(code.ed.text()).toBe('`x--`');
    const fence = make('```\nx');
    fence.ed.view.dispatch({ selection: { anchor: fence.ed.text().length } });
    type(fence.ed, '--');
    expect(fence.ed.text()).toBe('```\nx--');
  });

  it('works after a list marker', () => {
    const { ed } = make('- a');
    ed.view.dispatch({ selection: { anchor: 3 } });
    type(ed, '--');
    expect(ed.text()).toBe('- a\u2013');
  });
});

suite('nested list alignment', () => {
  it('starts a nested item where the text of the item above it starts, for numbered and bulleted lists alike', async () => {
    const { computeDecorations, markdownSupport } = await import('../src/index');
    const { EditorState, EditorSelection } = await import('@codemirror/state');
    const doc = '1. one\n   1. two\n- bullet\n  - sub\n\n';
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [markdownSupport()] });
    const pad = new Map<number, number>();
    computeDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, _t, v) => {
      const style = (v.spec as { attributes?: { style?: string } }).attributes?.style;
      const m = style && /padding-left:([\d.]+)em/.exec(style);
      if (v.constructor.name === 'LineDecoration' && m) pad.set(state.doc.lineAt(from).number, parseFloat(m[1]!));
    });
    // "two" is nested one marker column in from "one", and its own text starts one more column in
    expect(pad.get(1)).toBe(1.4);
    expect(pad.get(2)).toBe(2.8);
    expect(pad.get(3)).toBe(1.4);
    expect(pad.get(4)).toBe(2.8);
  });
});

suite('YAML settings files', () => {
  it('are coloured as YAML, and a mistake is flagged', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el });
    ed.load('# a comment\nschema:\n  due: { type: date }\n  on: true\n', { plain: true });
    expect(el.querySelector('.cm-y-key')).not.toBeNull();
    expect(el.querySelector('.cm-y-comment')).not.toBeNull();
    expect(el.querySelector('.cm-yaml-bad')).toBeNull();
    ed.load('schema:\n  due: [unclosed\n', { plain: true });
    expect(el.querySelector('.cm-yaml-bad')).not.toBeNull();
  });
});

suite('accidental double capitals', () => {
  const typeWord = (ed: NoteEditor, text: string): string => {
    ed.load('');
    ed.view.focus();
    for (const ch of text) {
      const p = ed.view.state.selection.main.head;
      // run the editor's input handlers the way the browser's typing does
      const handled = ed.view.state.facet(EditorView.inputHandler).some((h) => h(ed.view, p, p, ch, () => ed.view.state.update({ changes: { from: p, insert: ch } })));
      if (!handled) ed.view.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + ch.length } });
    }
    return ed.text();
  };
  const make2 = (opts: Partial<ConstructorParameters<typeof NoteEditor>[0]> = {}): NoteEditor => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new NoteEditor({ parent: el, ...opts });
  };
  it('THis becomes This when the word ends, but HIs, PCs and MHz stay', () => {
    const ed = make2();
    expect(typeWord(ed, 'THis is fine ')).toBe('This is fine ');
    expect(typeWord(ed, 'HIs PCs MHz OK ')).toBe('HIs PCs MHz OK ');
    expect(typeWord(ed, 'THe end.')).toBe('The end.');
    expect(typeWord(ed, 'the iPhone McDonald NASA ')).toBe('the iPhone McDonald NASA ');
  });
  it('is left alone in code, in addresses and when switched off', () => {
    const ed = make2();
    expect(typeWord(ed, '`THis ')).not.toContain('This');
    expect(typeWord(ed, 'file.THis ')).toBe('file.THis ');
    const off = make2({ fixCapitals: false });
    expect(typeWord(off, 'THis ')).toBe('THis ');
    ed.setFixCapitals(false);
    expect(typeWord(ed, 'THis ')).toBe('THis ');
  });
});

suite('<!-- closes itself', () => {
  const typeKeys = (text: string, start = ''): { text: string; head: number } => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el });
    ed.load(start);
    ed.view.dispatch({ selection: { anchor: start.length } });
    for (const ch of text) {
      const p = ed.view.state.selection.main.head;
      const handled = ed.view.state.facet(EditorView.inputHandler).some((h) => h(ed.view, p, p, ch, () => ed.view.state.update({ changes: { from: p, insert: ch } })));
      if (!handled) ed.view.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + ch.length } });
    }
    return { text: ed.text(), head: ed.view.state.selection.main.head };
  };
  it('writes " -->" after the cursor when the comment is opened', () => {
    expect(typeKeys('<!--')).toEqual({ text: '<!-- -->', head: 4 });
    expect(typeKeys('<!-- note')).toEqual({ text: '<!-- note -->', head: 9 });
  });
  it('does not do it twice, or for other dashes', () => {
    expect(typeKeys('a --').text).not.toContain('-->');
    expect(typeKeys('-', '<!-- x\n<!')).toEqual(expect.objectContaining({ text: '<!-- x\n<!-' }));
  });
});

suite('wikilink brackets', () => {
  const typeAt = (ed: NoteEditor, ch: string): void => {
    const sel = ed.state.selection.main;
    const handled = ed.state
      .facet(EditorView.inputHandler)
      .some((h) => h(ed.view, sel.from, sel.to, ch, () => ed.state.update({ changes: { from: sel.from, to: sel.to, insert: ch } })));
    if (!handled) ed.view.dispatch({ changes: { from: sel.from, to: sel.to, insert: ch }, selection: { anchor: sel.from + ch.length } });
  };
  it('typing the second [ closes the link too', () => {
    const { ed } = make('');
    typeAt(ed, '[');
    typeAt(ed, '[');
    expect(ed.text()).toBe('[[]]');
  });
});
