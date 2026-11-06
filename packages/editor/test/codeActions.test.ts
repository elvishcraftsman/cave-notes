import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NoteEditor, codeBlocks, codeText, markdownSupport, computeDecorations, AUTOMATION_LINK } from '../src/index';

const st = (doc: string) => EditorState.create({ doc, extensions: [markdownSupport()] });

describe('code blocks', () => {
  it('are found with their language, and only shell ones can run', () => {
    const doc = 'a\n\n```bash\necho hi\n```\n\n```yaml\nk: v\n```\n\n```sh\nls\n```\n\n```\nplain\n```\n';
    const b = codeBlocks(st(doc));
    expect(b.map((x) => [x.lang, x.shell])).toEqual([['bash', true], ['yaml', false], ['sh', true], ['', false]]);
  });
  it('give the code without fences or the final newline', () => {
    const s = st('```bash\necho a\necho b\n```\n');
    expect(codeText(s, codeBlocks(s)[0]!)).toBe('echo a\necho b');
  });
  it('an unclosed fence still gives all its text', () => {
    const s = st('```sh\nls -l');
    expect(codeText(s, codeBlocks(s)[0]!)).toBe('ls -l');
  });
  it('an indented block loses its indent', () => {
    const s = st('text\n\n    one\n    two\n');
    const b = codeBlocks(s)[0]!;
    expect([b.fenced, b.shell, codeText(s, b)]).toEqual([false, false, 'one\ntwo']);
  });
  it('a view block is not a code block', () => {
    expect(codeBlocks(st('```view\nquery: x\n```\n'))).toEqual([]);
  });
});

describe('the code action layer', () => {
  it('is added to the editor and removed with it', () => {
    const host = document.createElement('div');
    const ed = new NoteEditor({ parent: host });
    ed.load('```bash\nls\n```\n');
    expect(host.querySelector('.cm-codeactions')).not.toBeNull();
    ed.destroy();
    expect(host.querySelector('.cm-codeactions')).toBeNull();
  });
});

describe('automation links', () => {
  it('accept a rule id and nothing else', () => {
    expect(AUTOMATION_LINK.exec('automation:finish-task')![1]).toBe('finish-task');
    expect(AUTOMATION_LINK.exec('automation: weekly.review')![1]).toBe('weekly.review');
    expect(AUTOMATION_LINK.test('automation:')).toBe(false);
    expect(AUTOMATION_LINK.test('automation:a b')).toBe(false);
    expect(AUTOMATION_LINK.test('https://x')).toBe(false);
  });
  it('are drawn as buttons, with or without the =', () => {
    for (const text of ['[=Done](automation:finish) after', '[Done](automation:finish) after']) {
      const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [markdownSupport()] });
      const set = computeDecorations(state, [{ from: 0, to: text.length }], {});
      const marks: string[] = [];
      set.between(0, text.length, (f, t, v) => {
        const cls = (v.spec as { class?: string }).class;
        if (cls) marks.push(`${cls}:${text.slice(f, t)}`);
      });
      expect(marks.some((m) => m.includes('cm-automation-button') && m.endsWith(':Done'))).toBe(true);
    }
  });
  it('show their text while the cursor is in them', () => {
    const text = '[=Done](automation:finish)';
    const state = EditorState.create({ doc: text, selection: { anchor: 5 }, extensions: [markdownSupport()] });
    const set = computeDecorations(state, [{ from: 0, to: text.length }], {});
    let found = false;
    set.between(0, text.length, (_f, _t, v) => {
      if (((v.spec as { class?: string }).class ?? '').includes('cm-automation-button')) found = true;
    });
    expect(found).toBe(false);
  });
});
