import { namedDecls, namedList } from './named';
import type { Block, Inline, ListKind } from './doc';
import { collectComments } from './critic';
import { pagedCss } from './paginate';
import { PAGE_CM, hasHeaderFooter, hfTokens, type HeaderFooter, type StyleSet } from './styles';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const family = (f: string): string => `'${f.replace(/'/g, '')}', ${/mono|consol|courier/i.test(f) ? 'monospace' : /times|georgia|serif|garamond|palatino/i.test(f) ? 'serif' : 'sans-serif'}`;

const LIST_TYPE: Record<ListKind, string> = { decimal: 'decimal', alpha: 'lower-alpha', ALPHA: 'upper-alpha', roman: 'lower-roman', ROMAN: 'upper-roman' };
export const LIST_ATTR: Record<ListKind, string> = { decimal: '1', alpha: 'a', ALPHA: 'A', roman: 'i', ROMAN: 'I' };

/** The number each CriticMarkup comment is shown by, while a document is turned into HTML (comment id -> 1, 2, 3 …). */
let commentNos = new Map<number, number>();

function inline(items: Inline[]): string {
  return items
    .map((i) => {
      if (i.br) return '<br>';
      if (i.cmt) {
        const n = commentNos.get(i.cmt.id) ?? 0;
        return `<sup class="cm"><a href="#cm${n}" id="cmr${n}" title="${esc(i.cmt.text)}">[${n}]</a></sup>`;
      }
      if (i.note !== undefined && noteRef) return noteRef(i);
      if (i.note !== undefined) return `<sup class="fn"><a href="#fn${i.note}" id="fnr${i.note}">${i.note}</a></sup>`;
      let h = esc(i.text);
      if (i.code) h = `<code>${h}</code>`;
      if (i.strike) h = `<s>${h}</s>`;
      if (i.italic) h = `<em>${h}</em>`;
      if (i.bold) h = `<strong>${h}</strong>`;
      if (i.hl !== undefined) h = `<mark class="hl">${h}</mark>`;
      if (i.link) h = /^(https?:|mailto:)/i.test(i.link) ? `<a href="${esc(i.link)}">${h}</a>` : h;
      return h;
    })
    .join('');
}

/** How an image block gets its address while blocks are turned into HTML (null: show its name). Set by `blocksHtml`. */
let imageSrc: ((url: string) => string | null) | null = null;
/** How a footnote reference is drawn while blocks are turned into HTML (default: a numbered link). */
let noteRef: ((i: Inline) => string) | null = null;

/** Blocks as HTML, for places that lay them out themselves (the slides); `src` turns an image's address into one the page can load. */
export function blocksHtml(blocks: Block[], src?: (url: string) => string | null, note?: (i: Inline) => string): string {
  const before = imageSrc;
  const beforeNote = noteRef;
  commentNos = new Map(collectComments(blocks).map((c) => [c.id, c.n]));
  imageSrc = src ?? null;
  noteRef = note ?? null;
  try {
    return blocks.map((b) => block(b)).join('');
  } finally {
    imageSrc = before;
    noteRef = beforeNote;
  }
}

export const escapeHtml = esc;

function block(b: Block, indent = false): string {
  switch (b.t) {
    case 'heading': return `<h${b.level}>${inline(b.inlines)}</h${b.level}>`;
    case 'para': return `<p${indent ? ' class="ind"' : ''}>${inline(b.inlines)}</p>`;
    case 'div': return `<div class="${b.classes.map((c) => `cn-${c}`).join(' ')}">${b.blocks.map((x) => block(x)).join('')}</div>`;
    case 'quote': return `<blockquote>${b.blocks.map((x) => block(x)).join('')}</blockquote>`;
    case 'code': return `<pre><code>${esc(b.text)}</code></pre>`;
    case 'hr': return '<hr>';
    case 'image': {
      const src = imageSrc?.(b.url);
      return src ? `<img class="slide-img" src="${esc(src)}" alt="${esc(b.alt)}">` : `<p class="img">[${esc(b.alt || 'image')}]</p>`;
    }
    case 'notes': return `<section class="notes"><hr>${b.items.map((n, k) => `<div class="note" id="fn${k + 1}"><span class="note-n">${k + 1}</span> ${n.map((x) => (x.t === 'para' ? inline(x.inlines) : block(x))).join(' ')}</div>`).join('')}</section>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const attrs = b.ordered ? ` type="${LIST_ATTR[b.kind]}"${b.start !== 1 ? ` start="${b.start}"` : ''}` : '';
      const items = b.items
        .map((it) => {
          const box = it.checked === null ? '' : `<span class="box">${it.checked ? '\u2612' : '\u2610'}</span> `;
          const inner = it.blocks.map((x, i) => (x.t === 'para' && it.blocks.length === 1 ? `${i === 0 ? box : ''}${inline(x.inlines)}` : i === 0 && x.t === 'para' ? `${box}${inline(x.inlines)}` : block(x))).join('');
          return `<li${it.checked === null ? '' : ' class="task"'}>${inner}</li>`;
        })
        .join('');
      return `<${tag}${attrs}>${items}</${tag}>`;
    }
    case 'table': {
      const cell = (tag: string, c: Inline[], i: number): string => `<${tag}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ''}>${inline(c)}</${tag}>`;
      return `<table><thead><tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('')}</tbody></table>`;
    }
  }
}

const cssString = (v: string): string => `\"${v.replace(/\\/g, '\\\\').replace(/\"/g, '\\\"')}\"`;

/** A header's text as the value of CSS `content`, with the counters for the numbers. */
function cssContent(text: string, title: string): string {
  const parts = hfTokens(text, title).map((k) => (k.t === 'text' ? cssString(k.v) : k.t === 'page' ? 'counter(page)' : 'counter(pages)'));
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * The running headers and footers as margin boxes of the page (`@page :right` is an odd page, `:left` an even one). Chromium
 * prints them into the PDF; nothing shows them on screen (the preview draws them itself).
 */
export function pageBoxesCss(s: StyleSet, title: string): string {
  if (!hasHeaderFooter(s.header) && !hasHeaderFooter(s.footer)) return '';
  const place = [['left', 'left'], ['center', 'center'], ['right', 'right']] as const;
  const boxes = (side: 'odd' | 'even', where: 'top' | 'bottom', h: HeaderFooter): string =>
    place.map(([k, pos]) => `@${where}-${pos}{content:${cssContent(h[side][k], title)};font-family:${family(s.body.font)};font-size:${h.sizePt}pt;color:${h.color};font-style:normal;font-weight:400;text-align:${pos};vertical-align:middle}`).join('');
  const rule = (sel: string, side: 'odd' | 'even'): string => `@page ${sel}{${boxes(side, 'top', s.header)}${boxes(side, 'bottom', s.footer)}}`;
  const blank = (where: 'top' | 'bottom'): string => place.map(([, pos]) => `@${where}-${pos}{content:none}`).join('');
  const first = (!s.header.firstPage ? blank('top') : '') + (!s.footer.firstPage ? blank('bottom') : '');
  return `\n${rule(':right', 'odd')}\n${rule(':left', 'even')}${first ? `\n@page :first{${first}}` : ''}`;
}

/** The CSS of a style set. `@page` makes the browser's PDF output use the paper and margins. */
export function styleCss(s: StyleSet, title = ''): string {
  const [w, h] = PAGE_CM[s.page.size];
  const hs = s.headings
    .map((t, i) => `h${i + 1}{font-family:${family(t.font)};font-size:${t.sizePt}pt;font-weight:${t.bold ? 700 : 400};font-style:${t.italic ? 'italic' : 'normal'};color:${t.color};margin:${t.before}pt 0 ${t.after}pt;line-height:${t.lineHeight};page-break-after:avoid}`)
    .join('\n');
  return `@page{size:${w}cm ${h}cm;margin:${s.page.marginCm}cm}${pageBoxesCss(s, title)}
html{background:#fff}
body{margin:0;font-family:${family(s.body.font)};font-size:${s.body.sizePt}pt;line-height:${s.body.lineHeight};color:${s.body.color};text-align:${s.body.justify ? 'justify' : 'left'}}
p{margin:0 0 ${s.body.paragraphAfter}pt}
p.ind{text-indent:${s.body.firstLineIndentCm}cm}
${Object.entries(namedList(s)).map(([k, v]) => `.cn-${k}>p{${namedDecls(v)}}`).join('\n')}
${hs}
a{color:${s.link.color};text-decoration:${s.link.underline ? 'underline' : 'none'}}
code{font-family:${family(s.code.font)};font-size:${s.code.sizePt}pt}
pre{margin:0 0 ${s.body.paragraphAfter}pt;padding:6pt 8pt;background:${s.code.background};color:${s.code.color};white-space:pre-wrap;line-height:1.3;page-break-inside:avoid}
pre code{font-size:${s.code.sizePt}pt}
blockquote{margin:0 0 ${s.body.paragraphAfter}pt ${s.blockquote.indentCm / 2}cm;padding-left:${s.blockquote.indentCm / 2}cm;border-left:3pt solid ${s.blockquote.bar};color:${s.blockquote.color};font-style:${s.blockquote.italic ? 'italic' : 'normal'}}
ul,ol{margin:0 0 ${s.body.paragraphAfter}pt 0;padding-left:${s.listIndentCm}cm}
li>ul,li>ol{margin-bottom:0}
li.task{list-style:none;margin-left:-${s.listIndentCm * 0.7}cm}
hr{border:0;border-top:1pt solid #999;margin:10pt 0}
table{border-collapse:collapse;margin:0 0 ${s.body.paragraphAfter}pt;max-width:100%}
th,td{border:.5pt solid ${s.table.border};padding:3pt 6pt;vertical-align:top}
th{background:${s.table.headerBackground}}
.img{color:#777;font-style:italic}
sup.cm{font-size:.75em;line-height:0}sup.cm a{text-decoration:none;color:#8a5a00}mark.hl{background:#fff2a8;color:inherit}\n.comments{margin-top:14pt;font-size:${s.footnotes.sizePt}pt;line-height:1.3}.comments h2{font-size:1em;margin:0 0 4pt 0}.comment{margin:0 0 3pt 0}.comment-n{font-weight:bold;margin-right:4pt}\nsup.fn{font-size:.75em;line-height:0}sup.fn a{text-decoration:none;color:${s.link.color}}
.notes{margin-top:14pt;font-size:${s.footnotes.sizePt}pt;color:${s.footnotes.color};font-style:${s.footnotes.italic ? 'italic' : 'normal'};line-height:1.3}
.notes hr{border:0;border-top:.5pt solid #999;width:30%;margin:0 0 6pt 0}
.note{margin:0 0 3pt 0}.note-n{font-size:.8em;vertical-align:super;line-height:0;margin-right:2pt}${s.footnotes.endnotes ? '\n.notes{page-break-before:always}' : ''}${s.css.trim() ? `\n${s.css.replace(/<\/style/gi, '')}` : ''}`;
}

/** Whether a top-level block is a paragraph that gets the style's first-line indent. */
function indents(b: Block, before: Block | undefined, s: StyleSet): boolean {
  return s.body.firstLineIndentCm > 0 && b.t === 'para' && !b.cont && (s.body.indentAfterHeading || before?.t !== 'heading');
}

/** A complete HTML page for the blocks, in a style set. `paper` adds a sheet-of-paper look for on-screen previews. */
export function renderHtml(blocks: Block[], style: StyleSet, opts: { title?: string; paper?: boolean; /** lay the text out in page-sized columns for `paginate` (the preview and the page count) */ paged?: boolean; /** extra CSS (the @font-face rules of bundled fonts) */ css?: string } = {}): string {
  const title = opts.title ?? '';
  const comments = collectComments(blocks);
  commentNos = new Map(comments.map((c) => [c.id, c.n]));
  // a PDF cannot hold comments of its own, so the comments are numbered where they are and listed at the end
  const commentList = comments.length === 0 ? '' : `<section class="comments"><hr><h2>Comments</h2>${comments.map((c) => `<div class="comment" id="cm${c.n}"><span class="comment-n">[${c.n}]</span>${esc(c.text)}</div>`).join('')}</section>`;
  const head = style.titleFromPage && title && !(blocks[0]?.t === 'heading' && blocks[0].level === 1) ? `<h1>${esc(title)}</h1>` : '';
  const [w] = PAGE_CM[style.page.size];
  const paper = opts.paper
    ? `html{background:#d9d9d9}body{box-sizing:border-box;width:${w}cm;max-width:100%;margin:12px auto;padding:${style.page.marginCm}cm;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3)}`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${opts.css ?? ''}\n${styleCss(style, title)}\n${paper}${opts.paged ? pagedCss(style) : ''}</style></head><body>${opts.paged ? '<div class="cn-flow">' : ''}${head}${blocks.map((b, i) => block(b, indents(b, blocks[i - 1], style))).join('\n')}${commentList}${opts.paged ? '</div>' : ''}</body></html>`;
}
