import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Annotation, ChangeSet, EditorSelection, EditorState, Facet, Prec, Transaction, type ChangeSpec, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { formatMarker, parseMarker, type Marker } from './listMarkers';

/**
 * Lists that look after themselves.
 *
 *  - Tab / Shift-Tab move a list item to the next or the previous nesting level; the items nested under it stay where they are. A
 *    nested item has to start under the text of the item above it, which is 2 columns for "- " but 3 for "1. " (4 for
 *    "10. "), so the step depends on the item above. Indenting and outdenting move by the same amount, and what
 *    is typed is always read as a nested item, in this editor and in any other Markdown program.
 *  - Alt-Up / Alt-Down move a list item, with its sub-items, past its neighbour.
 *  - Numbered lists are renumbered when an edit changes their structure: items added, removed, moved,
 *    indented or outdented.
 */

/** Marks a transaction made by one of the list commands, which always renumber. */
export const listOp = Annotation.define<boolean>();
/** Marks a transaction that sets list styles itself, which the hierarchy must not put back. */
const styled = Annotation.define<boolean>();

export const parsed = (state: EditorState): Tree => ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);

interface ItemInfo {
  /** column of the marker */
  markCol: number;
  /** column where the item's text starts (what a nested item has to line up with) */
  contentCol: number;
}

function infoOf(state: EditorState, item: SyntaxNode): ItemInfo {
  const doc = state.doc;
  const mark = item.getChild('ListMark')!;
  const line = doc.lineAt(mark.from);
  let end = mark.to;
  while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++;
  const markCol = mark.from - line.from;
  // an empty item ("1. " with nothing after it) still has its text start one space after the marker
  const contentCol = end === mark.to ? markCol + (mark.to - mark.from) + 1 : Math.min(end - line.from, markCol + (mark.to - mark.from) + 4);
  return { markCol, contentCol };
}

/** The innermost list item the text of `lineNumber` belongs to. */
export function itemOnLine(state: EditorState, tree: Tree, lineNumber: number): SyntaxNode | null {
  const line = state.doc.line(lineNumber);
  if (line.text.trim() === '') return null;
  const lead = /^[ \t]*/.exec(line.text)![0].length;
  let node: SyntaxNode | null = tree.resolveInner(line.from + lead, 1);
  while (node && node.name !== 'ListItem') node = node.parent;
  return node;
}

/** The list items touched by the selection. */
function selectedItems(state: EditorState): SyntaxNode[] {
  const tree = parsed(state);
  const found = new Map<number, SyntaxNode>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    if (r.to > r.from && state.doc.lineAt(r.to).from === r.to) last--; // a selection that ends at the start of a line leaves that line out
    for (let n = first; n <= Math.max(first, last); n++) {
      const item = itemOnLine(state, tree, n);
      if (item) found.set(item.from, item);
    }
  }
  return [...found.values()];
}

/**
 * First and last line of an item's own text, without the lists nested under it: Tab and Shift-Tab move only these lines,
 * so the children keep their place.
 */
export function ownSpan(state: EditorState, item: SyntaxNode): [number, number] {
  const [a, b] = lineSpan(state, item);
  const child = item.getChildren('BulletList').concat(item.getChildren('OrderedList'))[0];
  if (!child) return [a, b];
  return [a, Math.max(a, Math.min(b, state.doc.lineAt(child.from).number - 1))];
}

/** First and last line number of an item, with everything under it. */
export function lineSpan(state: EditorState, item: SyntaxNode): [number, number] {
  return [state.doc.lineAt(item.from).number, state.doc.lineAt(item.to).number];
}

const sibling = (item: SyntaxNode, dir: -1 | 1): SyntaxNode | null => {
  const s = dir < 0 ? item.prevSibling : item.nextSibling;
  return s?.name === 'ListItem' ? s : null;
};

/** Change the leading space of `line` by `delta` columns (spaces added, or taken away as far as there are any). */
function pushShift(changes: ChangeSpec[], line: { from: number; text: string }, delta: number): void {
  if (delta === 0 || line.text.trim() === '') return;
  if (delta > 0) changes.push({ from: line.from, insert: ' '.repeat(delta) });
  else {
    const k = Math.min(-delta, /^ */.exec(line.text)![0].length);
    if (k > 0) changes.push({ from: line.from, to: line.from + k });
  }
}

// ---------------------------------------------------------------- indent and outdent

/** An item the selection moves: with the lists under it too when some of those are selected as well. */
interface Mover {
  item: SyntaxNode;
  whole: boolean;
}

/**
 * The items Tab and Shift-Tab move: those the selection touches, except the ones that are under another selected item (they
 * go along with it, as a block, so the levels inside keep their order).
 */
function movers(state: EditorState): Mover[] {
  const items = selectedItems(state);
  const chosen = new Set(items.map((i) => i.from));
  const under = (it: SyntaxNode): boolean => {
    for (let p = it.parent; p; p = p.parent) if (p.name === 'ListItem' && chosen.has(p.from)) return true;
    return false;
  };
  return items
    .filter((i) => !under(i))
    .map((item) => ({ item, whole: items.some((o) => o !== item && o.from >= item.from && o.to <= item.to) }));
}

const spanOf = (state: EditorState, m: Mover): [number, number] => (m.whole ? lineSpan(state, m.item) : ownSpan(state, m.item));

/** Selected items that are neighbours in the same list move together: one group. */
function groupsOf(ms: Mover[]): Mover[][] {
  const groups: Mover[][] = [];
  for (const m of ms) {
    const g = groups[groups.length - 1];
    if (g && sibling(g[g.length - 1]!.item, 1)?.from === m.item.from) g.push(m);
    else groups.push([m]);
  }
  return groups;
}

/**
 * How far a group is moved by Tab: under the item above it, or, when it has none (the first item of a list), one step further
 * in by the width of its own marker. Null when it cannot move (it would be as deep as a code block).
 */
function indentStep(state: EditorState, group: Mover[]): { delta: number; under: SyntaxNode | null } | null {
  const first = group[0]!.item;
  const prev = sibling(first, -1);
  const mine = infoOf(state, first);
  if (prev) {
    const delta = infoOf(state, prev).contentCol - mine.markCol;
    return delta > 0 ? { delta, under: prev } : null;
  }
  const parent = first.parent?.parent;
  if (parent?.name !== 'ListItem') return null; // the first item of the whole list stays at the left
  const limit = infoOf(state, parent).contentCol + 3;
  const delta = mine.contentCol - mine.markCol;
  return mine.markCol + delta <= limit ? { delta, under: null } : null;
}

/**
 * Tab: move the items one level in, under the item above them. Items selected together move as one group, with what is
 * selected under them. The first item of a list has nothing above it: it, and the items selected with it, move in by the
 * width of a marker instead.
 */
export function indentListItems(view: EditorView): boolean {
  const { state } = view;
  const ms = movers(state);
  if (ms.length === 0) return false;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  for (const group of groupsOf(ms)) {
    const step = indentStep(state, group);
    if (!step) continue;
    group.forEach((m, k) => {
      const [a, b] = spanOf(state, m);
      for (let n = a; n <= b; n++) {
        const ln = doc.line(n);
        if (ln.text.trim() !== '') changes.push({ from: ln.from, insert: ' '.repeat(step.delta) });
      }
      // an item that starts a new nested numbered list starts it at 1 (or a, or i)
      if (k === 0 && step.under && m.item.parent?.name === 'OrderedList' && step.under.lastChild?.name !== 'OrderedList') {
        const mark = m.item.getChild('ListMark')!;
        const text = doc.sliceString(mark.from, mark.to);
        const mk = parseMarker(text);
        if (mk && mk.value !== 1) {
          const first = formatMarker(mk.kind, mk.upper, 1, mk.delim);
          changes.push({ from: mark.from, to: mark.to, insert: first });
          // the rest of the item's own text keeps up with its (now narrower) marker
          for (let n = a + 1; n <= b; n++) pushShift(changes, doc.line(n), first.length - text.length);
        }
      }
    });
  }
  if (changes.length > 0) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.indent', annotations: listOp.of(true) });
  return true;
}

/** Whether Tab would move anything. */
export function canIndentListItems(state: EditorState): boolean {
  return groupsOf(movers(state)).some((g) => indentStep(state, g) !== null);
}

/** Whether Shift-Tab would move anything: some selected item is nested under another. */
export function canOutdentListItems(state: EditorState): boolean {
  return movers(state).some(({ item }) => {
    const parent = item.parent?.parent;
    return parent?.name === 'ListItem' && infoOf(state, item).markCol - infoOf(state, parent).markCol > 0;
  });
}

/** Shift-Tab: move the items one level out, to line up with the item they are under. False when none is nested. */
export function outdentListItems(view: EditorView): boolean {
  const { state } = view;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  let any = false;
  for (const m of movers(state)) {
    const parent = m.item.parent?.parent;
    if (parent?.name !== 'ListItem') continue;
    const delta = infoOf(state, m.item).markCol - infoOf(state, parent).markCol;
    if (delta <= 0) continue;
    any = true;
    const [a, b] = spanOf(state, m);
    for (let n = a; n <= b; n++) {
      const ln = doc.line(n);
      const k = Math.min(delta, /^ */.exec(ln.text)![0].length);
      if (k > 0) changes.push({ from: ln.from, to: ln.from + k });
    }
  }
  if (!any) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'delete.dedent', annotations: listOp.of(true) });
  return true;
}

// ---------------------------------------------------------------- moving items

/** Alt-Up / Alt-Down: swap the item under the cursor, with its sub-items, with the one above or below it; at the edge of its level it moves past the next line instead. */
export const moveListItem =
  (dir: -1 | 1) =>
  (view: EditorView): boolean => {
    const { state } = view;
    const doc = state.doc;
    const sel = state.selection.main;
    const item = itemOnLine(state, parsed(state), doc.lineAt(sel.head).number);
    if (!item) return false; // not in a list: the ordinary line move
    const other = sibling(item, dir);
    const [xa, xb] = lineSpan(state, item);
    // With a neighbour at its own level the item swaps with that one (and its sub-items). At the first or last place of its
    // level it keeps going: it moves past the one line next to it, whatever that line is, and keeps its indent.
    const [ya, yb] = other ? lineSpan(state, other) : dir < 0 ? [xa - 1, xa - 1] : [xb + 1, xb + 1];
    if (ya < 1 || yb > doc.lines) return true; // the top or the bottom of the document
    const x0 = doc.line(xa).from;
    const x1 = doc.line(xb).to;
    const y0 = doc.line(ya).from;
    const y1 = doc.line(yb).to;
    const xText = doc.sliceString(x0, x1);
    const yText = doc.sliceString(y0, y1);
    const newX0 = dir < 0 ? y0 : x0 + yText.length + (y0 - x1);
    const place = (p: number): number => newX0 + Math.max(0, Math.min(xText.length, p - x0));
    view.dispatch({
      changes: [
        { from: x0, to: x1, insert: yText },
        { from: y0, to: y1, insert: xText },
      ],
      selection: { anchor: place(sel.anchor), head: place(sel.head) },
      scrollIntoView: true,
      userEvent: 'move.line',
      annotations: listOp.of(true),
    });
    return true;
  };

// ---------------------------------------------------------------- renumbering

// ---------------------------------------------------------------- hierarchical lists

export interface ListConfig {
  /** Marker style of each nesting level of a hierarchical numbered list, e.g. ["1.", "a.", "i."]; levels beyond repeat. */
  orderedStyles: string[];
  /** The bullet drawn at each level of a hierarchical bulleted list; levels beyond repeat. */
  bulletGlyphs: string[];
  /** Nested lists take the style of their level without asking (otherwise only lists made hierarchical do). */
  hierarchicalDefault: boolean;
}

export const DEFAULT_LIST_CONFIG: ListConfig = { orderedStyles: ['1.', 'a.', 'i.'], bulletGlyphs: ['\u2022', '\u25E6', '\u25AA'], hierarchicalDefault: false };

export const listConfig = Facet.define<Partial<ListConfig>, ListConfig>({
  combine: (values) => {
    const out: ListConfig = { ...DEFAULT_LIST_CONFIG };
    for (const v of values) {
      if (v.orderedStyles?.length) out.orderedStyles = v.orderedStyles;
      if (v.bulletGlyphs?.length) out.bulletGlyphs = v.bulletGlyphs;
      if (v.hierarchicalDefault !== undefined) out.hierarchicalDefault = v.hierarchicalDefault;
    }
    return out;
  },
});

/** The Markdown characters a hierarchical bulleted list cycles through, one per level. */
export const BULLET_CYCLE = ['-', '*', '+'];

/** Number of list items a list sits inside. */
export const listDepth = (list: SyntaxNode): number => {
  let d = 0;
  for (let p = list.parent; p; p = p.parent) if (p.name === 'ListItem') d++;
  return d;
};

/** The outermost list around a node. */
export function rootListOf(node: SyntaxNode): SyntaxNode | null {
  let root: SyntaxNode | null = null;
  for (let p: SyntaxNode | null = node; p; p = p.parent) if (p.name === 'OrderedList' || p.name === 'BulletList') root = p;
  return root;
}

/** Do two markers have the same style (kind, case and the dot or bracket)? */
const sameStyle = (a: Marker, b: Marker): boolean => a.kind === b.kind && a.upper === b.upper && a.delim === b.delim;

/**
 * The style of the numbered list `list` in a hierarchy: the chain of styles (I. A. 1. a. i. 1) a) i) by default) is followed
 * down from the style the outermost numbered list began with, so a list that starts with "1." has "a." under it, and one that
 * starts with "I." has "A.". The outermost list keeps its own style (null: leave it alone); one that is not in the chain
 * starts the chain from its beginning. Bulleted lists in between are not counted.
 */
function orderedStyleOf(state: EditorState, cfg: ListConfig, list: SyntaxNode): Marker | null {
  let level = 0;
  let top: SyntaxNode = list;
  for (let p = list.parent; p; p = p.parent) {
    if (p.name === 'OrderedList') {
      level++;
      top = p;
    }
  }
  const mark = top.getChild('ListItem')?.getChild('ListMark');
  const own = mark ? parseMarker(state.doc.sliceString(mark.from, mark.to)) : null;
  const styles = cfg.orderedStyles.map((s) => parseMarker(s)).filter((m): m is Marker => !!m);
  if (styles.length === 0) return own;
  const at = own ? styles.findIndex((m) => sameStyle(m, own)) : -1;
  if (level === 0) return styles[Math.max(0, at)]!;
  return styles[((at >= 0 ? at : 0) + level) % styles.length]!;
}

/** The outermost numbered list around (or being) `list`. */
function rootOrdered(list: SyntaxNode): SyntaxNode {
  let top = list;
  for (let p = list.parent; p; p = p.parent) if (p.name === 'OrderedList') top = p;
  return top;
}

/** Every list in the tree under (and including) `list`, with its depth. */
function listsIn(list: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [list];
  for (const item of list.getChildren('ListItem')) for (const name of ['BulletList', 'OrderedList']) for (const l of item.getChildren(name)) out.push(...listsIn(l));
  return out;
}

/**
 * Does this list tree follow the hierarchy, with at least one nested list that shows it (so that "1." alone, which
 * is both a plain and a hierarchical top level, is not called hierarchical)?
 */
export function isHierarchical(state: EditorState, root: SyntaxNode): boolean {
  const cfg = state.facet(listConfig);
  const lists = listsIn(root);
  let nested = false;
  for (const l of lists) {
    const d = listDepth(l);
    const first = l.getChild('ListItem')?.getChild('ListMark');
    if (!first) return false;
    const text = state.doc.sliceString(first.from, first.to);
    if (l.name === 'BulletList') {
      if (text !== BULLET_CYCLE[d % BULLET_CYCLE.length]) return false;
      if (d > 0 && text !== '-') nested = true;
    } else {
      const mk = parseMarker(text);
      const want = orderedStyleOf(state, cfg, l);
      if (!mk || !want || !sameStyle(mk, want)) return false;
      if (d > 0) {
        const top = orderedStyleOf(state, cfg, rootOrdered(l));
        if (!top || top.kind !== want.kind || top.upper !== want.upper) nested = true;
      }
    }
  }
  return nested;
}

/** Changes that give every list under `root` the marker style of its level. `state` is the document they apply to. */
export function restyleChanges(state: EditorState, root: SyntaxNode, plain = false): ChangeSpec[] {
  const cfg: ListConfig = plain ? { ...state.facet(listConfig), orderedStyles: ['1.'] } : state.facet(listConfig);
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const shift = new Map<number, number>();
  const walk = (list: SyntaxNode): void => {
    const depth = listDepth(list);
    const items = list.getChildren('ListItem');
    const firstMark = items[0]?.getChild('ListMark');
    if (list.name === 'OrderedList' && firstMark) {
      const style = orderedStyleOf(state, cfg, list);
      const current = parseMarker(doc.sliceString(firstMark.from, firstMark.to));
      const start = rootOrdered(list) === list && current ? current.value : 1;
      if (style) {
        items.forEach((item, k) => {
          const mark = item.getChild('ListMark');
          if (!mark) return;
          const text = doc.sliceString(mark.from, mark.to);
          const want = formatMarker(style.kind, style.upper, start + k, style.delim);
          if (want === text) return;
          changes.push({ from: mark.from, to: mark.to, insert: want });
          const [a, b] = lineSpan(state, item);
          for (let n = a + 1; n <= b; n++) shift.set(n, (shift.get(n) ?? 0) + want.length - text.length);
        });
      }
    } else if (list.name === 'BulletList') {
      const want = plain ? '-' : BULLET_CYCLE[depth % BULLET_CYCLE.length]!;
      for (const item of items) {
        const mark = item.getChild('ListMark');
        if (mark && doc.sliceString(mark.from, mark.to) !== want) changes.push({ from: mark.from, to: mark.to, insert: want });
      }
    }
    for (const item of items) for (const name of ['BulletList', 'OrderedList']) for (const l of item.getChildren(name)) walk(l);
  };
  walk(root);
  for (const [n, d] of shift) pushShift(changes, doc.line(n), d);
  return changes;
}

/** Give the list tree around the cursor the hierarchy's styles, whatever it is now. */
export function makeHierarchical(view: EditorView, plain = false): boolean {
  const { state } = view;
  const item = itemOnLine(state, parsed(state), state.doc.lineAt(state.selection.main.head).number);
  const root = item ? rootListOf(item) : null;
  if (!root) return false;
  const changes = restyleChanges(state, root, plain);
  if (changes.length > 0) view.dispatch({ changes, userEvent: 'input.format', annotations: [listOp.of(true), styled.of(true)] });
  return true;
}

const depthOf = (list: SyntaxNode): number => {
  let d = 0;
  for (let p = list.parent; p; p = p.parent) if (p.name === 'ListItem') d++;
  return d;
};

/** Did the edit touch the structure of a list (lines added or removed, or the indent or marker at the start of a line)? */
function touchesStructure(tr: Transaction): boolean {
  const old = tr.startState.doc;
  let hit = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (hit) return;
    if (inserted.lines > 1 || old.sliceString(fromA, toA).includes('\n')) {
      hit = true;
      return;
    }
    const line = old.lineAt(fromA);
    const prefix = /^\s*(?:[-*+]|\d{1,9}[.)]|[A-Za-z]{1,8}[.)])?\s*/.exec(line.text)![0].length;
    if (fromA - line.from <= prefix) hit = true;
  });
  return hit;
}

/**
 * The Markdown extension's own Enter and Backspace renumber a list but leave what is under an item where it was, so
 * when a number gains or loses a digit (9 to 10) the sub-items fall out of their item. This moves them along.
 * The changes are for the document the transaction produced.
 */
function widthFixes(tr: Transaction): ChangeSpec[] {
  const old = tr.startState;
  const oldTree = parsed(old);
  const doc = tr.state.doc;
  const plain = (text: string): string => text.replace(/^\s*(?:(?:\d{1,9}|[A-Za-z]{1,8})([.)])|[-*+])?\s*/, '$1 ');
  const shift = new Map<number, number>();
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const line = old.doc.lineAt(fromA);
    const m = /^([ \t]*)(\d{1,9}|[A-Za-z]{1,8})[.)]/.exec(line.text);
    if (!m || inserted.lines > 1) return;
    const d0 = line.from + m[1]!.length;
    if (fromA < d0 || toA > d0 + m[2]!.length) return; // not a change of the number itself
    const delta = inserted.length - (toA - fromA);
    if (delta === 0) return;
    let item: SyntaxNode | null = oldTree.resolveInner(d0, 1);
    while (item && item.name !== 'ListItem') item = item.parent;
    if (!item || item.from !== d0) return;
    const [a, b] = lineSpan(old, item);
    for (let n = a + 1; n <= b; n++) {
      const was = old.doc.line(n);
      if (was.text.trim() === '') continue;
      const now = doc.lineAt(tr.changes.mapPos(was.from, 1));
      if (plain(now.text) !== plain(was.text)) continue; // the line itself was edited: leave it
      shift.set(now.number, (shift.get(now.number) ?? 0) + delta);
    }
  });
  const out: ChangeSpec[] = [];
  for (const [n, d] of shift) pushShift(out, doc.line(n), d);
  return out;
}

/** The changes that put the numbered lists around an edit in order. `state` is the document after `changes`. */
function renumberChanges(oldState: EditorState, state: EditorState, changes_: ChangeSet, command: boolean): ChangeSpec[] {
  const doc: Text = state.doc;
  let lo = doc.length;
  let hi = 0;
  changes_.iterChangedRanges((_a, _b, fromB, toB) => {
    lo = Math.min(lo, fromB);
    hi = Math.max(hi, toB);
  });
  if (lo > hi) return [];
  // the changed lines and one more on each side (an item that left a list leaves its neighbours to be numbered again)
  const from = doc.line(Math.max(1, doc.lineAt(lo).number - 1)).from;
  const to = doc.line(Math.min(doc.lines, doc.lineAt(hi).number + 1)).to;

  const tree = parsed(state);
  const oldTree = parsed(oldState);
  const back = changes_.invertedDesc;

  const lists: SyntaxNode[] = [];
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === 'OrderedList') lists.push(n.node);
    },
  });

  const markerOf = (st: EditorState, item: SyntaxNode, hint?: Marker['kind']): Marker | null => {
    const mark = item.getChild('ListMark');
    return mark ? parseMarker(st.doc.sliceString(mark.from, mark.to), hint) : null;
  };
  const numberOf = (st: EditorState, item: SyntaxNode, hint?: Marker['kind']): number => markerOf(st, item, hint)?.value ?? NaN;

  /** What number a list starts at: the one it had, unless a person typed a new one. */
  const startOf = (list: SyntaxNode, first: SyntaxNode): number => {
    const own = numberOf(state, first);
    const oldPos = back.mapPos(first.from, 1);
    let oldList: SyntaxNode | null = oldTree.resolveInner(oldPos, 1);
    while (oldList && oldList.name !== 'OrderedList') oldList = oldList.parent;
    if (!oldList) return own; // a new list: as typed
    if (depthOf(oldList) !== depthOf(list)) return 1; // moved to another level: a new list there
    const oldFirst = oldList.getChild('ListItem')!;
    const oldMark = oldFirst.getChild('ListMark')!;
    if (!command && oldFirst.from === oldPos && changes_.touchesRange(oldMark.from, oldMark.to)) return own; // the number was edited
    const was = numberOf(oldState, oldFirst);
    return Number.isFinite(was) ? was : own;
  };

  const changes: ChangeSpec[] = [];
  const shift = new Map<number, number>(); // line number -> columns its leading space has to change by
  const seen = new Set<number>();
  for (const list of lists) {
    if (seen.has(list.from)) continue;
    seen.add(list.from);
    const items = list.getChildren('ListItem');
    if (items.length === 0) continue;
    const start = startOf(list, items[0]!);
    if (!Number.isFinite(start)) continue;
    const firstMarker = markerOf(state, items[0]!);
    if (!firstMarker) continue;
    items.forEach((item, k) => {
      const mark = item.getChild('ListMark');
      if (!mark) return;
      const text = doc.sliceString(mark.from, mark.to);
      const want = formatMarker(firstMarker.kind, firstMarker.upper, start + k, text.slice(-1) as '.' | ')');
      if (want === text) return;
      changes.push({ from: mark.from, to: mark.to, insert: want });
      const delta = want.length - text.length;
      // the text of the item moves with its marker, so what is under it has to keep up with it
      const [a, b] = lineSpan(state, item);
      for (let n = a + 1; n <= b; n++) shift.set(n, (shift.get(n) ?? 0) + delta);
    });
  }
  for (const [n, d] of shift) pushShift(changes, doc.line(n), d);
  return changes;
}

const renumbering: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const event = tr.annotation(Transaction.userEvent);
  // only what a person does (typing, deleting, the list commands): never undo and redo, nor changes that arrive from disk
  if (!event || /^(undo|redo)/.test(event)) return tr;
  const command = tr.annotation(listOp) === true;
  if (!command && !touchesStructure(tr)) return tr;
  // first put right what the Markdown extension's own renumbering left behind, then number the lists
  const fixes = command ? [] : widthFixes(tr);
  let state = tr.state;
  let changes = tr.changes;
  if (fixes.length > 0) {
    const set = ChangeSet.of(fixes, state.doc.length);
    state = state.update({ changes: set, filter: false }).state;
    changes = changes.compose(set);
  }
  const numbers = renumberChanges(tr.startState, state, changes, command);
  // a hierarchical list keeps the style of each level when items move between levels
  let styles: ChangeSpec[] = [];
  const cfg = tr.startState.facet(listConfig);
  const headOld = tr.startState.selection.main.head;
  const itemOld = itemOnLine(tr.startState, parsed(tr.startState), tr.startState.doc.lineAt(headOld).number);
  const rootOld = itemOld ? rootListOf(itemOld) : null;
  if (command && tr.annotation(styled) !== true && (cfg.hierarchicalDefault || (rootOld && isHierarchical(tr.startState, rootOld)))) {
    let after = state;
    if (numbers.length > 0) after = state.update({ changes: ChangeSet.of(numbers, state.doc.length), filter: false }).state;
    const head = after.selection.main.head;
    const itemNew = itemOnLine(after, parsed(after), after.doc.lineAt(head).number);
    const rootNew = itemNew ? rootListOf(itemNew) : null;
    if (rootNew) styles = restyleChanges(after, rootNew);
  }
  if (fixes.length === 0 && numbers.length === 0 && styles.length === 0) return tr;
  return [tr, ...(fixes.length > 0 ? [{ changes: fixes, sequential: true }] : []), ...(numbers.length > 0 ? [{ changes: numbers, sequential: true }] : []), ...(styles.length > 0 ? [{ changes: styles, sequential: true }] : [])];
});

/**
 * Enter in a lettered or Roman list: the stock command only counts numbers, so this one continues "a." with "b."
 * and "iv." with "v.". An empty item ends the list. Numbered and bulleted lists are left to the stock command.
 */
export function continueLetteredItem(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const m = /^([ \t]*)((?:[A-Za-z]{1,8}|\d{1,9})[.)])([ \t]+)(.*)$/.exec(line.text);
  if (!m) return false;
  const item = itemOnLine(state, parsed(state), line.number);
  if (!item || item.parent?.name !== 'OrderedList') return false;
  const first = item.parent.getChild('ListItem')!.getChild('ListMark')!;
  const hint = parseMarker(state.doc.sliceString(first.from, first.to))?.kind;
  const mk = parseMarker(m[2]!, hint);
  if (!mk) return false;
  // a numbered item is left to the stock command, unless an item it is under has a lettered or Roman marker (the stock command
  // copies the markers of all the levels and counts the wrong one: an "I." list went on with "II." at the left edge)
  if (mk.kind === 'num') {
    let lettered = false;
    for (let p = item.parent.parent; p && !lettered; p = p.parent) {
      const pm = p.name === 'ListItem' ? p.getChild('ListMark') : null;
      if (pm && p.parent?.name === 'OrderedList') {
        const first2 = p.parent.getChild('ListItem')?.getChild('ListMark');
        const k = parseMarker(state.doc.sliceString(pm.from, pm.to), first2 ? parseMarker(state.doc.sliceString(first2.from, first2.to))?.kind : undefined);
        if (k && k.kind !== 'num') lettered = true;
      }
    }
    if (!lettered) return false;
  }
  const textStart = line.from + m[1]!.length + m[2]!.length + m[3]!.length;
  if (sel.head < textStart) return false;
  if (m[4]!.trim() === '') {
    // empty item: take the marker away and leave the list
    view.dispatch({ changes: { from: line.from, to: line.to, insert: m[1]! }, selection: { anchor: line.from + m[1]!.length }, userEvent: 'delete.dedent', annotations: listOp.of(true) });
    return true;
  }
  const next = `${m[1]}${formatMarker(mk.kind, mk.upper, mk.value + 1, mk.delim)}${m[3]}`;
  view.dispatch({
    changes: { from: sel.head, insert: `\n${next}` },
    selection: { anchor: sel.head + 1 + next.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

const BARE_ITEM_START = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/;

/**
 * Backspace right after a list marker (and the task box, if there is one) takes the whole marker away, indentation
 * included, so the line goes back to the left edge as an ordinary paragraph.
 */
const backspaceOutOfItem: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (!BARE_ITEM_START.test(line.text.slice(0, sel.head - line.from))) return false;
  view.dispatch({ changes: { from: line.from, to: sel.head, insert: '' }, selection: { anchor: line.from }, userEvent: 'delete.backward' });
  return true;
};

/** Offset of the text of a list item's first line (after the marker and the task box), or null if `lineNumber` does not start an item. */
function itemTextStart(state: EditorState, lineNumber: number): number | null {
  const item = itemOnLine(state, parsed(state), lineNumber);
  const line = state.doc.line(lineNumber);
  const mark = item?.getChild('ListMark');
  if (!item || !mark || state.doc.lineAt(mark.from).number !== lineNumber) return null;
  const skip = (pos: number): number => {
    let e = pos;
    while (e < line.to && /[ \t]/.test(state.doc.sliceString(e, e + 1))) e++;
    return e;
  };
  let end = skip(mark.to);
  const task = item.getChild('Task')?.getChild('TaskMarker');
  if (task && task.from >= mark.to && task.to <= line.to) end = skip(task.to);
  return end - line.from;
}

/**
 * Up and Down from the very start of an item's text go to the start of the text of the item above or below, not to
 * the nearest screen position (which, with the marker drawn as a bullet, is in front of that item's marker).
 */
const verticalFromItemStart = (dir: -1 | 1, extend: boolean): Command => (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty && !extend) return false;
  const line = state.doc.lineAt(sel.head);
  const mine = itemTextStart(state, line.number);
  if (mine === null || sel.head - line.from !== mine) return false;
  const n = line.number + dir;
  if (n < 1 || n > state.doc.lines) return false;
  const theirs = itemTextStart(state, n);
  if (theirs === null) return false;
  const pos = state.doc.line(n).from + theirs;
  view.dispatch({ selection: extend ? EditorSelection.range(sel.anchor, pos) : EditorSelection.cursor(pos), scrollIntoView: true, userEvent: 'select' });
  return true;
};

/** The list keys and the renumbering; goes in front of the default keymap. */
export function listSupport(): Extension {
  return [
    renumbering,
    Prec.high(
      keymap.of([
        { key: 'Backspace', run: backspaceOutOfItem },
        { key: 'Enter', run: continueLetteredItem },
        { key: 'Tab', run: indentListItems, shift: outdentListItems },
        { key: 'ArrowUp', run: verticalFromItemStart(-1, false), shift: verticalFromItemStart(-1, true) },
        { key: 'ArrowDown', run: verticalFromItemStart(1, false), shift: verticalFromItemStart(1, true) },
        { key: 'Alt-ArrowUp', run: moveListItem(-1) },
        { key: 'Alt-ArrowDown', run: moveListItem(1) },
      ]),
    ),
  ];
}
