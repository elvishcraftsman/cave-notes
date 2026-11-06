import { type Block, type Inline } from './doc';
import { blocksHtml, escapeHtml as esc } from './html';
import { SLIDE_PT, type Layout, type Region, type SlideTheme, defaultHolds } from './slideThemes';
import { type LayoutRule, type Slide, type SlideBlock, buildSlides, chooseLayout } from './slides';
import { type ImageAttrs, cropFractions, cropStyle, fitImage, isCropped, shownAspect, slidePx } from './slideImages';

export interface RenderOptions {
  title?: string;
  rules?: LayoutRule[];
  /** the address an image link gets in the page (null: not found) */
  imageSrc?: (url: string) => string | null;
  imageSize?: (url: string) => { w: number; h: number } | null;
  /** extra CSS, such as the @font-face of the bundled fonts */
  css?: string;
  /** the slide to show first (0-based) */
  start?: number;
}

export interface PlacedRegion {
  name: string;
  region: Region;
  blocks: SlideBlock[];
}

export interface PlacedSlide {
  slide: Slide;
  layoutName: string;
  /** the layout was not found in the theme and `content` stood in */
  missing: boolean;
  layout: Layout;
  regions: PlacedRegion[];
  /** blocks that no box of the layout takes (e.g. a subtitle on a layout without one) */
  dropped: SlideBlock[];
  /** how the picture beside the text is sized, when the layout has a picture against the slide's edge */
  imageFit?: {
    region: string;
    /** the picture, among the pictures written in the slide (0-based, the background not counted) */
    mode: 'wide' | 'tall' | 'set';
    /** the button that expands the picture to the slide's height, or shrinks it again, has something to do */
    canToggle: boolean;
    /** the box the picture is fitted into, in percent of the slide */
    box: { x: number; y: number; w: number; h: number };
    /** the most it may take of the slide's width, in percent */
    maxWidth: number;
  };
}

const imageAttrsOf = (b: Block): ImageAttrs => (b.t === 'image' ? { ...(b.attrs ?? {}), ...(b.side ? { side: b.side } : {}) } : {});

/** Make room for a picture that sits against the slide's edge, and give it the size its shape and settings ask for. */
function anchorImage(placed: PlacedRegion[], theme: SlideTheme): PlacedSlide['imageFit'] | undefined {
  const target = placed.find((r) => r.region.anchor && r.blocks.length === 1 && r.blocks[0]!.blocks.length === 1 && r.blocks[0]!.blocks[0]!.t === 'image');
  if (!target) return undefined;
  const sb = target.blocks[0]!;
  const im = sb.blocks[0]! as Extract<Block, { t: 'image' }>;
  const attrs = imageAttrsOf(im);
  const natural = sb.natural ?? null;
  const crop = cropFractions(attrs.crop, natural);
  const dims = SLIDE_PT[theme.size];
  const slide = slidePx(dims.w, dims.h);
  const fit = fitImage(shownAspect(natural, crop, attrs.orient), attrs, slide, theme.imageWidth);
  const side = target.region.anchor!;
  const x = side === 'right' ? 100 - fit.w : 0;
  const y = (100 - fit.h) / 2;
  const gap = 3;
  target.region = { ...target.region, at: [x, y, fit.w, fit.h], padding: 0 };
  for (const r of placed) {
    if (r === target) continue;
    const [rx, ry, rw, rh] = r.region.at;
    if (r.name === 'caption' || r.region.holds?.includes('caption')) {
      // under the picture if there is room, else on a band across its foot
      const room = 100 - (y + fit.h);
      const band = room >= rh;
      r.region = { ...r.region, at: band ? [x, y + fit.h, fit.w, rh] : [x, y + fit.h - rh, fit.w, rh], ...(band ? {} : { background: 'rgba(0,0,0,.55)', color: '#ffffff' }) };
      continue;
    }
    if (side === 'right') {
      const limit = x - gap;
      if (rx < limit && rx + rw > limit) r.region = { ...r.region, at: [rx, ry, Math.max(10, limit - rx), rh] };
    } else {
      const start = x + fit.w + gap;
      if (rx < start && rx + rw > start) r.region = { ...r.region, at: [start, ry, Math.max(10, rx + rw - start), rh] };
    }
  }
  return { region: target.name, mode: fit.mode, canToggle: fit.canToggle, box: { x, y, w: fit.w, h: fit.h }, maxWidth: theme.imageWidth };
}

/** Put the blocks of a slide into the boxes of its layout. */
export function placeSlide(slide: Slide, theme: SlideTheme, rules: LayoutRule[] = []): PlacedSlide {
  const wanted = chooseLayout(slide, rules);
  const found = theme.layouts[wanted];
  const layoutName = found ? wanted : theme.layouts.content ? 'content' : Object.keys(theme.layouts)[0]!;
  const layout = theme.layouts[layoutName]!;
  const regions: PlacedRegion[] = Object.entries(layout.regions).map(([name, region]) => ({ name, region, blocks: [] }));
  const holds = (r: PlacedRegion): string[] => r.region.holds ?? defaultHolds(r.name);
  const dropped: SlideBlock[] = [];
  for (const b of slide.blocks) {
    const cands = regions.filter((r) => holds(r).includes(b.kind));
    const target = (b.side ? cands.find((r) => r.region.side === b.side) : undefined) ?? cands.find((r) => !r.region.side) ?? cands[0];
    if (target) target.blocks.push(b);
    else dropped.push(b);
  }
  const imageFit = anchorImage(regions, theme);
  return { slide, layoutName, missing: !found, layout, regions, dropped, ...(imageFit ? { imageFit } : {}) };
}

// ---------------------------------------------------------------- fitting

const inlineLen = (l: Inline[]): number => l.reduce((n, i) => n + i.text.length, 0);

/** A rough count of the lines the blocks take in a box `cpl` characters wide. */
function lineCount(blocks: Block[], cpl: number): number {
  let n = 0;
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
      case 'para': n += Math.max(1, Math.ceil(inlineLen(b.inlines) / cpl)) + 0.4; break;
      case 'list': for (const it of b.items) n += lineCount(it.blocks, Math.max(6, cpl - 3)); break;
      case 'code': n += b.text.split('\n').length; break;
      case 'table': n += b.rows.length + 1; break;
      case 'quote':
      case 'div': n += lineCount(b.blocks, cpl - 2); break;
      case 'image': n += 8; break;
      default: break;
    }
  }
  return n;
}

/** The text size at which the blocks fit a box (a box of `wPt` × `hPt`), from `sizePt` down to at most 40% of it. */
export function fitSize(blocks: Block[], wPt: number, hPt: number, sizePt: number): number {
  for (let f = 1; f >= 0.4; f -= 0.05) {
    const s = sizePt * f;
    if (lineCount(blocks, Math.max(8, wPt / (s * 0.5))) * s * 1.3 <= hPt) return Math.round(s * 10) / 10;
  }
  return Math.round(sizePt * 0.4 * 10) / 10;
}

/** Cells (in percent of the box) for images of the given shapes (width ÷ height), so that together they fill as much of the box as possible. */
export function gridCells(aspects: number[], boxW: number, boxH: number, gap = 1.5): Array<{ x: number; y: number; w: number; h: number }> {
  const n = aspects.length;
  if (!n) return [];
  let best: { score: number; cols: number } = { score: -1, cols: 1 };
  const gx = (gap / 100) * boxW;
  const gy = (gap / 100) * boxH;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (boxW - gx * (cols - 1)) / cols;
    const ch = (boxH - gy * (rows - 1)) / rows;
    let score = 0;
    aspects.forEach((a) => {
      const w = Math.min(cw, ch * a);
      score += w * (w / a);
    });
    if (score > best.score) best = { score, cols };
  }
  const { cols } = best;
  const rows = Math.ceil(n / cols);
  const cw = 100 / cols - (gap * (cols - 1)) / cols;
  const ch = 100 / rows - (gap * (rows - 1)) / rows;
  return aspects.map((_, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const offset = ((cols - inRow) * (cw + gap)) / 2; // a short last row is centred
    return { x: offset + (i % cols) * (cw + gap), y: r * (ch + gap), w: cw, h: ch };
  });
}

// ---------------------------------------------------------------- HTML

const family = (f: string): string => `'${f.replace(/['"]/g, '')}', ${/mono|consol|courier/i.test(f) ? 'monospace' : /times|georgia|serif|garamond|palatino|crimson|libertin/i.test(f) ? 'serif' : 'sans-serif'}`;
const pct = (n: number): string => `${Math.round(n * 100) / 100}%`;

function regionHtml(pr: PlacedRegion, theme: SlideTheme, o: RenderOptions, letters: Record<number, string>, presenter: boolean): string {
  const r = pr.region;
  const dims = SLIDE_PT[theme.size];
  const [x, y, w, h] = r.at;
  const blocks = pr.blocks.flatMap((b) => b.blocks);
  const style: string[] = [`left:${pct(x)}`, `top:${pct(y)}`, `width:${pct(w)}`, `height:${pct(h)}`];
  if (r.font) style.push(`font-family:${family(r.font)}`);
  if (r.color) style.push(`color:${r.color}`);
  if (r.bold !== undefined) style.push(`font-weight:${r.bold ? 700 : 400}`);
  if (r.italic !== undefined) style.push(`font-style:${r.italic ? 'italic' : 'normal'}`);
  if (r.align) style.push(`text-align:${r.align}`);
  if (r.background) style.push(`background:${r.background}`);
  const pad = r.padding ?? 0.8;
  style.push(`padding:${pct(pad)}`);
  const images = blocks.filter((b): b is Extract<Block, { t: 'image' }> => b.t === 'image');
  const onlyImages = blocks.length > 0 && images.length === blocks.length;
  let inner: string;
  if (onlyImages) {
    const natural = (im: Extract<Block, { t: 'image' }>): { w: number; h: number } | null => o.imageSize?.(im.url) ?? null;
    const aspects = images.map((im) => shownAspect(natural(im), cropFractions(im.attrs?.crop, natural(im)), im.orient ?? im.attrs?.orient));
    const cells = gridCells(aspects, (w / 100) * dims.w, (h / 100) * dims.h);
    inner = images
      .map((im, i) => {
        const c = cells[i]!;
        // a width or height written after the picture makes it that size, in the middle of its cell
        const set = im.attrs?.width || im.attrs?.height ? fitImage(aspects[i]!, im.attrs, slidePx(dims.w, dims.h), 100) : null;
        const cw = set ? Math.min(100, (set.w / w) * 100) : 100;
        const ch = set ? Math.min(100, (set.h / h) * 100) : 100;
        const cell = set ? { x: c.x + (c.w - (c.w * cw) / 100) / 2, y: c.y + (c.h - (c.h * ch) / 100) / 2, w: (c.w * cw) / 100, h: (c.h * ch) / 100 } : c;
        const src = o.imageSrc?.(im.url);
        const box = `left:${pct(cell.x)};top:${pct(cell.y)};width:${pct(cell.w)};height:${pct(cell.h)}`;
        if (!src) return `<div class="cell missing" style="${box}">${esc(im.alt || 'image')}</div>`;
        const crop = cropFractions(im.attrs?.crop, natural(im));
        if (isCropped(crop)) return `<div class="cell" style="${box};overflow:hidden"><img style="${cropStyle(crop)}" src="${esc(src)}" alt="${esc(im.alt)}"></div>`;
        return `<img class="cell" style="${box}${set ? ';object-fit:fill' : ''}" src="${esc(src)}" alt="${esc(im.alt)}">`;
      })
      .join('');
    style.push('padding:0');
    return `<div class="r r-${pr.name} images" style="${style.join(';')}${r.css ? `;${r.css}` : ''}">${inner}</div>`;
  }
  const size = r.sizePt ?? theme.sizePt;
  const fitted = r.fit === 'none' ? size : fitSize(blocks, (w / 100) * dims.w * (1 - (pad * 2) / 100), (h / 100) * dims.h * (1 - ((pad * 2 * dims.w) / dims.h) / 100), size);
  style.push(`font-size:${fitted}pt`);
  const v = r.valign ?? 'top';
  style.push(`justify-content:${v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start'}`);
  // a presenter's note leaves a small letter in the text, without taking room (so the lines break as they do on the screen the audience sees)
  const note = (i: { note?: number }): string => {
    const l = presenter && i.note !== undefined ? letters[i.note] : '';
    return l ? `<span class="nref"><sup>${esc(l)}</sup></span>` : '';
  };
  inner = blocksHtml(blocks, o.imageSrc ? (u) => o.imageSrc!(u) : undefined, note);
  return `<div class="r r-${pr.name}" style="${style.join(';')}${r.css ? `;${r.css}` : ''}">${inner}</div>`;
}

export function slideHtml(p: PlacedSlide, theme: SlideTheme, o: RenderOptions, presenter = false): string {
  const bg = p.layout.background ? `background:${p.layout.background};` : '';
  const extra = p.layout.css ? p.layout.css : '';
  const back = p.slide.background ? o.imageSrc?.(p.slide.background.url) : null;
  const dim = p.slide.background?.attrs.dim ?? 0;
  const behind = back ? `<img class="bgimg" src="${esc(back)}" alt="">${dim > 0 ? `<div class="bgdim" style="background:rgba(0,0,0,${Math.round(dim) / 100})"></div>` : ''}` : '';
  return `<section class="slide layout-${p.layoutName}" id="s${p.slide.index + 1}" style="${bg}${extra}">${behind}${p.regions.map((r) => regionHtml(r, theme, o, p.slide.noteLetters, presenter)).join('')}</section>`;
}

/**
 * The stylesheet of a theme. With `scope` (a class selector such as `.deck`), every rule is limited to what is inside that
 * element, so the slides can be shown inside another page without changing it.
 */
export function slideCss(theme: SlideTheme, scope = ''): string {
  const { w, h } = SLIDE_PT[theme.size];
  const q = scope ? `${scope} ` : '';
  const rules = `
${q}* { box-sizing: border-box }
${q}.slide { --lh: 1.25; --para: 1.875em; --item: 0.4em; position: relative; width: ${w}pt; height: ${h}pt; overflow: hidden; background: ${theme.background}; color: ${theme.color}; font-family: ${family(theme.font)}; font-size: ${theme.sizePt}pt; line-height: var(--lh) }
${q}.r { position: absolute; display: flex; flex-direction: column; overflow: hidden }
${q}.r.images { display: block }
${q}.r h1, ${q}.r h2, ${q}.r h3, ${q}.r h4, ${q}.r h5, ${q}.r h6 { margin: 0; font: inherit; line-height: 1.15 }
${q}.r p { margin: 0 0 var(--para) }
${q}.r ul, ${q}.r ol { margin: 0 0 var(--para); padding-left: 1.3em }
${q}.r li { margin: 0 0 var(--item) }
${q}.r li > ul, ${q}.r li > ol { margin: var(--item) 0 0 }
${q}.r li:last-child { margin-bottom: 0 }
${q}.r li > p { margin: 0 }
${q}.nref { display: inline-block; width: 0; position: relative; overflow: visible }
${q}.nref sup { position: absolute; left: 0.05em; top: -0.75em; font-size: 0.45em; font-weight: 700; color: #c64600; white-space: nowrap }
${q}.r pre { margin: 0; font-size: 0.8em; white-space: pre-wrap }
${q}.r blockquote { margin: 0 0 var(--para); padding-left: 0.8em; border-left: 0.2em solid ${theme.accent}; font-style: italic }
${q}.r table { border-collapse: collapse; font-size: 0.85em }
${q}.r td, ${q}.r th { border: 1px solid ${theme.accent}55; padding: 0.15em 0.5em }
${q}.r a { color: ${theme.accent} }
${q}.r img.slide-img { max-width: 100%; max-height: 60%; object-fit: contain }
${q}.r.images .cell { position: absolute; object-fit: contain }
${q}.bgimg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover }
${q}.bgdim { position: absolute; left: 0; top: 0; width: 100%; height: 100% }
${q}.r.images .cell.missing { display: grid; place-items: center; border: 1px dashed currentColor; opacity: 0.5; font-size: 14pt }`;
  const own = scope ? `${scope} { ${theme.css} }` : theme.css;
  if (scope) return `${rules}\n${own}`;
  return `@page { size: ${w}pt ${h}pt; margin: 0 }
html, body { margin: 0; height: 100%; background: #111 }
.stage { position: absolute; left: 50%; top: 50%; width: ${w}pt; height: ${h}pt; transform-origin: center center }${rules}
${own}`;
}

const DECK_JS = `
(function () {
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var stage = document.querySelector('.stage');
  var W = parseFloat(stage.style.width), H = parseFloat(stage.style.height);
  var cur = Math.max(0, Math.min(slides.length - 1, +(location.hash.slice(1) || __START__ + 1) - 1 || 0));
  function fit() {
    var s = Math.min(innerWidth / (W * 4 / 3), innerHeight / (H * 4 / 3));
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  function show(i, quiet) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (el, k) { el.style.display = k === cur ? 'block' : 'none'; });
    if (!quiet) {
      if (parent !== window) parent.postMessage({ cnSlide: cur }, '*');
      console.log('CN:' + JSON.stringify({ go: cur }));
    }
  }
  window.cnGo = function (n) { show(n, true); };
  addEventListener('resize', fit);
  addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') show(cur + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') show(cur - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else if (k === 'Escape') { if (parent !== window) parent.postMessage({ cnExit: true }, '*'); console.log('CN:' + JSON.stringify({ exit: true })); }
    else return;
    e.preventDefault();
  });
  addEventListener('click', function (e) { show(e.clientX > innerWidth / 3 ? cur + 1 : cur - 1); });
  addEventListener('message', function (e) { if (e.data && typeof e.data.cnGo === 'number') show(e.data.cnGo, true); });
  fit();
  show(cur, true);
})();`;

const PRESENTER_JS = `
(function () {
  var N = SLIDES.length, W = __W__, H = __H__, cur = Math.max(0, Math.min(N - 1, __START__)), t0 = Date.now();
  var elCur = document.getElementById('cur'), elNext = document.getElementById('nxt'), elNotes = document.getElementById('notes'), elMeta = document.getElementById('meta');
  function scaleTo(pane) {
    var inner = pane.firstChild; if (!inner) return;
    var s = Math.min(pane.clientWidth / (W * 4 / 3), pane.clientHeight / (H * 4 / 3));
    inner.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  function put(pane, html) { pane.innerHTML = html ? '<div class="inner" style="width:' + W + 'pt;height:' + H + 'pt">' + html + '</div>' : '<p class="end">End of the presentation</p>'; scaleTo(pane); }
  function show(i, quiet) {
    cur = Math.max(0, Math.min(N - 1, i));
    put(elCur, SLIDES[cur]); put(elNext, cur + 1 < N ? NEXT[cur + 1] : '');
    elNotes.innerHTML = NOTES[cur] || '<p class="none">No notes for this slide.</p>';
    elMeta.firstChild.textContent = 'Slide ' + (cur + 1) + ' of ' + N;
    if (!quiet) console.log('CN:' + JSON.stringify({ go: cur }));
  }
  window.cnGo = function (n) { show(n, true); };
  addEventListener('resize', function () { scaleTo(elCur); scaleTo(elNext); });
  addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') show(cur + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') show(cur - 1);
    else if (k === 'Home') show(0); else if (k === 'End') show(N - 1);
    else if (k === 'Escape') console.log('CN:' + JSON.stringify({ exit: true }));
    else return;
    e.preventDefault();
  });
  setInterval(function () { var s = Math.floor((Date.now() - t0) / 1000); elMeta.lastChild.textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2); }, 1000);
  show(cur, true);
})();`;

/** The presenter's window: the slide being shown, the next one, and the notes of this one; its own clock. */
function presenterHtml(placed: PlacedSlide[], theme: SlideTheme, o: RenderOptions): string {
  const { w, h } = SLIDE_PT[theme.size];
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');
  const notes = placed.map((p) =>
    p.slide.notes.length
      ? `<ol class="letters">${p.slide.notes.map((n) => `<li data-l="${esc(n.letter)}">${blocksHtml(n.blocks)}</li>`).join('')}</ol>`
      : '',
  );
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Presenter: ${esc(o.title ?? 'Presentation')}</title>
<style>${o.css ?? ''}${slideCss(theme, '.deck')}
html, body { margin: 0; height: 100%; background: #1e1e1e; color: #eee; font-family: system-ui, sans-serif }
.grid { display: grid; grid-template-columns: 62fr 38fr; grid-template-rows: 1fr 1fr; gap: 14px; height: 100%; padding: 14px; box-sizing: border-box }
.pane { position: relative; overflow: hidden; background: #000; border-radius: 6px }
#cur { grid-row: 1; grid-column: 1 } #nxt { grid-row: 1; grid-column: 2; align-self: start; aspect-ratio: ${w} / ${h} }
.inner { position: absolute; left: 50%; top: 50%; transform-origin: center center }
#notes { grid-row: 2; grid-column: 1 / 3; overflow: auto; font-size: 22px; line-height: 1.4; padding: 6px 10px }
#notes ol.letters { margin: 0; padding: 0; list-style: none } #notes li { margin: 0 0 12px; padding-left: 1.8em; position: relative }
#notes li::before { content: attr(data-l); position: absolute; left: 0; top: 0.1em; font-size: 0.7em; font-weight: 700; color: #ff9a4d }
#notes li > p { margin: 0 0 6px } #notes .none { opacity: .5 } .end { padding: 20px; opacity: .6 }
#meta { grid-row: 1; grid-column: 2; align-self: end; font-size: 20px; display: flex; justify-content: space-between; opacity: .85 }
</style></head>
<body><div class="grid deck"><div class="pane" id="cur"></div><div class="pane" id="nxt"></div><div id="notes"></div><div id="meta"><span></span><span></span></div></div>
<script>var SLIDES = ${json(placed.map((p) => slideHtml(p, theme, o, true)))}; var NEXT = ${json(placed.map((p) => slideHtml(p, theme, o, false)))}; var NOTES = ${json(notes)};
${PRESENTER_JS.replace('__W__', String(w)).replace('__H__', String(h)).replace('__START__', String(o.start ?? 0))}</script></body></html>`;
}

/** The whole presentation as one HTML page: shown one slide at a time (arrow keys, click), printed one slide to a page. */
export function renderSlidesHtml(markdown: string, theme: SlideTheme, o: RenderOptions = {}): { html: string; presenter: string; placed: PlacedSlide[]; slides: string[] } {
  const slides = buildSlides(markdown, o.imageSize ? { imageSize: o.imageSize } : {});
  const placed = slides.map((s) => placeSlide(s, theme, o.rules ?? []));
  const { w, h } = SLIDE_PT[theme.size];
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(o.title ?? 'Presentation')}</title>
<style>${o.css ?? ''}${slideCss(theme)}
@media print { html, body { background: none; height: auto } .stage { position: static; transform: none !important; width: auto; height: auto } .slide { display: block !important; break-after: page; page-break-after: always } }</style></head>
<body><div class="stage" style="width:${w}pt;height:${h}pt">${placed.map((p) => slideHtml(p, theme, o)).join('')}</div>
<script>${DECK_JS.replace('__START__', String(o.start ?? 0))}</script></body></html>`;
  return { html, presenter: presenterHtml(placed, theme, o), placed, slides: placed.map((p) => slideHtml(p, theme, o)) };
}
