import { parseDoc, plainText, type Block } from './doc';
import { PAGE_CM, hasHeaderFooter, hfText, type HeaderFooter, type StyleSet } from './styles';

/**
 * Pages on screen. The text is laid out in one box as tall as the page's text area and as wide as a column of it, with
 * `column-fill: auto`: when a column is full the text goes on in the next one, which is how the browser breaks it into
 * pages when it prints (the same rules: lines are not stranded, headings stay with the text after them, code and tables
 * are kept whole). Each column is one page; `paginate` counts them and, for the preview, shows each as a sheet of paper
 * with its running header and footer.
 */

const PX_PER_CM = 96 / 2.54;
export const cmToPx = (cm: number): number => cm * PX_PER_CM;

/** The size of a page and of its text area, in screen pixels. */
export function pageMetrics(s: StyleSet): { pw: number; ph: number; m: number; w: number; h: number; gap: number } {
  const [wCm, hCm] = PAGE_CM[s.page.size];
  const m = cmToPx(s.page.marginCm);
  const pw = cmToPx(wCm);
  const ph = cmToPx(hCm);
  return { pw, ph, m, w: pw - 2 * m, h: ph - 2 * m, gap: 48 };
}

/** The CSS of the paged view (the text box, the sheets). Added after the style set's own CSS. */
export function pagedCss(s: StyleSet): string {
  const { pw, ph, m, w, h, gap } = pageMetrics(s);
  const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
  return `html{background:#d9d9d9}
body{padding:12px 0 1px}
.cn-flow{box-sizing:content-box;width:${px(w)};height:${px(h)};column-width:${px(w)};column-gap:${px(gap)};column-fill:auto;overflow:visible}
.cn-flow .notes{page-break-before:auto;break-before:column}
.cn-flow .cn-pagebreak{break-after:auto;page-break-after:auto}
.cn-sheet{position:relative;box-sizing:border-box;width:${px(pw)};height:${px(ph)};margin:0 auto 14px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3);overflow:hidden}
.cn-win{position:absolute;left:${px(m)};top:${px(m)};width:${px(w)};height:${px(h)};overflow:hidden}
.cn-hf{position:absolute;left:${px(m)};width:${px(w)};height:${px(m)};display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;font-size:${s.header.sizePt}pt;color:${s.header.color};line-height:1.2;white-space:pre-wrap;text-align:left;text-indent:0}
.cn-hf.bottom{bottom:0;font-size:${s.footer.sizePt}pt;color:${s.footer.color}}
.cn-hf.top{top:0}
.cn-hf>span:nth-child(2){text-align:center}.cn-hf>span:nth-child(3){text-align:right}
.cn-more{margin:0 auto 14px;width:${px(pw)};text-align:center;color:#555;font:13px sans-serif}`;
}

function runningLine(doc: Document, where: 'top' | 'bottom', hf: HeaderFooter, title: string, page: number, pages: number): HTMLElement | null {
  if (!hasHeaderFooter(hf) || (page === 1 && !hf.firstPage)) return null;
  const t = page % 2 === 1 ? hf.odd : hf.even;
  const line = doc.createElement('div');
  line.className = `cn-hf ${where}`;
  for (const k of ['left', 'center', 'right'] as const) {
    const cell = doc.createElement('span');
    cell.textContent = hfText(t[k], title, page, pages);
    line.append(cell);
  }
  return line;
}

/**
 * Count the pages of a document made with `renderHtml(…, { paged: true })` and, unless `sheets` is false, redraw it as one
 * sheet per page. Wait for the fonts first (`document.fonts.ready`), or the count is of the wrong text. Returns the number
 * of pages.
 */
/**
 * A page break (`+++`) is an empty element, and a forced break on an element with no height is not reliably honoured when the
 * browser lays text out in columns. So the break is put on what comes after the marker (the next element, or if the marker
 * ends a block, the next element after that block): that starts a new column, which is a new page. A page break at the very
 * end of the text starts nothing.
 */
export function applyPageBreaks(flow: HTMLElement): void {
  for (const mark of Array.from(flow.querySelectorAll<HTMLElement>('.cn-pagebreak'))) {
    let from: Element | null = mark;
    let next: Element | null = null;
    while (from && from !== flow) {
      next = from.nextElementSibling;
      if (next) break;
      from = from.parentElement;
    }
    // another break right after this one: the page is left empty, as it would be in Word
    while (next && next.classList.contains('cn-pagebreak')) {
      (next as HTMLElement).style.breakBefore = 'column';
      (next as HTMLElement).style.height = '1px';
      next = next.nextElementSibling;
    }
    if (next) (next as HTMLElement).style.breakBefore = 'column';
  }
}

export function paginate(doc: Document, style: StyleSet, title: string, opts: { sheets?: boolean; maxSheets?: number } = {}): number {
  const flow = doc.querySelector<HTMLElement>('.cn-flow');
  if (!flow) return 1;
  applyPageBreaks(flow);
  const { w, gap } = pageMetrics(style);
  const pages = Math.max(1, Math.round((flow.scrollWidth + gap) / (w + gap)));
  if (opts.sheets === false) return pages;
  const shown = Math.min(pages, opts.maxSheets ?? 60);
  const frag = doc.createDocumentFragment();
  for (let k = 0; k < shown; k++) {
    const sheet = doc.createElement('div');
    sheet.className = 'cn-sheet';
    sheet.dataset.page = String(k + 1);
    const win = doc.createElement('div');
    win.className = 'cn-win';
    const copy = flow.cloneNode(true) as HTMLElement;
    copy.style.marginLeft = `${-k * (w + gap)}px`;
    win.append(copy);
    for (const hf of [runningLine(doc, 'top', style.header, title, k + 1, pages), win, runningLine(doc, 'bottom', style.footer, title, k + 1, pages)]) if (hf) sheet.append(hf);
    frag.append(sheet);
  }
  if (pages > shown) {
    const more = doc.createElement('div');
    more.className = 'cn-more';
    more.textContent = `… and ${pages - shown} more pages`;
    frag.append(more);
  }
  flow.replaceWith(frag);
  return pages;
}

/** Collect the text that is counted. Inside a `nocount` block nothing is, except what is in a `count` block in it. */
function textsOf(blocks: Block[], out: string[], skipping = false): void {
  for (const b of blocks) {
    switch (b.t) {
      // a block that says `nocount` (`::: nocount`, or `::: hanging nocount`) is not counted, with everything in it; `count` brings it back
      case 'div': textsOf(b.blocks, out, b.classes.includes('count') ? false : skipping || b.classes.includes('nocount')); break;
      case 'quote': textsOf(b.blocks, out, skipping); break;
      case 'list': for (const it of b.items) textsOf(it.blocks, out, skipping); break;
      // the footnotes are not part of the count, unless they were written inside a `count` block
      case 'notes': b.items.forEach((it, i) => { if (b.counted?.[i]) textsOf(it, out, false); }); break;
      default:
        if (skipping) break;
        if (b.t === 'heading' || b.t === 'para') out.push(plainText(b.inlines));
        else if (b.t === 'code') out.push(b.text);
        else if (b.t === 'table') for (const c of [...b.head, ...b.rows.flat()]) out.push(plainText(c));
        else if (b.t === 'image') out.push(b.alt);
    }
  }
}

/** The words of a page as a word processor counts them: no attributes at the top, no Markdown marks, no footnotes (unless they are in a `count` block), and not what is in a `nocount` block. */
export function countWords(markdown: string): number {
  const texts: string[] = [];
  textsOf(parseDoc(markdown), texts);
  let n = 0;
  for (const t of texts) n += (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;
  return n;
}
