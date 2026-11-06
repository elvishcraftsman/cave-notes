/**
 * Colours for YAML, as a list of ranges: a small line-by-line reader, not a full YAML parser. It is used for the frontmatter of a
 * page, for ```view and ```yaml blocks and for the YAML boxes of Preferences, and it knows the extras Cave Notes puts into YAML
 * (`${expressions}`, `$now`, `[[links]]`, `!Name` shortcodes), so a half-typed or wrong line still gets sensible colours.
 */
export type YamlTokenClass = 'key' | 'comment' | 'string' | 'number' | 'bool' | 'punct' | 'expr' | 'tag' | 'link';

export interface YamlToken {
  from: number;
  to: number;
  cls: YamlTokenClass;
}

const KEY = /^(\s*(?:-\s+)*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"[\]{},&*!|>%@`:-][^#:]*?|-[^\s#:][^#:]*?)(\s*:)(?=\s|$)/;
const DASHES = /^(\s*)((?:-(?=\s|$)\s*)+)/;
const VALUE = new RegExp(
  [
    `("(?:[^"\\\\]|\\\\.)*"?|'(?:[^']|'')*'?)`, // 1 quoted text
    `(\\$\\{[^}]*\\}?)`, // 2 ${expression}
    `(\\[\\[[^\\]]*\\]\\])`, // 3 [[link]]
    `(\\$[A-Za-z_][\\w.]*(?:[+-]\\d+[dwmy])?)`, // 4 $now, $this, $today+7d
    `(![\\w-]*|[&*][\\w-]+)`, // 5 tag, shortcode or anchor
    `(-?\\d{4}-\\d{1,2}-\\d{1,2}(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?(?![\\w-]))`, // 6 date
    `(-?\\d+(?:\\.\\d+)?(?![\\w.-]))`, // 7 number
    `((?<![\\w-])(?:true|false|yes|no|null)(?![\\w-])|~)`, // 8 true, false, null
    `([[\\]{},])`, // 9 flow marks
  ].join('|'),
  'gi',
);
const CLASSES: YamlTokenClass[] = ['string', 'expr', 'link', 'expr', 'tag', 'number', 'number', 'bool', 'punct'];

/** Where a `#` comment starts in a line (outside quotes, after a space or at the start), or -1. */
function commentAt(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && (i === 0 || /[\s:,[{-]/.test(line[i - 1]!))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return i;
  }
  return -1;
}

/** The coloured ranges of a piece of YAML, with offsets into `text`. */
export function yamlTokens(text: string): YamlToken[] {
  const out: YamlToken[] = [];
  let pos = 0;
  let block = -1; // the indent of the line that opened a `|` or `>` text; the lines under it are plain text
  for (const line of text.split('\n')) {
    const at = pos;
    pos += line.length + 1;
    const indent = /^\s*/.exec(line)![0].length;
    if (block >= 0) {
      if (line.trim() === '' || indent > block) {
        if (line.trim() !== '') out.push({ from: at + indent, to: at + line.length, cls: 'string' });
        continue;
      }
      block = -1;
    }
    const hash = commentAt(line);
    const code = hash >= 0 ? line.slice(0, hash) : line;
    let col = 0;
    const key = KEY.exec(code);
    if (key) {
      const lead = key[1]!.length;
      for (const d of key[1]!.matchAll(/-/g)) out.push({ from: at + d.index!, to: at + d.index! + 1, cls: 'punct' });
      out.push({ from: at + lead, to: at + lead + key[2]!.length, cls: 'key' });
      const colon = lead + key[2]!.length + key[3]!.indexOf(':');
      out.push({ from: at + colon, to: at + colon + 1, cls: 'punct' });
      col = lead + key[2]!.length + key[3]!.length;
    } else {
      const d = DASHES.exec(code);
      if (d) {
        for (const m of d[2]!.matchAll(/-/g)) out.push({ from: at + d[1]!.length + m.index!, to: at + d[1]!.length + m.index! + 1, cls: 'punct' });
        col = d[0].length;
      }
    }
    const rest = code.slice(col);
    const opens = /^\s*[|>][+-]?\d?\s*$/.test(rest);
    if (opens) {
      out.push({ from: at + col + rest.search(/[|>]/), to: at + col + rest.search(/[|>]/) + 1, cls: 'punct' });
      block = indent;
    } else {
      VALUE.lastIndex = 0;
      for (let m = VALUE.exec(rest); m; m = VALUE.exec(rest)) {
        const g = m.slice(1).findIndex((x) => x !== undefined);
        out.push({ from: at + col + m.index, to: at + col + m.index + m[0].length, cls: CLASSES[g]! });
        if (m[0].length === 0) VALUE.lastIndex++;
      }
      // plain text that is neither: left in the default colour
    }
    if (hash >= 0) out.push({ from: at + hash, to: at + line.length, cls: 'comment' });
  }
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}
