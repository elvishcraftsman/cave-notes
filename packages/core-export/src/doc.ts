import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { type ImageAttrs, parseImageAttrs } from './slideImages';

/** What an export is made of, independent of the output format. */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  /** a line break after this piece */
  br?: boolean;
  /** a reference to footnote number `note` (1-based, by order of first reference) */
  note?: number;
  /** the label of that footnote (`[^note]` has `note`) */
  noteId?: string;
}

export type ListKind = 'decimal' | 'alpha' | 'ALPHA' | 'roman' | 'ROMAN';

export interface ListItem {
  blocks: Block[];
  /** a task item: true when ticked */
  checked: boolean | null;
}

export type Block =
  | { t: 'heading'; level: number; inlines: Inline[] }
  /** `cont`: the text goes on after a block quote that cut the paragraph in two (no blank line between them), so it is not a new paragraph */
  | { t: 'para'; inlines: Inline[]; cont?: boolean }
  | { t: 'quote'; blocks: Block[] }
  /** a `::: name` block: its paragraphs take the named styles */
  | { t: 'div'; classes: string[]; blocks: Block[]; /** `{key=value}` pairs of the opening line (a slide's `layout=`) */ attrs?: Record<string, string> }
  | { t: 'code'; text: string; lang: string }
  | { t: 'hr' }
  | { t: 'list'; ordered: boolean; kind: ListKind; start: number; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: Array<'left' | 'right' | 'center' | null> }
  /** `side` and `orient` come from `{.left}`, `{.right}`, `{.portrait}`, `{.landscape}` after the image */
  | { t: 'image'; alt: string; url: string; side?: 'left' | 'right'; orient?: 'portrait' | 'landscape'; /** the rest of what follows the picture in `{…}` (crop, size, background: see slideImages.ts) */ attrs?: ImageAttrs }
  /** the footnotes of the document, in the order they are referred to; always the last block */
  | { t: 'notes'; items: Block[][]; /** the label of each footnote */ ids?: string[] };

// ---------------------------------------------------------------- lettered and Roman markers
// remark only knows "1."; such a marker is shown to it as a number of the same width, and its real text is kept by line.

const ROMAN: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const toRoman = (n: number): string => ROMAN.reduce((acc, [v, s]) => { while (n >= v) { acc += s; n -= v; } return acc; }, '');
function fromRoman(s: string): number | null {
  const t = s.toLowerCase();
  if (!/^[ivxlc]+$/.test(t) || t.length > 8) return null;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = ROMAN.find(([, r]) => r === t[i])![0];
    const nxt = i + 1 < t.length ? ROMAN.find(([, r]) => r === t[i + 1])![0] : 0;
    n += cur < nxt ? -cur : cur;
  }
  return n > 0 && n < 400 && toRoman(n) === t ? n : null;
}
const fromAlpha = (s: string): number => [...s.toLowerCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 96, 0);

interface Marker { kind: ListKind; value: number }
function markerOf(text: string): Marker | null {
  const m = /^([A-Za-z]{1,8})[.)]$/.exec(text);
  if (!m) return null;
  const body = m[1]!;
  const upper = body === body.toUpperCase();
  if (body !== body.toLowerCase() && !upper) return null;
  const roman = fromRoman(body);
  if (body.length === 1) return body.toLowerCase() === 'i' && roman !== null ? { kind: upper ? 'ROMAN' : 'roman', value: 1 } : { kind: upper ? 'ALPHA' : 'alpha', value: fromAlpha(body) };
  return roman !== null ? { kind: upper ? 'ROMAN' : 'roman', value: roman } : null;
}

/** Swap lettered markers for numbers, outside fenced code. Returns the text and the real marker of each line. */
function shadow(text: string): { text: string; markers: Map<number, Marker> } {
  const markers = new Map<number, Marker>();
  let fence: string | null = null;
  const lines = text.split('\n').map((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) fence = fence === null ? f[1]![0]! : fence === f[1]![0] ? null : fence;
    if (fence !== null) return line;
    // `::: name` opens a styled block and `:::` closes it; both are shown to the parser as comments (read back in `blocks`)
    const d = /^ {0,3}(:{3,})[ \t]*(.*?)[ \t]*:*[ \t]*$/.exec(line);
    if (d) {
      if (d[2] === '') return '<!--cn-end-->';
      const { classes, attrs } = divSpec(d[2]!);
      const q = new URLSearchParams(attrs).toString();
      return `<!--cn-div ${classes.join(' ')}${q ? ` ::${q}` : ''}-->`;
    }
    const m = /^((?:[ \t]*>)*[ \t]*)([A-Za-z]{1,8}[.)])(?=[ \t])/.exec(line);
    if (!m) return line;
    const mk = markerOf(m[2]!);
    if (!mk) return line;
    markers.set(i + 1, mk);
    const len = m[2]!.length - 1;
    return m[1]! + String(mk.value === 1 ? 1 : 2).padEnd(len, '1') + m[2]!.slice(-1) + line.slice(m[1]!.length + m[2]!.length);
  });
  return { text: lines.join('\n'), markers };
}

/** The classes and `key=value` pairs on the opening line of a `::: …` block: `::: a b`, `::: {.a .b layout=compare}` or `::: {custom-style="A b"}`. */
function divSpec(spec: string): { classes: string[]; attrs: Record<string, string> } {
  const t = spec.trim();
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  if (t.startsWith('{')) {
    for (const m of t.matchAll(/\.([A-Za-z][\w-]*)|([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|([^\s}]+))/g)) {
      if (m[1]) classes.push(m[1]);
      else if (m[2] === 'custom-style') {
        const n = (m[3] ?? m[4] ?? '').trim().replace(/\s+/g, '-');
        if (/^[A-Za-z][\w-]*$/.test(n)) classes.push(n);
      } else if (m[2]) attrs[m[2]] = m[3] ?? m[4] ?? '';
    }
  } else for (const w of t.split(/\s+/)) if (/^[A-Za-z][\w-]*$/.test(w)) classes.push(w);
  return { classes, attrs };
}

/** Wrap what lies between `<!--cn-div …-->` and `<!--cn-end-->` (same level) in div nodes; a div never closed runs to the end. */
function groupDivs(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const stack: Array<{ node: Node; into: Node[] }> = [];
  let into = out;
  for (const n of nodes) {
    const open = n.type === 'html' ? /^<!--cn-div ?([^>]*?)-->$/.exec((n.value ?? '').trim()) : null;
    if (open) {
      const div: Node = { type: 'cnDiv', value: open[1] ?? '', children: [] };
      into.push(div);
      stack.push({ node: div, into });
      into = div.children!;
    } else if (n.type === 'html' && (n.value ?? '').trim() === '<!--cn-end-->') {
      const top = stack.pop();
      if (top) into = top.into;
    } else into.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- mdast to blocks

type Node = { identifier?: string; type: string; children?: Node[]; value?: string; depth?: number; ordered?: boolean; start?: number | null; checked?: boolean | null; url?: string; alt?: string; lang?: string | null; align?: Array<'left' | 'right' | 'center' | null>; position?: { start: { line: number }; end: { line: number } } };

/** HTML tags that Markdown pages carry; an export shows what is between them, not the tags */
const HTML_TAG = /<\/?(?:div|span|p|b|i|em|strong|u|s|sub|sup|small|mark|center|font|section|article|details|summary|kbd|abbr|cite|code|a|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|pre|figure|figcaption|header|footer|nav|aside|main|time|var|samp|q|del|ins|br|hr|img)(?:\s[^<>]*)?\/?>/gi;

/** numbering of footnotes while one document is read */
let noteOrder = new Map<string, number>();

function inlines(nodes: Node[] | undefined, style: Omit<Inline, 'text'> = {}): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'footnoteReference': {
        const id = n.identifier ?? '';
        if (!noteOrder.has(id)) noteOrder.set(id, noteOrder.size + 1);
        out.push({ text: '', note: noteOrder.get(id)!, noteId: id });
        break;
      }
      case 'text': {
        // [[Page|shown]] and [[Page]] read as their shown text
        const v = (n.value ?? '').replace(/ *\n */g, ' ').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, page: string, shown?: string) => shown ?? page.split('/').pop() ?? page);
        if (v) out.push({ ...style, text: v });
        break;
      }
      case 'strong': out.push(...inlines(n.children, { ...style, bold: true })); break;
      case 'emphasis': out.push(...inlines(n.children, { ...style, italic: true })); break;
      case 'delete': out.push(...inlines(n.children, { ...style, strike: true })); break;
      case 'inlineCode': out.push({ ...style, text: n.value ?? '', code: true }); break;
      case 'link': out.push(...inlines(n.children, { ...style, link: n.url ?? '' })); break;
      case 'break': out.push({ ...style, text: '', br: true }); break;
      case 'image': if (n.alt) out.push({ ...style, text: n.alt }); break;
      case 'html': {
        const v = n.value ?? '';
        if (/^<br\s*\/?>$/i.test(v)) out.push({ ...style, text: '', br: true });
        else if (!v.startsWith('<!--')) {
          const shown = v.replace(HTML_TAG, '');
          if (shown) out.push({ ...style, text: shown });
        }
        break;
      }
      default: out.push(...inlines(n.children, style)); if (!n.children && n.value) out.push({ ...style, text: n.value });
    }
  }
  return out;
}

/** The lines of the page being read (to tell whether a blank line separates two blocks). */
let sourceLines: string[] = [];
/** Whether a blank line lies between the end of one block and the start of the next. */
const blankBetween = (endLine: number, startLine: number): boolean => {
  for (let l = endLine + 1; l < startLine; l++) if ((sourceLines[l - 1] ?? '').trim() === '') return true;
  return false;
};

/** While slides are made: a picture written at the end (or the start) of a paragraph of text is a picture beside that text. */
let splitImages = false;

const hasWords = (nodes: Node[]): boolean => nodes.some((k) => !((k.type === 'text' && (k.value ?? '').trim() === '') || k.type === 'break'));

/**
 * A paragraph that holds a picture: the picture alone (with the `{…}` after it, if any) is an image block. With
 * `splitImages` (slides), a picture at the end of a paragraph of text becomes text with a picture on its right, and one
 * at the start a picture on the left of the text. A picture in the middle of a sentence stays in the sentence.
 */
function pictureParagraph(kids: Node[]): Block[] | null {
  const at = kids.map((k, i) => (k.type === 'image' ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) return null;
  const i = at[0]!;
  const img = kids[i]!;
  let after = kids.slice(i + 1);
  let attrs: ImageAttrs = {};
  const t0 = after[0];
  if (t0 && t0.type === 'text') {
    const m = /^\s*\{([^}]*)\}/.exec(t0.value ?? '');
    if (m) {
      attrs = parseImageAttrs(m[1]!);
      const rest = (t0.value ?? '').slice(m[0].length);
      after = rest.trim() === '' ? after.slice(1) : [{ ...t0, value: rest }, ...after.slice(1)];
    }
  }
  const before = kids.slice(0, i);
  const textBefore = hasWords(before);
  const textAfter = hasWords(after);
  const picture = (side?: 'left' | 'right'): Block => {
    const a: ImageAttrs = { ...attrs };
    if (!a.side && side) a.side = side;
    const b: Block = { t: 'image', alt: img.alt ?? '', url: img.url ?? '' };
    if (a.side) b.side = a.side;
    if (a.orient) b.orient = a.orient;
    const { side: _s, orient: _o, ...more } = a;
    if (Object.keys(more).length) b.attrs = more;
    return b;
  };
  const trimmed = (nodes: Node[]): Inline[] => {
    const list = inlines(nodes);
    while (list.length && list[list.length - 1]!.text.trim() === '' && !list[list.length - 1]!.br && list[list.length - 1]!.note === undefined) list.pop();
    while (list.length && list[0]!.text.trim() === '' && !list[0]!.br && list[0]!.note === undefined) list.shift();
    if (list.length) list[list.length - 1] = { ...list[list.length - 1]!, text: list[list.length - 1]!.text.replace(/\s+$/, '') };
    if (list.length) list[0] = { ...list[0]!, text: list[0]!.text.replace(/^\s+/, '') };
    return list;
  };
  if (!textBefore && !textAfter) return [picture()];
  if (!splitImages) return null;
  if (textBefore && !textAfter) return [{ t: 'para', inlines: trimmed(before) }, picture('right')];
  if (!textBefore && textAfter) return [picture('left'), { t: 'para', inlines: trimmed(after) }];
  return null;
}

function blocks(input: Node[] | undefined, markers: Map<number, Marker>): Block[] {
  const nodes = input && input.some((x) => x.type === 'html' && /^<!--cn-(div|end)/.test((x.value ?? '').trim())) ? groupDivs(input) : input;
  const out: Block[] = [];
  // A paragraph that a block quote interrupts goes on after the quote when no blank line comes between: `flow` is true
  // while that could still be the case (after a paragraph, and after a quote that touches it).
  let flow = false;
  // The same after a list: a line holding only `<!-- -->` right under the list ends it (so the text below is not part of
  // its last item) and prints nothing; a paragraph that touches that line goes on with the paragraph above the list.
  let listFlow = false; // a list that followed a paragraph (or touches one) and no blank line since
  let bridged = false; // the comment line was met right after such a list
  let prev: Node | null = null;
  for (const n of nodes ?? []) {
    const touches = !!prev && !!prev.position && !!n.position && !blankBetween(prev.position.end.line, n.position.start.line);
    const isMark = n.type === 'html' && /^<!--\s*-->$/.test((n.value ?? '').trim());
    const continued = (n.type === 'paragraph' && prev?.type === 'blockquote' && flow && touches) || (n.type === 'paragraph' && bridged && touches);
    bridged = isMark && listFlow && touches;
    listFlow = n.type === 'list' ? flow && touches : isMark ? bridged : false;
    flow = n.type === 'paragraph' ? true : n.type === 'blockquote' ? flow && touches : false;
    prev = n;
    switch (n.type) {
      case 'heading': out.push({ t: 'heading', level: Math.min(6, n.depth ?? 1), inlines: inlines(n.children) }); break;
      case 'paragraph': {
        const pic = pictureParagraph(n.children ?? []);
        if (pic) out.push(...pic);
        else out.push({ t: 'para', inlines: inlines(n.children), ...(continued ? { cont: true } : {}) });
        break;
      }
      case 'blockquote': {
        const keep = splitImages;
        splitImages = false; // a picture inside a quotation or a list item stays where it is written
        out.push({ t: 'quote', blocks: blocks(n.children, markers) });
        splitImages = keep;
        break;
      }
      case 'cnDiv': {
        const [cls = '', q = ''] = (n.value ?? '').split(' ::');
        const attrs = Object.fromEntries(new URLSearchParams(q));
        out.push({ t: 'div', classes: cls.split(' ').filter(Boolean), blocks: blocks(n.children, markers), ...(Object.keys(attrs).length ? { attrs } : {}) });
        break;
      }
      case 'code':
        if (n.lang === 'view') break; // a database view is drawn live in the app; it has nothing to print
        out.push({ t: 'code', text: n.value ?? '', lang: n.lang ?? '' });
        break;
      case 'thematicBreak': out.push({ t: 'hr' }); break;
      case 'list': {
        const first = n.children?.[0]?.position?.start.line;
        const mk = first !== undefined ? markers.get(first) : undefined;
        const keep = splitImages;
        splitImages = false;
        out.push({
          t: 'list',
          ordered: !!n.ordered,
          kind: n.ordered ? mk?.kind ?? 'decimal' : 'decimal',
          start: n.ordered ? (mk ? mk.value : n.start ?? 1) : 1,
          items: (n.children ?? []).map((li) => ({ blocks: blocks(li.children, markers), checked: li.checked ?? null })),
        });
        splitImages = keep;
        break;
      }
      case 'table': {
        const rows = (n.children ?? []).map((r) => (r.children ?? []).map((c) => inlines(c.children)));
        // as GitHub reads tables: every row has as many cells as the header, short rows padded and extra cells ignored
        const width = Math.max(rows[0]?.length ?? 0, 1);
        const fit = (r: Inline[][]): Inline[][] => Array.from({ length: width }, (_, i) => r[i] ?? []);
        out.push({ t: 'table', head: fit(rows[0] ?? []), rows: rows.slice(1).map(fit), align: n.align ?? [] });
        break;
      }
      case 'html': {
        const v = (n.value ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(HTML_TAG, '').trim();
        if (v) out.push({ t: 'para', inlines: [{ text: v }] });
        break;
      }
      case 'yaml': case 'toml': case 'definition': case 'footnoteDefinition': break;
      default: if (n.children) out.push(...blocks(n.children, markers));
    }
  }
  return out;
}

/** Read Markdown (frontmatter, lists of every kind, tables, task items) into blocks. */
export function parseDoc(markdown: string, opts: { splitImages?: boolean } = {}): Block[] {
  splitImages = opts.splitImages === true;
  // characters that cannot be written in XML (and would make Word report a damaged file) are dropped
  const clean = markdown.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  // a page that begins with a horizontal rule is not front matter: the rule needs a closing fence and a non-blank line after it
  const lead = /^---[ \t]*\n([^\n]*)/.exec(clean);
  const hasFence = /^---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.test(clean);
  const { text, markers } = shadow(lead && (lead[1]!.trim() === '' || !hasFence) ? clean.replace(/^---/, '***') : clean);
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(text) as unknown as Node;
  noteOrder = new Map();
  sourceLines = text.split('\n');
  const defs = new Map<string, Node>();
  for (const n of tree.children ?? []) if (n.type === 'footnoteDefinition' && n.identifier !== undefined && !defs.has(n.identifier)) defs.set(n.identifier, n);
  const out = blocks(tree.children, markers);
  if (noteOrder.size > 0) {
    const items = [...noteOrder.keys()].map((id) => {
      const def = defs.get(id);
      return def ? blocks(def.children, markers) : [{ t: 'para', inlines: [{ text: '(this footnote has no text)', italic: true }] } as Block];
    });
    out.push({ t: 'notes', items, ids: [...noteOrder.keys()] });
  }
  return out;
}

/** Text of a run of inlines. */
export const plainText = (items: Inline[]): string => items.map((i) => i.text).join('');


/**
 * Where a page's slides begin and end: the lines of the horizontal rules that stand on their own at the top level of the
 * page (a `---` inside a code block, a table or the front matter is not a break). Lines are 1-based.
 */
export function slideBreaks(markdown: string): { lines: string[]; breaks: number[]; cuts: number[]; bodyStart: number } {
  const clean = markdown.replace(/\r\n?/g, '\n');
  const lead = /^---[ \t]*\n([^\n]*)/.exec(clean);
  const hasFence = /^---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.test(clean);
  const { text } = shadow(lead && (lead[1]!.trim() === '' || !hasFence) ? clean.replace(/^---/, '***') : clean);
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(text) as unknown as Node;
  const breaks: number[] = [];
  const cuts: number[] = [];
  let bodyStart = 1;
  let depth = 0; // inside a `::: name` block
  let prev: string | null = null; // the kind of the block before, in the current slide
  for (const n of tree.children ?? []) {
    if (n.type === 'yaml' && n.position) {
      bodyStart = n.position.end.line + 1;
      prev = null;
    } else if (n.type === 'thematicBreak' && n.position) {
      breaks.push(n.position.start.line);
      prev = null;
    } else if (n.type === 'html' && /^<!--cn-div/.test((n.value ?? '').trim())) depth++;
    else if (n.type === 'html' && /^<!--cn-end/.test((n.value ?? '').trim())) depth = Math.max(0, depth - 1);
    else if (depth > 0 || n.type === 'footnoteDefinition' || n.type === 'definition') continue;
    else {
      // a heading that comes after something that is not a heading starts a new slide (no rule needed)
      if (n.type === 'heading' && prev !== null && prev !== 'heading' && n.position) cuts.push(n.position.start.line);
      prev = n.type;
    }
  }
  return { lines: clean.split('\n'), breaks, cuts, bodyStart };
}
