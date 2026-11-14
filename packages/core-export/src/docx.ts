import {
  AlignmentType, BorderStyle, CommentRangeEnd, CommentRangeStart, CommentReference, Document, ExternalHyperlink, Footer, FootnoteReferenceRun, Header, LevelFormat, PageNumber, Packer, Paragraph, ShadingType, Tab, TabStopType, Table, TableCell, TableRow, TextRun, WidthType,
  type ILevelsOptions, type ParagraphChild,
} from 'docx';
import type { Block, Inline, ListKind } from './doc';
import { PAGE_CM, hasHeaderFooter, headerFooterDiffers, hfTokens, resolveNamed, type HeaderFooter, type HeaderFooterText, type NamedStyle, type StyleSet } from './styles';

const twip = (cm: number): number => Math.round((cm / 2.54) * 1440);
const hex = (c: string): string => c.replace('#', '').toUpperCase();
const LEVELS = 9;

/** Word ignores a tab character inside text: tabs become <w:tab/> elements. */
/** a thin empty paragraph: the gap after a table or code block (6pt, with a 2pt line) */
const spacer = (): Paragraph => new Paragraph({ spacing: { after: 120, line: 240 }, run: { size: 4 }, children: [] });
const withTabs = (text: string): Array<string | Tab> => text.split('\t').flatMap((part, k) => (k === 0 ? [part] : [new Tab(), part])).filter((x) => x !== '');

const FORMAT: Record<ListKind, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  decimal: LevelFormat.DECIMAL, alpha: LevelFormat.LOWER_LETTER, ALPHA: LevelFormat.UPPER_LETTER, roman: LevelFormat.LOWER_ROMAN, ROMAN: LevelFormat.UPPER_ROMAN,
};

function numberingFor(kind: ListKind, indent: number): ILevelsOptions[] {
  return Array.from({ length: LEVELS }, (_, level) => ({
    level,
    format: FORMAT[kind],
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: twip(indent * (level + 1)), hanging: twip(indent * 0.9) } } },
  }));
}

export async function renderDocx(blocks: Block[], style: StyleSet, opts: { title?: string } = {}): Promise<Uint8Array> {
  const body = style.body;
  // only the Latin slots are set: East Asian and complex-script text keeps the fonts Word picks for those scripts
  const font = (f: string) => ({ ascii: f, hAnsi: f });
  const bulletLevels: ILevelsOptions[] = Array.from({ length: LEVELS }, (_, level) => ({
    level, format: LevelFormat.BULLET, text: ['\u2022', '\u25E6', '\u25AA'][level % 3]!, alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: twip(style.listIndentCm * (level + 1)), hanging: twip(style.listIndentCm * 0.9) } } },
  }));
  // one numbering definition per list *instance* so each list restarts; references are made as lists are met
  const configs: Array<{ reference: string; levels: ILevelsOptions[] }> = [{ reference: 'bullets', levels: bulletLevels }];
  let counter = 0;

  // a note referred to twice is written twice, as its own numbered note: Word and LibreOffice number notes by reference
  const occurrences: number[] = [];
  // Word comments: the highlighted text (or the point of a lone comment) is the range, and the comment goes in comments.xml
  const wordIds = new Map<number, number>(); // annotation number -> Word's comment id
  const commentTexts: string[] = []; // by Word's comment id
  const wordId = (a: number): number => {
    let w = wordIds.get(a);
    if (w === undefined) {
      w = wordIds.size;
      wordIds.set(a, w);
    }
    return w;
  };
  type Extra = { size?: number; font?: string; color?: string; bold?: boolean; italics?: boolean };
  const runOf = (i: Inline, extra: Extra): ParagraphChild => {
    if (i.note !== undefined) {
      occurrences.push(i.note);
      return style.footnotes.endnotes ? new TextRun({ text: String(occurrences.length), superScript: true }) : new FootnoteReferenceRun(occurrences.length);
    }
    const common = {
      children: withTabs(i.text),
      style: i.code ? 'VerbatimChar' : undefined,
      bold: i.bold || extra.bold,
      italics: i.italic || extra.italics,
      strike: i.strike,
      break: i.br ? 1 : undefined,
      size: extra.size,
      font: i.code ? font(style.code.font) : extra.font ? font(extra.font) : undefined,
      color: i.link ? hex(style.link.color) : extra.color,
      underline: i.link && style.link.underline ? {} : undefined,
      shading: i.code ? { type: ShadingType.CLEAR, fill: hex(style.code.background), color: 'auto' } : undefined,
      highlight: i.hl !== undefined ? ('yellow' as const) : undefined,
    };
    const run = new TextRun(common);
    return i.link && /^(https?:|mailto:)/i.test(i.link) ? new ExternalHyperlink({ link: i.link, children: [run] }) : run;
  };
  const runs = (items: Inline[], extra: Extra = {}): ParagraphChild[] => {
    const withComment = new Set(items.filter((x) => x.cmt).map((x) => x.cmt!.id));
    const started = new Set<number>();
    return items.flatMap((i): ParagraphChild[] => {
      if (i.cmt) {
        const w = wordId(i.cmt.id);
        commentTexts[w] = i.cmt.text;
        return [...(started.has(i.cmt.id) ? [] : [new CommentRangeStart(w)]), new CommentRangeEnd(w), new TextRun({ children: [new CommentReference(w)] })];
      }
      if (i.hl !== undefined && withComment.has(i.hl) && !started.has(i.hl)) {
        started.add(i.hl);
        return [new CommentRangeStart(wordId(i.hl)), runOf(i, extra)];
      }
      return [runOf(i, extra)];
    });
  };

  const spacing = (after = body.paragraphAfter) => ({ after: Math.round(after * 20), line: Math.round(body.lineHeight * 240) });

  /** Whether a paragraph gets the first-line indent: body text only, not a text that carries on after a quote, and (if the style says so) not right after a heading. */
  const indentsFirstLine = (b: Block, before: Block | undefined, ctx: { quote: number; list: unknown; hang?: number }): boolean =>
    body.firstLineIndentCm > 0 && b.t === 'para' && !b.cont && ctx.quote === 0 && !ctx.list && !ctx.hang && (body.indentAfterHeading || before?.t !== 'heading');

  function convert(bs: Block[], ctx: { quote: number; list: { ref: string; level: number } | null; hang?: number; named?: NamedStyle }): Array<Paragraph | Table> {
    const out: Array<Paragraph | Table> = [];
    for (const [bi, b] of bs.entries()) {
      switch (b.t) {
        case 'heading': {
          const h = style.headings[b.level - 1]!;
          out.push(new Paragraph({
            heading: (['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'] as const)[b.level - 1] as never,
            keepNext: true,
            spacing: { before: Math.round(h.before * 20), after: Math.round(h.after * 20), line: Math.round(h.lineHeight * 240) },
            children: runs(b.inlines, { size: Math.round(h.sizePt * 2), font: h.font, color: hex(h.color), bold: h.bold, italics: h.italic }),
          }));
          break;
        }
        case 'para': {
          const nm = ctx.quote === 0 && !ctx.hang ? ctx.named : undefined;
          const align = nm?.align ? { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED }[nm.align] : body.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
          const hangs = nm && (nm.indentCm !== undefined || nm.hangingCm !== undefined || nm.firstLineIndentCm !== undefined);
          const named = nm
            ? { indent: hangs ? { left: twip(nm.indentCm ?? nm.hangingCm ?? 0), ...(nm.hangingCm ? { hanging: twip(nm.hangingCm) } : nm.firstLineIndentCm ? { firstLine: twip(nm.firstLineIndentCm) } : {}) } : undefined, shading: nm.background ? { type: ShadingType.CLEAR, fill: hex(nm.background), color: 'auto' } : undefined }
            : null;
          out.push(new Paragraph({
            alignment: align,
            spacing: { ...spacing(nm?.after ?? body.paragraphAfter), ...(nm?.before !== undefined ? { before: Math.round(nm.before * 20) } : {}), ...(nm?.lineHeight ? { line: Math.round(nm.lineHeight * 240) } : {}) },
            indent: ctx.quote > 0 || ctx.hang ? { left: twip(style.blockquote.indentCm * ctx.quote + style.listIndentCm * (ctx.hang ?? 0)) } : named?.indent ?? (!ctx.named && indentsFirstLine(b, bs[bi - 1], ctx) ? { firstLine: twip(body.firstLineIndentCm) } : undefined),
            shading: named?.shading as never,
            border: ctx.quote > 0 ? { left: { style: BorderStyle.SINGLE, size: 18, space: 8, color: hex(style.blockquote.bar) } } : undefined,
            children: runs(b.inlines, ctx.quote > 0 ? { color: hex(style.blockquote.color), italics: style.blockquote.italic } : nm ? { ...(nm.font ? { font: nm.font } : {}), ...(nm.sizePt ? { size: Math.round(nm.sizePt * 2) } : {}), ...(nm.color ? { color: hex(nm.color) } : {}), ...(nm.bold !== undefined ? { bold: nm.bold } : {}), ...(nm.italic !== undefined ? { italics: nm.italic } : {}) } : {}),
          }));
          break;
        }
        case 'div': out.push(...convert(b.blocks, { ...ctx, named: { ...ctx.named, ...resolveNamed(style, b.classes) } })); break;
        case 'quote': out.push(...convert(b.blocks, { ...ctx, quote: ctx.quote + 1 })); break;
        case 'code':
          for (const line of b.text.split('\n')) {
            out.push(new Paragraph({
              style: 'SourceCode',
              spacing: { after: 0, line: 260 },
              indent: ctx.quote > 0 || ctx.hang ? { left: twip(style.blockquote.indentCm * ctx.quote + style.listIndentCm * (ctx.hang ?? 0)) } : undefined,
              shading: { type: ShadingType.CLEAR, fill: hex(style.code.background), color: 'auto' },
              children: [new TextRun({ children: line === '' ? [' '] : withTabs(line), font: font(style.code.font), size: Math.round(style.code.sizePt * 2), color: hex(style.code.color) })],
            }));
          }
          out.push(spacer());
          break;
        case 'hr': out.push(new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '999999' } }, children: [] })); break;
        case 'notes': break;
        case 'image': out.push(new Paragraph({ spacing: spacing(), children: [new TextRun({ text: `[${b.alt || 'image'}]`, italics: true, color: '777777' })] })); break;
        case 'list': {
          const level = ctx.list ? ctx.list.level + 1 : 0;
          let ref = 'bullets';
          if (b.ordered) {
            ref = `list${++counter}`;
            const levels = numberingFor(b.kind, style.listIndentCm);
            configs.push({ reference: ref, levels: levels.map((l, i) => (i === level ? { ...l, start: b.start } : l)) });
          }
          b.items.forEach((item, itemIdx) => {
            const lastItem = itemIdx === b.items.length - 1 && !ctx.list;
            // a nested list keeps its own numbering; the item's first paragraph carries the marker
            const [first, ...rest] = item.blocks;
            const box = item.checked === null ? '' : item.checked ? '\u2612 ' : '\u2610 ';
            if (first && first.t === 'para') {
              out.push(new Paragraph({
                spacing: spacing(lastItem && item.blocks.length === 1 ? body.paragraphAfter : Math.min(body.paragraphAfter, 3)),
                alignment: body.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
                numbering: { reference: ref, level: Math.min(level, LEVELS - 1) },
                children: [...(box ? [new TextRun({ text: box })] : []), ...runs(first.inlines)],
              }));
            } else out.push(new Paragraph({ numbering: { reference: ref, level: Math.min(level, LEVELS - 1) }, children: [new TextRun({ text: box })] }), ...(first ? convert([first], { ...ctx, list: ctx.list, hang: level + 1 }) : []));
            // blocks after the first belong to the item: indented to its text, without a marker of their own
            out.push(...convert(rest, { ...ctx, list: { ref, level: Math.min(level, LEVELS - 1) }, hang: level + 1 }));
          });
          break;
        }
        case 'table': {
          const cell = (c: Inline[], head: boolean, i: number): TableCell =>
            new TableCell({
              shading: head ? { type: ShadingType.CLEAR, fill: hex(style.table.headerBackground), color: 'auto' } : undefined,
              margins: { top: 40, bottom: 40, left: 100, right: 100 },
              children: [new Paragraph({ alignment: b.align[i] === 'right' ? AlignmentType.RIGHT : b.align[i] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT, children: runs(c, head ? { bold: true } : {}) })],
            });
          const line = { style: BorderStyle.SINGLE, size: 4, color: hex(style.table.border) };
          out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }, rows: [new TableRow({ tableHeader: true, children: b.head.map((c, i) => cell(c, true, i)) }), ...b.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, false, i)) }))] }));
          out.push(spacer());
          break;
        }
      }
    }
    return out;
  }

  const noteBlock = blocks.find((x): x is Extract<Block, { t: 'notes' }> => x.t === 'notes');
  const main = blocks.filter((x) => x.t !== 'notes');
  const fn = style.footnotes;
  const noteParas = (items: Block[], label: string | null): Paragraph[] =>
    items.flatMap((x, idx) =>
      x.t === 'para'
        ? [new Paragraph({ spacing: { after: 40 }, children: [...(idx === 0 ? [new TextRun({ text: label !== null ? `${label} ` : ' ', size: Math.round(fn.sizePt * 2), color: hex(fn.color) })] : []), ...runs(x.inlines, { size: Math.round(fn.sizePt * 2), color: hex(fn.color), italics: fn.italic })] })]
        : (convert([x], { quote: 0, list: null }).filter((c) => c instanceof Paragraph) as Paragraph[]),
    );
  const children = convert(
    style.titleFromPage && opts.title && !(main[0]?.t === 'heading' && main[0].level === 1) ? [{ t: 'heading', level: 1, inlines: [{ text: opts.title }] }, ...main] : main,
    { quote: 0, list: null },
  );
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  if (noteBlock) {
    const seen = [...occurrences];
    if (fn.endnotes) {
      // Word's own endnotes are not offered by the writer: the notes are collected at the end, numbered
      children.push(new Paragraph({ pageBreakBefore: true, heading: 'Heading2' as never, spacing: { after: 120 }, children: [new TextRun({ text: 'Notes' })] }));
      seen.forEach((orig, k) => children.push(...noteParas(noteBlock.items[orig - 1] ?? [], `${k + 1}.`)));
    } else seen.forEach((orig, k) => (footnotes[k + 1] = { children: noteParas(noteBlock.items[orig - 1] ?? [], null) }));
  }
  const [w, h] = PAGE_CM[style.page.size];
  // running headers and footers: left, centre and right text on one line (two tab stops), the numbers as Word fields
  const textWidth = twip(w - 2 * style.page.marginCm);
  const running = (hf: HeaderFooter, t: HeaderFooterText): Paragraph => {
    const piece = (k: ReturnType<typeof hfTokens>[number]): TextRun =>
      new TextRun({ children: k.t === 'text' ? withTabs(k.v) : [k.t === 'page' ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES], size: Math.round(hf.sizePt * 2), color: hex(hf.color), font: font(body.font) });
    const title = opts.title ?? '';
    return new Paragraph({
      spacing: { after: 0 },
      tabStops: [{ type: TabStopType.CENTER, position: Math.round(textWidth / 2) }, { type: TabStopType.RIGHT, position: textWidth }],
      children: [...hfTokens(t.left, title).map(piece), new TextRun({ children: [new Tab()] }), ...hfTokens(t.center, title).map(piece), new TextRun({ children: [new Tab()] }), ...hfTokens(t.right, title).map(piece)],
    });
  };
  const skipFirstAny = (hasHeaderFooter(style.header) && !style.header.firstPage) || (hasHeaderFooter(style.footer) && !style.footer.firstPage);
  const blank = (): Paragraph => new Paragraph({ children: [] });
  const sets = (hf: HeaderFooter, make: (c: Paragraph[]) => Header | Footer): { default?: Header | Footer; even?: Header | Footer; first?: Header | Footer } | undefined => {
    if (!hasHeaderFooter(hf)) return undefined;
    return {
      default: make([running(hf, hf.odd)]),
      ...(headerFooterDiffers(hf) ? { even: make([running(hf, hf.even)]) } : {}),
      // once the first page is set apart (for the header or the footer), it needs its own text in both
      ...(hf.firstPage ? (skipFirstAny ? { first: make([running(hf, hf.odd)]) } : {}) : { first: make([blank()]) }),
    };
  };
  const headers = sets(style.header, (children) => new Header({ children }));
  const footers = sets(style.footer, (children) => new Footer({ children }));
  const differ = (hasHeaderFooter(style.header) && headerFooterDiffers(style.header)) || (hasHeaderFooter(style.footer) && headerFooterDiffers(style.footer));
  const skipFirst = skipFirstAny;
  const doc = new Document({
    evenAndOddHeaderAndFooters: differ,
    title: opts.title,
    creator: 'Cave Notes',
    numbering: { config: configs },
    footnotes,
    ...(commentTexts.length > 0 ? { comments: { children: commentTexts.map((text, id) => ({ id, author: 'Comment', initials: 'C', date: new Date(), children: [new Paragraph({ children: [new TextRun({ text: text ?? '' })] })] })) } } : {}),
    styles: {
      default: { document: { run: { font: font(body.font), size: Math.round(body.sizePt * 2), color: hex(body.color) } } },
      // named styles, so that other programs (and pandoc) can tell code from text
      paragraphStyles: [{ id: 'SourceCode', name: 'Source Code', basedOn: 'Normal', run: { font: font(style.code.font), size: Math.round(style.code.sizePt * 2), color: hex(style.code.color) } }],
      characterStyles: [{ id: 'VerbatimChar', name: 'Verbatim Char', run: { font: font(style.code.font), shading: { type: ShadingType.CLEAR, fill: hex(style.code.background), color: 'auto' } } }],
    },
    sections: [{ properties: { titlePage: skipFirst, page: { size: { width: twip(w), height: twip(h) }, margin: { top: twip(style.page.marginCm), bottom: twip(style.page.marginCm), left: twip(style.page.marginCm), right: twip(style.page.marginCm), header: twip(style.page.marginCm / 2), footer: twip(style.page.marginCm / 2) } } }, ...(headers ? { headers } : {}), ...(footers ? { footers } : {}), children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
