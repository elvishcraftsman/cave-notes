import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extractOutline, findHeading, linkAt, markdownSupport, parseWikiInner, slugify } from '../src/index';

const stateOf = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdownSupport()] });

describe('slugify', () => {
  it('matches the slugs core-md produces', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('A_b-c d')).toBe('a_b-c-d');
    expect(slugify('Café ü')).toBe('café-ü');
    expect(slugify('???')).toBe('section');
  });
});

describe('extractOutline', () => {
  it('lists headings with levels, lines, and de-duplicated slugs', () => {
    const o = extractOutline(stateOf('# One\n\n## Two\n\ntext\n\n## Two\n\n### Three'));
    expect(o.map((h) => [h.level, h.text, h.slug, h.line])).toEqual([
      [1, 'One', 'one', 1],
      [2, 'Two', 'two', 3],
      [2, 'Two', 'two-1', 7],
      [3, 'Three', 'three', 9],
    ]);
  });

  it('strips markup from heading text, handles setext headings, and ignores code and frontmatter', () => {
    const doc = '---\ntitle: x\n# not a heading\n---\n\n## **Bold** `code` [link](x.md) [[Wiki|shown]]\n\nSetext\n======\n\n```\n# in code\n```\n\n    # indented code\n';
    expect(extractOutline(stateOf(doc)).map((h) => [h.level, h.text])).toEqual([
      [2, 'Bold code link shown'],
      [1, 'Setext'],
    ]);
  });

  it('removes closing hashes', () => {
    expect(extractOutline(stateOf('## Title ##\n'))[0]?.text).toBe('Title');
  });

  it('is empty for a document without headings', () => {
    expect(extractOutline(stateOf('just text'))).toEqual([]);
    expect(extractOutline(stateOf(''))).toEqual([]);
  });
});

describe('findHeading', () => {
  const items = extractOutline(stateOf('# Intro\n\n## Imputation\n\n## Imputation'));
  it('finds by slug, by heading text, and by an unslugified fragment', () => {
    expect(findHeading(items, 'imputation')?.line).toBe(3);
    expect(findHeading(items, 'imputation-1')?.line).toBe(5);
    expect(findHeading(items, 'Intro')?.line).toBe(1);
    expect(findHeading(items, '#intro')?.line).toBe(1);
    expect(findHeading(items, 'nope')).toBeUndefined();
  });
});

describe('parseWikiInner', () => {
  it('splits target, fragment and alias', () => {
    expect(parseWikiInner('Grace')).toEqual({ target: 'Grace', fragment: null, alias: null });
    expect(parseWikiInner(' A/B#Sub|shown ')).toEqual({ target: 'A/B', fragment: 'Sub', alias: 'shown' });
    expect(parseWikiInner('#Local')).toEqual({ target: '', fragment: 'Local', alias: null });
  });
});

describe('linkAt', () => {
  const at = (doc: string, needle: string, offset = 1) => linkAt(stateOf(doc), doc.indexOf(needle) + offset);

  it('finds wikilinks, with alias and fragment', () => {
    expect(at('see [[Grace#Sub|God]] ok', 'Grace')).toMatchObject({ syntax: 'wiki', target: 'Grace', fragment: 'Sub', text: 'God' });
  });

  it('finds markdown links and images with their destination', () => {
    expect(at('a [the docs](A/B.md#h "t") b', 'docs')).toMatchObject({ syntax: 'md', target: 'A/B.md', fragment: 'h', text: 'the docs' });
    expect(at('![alt](pic.png)', 'alt')).toMatchObject({ syntax: 'md', target: 'pic.png', text: 'alt' });
  });

  it('finds autolinks and bare URLs', () => {
    expect(at('<https://a.com>', 'https')).toMatchObject({ target: 'https://a.com' });
    expect(at('go https://b.com now', 'b.com')).toMatchObject({ target: 'https://b.com' });
  });

  it('returns null away from links and inside code', () => {
    expect(at('plain text here', 'text')).toBeNull();
    expect(at('`[[no]]`', 'no')).toBeNull();
    expect(at('```\n[[no]]\n```', 'no')).toBeNull();
    expect(at('---\nx: [[no]]\n---\n', 'no')).toBeNull();
  });
});

import { findFirstH1 } from '../src/editor';
describe('findFirstH1', () => {
  it('finds the title: a level-1 heading that is the first thing, after frontmatter and blank lines', () => {
    expect(findFirstH1(['---', '# not me: frontmatter', '---', '', '# Title #', 'text'])).toEqual({ text: 'Title', line: 5 });
    expect(findFirstH1(['no heading here', '## only level two'])).toBeNull();
  });

  it('does not take a heading partway through the page for the title', () => {
    expect(findFirstH1(['Some text first', '', '# A section'])).toBeNull();
    expect(findFirstH1(['## Level two first', '# Later level one'])).toBeNull();
    expect(findFirstH1(['```', '# in code', '```'])).toBeNull();
  });

  it('finds the headings at the end of a long document', () => {
    const body = Array.from({ length: 4000 }, (_, i) => `## Section ${i}\n\nSome text of the section, a line or two.\n`).join('\n');
    const o = extractOutline(stateOf(`# Top\n\n${body}`));
    expect(o.length).toBe(4001);
    expect(o[o.length - 1]!.text).toBe('Section 3999');
  });
});
