import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { formatMarker, parseMarker } from './listMarkers';
import { insertLink } from './commands';
import { isHierarchical, itemOnLine, listOp, makeHierarchical, parsed, rootListOf } from './lists';

/**
 * What is applied at the selection, and commands that switch it on or off. The context menu is built from these:
 * it highlights `activeFormats` and a click runs `toggleInline` or `toggleBlock`.
 */

export type InlineFormat = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export type BlockFormat =
  | 'paragraph'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'quote'
  | 'bullet' | 'bullet-h'
  | 'decimal' | 'alpha' | 'ALPHA' | 'roman' | 'ROMAN' | 'decimal-h'
  | 'task'
  | 'codeblock';

export interface ActiveFormats {
  inline: Set<InlineFormat>;
  block: Set<BlockFormat>;
}

const INLINE_NODE: Record<InlineFormat, string> = { bold: 'StrongEmphasis', italic: 'Emphasis', strike: 'Strikethrough', code: 'InlineCode', link: 'Link' };
const INLINE_MARK: Record<InlineFormat, string> = { bold: 'EmphasisMark', italic: 'EmphasisMark', strike: 'StrikethroughMark', code: 'CodeMark', link: 'LinkMark' };

/** The innermost node of `format` that contains the whole selection range, if there is one. */
function inlineNodeAt(state: EditorState, format: InlineFormat, from: number, to: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  const name = INLINE_NODE[format];
  for (let n: SyntaxNode | null = tree.resolveInner(from, 1); n; n = n.parent) {
    if (n.name === name && n.from <= from && n.to >= to) return n;
  }
  // a cursor right after the closing mark still counts
  if (from === to) for (let n: SyntaxNode | null = tree.resolveInner(from, -1); n; n = n.parent) if (n.name === name && n.from <= from && n.to >= to) return n;
  return null;
}

const selectedLineNumbers = (state: EditorState): number[] => {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    let b = state.doc.lineAt(r.to).number;
    if (r.to > r.from && state.doc.lineAt(r.to).from === r.to && b > a) b--;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
};

/** Block formats of one line. */
function blockFormatsOfLine(state: EditorState, lineNumber: number): Set<BlockFormat> {
  const out = new Set<BlockFormat>();
  const line = state.doc.line(lineNumber);
  const tree = parsed(state);
  const heading = /^ {0,3}(#{1,6})[ \t]/.exec(line.text);
  if (heading) out.add(`h${heading[1]!.length}` as BlockFormat);
  const lead = /^[ \t]*/.exec(line.text)![0].length;
  for (let n: SyntaxNode | null = tree.resolveInner(line.from + lead, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') out.add('codeblock');
    if (n.name === 'Blockquote') out.add('quote');
  }
  const item = itemOnLine(state, tree, lineNumber);
  if (item) {
    const markNode = item.getChild('ListMark')!;
    const first = item.parent?.getChild('ListItem')?.getChild('ListMark');
    const root = rootListOf(item);
    const hier = root ? isHierarchical(state, root) : false;
    const isTask = !!item.getChild('Task');
    if (isTask) out.add('task'); // a task list is its own kind of list, not also a bulleted one
    if (item.parent?.name === 'BulletList') {
      if (!isTask) {
        out.add('bullet');
        if (hier) out.add('bullet-h');
      }
    } else {
      const hint = first ? parseMarker(state.doc.sliceString(first.from, first.to))?.kind : undefined;
      const mk = parseMarker(state.doc.sliceString(markNode.from, markNode.to), hint);
      if (mk) {
        out.add(mk.kind === 'num' ? 'decimal' : mk.kind === 'alpha' ? (mk.upper ? 'ALPHA' : 'alpha') : mk.upper ? 'ROMAN' : 'roman');
        if (hier) out.add('decimal-h');
      }
    }
  }
  if (out.size === 0 && line.text.trim() !== '') out.add('paragraph');
  return out;
}

/** Formats that apply to all of what is selected. */
export function activeFormats(state: EditorState): ActiveFormats {
  const inline = new Set<InlineFormat>();
  const main = state.selection.main;
  for (const f of Object.keys(INLINE_NODE) as InlineFormat[]) if (inlineNodeAt(state, f, main.from, main.to)) inline.add(f);
  let block = null as Set<BlockFormat> | null;
  for (const n of selectedLineNumbers(state)) {
    if (state.doc.line(n).text.trim() === '' && selectedLineNumbers(state).length > 1) continue;
    const here = blockFormatsOfLine(state, n);
    block = block === null ? here : new Set([...block].filter((b) => here.has(b)));
  }
  return { inline, block: block ?? new Set() };
}

// ---------------------------------------------------------------- inline

const WRAP: Record<'bold' | 'italic' | 'strike' | 'code', string> = { bold: '**', italic: '*', strike: '~~', code: '`' };

/** Word around a cursor (letters, digits, apostrophes and hyphens inside it), or null. */
function wordAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const isWord = (c: string): boolean => /[\p{L}\p{N}_'\u2019]/u.test(c);
  let a = pos;
  let b = pos;
  while (a > line.from && isWord(state.doc.sliceString(a - 1, a))) a--;
  while (b < line.to && isWord(state.doc.sliceString(b, b + 1))) b++;
  return a < b ? { from: a, to: b } : null;
}

/** Turn an inline format on or off for the selection (or the word at the cursor). */
export function toggleInline(view: EditorView, format: InlineFormat): boolean {
  const { state } = view;
  const main = state.selection.main;
  const node = inlineNodeAt(state, format, main.from, main.to);
  if (node) {
    if (format === 'link') {
      // keep the text, drop the brackets and destination
      const marks = node.getChildren('LinkMark');
      const open = marks[0];
      const close = marks[1];
      if (!open || !close) return false;
      view.dispatch({ changes: [{ from: open.from, to: open.to }, { from: close.from, to: node.to }], userEvent: 'delete.format', scrollIntoView: true });
      return true;
    }
    const marks = node.getChildren(INLINE_MARK[format]);
    if (marks.length < 2) return false;
    const first = marks[0]!;
    const last = marks[marks.length - 1]!;
    view.dispatch({ changes: [{ from: first.from, to: first.to }, { from: last.from, to: last.to }], userEvent: 'delete.format', scrollIntoView: true });
    return true;
  }
  if (format === 'link') {
    if (main.empty) {
      const w = wordAround(state, main.head);
      if (w) view.dispatch({ selection: EditorSelection.range(w.from, w.to) });
    }
    return insertLink(view);
  }
  const marker = WRAP[format];
  let { from, to } = main;
  if (main.empty) {
    const w = wordAround(state, main.head);
    if (w) ({ from, to } = w);
  }
  if (from === to) {
    view.dispatch({ changes: { from, insert: marker + marker }, selection: { anchor: from + marker.length }, userEvent: 'input.format', scrollIntoView: true });
  } else {
    view.dispatch({
      changes: [{ from, insert: marker }, { from: to, insert: marker }],
      selection: EditorSelection.range(from + marker.length, to + marker.length),
      userEvent: 'input.format',
      scrollIntoView: true,
    });
  }
  return true;
}

// ---------------------------------------------------------------- blocks

const LIST_PREFIX = /^([ \t]*)(?:(?:[-*+]|\d{1,9}[.)]|[A-Za-z]{1,8}[.)])(?:[ \t]+\[[ xX]\])?[ \t]+)/;

interface Plain {
  indent: string;
  text: string;
}

/** A line with heading, quote and list marks taken off (keeping the indent of a list item). */
function plainOf(state: EditorState, lineNumber: number): Plain {
  const line = state.doc.line(lineNumber);
  let text = line.text;
  let indent = '';
  const h = /^ {0,3}#{1,6}[ \t]+/.exec(text);
  if (h) text = text.slice(h[0].length);
  const q = /^[ \t]*(?:>[ \t]?)+/.exec(text);
  if (q) text = text.slice(q[0].length);
  if (itemOnLine(state, parsed(state), lineNumber)) {
    const m = LIST_PREFIX.exec(text);
    if (m) {
      indent = m[1]!;
      text = text.slice(m[0].length);
    }
  }
  return { indent, text };
}

type ListKind = 'bullet' | 'decimal' | 'alpha' | 'ALPHA' | 'roman' | 'ROMAN' | 'task';

const markerFor = (kind: ListKind, n: number): string =>
  kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${formatMarker(kind === 'decimal' ? 'num' : kind === 'alpha' || kind === 'ALPHA' ? 'alpha' : 'roman', kind === 'ALPHA' || kind === 'ROMAN', n, '.')} `;

/**
 * Make the selected lines a list of `kind`, or take them out of one when they all are one already.
 * Items keep their indentation, and numbered kinds count up per level.
 */
function toggleList(view: EditorView, kind: ListKind): boolean {
  const { state } = view;
  const lines = selectedLineNumbers(state).filter((n) => state.doc.line(n).text.trim() !== '');
  if (lines.length === 0) {
    // an empty line: start a list
    const ln = state.doc.lineAt(state.selection.main.head);
    const ins = markerFor(kind, 1);
    view.dispatch({ changes: { from: ln.to, insert: ins }, selection: { anchor: ln.to + ins.length }, userEvent: 'input.format', annotations: listOp.of(true) });
    return true;
  }
  const already = lines.every((n) => blockFormatsOfLine(state, n).has(kind === 'task' ? 'task' : kind));
  const changes: ChangeSpec[] = [];
  const counters = new Map<number, number>();
  for (const n of lines) {
    const line = state.doc.line(n);
    const p = plainOf(state, n);
    const wasItem = itemOnLine(state, parsed(state), n) !== null;
    const indent = wasItem ? p.indent : '';
    if (already) {
      changes.push({ from: line.from, to: line.to, insert: p.text });
      continue;
    }
    const depth = indent.length;
    for (const key of [...counters.keys()]) if (key > depth) counters.delete(key);
    const count = (counters.get(depth) ?? 0) + 1;
    counters.set(depth, count);
    changes.push({ from: line.from, to: line.to, insert: indent + markerFor(kind, count) + p.text });
  }
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true, annotations: listOp.of(true) });
  return true;
}

/** Add `prefix` to every selected line, or take it off when they all have it. */
function toggleQuote(view: EditorView): boolean {
  const { state } = view;
  const lines = selectedLineNumbers(state);
  const real = lines.filter((n) => state.doc.line(n).text.trim() !== '');
  const quoted = real.length > 0 && real.every((n) => /^[ \t]*>/.test(state.doc.line(n).text));
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    if (quoted) {
      const m = /^([ \t]*)>[ \t]?/.exec(line.text);
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: m[1]! });
    } else if (line.text.trim() !== '' || lines.length === 1) {
      changes.push({ from: line.from, insert: '> ' });
    }
  }
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  return true;
}

function setHeading(view: EditorView, level: number): boolean {
  const { state } = view;
  const lines = selectedLineNumbers(state);
  const real = lines.filter((n) => state.doc.line(n).text.trim() !== '');
  const has = real.length > 0 && real.every((n) => blockFormatsOfLine(state, n).has(`h${level}` as BlockFormat));
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    const m = /^ {0,3}#{1,6}[ \t]+/.exec(line.text);
    const body = m ? line.text.slice(m[0].length) : line.text;
    const prefix = has ? '' : '#'.repeat(level) + ' ';
    if (line.text.trim() === '' && lines.length > 1) continue;
    changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix });
    void body;
  }
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  return true;
}

function toggleCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const tree = syntaxTree(state);
  const head = state.selection.main.head;
  for (let n: SyntaxNode | null = tree.resolveInner(head, -1); n; n = n.parent) {
    if (n.name === 'FencedCode') {
      const first = state.doc.lineAt(n.from);
      const last = state.doc.lineAt(Math.max(n.from, n.to - 1));
      const changes: ChangeSpec[] = [{ from: first.from, to: Math.min(state.doc.length, first.to + 1) }];
      if (last.number !== first.number && /^\s*(```|~~~)/.test(last.text)) changes.push({ from: Math.max(first.to + 1, last.from - 1), to: last.to });
      view.dispatch({ changes, userEvent: 'delete.format', scrollIntoView: true });
      return true;
    }
  }
  const lines = selectedLineNumbers(state);
  const a = state.doc.line(lines[0]!);
  const b = state.doc.line(lines[lines.length - 1]!);
  view.dispatch({
    changes: [{ from: a.from, insert: '```\n' }, { from: b.to, insert: '\n```' }],
    selection: { anchor: a.from + 4 },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  return true;
}

/** Switch a block format on or off for the selected lines. */
export function toggleBlock(view: EditorView, format: BlockFormat): boolean {
  switch (format) {
    case 'paragraph': {
      const { state } = view;
      const changes: ChangeSpec[] = [];
      for (const n of selectedLineNumbers(state)) {
        const line = state.doc.line(n);
        if (line.text.trim() === '') continue;
        const p = plainOf(state, n);
        changes.push({ from: line.from, to: line.to, insert: p.text });
      }
      view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true, annotations: listOp.of(true) });
      return true;
    }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return setHeading(view, Number(format[1]));
    case 'quote':
      return toggleQuote(view);
    case 'codeblock':
      return toggleCodeBlock(view);
    case 'bullet': case 'decimal': case 'alpha': case 'ALPHA': case 'roman': case 'ROMAN': case 'task':
      return toggleList(view, format);
    case 'bullet-h':
    case 'decimal-h': {
      const kind: ListKind = format === 'bullet-h' ? 'bullet' : 'decimal';
      const have = activeFormats(view.state).block;
      if (!have.has(kind)) toggleList(view, kind);

      // already hierarchical: switch it off by giving every level the plain marker again
      return makeHierarchical(view, have.has(format));
    }
  }
}
