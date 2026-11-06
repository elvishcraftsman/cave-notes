import YAML from 'yaml';
import { BUILTIN_STYLES, cleanNamedStyles, cleanStyleSet, headerFooterDiffers, type HeaderFooter, type NamedStyle, type StyleSet, type Units } from './styles';

/**
 * Style sets as YAML: friendlier than the stored form. Lengths may carry a unit (`2.5cm`, `1in`, `25mm`, `12pt`); a bare
 * number in a length that is a page measure counts in the set's `units`. A set can start from another with `base`.
 * See docs/export-styles.md.
 */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A length as cm: `2.5cm`, `1in`, `25mm`, `72pt`, or a bare number in `units`. */
export function lengthToCm(v: unknown, units: Units): number | null {
  const n = num(v);
  if (n !== null) return units === 'in' ? n * 2.54 : n;
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(cm|mm|in|pt)?\s*$/i.exec(v);
  if (!m) return null;
  const x = Number(m[1]);
  switch ((m[2] ?? units).toLowerCase()) {
    case 'in': return x * 2.54;
    case 'mm': return x / 10;
    case 'pt': return (x / 72) * 2.54;
    default: return x;
  }
}

/** A length in points: `12pt`, `0.5cm`, or a bare number of points. */
export function lengthToPt(v: unknown): number | null {
  const n = num(v);
  if (n !== null) return n;
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(pt|cm|mm|in)?\s*$/i.exec(v);
  if (!m) return null;
  const x = Number(m[1]);
  switch ((m[2] ?? 'pt').toLowerCase()) {
    case 'in': return x * 72;
    case 'cm': return (x / 2.54) * 72;
    case 'mm': return (x / 25.4) * 72;
    default: return x;
  }
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const def = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/** A header or footer from its YAML: `left`, `center` and `right` for every page, `odd:` and `even:` (each with the same three) to say more for those pages. */
function headerFooterFromYaml(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v);
  const both = { left: o.left, center: o.center, right: o.right };
  const merge = (side: unknown): Record<string, unknown> => {
    const x = obj(side);
    return { left: x.left ?? both.left, center: x.center ?? both.center, right: x.right ?? both.right };
  };
  return { odd: merge(o.odd), even: merge(o.even), firstPage: o.firstPage, sizePt: def(lengthToPt(o.size)), color: o.color };
}

function headerFooterToYaml(h: HeaderFooter): Record<string, unknown> | undefined {
  const pick = (t: { left: string; center: string; right: string }): Record<string, string> => Object.fromEntries(Object.entries(t).filter(([, x]) => x !== ''));
  const out: Record<string, unknown> = headerFooterDiffers(h) ? { odd: pick(h.odd), even: pick(h.even) } : pick(h.odd);
  if (Object.keys(out).length === 0) return undefined;
  if (!h.firstPage) out.firstPage = false;
  out.size = `${h.sizePt}pt`;
  out.color = h.color;
  return out;
}

/** One set from its friendly YAML form. Anything wrong falls back to `base`. */
export function styleSetFromYaml(name: string, raw: unknown, base: StyleSet = BUILTIN_STYLES[0]!): StyleSet {
  const r = obj(raw);
  const units: Units = r.units === 'in' || r.units === 'cm' ? r.units : base.units;
  const page = obj(r.page);
  const body = obj(r.body);
  const code = obj(r.code);
  const bq = obj(r.blockquote ?? r.quote);
  const link = obj(r.link);
  const list = obj(r.list);
  const table = obj(r.table);
  const fn = obj(r.footnotes);
  const hs = obj(r.headings);
  const heading = (i: number): Record<string, unknown> => {
    const h = obj(r[`h${i + 1}`] ?? hs[i + 1] ?? hs[`h${i + 1}`]);
    return { font: h.font, sizePt: def(lengthToPt(h.size)), bold: h.bold, italic: h.italic, color: h.color, before: def(lengthToPt(h.before)), after: def(lengthToPt(h.after)), lineHeight: h.lineHeight };
  };
  const converted = {
    name,
    units,
    page: { size: page.size, marginCm: def(lengthToCm(page.margin, units)) },
    body: { font: body.font, sizePt: def(lengthToPt(body.size)), color: body.color, lineHeight: body.lineHeight, justify: body.justify, paragraphAfter: def(lengthToPt(body.spaceAfter)), firstLineIndentCm: def(lengthToCm(body.firstLineIndent ?? body.indent, units)), indentAfterHeading: body.indentAfterHeading },
    headings: [0, 1, 2, 3, 4, 5].map(heading),
    code: { font: code.font, sizePt: def(lengthToPt(code.size)), color: code.color, background: code.background },
    blockquote: { color: bq.color, italic: bq.italic, indentCm: def(lengthToCm(bq.indent, units)), bar: bq.bar },
    link: { color: link.color, underline: link.underline },
    listIndentCm: def(lengthToCm(list.indent, units)),
    table: { headerBackground: table.headerBackground, border: table.border },
    footnotes: { sizePt: def(lengthToPt(fn.size)), color: fn.color, italic: fn.italic, endnotes: fn.placement === 'endnotes' ? true : fn.placement === 'footnotes' ? false : undefined },
    titleFromPage: obj(r.title).fromPage ?? r.titleFromPage,
    header: headerFooterFromYaml(r.header),
    footer: headerFooterFromYaml(r.footer),
    styles: namedStylesFromYaml(r.styles, units),
    css: r.css,
  };
  return cleanStyleSet(converted, base);
}

/** Named styles from their YAML form (`indent`, `hanging`, `firstLineIndent`, `align`, `font`, `size`, `color`, `background`, `bold`, `italic`, `lineHeight`, `before`, `after`). Bare lengths count in `units`. */
export function namedStylesFromYaml(raw: unknown, units: Units): Record<string, NamedStyle> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(obj(raw))) {
    const r = obj(v);
    out[name] = { indentCm: def(lengthToCm(r.indent, units)), hangingCm: def(lengthToCm(r.hanging, units)), firstLineIndentCm: def(lengthToCm(r.firstLineIndent, units)), align: r.align, font: r.font, sizePt: def(lengthToPt(r.size)), color: r.color, background: r.background, bold: r.bold, italic: r.italic, lineHeight: r.lineHeight, before: def(lengthToPt(r.before)), after: def(lengthToPt(r.after)) };
  }
  return cleanNamedStyles(out);
}

const round = (n: number): number => Math.round(n * 100) / 100;
const lenOut = (cm: number, units: Units): string => (units === 'in' ? `${round(cm / 2.54)}in` : `${round(cm)}cm`);

/** The friendly YAML form of a set. */
export function styleSetToYaml(s: StyleSet): Record<string, unknown> {
  const u = s.units;
  const out: Record<string, unknown> = {
    units: u,
    page: { size: s.page.size, margin: lenOut(s.page.marginCm, u) },
    body: { font: s.body.font, size: `${s.body.sizePt}pt`, color: s.body.color, lineHeight: s.body.lineHeight, justify: s.body.justify, spaceAfter: `${s.body.paragraphAfter}pt`, firstLineIndent: lenOut(s.body.firstLineIndentCm, u), indentAfterHeading: s.body.indentAfterHeading },
  };
  s.headings.forEach((h, i) => {
    out[`h${i + 1}`] = { font: h.font, size: `${h.sizePt}pt`, color: h.color, bold: h.bold, italic: h.italic, before: `${h.before}pt`, after: `${h.after}pt`, lineHeight: h.lineHeight };
  });
  out.code = { font: s.code.font, size: `${s.code.sizePt}pt`, color: s.code.color, background: s.code.background };
  out.blockquote = { color: s.blockquote.color, italic: s.blockquote.italic, indent: lenOut(s.blockquote.indentCm, u), bar: s.blockquote.bar };
  out.link = { color: s.link.color, underline: s.link.underline };
  out.list = { indent: lenOut(s.listIndentCm, u) };
  out.table = { headerBackground: s.table.headerBackground, border: s.table.border };
  out.footnotes = { size: `${s.footnotes.sizePt}pt`, color: s.footnotes.color, italic: s.footnotes.italic, placement: s.footnotes.endnotes ? 'endnotes' : 'footnotes' };
  out.title = { fromPage: s.titleFromPage };
  const hd = headerFooterToYaml(s.header);
  if (hd) out.header = hd;
  const ft = headerFooterToYaml(s.footer);
  if (ft) out.footer = ft;
  if (Object.keys(s.styles).length) {
    out.styles = Object.fromEntries(
      Object.entries(s.styles).map(([k, v]) => [k, Object.fromEntries([
        ['indent', v.indentCm !== undefined ? lenOut(v.indentCm, u) : undefined], ['hanging', v.hangingCm !== undefined ? lenOut(v.hangingCm, u) : undefined], ['firstLineIndent', v.firstLineIndentCm !== undefined ? lenOut(v.firstLineIndentCm, u) : undefined],
        ['align', v.align], ['font', v.font], ['size', v.sizePt !== undefined ? `${v.sizePt}pt` : undefined], ['color', v.color], ['background', v.background], ['bold', v.bold], ['italic', v.italic], ['lineHeight', v.lineHeight],
        ['before', v.before !== undefined ? `${v.before}pt` : undefined], ['after', v.after !== undefined ? `${v.after}pt` : undefined],
      ].filter(([, x]) => x !== undefined))]),
    );
  }
  if (s.css.trim() !== '') out.css = s.css;
  return out;
}

export interface ParsedStyles {
  sets: StyleSet[];
  errors: string[];
}

/** A file of style sets: a map from a set's name to its definition. Sets that cannot be read are reported, the rest are kept. */
export function parseStyleSetsYaml(text: string, known: StyleSet[] = BUILTIN_STYLES): ParsedStyles {
  const errors: string[] = [];
  const sets: StyleSet[] = [];
  if (text.trim() === '') return { sets, errors };
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) {
    const e = doc.errors[0]!;
    return { sets, errors: [`${e.message.split('\n')[0]}${e.linePos?.[0] ? ` (line ${e.linePos[0].line})` : ''}`] };
  }
  const top = doc.toJS();
  if (!top || typeof top !== 'object' || Array.isArray(top)) return { sets, errors: ['This has to be a list of style names, each with its settings (Name: …).'] };
  for (const [name, value] of Object.entries(top as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`“${name}” needs settings under it (page:, body:, h1: …).`);
      continue;
    }
    const baseName = (value as Record<string, unknown>).base;
    let base: StyleSet = known[0] ?? BUILTIN_STYLES[0]!;
    if (typeof baseName === 'string') {
      const b = [...known, ...sets].find((x) => x.name.toLowerCase() === baseName.toLowerCase());
      if (b) base = b;
      else errors.push(`“${name}”: there is no style called “${baseName}” to start from.`);
    }
    sets.push(styleSetFromYaml(name, value, base));
  }
  return { sets, errors };
}

/** The YAML text of some sets. */
export function stringifyStyleSets(sets: StyleSet[]): string {
  const top: Record<string, unknown> = {};
  for (const s of sets) top[s.name] = styleSetToYaml(s);
  return YAML.stringify(top, { lineWidth: 0 });
}
