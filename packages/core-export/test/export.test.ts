import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { BUILTIN_STYLES, cleanStyleSet, exportPage, parseDoc, renderHtml } from '../src/index';

const SAMPLE = `---
status: draft
---
# Title

Some **bold**, *italic*, ~~gone~~, \`code\` and a [link](https://example.com) with [[Wiki Page|shown]].

> quoted text

a. first
b. second
   i. deep one
   ii. deep two
c. third

A new list:

1. one
2. two

- [ ] todo
- [x] done

| A | B |
|---|--:|
| 1 | 2 |

\`\`\`js
let x = 1;
\`\`\`

\`\`\`view
type: table
\`\`\`

---
`;

describe('parsing', () => {
  it('reads blocks, dropping frontmatter and view blocks, and keeping lettered lists', () => {
    const b = parseDoc(SAMPLE);
    expect(b[0]).toMatchObject({ t: 'heading', level: 1 });
    expect(b.some((x) => x.t === 'code' && x.lang === 'view')).toBe(false);
    const lists = b.filter((x) => x.t === 'list') as Array<Extract<(typeof b)[number], { t: 'list' }>>;
    expect(lists[0]).toMatchObject({ ordered: true, kind: 'alpha', start: 1 });
    expect(lists[0]!.items).toHaveLength(3);
    const nested = lists[0]!.items[1]!.blocks.find((x) => x.t === 'list') as (typeof lists)[number];
    expect(nested).toMatchObject({ ordered: true, kind: 'roman' });
    expect(lists[1]).toMatchObject({ ordered: true, kind: 'decimal' });
    expect(lists[2]!.items.map((i) => i.checked)).toEqual([false, true]);
    const para = b.find((x) => x.t === 'para') as { inlines: Array<{ text: string }> };
    expect(para.inlines.map((i) => i.text).join('')).toContain('shown');
  });
});

describe('html', () => {
  it('uses the style set and the right list types', () => {
    const html = renderHtml(parseDoc(SAMPLE), BUILTIN_STYLES[1]!, { title: 'T' });
    expect(html).toContain("font-family:'Times New Roman'");
    expect(html).toContain('line-height:2');
    expect(html).toContain('<ol type="a">');
    expect(html).toContain('<ol type="i">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).not.toContain('type: table');
  });
  it('adds the page title as a heading when the style asks and the page has none', () => {
    const report = BUILTIN_STYLES[2]!;
    expect(renderHtml(parseDoc('Just text'), report, { title: 'My Page' })).toContain('<h1>My Page</h1>');
    expect(renderHtml(parseDoc('# Own\n\ntext'), report, { title: 'My Page' })).not.toContain('<h1>My Page</h1>');
  });
});

describe('docx and odt', () => {
  it('makes a docx package with the content and numbering', async () => {
    const bytes = (await exportPage(SAMPLE, 'docx', BUILTIN_STYLES[0]!, 'T')) as Uint8Array;
    const zip = await JSZip.loadAsync(bytes);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('bold');
    expect(doc).toContain('shown');
    expect(doc).toContain('w:hyperlink');
    expect(doc).toContain('w:tbl');
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    expect(numbering).toContain('lowerLetter');
    expect(numbering).toContain('lowerRoman');
    expect(numbering).toContain('decimal');
  });

  it('makes an odt package that begins with the stored mimetype', async () => {
    const bytes = (await exportPage(SAMPLE, 'odt', BUILTIN_STYLES[2]!, 'T')) as Uint8Array;
    expect(Buffer.from(bytes.slice(30, 38)).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.oasis.opendocument.text');
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('<text:h text:style-name="H1"');
    expect(content).toContain('xlink:href="https://example.com"');
    expect(content).toContain('<table:table ');
    expect(content).not.toContain('</table:table:table>');
    const styles = await zip.file('styles.xml')!.async('string');
    expect(styles).toContain('style:num-format="a"');
    expect(styles).toContain('style:num-format="i"');
    // both are well-formed XML
    const jsdom: any = await import('jsdom' as string);
    const { DOMParser } = new jsdom.JSDOM('').window;
    for (const xml of [content, styles]) {
      const d = new DOMParser().parseFromString(xml, 'application/xml');
      expect(d.getElementsByTagName('parsererror').length).toBe(0);
    }
  });
});

describe('style sets', () => {
  it('are checked: odd values fall back to the base set', () => {
    const s = cleanStyleSet({ name: 'X', body: { font: 'Bad;font', sizePt: 500, color: 'red' }, page: { size: 'B7', marginCm: 99 }, headings: [{ sizePt: 30 }] }, BUILTIN_STYLES[0]!);
    expect(s.name).toBe('X');
    expect(s.body.font).toBe(BUILTIN_STYLES[0]!.body.font);
    expect(s.body.sizePt).toBe(36);
    expect(s.body.color).toBe(BUILTIN_STYLES[0]!.body.color);
    expect(s.page.size).toBe('A4');
    expect(s.page.marginCm).toBe(6);
    expect(s.headings[0]!.sizePt).toBe(30);
    expect(s.headings).toHaveLength(6);
  });
});

import { parseStyleSetsYaml, stringifyStyleSets, renderDocx, renderOdt } from '../src/index';

describe('footnotes and style files', () => {
  const MD = 'Text[^1] and more[^b].\n\n[^b]: Second.\n[^1]: First.\n';
  it('numbers footnotes by reference and keeps their text', () => {
    const b = parseDoc(MD);
    const notes = b[b.length - 1] as { t: string; items: unknown[][] };
    expect(notes.t).toBe('notes');
    expect(notes.items).toHaveLength(2);
    const html = renderHtml(b, BUILTIN_STYLES[0]!);
    expect(html).toContain('id="fnr1"');
    expect(html).toContain('class="note"');
  });
  it('writes real notes to odt and docx', async () => {
    const odt = await JSZip.loadAsync(await renderOdt(parseDoc(MD), BUILTIN_STYLES[0]!));
    expect(await odt.file('content.xml')!.async('string')).toContain('text:note-class="footnote"');
    const end = await JSZip.loadAsync(await renderOdt(parseDoc(MD), { ...BUILTIN_STYLES[0]!, footnotes: { ...BUILTIN_STYLES[0]!.footnotes, endnotes: true } }));
    expect(await end.file('content.xml')!.async('string')).toContain('text:note-class="endnote"');
    const docx = await JSZip.loadAsync(await renderDocx(parseDoc(MD), BUILTIN_STYLES[0]!));
    expect(docx.file('word/footnotes.xml')).toBeTruthy();
  });
  it('reads and writes style sets as YAML, with units and base', () => {
    const { sets, errors } = parseStyleSetsYaml('Mine:\n  base: Report\n  units: in\n  page: { size: Letter, margin: 1in }\n  body: { font: Crimson Pro, size: 12pt }\n  footnotes: { placement: endnotes }\n');
    expect(errors).toEqual([]);
    expect(sets[0]!.page.marginCm).toBeCloseTo(2.54);
    expect(sets[0]!.body.font).toBe('Crimson Pro');
    expect(sets[0]!.footnotes.endnotes).toBe(true);
    expect(sets[0]!.headings[0]!.color).toBe('#7a1f1f'); // from Report
    const again = parseStyleSetsYaml(stringifyStyleSets(sets)).sets[0]!;
    expect(again.page.marginCm).toBeCloseTo(2.54, 1);
    expect(again.body).toEqual(sets[0]!.body);
    expect(again.footnotes).toEqual(sets[0]!.footnotes);
  });
  it('reports what it cannot read', () => {
    expect(parseStyleSetsYaml('Mine: [1,').errors.length).toBe(1);
    expect(parseStyleSetsYaml('A: 3').errors[0]).toContain('settings');
  });
});

// ---------------------------------------------------------------- regressions found by checking exports in LibreOffice and pandoc

const part = async (bytes: Uint8Array, name: string): Promise<string> => (await JSZip.loadAsync(bytes)).file(name)!.async('string');
const docxOf = async (md: string, style = BUILTIN_STYLES[0]!) => part(await renderDocx(parseDoc(md), style), 'word/document.xml');
const odtOf = async (md: string, style = BUILTIN_STYLES[0]!) => part(await renderOdt(parseDoc(md), style), 'content.xml');

describe('export regressions', () => {
  it('docx: a second paragraph of a list item is indented, not given a marker of its own', async () => {
    const xml = await docxOf('- one\n\n  continued\n\n- two\n');
    const paras = xml.split('<w:p>').filter((p) => p.includes('continued'));
    expect(paras).toHaveLength(1);
    expect(paras[0]).not.toContain('<w:numPr>');
    expect(paras[0]).toContain('<w:ind');
  });

  it('docx: tabs in code are tab elements, and code has named styles other programs can read', async () => {
    const xml = await docxOf('```\na\tb\n```\n\nand `x` inline\n');
    expect(xml).toContain('<w:tab/>');
    expect(xml).toContain('w:val="SourceCode"');
    expect(xml).toContain('w:val="VerbatimChar"');
  });

  it('odt: nested quotes are nested, each level with its own indent', async () => {
    const xml = await odtOf('> a\n>\n> > b\n');
    expect(xml).toContain('text:style-name="Quote1"');
    expect(xml).toContain('text:style-name="Quote2"');
  });

  it('odt: a table never sits inside a list item (not allowed in ODF; LibreOffice drops it)', async () => {
    const xml = await odtOf('1. one\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\n2. two\n');
    const jsdom: any = await import('jsdom' as string);
    const doc = new jsdom.JSDOM(xml, { contentType: 'application/xml' }).window.document;
    expect(doc.getElementsByTagName('table:table').length).toBe(1);
    for (const item of [...doc.getElementsByTagName('text:list-item'), ...doc.getElementsByTagName('text:list-header')]) expect(item.getElementsByTagName('table:table').length).toBe(0);
    expect(xml).toContain('text:continue-numbering="true"');
  });

  it('odt: table cells keep their alignment', async () => {
    const xml = await odtOf('| a | b | c |\n|:--|--:|:-:|\n| 1 | 2 | 3 |\n');
    expect(xml).toContain('TDL');
    expect(xml).toContain('TDR');
    expect(xml).toContain('TDC');
  });

  it('a note referred to twice is written twice, numbered by reference, in both formats', async () => {
    const md = 'One[^a] two[^a] three[^b].\n\n[^a]: A note.\n[^b]: B note.\n';
    const docx = await JSZip.loadAsync(await renderDocx(parseDoc(md), BUILTIN_STYLES[0]!));
    const notes = await docx.file('word/footnotes.xml')!.async('string');
    expect(notes.match(/<w:footnote /g)!.filter((x) => x).length).toBeGreaterThanOrEqual(3 + 2); // separators + three notes
    expect((notes.match(/A note\./g) ?? []).length).toBe(2);
    const odt = await odtOf(md);
    expect((odt.match(/<text:note /g) ?? []).length).toBe(3);
    expect(odt).toContain('<text:note-citation>3</text:note-citation>');
  });

  it('a page that starts with a horizontal rule keeps its text', () => {
    const b = parseDoc('---\n\nbefore\n\n---\n\nafter\n');
    expect(b.filter((x) => x.t === 'para')).toHaveLength(2);
    const fm = parseDoc('---\ntitle: x\n---\n\nbody\n');
    expect(fm.filter((x) => x.t === 'para')).toHaveLength(1);
  });

  it('characters XML cannot hold are dropped, so Word does not report a damaged file', async () => {
    const md = 'a\u0001b\u0008c\ud800d\n';
    expect(await docxOf(md)).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(await odtOf(md)).toContain('abcd');
  });

  it('a table has the same number of cells in every row (as GitHub reads it)', () => {
    const t = parseDoc('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| only |\n').find((x) => x.t === 'table') as Extract<ReturnType<typeof parseDoc>[number], { t: 'table' }>;
    expect(t.rows.map((r) => r.length)).toEqual([2, 2]);
  });

  it('HTML tags are not printed, but text in angle brackets that is not HTML is kept', () => {
    const text = (md: string): string => parseDoc(md).map((b) => (b.t === 'para' ? b.inlines.map((i) => i.text).join('') : '')).join('');
    expect(text('see <angle> here')).toBe('see <angle> here');
    expect(text('a <span>b</span> c <!-- hidden --> d')).toBe('a b c  d');
  });
});

describe('first-line indents', () => {
  const style = { ...BUILTIN_STYLES[0]!, body: { ...BUILTIN_STYLES[0]!.body, firstLineIndentCm: 1.27 } };
  const paras = (md: string) => parseDoc(md).filter((b) => b.t === 'para') as Array<{ t: 'para'; cont?: boolean }>;

  it('a paragraph cut by a quote carries on without a new indent when no blank line separates the parts', () => {
    const md = 'Intro line\n> quoted\n>\nCarries on here.\n\nNew paragraph.\n';
    expect(parseDoc(md).map((b) => b.t)).toEqual(['para', 'quote', 'para', 'para']);
    expect(paras(md).map((p) => !!p.cont)).toEqual([false, true, false]);
  });

  it('a blank line on either side of the quote makes it a new paragraph', () => {
    expect(paras('Intro\n\n> quoted\n\nAfter.\n').map((p) => !!p.cont)).toEqual([false, false]);
    expect(paras('Intro\n> quoted\n>\n\nAfter.\n').map((p) => !!p.cont)).toEqual([false, false]);
    expect(paras('Intro\n\n> quoted\n>\nAfter.\n').map((p) => !!p.cont)).toEqual([false, false]);
  });

  it('several quotes in a row keep the paragraph going', () => {
    expect(paras('Intro\n> one\n>\n> two\n>\nBack to it.\n').map((p) => !!p.cont)).toEqual([false, true]);
  });

  it('indents body paragraphs in Word, OpenDocument and HTML, but not continuations, quotes, lists or (when asked) the one after a heading', async () => {
    const md = '# Head\n\nFirst.\n> quoted\n>\nCarries on.\n\nSecond.\n\n- item\n';
    const docx = await JSZip.loadAsync(await exportPage(md, 'docx', style) as Uint8Array);
    const xml = await docx.file('word/document.xml')!.async('string');
    expect(xml.match(/w:firstLine="720"/g)?.length).toBe(2); // First. and Second.: not the heading, the continuation, the quote or the list
    const odt = await JSZip.loadAsync(await exportPage(md, 'odt', style) as Uint8Array);
    const content = await odt.file('content.xml')!.async('string');
    expect(content.match(/text:style-name="BodyIndent"/g)?.length).toBe(2);
    expect(await odt.file('styles.xml')!.async('string')).toContain('fo:text-indent="1.27cm"');
    const html = await exportPage(md, 'html', style) as string;
    expect(html.match(/<p class="ind">/g)?.length).toBe(2);
    expect(html).toContain('p.ind{text-indent:1.27cm}');

    const flush = { ...style, body: { ...style.body, indentAfterHeading: false } };
    const html2 = await exportPage('# Head\n\nFirst.\n\nSecond.\n', 'html', flush) as string;
    expect(html2.match(/<p class="ind">/g)?.length).toBe(1);
    expect(html2).toContain('<p>First.</p>');
  });

  it('does nothing when the style has no indent', async () => {
    const html = await exportPage('One.\n\nTwo.\n', 'html', BUILTIN_STYLES[0]!) as string;
    expect(html).not.toContain('class="ind"');
  });
});

describe('styled blocks (::: name)', () => {
  const md = 'Before.\n\n::: hanging\nSmith, J. A long entry that wraps.\n\nJones, K. Another entry.\n:::\n\n::: {.poem}\nRoses\n:::\n\n```\n::: not a div\n```\n\nAfter.\n';

  it('reads fences, braces and custom-style, and leaves code alone', () => {
    const b = parseDoc(md);
    expect(b.map((x) => x.t)).toEqual(['para', 'div', 'div', 'code', 'para']);
    expect((b[1] as any).classes).toEqual(['hanging']);
    expect((b[1] as any).blocks).toHaveLength(2);
    expect((b[2] as any).classes).toEqual(['poem']);
    expect((parseDoc('::: {custom-style="Block Text"}\nx\n:::')[0] as any).classes).toEqual(['Block-Text']);
  });

  it('a style set can define and change styles, in YAML', () => {
    const { sets, errors } = parseStyleSetsYaml('S:\n  units: in\n  styles:\n    hanging: { indent: 0.5, hanging: 0.5 }\n    poem: { indent: 1in, italic: true, after: 0pt }\n  css: ".cn-poem { color: red }"\n');
    expect(errors).toEqual([]);
    expect(sets[0]!.styles.hanging).toEqual({ indentCm: 1.27, hangingCm: 1.27 });
    expect(sets[0]!.styles.poem).toEqual({ indentCm: 2.54, italic: true, after: 0 });
    const again = parseStyleSetsYaml(stringifyStyleSets(sets)).sets[0]!;
    expect(again.styles).toEqual(sets[0]!.styles);
    expect(again.css).toContain('color: red');
  });

  it('is written to HTML, Word and OpenDocument', async () => {
    const set = parseStyleSetsYaml('S:\n  styles:\n    poem: { indent: 2cm, italic: true }\n').sets[0]!;
    const html = await exportPage(md, 'html', set) as string;
    expect(html).toContain('<div class="cn-hanging"><p>Smith');
    expect(html).toContain('.cn-hanging>p{margin-left:1.27cm;text-indent:-1.27cm}');
    expect(html).toContain('.cn-poem>p{margin-left:2cm');
    const docx = await JSZip.loadAsync(await exportPage(md, 'docx', set) as Uint8Array);
    const xml = await docx.file('word/document.xml')!.async('string');
    expect(xml.match(/w:hanging="720"/g)?.length).toBe(2);
    const odt = await JSZip.loadAsync(await exportPage(md, 'odt', set) as Uint8Array);
    expect(await odt.file('styles.xml')!.async('string')).toContain('fo:text-indent="-1.27cm"');
    expect(await odt.file('content.xml')!.async('string')).toMatch(/text:style-name="Named1">Smith/);
  });
});

describe('heading line height', () => {
  it('is read from YAML and written to HTML, Word and OpenDocument', async () => {
    const set = parseStyleSetsYaml('S:\n  h1: { lineHeight: 1.6 }\n  h2: { lineHeight: 0.9 }\n').sets[0]!;
    expect(set.headings[0]!.lineHeight).toBe(1.6);
    expect(parseStyleSetsYaml(stringifyStyleSets([set])).sets[0]!.headings[1]!.lineHeight).toBe(0.9);
    const md = '# One\n\n## Two\n';
    expect(await exportPage(md, 'html', set) as string).toContain('line-height:1.6;');
    const docx = await JSZip.loadAsync(await exportPage(md, 'docx', set) as Uint8Array);
    expect(await docx.file('word/document.xml')!.async('string')).toContain('w:line="384"');
    const odt = await JSZip.loadAsync(await exportPage(md, 'odt', set) as Uint8Array);
    expect(await odt.file('styles.xml')!.async('string')).toContain('fo:line-height="160%"');
  });
});

describe('a paragraph that goes on after a list', () => {
  const paras = (md: string) => parseDoc(md).filter((b) => b.t === 'para') as Array<{ cont?: boolean }>;
  it('continues the paragraph above when a lone comment line ends the list', () => {
    const md = 'Three things:\n- one\n- two\n<!-- -->\nand that is all.\n';
    const bs = parseDoc(md);
    expect(bs.map((b) => b.t)).toEqual(['para', 'list', 'para']);
    expect(paras(md)[1]!.cont).toBe(true);
    const list = bs[1] as { items: Array<{ blocks: Array<{ inlines: Array<{ text: string }> }> }> };
    expect(list.items[1]!.blocks[0]!.inlines.map((i) => i.text).join('')).toBe('two');
  });
  it('is a new paragraph when a blank line comes between, or no comment line', () => {
    expect(paras('Intro:\n- one\n<!-- -->\n\nafter.\n')[1]!.cont).toBeFalsy();
    expect(paras('Intro:\n- one\n\nafter.\n')[1]!.cont).toBeFalsy();
  });
});

describe('a paragraph that goes on after a block quote', () => {
  const paras = (md: string) => parseDoc(md).filter((b) => b.t === 'para') as Array<{ cont?: boolean }>;
  it('continues the paragraph above when a lone comment line ends the quote', () => {
    const md = 'He said:\n> Grace is not earned.\n<!-- -->\nand the argument goes on.\n';
    const bs = parseDoc(md);
    expect(bs.map((b) => b.t)).toEqual(['para', 'quote', 'para']);
    expect(paras(md)[1]!.cont).toBe(true);
  });
  it('without the comment line the text is pulled into the quote; a blank line makes a new paragraph', () => {
    expect(parseDoc('He said:\n> Grace.\nmore.\n').map((b) => b.t)).toEqual(['para', 'quote']);
    expect(paras('He said:\n> Grace.\n<!-- -->\n\nafter.\n')[1]!.cont).toBeFalsy();
  });
});

describe('the default styles as a file', () => {
  it('written out as YAML they read back as the same styles', async () => {
    const { BUILTIN_STYLES, stringifyStyleSets, parseStyleSetsYaml } = await import('../src/index');
    const back = parseStyleSetsYaml(stringifyStyleSets(BUILTIN_STYLES));
    expect(back.errors).toEqual([]);
    expect(back.sets.map((x) => x.name)).toEqual(BUILTIN_STYLES.map((x) => x.name));
    for (const [i, b] of BUILTIN_STYLES.entries()) {
      expect(back.sets[i]!.body).toEqual(b.body);
      expect(back.sets[i]!.page).toEqual(b.page);
      expect(back.sets[i]!.headings).toEqual(b.headings);
    }
  });
});

describe('counting words', () => {
  it('leaves out the attributes and the marks', async () => {
    const { countWords } = await import('../src/index');
    expect(countWords('---\ntitle: A long title here\n---\n# Two words\n\nOne **bold** [link](http://x.y) and `code`.\n\n- item one\n- item two\n')).toBe(2 + 5 + 4);
    expect(countWords('')).toBe(0);
  });

  it('does not count footnotes', async () => {
    const { countWords } = await import('../src/index');
    expect(countWords('One two three[^a].\n\n[^a]: This note has seven words in it.\n')).toBe(3);
  });

  it('does not count a nocount block: alone, with other classes, or holding another block', async () => {
    const { countWords, parseDoc } = await import('../src/index');
    expect(countWords('Body words here.\n\n::: nocount\nIgnored words in here.\n:::\n\nMore body.\n')).toBe(5);
    expect(countWords('Body.\n\n::: hanging nocount\n# Bibliography\n\nSmith, A. A book.\n:::\n')).toBe(1);
    const nested = 'Body words.\n\n::: nocount\n# Bibliography\n\n::: hanging\nFirst item\n\nSecond item\n::: :::\n\nAfter the block counts.\n';
    expect(countWords(nested)).toBe(2 + 4);
    // the block that closes two on one line really closes both
    const blocks = parseDoc(nested);
    expect(blocks.map((b) => b.t)).toEqual(['para', 'div', 'para']);
    const outer = blocks[1] as Extract<(typeof blocks)[number], { t: 'div' }>;
    expect(outer.classes).toEqual(['nocount']);
    expect(outer.blocks.map((b) => b.t)).toEqual(['heading', 'div']);
    expect((outer.blocks[1] as typeof outer).classes).toEqual(['hanging']);
  });
});

describe('headers, footers and page numbers', () => {
  const yaml = 'T:\n  base: Clean\n  header:\n    odd: { right: "{title}" }\n    even: { left: "{title}" }\n    firstPage: false\n  footer:\n    center: "Page {page} of {pages}"\n';
  const load = async () => (await import('../src/index')).parseStyleSetsYaml(yaml).sets[0]!;
  it('reads odd and even texts and writes them back', async () => {
    const { stringifyStyleSets, parseStyleSetsYaml } = await import('../src/index');
    const set = await load();
    expect(set.header.odd.right).toBe('{title}');
    expect(set.header.even.left).toBe('{title}');
    expect(set.header.firstPage).toBe(false);
    expect(set.footer.odd.center).toBe('Page {page} of {pages}');
    expect(set.footer.even.center).toBe('Page {page} of {pages}');
    const again = parseStyleSetsYaml(stringifyStyleSets([set])).sets[0]!;
    expect(again.header).toEqual(set.header);
    expect(again.footer).toEqual(set.footer);
  });
  it('is in the Word, OpenDocument and print files', async () => {
    const set = await load();
    const md = 'Hello\n';
    const docx = await JSZip.loadAsync((await exportPage(md, 'docx', set, 'Doc')) as Uint8Array);
    expect(Object.keys(docx.files).filter((f) => /word\/(header|footer)\d*\.xml/.test(f)).length).toBeGreaterThanOrEqual(3);
    expect(await docx.file('word/settings.xml')!.async('string')).toContain('evenAndOddHeaders');
    const odt = await JSZip.loadAsync((await exportPage(md, 'odt', set, 'Doc')) as Uint8Array);
    const styles = await odt.file('styles.xml')!.async('string');
    expect(styles).toContain('<style:header-left>');
    expect(styles).toContain('<text:page-number');
    const html = renderHtml(parseDoc(md), set, { title: 'Doc' });
    expect(html).toContain('@page :left{@top-left{content:"Doc"');
    expect(html).toContain('counter(page) " of " counter(pages)');
    expect(html).toContain('@page :first');
  });
  it('adds nothing to a set without any', () => {
    expect(renderHtml(parseDoc('x'), BUILTIN_STYLES[0]!, { title: 't' })).not.toContain('@top-');
  });
});
