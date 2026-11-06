/**
 * Search and replace over the text of pages. A page's lines are sorted into kinds, so a search can be kept to some of them or
 * leave them out:
 *
 *   attributes  the YAML block at the top of the page
 *   headings    `# Heading` lines and underlined headings
 *   code        fenced code blocks (and the lines of the fences)
 *   text        everything else: paragraphs, lists, quotations, tables, footnotes
 *
 * (File names are not text of the page: they are matched by `matchName`.) A match never crosses a line: `^` and `$` are the
 * ends of a line, so `\n` finds nothing. The same pure functions give the preview and make the change, so what the preview
 * shows is what is written.
 */

export type ReplaceKind = 'text' | 'headings' | 'attributes' | 'code';
export const REPLACE_KINDS: ReplaceKind[] = ['text', 'headings', 'attributes', 'code'];

export interface ReplaceOptions {
  find: string;
  replace: string;
  /** `find` is a regular expression, and `replace` may use `$1`, `$&` and `$<name>` */
  regex: boolean;
  matchCase: boolean;
  /** only whole words (not with a regular expression: write `\b` in it) */
  wholeWord: boolean;
  /** the kinds of lines to look in */
  kinds: ReplaceKind[];
  /** match file names too */
  names: boolean;
}

export interface LineMatch {
  /** `line:n`, the nth match on that line: what a person's choice of matches is kept as */
  id: string;
  line: number;
  kind: ReplaceKind;
  /** columns of the match in the line */
  start: number;
  end: number;
  matched: string;
  replacement: string;
  /** the line as it is, and as it would be with only this match replaced */
  before: string;
  after: string;
}

/** The expression for the options, or the reason there is none. An empty search finds nothing. */
export function compileFind(o: Pick<ReplaceOptions, 'find' | 'regex' | 'matchCase' | 'wholeWord'>): { re: RegExp } | { error: string } | null {
  if (o.find === '') return null;
  let src = o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord && !o.regex) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try {
    return { re: new RegExp(src, `gu${o.matchCase ? '' : 'i'}`) };
  } catch {
    try {
      // a pattern that is not valid with the `u` flag (a stray escape) is tried the way a browser's older rules read it
      return { re: new RegExp(o.wholeWord && !o.regex ? src.replaceAll('\\p{L}\\p{N}', 'A-Za-z0-9') : src, `g${o.matchCase ? '' : 'i'}`) };
    } catch (e) {
      return { error: (e as Error).message.replace(/^Invalid regular expression: /, '') };
    }
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** The kind of every line of a page. */
export function classifyLines(lines: string[]): ReplaceKind[] {
  const kinds: ReplaceKind[] = new Array(lines.length).fill('text');
  let i = 0;
  if (lines[0]?.trimEnd() === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(lines[j]!)) {
        for (let k = 1; k < j; k++) kinds[k] = 'attributes';
        kinds[0] = 'text'; // the dashes themselves are not attributes
        kinds[j] = 'text';
        i = j + 1;
        break;
      }
    }
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const f = FENCE.exec(l);
    if (fence !== null) {
      kinds[i] = 'code';
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && l.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      kinds[i] = 'code';
      continue;
    }
    if (ATX.test(l)) {
      kinds[i] = 'headings';
      continue;
    }
    if (l.trim() !== '' && i + 1 < lines.length && UNDERLINE.test(lines[i + 1]!) && (i === 0 || lines[i - 1]!.trim() === '') && !/^\s*(?:[-*+]|\d+[.)])\s/.test(l)) {
      kinds[i] = 'headings';
      kinds[i + 1] = 'headings';
      i++;
    }
  }
  return kinds;
}

const splitLines = (text: string): { lines: string[]; eols: string[] } => {
  const lines: string[] = [];
  const eols: string[] = [];
  for (const part of text.split('\n')) {
    if (part.endsWith('\r')) {
      lines.push(part.slice(0, -1));
      eols.push('\r\n');
    } else {
      lines.push(part);
      eols.push('\n');
    }
  }
  eols[eols.length - 1] = '';
  return { lines, eols };
};

/** One match's replacement text, as `String.replace` makes it: `$&` the match, `$1` a group, `$<name>`, `$$`, `` $` `` and `$'`. */
function replacementOf(m: RegExpExecArray, replace: string, regex: boolean): string {
  if (!regex || !replace.includes('$')) return replace;
  const line = m.input;
  return replace.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (all, tok: string) => {
    if (tok === '$') return '$';
    if (tok === '&') return m[0];
    if (tok === '`') return line.slice(0, m.index);
    if (tok === "'") return line.slice(m.index + m[0].length);
    if (tok[0] === '<') return m.groups?.[tok.slice(1, -1)] ?? '';
    const n = Number(tok);
    if (n >= 1 && n < m.length) return m[n] ?? '';
    return all;
  });
}

/** Every match in a page, in the kinds asked for. */
export function findMatches(text: string, o: ReplaceOptions, limit = 5000): LineMatch[] {
  const c = compileFind(o);
  if (!c || 'error' in c) return [];
  const { lines } = splitLines(text);
  const kinds = classifyLines(lines);
  const want = new Set(o.kinds);
  const out: LineMatch[] = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (!want.has(kinds[i]!)) continue;
    const line = lines[i]!;
    c.re.lastIndex = 0;
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(line)) !== null) {
      if (m[0] === '') {
        c.re.lastIndex++;
        continue;
      }
      const replacement = replacementOf(m, o.replace, o.regex);
      out.push({
        id: `${i + 1}:${n++}`,
        line: i + 1,
        kind: kinds[i]!,
        start: m.index,
        end: m.index + m[0].length,
        matched: m[0],
        replacement,
        before: line,
        after: line.slice(0, m.index) + replacement + line.slice(m.index + m[0].length),
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The page with the chosen matches replaced (`ids` null: all of them). */
export function applyMatches(text: string, o: ReplaceOptions, ids: ReadonlySet<string> | null): { text: string; count: number } {
  const c = compileFind(o);
  if (!c || 'error' in c) return { text, count: 0 };
  const { lines, eols } = splitLines(text);
  const kinds = classifyLines(lines);
  const want = new Set(o.kinds);
  let count = 0;
  const out = lines.map((line, i) => {
    if (!want.has(kinds[i]!)) return line;
    let n = 0;
    c.re.lastIndex = 0;
    let pos = 0;
    let made = '';
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(line)) !== null) {
      if (m[0] === '') {
        c.re.lastIndex++;
        continue;
      }
      const id = `${i + 1}:${n++}`;
      made += line.slice(pos, m.index);
      if (ids === null || ids.has(id)) {
        made += replacementOf(m, o.replace, o.regex);
        count++;
      } else made += m[0];
      pos = m.index + m[0].length;
    }
    return pos === 0 && made === '' ? line : made + line.slice(pos);
  });
  return { text: out.map((l, i) => l + eols[i]).join(''), count };
}

/** The new name of a page whose name matches (the first match only if it is not a regular expression with `g` in mind: all of them), or null. */
export function matchName(name: string, o: ReplaceOptions): string | null {
  const c = compileFind(o);
  if (!c || 'error' in c) return null;
  c.re.lastIndex = 0;
  if (!c.re.test(name)) return null;
  c.re.lastIndex = 0;
  let out = '';
  let pos = 0;
  let m: RegExpExecArray | null;
  c.re.lastIndex = 0;
  while ((m = c.re.exec(name)) !== null) {
    if (m[0] === '') {
      c.re.lastIndex++;
      continue;
    }
    out += name.slice(pos, m.index) + replacementOf(m, o.replace, o.regex);
    pos = m.index + m[0].length;
  }
  const next = out + name.slice(pos);
  return next === name ? null : next;
}
