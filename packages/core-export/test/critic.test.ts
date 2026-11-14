import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { BUILTIN_STYLES, parseDoc, plainText, renderDocx, renderHtml, renderOdt, type Block } from '../src/index';
import { collectComments, criticize } from '../src/critic';

const MD = 'Before {==a highlight with **bold** inside==}{>>Why this?<<} after.\n\nA lone comment{>>just a note<<} here, and {==highlight only==}.\n\nAn {>>unfinished comment and `{==code==}` stay.\n';
const style = BUILTIN_STYLES[0]!;
const part = async (bytes: Uint8Array, name: string): Promise<string> => (await JSZip.loadAsync(bytes)).file(name)!.async('string');

describe('CriticMarkup in the document model', () => {
  it('marks highlighted runs and anchors comments, and takes the markers out of the text', () => {
    const [p1, p2, p3] = parseDoc(MD) as Array<Extract<Block, { t: 'para' }>>;
    expect(plainText(p1!.inlines)).toBe('Before a highlight with bold inside after.');
    const hl = p1!.inlines.filter((i) => i.hl !== undefined);
    expect(hl.map((i) => i.text).join('')).toBe('a highlight with bold inside');
    expect(hl.find((i) => i.bold)?.text).toBe('bold');
    const c1 = p1!.inlines.find((i) => i.cmt)!;
    expect(c1.cmt).toEqual({ id: hl[0]!.hl, text: 'Why this?' });
    // a comment with no highlight before it has an id of its own
    const c2 = p2!.inlines.find((i) => i.cmt)!;
    expect(c2.cmt!.text).toBe('just a note');
    expect(plainText(p2!.inlines)).toBe('A lone comment here, and highlight only.');
    expect(p2!.inlines.filter((i) => i.hl !== undefined).map((i) => i.text)).toEqual(['highlight only']);
    expect(c2.cmt!.id).not.toBe(c1.cmt!.id);
    // a comment that never ends is shown as written
    expect(plainText(p3!.inlines)).toContain('{>>unfinished comment and');
    expect(collectComments(parseDoc(MD)).map((c) => [c.n, c.text])).toEqual([[1, 'Why this?'], [2, 'just a note']]);
  });

  it('leaves text without markers alone', () => {
    const runs = [{ text: 'plain {braces} and ==equals==' }];
    expect(criticize(runs, () => 1)).toBe(runs);
  });
});

describe('CriticMarkup in the files', () => {
  it('HTML (and so PDF): highlights, numbered comment marks, and the comments listed at the end', () => {
    const html = renderHtml(parseDoc(MD), style, {});
    expect(html).toContain('<mark class="hl">a highlight with </mark>');
    expect(html).toMatch(/<sup class="cm"><a href="#cm1" id="cmr1" title="Why this\?">\[1\]<\/a><\/sup>/);
    expect(html).toContain('<h2>Comments</h2>');
    expect(html).toContain('<span class="comment-n">[2]</span>just a note');
    expect(html).not.toContain('{==a highlight');
    expect(renderHtml(parseDoc('No markers here.'), style, {})).not.toContain('Comments');
  });

  it('Word: the comments are Word comments, ranged over the highlighted text', async () => {
    const bytes = await renderDocx(parseDoc(MD), style);
    const comments = await part(bytes, 'word/comments.xml');
    expect(comments).toContain('Why this?');
    expect(comments).toContain('just a note');
    const doc = await part(bytes, 'word/document.xml');
    expect((doc.match(/<w:commentRangeStart /g) ?? []).length).toBe(2);
    expect((doc.match(/<w:commentRangeEnd /g) ?? []).length).toBe(2);
    expect((doc.match(/<w:commentReference /g) ?? []).length).toBe(2);
    expect(doc).toContain('w:highlight w:val="yellow"');
    // the range starts before the highlighted text and ends after it
    expect(doc.indexOf('commentRangeStart')).toBeLessThan(doc.indexOf('a highlight with '));
    expect(doc.indexOf('commentRangeEnd')).toBeGreaterThan(doc.indexOf('inside'));
    expect(doc).not.toContain('{==a highlight');
  });

  it('OpenDocument: the comments are annotations, ranged over the highlighted text', async () => {
    const content = await part(await renderOdt(parseDoc(MD), style), 'content.xml');
    expect((content.match(/<office:annotation /g) ?? []).length).toBe(2);
    expect(content).toMatch(/<office:annotation office:name="cn1"><dc:creator>Comment<\/dc:creator><dc:date>[^<]+<\/dc:date><text:p>Why this\?<\/text:p><\/office:annotation>/);
    expect(content).toContain('<office:annotation-end office:name="cn1"/>');
    expect(content.indexOf('<office:annotation ')).toBeLessThan(content.indexOf('a highlight with'));
    expect(content).toContain('fo:background-color="#ffff00"');
    expect(content).not.toContain('{==a highlight');
    expect(content).not.toContain('\u0001');
  });

  it('a document without comments gets no comments part', async () => {
    const zip = await JSZip.loadAsync(await renderDocx(parseDoc('Just text.'), style));
    expect(zip.file('word/comments.xml')).toBeNull();
  });
});
