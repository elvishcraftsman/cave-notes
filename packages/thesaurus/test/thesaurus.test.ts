import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Thesaurus, isStopWord, matchCase } from '../src/index';

const t = new Thesaurus(readFileSync(join(__dirname, '../data/thesaurus.txt'), 'utf8'));

describe('thesaurus', () => {
  it('has a useful number of words', () => expect(t.size).toBeGreaterThan(30000));
  it('knows common words, best first', () => {
    expect(t.lookup('big')!.slice(0, 3)).toEqual(expect.arrayContaining(['large', 'great']));
    expect(t.lookup('begin')).toContain('commence');
  });
  it('never offers synonyms for articles, prepositions and the like', () => {
    for (const w of ['the', 'a', 'an', 'of', 'in', 'on', 'and', 'but', 'with', 'to', 'for', 'he', 'is', 'was', 'The', 'AND']) expect(t.lookup(w), w).toBeNull();
    expect(isStopWord('between')).toBe(true);
    expect(isStopWord('happy')).toBe(false);
  });
  it('keeps the capitals of the word it replaces', () => {
    expect(t.lookup('Big')![0]![0]).toBe('L');
    expect(t.lookup('BIG')![0]).toBe(t.lookup('big')![0]!.toUpperCase());
    expect(matchCase('iPhone', 'handset')).toBe('handset');
  });
  it('finds the base of a regular inflection and inflects the synonyms the same way', () => {
    const running = t.lookup('running')!;
    expect(running.length).toBeGreaterThan(3);
    expect(running.every((s) => s.endsWith('ing'))).toBe(true);
    expect(t.lookup('walked')!.every((s) => s.endsWith('ed'))).toBe(true);
    expect(t.lookup('beginning')).toContain('commencing');
    expect(t.lookup('quickly')).toContain('speedily');
    expect(t.lookup('stopped')).toContain('halted');
    expect(t.lookup('dropped')).toEqual(expect.arrayContaining([expect.stringMatching(/pped$/)]));
  });
  it('gives nothing for numbers, unknown words or odd text', () => {
    expect(t.lookup('2024')).toBeNull();
    expect(t.lookup('qwzxv')).toBeNull();
    expect(t.lookup('café')).toBeNull();
    expect(t.lookup('')).toBeNull();
  });
  it('does not offer the word itself or repeats', () => {
    for (const w of ['happy', 'house', 'run', 'say']) {
      const l = t.lookup(w)!;
      expect(l).not.toContain(w);
      expect(new Set(l).size).toBe(l.length);
    }
  });
});

describe('forms that look like inflections', () => {
  it('keeps nouns and verbs that only look inflected', () => {
    expect(t.lookup('morning')!.some((s) => s.endsWith('ing') && s !== 'morning')).toBe(true); // morn-ing is not the verb "morn"
    expect(t.lookup('seed')!.every((s) => !s.endsWith('ed'))).toBe(true);
    expect(t.lookup('walking')![0]).toMatch(/ing$/);
  });
});
