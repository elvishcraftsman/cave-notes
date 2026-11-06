import { describe, expect, it } from 'vitest';
import { yamlTokens } from '../src/index';

const of = (text: string): string[] => yamlTokens(text).map((t) => `${t.cls}:${text.slice(t.from, t.to)}`);

describe('yamlTokens', () => {
  it('colours keys, values, comments and the Cave Notes extras', () => {
    expect(of('title: "Hi" # note')).toEqual(['key:title', 'punct::', 'string:"Hi"', 'comment:# note']);
    expect(of('due: 2026-11-1\nok: true\nn: -2.5')).toEqual(['key:due', 'punct::', 'number:2026-11-1', 'key:ok', 'punct::', 'bool:true', 'key:n', 'punct::', 'number:-2.5']);
    expect(of('p: "${1 + 2}"')).toContain('string:"${1 + 2}"');
    expect(of('x: ${this.a}')).toContain('expr:${this.a}');
    expect(of('r: [[Page]]')).toContain('link:[[Page]]');
    expect(of('q: !Name')).toContain('tag:!Name');
  });

  it('leaves the lines of a | text alone', () => {
    expect(of('t: |\n  a: b\n  # c\nz: 1')).toEqual(['key:t', 'punct::', 'punct:|', 'string:a: b', 'string:# c', 'key:z', 'punct::', 'number:1']);
  });
});
