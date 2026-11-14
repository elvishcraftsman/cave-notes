import JSZip from 'jszip';
import type { Block, Inline, ListKind } from './doc';
import { hasHeaderFooter, headerFooterDiffers, hfTokens, PAGE_CM, resolveNamed, type HeaderFooter, type HeaderFooterText, type NamedStyle, type StyleSet } from './styles';

const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pt = (n: number): string => `${n}pt`;
const cm = (n: number): string => `${Math.round(n * 1000) / 1000}cm`;

const QUOTE_LEVELS = 6;
const NUM_FORMAT: Record<ListKind, string> = { decimal: '1', alpha: 'a', ALPHA: 'A', roman: 'i', ROMAN: 'I' };
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';

function listStyle(name: string, kind: ListKind | 'bullet', indent: number): string {
  const levels = Array.from({ length: 9 }, (_, i) => {
    const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${cm(indent * (i + 1))}" fo:text-indent="${cm(-indent * 0.9)}" fo:margin-left="${cm(indent * (i + 1))}"/></style:list-level-properties>`;
    return kind === 'bullet'
      ? `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${['\u2022', '\u25E6', '\u25AA'][i % 3]}">${props}</text:list-level-style-bullet>`
      : `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${NUM_FORMAT[kind]}">${props}</text:list-level-style-number>`;
  }).join('');
  return `<text:list-style style:name="${name}">${levels}</text:list-style>`;
}

export async function renderOdt(blocks: Block[], style: StyleSet, opts: { title?: string } = {}): Promise<Uint8Array> {
  const b = style.body;
  // automatic text styles, made as inline formats are met
  const spans = new Map<string, string>();
  const spanDefs: string[] = [];
  const spanName = (i: Inline): string | null => {
    const key = [i.bold ? 'b' : '', i.italic ? 'i' : '', i.strike ? 's' : '', i.code ? 'c' : '', i.link ? 'l' : '', i.hl !== undefined ? 'h' : ''].join('');
    if (!key) return null;
    let n = spans.get(key);
    if (!n) {
      n = `T${spans.size + 1}`;
      spans.set(key, n);
      const p = [
        i.bold ? 'fo:font-weight="bold"' : '',
        i.italic ? 'fo:font-style="italic"' : '',
        i.strike ? 'style:text-line-through-style="solid"' : '',
        i.hl !== undefined ? 'fo:background-color="#ffff00"' : '',
        i.code ? `style:font-name="${esc(style.code.font)}" fo:font-size="${pt(style.code.sizePt)}" fo:background-color="${style.code.background}"` : '',
        i.link ? `fo:color="${style.link.color}" ${style.link.underline ? 'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ''}` : '',
      ].filter(Boolean).join(' ');
      spanDefs.push(`<style:style style:name="${n}" style:family="text"><style:text-properties ${p}/></style:style>`);
    }
    return n;
  };
  // a note referred to twice is written twice, as its own numbered note
  let noteSeq = 0;
  // CriticMarkup comments are the document's own annotations: a range that starts at the highlight and ends at the comment
  let annSeq = 0;
  const annNames = new Map<number, string>();
  const annName = (a: number): string => {
    let n = annNames.get(a);
    if (!n) {
      n = `cn${++annSeq}`;
      annNames.set(a, n);
    }
    return n;
  };
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');
  const annotation = (name: string, text: string): string => `<office:annotation office:name=\"${name}\"><dc:creator>Comment</dc:creator><dc:date>${stamp}</dc:date><text:p>${esc(text)}</text:p></office:annotation>`;
  const inl = (items: Inline[]): string => {
    const withComment = new Set(items.filter((x) => x.cmt).map((x) => x.cmt!.id));
    const started = new Set<number>();
    const text: string[] = [];
    const lead = (i: Inline): string => {
      if (i.hl !== undefined && withComment.has(i.hl) && !started.has(i.hl)) {
        started.add(i.hl);
        // the annotation's text is written where its marker is, so it is found in `commentText`
        return `\u0001${annName(i.hl)}\u0001`;
      }
      return '';
    };
    for (const i of items) {
      if (i.cmt) {
        const name = annName(i.cmt.id);
        commentText.set(name, i.cmt.text);
        text.push(started.has(i.cmt.id) ? `<office:annotation-end office:name=\"${name}\"/>` : `\u0001${name}\u0001<office:annotation-end office:name=\"${name}\"/>`);
      } else text.push(lead(i) + one(i));
    }
    // each annotation's start holds its text, which is only known now
    return text.join('').replace(/\u0001(cn\d+)\u0001/g, (_m, name: string) => annotation(name, commentText.get(name) ?? ''));
  };
  const commentText = new Map<string, string>();
  const one = (i: Inline): string => {
        if (i.br) return '<text:line-break/>';
        if (i.note !== undefined) {
          const kind = style.footnotes.endnotes ? 'endnote' : 'footnote';
          const seq = ++noteSeq;
          return `<text:note text:id="${kind.slice(0, 3)}${seq}" text:note-class="${kind}"><text:note-citation>${seq}</text:note-citation><text:note-body>${body(noteItems[i.note - 1] ?? [], 0, 'Footnote').replace(/^(<text:p text:style-name="Footnote">)/, '$1<text:s/>')}</text:note-body></text:note>`;
        }
        let x = esc(i.text).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
        const n = spanName(i);
        if (n) x = `<text:span text:style-name="${n}">${x}</text:span>`;
        if (i.link && /^(https?:|mailto:)/i.test(i.link)) x = `<text:a xlink:type="simple" xlink:href="${esc(i.link)}">${x}</text:a>`;
        return x;
  };

  const noteItems = (blocks.find((x): x is Extract<Block, { t: 'notes' }> => x.t === 'notes'))?.items ?? [];
  const listStyles: string[] = [listStyle('LBullet', 'bullet', style.listIndentCm)];
  const usedLists = new Set<string>(['LBullet']);
  const ensureList = (kind: ListKind): string => {
    const name = `L${kind === 'decimal' ? 'Dec' : kind === 'alpha' ? 'Alpha' : kind === 'ALPHA' ? 'UAlpha' : kind === 'roman' ? 'Roman' : 'URoman'}`;
    if (!usedLists.has(name)) {
      usedLists.add(name);
      listStyles.push(listStyle(name, kind, style.listIndentCm));
    }
    return name;
  };

  type Tok = { k: 'x' | 'table'; s: string } | { k: 'open'; name: string } | { k: 'item'; start: string } | { k: 'end' } | { k: 'close' };
  const tableXml = (x: Extract<Block, { t: 'table' }>): string => {
    const cols = Math.max(x.head.length, ...x.rows.map((r) => r.length), 1);
    const al = (i: number): string => (x.align[i] === 'right' ? 'R' : x.align[i] === 'center' ? 'C' : 'L');
    const cell = (c: Inline[], head: boolean, i: number): string => `<table:table-cell table:style-name="${head ? 'CellHead' : 'Cell'}" office:value-type="string"><text:p text:style-name="${head ? 'TH' : 'TD'}${al(i)}">${inl(c)}</text:p></table:table-cell>`;
    return `<table:table table:style-name="Table"><table:table-column table:number-columns-repeated="${cols}"/><table:table-header-rows><table:table-row>${Array.from({ length: cols }, (_, i) => cell(x.head[i] ?? [], true, i)).join('')}</table:table-row></table:table-header-rows>${x.rows.map((r) => `<table:table-row>${Array.from({ length: cols }, (_, i) => cell(r[i] ?? [], false, i)).join('')}</table:table-row>`).join('')}</table:table><text:p text:style-name="Spacer"/>`;
  };
  /** the pieces of a list, as a flat run of tokens: ODF does not allow a table inside a list item, so a table ends the open lists and they are reopened (numbering continued) after it */
  function listToks(x: Extract<Block, { t: 'list' }>, quote: number, depth: number): Tok[] {
    const name = x.ordered ? ensureList(x.kind) : 'LBullet';
    const toks: Tok[] = [{ k: 'open', name }];
    x.items.forEach((it, idx) => {
      const box = it.checked === null ? '' : it.checked ? '\u2612 ' : '\u2610 ';
      const [first, ...rest] = it.blocks;
      const para = idx === x.items.length - 1 && it.blocks.length === 1 && depth === 0 ? 'ListLast' : 'ListItem';
      toks.push({ k: 'item', start: idx === 0 && x.ordered && x.start !== 1 ? ` text:start-value="${x.start}"` : '' });
      if (first && first.t === 'para') toks.push({ k: 'x', s: `<text:p text:style-name="${para}">${box}${inl(first.inlines)}</text:p>` });
      else toks.push({ k: 'x', s: `<text:p text:style-name="ListItem">${box}</text:p>` }, ...(first ? blockToks([first], quote, depth) : []));
      toks.push(...blockToks(rest, quote, depth), { k: 'end' });
    });
    toks.push({ k: 'close' });
    return toks;
  }
  function blockToks(bs: Block[], quote: number, depth: number): Tok[] {
    return bs.flatMap((b): Tok[] => (b.t === 'list' ? listToks(b, quote, depth + 1) : b.t === 'table' ? [{ k: 'table', s: tableXml(b) }] : [{ k: 'x', s: body([b], quote) }]));
  }
  function serialize(toks: Tok[]): string {
    const stack: Array<{ name: string; hdr: boolean }> = [];
    const shut = (f: { hdr: boolean }): string => (f.hdr ? '</text:list-header>' : '</text:list-item>');
    let out = '';
    for (const t of toks) {
      if (t.k === 'x') out += t.s;
      else if (t.k === 'open') { stack.push({ name: t.name, hdr: false }); out += `<text:list text:style-name="${t.name}">`; }
      else if (t.k === 'item') { stack[stack.length - 1]!.hdr = false; out += `<text:list-item${t.start}>`; }
      else if (t.k === 'end') out += shut(stack[stack.length - 1]!);
      else if (t.k === 'close') { out += '</text:list>'; stack.pop(); }
      else if (stack.length === 0) out += t.s;
      else {
        for (let n = stack.length - 1; n >= 0; n--) out += shut(stack[n]!) + '</text:list>';
        out += t.s;
        for (const f of stack) { f.hdr = true; out += `<text:list text:style-name="${f.name}" text:continue-numbering="true"><text:list-header>`; }
        out += '<text:p text:style-name="Hair"/>';
      }
    }
    return out;
  }

  /** `top`: the blocks are the page's own (not inside a quote or a list), where first-line indents apply */
  /** the paragraph styles that `::: name` blocks ask for, by the style they resolve to */
  const named = new Map<string, { name: string; st: NamedStyle }>();
  const namedStyleFor = (st: NamedStyle): string => {
    const key = JSON.stringify(st);
    let e = named.get(key);
    if (!e) named.set(key, (e = { name: `Named${named.size + 1}`, st }));
    return e.name;
  };

  function body(bs: Block[], quote: number, para = 'Body', top = false, inDiv: NamedStyle | null = null): string {
    return bs
      .map((x, bi) => {
        switch (x.t) {
          case 'heading': return `<text:h text:style-name="H${x.level}" text:outline-level="${x.level}">${inl(x.inlines)}</text:h>`;
          case 'para': {
            const indented = top && para === 'Body' && quote === 0 && style.body.firstLineIndentCm > 0 && !x.cont && (style.body.indentAfterHeading || bs[bi - 1]?.t !== 'heading');
            return `<text:p text:style-name="${quote > 0 ? `Quote${Math.min(quote, QUOTE_LEVELS)}` : indented ? 'BodyIndent' : para}">${inl(x.inlines)}</text:p>`;
          }
          case 'quote': return body(x.blocks, quote + 1, para, false, inDiv);
          case 'div': {
            const st = { ...inDiv, ...resolveNamed(style, x.classes) };
            return body(x.blocks, quote, quote > 0 ? para : namedStyleFor(st), false, st);
          }
          case 'notes': return '';
          case 'code': return x.text.split('\n').map((l) => `<text:p text:style-name="Code">${esc(l).replace(/^ +| {2,}/g, (m) => `<text:s text:c="${m.length}"/>`).replace(/\t/g, '<text:tab/>')}</text:p>`).join('') + '<text:p text:style-name="Spacer"/>';
          case 'hr': return '<text:p text:style-name="Rule"/>';
          case 'image': return `<text:p text:style-name="Body"><text:span text:style-name="Dim">[${esc(x.alt || 'image')}]</text:span></text:p>`;
          case 'list': return serialize(listToks(x, quote, 0));
          case 'table': return tableXml(x);
        }
      })
      .join('');
  }

  const all: Block[] = style.titleFromPage && opts.title && !(blocks[0]?.t === 'heading' && blocks[0].level === 1) ? [{ t: 'heading', level: 1, inlines: [{ text: opts.title }] }, ...blocks] : blocks;
  const content = body(all.filter((x) => x.t !== 'notes'), 0, 'Body', true);

  const par = (name: string, parent: string | null, props: string, text = ''): string =>
    `<style:style style:name="${name}" style:family="paragraph"${parent ? ` style:parent-style-name="${parent}"` : ''}><style:paragraph-properties ${props}/>${text ? `<style:text-properties ${text}/>` : ''}</style:style>`;
  const [w, h] = PAGE_CM[style.page.size];
  // running headers and footers: left, centre and right text on one line (two tab stops); the numbers are fields
  const textW = w - 2 * style.page.marginCm;
  const runPar = (name: string, hf: HeaderFooter): string =>
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:text-align="start"><style:tab-stops><style:tab-stop style:position="${cm(textW / 2)}" style:type="center"/><style:tab-stop style:position="${cm(textW)}" style:type="right"/></style:tab-stops></style:paragraph-properties><style:text-properties fo:font-size="${pt(hf.sizePt)}" fo:color="${hf.color}" fo:font-style="normal" fo:font-weight="normal"/></style:style>`;
  const runText = (t: string): string =>
    hfTokens(t, opts.title ?? '').map((k) => (k.t === 'text' ? esc(k.v).replace(/\t/g, '<text:tab/>') : k.t === 'page' ? '<text:page-number text:select-page="current">1</text:page-number>' : '<text:page-count>1</text:page-count>')).join('');
  const runLine = (pname: string, t: HeaderFooterText): string => `<text:p text:style-name="${pname}">${runText(t.left)}<text:tab/>${runText(t.center)}<text:tab/>${runText(t.right)}</text:p>`;
  const skipFirstAny = (hasHeaderFooter(style.header) && !style.header.firstPage) || (hasHeaderFooter(style.footer) && !style.footer.firstPage);
  const hfBlock = (tag: 'header' | 'footer', hf: HeaderFooter, pname: string): string => {
    if (!hasHeaderFooter(hf)) return '';
    const first = hf.firstPage ? (skipFirstAny ? `<style:${tag}-first>${runLine(pname, hf.odd)}</style:${tag}-first>` : '') : `<style:${tag}-first><text:p text:style-name="${pname}"/></style:${tag}-first>`;
    const left = headerFooterDiffers(hf) ? `<style:${tag}-left>${runLine(pname, hf.even)}</style:${tag}-left>` : '';
    return `<style:${tag}>${runLine(pname, hf.odd)}</style:${tag}>${left}${first}`;
  };
  const anyHeader = hasHeaderFooter(style.header);
  const anyFooter = hasHeaderFooter(style.footer);
  const edge = style.page.marginCm / 2;
  const boxStyle = (tag: 'header' | 'footer'): string => `<style:${tag}-style><style:header-footer-properties fo:min-height="${cm(edge)}" fo:margin-${tag === 'header' ? 'bottom' : 'top'}="0cm"/></style:${tag}-style>`;
  const pageLayout = `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${cm(w)}" fo:page-height="${cm(h)}" fo:margin-top="${cm(anyHeader ? edge : style.page.marginCm)}" fo:margin-bottom="${cm(anyFooter ? edge : style.page.marginCm)}" fo:margin-left="${cm(style.page.marginCm)}" fo:margin-right="${cm(style.page.marginCm)}"/>${anyHeader ? boxStyle('header') : ''}${anyFooter ? boxStyle('footer') : ''}</style:page-layout>`;
  const masterPage = `<style:master-page style:name="Standard" style:page-layout-name="pm1">${hfBlock('header', style.header, 'RunHeader')}${hfBlock('footer', style.footer, 'RunFooter')}</style:master-page>`;
  const headingStyles = style.headings
    .map((t, i) => par(`H${i + 1}`, 'Body', `fo:margin-top="${pt(t.before)}" fo:margin-bottom="${pt(t.after)}" fo:keep-with-next="always" fo:text-align="start" fo:line-height="${Math.round(t.lineHeight * 100)}%"`, `style:font-name="${esc(t.font)}" fo:font-size="${pt(t.sizePt)}" fo:font-weight="${t.bold ? 'bold' : 'normal'}" fo:font-style="${t.italic ? 'italic' : 'normal'}" fo:color="${t.color}"`))
    .join('');
  const fonts = [...new Set([b.font, style.code.font, ...[...named.values()].flatMap((e) => (e.st.font ? [e.st.font] : [])), ...style.headings.map((t) => t.font)])].map((f) => `<style:font-face style:name="${esc(f)}" svg:font-family="'${esc(f)}'"/>`).join('');

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3"><office:font-face-decls>${fonts}</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/></style:default-style>
${par('Body', null, `fo:margin-top="0cm" fo:margin-bottom="${pt(b.paragraphAfter)}" fo:line-height="${Math.round(b.lineHeight * 100)}%" fo:text-align="${b.justify ? 'justify' : 'start'}"`, `style:font-name="${esc(b.font)}" fo:font-size="${pt(b.sizePt)}" fo:color="${b.color}"`).replace('style:family="paragraph"', 'style:family="paragraph" style:class="text"')}
${[...named.values()].map(({ name, st }) => par(name, 'Body', [
    st.indentCm !== undefined || st.hangingCm !== undefined ? `fo:margin-left="${cm(st.indentCm ?? st.hangingCm ?? 0)}"` : '',
    st.hangingCm ? `fo:text-indent="${cm(-st.hangingCm)}"` : st.firstLineIndentCm !== undefined ? `fo:text-indent="${cm(st.firstLineIndentCm)}"` : '',
    st.align ? `fo:text-align="${st.align === 'left' ? 'start' : st.align === 'right' ? 'end' : st.align}"` : '',
    st.lineHeight ? `fo:line-height="${Math.round(st.lineHeight * 100)}%"` : '',
    st.before !== undefined ? `fo:margin-top="${pt(st.before)}"` : '',
    st.after !== undefined ? `fo:margin-bottom="${pt(st.after)}"` : '',
    st.background ? `fo:background-color="${st.background}"` : '',
  ].filter(Boolean).join(' '), [
    st.font ? `style:font-name="${esc(st.font)}"` : '',
    st.sizePt ? `fo:font-size="${pt(st.sizePt)}"` : '',
    st.color ? `fo:color="${st.color}"` : '',
    st.bold !== undefined ? `fo:font-weight="${st.bold ? 'bold' : 'normal'}"` : '',
    st.italic !== undefined ? `fo:font-style="${st.italic ? 'italic' : 'normal'}"` : '',
  ].filter(Boolean).join(' '))).join('\n')}
${par('BodyIndent', 'Body', `fo:text-indent="${cm(style.body.firstLineIndentCm)}"`)}
${headingStyles}
${par('Code', 'Body', `fo:margin-bottom="0cm" fo:line-height="115%" fo:background-color="${style.code.background}" fo:text-align="start"`, `style:font-name="${esc(style.code.font)}" fo:font-size="${pt(style.code.sizePt)}" fo:color="${style.code.color}"`)}
${Array.from({ length: QUOTE_LEVELS }, (_, k) => par(`Quote${k + 1}`, 'Body', `fo:margin-left="${cm(style.blockquote.indentCm * (k + 1))}" fo:border-left="3pt solid ${style.blockquote.bar}" fo:padding-left="${cm(style.blockquote.indentCm / 2)}"`, `fo:color="${style.blockquote.color}" fo:font-style="${style.blockquote.italic ? 'italic' : 'normal'}"`)).join('\n')}
${par('Footnote', 'Body', 'fo:margin-bottom="2pt" fo:line-height="115%"', `fo:font-size="${pt(style.footnotes.sizePt)}" fo:color="${style.footnotes.color}" fo:font-style="${style.footnotes.italic ? 'italic' : 'normal'}"`)}
${par('ListItem', 'Body', `fo:margin-bottom="${pt(Math.min(b.paragraphAfter, 3))}"`)}
${(['L', 'R', 'C'] as const).flatMap((a) => { const ta = a === 'R' ? 'end' : a === 'C' ? 'center' : 'start'; return [par(`TD${a}`, 'Body', `fo:margin-top="0cm" fo:margin-bottom="0cm" fo:text-align="${ta}"`), par(`TH${a}`, 'Body', `fo:margin-top="0cm" fo:margin-bottom="0cm" fo:text-align="${ta}"`, 'fo:font-weight="bold"')]; }).join('\n')}
${par('Hair', 'Body', 'fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="100%"', 'fo:font-size="1pt"')}
${par('Spacer', 'Body', 'fo:margin-top="0cm" fo:margin-bottom="6pt" fo:line-height="100%"', 'fo:font-size="2pt"')}
${par('ListLast', 'Body', `fo:margin-bottom="${pt(b.paragraphAfter)}"`)}
${anyHeader ? runPar('RunHeader', style.header) : ''}
${anyFooter ? runPar('RunFooter', style.footer) : ''}
${par('Rule', 'Body', 'fo:border-bottom="0.75pt solid #999999" fo:margin-bottom="6pt"')}
<style:style style:name="Footnote_20_Symbol" style:display-name="Footnote Symbol" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<style:style style:name="Footnote_20_anchor" style:display-name="Footnote anchor" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<style:style style:name="Endnote_20_Symbol" style:display-name="Endnote Symbol" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<style:style style:name="Endnote_20_anchor" style:display-name="Endnote anchor" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<text:notes-configuration text:note-class="footnote" text:citation-style-name="Footnote_20_Symbol" text:citation-body-style-name="Footnote_20_anchor" style:num-format="1" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/>
<text:notes-configuration text:note-class="endnote" text:citation-style-name="Endnote_20_Symbol" text:citation-body-style-name="Endnote_20_anchor" style:num-format="1" text:start-value="0"/>
<style:style style:name="Dim" style:family="text"><style:text-properties fo:font-style="italic" fo:color="#777777"/></style:style>
${listStyles.join('')}
</office:styles>
<office:automatic-styles>${pageLayout}</office:automatic-styles>
<office:master-styles>${masterPage}</office:master-styles>
</office:document-styles>`;

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3"><office:font-face-decls>${fonts}</office:font-face-decls>
<office:automatic-styles>${spanDefs.join('')}<style:style style:name="Table" style:family="table"><style:table-properties style:width="${cm(w - 2 * style.page.marginCm)}" table:align="margins"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding-top="0.07cm" fo:padding-bottom="0.07cm" fo:padding-left="0.18cm" fo:padding-right="0.18cm" fo:border="0.5pt solid ${style.table.border}"/></style:style><style:style style:name="CellHead" style:family="table-cell"><style:table-cell-properties fo:padding-top="0.07cm" fo:padding-bottom="0.07cm" fo:padding-left="0.18cm" fo:padding-right="0.18cm" fo:background-color="${style.table.headerBackground}" fo:border="0.5pt solid ${style.table.border}"/></style:style></office:automatic-styles>
<office:body><office:text>${content}</office:text></office:body></office:document-content>`;

  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${esc(opts.title ?? '')}</dc:title><meta:generator>Cave Notes</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;

  const zip = new JSZip();
  // the mimetype file must come first and be stored, not compressed
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifest);
  zip.file('content.xml', contentXml);
  zip.file('styles.xml', styles);
  zip.file('meta.xml', meta);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
