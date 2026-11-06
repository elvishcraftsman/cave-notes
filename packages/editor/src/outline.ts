import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface OutlineItem {
  level: number;
  text: string;
  /** GitHub-style anchor, identical to the slugs core-md produces (so [[Page#Heading]] links match) */
  slug: string;
  /** document offset of the start of the heading line */
  from: number;
  line: number;
  /** "list" for a numbered-list item (only when asked for); a heading has no `kind` */
  kind?: 'list';
  /** the item's number as written ("3."), for a list item */
  marker?: string;
}

export interface OutlineOptions {
  /** also list the items of numbered lists, below the heading they sit under (default false) */
  orderedLists?: boolean;
}

export const isHeading = (item: OutlineItem): boolean => item.kind !== 'list';

/** "Hello, World!" -> "hello-world" */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
  return s === '' ? 'section' : s;
}

/** Remove the markup a heading's text would not show once rendered. */
function plain(text: string): string {
  return text
    .replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Headings of the document, from the live syntax tree (no re-parse, updates as you type). */
export function extractOutline(state: EditorState, options: OutlineOptions = {}): OutlineItem[] {
  const out: OutlineItem[] = [];
  const seen = new Map<string, number>();
  const doc = state.doc;
  let headingLevel = 0;
  // syntaxTree() is only parsed as far as the viewport/time budget reached, which drops headings late in a
  // long file; ask for the whole document (bounded, so a huge file cannot freeze typing)
  const tree = ensureSyntaxTree(state, doc.length, 1500) ?? syntaxTree(state);
  tree.iterate({
    enter: (ref) => {
      if (ref.name === 'Frontmatter' || ref.name === 'FencedCode' || ref.name === 'CodeBlock') return false;
      if (options.orderedLists && ref.name === 'ListItem' && ref.node.parent?.name === 'OrderedList') {
        const mark = ref.node.getChild('ListMark');
        if (mark) {
          let depth = 0;
          for (let p: typeof ref.node | null = ref.node.parent; p; p = p.parent) if (p.name === 'ListItem') depth++;
          const line = doc.lineAt(mark.from);
          const text = plain(doc.sliceString(mark.to, line.to).replace(/^\s*\[[ xX]\]/, ''));
          if (text) out.push({ level: headingLevel + 1 + depth, text, slug: '', from: line.from, line: line.number, kind: 'list', marker: doc.sliceString(mark.from, mark.to) });
        }
        return; // keep going: its nested lists are items too
      }
      let level = 0;
      let raw = '';
      const atx = /^ATXHeading([1-6])$/.exec(ref.name);
      const setext = /^SetextHeading([12])$/.exec(ref.name);
      if (atx) {
        level = Number(atx[1]);
        raw = doc.sliceString(ref.from, ref.to).replace(/^#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '');
      } else if (setext) {
        level = Number(setext[1]);
        raw = doc.sliceString(ref.from, ref.to).split(/\r?\n/)[0] ?? '';
      } else return;
      const text = plain(raw);
      const base = slugify(text);
      let slug = base;
      while (seen.has(slug)) {
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        slug = `${base}-${n}`;
      }
      seen.set(slug, 0);
      headingLevel = level;
      out.push({ level, text, slug, from: doc.lineAt(ref.from).from, line: doc.lineAt(ref.from).number });
      return false;
    },
  });
  return out;
}

/** The heading with this slug (or matching text, case-insensitively), for [[Page#Heading]] navigation. */
export function findHeading(items: OutlineItem[], fragment: string): OutlineItem | undefined {
  const wanted = fragment.trim().replace(/^#/, '');
  const slug = slugify(wanted);
  const headings = items.filter(isHeading);
  return headings.find((h) => h.slug === wanted || h.slug === slug) ?? headings.find((h) => h.text.toLowerCase() === wanted.toLowerCase());
}
