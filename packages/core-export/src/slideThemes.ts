import YAML from 'yaml';
import { SLIDE_KINDS, type SlideKind } from './slides';

/**
 * A slide theme: colours and fonts, and a set of layouts. A layout is a list of named boxes (regions) placed on the slide
 * with plain numbers: `at: [x, y, width, height]`, in percent of the slide. That is all PowerPoint and OpenDocument
 * presentations need too, so a theme made only of regions carries over to those formats. `css` (on a theme, a layout or a
 * region) is for anything more, and is only used by the preview, the PDF and the HTML.
 */

export interface Region {
  /** x, y, width, height in percent of the slide */
  at: [number, number, number, number];
  /** which kinds of block go here; by default what the region's name says (`title`, `subtitle`, `body`, `left`, `right`, `image`, `images`, `caption`) */
  holds?: SlideKind[];
  /** for a block marked `left` or `right`: only that side's blocks go here */
  side?: 'left' | 'right';
  font?: string;
  sizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  background?: string;
  /** space inside the box, in percent of the slide's width */
  padding?: number;
  /** `shrink` (default for text): the text gets smaller to fit the box; `none`: it does not */
  fit?: 'shrink' | 'none';
  /** several images in the box are arranged to fill it as well as they can */
  grid?: boolean;
  /**
   * An image box that sits against the edge of the slide (`left` or `right`) and is as big as its picture: up to the theme's
   * `imageWidth` of the slide's width and the slide's whole height. The other boxes of the layout make room for it.
   */
  anchor?: 'left' | 'right';
  /** extra CSS declarations for this box, such as `border-left: 4px solid red` (not carried over to PowerPoint or OpenDocument) */
  css?: string;
}

export interface Layout {
  background?: string;
  regions: Record<string, Region>;
  /** extra CSS declarations for the whole slide with this layout */
  css?: string;
}

export interface SlideTheme {
  name: string;
  size: '16:9' | '4:3';
  background: string;
  color: string;
  font: string;
  headingFont: string;
  sizePt: number;
  accent: string;
  /** how much of the slide's width a picture beside text may take, in percent (default 55) */
  imageWidth: number;
  layouts: Record<string, Layout>;
  /** extra CSS (a whole stylesheet; the slides are `.slide`, with `.layout-NAME`, and boxes are `.r.r-NAME`) */
  css: string;
}

/** The slide size in points (1/72 in): 16:9 is PowerPoint's 13.333 × 7.5 in. */
export const SLIDE_PT: Record<SlideTheme['size'], { w: number; h: number }> = { '16:9': { w: 960, h: 540 }, '4:3': { w: 720, h: 540 } };

const NAME = /^[A-Za-z][\w-]{0,39}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** What a region holds when it does not say, by its name. */
export function defaultHolds(name: string): SlideKind[] {
  switch (name) {
    case 'title': return ['title'];
    case 'subtitle': return ['subtitle'];
    case 'caption': return ['caption'];
    case 'image': return ['landscape', 'portrait'];
    case 'images': return ['landscape', 'portrait'];
    case 'left':
    case 'right': return ['text', 'text-left', 'text-right', 'landscape', 'portrait', 'caption'];
    default: return ['text', 'text-left', 'text-right'];
  }
}

// ---------------------------------------------------------------- the built-in themes

interface Palette {
  name: string;
  background: string;
  color: string;
  accent: string;
  font: string;
  headingFont: string;
  /** slide-wide CSS, for the background of a theme that is more than a colour */
  css?: string;
}

function region(at: [number, number, number, number], extra: Partial<Region> = {}): Region {
  return { at, ...extra };
}

/**
 * The layouts every built-in theme has, drawn on the 16:9 grid. The margins are 10% of the slide at the sides and the top
 * (16% at the bottom), and the text is large: this is for a room, not for a page.
 */
function standardLayouts(p: Palette): Record<string, Layout> {
  const title = (at: [number, number, number, number] = [10, 10, 80, 14]): Region => region(at, { sizePt: 72, bold: true, color: p.accent, font: p.headingFont, valign: 'middle', fit: 'shrink' });
  const body = (at: [number, number, number, number], extra: Partial<Region> = {}): Region => region(at, { sizePt: 52, valign: 'top', fit: 'shrink', ...extra });
  const caption = (at: [number, number, number, number]): Region => region(at, { sizePt: 32, italic: true, align: 'center', valign: 'top', color: p.color });
  return {
    title: { regions: { title: region([12, 26, 76, 26], { sizePt: 108, bold: true, color: p.accent, font: p.headingFont, valign: 'bottom', fit: 'shrink' }), subtitle: region([12, 54, 76, 18], { sizePt: 56, valign: 'top', fit: 'shrink' }) } },
    section: { regions: { title: region([12, 34, 76, 32], { sizePt: 96, bold: true, color: p.accent, font: p.headingFont, valign: 'middle', fit: 'shrink' }) } },
    content: { regions: { title: title(), subtitle: region([10, 24, 80, 8], { sizePt: 44, fit: 'shrink' }), body: body([10, 34, 80, 50]) } },
    compare: {
      regions: {
        title: title(),
        left: body([10, 28, 38, 56], { side: 'left' }),
        right: body([52, 28, 38, 56], { side: 'right' }),
      },
    },
    'image-right': { regions: { title: title(), body: body([10, 28, 40, 56]), image: region([56, 28, 34, 48], { holds: ['landscape', 'portrait'], valign: 'middle', anchor: 'right' }), caption: caption([56, 78, 34, 8]) } },
    'image-left': { regions: { title: title(), image: region([10, 28, 34, 48], { holds: ['landscape', 'portrait'], valign: 'middle', anchor: 'left' }), caption: caption([10, 78, 34, 8]), body: body([50, 28, 40, 56]) } },
    picture: { regions: { title: title(), image: region([10, 26, 80, 52], { holds: ['landscape', 'portrait'], valign: 'middle' }), caption: caption([10, 80, 80, 6]) } },
    gallery: { regions: { title: title(), images: region([10, 26, 80, 58], { grid: true, holds: ['landscape', 'portrait'] }) } },
  };
}

function builtin(p: Palette): SlideTheme {
  return { name: p.name, size: '16:9', background: p.background, color: p.color, font: p.font, headingFont: p.headingFont, sizePt: 52, accent: p.accent, imageWidth: 55, layouts: standardLayouts(p), css: p.css ?? '' };
}

export const BUILTIN_THEMES: SlideTheme[] = [
  builtin({ name: 'Clean', background: '#ffffff', color: '#222222', accent: '#1c5fa8', font: 'Open Sans', headingFont: 'Open Sans' }),
  builtin({ name: 'Midnight', background: '#1b2230', color: '#e8ecf3', accent: '#7fb4ff', font: 'Open Sans', headingFont: 'Open Sans' }),
  builtin({ name: 'Paper', background: '#faf6ee', color: '#2f2a24', accent: '#8a3b12', font: 'Crimson Pro', headingFont: 'Crimson Pro' }),
  builtin({ name: 'Bold', background: '#fff7e0', color: '#1d1d1d', accent: '#d9480f', font: 'Open Sans', headingFont: 'Open Sans', css: '.slide { border-left: 2.2% solid #d9480f; box-sizing: border-box; }' }),
];

// ---------------------------------------------------------------- reading themes written in YAML

const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
const color = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const text = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
const css = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, 20000).replace(/<\/style/gi, '') : undefined);

function cleanRegion(raw: unknown, base?: Region): Region | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const at = Array.isArray(r.at) && r.at.length === 4 && r.at.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (r.at.map((n) => Math.max(0, Math.min(100, n as number))) as Region['at']) : base?.at;
  if (!at) return null;
  const out: Region = { ...(base ?? {}), at };
  const set = <K extends keyof Region>(k: K, v: Region[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  if (Array.isArray(r.holds)) {
    const holds = r.holds.map(String).flatMap((k) => (k === 'image' ? ['landscape', 'portrait'] : [k])).filter((k): k is SlideKind => (SLIDE_KINDS as string[]).includes(k));
    if (holds.length) out.holds = holds;
  }
  set('side', r.side === 'left' || r.side === 'right' ? r.side : undefined);
  set('font', text(r.font));
  set('sizePt', num(r.size ?? r.sizePt, 6, 200));
  set('color', color(r.color));
  set('bold', typeof r.bold === 'boolean' ? r.bold : undefined);
  set('italic', typeof r.italic === 'boolean' ? r.italic : undefined);
  set('align', r.align === 'left' || r.align === 'center' || r.align === 'right' || r.align === 'justify' ? r.align : undefined);
  set('valign', r.valign === 'top' || r.valign === 'middle' || r.valign === 'bottom' ? r.valign : undefined);
  set('background', color(r.background));
  set('padding', num(r.padding, 0, 20));
  set('fit', r.fit === 'shrink' || r.fit === 'none' ? r.fit : undefined);
  set('anchor', r.anchor === 'left' || r.anchor === 'right' ? r.anchor : undefined);
  set('grid', typeof r.grid === 'boolean' ? r.grid : undefined);
  set('css', css(r.css));
  return out;
}

/** Check a theme written in YAML, on top of `base` (another theme, by `base:` or the Clean theme). Anything wrong is left out. */
export function cleanTheme(name: string, raw: unknown, base: SlideTheme = BUILTIN_THEMES[0]!): SlideTheme {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const layouts: Record<string, Layout> = {};
  for (const [k, l] of Object.entries(base.layouts)) layouts[k] = { ...l, regions: { ...l.regions } };
  if (r.layouts && typeof r.layouts === 'object' && !Array.isArray(r.layouts)) {
    for (const [lname, lraw] of Object.entries(r.layouts as Record<string, unknown>)) {
      if (!NAME.test(lname) || !lraw || typeof lraw !== 'object') continue;
      const lo = lraw as Record<string, unknown>;
      const prev = layouts[lname];
      const regions: Record<string, Region> = { ...(prev?.regions ?? {}) };
      if (lo.regions && typeof lo.regions === 'object' && !Array.isArray(lo.regions)) {
        for (const [rname, rraw] of Object.entries(lo.regions as Record<string, unknown>)) {
          if (!NAME.test(rname)) continue;
          if (rraw === null || rraw === false) {
            delete regions[rname]; // `name: null` takes a region away
            continue;
          }
          const cleaned = cleanRegion(rraw, regions[rname]);
          if (cleaned) regions[rname] = cleaned;
        }
      }
      if (!Object.keys(regions).length) continue;
      layouts[lname] = { ...(prev ?? {}), regions, ...(color(lo.background) ? { background: color(lo.background)! } : {}), ...(css(lo.css) ? { css: css(lo.css)! } : {}) };
    }
  }
  return {
    name,
    size: r.size === '4:3' ? '4:3' : r.size === '16:9' ? '16:9' : base.size,
    background: color(r.background) ?? base.background,
    color: color(r.color) ?? base.color,
    font: text(r.font) ?? base.font,
    headingFont: text(r.headingFont) ?? text(r.font) ?? base.headingFont,
    sizePt: num(r.fontSize ?? r.sizePt, 8, 120) ?? base.sizePt,
    accent: color(r.accent) ?? base.accent,
    imageWidth: num(r.imageWidth, 20, 100) ?? base.imageWidth,
    layouts,
    css: css(r.css) ?? base.css,
  };
}

/** The themes written in the workspace (`presentation-themes:`), after the built-in ones; a theme of the same name replaces one. */
export function themesFromConfig(raw: unknown): SlideTheme[] {
  const all = new Map<string, SlideTheme>(BUILTIN_THEMES.map((t) => [t.name.toLowerCase(), t]));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
      const baseName = v && typeof v === 'object' && typeof (v as { base?: unknown }).base === 'string' ? String((v as { base: string }).base).toLowerCase() : '';
      const t = cleanTheme(name, v, all.get(baseName) ?? all.get(name.toLowerCase()) ?? BUILTIN_THEMES[0]!);
      all.set(name.toLowerCase(), t);
    }
  }
  return [...all.values()];
}

/** A built-in theme as YAML, to start your own from. */
export function themeToYaml(t: SlideTheme): string {
  const layouts = Object.fromEntries(
    Object.entries(t.layouts).map(([k, l]) => [k, { regions: Object.fromEntries(Object.entries(l.regions).map(([n, r]) => [n, { ...r, ...(r.sizePt ? { size: r.sizePt, sizePt: undefined } : {}) }])) }]),
  );
  return YAML.stringify({ [t.name]: { size: t.size, background: t.background, color: t.color, font: t.font, headingFont: t.headingFont, accent: t.accent, imageWidth: t.imageWidth, layouts } });
}

/** What in a theme will not carry over to PowerPoint or OpenDocument presentations later. */
export function themeWarnings(t: SlideTheme): string[] {
  const out: string[] = [];
  if (t.css.trim()) out.push(`Theme “${t.name}” has css: it shows in the preview, PDF and HTML, but not in PowerPoint or OpenDocument files.`);
  for (const [ln, l] of Object.entries(t.layouts)) {
    if (l.css?.trim()) out.push(`Layout “${ln}” has css, which will not carry over to PowerPoint or OpenDocument files.`);
    for (const [rn, r] of Object.entries(l.regions)) if (r.css?.trim()) out.push(`Region “${rn}” of layout “${ln}” has css, which will not carry over to PowerPoint or OpenDocument files.`);
  }
  return out;
}
