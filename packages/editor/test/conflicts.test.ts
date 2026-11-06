import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NoteEditor, CONFLICT_CLOSE, CONFLICT_MID, CONFLICT_OPEN, findConflicts, resolveConflict } from '../src/index';

const page = (inner: string) => `Before\n${CONFLICT_OPEN}\n${inner}\n${CONFLICT_CLOSE}\nAfter`;
const apply = (text: string, keep: 'a' | 'b' | 'both') => {
  const s = EditorState.create({ doc: text });
  const c = findConflicts(s)[0]!;
  const ch = resolveConflict(s, c, keep);
  return s.update({ changes: ch }).state.doc.toString();
};

describe('conflict boxes', () => {
  const text = page(`Mine one\nMine two\n${CONFLICT_MID}\nTheirs`);
  it('finds the three marker lines, and ignores them inside code', () => {
    expect(findConflicts(EditorState.create({ doc: text }))).toEqual([{ open: 2, mid: 5, close: 7 }]);
    expect(findConflicts(EditorState.create({ doc: '```\n' + text + '\n```' }))).toEqual([]);
  });
  it('keeps A, B or both and leaves the rest of the page alone', () => {
    expect(apply(text, 'a')).toBe('Before\nMine one\nMine two\nAfter');
    expect(apply(text, 'b')).toBe('Before\nTheirs\nAfter');
    expect(apply(text, 'both')).toBe('Before\nMine one\nMine two\nTheirs\nAfter');
  });
  it('copes with an empty side and with a conflict at the end of the page', () => {
    expect(apply(page(`${CONFLICT_MID}\nOnly B`), 'a')).toBe('Before\nAfter');
    expect(apply(`${CONFLICT_OPEN}\nA\n${CONFLICT_MID}\nB\n${CONFLICT_CLOSE}`, 'b')).toBe('B');
  });
});

describe('conflicts that are not tidy', () => {
  it('finds one whose two versions have a code fence each, and one with a little extra on its marker lines', () => {
    const fenced = `Intro\n${CONFLICT_OPEN}\n\`\`\`js\na()\n${CONFLICT_MID}\n\`\`\`js\nb()\n${CONFLICT_CLOSE}\n\`\`\`\nAfter`;
    expect(findConflicts(EditorState.create({ doc: fenced }))).toEqual([{ open: 2, mid: 5, close: 8 }]);
    const loose = '<<<<<<< conflict: both versions kept (laptop)\nA\n=======  \nB\n>>>>>>> end of conflict  \n';
    expect(findConflicts(EditorState.create({ doc: loose }))).toHaveLength(1);
  });
  it('finds two in a row, and none that are not closed', () => {
    const two = `${CONFLICT_OPEN}\nA\n${CONFLICT_MID}\nB\n${CONFLICT_CLOSE}\nx\n${CONFLICT_OPEN}\nC\n${CONFLICT_MID}\nD\n${CONFLICT_CLOSE}`;
    expect(findConflicts(EditorState.create({ doc: two })).map((c) => c.open)).toEqual([1, 7]);
    expect(findConflicts(EditorState.create({ doc: `${CONFLICT_OPEN}\nA\n${CONFLICT_MID}\nB` }))).toEqual([]);
  });
});

describe('conflict boxes in the editor', () => {
  it('draws two boxes with buttons, and Keep B changes the page', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el });
    ed.load(page(`Mine\n${CONFLICT_MID}\nTheirs`));
    expect(el.querySelectorAll('.cm-conflict-head')).toHaveLength(2);
    expect([...el.querySelectorAll('.cm-conflict-button')].map((b) => b.textContent)).toEqual(['Keep A', 'Keep B', 'Keep Both']);
    expect(el.querySelectorAll('.cm-conflict-a')).toHaveLength(1);
    expect(el.querySelectorAll('.cm-conflict-b')).toHaveLength(1);
    (el.querySelectorAll('.cm-conflict-button')[1] as HTMLButtonElement).click();
    expect(ed.text()).toBe('Before\nTheirs\nAfter');
    expect(el.querySelectorAll('.cm-conflict-head')).toHaveLength(0);
  });
});
