import { describe, expect, it } from 'vitest';
import { applyMatches, classifyLines, compileFind, findMatches, matchName, type ReplaceOptions } from '../src/replace';

const opts = (o: Partial<ReplaceOptions>): ReplaceOptions => ({ find: 'cat', replace: 'dog', regex: false, matchCase: false, wholeWord: false, kinds: ['text', 'headings', 'attributes', 'code'], names: false, ...o });

const PAGE = ['---', 'pet: cat', 'tags: [cat]', '---', '# The cat', '', 'A cat sat. Cats purr.', '', '```', 'cat --help', '```', '', 'Title cat', '=========', '- a cat in a list'].join('\n');

describe('what kind each line is', () => {
  it('sorts attributes, headings, code and text', () => {
    expect(classifyLines(PAGE.split('\n'))).toEqual(['text', 'attributes', 'attributes', 'text', 'headings', 'text', 'text', 'text', 'code', 'code', 'code', 'text', 'headings', 'headings', 'text']);
  });
  it('does not take a list item above a rule for a heading', () => {
    expect(classifyLines(['- item', '---', 'text'])).toEqual(['text', 'text', 'text']);
  });
});

describe('finding', () => {
  it('finds every match, whatever the kind, and none that is kept out', () => {
    expect(findMatches(PAGE, opts({})).map((m) => `${m.line}:${m.kind}`)).toEqual(['2:attributes', '3:attributes', '5:headings', '7:text', '7:text', '10:code', '13:headings', '15:text']);
    expect(findMatches(PAGE, opts({ kinds: ['text'] })).map((m) => m.line)).toEqual([7, 7, 15]);
    expect(findMatches(PAGE, opts({ kinds: ['text', 'headings', 'attributes'] })).some((m) => m.kind === 'code')).toBe(false);
    expect(findMatches(PAGE, opts({ kinds: [] }))).toEqual([]);
  });
  it('can keep to whole words and to the case that was typed', () => {
    expect(findMatches('cat Cat cats concat', opts({ wholeWord: true })).map((m) => m.matched)).toEqual(['cat', 'Cat']);
    expect(findMatches('cat Cat cats', opts({ matchCase: true })).map((m) => m.matched)).toEqual(['cat', 'cat']);
  });
  it('shows the line before and after one match', () => {
    const [m] = findMatches('a cat and a cat', opts({}));
    expect(m).toMatchObject({ id: '1:0', start: 2, end: 5, before: 'a cat and a cat', after: 'a dog and a cat' });
  });
  it('says why a bad expression is bad, and finds nothing for an empty search', () => {
    expect(compileFind({ find: '(', regex: true, matchCase: false, wholeWord: false })).toMatchObject({ error: expect.any(String) });
    expect(findMatches('x', opts({ find: '' }))).toEqual([]);
  });
});

describe('replacing', () => {
  it('replaces them all, or the chosen ones, and nothing else', () => {
    const all = applyMatches(PAGE, opts({ kinds: ['text', 'headings'] }), null);
    expect(all.count).toBe(5);
    expect(all.text).toContain('# The dog');
    expect(all.text).toContain('A dog sat. dogs purr.');
    expect(all.text).toContain('pet: cat'); // attributes were not asked for
    expect(all.text).toContain('cat --help');
    const some = applyMatches('a cat, a cat, a cat', opts({}), new Set(['1:1']));
    expect(some).toEqual({ text: 'a cat, a dog, a cat', count: 1 });
  });
  it('uses groups of a regular expression, and a $ in plain replacement stays a $', () => {
    expect(applyMatches('2026-11-03', opts({ find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3/$2/$1', regex: true }), null).text).toBe('03/11/2026');
    expect(applyMatches('price', opts({ find: 'price', replace: '$1 & $&' }), null).text).toBe('$1 & $&');
    expect(applyMatches('Mr Smith', opts({ find: '(?<n>Smith)', replace: '[$<n>]', regex: true }), null).text).toBe('Mr [Smith]');
  });
  it('keeps the line endings of the page', () => {
    expect(applyMatches('a cat\r\nb cat\r\n', opts({}), null).text).toBe('a dog\r\nb dog\r\n');
  });
  it('handles a search that could match nothing at all', () => {
    expect(applyMatches('abc', opts({ find: 'x*', regex: true }), null)).toEqual({ text: 'abc', count: 0 });
  });
});

describe('file names', () => {
  it('gives the new name, or null when nothing changes', () => {
    expect(matchName('Cat Notes', opts({}))).toBe('dog Notes');
    expect(matchName('Notes', opts({}))).toBeNull();
    expect(matchName('Chapter 3', opts({ find: '(\\w+) (\\d)', replace: '$2 $1', regex: true }))).toBe('3 Chapter');
  });
});
