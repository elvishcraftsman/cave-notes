import { type Block, parseDoc, slideBreaks } from './doc';
import type { ImageAttrs } from './slideImages';

/**
 * Slides. A page whose front matter has `presentationTheme:` is a presentation: horizontal rules (`---`) on a line of their
 * own separate the slides. Each slide's blocks are sorted into kinds, and the kinds decide the layout.
 */

/** What a block of a slide is. `landscape` and `portrait` are images (by their shape); `text` is anything that is not a heading, image or caption. */
export type SlideKind = 'title' | 'subtitle' | 'text' | 'text-left' | 'text-right' | 'landscape' | 'portrait' | 'caption';

export const SLIDE_KINDS: SlideKind[] = ['title', 'subtitle', 'text', 'text-left', 'text-right', 'landscape', 'portrait', 'caption'];

export interface SlideBlock {
  kind: SlideKind;
  /** from a `left` / `right` block, or `{.left}` after an image */
  side?: 'left' | 'right';
  blocks: Block[];
  /** a picture's pixel size, when the page could measure it */
  natural?: { w: number; h: number };
}

/** The picture that fills the whole slide behind everything (`![](sky.jpg){.background}`). */
export interface SlideBackground {
  url: string;
  alt: string;
  attrs: ImageAttrs;
}

/** A presenter's note: a footnote labelled `note` (`[^note]`, `[^note2]`, …), shown only in the presenter window. */
export interface SlideNote {
  letter: string;
  blocks: Block[];
}

export interface Slide {
  index: number;
  /** the lines of the page this slide is made of (1-based, both included) */
  from: number;
  to: number;
  /** the layout the slide asks for with `:::: {layout=name}` around it, if any */
  manual: string | null;
  blocks: SlideBlock[];
  /** the picture behind the slide, if it has one */
  background: SlideBackground | null;
  /** the presenter's notes of this slide, lettered a, b, … aa, ab in the order they are referred to */
  notes: SlideNote[];
  /** footnote number (as in the blocks' references) → its letter, for the notes only */
  noteLetters: Record<number, string>;
}

export interface SlideOptions {
  /** the pixel size of an image, to tell portrait from landscape (unknown: landscape) */
  imageSize?: (url: string) => { w: number; h: number } | null;
}

/** The definitions of footnotes (`[^id]: text`, with their indented lines) found anywhere in the text. */
function footnoteDefinitions(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^ {0,3}\[\^[^\]]+\]:/.test(lines[i]!)) continue;
    let end = i;
    while (end + 1 < lines.length && (/^(?: {4}|\t)\S/.test(lines[end + 1]!) || (lines[end + 1]!.trim() === '' && /^(?: {4}|\t)\S/.test(lines[end + 2] ?? '')))) end++;
    out.push(lines.slice(i, end + 1).join('\n'));
    i = end;
  }
  return out;
}

const withoutDefinitions = (text: string): string => {
  const defs = new Set(footnoteDefinitions(text));
  return defs.size ? text.split('\n').filter((l) => ![...defs].some((d) => d.split('\n').includes(l))).join('\n') : text;
};

/** a, b, … z, aa, ab, … */
export function noteLetter(k: number): string {
  let n = k + 1;
  let out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * The page cut into slides, as the lines each takes (empty slides are left out): at each horizontal rule, and before a
 * heading that follows something that is not a heading.
 */
export function splitSlides(markdown: string): Array<{ from: number; to: number; text: string }> {
  const { lines, breaks, cuts, bodyStart } = slideBreaks(markdown);
  const marks = [...breaks.map((line) => ({ line, rule: true })), ...cuts.map((line) => ({ line, rule: false }))].filter((m) => m.line >= bodyStart).sort((a, b) => a.line - b.line);
  const out: Array<{ from: number; to: number; text: string }> = [];
  let start = bodyStart;
  const close = (end: number): void => {
    const text = lines.slice(start - 1, end).join('\n');
    if (withoutDefinitions(text).trim() !== '') out.push({ from: start, to: end, text });
  };
  for (const m of marks) {
    close(m.line - 1);
    start = m.rule ? m.line + 1 : m.line;
  }
  close(lines.length);
  return out;
}

const isCaptionPara = (b: Block): boolean => b.t === 'para' && b.inlines.length > 0 && b.inlines.every((i) => i.italic || i.text.trim() === '');

/** Sort the blocks of one slide into kinds. */
function classify(blocks: Block[], opts: SlideOptions, found: { background: SlideBackground | null }): SlideBlock[] {
  const out: SlideBlock[] = [];
  const levels = blocks.filter((b) => b.t === 'heading').map((b) => (b as { level: number }).level);
  const top = levels.length ? Math.min(...levels) : 0;
  let haveTitle = false;
  let haveSub = false;
  const walk = (list: Block[], side?: 'left' | 'right', forceCaption = false): void => {
    list.forEach((b, i) => {
      const prev = list[i - 1];
      if (b.t === 'div') {
        const s = b.classes.includes('left') ? 'left' : b.classes.includes('right') ? 'right' : side;
        walk(b.blocks, s, forceCaption || b.classes.includes('caption'));
        return;
      }
      if (b.t === 'heading' && !side) {
        if (b.level === top && !haveTitle) {
          haveTitle = true;
          out.push({ kind: 'title', blocks: [b] });
          return;
        }
        if (b.level > top && !haveSub && haveTitle) {
          haveSub = true;
          out.push({ kind: 'subtitle', blocks: [b] });
          return;
        }
      }
      if (b.t === 'image') {
        if (b.attrs?.background) {
          if (!found.background) found.background = { url: b.url, alt: b.alt, attrs: { ...b.attrs } };
          return;
        }
        const size = opts.imageSize?.(b.url) ?? null;
        const portrait = b.orient ? b.orient === 'portrait' : !!size && size.h > size.w;
        const s = b.side ?? side;
        out.push({ kind: portrait ? 'portrait' : 'landscape', ...(s ? { side: s } : {}), blocks: [b], ...(size ? { natural: size } : {}) });
        return;
      }
      if (b.t === 'para' && (forceCaption || (prev?.t === 'image' && isCaptionPara(b)))) {
        out.push({ kind: 'caption', blocks: [b] });
        return;
      }
      if (b.t === 'hr') return;
      out.push({ kind: side === 'left' ? 'text-left' : side === 'right' ? 'text-right' : 'text', ...(side ? { side } : {}), blocks: [b] });
    });
  };
  walk(blocks);
  // neighbouring pieces of text (a paragraph and a list, say) are one block of text
  const merged: SlideBlock[] = [];
  for (const b of out) {
    const last = merged[merged.length - 1];
    if (last && last.kind === b.kind && last.side === b.side && (b.kind === 'text' || b.kind === 'text-left' || b.kind === 'text-right')) last.blocks.push(...b.blocks);
    else merged.push({ ...b, blocks: [...b.blocks] });
  }
  return merged;
}

/** The slides of a presentation page. */
export function buildSlides(markdown: string, opts: SlideOptions = {}): Slide[] {
  const defs = footnoteDefinitions(markdown.replace(/\r\n?/g, '\n')).join('\n\n');
  return splitSlides(markdown).map((seg, index) => {
    let blocks = parseDoc(defs ? `${seg.text}\n\n${defs}` : seg.text, { splitImages: true });
    // the footnotes called `note…` are the presenter's notes; the others are not shown on a slide
    const last = blocks[blocks.length - 1];
    const notes: SlideNote[] = [];
    const noteLetters: Record<number, string> = {};
    if (last && last.t === 'notes') {
      blocks = blocks.slice(0, -1);
      last.items.forEach((items, k) => {
        if (/^note/i.test(last.ids?.[k] ?? '')) {
          const letter = noteLetter(notes.length);
          notes.push({ letter, blocks: items });
          noteLetters[k + 1] = letter;
        }
      });
    }
    let manual: string | null = null;
    const only = blocks.length === 1 ? blocks[0]! : null;
    if (only && only.t === 'div' && only.attrs?.layout) {
      manual = only.attrs.layout;
      blocks = only.blocks;
    }
    const found: { background: SlideBackground | null } = { background: null };
    const classified = classify(blocks, opts, found);
    return { index, from: seg.from, to: seg.to, manual, blocks: classified, background: found.background, notes, noteLetters };
  });
}

// ---------------------------------------------------------------- which layout a slide gets

/** One line of the table that decides layouts: if a slide's blocks fit `when` (and `sides`), it gets `layout`. */
export interface LayoutRule {
  /**
   * The kinds a slide may have, in any order. `title`: exactly one; `text+`: one or more; `text*`: any number;
   * `title?`: none or one; `text|text-left|text-right+`: one or more of any of those. `image` stands for `landscape|portrait`.
   */
  when: string[];
  /** `left` or `right`: only if there is a block marked that side (and none on the other); `both`: blocks on both sides; `none`: no sides marked. Default: any. */
  sides?: 'left' | 'right' | 'both' | 'none';
  layout: string;
}

export const DEFAULT_RULES: LayoutRule[] = [
  { when: ['title', 'subtitle'], layout: 'title' },
  { when: ['title'], layout: 'section' },
  { when: ['title?', 'subtitle?', 'text+'], sides: 'none', layout: 'content' },
  { when: ['title?', 'subtitle?', 'text|text-left|text-right*', 'image*', 'caption*'], sides: 'both', layout: 'compare' },
  { when: ['title?', 'subtitle?', 'text|text-left|text-right+', 'image', 'caption?'], sides: 'left', layout: 'image-left' },
  { when: ['title?', 'subtitle?', 'text|text-left|text-right+', 'image', 'caption?'], layout: 'image-right' },
  { when: ['title?', 'image', 'caption?'], layout: 'picture' },
  { when: ['title?', 'image+', 'caption*'], layout: 'gallery' },
  { when: ['title?', 'subtitle?', 'text|text-left|text-right+'], layout: 'content' },
];

interface Token {
  kinds: Set<SlideKind>;
  min: number;
  max: number;
}

function parseWhen(when: string[]): Token[] {
  const out: Token[] = [];
  for (const raw of when) {
    const m = /^([a-z|-]+)([?*+]?)$/.exec(String(raw).trim().toLowerCase());
    if (!m) continue;
    const kinds = new Set<SlideKind>();
    for (const k of m[1]!.split('|')) {
      if (k === 'image') {
        kinds.add('landscape');
        kinds.add('portrait');
      } else if ((SLIDE_KINDS as string[]).includes(k)) kinds.add(k as SlideKind);
    }
    if (!kinds.size) continue;
    const q = m[2];
    out.push({ kinds, min: q === '?' || q === '*' ? 0 : 1, max: q === '*' || q === '+' ? Infinity : 1 });
  }
  return out;
}

/** Whether a slide's kinds (and sides) fit a rule. */
export function ruleMatches(rule: LayoutRule, blocks: SlideBlock[]): boolean {
  const tokens = parseWhen(rule.when);
  const counts = tokens.map(() => 0);
  for (const b of blocks) {
    const i = tokens.findIndex((t) => t.kinds.has(b.kind));
    if (i < 0) return false;
    counts[i]!++;
  }
  if (!tokens.every((t, i) => counts[i]! >= t.min && counts[i]! <= t.max)) return false;
  const left = blocks.some((b) => b.side === 'left');
  const right = blocks.some((b) => b.side === 'right');
  switch (rule.sides) {
    case 'none': return !left && !right;
    case 'both': return left && right;
    case 'left': return left && !right;
    case 'right': return right && !left;
    default: return true;
  }
}

/** The layout for a slide: the one it asks for, else the first rule it fits (your rules, then the built-in ones), else `content`. */
export function chooseLayout(slide: Slide, rules: LayoutRule[] = []): string {
  if (slide.manual) return slide.manual;
  for (const r of [...rules, ...DEFAULT_RULES]) if (ruleMatches(r, slide.blocks)) return r.layout;
  return 'content';
}

/** Clean the layout rules written in YAML (`when` as a list or a comma-separated text). Wrong lines are left out. */
export function cleanRules(raw: unknown): LayoutRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const when = Array.isArray(o.when) ? o.when.map(String) : typeof o.when === 'string' ? o.when.split(/[,\s]+/).filter(Boolean) : [];
    if (typeof o.layout !== 'string' || !/^[A-Za-z][\w-]{0,39}$/.test(o.layout) || !when.length) continue;
    const sides = o.sides === 'left' || o.sides === 'right' || o.sides === 'both' || o.sides === 'none' ? o.sides : undefined;
    out.push({ when, layout: o.layout, ...(sides ? { sides } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------- changing a slide's layout in the page

/**
 * The page with slide number `index` given another layout, by wrapping its lines in `:::: {layout=name}` … `::::` (an
 * existing wrapper is changed; `null` takes the wrapper away, so the rules decide again).
 */
export function setSlideLayout(markdown: string, index: number, layout: string | null): string {
  const seg = splitSlides(markdown)[index];
  if (!seg) return markdown;
  const nl = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let a = seg.from - 1;
  let b = seg.to - 1;
  while (a <= b && lines[a]!.trim() === '') a++;
  while (b >= a && lines[b]!.trim() === '') b--;
  const wrapped = /^:{4,}\s*\{[^}]*layout\s*=/.test(lines[a] ?? '') && /^:{4,}\s*$/.test(lines[b] ?? '');
  if (wrapped) {
    if (layout) lines[a] = `:::: {layout=${layout}}`;
    else {
      lines.splice(b, 1);
      lines.splice(a, 1);
    }
  } else if (layout) {
    lines.splice(b + 1, 0, '::::');
    lines.splice(a, 0, `:::: {layout=${layout}}`);
  }
  return lines.join(nl);
}
