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
.cn-pagenotes{position:absolute;left:0;bottom:0;width:100%;margin:0!important;background:#fff;break-before:auto!important;page-break-before:auto!important}
.cn-flow .cn-pagebreak{break-after:auto;page-break-after:auto}
.cn-sheet{position:relative;box-sizing:border-box;width:${px(pw)};height:${px(ph)};margin:0 auto 14px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3);overflow:hidden}
.cn-win{position:absolute;left:${px(m)};top:${px(m)};width:${px(w)};height:${px(h)};overflow:hidden}
.cn-hf{position:absolute;left:${px(m)};width:${px(w)};height:${px(m)};display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;font-size:${s.header.sizePt}pt;color:${s.header.color};line-height:1.2;white-space:pre-wrap;text-align:left;text-indent:0}
.cn-hf.bottom{bottom:0;font-size:${s.footer.sizePt}pt;color:${s.footer.color}}
.cn-hf.top{top:0}
.cn-hf>span:nth-child(2){text-align:center}.cn-hf>span:nth-child(3){text-align:right}
.cn-more{margin:0 auto 14px;width:${px(pw)};text-align:center;color:#555;font:13px sans-serif}`;
}

/**
 * The CSS that turns the sheets of the preview into a printed document: one sheet to a paper page, at the paper's size, with
 * no margin of the printer's own (the sheets bring their margins, headers and footers with them).
 */
export function sheetPrintCss(s: StyleSet): string {
  const { pw, ph } = pageMetrics(s);
  const [wCm, hCm] = PAGE_CM[s.page.size];
  return `@page{size:${wCm}cm ${hCm}cm;margin:0}
html,body{background:#fff!important;margin:0!important;padding:0!important}
.cn-sheet{margin:0!important;box-shadow:none!important;width:${Math.round(pw * 100) / 100}px!important;height:${Math.floor(ph) - 1}px!important;break-after:page;page-break-after:always}
.cn-sheet:last-of-type{break-after:auto;page-break-after:auto}
.cn-more{display:none}`;
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

/**
 * Footnotes at the foot of the page they are referred to on (the style's `placement: footnotes`). The notes are taken out of
 * the text, and the text is cut into pages one page at a time: lines are added to a page for as long as the page's own notes
 * (those of the notes referred to on its lines) still fit under them, so each page keeps exactly the room its notes need. A cut
 * is made by a column break before a block, or inside a paragraph (the paragraph is split in two, never leaving fewer than two
 * lines on either side); a heading is not left at the foot of a page. Returns null when the notes stay at the end (the style
 * asks for endnotes, or there are none).
 */
const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,figure,dd,dt,div,ul,ol';
const ATOM_SEL = 'pre,table,img,svg,video';

interface Frag { node: Text; piece: number; rect: DOMRect; block: HTMLElement | null; ref: number | null }
interface Line { top: number; bottom: number; block: HTMLElement | null; frags: Frag[]; refs: number[]; atom: HTMLElement | null }

function placeFootnotes(doc: Document, flow: HTMLElement, style: StyleSet): { byPage: Map<number, number[]>; notes: Map<number, HTMLElement> } | null {
  const section = flow.querySelector<HTMLElement>(':scope > .notes');
  if (!section || style.footnotes.endnotes) return null;
  const notes = new Map<number, HTMLElement>();
  for (const el of Array.from(section.querySelectorAll<HTMLElement>('.note'))) {
    const n = Number(/^fn(\d+)$/.exec(el.id)?.[1]);
    if (n) notes.set(n, el);
  }
  section.remove();
  if (notes.size === 0) return null;
  const { w, h, gap } = pageMetrics(style);
  const step = w + gap;
  const win = doc.defaultView!;
  const measure = doc.createElement('section');
  measure.className = 'notes cn-pagenotes';
  measure.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;bottom:auto;height:auto;width:${w}px`;
  doc.body.append(measure);
  const heights = new Map<string, number>();
  /** How tall the notes of these footnotes are, with the rule above them. */
  const heightOf = (list: number[]): number => {
    if (list.length === 0) return 0;
    const key = list.join(',');
    let v = heights.get(key);
    if (v === undefined) {
      measure.replaceChildren(doc.createElement('hr'));
      for (const n of list) measure.append(notes.get(n)!.cloneNode(true));
      v = measure.getBoundingClientRect().height;
      heights.set(key, v);
    }
    return v;
  };
  const noteOf = (a: Element | null): number | null => {
    const n = Number(/^#fn(\d+)$/.exec(a?.getAttribute('href') ?? '')?.[1]);
    return n && notes.has(n) ? n : null;
  };
  const nextNode = (n: Node, descend: boolean): Node | null => {
    if (descend && n.firstChild) return n.firstChild;
    let c: Node | null = n;
    while (c && c !== flow) {
      if (c.nextSibling) return c.nextSibling;
      c = c.parentNode;
    }
    return null;
  };
  const range = doc.createRange();
  /** The lines of a page: walk the text from `start` while it lies in the column `k` (all of it when `k` is null). */
  const linesFrom = (start: Node, root: Node, k: number | null): Line[] => {
    const left0 = flow.getBoundingClientRect().left;
    const col = (x: number): number => Math.floor((x - left0 + 1) / step);
    const lines: Line[] = [];
    let cur: Line | null = null;
    const add = (top: number, bottom: number, block: HTMLElement | null, frag: Frag | null, atom: HTMLElement | null): void => {
      const small = Math.min(bottom - top, cur ? cur.bottom - cur.top : Infinity);
      if (cur && !atom && !cur.atom && cur.block === block && Math.min(bottom, cur.bottom) - Math.max(top, cur.top) > 0.4 * small) {
        cur.top = Math.min(cur.top, top);
        cur.bottom = Math.max(cur.bottom, bottom);
        if (frag) { cur.frags.push(frag); if (frag.ref !== null) cur.refs.push(frag.ref); }
      } else {
        cur = { top, bottom, block, frags: frag ? [frag] : [], refs: frag?.ref != null ? [frag.ref] : [], atom };
        lines.push(cur);
      }
    };
    let n: Node | null = start;
    while (n) {
      let descend = true;
      if (n.nodeType === 1) {
        const el = n as HTMLElement;
        if (el.matches(ATOM_SEL)) {
          descend = false;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && (k === null || col(r.left) === k)) {
            const inTable = el.closest('table');
            add(r.top, r.bottom, (el.matches('img,svg,video') ? el.closest(BLOCK_SEL) : inTable ?? el) as HTMLElement | null, null, el);
          } else if (k !== null && col(r.left) > k) return lines;
        }
      } else if (n.nodeType === 3) {
        const t = n as Text;
        const parent = t.parentElement;
        if (parent && t.data.trim() !== '') {
          range.selectNodeContents(t);
          const block = parent.closest<HTMLElement>(BLOCK_SEL);
          const ref = parent.closest('sup.fn') ? noteOf(parent.closest('a')) : null;
          const rects = Array.from(range.getClientRects());
          for (let j = 0; j < rects.length; j++) {
            const r = rects[j]!;
            if (r.width <= 0) continue;
            if (k !== null) {
              const c = col(r.left);
              if (c > k) return lines;
              if (c < k) continue;
            }
            add(r.top, r.bottom, block, { node: t, piece: j, rect: r, block, ref }, null);
          }
        }
      }
      if (n === root && !descend) break;
      n = nextNode(n, descend);
    }
    return lines;
  };
  /** The character offset where line piece `piece` of a text node starts. */
  const offsetOf = (t: Text, piece: number): number => {
    if (piece === 0) return 0;
    range.selectNodeContents(t);
    const rects = Array.from(range.getClientRects());
    const want = rects[piece]!.top - 1;
    const topAt = (o: number): number => {
      for (let i = o; i < t.length; i++) {
        range.setStart(t, i);
        range.setEnd(t, i + 1);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) return r.top;
      }
      return Infinity;
    };
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topAt(mid) >= want) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const firstText = (el: Node): Node => {
    const wk = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    return wk.nextNode() ?? el;
  };
  /** Start a new page before `line`; returns where the next page's lines begin. */
  const cutBefore = (line: Line): Node => {
    const block = line.block;
    const top = (el: HTMLElement): Node => {
      el.style.breakBefore = 'column';
      return el.matches(ATOM_SEL) ? el : firstText(el);
    };
    if (!block) return line.atom ?? flow;
    if (line.atom || !block.matches('p,li')) return top(block);
    const all = linesFrom(firstText(block), block, null).filter((l) => l.block === block && !l.atom);
    let idx = all.findIndex((l) => l.frags[0]?.node === line.frags[0]?.node && l.frags[0]?.piece === line.frags[0]?.piece);
    if (idx < 0) return top(block);
    if (all.length - idx < 2) idx = all.length - 2; // not one line alone on the next page
    if (idx < 2) return top(block); // not one line alone at the foot of this one
    const f = all[idx]!.frags[0]!;
    const r = doc.createRange();
    r.setStart(f.node, offsetOf(f.node, f.piece));
    r.setEnd(block, block.childNodes.length);
    const rest = block.cloneNode(false) as HTMLElement;
    rest.removeAttribute('id');
    rest.append(r.extractContents());
    block.after(rest);
    if (win.getComputedStyle(block).textAlign === 'justify') block.style.setProperty('text-align-last', 'justify');
    rest.style.breakBefore = 'column';
    rest.style.textIndent = '0';
    if (rest.tagName === 'LI') rest.style.listStyle = 'none';
    return firstText(rest);
  };
  let start: Node = flow;
  for (let k = 0; k < 3000; k++) {
    const lines = linesFrom(start, flow, k);
    if (lines.length === 0) break;
    const colTop = flow.getBoundingClientRect().top;
    const refs: number[] = [];
    let cut = -1;
    for (let i = 0; i < lines.length; i++) {
      const next = [...refs];
      for (const n of lines[i]!.refs) if (!next.includes(n)) next.push(n);
      const used = lines[i]!.bottom - colTop + (next.length > 0 ? heightOf(next) + 2 : 0);
      if (i > 0 && used > h) {
        cut = i;
        break;
      }
      refs.splice(0, refs.length, ...next);
    }
    if (cut < 0) {
      // everything of this column fits with its notes: the page ends where the text breaks by itself
      const last = lines[lines.length - 1]!;
      const nx = nextNode(last.atom ?? last.frags[last.frags.length - 1]?.node ?? flow, false);
      // the column holds all the text up to its end; the next column starts with what follows
      const following = linesFrom(nx ?? flow, flow, k + 1);
      if (!nx || following.length === 0) break;
      start = following[0]!.atom ?? following[0]!.frags[0]?.node ?? flow;
      continue;
    }
    // a heading is not left alone at the foot of a page
    let at = cut;
    while (at > 1 && /^H[1-6]$/.test(lines[at - 1]!.block?.tagName ?? '')) at--;
    while (at > 1 && lines[at - 1]!.block === lines[at]!.block && /^H[1-6]$/.test(lines[at]!.block?.tagName ?? '')) at--;
    start = cutBefore(lines[at]!);
  }
  measure.remove();
  const by = new Map<number, number[]>();
  const left = flow.getBoundingClientRect().left;
  for (const a of Array.from(flow.querySelectorAll<HTMLElement>('sup.fn a'))) {
    const n = noteOf(a);
    if (n === null) continue;
    const page = Math.max(0, Math.floor((a.getBoundingClientRect().left - left) / step));
    const list = by.get(page) ?? [];
    if (!list.includes(n)) list.push(n);
    by.set(page, list);
  }
  return { byPage: by, notes };
}

export function paginate(doc: Document, style: StyleSet, title: string, opts: { sheets?: boolean; maxSheets?: number } = {}): number {
  const flow = doc.querySelector<HTMLElement>('.cn-flow');
  if (!flow) return 1;
  applyPageBreaks(flow);
  const foot = placeFootnotes(doc, flow, style);
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
    const here = foot?.byPage.get(k);
    if (foot && here && here.length > 0) {
      const box = doc.createElement('section');
      box.className = 'notes cn-pagenotes';
      box.append(doc.createElement('hr'));
      for (const n of here) box.append(foot.notes.get(n)!.cloneNode(true));
      win.append(box);
    }
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
