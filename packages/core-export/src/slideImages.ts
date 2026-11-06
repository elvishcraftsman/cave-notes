/**
 * Pictures on slides: what can be written after a picture in `{…}`, how a picture is sized and cropped, and how the preview
 * rewrites that text. No Markdown parsing and no DOM here, so it is easy to test, and the same numbers can be used for
 * PowerPoint and OpenDocument files later.
 *
 *     ![The map](map.png){.right crop="[10%, 0, 5%, 0]" width=40% fit=tall}
 *     ![](sky.jpg){.background dim=35%}
 *
 * Words: `.left` `.right` (the side), `.portrait` `.landscape` (the shape, if it cannot be told from the file), `.background`
 * (the picture is the background of the slide). Settings: `crop` (left, top, right, bottom), `width`, `height`, `fit`
 * (`tall`: expand to the height of the slide), `dim` (darken a background picture, percent).
 *
 * Lengths are written with a unit: `%`, `px`, `in` or `mm` (no unit: `px`). In a `crop` they are measured on the picture
 * itself (an inch is 96 of its pixels, as on a web page); a `width` or `height` is measured on the slide (a 16:9 slide is
 * 13.33 × 7.5 in), and a percentage there is of the slide's width or height.
 */

export type Unit = '%' | 'px' | 'in' | 'mm';

export interface Len {
  v: number;
  unit: Unit;
}

export interface ImageAttrs {
  side?: 'left' | 'right';
  orient?: 'portrait' | 'landscape';
  background?: boolean;
  /** left, top, right, bottom */
  crop?: [Len, Len, Len, Len];
  width?: Len;
  height?: Len;
  /** `tall`: the picture is as tall as the slide (the other choice is the width the theme gives to pictures) */
  fit?: 'tall';
  /** darken a background picture (0 to 100 percent) */
  dim?: number;
}

const LEN = /^(-?\d+(?:\.\d+)?|-?\.\d+)\s*(%|px|in|mm)?$/i;

export function parseLen(text: string): Len | null {
  const m = LEN.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? { v, unit: (m[2]?.toLowerCase() as Unit | undefined) ?? 'px' } : null;
}

export function formatLen(l: Len): string {
  const n = Math.round(l.v * 100) / 100;
  return n === 0 ? '0' : `${n}${l.unit}`;
}

/** The pieces of the text inside `{…}`: `.words`, bare words, `key=value`, `key="value"`, `key=[a, b]`. */
function tokens(inside: string): { words: string[]; pairs: Array<[string, string]> } {
  const pairs: Array<[string, string]> = [];
  const rest = inside.replace(/([A-Za-z][\w-]*)\s*=\s*("[^"]*"|\[[^\]]*\]|[^\s"\]]+)/g, (_m, k: string, v: string) => {
    pairs.push([k.toLowerCase(), v.replace(/^"|"$/g, '').trim()]);
    return ' ';
  });
  return { words: rest.split(/[\s.]+/).filter(Boolean).map((w) => w.toLowerCase()), pairs };
}

/** Read the inside of the `{…}` that follows a picture. Settings that cannot be read are left out. */
export function parseImageAttrs(inside: string): ImageAttrs {
  const { words, pairs } = tokens(inside);
  const out: ImageAttrs = {};
  if (words.includes('left')) out.side = 'left';
  else if (words.includes('right')) out.side = 'right';
  if (words.includes('portrait')) out.orient = 'portrait';
  else if (words.includes('landscape')) out.orient = 'landscape';
  if (words.includes('background') || words.includes('bg')) out.background = true;
  for (const [k, v] of pairs) {
    if (k === 'crop') {
      const parts = v.replace(/^\[|\]$/g, '').split(/\s*,\s*|\s+/).filter(Boolean);
      const lens = parts.map(parseLen);
      if (parts.length === 4 && lens.every((l): l is Len => !!l)) out.crop = lens as [Len, Len, Len, Len];
    } else if (k === 'width' || k === 'height') {
      const l = parseLen(v);
      if (l && l.v > 0) out[k] = l;
    } else if (k === 'fit') {
      if (/^(tall|height)$/i.test(v)) out.fit = 'tall';
    } else if (k === 'dim') {
      const l = parseLen(v);
      if (l) out.dim = Math.max(0, Math.min(100, l.v));
    }
  }
  return out;
}

/** The text for the inside of `{…}`, or '' when there is nothing to write. */
export function formatImageAttrs(a: ImageAttrs): string {
  const parts: string[] = [];
  if (a.side) parts.push(`.${a.side}`);
  if (a.orient) parts.push(`.${a.orient}`);
  if (a.background) parts.push('.background');
  if (a.crop && a.crop.some((l) => l.v !== 0)) parts.push(`crop="[${a.crop.map(formatLen).join(', ')}]"`);
  if (a.width) parts.push(`width=${formatLen(a.width)}`);
  if (a.height) parts.push(`height=${formatLen(a.height)}`);
  if (a.fit) parts.push('fit=tall');
  if (a.dim !== undefined && a.dim > 0) parts.push(`dim=${Math.round(a.dim)}%`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- numbers

/** A web page's inch. */
const PX_PER_IN = 96;

/** A length in pixels, given the length that 100% stands for (null: a percentage cannot be turned into pixels). */
export function lenPx(l: Len, whole: number | null): number | null {
  switch (l.unit) {
    case 'px': return l.v;
    case 'in': return l.v * PX_PER_IN;
    case 'mm': return (l.v / 25.4) * PX_PER_IN;
    case '%': return whole === null ? null : (l.v / 100) * whole;
  }
}

/** A length in the given unit, from pixels. */
export function pxToLen(px: number, unit: Unit, whole: number | null): Len {
  switch (unit) {
    case 'px': return { v: px, unit };
    case 'in': return { v: px / PX_PER_IN, unit };
    case 'mm': return { v: (px / PX_PER_IN) * 25.4, unit };
    case '%': return { v: whole ? (px / whole) * 100 : 0, unit };
  }
}

export interface Fractions {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const NO_CROP: Fractions = { l: 0, t: 0, r: 0, b: 0 };

/**
 * The part of the picture that is cut off on each side, as fractions of its width and height. Lengths that are not
 * percentages need the picture's size (`natural`); without it they are ignored. Never cuts everything away.
 */
export function cropFractions(crop: ImageAttrs['crop'], natural: { w: number; h: number } | null): Fractions {
  if (!crop) return NO_CROP;
  const f = (len: Len, whole: number | undefined): number => {
    if (len.unit === '%') return len.v / 100;
    if (!whole) return 0;
    return (lenPx(len, null) ?? 0) / whole;
  };
  const clamp = (n: number): number => Math.max(0, Math.min(0.95, Number.isFinite(n) ? n : 0));
  let l = clamp(f(crop[0], natural?.w));
  let t = clamp(f(crop[1], natural?.h));
  let r = clamp(f(crop[2], natural?.w));
  let b = clamp(f(crop[3], natural?.h));
  if (l + r > 0.95) {
    const k = 0.95 / (l + r);
    l *= k;
    r *= k;
  }
  if (t + b > 0.95) {
    const k = 0.95 / (t + b);
    t *= k;
    b *= k;
  }
  return { l, t, r, b };
}

/** Width ÷ height of what is left of a picture after cropping. Unknown size: 3:2 (or 2:3 if it is said to be portrait). */
export function shownAspect(natural: { w: number; h: number } | null, c: Fractions, orient?: 'portrait' | 'landscape'): number {
  const w = natural?.w ?? (orient === 'portrait' ? 2 : 3);
  const h = natural?.h ?? (orient === 'portrait' ? 3 : 2);
  return (w * (1 - c.l - c.r)) / (h * (1 - c.t - c.b));
}

/** Slide size in pixels (a 960 × 540 pt slide is 1280 × 720 px). */
export const slidePx = (wPt: number, hPt: number): { w: number; h: number } => ({ w: (wPt * 4) / 3, h: (hPt * 4) / 3 });

export interface FitResult {
  /** size in percent of the slide */
  w: number;
  h: number;
  /** what the other choice (expand or shrink) would give */
  other: { w: number; h: number };
  mode: 'wide' | 'tall' | 'set';
  /** the button that expands or shrinks does something */
  canToggle: boolean;
}

/**
 * How big a picture is on a slide, in percent of the slide. By default it is scaled to fit in a box `maxWidth` percent of
 * the slide wide and as tall as the slide: a landscape picture takes `maxWidth` of the width, a portrait one is scaled up
 * until it takes that width or the whole height, whichever comes first. `fit=tall` makes it as tall as the slide instead
 * (and never wider than the slide). A `width` or `height` of its own wins over both.
 */
export function fitImage(aspect: number, a: ImageAttrs, slide: { w: number; h: number }, maxWidth: number): FitResult {
  const asp = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.5;
  const toPct = (wpx: number, hpx: number): { w: number; h: number } => ({ w: (wpx / slide.w) * 100, h: (hpx / slide.h) * 100 });
  const wide = ((): { w: number; h: number } => {
    let w = (maxWidth / 100) * slide.w;
    let h = w / asp;
    if (h > slide.h) {
      h = slide.h;
      w = h * asp;
    }
    return toPct(w, h);
  })();
  const tall = ((): { w: number; h: number } => {
    let h = slide.h;
    let w = h * asp;
    if (w > slide.w) {
      w = slide.w;
      h = w / asp;
    }
    return toPct(w, h);
  })();
  if (a.width || a.height) {
    const wpx = a.width ? lenPx(a.width, slide.w) : null;
    const hpx = a.height ? lenPx(a.height, slide.h) : null;
    const w = wpx ?? (hpx as number) * asp;
    const h = hpx ?? w / asp;
    const set = toPct(Math.min(w, slide.w), Math.min(h, slide.h));
    return { ...set, other: wide, mode: 'set', canToggle: false };
  }
  const differs = Math.abs(wide.w - tall.w) > 0.5 || Math.abs(wide.h - tall.h) > 0.5;
  return a.fit === 'tall' ? { ...tall, other: wide, mode: 'tall', canToggle: differs } : { ...wide, other: tall, mode: 'wide', canToggle: differs };
}

/** CSS that shows only the uncropped part of a picture inside a box that has the shape of that part (position: absolute). */
export function cropStyle(c: Fractions): string {
  const kw = 1 - c.l - c.r;
  const kh = 1 - c.t - c.b;
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  return `position:absolute;max-width:none;max-height:none;width:${r(100 / kw)}%;height:${r(100 / kh)}%;left:${r((-c.l / kw) * 100)}%;top:${r((-c.t / kh) * 100)}%`;
}

export const isCropped = (c: Fractions): boolean => c.l > 0 || c.t > 0 || c.r > 0 || c.b > 0;

// ---------------------------------------------------------------- rewriting a picture's settings in the page

export interface ImageRef {
  /** 0-based, in the order the pictures stand in the slide */
  index: number;
  alt: string;
  url: string;
  attrs: ImageAttrs;
  /** where it is in the page text (the whole `![alt](url)` and the `{…}` after it, if any) */
  from: number;
  to: number;
}

const IMAGE = /!\[((?:[^\]\\]|\\.)*)\]\((<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)(\{[^}\n]*\})?/g;
const FENCE = /^ {0,3}(```+|~~~+)/;

/** The pictures written in a stretch of the page's lines (1-based, both included), not those in code. */
export function imagesInLines(markdown: string, fromLine: number, toLine: number): ImageRef[] {
  const text = markdown.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: ImageRef[] = [];
  let at = 0;
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const start = at;
    at += line.length + 1;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      return;
    }
    if (fence !== null || i + 1 < fromLine || i + 1 > toLine) return;
    const masked = line.replace(/(`+)(.+?)\1/g, (s) => ' '.repeat(s.length));
    IMAGE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMAGE.exec(masked)) !== null) {
      const raw = line.slice(m.index, m.index + m[0].length);
      const dest = /^!\[(?:[^\]\\]|\\.)*\]\((<[^>\n]*>|[^)\s]*)/.exec(raw)?.[1] ?? '';
      const tag = m[3] ? m[3].slice(1, -1) : '';
      out.push({
        index: out.length,
        alt: (/^!\[((?:[^\]\\]|\\.)*)\]/.exec(raw)?.[1] ?? '').replace(/\\(.)/g, '$1'),
        url: dest.replace(/^<|>$/g, ''),
        attrs: parseImageAttrs(tag),
        from: start + m.index,
        to: start + m.index + raw.length,
      });
    }
  });
  return out;
}

/** The page with the settings of one picture changed: `null` takes a setting away. Words and settings it does not know are kept. */
export function withImageAttrs(markdown: string, ref: ImageRef, patch: { [K in keyof ImageAttrs]?: ImageAttrs[K] | null }): string {
  const crlf = markdown.includes('\r\n');
  const text = markdown.replace(/\r\n?/g, '\n');
  const whole = text.slice(ref.from, ref.to);
  const m = /^(!\[(?:[^\]\\]|\\.)*\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\))(\{[^}\n]*\})?$/.exec(whole);
  if (!m) return markdown;
  const inside = m[2] ? m[2].slice(1, -1) : '';
  // what the writer put there that we do not read (other classes, ids, settings) stays as it is
  const known = new Set(['left', 'right', 'portrait', 'landscape', 'background', 'bg', 'crop', 'width', 'height', 'fit', 'dim']);
  const kept: string[] = [];
  const { words, pairs } = tokens(inside);
  for (const w of words) if (!known.has(w)) kept.push(`.${w}`);
  for (const [k, v] of pairs) if (!known.has(k)) kept.push(/[\s\]]/.test(v) ? `${k}="${v}"` : `${k}=${v}`);
  const next: ImageAttrs = { ...ref.attrs };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === false) delete (next as Record<string, unknown>)[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  const written = [formatImageAttrs(next), ...kept].filter(Boolean).join(' ');
  const out = text.slice(0, ref.from) + m[1] + (written ? `{${written}}` : '') + text.slice(ref.to);
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}
