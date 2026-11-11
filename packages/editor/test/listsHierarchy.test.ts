import { runScopeHandlers } from '@codemirror/view';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

const CHAIN = ['I.', 'A.', '1.', 'a.', 'i.', '1)', 'a)', 'i)'];

/** An editor with the hierarchy `I. A. 1. a. i. 1) a) i)` on by default; `‸` marks the cursor (two of them, a selection). */
function make(text: string, hierarchical = true): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, lists: { orderedStyles: CHAIN, hierarchicalDefault: hierarchical } });
  const a = text.indexOf('‸');
  const b = text.lastIndexOf('‸');
  ed.load(text.replaceAll('‸', ''));
  if (a >= 0) ed.view.dispatch({ selection: a === b ? { anchor: a } : { anchor: a, head: b - 1 } });
  return ed;
}
const press = (ed: NoteEditor, key: string, shift = false): void => {
  runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }), 'editor');
};
const show = (ed: NoteEditor): string => {
  const t = ed.text();
  const p = ed.state.selection.main.head;
  return t.slice(0, p) + '‸' + t.slice(p);
};

const OUTLINE = [
  'I. Strongest',
  '   A. Statement',
  '   B. Reasons for',
  '      1. Reason 1',
  '      2. Reason 2',
  '   C. Reasons against',
  '      1. Reason 1',
  '         a. Response',
  '      2. Reason 2',
  '         a. Response',
].join('\n');

suite('the hierarchy follows the chain from where the list starts', () => {
  it('a list that starts with 1. has a. under it, then i.', () => {
    const ed = make('1. one\n2. two‸\n3. three');
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. one\n   a. two\n2. three');
    ed.view.dispatch({ selection: { anchor: ed.text().indexOf('two') + 3 } });
    ed.view.dispatch({ changes: { from: ed.text().indexOf('two') + 3, insert: '\nb. next' } });
  });

  it('under 1. a. the next level is i., and under I. A. it is 1.', () => {
    const ed = make('1. one\n   a. x\n   b. y‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe('1. one\n   a. x\n      i. y');
    const ed2 = make('I. one\nII. two‸');
    press(ed2, 'Tab');
    expect(ed2.text()).toBe('I. one\n   A. two');
  });
});

suite('Enter in a deep list', () => {
  it('continues the third level of a list that starts with Roman numerals', () => {
    const ed = make('I. Strongest\n   A. Statement\n      1. Reason‸');
    press(ed, 'Enter');
    expect(show(ed)).toBe('I. Strongest\n   A. Statement\n      1. Reason\n      2. ‸');
  });
  it('continues the fourth and fifth levels', () => {
    const ed = make('I. a\n   A. b\n      1. c\n         a. d‸');
    press(ed, 'Enter');
    expect(show(ed)).toBe('I. a\n   A. b\n      1. c\n         a. d\n         b. ‸');
    const ed2 = make('1. a\n   a. b\n      i. c‸');
    press(ed2, 'Enter');
    expect(show(ed2)).toBe('1. a\n   a. b\n      i. c\n      ii. ‸');
  });
  it('continues a lettered item in the middle of the outline', () => {
    const ed = make(OUTLINE.replace('Statement', 'Statement‸'));
    press(ed, 'Enter');
    expect(ed.text().split('\n').slice(0, 4)).toEqual(['I. Strongest', '   A. Statement', '   B. ', '   C. Reasons for']);
  });
});

suite('Enter at the start of an item in a deep list', () => {
  it('leaves an empty item and moves the text down one, at the same level', () => {
    const ed = make('I. Heading\n   A. Subject\n      1. ‸Item that really should be #2');
    press(ed, 'Enter');
    expect(show(ed)).toBe('I. Heading\n   A. Subject\n      1. \n      2. ‸Item that really should be #2');
  });
  it('does the same at the second level and in a plain numbered list', () => {
    const ed = make('I. Heading\n   A. ‸Subject');
    press(ed, 'Enter');
    expect(show(ed)).toBe('I. Heading\n   A. \n   B. ‸Subject');
    const plain = make('1. one\n2. ‸two');
    press(plain, 'Enter');
    expect(show(plain)).toBe('1. one\n2. \n3. ‸two');
  });
});

suite('Tab on several items', () => {
  it('moves the selected items and everything under them one level, and keeps the hierarchy', () => {
    const start = OUTLINE.indexOf('   A. Statement');
    const ed = make(OUTLINE.slice(0, start) + '‸' + OUTLINE.slice(start) + '‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe(
      [
        'I. Strongest',
        '      A. Statement',
        '      B. Reasons for',
        '         1. Reason 1',
        '         2. Reason 2',
        '      C. Reasons against',
        '         1. Reason 1',
        '            a. Response',
        '         2. Reason 2',
        '            a. Response',
      ].join('\n'),
    );
  });

  it('nests the selected siblings under the item above them, as one group, with their own sub-items', () => {
    const text = 'I. a\n   A. x\n   B. y\n      1. y1\n   C. z';
    const from = text.indexOf('B. y');
    const ed = make(text.slice(0, from) + '‸' + text.slice(from) + '‸');
    press(ed, 'Tab');
    expect(ed.text()).toBe('I. a\n   A. x\n      1. y\n         a. y1\n      2. z');
  });

  it('takes the same step back with Shift-Tab', () => {
    const text = 'I. a\n   A. x\n      1. y\n         a. y1\n      2. z';
    const from = text.indexOf('1. y');
    const ed = make(text.slice(0, from) + '‸' + text.slice(from) + '‸');
    press(ed, 'Tab', true);
    expect(ed.text()).toBe('I. a\n   A. x\n   B. y\n      1. y1\n   C. z');
  });
});
