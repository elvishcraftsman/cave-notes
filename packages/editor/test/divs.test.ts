import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { divLines } from '../src/divs';

const lines = (doc: string) => divLines(EditorState.create({ doc }));

describe('fenced divs', () => {
  it('nest, and each closing line closes the innermost', () => {
    const l = lines('::: nocount\n# Bib\n::: hanging\nitem\n:::\nstill in the first\n:::\nafter');
    expect(l.map((x) => [x.line, x.kind])).toEqual([[1, 'open'], [2, 'body'], [3, 'open'], [4, 'body'], [5, 'close'], [6, 'body'], [7, 'close']]);
    expect(l[5]!.classes).toEqual(['nocount']);
  });

  it('a line of `::: :::` closes two blocks at once', () => {
    const l = lines('::: nocount\n# Bib\n::: hanging\nitem\n::: :::\nafter');
    expect(l.map((x) => [x.line, x.kind])).toEqual([[1, 'open'], [2, 'body'], [3, 'open'], [4, 'body'], [5, 'close']]);
    expect(l.some((x) => x.line === 6)).toBe(false);
  });

  it('a block can have several classes: `::: hanging nocount`', () => {
    const l = lines('::: hanging nocount\nitem\n:::');
    expect(l[1]!.classes).toEqual(['hanging', 'nocount']);
  });
});
