import { Annotation, ChangeSet, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, WidgetType, keymap, type Command } from '@codemirror/view';

/**
 * Footnotes, in the usual syntax:
 *
 *     Some text[^1] and more[^note].
 *
 *     [^1]: The footnote. It can go on
 *         over several lines.
 *     [^note]: Another one.
 *
 * What this file does:
 *  - finds references and definitions (`scanFootnotes`), leaving code and front matter alone;
 *  - keeps them in order (`footnoteFixes`): footnotes are numbered 1, 2, 3 … by where their first reference stands,
 *    and the definitions are put in the same order. Numbered labels are rewritten; named labels (`[^note]`) keep their
 *    name and only take their place in the order. A reference without a definition (or the other way round) is left
 *    alone and does not count, so what is half typed is never rewritten;
 *  - applies that fix in the same transaction as the edit that made it necessary, so there is one undo step and never a
 *    second round of fixing: the fix is idempotent (a document that is in order produces no changes);
 *  - draws references as small raised numbers (click: go to the footnote; hover: read it) and definitions as numbers
 *    (click: back to the text).
 */

export interface FootnoteRef {
  label: string;
  /** whole `[^label]` */
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
}

export interface FootnoteDef {
  label: string;
  /** the block: from the start of its first line to the end of its last non-blank line */
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  /** where its text begins (after `[^label]:` and one space) */
  bodyFrom: number;
}

export interface FootnoteScan {
  refs: FootnoteRef[];
  defs: FootnoteDef[];
}

const DEF_START = /^( {0,3})\[\^([^\]\s]+)\]:[ \t]?/;
const REF = /\[\^([^\]\s]+)\](?!:)/g;
const FENCE = /^ {0,3}(```+|~~~+)/;

/** Find the footnote references and definitions of a document. */
export function scanFootnotes(text: string): FootnoteScan {
  const refs: FootnoteRef[] = [];
  const defs: FootnoteDef[] = [];
  if (!text.includes('[^')) return { refs, defs };
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  // which lines are prose: not front matter, not inside a fenced code block
  const prose: boolean[] = new Array(lines.length).fill(true);
  let fence: string | null = null;
  let front = lines[0] !== undefined && /^---[ \t]*$/.test(lines[0]);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (front) {
      prose[i] = false;
      if (i > 0 && /^(---|\.\.\.)[ \t]*$/.test(l)) front = false;
      continue;
    }
    const f = FENCE.exec(l);
    if (f) {
      prose[i] = false;
      if (fence === null) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) prose[i] = false;
  }

  const inDef: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!prose[i] || inDef[i]) continue;
    const m = DEF_START.exec(lines[i]!);
    if (!m) continue;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (!prose[j] || DEF_START.test(l)) break;
      if (l.trim() === '') {
        // blank lines belong to the footnote only if an indented line follows
        let k = j + 1;
        while (k < lines.length && lines[k]!.trim() === '') k++;
        if (k < lines.length && prose[k] && /^(?: {2,}|\t)/.test(lines[k]!) && !DEF_START.test(lines[k]!)) {
          j = k - 1;
          continue;
        }
        break;
      }
      last = j;
    }
    for (let j = i; j <= last; j++) inDef[j] = true;
    const labelFrom = starts[i]! + m[1]!.length + 2;
    defs.push({
      label: m[2]!,
      from: starts[i]!,
      to: starts[last]! + lines[last]!.length,
      labelFrom,
      labelTo: labelFrom + m[2]!.length,
      bodyFrom: starts[i]! + m[0].length,
    });
    i = last;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!prose[i] || inDef[i]) continue;
    const raw = lines[i]!;
    if (!raw.includes('[^')) continue;
    const masked = raw.replace(/(`+)(.+?)\1/g, (s) => ' '.repeat(s.length));
    REF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF.exec(masked)) !== null) {
      if (m.index > 0 && masked[m.index - 1] === '\\') continue;
      const from = starts[i]! + m.index;
      refs.push({ label: m[1]!, from, to: from + m[0].length, labelFrom: from + 2, labelTo: from + 2 + m[1]!.length });
    }
  }
  return { refs, defs };
}

const scans = new WeakMap<Text, FootnoteScan>();
/** scanFootnotes for a document, remembered per document (documents never change, so this is always current) */
export function footnoteScanOf(doc: Text): FootnoteScan {
  let s = scans.get(doc);
  if (!s) {
    s = scanFootnotes(doc.toString());
    scans.set(doc, s);
  }
  return s;
}

/**
 * The order of the footnotes: labels that have both a reference and a definition, by their first reference.
 * `number` is the 1-based position shown to the reader.
 */
export function footnoteOrder(scan: FootnoteScan, presentation = false): Map<string, number> {
  const defined = new Set(scan.defs.map((d) => d.label));
  const out = new Map<string, number>();
  for (const r of scan.refs) {
    if (presentation && isPresenterNote(r.label)) continue; // a presenter's note has its own letters (see `footnoteDisplay`)
    if (defined.has(r.label) && !out.has(r.label)) out.set(r.label, out.size + 1);
  }
  return out;
}

// ---------------------------------------------------------------- presentations: the presenter's notes

/** `[^note]`, `[^note2]`, `[^note-intro]`: the presenter's notes of a presentation (as the slides and the presenter window read them). */
export const isPresenterNote = (label: string): boolean => /^note/i.test(label);

/** Is this page a presentation? Its attributes (the YAML at the top) name a `presentationTheme`. */
export function isPresentationText(text: string): boolean {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return !!m && /^presentationTheme[ \t]*:/m.test(m[1]!);
}

/** a, b, … z, aa, ab, … (the same letters the presenter window uses) */
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
 * Where each slide of a presentation begins, as offsets in the text (the first is the first line after the attributes).
 * Slides end at a horizontal rule on a line of its own, and before a heading that follows something that is not a heading
 * (a heading inside a `::: block` does not count). Code, the attributes and footnote definitions are left alone. This reads
 * lines rather than the whole Markdown, and agrees with the slide splitting of the exports on ordinary pages.
 */
export function slideStarts(text: string): number[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const out: number[] = [];
  let i = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(lines[j]!)) {
        i = j + 1;
        break;
      }
    }
  }
  out.push(starts[i] ?? 0);
  let fence: string | null = null;
  let depth = 0;
  let prev: 'heading' | 'other' | null = null;
  let blank = true;
  let inDef = false;
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const f = FENCE.exec(l);
    if (fence !== null) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      if (prev === null || prev === 'heading' || blank) prev = 'other';
      blank = false;
      continue;
    }
    if (l.trim() === '') {
      blank = true;
      continue;
    }
    if (inDef && /^(?: {2,}|\t)/.test(l)) continue; // the rest of a footnote
    inDef = false;
    if (DEF_START.test(l) || /^ {0,3}\[[^\]]+\]:\s*\S/.test(l)) {
      inDef = true;
      blank = false;
      continue;
    }
    const colons = /^(:{3,})\s*(\S.*)?$/.exec(l.trim());
    if (colons) {
      if (colons[2]) depth++;
      else depth = Math.max(0, depth - 1);
      blank = false;
      continue;
    }
    const rule = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(l) && (blank || !/\S/.test(lines[i - 1] ?? ''));
    if (rule && depth === 0) {
      if (i + 1 < lines.length) out.push(starts[i + 1]!);
      prev = null;
      blank = false;
      continue;
    }
    if (depth > 0) {
      blank = false;
      continue;
    }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(l)) {
      if (prev !== null && prev !== 'heading') out.push(starts[i]!);
      prev = 'heading';
    } else if (blank || prev === null || prev === 'heading') prev = 'other';
    blank = false;
  }
  return out;
}

export interface FootnoteDisplay {
  /** the number of each footnote that is numbered (in a presentation, the presenter's notes are not) */
  order: Map<string, number>;
  /** what a reference shows, by where the reference begins: its number, or in a presentation a letter for a presenter's note */
  ref: Map<number, string>;
  /** what the definition of a footnote shows (its number, or the letter it has where it is first referred to) */
  def: Map<string, string>;
  presentation: boolean;
}

const displays = new WeakMap<Text, FootnoteDisplay>();

/** How the footnotes of a page are numbered on screen. Presenter's notes of a presentation are lettered a, b, … afresh on each slide. */
export function footnoteDisplay(doc: Text): FootnoteDisplay {
  let d = displays.get(doc);
  if (d) return d;
  const scan = footnoteScanOf(doc);
  const presentation = scan.defs.some((x) => isPresenterNote(x.label)) && isPresentationText(doc.toString());
  const order = footnoteOrder(scan, presentation);
  const ref = new Map<number, string>();
  const def = new Map<string, string>();
  for (const r of scan.refs) if (order.has(r.label)) ref.set(r.from, String(order.get(r.label)));
  for (const [label, n] of order) def.set(label, String(n));
  if (presentation) {
    const defined = new Set(scan.defs.map((x) => x.label));
    const starts = slideStarts(doc.toString());
    const slideOf = (pos: number): number => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const perSlide = new Map<number, Map<string, string>>();
    for (const r of scan.refs) {
      if (!isPresenterNote(r.label) || !defined.has(r.label)) continue;
      const k = slideOf(r.from);
      let letters = perSlide.get(k);
      if (!letters) perSlide.set(k, (letters = new Map()));
      if (!letters.has(r.label)) letters.set(r.label, noteLetter(letters.size));
      ref.set(r.from, letters.get(r.label)!);
      if (!def.has(r.label)) def.set(r.label, letters.get(r.label)!);
    }
  }
  d = { order, ref, def, presentation };
  displays.set(doc, d);
  return d;
}

const NUMERIC = /^\d+$/;

export interface FootnoteFix {
  changes: Array<{ from: number; to: number; insert: string }>;
  /** where a position goes after the fix (the cursor stays inside the footnote it was typing in, even when that moves) */
  mapPos(pos: number): number;
}

/** Changes that put the footnotes of `text` in order, or null when they already are. */
export function footnoteFixes(text: string): FootnoteFix | null {
  const scan = scanFootnotes(text);
  if (scan.defs.length === 0 || scan.refs.length === 0) return null;
  const order = footnoteOrder(scan, isPresentationText(text));
  if (order.size === 0) return null;

  const newLabel = (label: string): string => (NUMERIC.test(label) ? String(order.get(label)) : label);

  // a renamed label must not land on one that stays as it is (an orphan, or a half-typed reference)
  const renamed = new Set<string>();
  for (const l of order.keys()) if (newLabel(l) !== l) renamed.add(l);
  const stays = new Set<string>();
  for (const r of scan.refs) if (!renamed.has(r.label)) stays.add(r.label);
  for (const d of scan.defs) if (!renamed.has(d.label)) stays.add(d.label);
  for (const l of renamed) if (stays.has(newLabel(l))) return null;

  // the definition that belongs to each label: the first one
  const first = new Map<string, FootnoteDef>();
  for (const d of scan.defs) if (!first.has(d.label)) first.set(d.label, d);
  // the slots: where definitions of footnotes in use stand now, in document order
  const slots = scan.defs.filter((d) => first.get(d.label) === d && order.has(d.label));
  const want = [...slots].sort((a, b) => order.get(a.label)! - order.get(b.label)!);

  const changes: FootnoteFix['changes'] = [];
  const moved: Array<{ slot: FootnoteDef; def: FootnoteDef; oldPrefix: number; newPrefix: number }> = [];
  const relabel = (block: string, label: string): string => block.replace(/^( {0,3}\[\^)[^\]\s]+(\]:)/, `$1${label}$2`);

  slots.forEach((slot, i) => {
    const def = want[i]!;
    const label = newLabel(def.label);
    if (def === slot) {
      if (label !== def.label) changes.push({ from: def.labelFrom, to: def.labelTo, insert: label });
      return;
    }
    const block = relabel(text.slice(def.from, def.to), label);
    changes.push({ from: slot.from, to: slot.to, insert: block });
    moved.push({ slot, def, oldPrefix: def.bodyFrom - def.from, newPrefix: (DEF_START.exec(block)?.[0].length ?? 0) });
  });
  for (const r of scan.refs) {
    if (!order.has(r.label)) continue;
    const label = newLabel(r.label);
    if (label !== r.label) changes.push({ from: r.labelFrom, to: r.labelTo, insert: label });
  }
  if (changes.length === 0) return null;
  changes.sort((a, b) => a.from - b.from);

  const cs = ChangeSet.of(changes as ChangeSpec[], text.length);
  return {
    changes,
    mapPos(pos: number): number {
      for (const m of moved) {
        // `m.def` is the footnote that moves, `m.slot` the place it moves to. A cursor in the footnote that moves goes with it
        // (the one just inserted at the end of the page, say, ends up in the middle of the others, and the cursor stays in it)
        if (pos < m.def.from || pos > m.def.to) continue;
        // inside a footnote that moved: it keeps its place within the text that moved
        const k = pos - m.def.from;
        const inBody = k >= m.oldPrefix;
        const offset = inBody ? m.newPrefix + (k - m.oldPrefix) : Math.min(k, m.newPrefix);
        return cs.mapPos(m.slot.from, -1) + offset;
      }
      return cs.mapPos(pos);
    },
  };
}

// ---------------------------------------------------------------- keeping the order while editing

/** Does the document (probably) have footnotes? Kept up to date cheaply so documents without any cost nothing. */
const hasNotes = StateField.define<boolean>({
  create: (state) => state.doc.toString().includes('[^'),
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (value) return true;
    let found = false;
    tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
      if (found) return;
      const near = tr.newDoc.sliceString(Math.max(0, fromB - 2), Math.min(tr.newDoc.length, toB + 2));
      if (near.includes('[^')) found = true;
    });
    return found;
  },
});

/** What was left behind when a footnote's reference or its text was deleted: the other one may be deleted too. */
export interface FootnoteOrphan {
  /** `text`: the reference was deleted and its footnote is still on the page; `marker`: the footnote was deleted and a reference to it is still in the text */
  kind: 'text' | 'marker';
  label: string;
  /** the start of the footnote's text, for the question to ask */
  preview: string;
  /** Delete what is left (one undo step of its own). */
  remove: () => void;
}

interface OrphanNote {
  kind: 'text' | 'marker';
  label: string;
  preview: string;
}

const orphaned = StateEffect.define<OrphanNote>();
/** Marks the deleting we do ourselves, which is not asked about again. */
const cleanup = Annotation.define<boolean>();

/** Edits of the person's own that can delete a reference or a footnote (not undo, redo or what we do ourselves). */
const deletes = (tr: Transaction): boolean => !tr.annotation(cleanup) && !tr.isUserEvent('undo') && !tr.isUserEvent('redo') && (tr.isUserEvent('delete') || tr.isUserEvent('input') || tr.isUserEvent('move'));

/**
 * A reference that was deleted while its footnote is still there, or a footnote deleted while a reference still points at it.
 * A label that was only typed over is not that: the number of references (or of footnotes) must have gone down.
 */
function orphansOf(oldDoc: Text, newText: string, oldScan: FootnoteScan): OrphanNote[] {
  const nw = scanFootnotes(newText);
  const out: OrphanNote[] = [];
  if (nw.refs.length < oldScan.refs.length) {
    for (const d of oldScan.defs) {
      const hadRef = oldScan.refs.some((r) => r.label === d.label);
      const stillRef = nw.refs.some((r) => r.label === d.label);
      const stillDef = nw.defs.some((x) => x.label === d.label);
      if (hadRef && !stillRef && stillDef) out.push({ kind: 'text', label: d.label, preview: footnoteText(oldDoc, d).slice(0, 80) });
    }
  }
  if (nw.defs.length < oldScan.defs.length) {
    for (const r of oldScan.refs) {
      const hadDef = oldScan.defs.some((d) => d.label === r.label);
      const stillDef = nw.defs.some((d) => d.label === r.label);
      const stillRef = nw.refs.some((x) => x.label === r.label);
      if (hadDef && !stillDef && stillRef && !out.some((o) => o.kind === 'marker' && o.label === r.label)) out.push({ kind: 'marker', label: r.label, preview: '' });
    }
  }
  return out;
}

const orderKeeper = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.state.field(hasNotes, false)) return tr;
  const newText = tr.newDoc.toString();
  const notes = deletes(tr) && tr.state.doc.length > 0 ? orphansOf(tr.startState.doc, newText, footnoteScanOf(tr.startState.doc)) : [];
  const fix = footnoteFixes(newText);
  if (!fix && notes.length === 0) return tr;
  const spec: Record<string, unknown> = { sequential: true };
  if (fix) {
    const head = tr.newSelection.main;
    spec.changes = fix.changes as ChangeSpec[];
    spec.selection = EditorSelection.single(fix.mapPos(head.anchor), fix.mapPos(head.head));
  }
  if (notes.length > 0) spec.effects = notes.map((n) => orphaned.of(n));
  return [tr, spec];
});

/** Delete the footnote that has no reference now (the one called `label`, or the only one). */
function removeOrphanText(view: EditorView, label: string): void {
  const scan = footnoteScanOf(view.state.doc);
  const lone = scan.defs.filter((d) => !scan.refs.some((r) => r.label === d.label));
  const def = lone.find((d) => d.label === label) ?? (lone.length === 1 ? lone[0] : undefined);
  if (!def) return;
  const doc = view.state.doc;
  const first = doc.lineAt(def.from);
  const last = doc.lineAt(def.to);
  // take a blank line with it, so no gap is left behind
  let from = first.from;
  let to = last.to < doc.length ? last.to + 1 : last.to;
  if (to < doc.length && doc.lineAt(to).text.trim() === '') to = Math.min(doc.length, doc.lineAt(to).to + 1);
  else if (to >= doc.length && from > 0) from = Math.max(0, from - 1);
  view.dispatch({ changes: { from, to }, annotations: cleanup.of(true), userEvent: 'delete' });
}

/** Delete the references that point at a footnote that is gone. */
function removeOrphanMarkers(view: EditorView, label: string): void {
  const scan = footnoteScanOf(view.state.doc);
  const lone = scan.refs.filter((r) => !scan.defs.some((d) => d.label === r.label));
  const mine = lone.filter((r) => r.label === label);
  const refs = mine.length > 0 ? mine : lone;
  if (refs.length === 0) return;
  view.dispatch({ changes: refs.map((r) => ({ from: r.from, to: r.to })), annotations: cleanup.of(true), userEvent: 'delete' });
}

/** Tells the host about what a deletion left behind, once the edit is done. */
function orphanWatcher(host: (o: FootnoteOrphan) => void): Extension {
  return EditorView.updateListener.of((u) => {
    for (const tr of u.transactions) {
      for (const e of tr.effects) {
        if (!e.is(orphaned)) continue;
        const n = e.value;
        const view = u.view;
        // after the update, so that the question is asked about the page as it is now
        queueMicrotask(() => host({ ...n, remove: () => (n.kind === 'text' ? removeOrphanText(view, n.label) : removeOrphanMarkers(view, n.label)) }));
      }
    }
  });
}

/** Put the footnotes of a document in order; the changes to make, or [] if they are. For a document just opened. */
export function openingFixes(doc: string): Array<{ from: number; to: number; insert: string }> {
  return footnoteFixes(doc)?.changes ?? [];
}

// ---------------------------------------------------------------- insert a footnote

/** Ctrl+Alt+F: a reference at the cursor and an empty footnote at the end of the page, with the cursor in it. */
export const insertFootnote: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const text = state.doc.toString();
  const scan = scanFootnotes(text);
  const used = new Set([...scan.refs.map((r) => r.label), ...scan.defs.map((d) => d.label)]);
  let n = 1;
  while (used.has(String(n))) n++;
  const label = String(n);
  const end = state.doc.length;
  const gap = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const def = `${gap}[^${label}]: `;
  const at = sel.to;
  view.dispatch({
    changes: [
      { from: at, insert: `[^${label}]` },
      { from: end, insert: def },
    ],
    selection: EditorSelection.cursor(end + `[^${label}]`.length + def.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};

// ---------------------------------------------------------------- drawing

function goTo(view: EditorView, pos: number): void {
  view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }), userEvent: 'select' });
  view.focus();
}

/** The raised number in the text. */
export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly shown: string,
    readonly known: boolean,
  ) {
    super();
  }
  override eq(other: FootnoteRefWidget): boolean {
    return other.label === this.label && other.shown === this.shown && other.known === this.known;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('sup');
    el.className = `cm-footnote-ref${this.known ? '' : ' cm-footnote-unknown'}`;
    el.dataset.footnote = this.label;
    el.textContent = this.shown;
    el.setAttribute('role', 'link');
    el.setAttribute('aria-label', `Footnote ${this.shown}`);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const def = footnoteScanOf(view.state.doc).defs.find((d) => d.label === this.label);
      if (def) goTo(view, def.bodyFrom);
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The number in front of a footnote's text. */
export class FootnoteDefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly shown: string,
  ) {
    super();
  }
  override eq(other: FootnoteDefWidget): boolean {
    return other.label === this.label && other.shown === this.shown;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-footnote-def-mark';
    el.dataset.footnote = this.label;
    el.textContent = `${this.shown}.`;
    el.setAttribute('role', 'link');
    el.setAttribute('aria-label', `Back to the text of footnote ${this.shown}`);
    el.title = 'Back to the text';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const ref = footnoteScanOf(view.state.doc).refs.find((r) => r.label === this.label);
      if (ref) goTo(view, ref.to);
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The text of a footnote, without the label and the indentation of its continuation lines. */
export function footnoteText(doc: Text, def: FootnoteDef): string {
  const body = doc.sliceString(def.bodyFrom, def.to);
  return body
    .split('\n')
    .map((l, i) => (i === 0 ? l : l.replace(/^(?: {1,4}|\t)/, '')))
    .join('\n')
    .trim();
}

/** Hovering a reference shows the whole footnote in a small box that scrolls when it is long. */
const hoverCard = ViewPlugin.fromClass(
  class {
    card: HTMLElement | null = null;
    timer: ReturnType<typeof setTimeout> | null = null;
    constructor(readonly view: EditorView) {
      view.dom.addEventListener('mouseover', this.over);
      view.dom.addEventListener('mouseout', this.out);
    }
    over = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement | null)?.closest?.('.cm-footnote-ref') as HTMLElement | null;
      if (!t) return;
      this.cancel();
      this.show(t);
    };
    out = (e: MouseEvent): void => {
      const t = (e.target as HTMLElement | null)?.closest?.('.cm-footnote-ref');
      if (t) this.later();
    };
    cancel(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    later(): void {
      this.cancel();
      this.timer = setTimeout(() => this.hide(), 220);
    }
    hide(): void {
      this.card?.remove();
      this.card = null;
    }
    show(anchor: HTMLElement): void {
      const label = anchor.dataset.footnote ?? '';
      const doc = this.view.state.doc;
      const def = footnoteScanOf(doc).defs.find((d) => d.label === label);
      this.hide();
      const card = document.createElement('div');
      card.className = 'cm-footnote-card';
      card.textContent = def ? footnoteText(doc, def) || '(empty footnote)' : 'There is no footnote with this name.';
      card.addEventListener('mouseenter', () => this.cancel());
      card.addEventListener('mouseleave', () => this.later());
      document.body.appendChild(card);
      const r = anchor.getBoundingClientRect();
      const w = card.offsetWidth || 320;
      const left = Math.max(8, Math.min(r.left - 8, (typeof window === 'undefined' ? 1024 : window.innerWidth) - w - 8));
      card.style.left = `${left}px`;
      card.style.top = `${r.bottom + 6}px`;
      this.card = card;
    }
    destroy(): void {
      this.cancel();
      this.hide();
      this.view.dom.removeEventListener('mouseover', this.over);
      this.view.dom.removeEventListener('mouseout', this.out);
    }
  },
);

export const footnoteCss = `
.cm-footnote-card { position: fixed; z-index: 1000; max-width: min(28rem, 90vw); max-height: 14em; overflow: auto; padding: 8px 12px; border-radius: 8px;
  background: var(--popover-bg, var(--view-bg)); color: var(--view-fg); border: 1px solid var(--border); box-shadow: 0 4px 18px rgba(0,0,0,.28);
  font-family: var(--ui-font, inherit); font-size: 13px; line-height: 1.5; white-space: pre-wrap; user-select: text; }
`;

let cssInstalled = false;
function installCss(): void {
  if (cssInstalled || typeof document === 'undefined') return;
  cssInstalled = true;
  const el = document.createElement('style');
  el.textContent = footnoteCss;
  document.head.appendChild(el);
}

/** Footnotes for the editor: order keeping, the insert command and the hover card (the drawing is in live preview). */
export function footnotes(onOrphan?: (o: FootnoteOrphan) => void): Extension {
  installCss();
  return [hasNotes, orderKeeper, hoverCard, ...(onOrphan ? [orphanWatcher(onOrphan)] : []), Prec.high(keymap.of([{ key: 'Mod-Alt-f', run: insertFootnote }]))];
}
