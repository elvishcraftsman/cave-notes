import { EditorState } from '@codemirror/state';
import { describe as suite, expect, it } from 'vitest';
import { listPasteText, markdownSupport } from '../src/index';

/** `‸` marks the cursor in the document; returns what a paste of `text` would put there */
const paste = (doc: string, text: string): string => {
  const at = doc.indexOf('‸');
  const state = EditorState.create({ doc: doc.replace('‸', ''), selection: { anchor: at }, extensions: [markdownSupport()] });
  return listPasteText(state, text);
};

suite('pasting into lists', () => {
  it('drops the marker of one pasted line in a bulleted, numbered or task list', () => {
    expect(paste('- ‸', '- apples')).toBe('apples');
    expect(paste('- ‸', '1. apples')).toBe('apples');
    expect(paste('1. ‸', '- apples')).toBe('apples');
    expect(paste('- [ ] ‸', '* apples')).toBe('apples');
    expect(paste('- ‸', '- [x] done')).toBe('done');
    expect(paste('- ‸', '> quoted')).toBe('quoted');
    expect(paste('- ‸', '## Heading')).toBe('Heading');
    expect(paste('- before ‸ after', '2) middle')).toBe('middle');
    expect(paste('a. ‸', '- apples')).toBe('apples');
  });

  it('makes the other pasted items the kind of list they land in', () => {
    expect(paste('- ‸', '- a\n- b\n  - c')).toBe('a\n- b\n  - c');
    expect(paste('1. ‸', '- a\n- b\n  - c')).toBe('a\n2. b\n  1. c');
    expect(paste('3. ‸', '- a\n- b')).toBe('a\n4. b');
    expect(paste('- [ ] ‸', '1. a\n2. b')).toBe('a\n- [ ] b');
    expect(paste('  - ‸', '- a\n- b')).toBe('a\n  - b');
  });

  it('keeps text that has no marker, and pastes elsewhere as it is', () => {
    expect(paste('- ‸', 'plain text')).toBe('plain text');
    expect(paste('- ‸', 'A. Smith went home')).toBe('A. Smith went home');
    expect(paste('> ‸', '- apples\n- pears')).toBe('- apples\n- pears');
    expect(paste('Some paragraph ‸', '- apples')).toBe('- apples');
    expect(paste('# ‸', '- apples')).toBe('- apples');
    expect(paste('‸', '- apples')).toBe('- apples');
    expect(paste('```\n- ‸\n```', '- apples')).toBe('- apples');
  });

  it('leaves the text alone when the cursor is in the marker itself', () => {
    expect(paste('-‸ ', '- apples')).toBe('- apples');
  });
});

suite('pasting an outline into a numbered item', () => {
  const outline = ['I. Strongest', '   A. Statement', '   B. Reasons for', '      1. Reason 1', '      2. Reason 2', '   C. Reasons against', '      1. Reason 1', '         a. Response', '      2. Reason 2', '         a. Response'].join('\n');

  it('drops the first marker, keeps the levels and moves them by the width of the new marker', () => {
    expect(paste('I. one\n   A. two\nII. ‸', outline)).toBe(
      ['Strongest', '    A. Statement', '    B. Reasons for', '       1. Reason 1', '       2. Reason 2', '    C. Reasons against', '       1. Reason 1', '          a. Response', '       2. Reason 2', '          a. Response'].join('\n'),
    );
  });

  it('goes under a nested item as well, and numbers the pasted items of the first level along', () => {
    expect(paste('I. a\n   A. b\n   B. ‸', 'I. x\nII. y\n   A. z')).toBe('x\n   C. y\n      A. z');
  });

  it('leaves a single line like "A. Smith went home" alone', () => {
    expect(paste('II. ‸', 'A. Smith went home')).toBe('A. Smith went home');
  });
});
