import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { shadowInput } from './listMarkers';
import type { Extension } from '@codemirror/state';
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';

const CLOSING = /^(---|\.\.\.)[ \t]*$/m;

/**
 * Leading YAML frontmatter ("---" ... "---" at the very top) becomes one Frontmatter node, so its
 * lines are not mistaken for a thematic break and a setext heading.
 */
const Frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, ln: Line): boolean {
        if (cx.lineStart !== 0 || ln.text.trimEnd() !== '---') return false;
        // @lezer/markdown does not expose the document text on BlockContext, but it is there at runtime.
        const input = (cx as unknown as { input?: { read(from: number, to: number): string; length: number } }).input;
        if (!input) return false;
        const rest = input.read(cx.lineStart + ln.text.length, Math.min(input.length, cx.lineStart + 200_000));
        if (!CLOSING.test(rest.replace(/^\r?\n/, ''))) return false; // unclosed: just a thematic break
        const start = cx.lineStart;
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)[ \t]*$/.test(ln.text)) {
            const end = cx.lineStart + ln.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('Frontmatter', start, cx.lineStart));
        return true;
      },
    },
  ],
};

const TITLE_TAIL = /^\S+\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\))$/;

/**
 * `[text](Some folder/file.png)`: a destination with spaces is no link in CommonMark, but it is how a path is
 * written by hand, so it is read as one (an image with a leading `!`). `<angle>` destinations and ones with a
 * title are left to the standard parser. The label is taken as plain text.
 */
const SpacedDestination: MarkdownConfig = {
  parseInline: [
    {
      name: 'SpacedDestination',
      before: 'Link',
      parse(cx: InlineContext, next: number, pos: number): number {
        const image = next === 33 && cx.char(pos + 1) === 91;
        if (next !== 91 && !image) return -1;
        const open = image ? pos + 1 : pos;
        const text = cx.slice(open, cx.end);
        let depth = 0;
        let close = -1;
        for (let i = 0; i < text.length && text[i] !== '\n'; i++) {
          const ch = text[i];
          if (ch === '\\') i++;
          else if (ch === '[') depth++;
          else if (ch === ']' && --depth === 0) {
            close = i;
            break;
          }
        }
        if (close < 0 || text[close + 1] !== '(') return -1;
        let paren = 0;
        let end = -1;
        for (let i = close + 2; i < text.length && text[i] !== '\n'; i++) {
          const ch = text[i];
          if (ch === '\\') i++;
          else if (ch === '(') paren++;
          else if (ch === ')') {
            if (paren === 0) {
              end = i;
              break;
            }
            paren--;
          }
        }
        if (end < 0) return -1;
        const inner = text.slice(close + 2, end);
        const trimmed = inner.trim();
        if (!trimmed.includes(' ') || trimmed.startsWith('<') || TITLE_TAIL.test(trimmed)) return -1;
        const urlFrom = open + close + 2 + (inner.length - inner.trimStart().length);
        const urlTo = urlFrom + trimmed.length;
        return cx.addElement(
          cx.elt(image ? 'Image' : 'Link', pos, open + end + 1, [
            cx.elt('LinkMark', pos, open + 1),
            cx.elt('LinkMark', open + close, open + close + 1),
            cx.elt('LinkMark', open + close + 1, open + close + 2),
            cx.elt('URL', urlFrom, urlTo),
            cx.elt('LinkMark', open + end, open + end + 1),
          ]),
        );
      },
    },
  ],
};

/** GitHub-flavoured Markdown plus frontmatter. */
export function markdownSupport(): Extension {
  const support = markdown({ base: markdownLanguage, extensions: [Frontmatter, SpacedDestination], addKeymap: true });
  // Lettered and Roman list markers: the parser is shown them as numbers of the same width (see listMarkers.ts).
  const parser = support.language.parser as unknown as { createParse(input: never, ...rest: never[]): unknown };
  const create = parser.createParse.bind(parser) as (...a: unknown[]) => unknown;
  parser.createParse = ((input: never, ...rest: never[]) => create(shadowInput(input), ...rest)) as typeof parser.createParse;
  return support;
}
