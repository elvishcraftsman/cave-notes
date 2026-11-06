import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** A link the user may want to follow, found at a document position. */
export interface FollowableLink {
  syntax: 'md' | 'wiki';
  /** wikilink: the page name or path; markdown: the destination as written */
  target: string;
  fragment: string | null;
  text: string | null;
  from: number;
  to: number;
}

const WIKILINK = /(!?)\[\[([^[\]\n]+)\]\]/g;

/** Is this wikilink (the text between the brackets) written as a button: `Page|=Label`? */
export const isButtonWikilink = (inner: string): boolean => /\|\s*=/.test(inner);

export function parseWikiInner(inner: string): { target: string; fragment: string | null; alias: string | null } {
  const pipe = inner.indexOf('|');
  const head = pipe < 0 ? inner : inner.slice(0, pipe);
  let alias = pipe < 0 ? null : inner.slice(pipe + 1).trim() || null;
  // `[[Page|=Label]]` is a link drawn as a button; the label is what follows the `=`
  if (alias !== null && alias.startsWith('=')) alias = alias.slice(1).trim() || null;
  const hash = head.indexOf('#');
  return {
    target: (hash < 0 ? head : head.slice(0, hash)).trim(),
    fragment: hash < 0 ? null : head.slice(hash + 1).trim() || null,
    alias,
  };
}

/** The link at `pos` (a Markdown link, image, autolink, bare URL or wikilink), or null. */
export function linkAt(state: EditorState, pos: number): FollowableLink | null {
  const doc = state.doc;
  const line = doc.lineAt(pos);

  // Wikilinks (outside code)
  WIKILINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  const text = line.text;
  while ((m = WIKILINK.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos < from || pos > to) continue;
    for (let n = syntaxTree(state).resolveInner(from + 1, 1) as { name: string; parent: unknown } | null; n; n = n.parent as typeof n) {
      if (['InlineCode', 'FencedCode', 'CodeBlock', 'Frontmatter'].includes(n.name)) return null;
    }
    const w = parseWikiInner(m[2] ?? '');
    return { syntax: 'wiki', target: w.target, fragment: w.fragment, text: w.alias, from, to };
  }

  // Markdown links and URLs
  for (let n = syntaxTree(state).resolveInner(pos, 1) as { name: string; from: number; to: number; parent: unknown; getChild(n: string): { from: number; to: number } | null; getChildren(n: string): Array<{ from: number; to: number }> } | null; n; n = n.parent as typeof n) {
    if (n.name === 'Link' || n.name === 'Image') {
      const url = n.getChild('URL');
      if (!url) return null;
      const marks = n.getChildren('LinkMark');
      let dest = doc.sliceString(url.from, url.to);
      if (dest.length > 1 && dest.startsWith('<') && dest.endsWith('>')) dest = dest.slice(1, -1);
      const hash = dest.indexOf('#');
      return {
        syntax: 'md',
        target: hash < 0 ? dest : dest.slice(0, hash),
        fragment: hash < 0 ? null : dest.slice(hash + 1) || null,
        // `[=Label](…)` is a link drawn as a button; its label is what follows the `=`
        text: marks[0] && marks[1] ? doc.sliceString(marks[0].to, marks[1].from).replace(/^\s*=\s?/, '') : null,
        from: n.from,
        to: n.to,
      };
    }
    if (n.name === 'URL' || n.name === 'Autolink') {
      const url = n.name === 'URL' ? n : n.getChild('URL');
      if (!url) return null;
      return { syntax: 'md', target: doc.sliceString(url.from, url.to), fragment: null, text: null, from: n.from, to: n.to };
    }
  }
  return null;
}
