import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { linkAt } from '../src/links';
import { markdownSupport } from '../src/markdown';

const state = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdownSupport()] });

describe('destinations with spaces', () => {
  it('reads a path with spaces as a link', () => {
    const doc = '[a pic](Tasks/Work on it/pic.jpg)';
    const l = linkAt(state(doc), 3);
    expect(l?.target).toBe('Tasks/Work on it/pic.jpg');
    expect(l?.text).toBe('a pic');
  });
  it('reads it as an image with a bang', () => {
    const s = state('![lethal-trifecta.jpg](Tasks/Work on sandboxing AI/lethal-trifecta.jpg)');
    const names: string[] = [];
    syntaxTree(s).iterate({ enter: (n) => void names.push(n.name) });
    expect(names).toContain('Image');
    expect(linkAt(s, 5)?.target).toBe('Tasks/Work on sandboxing AI/lethal-trifecta.jpg');
  });
  it('leaves titles and angle brackets alone', () => {
    expect(linkAt(state('[a](b.md "some title")'), 2)?.target).toBe('b.md');
    expect(linkAt(state('[a](<b c.md>)'), 2)?.target).toBe('b c.md');
  });
});
