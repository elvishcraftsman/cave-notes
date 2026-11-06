import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, slugify, Slugger, classifyDestination } from '../src/index.js';

const brief = (links) => links.map((l) => [l.kind, l.syntax, l.target || l.url || '', l.fragment]);

// ------------------------------------------------------------ frontmatter

test('frontmatter: parsed, with end position', () => {
  const r = parse('---\ntitle: Grace\ntags: [a, b]\ndue: 2026-11-01\norder: 3\n---\n# Heading\n');
  assert.equal(r.frontmatter.present, true);
  assert.deepEqual(r.frontmatter.data, { title: 'Grace', tags: ['a', 'b'], due: '2026-11-01', order: 3 });
  assert.equal(r.frontmatter.error, null);
  assert.equal(r.frontmatter.endLine, 6);
  assert.equal(r.headings[0].line, 7);
});

test('frontmatter: absent, empty, and thematic-break lookalikes', () => {
  assert.equal(parse('# Just a heading').frontmatter.present, false);
  const empty = parse('---\n---\n# H');
  assert.equal(empty.frontmatter.present, true);
  assert.deepEqual(empty.frontmatter.data, {});
  // A --- not at the very start is a thematic break, not frontmatter.
  const late = parse('Intro\n\n---\ntitle: x\n---\n');
  assert.equal(late.frontmatter.present, false);
});

test('frontmatter: malformed YAML never throws and reports an error', () => {
  const r = parse('---\ntitle: [unclosed\nfoo: : :\n---\n# Still parsed\n');
  assert.equal(r.frontmatter.present, true);
  assert.deepEqual(r.frontmatter.data, {});
  assert.ok(r.frontmatter.error);
  assert.equal(r.headings[0].text, 'Still parsed');
});

test('frontmatter: non-mapping values are rejected with an error', () => {
  for (const body of ['- a\n- b', 'just a string', '42']) {
    const r = parse(`---\n${body}\n---\n`);
    assert.deepEqual(r.frontmatter.data, {}, body);
    assert.match(r.frontmatter.error, /mapping/, body);
  }
});

test('frontmatter: unclosed block is plain content', () => {
  const r = parse('---\ntitle: x\n\n# Heading\n');
  assert.equal(r.frontmatter.present, false);
  assert.equal(r.headings.length, 1);
});

test('frontmatter: duplicate keys do not throw', () => {
  const r = parse('---\na: 1\na: 2\n---\n');
  assert.equal(r.frontmatter.error, null);
  assert.equal(r.frontmatter.data.a, 2);
});

test('links inside frontmatter are not extracted', () => {
  const r = parse('---\nsource: "[x](http://example.com)"\n---\nbody\n');
  assert.deepEqual(r.links, []);
});

// ------------------------------------------------------------ title

test('title: first H1, else frontmatter title, else null', () => {
  assert.equal(parse('## Sub\n# Main\n# Second').title, 'Main');
  assert.equal(parse('---\ntitle: FM Title\n---\nno heading').title, 'FM Title');
  assert.equal(parse('---\ntitle: FM\n---\n# Heading Wins').title, 'Heading Wins');
  assert.equal(parse('just text').title, null);
  assert.equal(parse('---\ntitle: 42\n---\n').title, null);
});

// ------------------------------------------------------------ headings

test('headings: levels, lines, order, setext, formatting stripped', () => {
  const r = parse('# One\n\nSetext Two\n----------\n\n### **Bold** and `code` and [link](x.md)\n\n#### ![alt text](i.png)\n');
  assert.deepEqual(
    r.headings.map((h) => [h.level, h.text, h.line, h.ord]),
    [
      [1, 'One', 1, 0],
      [2, 'Setext Two', 3, 1],
      [3, 'Bold and code and link', 6, 2],
      [4, 'alt text', 8, 3],
    ],
  );
});

test('headings: slugs are GitHub-style with duplicate suffixes', () => {
  const r = parse('# Hello, World!\n## Hello, World!\n## Hello, World!\n## A_b-c d\n## Café ü\n## ???\n');
  assert.deepEqual(
    r.headings.map((h) => h.slug),
    ['hello-world', 'hello-world-1', 'hello-world-2', 'a_b-c-d', 'café-ü', 'section'],
  );
});

test('headings inside code fences are ignored; inside blockquotes/lists are found', () => {
  const r = parse('```\n# not a heading\n```\n\n> ## Quoted\n\n- ### In list\n');
  assert.deepEqual(r.headings.map((h) => h.text), ['Quoted', 'In list']);
});

test('slugify / Slugger directly', () => {
  assert.equal(slugify('Foo  Bar'), 'foo--bar');
  const s = new Slugger();
  assert.deepEqual([s.slug('x'), s.slug('x'), s.slug('x-1'), s.slug('x')], ['x', 'x-1', 'x-1-1', 'x-2']);
});

// ------------------------------------------------------------ links

test('every link form is detected with the right kind', () => {
  const src = [
    '[page](Soteriology/Grace.md)',
    '[page+heading](Grace.md#imputation)',
    '[[Grace]]',
    '[[Grace#Imputation]]',
    '[[Soteriology/Grace|God\'s favor]]',
    '[spec](../docs/spec.pdf)',
    '[site](https://example.com/a?b=c#d)',
    '[mail](mailto:a@b.com)',
    '[same](#local)',
    '[abs](/home/me/file.txt)',
    '[bad](javascript:alert(1))',
    '[file url](file:///home/me/My%20File.pdf)',
  ].join('\n\n');
  const links = parse(src).links;
  assert.deepEqual(brief(links), [
    ['page', 'md', 'Soteriology/Grace.md', null],
    ['page', 'md', 'Grace.md', 'imputation'],
    ['page', 'wiki', 'Grace', null],
    ['page', 'wiki', 'Grace', 'Imputation'],
    ['page', 'wiki', 'Soteriology/Grace', null],
    ['file', 'md', '../docs/spec.pdf', null],
    ['web', 'md', 'https://example.com/a?b=c#d', null],
    ['web', 'md', 'mailto:a@b.com', null],
    ['page', 'md', '', 'local'],
    ['file', 'md', '/home/me/file.txt', null],
    ['other', 'md', 'javascript:alert(1)', null],
    ['file', 'md', '/home/me/My File.pdf', null],
  ]);
  assert.equal(links[4].text, "God's favor");
});

test('percent-encoding and angle-bracket destinations are decoded', () => {
  const links = parse('[a](My%20Page.md) [b](<My Other Page.md>) [c](caf%C3%A9.md)').links;
  assert.deepEqual(links.map((l) => l.target), ['My Page.md', 'My Other Page.md', 'café.md']);
  assert.deepEqual(links.map((l) => l.raw), ['My%20Page.md', 'My Other Page.md', 'caf%C3%A9.md']);
});

test('destinations with parentheses and titles', () => {
  const links = parse('[a](Foo_(bar).md "A title") [b](x.md \'t\')').links;
  assert.deepEqual(links.map((l) => l.target), ['Foo_(bar).md', 'x.md']);
});

test('autolinks, bare URLs, images, and reference-style links', () => {
  const src = 'See <https://a.com> and https://b.com and ![pic](img/p.png) and [ref][r] and [shortcut].\n\n[r]: Target.md#sec\n[shortcut]: https://c.com\n';
  const links = parse(src).links;
  assert.deepEqual(links.map((l) => [l.via, l.kind, l.target || l.url, l.embed]), [
    ['autolink', 'web', 'https://a.com', false],
    ['autolink', 'web', 'https://b.com', false],
    ['inline', 'file', 'img/p.png', true],
    ['reference', 'page', 'Target.md', false],
    ['reference', 'web', 'https://c.com', false],
  ]);
  assert.equal(links[3].fragment, 'sec');
});

test('unused reference definitions are not links', () => {
  assert.deepEqual(parse('[x]: http://example.com\n\ntext').links, []);
});

test('wikilinks: aliases, embeds, same-page, whitespace, junk', () => {
  const links = parse('[[ Spaced Name ]] ![[Embedded]] [[#Local]] [[A#B|C]] [[]] [[|x]] [[ ]]').links;
  assert.deepEqual(
    links.map((l) => [l.target, l.fragment, l.text, l.embed]),
    [
      ['Spaced Name', null, null, false],
      ['Embedded', null, null, true],
      ['', 'Local', null, false],
      ['A', 'B', 'C', false],
    ],
  );
});

test('links in code are ignored (inline, fenced, indented)', () => {
  const src = '`[[no]] [x](a.md)`\n\n```\n[[no]] [x](a.md)\n```\n\n    [[no]] [x](a.md)\n\n[[yes]]\n';
  assert.deepEqual(brief(parse(src).links), [['page', 'wiki', 'yes', null]]);
});

test('escaped wikilinks and HTML blocks are ignored', () => {
  const src = '\\[[not a link]]\n\n<div>[[inside html]]</div>\n\n[[real]]\n';
  assert.deepEqual(brief(parse(src).links), [['page', 'wiki', 'real', null]]);
});

test('empty destinations are skipped', () => {
  assert.deepEqual(parse('[x]()').links, []);
});

test('links are sorted by position and carry line/column', () => {
  const r = parse('line one\n\nfoo [[A]] bar [b](b.md)\n[[C]]\n');
  assert.deepEqual(r.links.map((l) => [l.target, l.line, l.column]), [
    ['A', 3, 5],
    ['b.md', 3, 15],
    ['C', 4, 1],
  ]);
});

test('source offsets round-trip: pathStart/pathEnd slice back to the written path', () => {
  const src = [
    '---', 'title: x', '---',
    'a [t](Dir/My%20Page.md#frag "title") b [[Wiki Name#h|alias]] c ![i](<pic one.png>)',
    '',
    '[ref][r]',
    '',
    '[r]: Ref/Target.md#z',
    'end [[ Padded ]]',
  ].join('\n');
  const { links } = parse(src);
  const slices = links.map((l) => [l.target, src.slice(l.pathStart, l.pathEnd)]);
  assert.deepEqual(slices, [
    ['Dir/My Page.md', 'Dir/My%20Page.md'],
    ['Wiki Name', 'Wiki Name'],
    ['pic one.png', 'pic one.png'],
    ['Ref/Target.md', 'Ref/Target.md'],
    ['Padded', 'Padded'],
  ]);
  for (const l of links) assert.ok(src.slice(l.start, l.end).length > 0);
  assert.equal(src.slice(links[1].start, links[1].end), '[[Wiki Name#h|alias]]');
});

test('web links have no rewritable path span', () => {
  const l = parse('[x](https://example.com/a)').links[0];
  assert.equal(l.pathStart, null);
  assert.equal(l.pathEnd, null);
});

// ------------------------------------------------------------ robustness

test('CRLF and lone-CR line endings keep line numbers right', () => {
  for (const nl of ['\r\n', '\r', '\n']) {
    const r = parse(['---', 'a: 1', '---', '# H', '', '[[W]]'].join(nl));
    assert.equal(r.headings[0].line, 4, JSON.stringify(nl));
    assert.equal(r.links[0].line, 6, JSON.stringify(nl));
    assert.equal(r.frontmatter.data.a, 1, JSON.stringify(nl));
  }
});

test('BOM: offsets stay aligned with the original string', () => {
  const src = '\uFEFF---\na: 1\n---\n# H\n\n[[W]] and [x](p.md)\n';
  const r = parse(src);
  assert.equal(r.frontmatter.data.a, 1);
  assert.equal(r.title, 'H');
  for (const l of r.links) assert.equal(src.slice(l.pathStart, l.pathEnd), l.target);
});

test('empty and whitespace-only input', () => {
  for (const s of ['', '\n', '   \n\n']) {
    const r = parse(s);
    assert.deepEqual([r.headings, r.links, r.title, r.error], [[], [], null, null]);
  }
});

test('non-string input does not throw', () => {
  for (const v of [null, undefined, 42, {}]) assert.ok(parse(v).error);
});

test('deeply nested input does not overflow the stack or throw', () => {
  const r = parse('>'.repeat(5000) + ' # deep [[x]]\n' + '- a\n'.repeat(1) + ' '.repeat(2) + '- b\n');
  assert.equal(typeof r.error === 'string' || r.error === null, true);
});

test('fuzz: random garbage never throws and offsets stay in range', () => {
  let seed = 12345;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const alphabet = ['[', ']', '(', ')', '[[', ']]', '!', '#', '---\n', '\n', '`', '```\n', '<', '>', '|', '\\', ' ', 'a', 'b.md', '%', 'http://x.y', ':', '*', '_', '\r\n', '\t', '> ', '- '];
  for (let i = 0; i < 400; i++) {
    let s = '';
    for (let n = Math.floor(rand() * 60); n > 0; n--) s += alphabet[Math.floor(rand() * alphabet.length)];
    const r = parse(s);
    assert.equal(r.error, null, JSON.stringify(s));
    for (const l of r.links) {
      assert.ok(l.start >= 0 && l.end <= s.length && l.start < l.end, JSON.stringify(s));
      if (l.pathStart !== null) {
        assert.ok(l.pathStart >= l.start && l.pathEnd <= l.end && l.pathStart <= l.pathEnd, JSON.stringify(s));
      }
    }
  }
});

// ------------------------------------------------------------ classify

test('classifyDestination: Windows drive letters are files, protocol-relative is other', () => {
  assert.equal(classifyDestination('C:/docs/x.pdf').kind, 'file');
  assert.equal(classifyDestination('//evil.com/x').kind, 'other');
  assert.equal(classifyDestination('data:text/html,<script>').kind, 'other');
  assert.equal(classifyDestination('Foo.MD').kind, 'page');
  assert.equal(classifyDestination('folder/').kind, 'file');
});

// ------------------------------------------------------------ bare URLs

test('bare URLs: punctuation trimmed, parentheses balanced, www. supported', () => {
  const src = 'Go to https://a.com/x, or (https://b.com/y_(z)) or www.c.org. Done: http://d.net/p?q=1!';
  const urls = parse(src).links.map((l) => l.url);
  assert.deepEqual(urls, ['https://a.com/x', 'https://b.com/y_(z)', 'http://www.c.org', 'http://d.net/p?q=1']);
  for (const l of parse(src).links) assert.equal(src.slice(l.start, l.end), l.raw);
});

test('bare URLs: not duplicated inside links, code, html or wikilinks', () => {
  const src = [
    '[text https://in-text.com](https://dest.com)',
    '`https://code.com`',
    '<div>https://html.com</div>',
    '[[https://wiki.com]]',
    '<https://angle.com>',
    'plain https://plain.com',
  ].join('\n\n');
  const urls = parse(src).links.filter((l) => l.kind === 'web').map((l) => l.url);
  assert.deepEqual(urls, ['https://dest.com', 'https://angle.com', 'https://plain.com']);
});

test('bare URLs: a lone scheme or "www." is not a link', () => {
  assert.deepEqual(parse('see http:// and www. here').links, []);
});

test('[[?query]] is not a link, and [[Page|=Label]] is a link with the label as its text', () => {
  const links = parse('See [[?status:todo]] and [[Grace|=Open Grace]].').links;
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'Grace');
  assert.equal(links[0].text, 'Open Grace');
});

test('a path with spaces in a destination is one link (and an embed with a bang)', async () => {
  const { parse } = await import('../src/index.js');
  const r = parse('![pic.jpg](Tasks/Work on it/pic.jpg)\n\n[a b](Some folder/x.pdf) [c](d.md "a title") [e](<f g.md>)\n');
  assert.deepEqual(r.links.map((l) => [l.kind, l.embed, l.target]), [
    ['file', true, 'Tasks/Work on it/pic.jpg'],
    ['file', false, 'Some folder/x.pdf'],
    ['page', false, 'd.md'],
    ['page', false, 'f g.md'],
  ]);
  assert.equal(r.links[0].raw, 'Tasks/Work on it/pic.jpg');
});

test('links to a page of another workspace', () => {
  const r = parse('See [[Theology::Writings/Grace#Imputation|favour]] and [x](cave://Theology/Writings/Grace.md#Imputation) and [[Plain]].');
  const [a, b, c] = r.links;
  assert.equal(a.kind, 'workspace');
  assert.equal(a.workspace, 'Theology');
  assert.equal(a.target, 'Writings/Grace');
  assert.equal(a.fragment, 'Imputation');
  assert.equal(a.text, 'favour');
  assert.equal(b.kind, 'workspace');
  assert.equal(b.workspace, 'Theology');
  assert.equal(b.target, 'Writings/Grace.md');
  assert.equal(b.fragment, 'Imputation');
  assert.equal(c.kind, 'page');
});
