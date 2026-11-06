/**
 * A style set says how an exported page looks: paper, text, headings, code, quotes. Sets are plain data so they can
 * be saved in the preferences, shared as JSON, and drawn by the style editor.
 */

export interface TextStyle {
  font: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: string;
  /** space above and below, in pt */
  before: number;
  after: number;
  /** line spacing of the heading (a multiple of the line: 1.2 is a little open, 1 is tight) */
  lineHeight: number;
}

/** Which unit lengths (margins, indents) are shown and typed in; the values themselves are kept in cm. */
export type Units = 'cm' | 'in';

/**
 * A named paragraph style, used by `::: name` blocks. Everything is optional; lengths are in cm, sizes in pt.
 * `indentCm` is the left margin; `hangingCm` makes the first line stick out to the left by that much.
 */
export interface NamedStyle {
  indentCm?: number;
  hangingCm?: number;
  firstLineIndentCm?: number;
  align?: 'left' | 'right' | 'center' | 'justify';
  font?: string;
  sizePt?: number;
  color?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  lineHeight?: number;
  before?: number;
  after?: number;
}

/** The styles every set has (a set or the workspace can change them or add more). */
export const BUILTIN_NAMED: Record<string, NamedStyle> = {
  hanging: { indentCm: 1.27, hangingCm: 1.27 },
  noindent: { firstLineIndentCm: 0 },
  center: { align: 'center', firstLineIndentCm: 0 },
  right: { align: 'right', firstLineIndentCm: 0 },
};

/** The named styles a block asks for, put together in the order of its classes. */
export function resolveNamed(s: StyleSet, classes: string[]): NamedStyle {
  const out: NamedStyle = {};
  for (const c of classes) Object.assign(out, BUILTIN_NAMED[c] ?? {}, s.styles?.[c] ?? {});
  return out;
}

/** The three places of a header or footer. Text may hold `{page}`, `{pages}` and `{title}`. */
export interface HeaderFooterText {
  left: string;
  center: string;
  right: string;
}

/**
 * A running header or footer. `odd` is for pages 1, 3, 5 … and `even` for pages 2, 4, 6 …; when they are the same, every
 * page looks alike. `firstPage: false` leaves the first page without one (a title page, say).
 */
export interface HeaderFooter {
  odd: HeaderFooterText;
  even: HeaderFooterText;
  firstPage: boolean;
  sizePt: number;
  color: string;
}

export const NO_TEXT: HeaderFooterText = { left: '', center: '', right: '' };
const noHeaderFooter = (): HeaderFooter => ({ odd: { ...NO_TEXT }, even: { ...NO_TEXT }, firstPage: true, sizePt: 9, color: '#666666' });

/** Whether a header or footer shows anything at all. */
export const hasHeaderFooter = (h: HeaderFooter): boolean => [h.odd, h.even].some((t) => t.left !== '' || t.center !== '' || t.right !== '');

/** Whether odd and even pages differ. */
export const headerFooterDiffers = (h: HeaderFooter): boolean => h.odd.left !== h.even.left || h.odd.center !== h.even.center || h.odd.right !== h.even.right;

export type HfToken = { t: 'text'; v: string } | { t: 'page' } | { t: 'pages' };

/** A header's text as pieces: plain text, the page number, the number of pages (`{title}` is filled in at once). */
export function hfTokens(text: string, title: string): HfToken[] {
  const out: HfToken[] = [];
  let rest = text.replace(/\{title\}/gi, title);
  for (let m = /\{(pages?)\}/i.exec(rest); m; m = /\{(pages?)\}/i.exec(rest)) {
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) });
    out.push({ t: m[1]!.toLowerCase() === 'pages' ? 'pages' : 'page' });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== '') out.push({ t: 'text', v: rest });
  return out;
}

/** The text of a header with the numbers filled in. */
export const hfText = (text: string, title: string, page: number, pages: number): string =>
  hfTokens(text, title).map((k) => (k.t === 'text' ? k.v : k.t === 'page' ? String(page) : String(pages))).join('');

export interface StyleSet {
  name: string;
  units: Units;
  page: { size: 'A4' | 'Letter' | 'A5'; marginCm: number };
  body: {
    font: string;
    sizePt: number;
    color: string;
    lineHeight: number;
    justify: boolean;
    paragraphAfter: number;
    /** the first line of a paragraph is indented by this much (0: not indented) */
    firstLineIndentCm: number;
    /** whether the paragraph right after a heading is indented too (many styles leave that one flush left) */
    indentAfterHeading: boolean;
  };
  headings: [TextStyle, TextStyle, TextStyle, TextStyle, TextStyle, TextStyle];
  code: { font: string; sizePt: number; color: string; background: string };
  blockquote: { color: string; italic: boolean; indentCm: number; bar: string };
  table: { headerBackground: string; border: string };
  /** `endnotes`: the notes are collected at the end of the document instead of at the foot of each page (always the case in PDF and HTML) */
  footnotes: { sizePt: number; color: string; italic: boolean; endnotes: boolean };
  link: { color: string; underline: boolean };
  listIndentCm: number;
  /** a page's own title as a heading at the top of the export */
  titleFromPage: boolean;
  /** running text above and below the body of every page (page numbers go here) */
  header: HeaderFooter;
  footer: HeaderFooter;
  /** named paragraph styles for `::: name` blocks, besides the built-in ones (hanging, noindent, center, right) */
  styles: Record<string, NamedStyle>;
  /** extra CSS for HTML and PDF output (and the preview); Word and OpenDocument files cannot use it */
  css: string;
}

const heading = (font: string, sizePt: number, color: string, before = 14, after = 6, bold = true, italic = false): TextStyle => ({ font, sizePt, bold, italic, color, before, after, lineHeight: 1.2 });

export const BUILTIN_STYLES: StyleSet[] = [
  {
    name: 'Clean',
    units: 'cm',
    page: { size: 'A4', marginCm: 2.5 },
    body: { font: 'Calibri', sizePt: 11, color: '#1a1a1a', lineHeight: 1.4, justify: false, paragraphAfter: 8, firstLineIndentCm: 0, indentAfterHeading: true },
    headings: [heading('Calibri', 24, '#111111', 0, 10), heading('Calibri', 18, '#111111'), heading('Calibri', 14, '#222222'), heading('Calibri', 12, '#222222'), heading('Calibri', 11, '#333333'), heading('Calibri', 11, '#555555', 14, 6, false, true)],
    code: { font: 'Consolas', sizePt: 10, color: '#222222', background: '#f2f2f2' },
    blockquote: { color: '#555555', italic: true, indentCm: 0.8, bar: '#bbbbbb' },
    table: { headerBackground: '#f0f0f0', border: '#999999' },
    footnotes: { sizePt: 9, color: '#333333', italic: false, endnotes: false },
    link: { color: '#1a5fb4', underline: true },
    listIndentCm: 0.9,
    titleFromPage: false,
    header: noHeaderFooter(),
    footer: noHeaderFooter(),
    styles: {},
    css: '',
  },
  {
    name: 'Manuscript',
    units: 'in',
    page: { size: 'Letter', marginCm: 2.54 },
    body: { font: 'Times New Roman', sizePt: 12, color: '#000000', lineHeight: 2, justify: false, paragraphAfter: 0, firstLineIndentCm: 0, indentAfterHeading: true },
    headings: [heading('Times New Roman', 16, '#000000', 0, 12), heading('Times New Roman', 14, '#000000', 12, 6), heading('Times New Roman', 12, '#000000', 12, 6), heading('Times New Roman', 12, '#000000', 12, 6, true, true), heading('Times New Roman', 12, '#000000', 12, 6, false), heading('Times New Roman', 12, '#000000', 12, 6, false, true)],
    code: { font: 'Courier New', sizePt: 11, color: '#000000', background: '#ffffff' },
    blockquote: { color: '#000000', italic: false, indentCm: 1.27, bar: '#ffffff' },
    table: { headerBackground: '#ffffff', border: '#000000' },
    footnotes: { sizePt: 10, color: '#000000', italic: false, endnotes: true },
    link: { color: '#000000', underline: true },
    listIndentCm: 1.27,
    titleFromPage: false,
    header: noHeaderFooter(),
    footer: noHeaderFooter(),
    styles: {},
    css: '',
  },
  {
    name: 'Report',
    units: 'cm',
    page: { size: 'A4', marginCm: 2.2 },
    body: { font: 'Georgia', sizePt: 10.5, color: '#202020', lineHeight: 1.5, justify: true, paragraphAfter: 6, firstLineIndentCm: 0, indentAfterHeading: true },
    headings: [heading('Arial', 22, '#7a1f1f', 0, 12), heading('Arial', 16, '#7a1f1f', 16, 6), heading('Arial', 13, '#333333', 12, 4), heading('Arial', 11, '#333333', 10, 4), heading('Arial', 10.5, '#555555', 10, 4), heading('Arial', 10.5, '#555555', 10, 4, false, true)],
    code: { font: 'DejaVu Sans Mono', sizePt: 9, color: '#222222', background: '#eeeeee' },
    blockquote: { color: '#444444', italic: true, indentCm: 1, bar: '#7a1f1f' },
    table: { headerBackground: '#eeeeee', border: '#999999' },
    footnotes: { sizePt: 8.5, color: '#333333', italic: false, endnotes: false },
    link: { color: '#7a1f1f', underline: false },
    listIndentCm: 0.8,
    titleFromPage: true,
    header: noHeaderFooter(),
    footer: noHeaderFooter(),
    styles: {},
    css: '',
  },
];

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() !== '' && v.length < 80 && !/[<>{};"\\]/.test(v) ? v.trim() : d);
const hex = (v: unknown, d: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

const NAME_OK = /^[A-Za-z][\w-]{0,39}$/;
const opt = <T>(v: unknown, f: (x: unknown) => T | undefined): T | undefined => (v === undefined || v === null ? undefined : f(v));

/** Check named styles (lengths already in cm). Anything wrong is left out. */
export function cleanNamedStyles(raw: unknown): Record<string, NamedStyle> {
  const out: Record<string, NamedStyle> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!NAME_OK.test(name) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const n = (x: unknown, lo: number, hi: number): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined);
    const st: NamedStyle = {};
    const put = <K extends keyof NamedStyle>(k: K, val: NamedStyle[K] | undefined): void => {
      if (val !== undefined) st[k] = val;
    };
    put('indentCm', n(r.indentCm, 0, 15));
    put('hangingCm', n(r.hangingCm, 0, 15));
    put('firstLineIndentCm', n(r.firstLineIndentCm, 0, 15));
    put('align', opt(r.align, (x) => (x === 'left' || x === 'right' || x === 'center' || x === 'justify' ? x : undefined)));
    put('font', opt(r.font, (x) => (str(x, '') || undefined)));
    put('sizePt', n(r.sizePt, 5, 72));
    put('color', opt(r.color, (x) => (typeof x === 'string' && HEX.test(x) ? x.toLowerCase() : undefined)));
    put('background', opt(r.background, (x) => (typeof x === 'string' && HEX.test(x) ? x.toLowerCase() : undefined)));
    put('bold', opt(r.bold, (x) => (typeof x === 'boolean' ? x : undefined)));
    put('italic', opt(r.italic, (x) => (typeof x === 'boolean' ? x : undefined)));
    put('lineHeight', n(r.lineHeight, 0.8, 4));
    put('before', n(r.before, 0, 96));
    put('after', n(r.after, 0, 96));
    out[name] = st;
  }
  return out;
}

const text = (v: unknown, d: string): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) : d);

function cleanHeaderFooter(raw: unknown, base: HeaderFooter): HeaderFooter {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const part = (v: unknown, b: HeaderFooterText): HeaderFooterText => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { left: text(o.left, b.left), center: text(o.center, b.center), right: text(o.right, b.right) };
  };
  return { odd: part(r.odd, base.odd), even: part(r.even, base.even), firstPage: bool(r.firstPage, base.firstPage), sizePt: num(r.sizePt, 5, 24, base.sizePt), color: hex(r.color, base.color) };
}

/** Check a style set from outside (a settings file, the editor): anything wrong falls back to the base set's value. */
export function cleanStyleSet(raw: unknown, base: StyleSet = BUILTIN_STYLES[0]!): StyleSet {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const page = r.page ?? {};
  const body = r.body ?? {};
  const code = r.code ?? {};
  const quote = r.blockquote ?? r.quote ?? {};
  const table = r.table ?? {};
  const notes = r.footnotes ?? {};
  const link = r.link ?? {};
  const hs: unknown[] = Array.isArray(r.headings) ? r.headings : [];
  const headings = base.headings.map((b, i) => {
    const h = (hs[i] && typeof hs[i] === 'object' ? hs[i] : {}) as Record<string, unknown>;
    return { font: str(h.font, b.font), sizePt: num(h.sizePt, 6, 72, b.sizePt), bold: bool(h.bold, b.bold), italic: bool(h.italic, b.italic), color: hex(h.color, b.color), before: num(h.before, 0, 72, b.before), after: num(h.after, 0, 72, b.after), lineHeight: num(h.lineHeight, 0.8, 3, b.lineHeight ?? 1.2) };
  }) as StyleSet['headings'];
  return {
    name: str(r.name, base.name),
    units: r.units === 'in' || r.units === 'cm' ? r.units : base.units,
    page: { size: page.size === 'Letter' || page.size === 'A5' || page.size === 'A4' ? page.size : base.page.size, marginCm: num(page.marginCm, 0.5, 6, base.page.marginCm) },
    body: { font: str(body.font, base.body.font), sizePt: num(body.sizePt, 6, 36, base.body.sizePt), color: hex(body.color, base.body.color), lineHeight: num(body.lineHeight, 1, 3, base.body.lineHeight), justify: bool(body.justify, base.body.justify), paragraphAfter: num(body.paragraphAfter, 0, 48, base.body.paragraphAfter), firstLineIndentCm: num(body.firstLineIndentCm, 0, 5, base.body.firstLineIndentCm), indentAfterHeading: bool(body.indentAfterHeading, base.body.indentAfterHeading) },
    headings,
    code: { font: str(code.font, base.code.font), sizePt: num(code.sizePt, 6, 36, base.code.sizePt), color: hex(code.color, base.code.color), background: hex(code.background, base.code.background) },
    blockquote: { color: hex(quote.color, base.blockquote.color), italic: bool(quote.italic, base.blockquote.italic), indentCm: num(quote.indentCm, 0, 4, base.blockquote.indentCm), bar: hex(quote.bar, base.blockquote.bar) },
    table: { headerBackground: hex(table.headerBackground, base.table.headerBackground), border: hex(table.border, base.table.border) },
    footnotes: { sizePt: num(notes.sizePt, 5, 24, base.footnotes.sizePt), color: hex(notes.color, base.footnotes.color), italic: bool(notes.italic, base.footnotes.italic), endnotes: bool(notes.endnotes, base.footnotes.endnotes) },
    link: { color: hex(link.color, base.link.color), underline: bool(link.underline, base.link.underline) },
    listIndentCm: num(r.listIndentCm, 0.3, 3, base.listIndentCm),
    titleFromPage: bool(r.titleFromPage, base.titleFromPage),
    header: cleanHeaderFooter(r.header, base.header ?? noHeaderFooter()),
    footer: cleanHeaderFooter(r.footer, base.footer ?? noHeaderFooter()),
    styles: { ...(base.styles ?? {}), ...cleanNamedStyles(r.styles) },
    css: typeof r.css === 'string' ? r.css.slice(0, 20000) : (base.css ?? ''),
  };
}

/** Page size in cm (width, height). */
export const PAGE_CM: Record<StyleSet['page']['size'], [number, number]> = { A4: [21, 29.7], Letter: [21.59, 27.94], A5: [14.8, 21] };
