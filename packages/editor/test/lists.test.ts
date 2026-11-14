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

suite('Tab and Shift-Tab in lists', () => {
  it('nest a numbered item under the one above, by the width of its marker, and take the same step back', () => {
    const ed = make('1. a\n2. b‸\n3. c');
    press(ed, 'Tab');
    // "b" is now the first item of a list under "a": 3 spaces, and numbered from 1; "c" follows "a" again
    expect(ed.text()).toBe('1. a\n   1. b\n2. c');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('1. a\n2. b\n3. c');
  });

  it('use two spaces under a bullet, and leave the sub-items where they are', () => {
    const ed = make('- a\n- b‸\n  - b1\n- c');
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n  - b\n  - b1\n- c');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('- a\n- b\n  - b1\n- c');
  });

  it('move only the selected items, and take the selected sub-items along with their item', () => {
    const ed = make('- a\n- b\n  - b1\n- c');
    ed.view.dispatch({ selection: { anchor: 6, head: 15 } });
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n  - b\n    - b1\n- c');
  });

  it('move the first item of a nested list further in when it has nothing above it', () => {
    const ed = make('- a\n  - b\n  - c\n- d');
    ed.view.dispatch({ selection: { anchor: 6, head: 15 } }); // b and c
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n    - b\n    - c\n- d');
    press(ed, 'Tab'); // as deep as a code block would be: stays
    expect(ed.text()).toBe('- a\n    - b\n    - c\n- d');
  });

  it('keep numbering when the item joins a nested list that is already there', () => {
    const ed = make('1. a\n   1. a1\n2. b‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. a\n   1. a1\n   2. b');
  });

  it('renumber the lists the item leaves and joins', () => {
    const ed = make('1. a\n   1. x\n   2. y‸\n   3. z\n2. b');
    press(ed, 'Tab', { shift: true });
    expect(ed.text().split('\n').slice(0, 3)).toEqual(['1. a', '   1. x', '2. y']);
    expect(ed.text()).toContain('3. b');
  });

  it('indent the first item of a list (and the list with it), up to 3 columns, and take it back', () => {
    const ed = make('1. a‸\n2. b');
    press(ed, 'Tab');
    expect(ed.text()).toBe('   1. a\n   2. b');
    press(ed, 'Tab'); // as far as Markdown allows before it is code
    expect(ed.text()).toBe('   1. a\n   2. b');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('1. a\n2. b');
    const bullets = make('- a‸\n- b');
    press(bullets, 'Tab');
    press(bullets, 'Tab');
    expect(bullets.text()).toBe('   - a\n   - b');
    press(bullets, 'Tab', { shift: true });
    expect(bullets.text()).toBe('  - a\n  - b');
  });

  it('put the indent of an item in a blockquote after the \"> \"', () => {
    const ed = make('> 1. a\n> 2. b‸\n> 3. c');
    press(ed, 'Tab');
    expect(ed.text()).toBe('> 1. a\n>    1. b\n> 2. c');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('> 1. a\n> 2. b\n> 3. c');
  });

  it('keep what stays behind in line with its new neighbours when a marker changes width', () => {
    const ed = make('II. B\n    A. p\n    B. q\n       x\nIII. C‸');
    ed.view.dispatch({ selection: { anchor: ed.text().indexOf('B. q') + 1 } });
    press(ed, 'Tab', { shift: true });
    press(ed, 'Tab');
    const lines = ed.text().split('\n');
    expect(lines.filter((l) => /^ *[A-Z]\. /.test(l)).map((l) => /^ */.exec(l)![0].length)).toEqual([4, 4]);
  });

  it('widen the step when the marker does ("10. " is four columns)', () => {
    const doc = Array.from({ length: 10 }, (_, i) => `${i + 1}. i${i + 1}`).join('\n') + '\n11. k‸';
    const ed = make(doc);
    // the item above is "10.", so "11." nests under it by 4
    press(ed, 'Tab');
    expect(ed.text().split('\n').pop()).toBe('    1. k');
  });

  it('indent every selected item', () => {
    const ed = make('1. a\n2. b\n3. c\n4. d');
    ed.view.dispatch({ selection: { anchor: ed.text().indexOf('b'), head: ed.text().indexOf('c') } });
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. a\n   1. b\n   2. c\n2. d');
  });
});

suite('Alt-Up and Alt-Down in lists', () => {
  it('move an item with its sub-items and renumber', () => {
    const ed = make('1. a\n2. b‸\n   - b1\n3. c');
    press(ed, 'ArrowUp', { alt: true });
    expect(ed.text()).toBe('1. b\n   - b1\n2. a\n3. c');
    expect(ed.state.doc.lineAt(ed.state.selection.main.head).text).toBe('1. b');
    press(ed, 'ArrowDown', { alt: true });
    press(ed, 'ArrowDown', { alt: true });
    expect(ed.text()).toBe('1. a\n2. c\n3. b\n   - b1');
  });

  it('do nothing at the end of a level, and leave other lines to the ordinary move', () => {
    const ed = make('1. a‸\n2. b');
    press(ed, 'ArrowUp', { alt: true });
    expect(ed.text()).toBe('1. a\n2. b');
    const para = make('one\ntwo‸');
    press(para, 'ArrowUp', { alt: true });
    expect(para.text()).toBe('two\none');
  });

  it('carry on past the edge of a nest level, moving past the next line', () => {
    const down = make('- a\n  - a1‸\n- b');
    press(down, 'ArrowDown', { alt: true });
    expect(down.text()).toBe('- a\n- b\n  - a1');
    const up = make('- a\n- b\n  - b1‸');
    press(up, 'ArrowUp', { alt: true });
    expect(up.text()).toBe('- a\n  - b1\n- b');
  });
});

suite('renumbering', () => {
  it('follows Enter in the middle of a list', () => {
    const ed = make('1. a‸\n2. b\n3. c');
    press(ed, 'Enter');
    expect(ed.text()).toBe('1. a\n2. \n3. b\n4. c');
  });

  it('follows deleting an item', () => {
    const ed = make('1. a\n2. b\n3. c‸');
    // select the second line and delete it with its line break
    ed.view.dispatch({ changes: { from: 4, to: 9 }, userEvent: 'delete.line' });
    expect(ed.text()).toBe('1. a\n2. c');
  });

  it('keeps the number a list starts at', () => {
    const ed = make('5. a\n6. b‸\n7. c');
    press(ed, 'ArrowUp', { alt: true });
    expect(ed.text()).toBe('5. b\n6. a\n7. c');
  });

  it('keeps a width change in step with the text under the item', () => {
    const doc = Array.from({ length: 9 }, (_, i) => `${i + 1}. i${i + 1}`).join('\n');
    const ed = make(doc + '\n   - sub\n10. last‸');
    // 10. would not hold "- sub"; a ninth item gains a digit only when a new one is added above it
    ed.view.dispatch({ selection: { anchor: 3 } });
    press(ed, 'Enter');
    const lines = ed.text().split('\n');
    expect(lines[0]).toBe('1. ');
    expect(lines[9]).toBe('10. i9');
    expect(lines[10]).toBe('    - sub'); // still nested under "10."
  });

  it('leaves what arrives from disk, and undo, alone', () => {
    const ed = make('1. a\n2. b‸');
    ed.applyChanges([{ from: 0, to: ed.text().length, insert: '1. a\n5. b\n9. c' }]);
    expect(ed.text()).toBe('1. a\n5. b\n9. c');
  });

  it('is undone in one step with the edit', () => {
    const ed = make('1. a\n2. b‸\n3. c');
    press(ed, 'ArrowUp', { alt: true });
    expect(ed.text()).toBe('1. b\n2. a\n3. c');
    undo(ed.view);
    expect(ed.text()).toBe('1. a\n2. b\n3. c');
  });
});

suite('lettered and Roman lists', () => {
  it('are lists: Enter continues them and Tab nests under the marker width', () => {
    const ed = make('a. one‸');
    press(ed, 'Enter');
    expect(ed.text()).toBe('a. one\nb. ');
    const r = make('i. one\nii. two‸');
    press(r, 'Tab');
    // "ii." is 4 wide with its space; nested under "i. " (3 columns), numbered again from i
    expect(r.text()).toBe('i. one\n   i. two');
  });

  it('are renumbered in their own style when an item is removed', () => {
    const ed = make('a. x\nb. y\nc. z');
    ed.view.dispatch({ changes: { from: 5, to: 10 }, userEvent: 'delete' });
    expect(ed.text()).toBe('a. x\nb. z');
    const up = make('A. x\nB. y\nC. z');
    up.view.dispatch({ changes: { from: 5, to: 10 }, userEvent: 'delete' });
    expect(up.text()).toBe('A. x\nB. z');
    const ro = make('i. x\nii. y\niii. z');
    ro.view.dispatch({ changes: { from: 5, to: 11 }, userEvent: 'delete' });
    expect(ro.text()).toBe('i. x\nii. z');
  });

  it('leave ordinary prose alone', () => {
    const ed = make('Dr. Smith said‸');
    press(ed, 'Enter');
    expect(ed.text().startsWith('Dr. Smith said')).toBe(true);
    expect(ed.text()).not.toMatch(/\n[A-Za-z]+\. /);
  });
});

suite('Backspace out of a list item', () => {
  it('takes a task marker and its indentation away, back to the left edge', () => {
    const ed = make('- a\n  - [ ] ‸');
    press(ed, 'Backspace');
    expect(show(ed)).toBe('- a\n‸');
  });
  it('takes a plain bullet away too', () => {
    const ed = make('- a\n- ‸');
    press(ed, 'Backspace');
    expect(show(ed)).toBe('- a\n‸');
  });
  it('leaves Backspace alone when there is text before the cursor', () => {
    const ed = make('- ab‸');
    press(ed, 'Backspace');
    expect(show(ed)).toBe('- a‸');
  });
});

suite('Up and Down from the start of an item', () => {
  it('Up goes to the start of the text of the item above, not in front of its bullet', () => {
    const ed = make('- first\n- ‸second');
    press(ed, 'ArrowUp');
    expect(show(ed)).toBe('- ‸first\n- second');
  });
  it('Down does the same the other way, past a task box', () => {
    const ed = make('- ‸first\n- [ ] second');
    press(ed, 'ArrowDown');
    expect(show(ed)).toBe('- first\n- [ ] ‸second');
  });
  it('leaves the arrows alone in the middle of an item', () => {
    const ed = make('- first\n- se‸cond');
    press(ed, 'ArrowUp');
    expect(ed.state.selection.main.head).toBeLessThan(8);
  });
});

suite('Tab and Shift-Tab in lists indented with tabs', () => {
  it('indent with a tab and take it away again', () => {
    const ed = make('- a\n\t- b\n\t- c‸\n- d');
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n\t- b\n\t\t- c\n- d');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('- a\n\t- b\n\t- c\n- d');
    press(ed, 'Tab', { shift: true });
    expect(ed.text()).toBe('- a\n\t- b\n- c\n- d');
  });

  it('move an item with its sub-items, all tab-indented', () => {
    const ed = make('- a\n- b‸\n\t- b1\n- c');
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n\t- b\n\t- b1\n- c');
  });

  it('still use spaces in a list indented with spaces', () => {
    const ed = make('- a\n  - b\n  - c‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe('- a\n  - b\n    - c');
  });
});

suite('a numbered list right under a paragraph', () => {
  it('can start at any number, and keeps counting from it', () => {
    const ed = make('Some intro text\n5. five\n6. six‸');
    press(ed, 'Enter');
    expect(ed.text()).toBe('Some intro text\n5. five\n6. six\n7. ');
  });

  it('is renumbered from its own first number when an item is removed', () => {
    const ed = make('Intro\n5. a\n6. b\n7. c');
    ed.view.dispatch({ changes: { from: ed.text().indexOf('6. b\n'), to: ed.text().indexOf('7. c') }, userEvent: 'delete.line' });
    expect(ed.text()).toBe('Intro\n5. a\n6. c');
  });
});

suite('Enter at the start of an item that has sub-items', () => {
  it('keeps the sub-items under the item when the numbers get wider', () => {
    const ed = make('I. ‸Problem\n   A. one\n   B. two\nII. Discussion\n    A. Scripture\n       1. text\nIII. Last');
    press(ed, 'Enter');
    expect(ed.text()).toBe('I. \nII. Problem\n    A. one\n    B. two\nIII. Discussion\n     A. Scripture\n        1. text\nIV. Last');
  });
});
