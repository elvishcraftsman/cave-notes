import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { installFormatMenuStyles } from './theme';

/**
 * Tables. A Markdown pipe table is drawn as a grid that can be edited in place: type in the cells, add, insert and delete
 * rows and columns from the grips along the top and left, drag a grip's edge to resize, and drag across cells (or click a
 * grip) to select several for copying into spreadsheet software. Every change is written straight back into the
 * Markdown as a plain pipe table, so nothing but the text is ever stored; sizes ride along in a one-line HTML comment
 * right under the table (`<!-- cave-table: cols=120,,200 rows=,48 -->`), which other Markdown renderers ignore.
 *
 * The table shows its raw text again while the text cursor is inside it (the "Edit as text" button, or arrowing into
 * it from the line above).
 */

export type Align = 'left' | 'center' | 'right' | null;

export interface TableModel {
  head: string[];
  align: Align[];
  /** body rows, every one as long as `head` */
  rows: string[][];
  /** width in px of each column, or null for automatic */
  widths: Array<number | null>;
  /** height in px of each row, the header row first (so one more than `rows`), or null for automatic */
  heights: Array<number | null>;
}

/** Split one pipe-table row into trimmed cells (handles leading/trailing pipes and `\|`). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTable(text: string): { head: string[]; align: Align[]; rows: string[][] } | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const delim = splitRow(lines[1]!);
  if (!delim.every((c) => /^:?-+:?$/.test(c))) return null;
  const align = delim.map<Align>((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
  const head = splitRow(lines[0]!);
  while (align.length < head.length) align.push(null);
  const rows = lines.slice(2).map((l) => {
    const r = splitRow(l);
    while (r.length < head.length) r.push('');
    return r.slice(0, Math.max(head.length, 1));
  });
  return { head, align: align.slice(0, head.length), rows };
}

// ---------------------------------------------------------------- the size comment under a table

const META_RE = /^\s*<!--\s*cave-table:\s*(.*?)\s*-->\s*$/;

const list = (v: string | undefined): Array<number | null> =>
  (v ?? '').split(',').map((s) => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  });

/** The sizes in a `<!-- cave-table: ... -->` line, or null when the line is something else. */
export function parseTableMeta(line: string): { cols: Array<number | null>; rows: Array<number | null> } | null {
  const m = META_RE.exec(line);
  if (!m) return null;
  const get = (key: string): string | undefined => new RegExp(`(?:^|\\s)${key}=(\\S*)`).exec(m[1]!)?.[1];
  return { cols: list(get('cols')), rows: list(get('rows')) };
}

const trimEnd = (xs: Array<number | null>): Array<number | null> => {
  const out = [...xs];
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
};

/** The size comment for a table's sizes, or '' when everything is automatic. */
export function tableMetaLine(m: Pick<TableModel, 'widths' | 'heights'>): string {
  const cols = trimEnd(m.widths);
  const rows = trimEnd(m.heights);
  const parts: string[] = [];
  if (cols.length > 0) parts.push(`cols=${cols.map((n) => n ?? '').join(',')}`);
  if (rows.length > 0) parts.push(`rows=${rows.map((n) => n ?? '').join(',')}`);
  return parts.length > 0 ? `<!-- cave-table: ${parts.join(' ')} -->` : '';
}

/** Read a table from its text, with the size comment on its last line if there is one. */
export function readTable(text: string): TableModel | null {
  const lines = text.split('\n');
  let meta: ReturnType<typeof parseTableMeta> = null;
  if (lines.length > 0 && META_RE.test(lines[lines.length - 1]!)) meta = parseTableMeta(lines.pop()!);
  const t = parseTable(lines.join('\n'));
  if (!t) return null;
  const widths = t.head.map((_, i) => meta?.cols[i] ?? null);
  const heights = [null, ...t.rows.map(() => null)].map((_, i) => meta?.rows[i] ?? null);
  return { ...t, widths, heights };
}

const esc = (c: string): string => c.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** The Markdown for a table: padded so the raw text lines up, with the size comment under it when sizes are set. */
export function serializeTable(m: TableModel): string {
  const n = m.head.length;
  const w = Array.from({ length: n }, (_, c) => Math.max(3, Math.min(30, esc(m.head[c] ?? '').length), ...m.rows.map((r) => Math.min(30, esc(r[c] ?? '').length))));
  const row = (cells: string[]): string => `| ${cells.map((c, i) => esc(c).padEnd(w[i]!)).join(' | ')} |`;
  const delim = `| ${m.align.slice(0, n).map((a, i) => {
    const k = w[i]!;
    return a === 'center' ? `:${'-'.repeat(k - 2)}:` : a === 'right' ? `${'-'.repeat(k - 1)}:` : a === 'left' ? `:${'-'.repeat(k - 1)}` : '-'.repeat(k);
  }).join(' | ')} |`;
  const meta = tableMetaLine(m);
  return [row(m.head), delim, ...m.rows.map(row), ...(meta ? [meta] : [])].join('\n');
}

/** `rows` columns wide and as many rows tall (header included): the table "Insert table" adds. */
export function blankTable(columns = 2, rows = 2): TableModel {
  return {
    head: Array.from({ length: columns }, (_, i) => `Column ${i + 1}`),
    align: Array.from({ length: columns }, () => null),
    rows: Array.from({ length: Math.max(0, rows - 1) }, () => Array.from({ length: columns }, () => '')),
    widths: Array.from({ length: columns }, () => null),
    heights: Array.from({ length: Math.max(1, rows) }, () => null),
  };
}

// ---------------------------------------------------------------- where a table is in the page

/** The end of a table's text: after its size comment when the line right below it is one. */
export function tableEnd(state: EditorState, to: number): number {
  const line = state.doc.lineAt(to);
  if (line.number >= state.doc.lines) return to;
  const next = state.doc.line(line.number + 1);
  return META_RE.test(next.text) ? next.to : to;
}

/** The pipe table at a position (its text, and its size comment too), or null. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (let n = syntaxTree(state).resolveInner(Math.min(pos, state.doc.length), 1); n; n = n.parent as typeof n) {
    if (n.name === 'Table') return { from: n.from, to: tableEnd(state, n.to) };
    if (!n.parent) break;
  }
  return null;
}

// ---------------------------------------------------------------- copying cells out (and in)

/** A cell's text as a spreadsheet should see it: the Markdown marks of its content taken away. */
export function plainCell(md: string): string {
  return md
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n');
}

/** Tab-separated text for cells, the way spreadsheets write it (a cell with a tab, a newline or a quote is quoted). */
export function cellsToTsv(cells: string[][]): string {
  const one = (c: string): string => {
    const t = plainCell(c);
    return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return cells.map((r) => r.map(one).join('\t')).join('\n');
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An HTML table for cells, which Excel, LibreOffice and Google Sheets paste as separate cells. */
export function cellsToHtml(cells: string[][], headerRow = false): string {
  const rows = cells.map((r, i) => `<tr>${r.map((c) => `<${headerRow && i === 0 ? 'th' : 'td'}>${escHtml(plainCell(c)).replace(/\n/g, '<br>')}</${headerRow && i === 0 ? 'th' : 'td'}>`).join('')}</tr>`);
  return `<table>${rows.join('')}</table>`;
}

/** Cells out of text copied from a spreadsheet (tabs between cells, newlines between rows, quoted cells allowed). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/\n/g, '<br>')));
}

/** Cells out of copied HTML that holds a table, or null. */
export function parseHtmlTable(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html) || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const t = doc.querySelector('table');
  if (!t) return null;
  const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()));
  return rows.length > 0 ? rows : null;
}

/** The cells to paste from a clipboard: a table in its HTML, else tab-separated text. */
export function clipboardCells(html: string, text: string): string[][] {
  return parseHtmlTable(html) ?? parseTsv(text);
}

// ---------------------------------------------------------------- commands

/** What to focus once a table has been drawn again after a change (a table is rebuilt when its shape changes). */
let pending: { view: EditorView; from: number; row: number; col: number } | null = null;

/** Insert a 2 × 2 table (a header row and one more) on a line of its own after the cursor, and put the cursor in its first cell. */
export function insertTable(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const text = serializeTable(blankTable(2, 2));
  const blank = line.text.trim() === '';
  const from = blank ? line.from : line.to;
  const insert = (blank ? '' : '\n\n') + text + '\n\n';
  const start = from + (blank ? 0 : 2);
  // the cursor goes on the blank line after the table, which keeps the grid drawn (the cursor inside would show the text)
  view.dispatch({ changes: { from, to: blank ? line.to : from, insert }, selection: { anchor: start + text.length + 1 }, scrollIntoView: true, userEvent: 'input.table' });
  pending = { view, from: start, row: 0, col: 0 };
  focusPending(view);
  return true;
}

function focusPending(view: EditorView): void {
  const want = pending;
  if (!want || want.view !== view) return;
  requestAnimationFrame(() => {
    if (pending !== want) return;
    for (const wrap of view.dom.querySelectorAll<HTMLElement>('.cm-table-wrap')) {
      let at = -1;
      try {
        at = view.posAtDOM(wrap);
      } catch {
        continue;
      }
      if (at !== want.from) continue;
      const cell = wrap.querySelector<HTMLElement>(`[data-r="${want.row}"][data-c="${want.col}"]`);
      if (cell) {
        pending = null;
        cell.focus();
      }
      return;
    }
  });
}

// ---------------------------------------------------------------- inline rendering of a cell

/** Simple inline rendering for cells: `code`, **bold**, *italic*, [[wikilinks]]; everything else is text. */
export function renderInline(parent: HTMLElement, text: string): void {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const el = document.createElement(m[1] ? 'code' : m[2] ? 'strong' : m[3] ? 'em' : 'span');
    if (m[4]) el.className = 'cm-wikilink';
    el.textContent = m[1] ?? m[2] ?? m[3] ?? (m[4] ?? '').split('|').pop() ?? '';
    parent.append(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

// ---------------------------------------------------------------- the editable grid

interface Rect { r0: number; c0: number; r1: number; c1: number }

const editors = new WeakMap<HTMLElement, TableEditor>();

const MIN_COL = 40;
const MIN_ROW = 24;

/** One table drawn as a grid. Row 0 of the grid is the header; body row i is grid row i + 1. */
class TableEditor {
  readonly dom: HTMLElement;
  private table!: HTMLTableElement;
  private cols!: HTMLElement[];
  private sel: Rect | null = null;
  /** the cell that selecting several cells started from */
  private anchor: { r: number; c: number } = { r: 0, c: 0 };
  /** the shape changed: the grid must be drawn again from the text */
  structural = false;
  private menu: HTMLElement | null = null;
  private closeMenu: (() => void) | null = null;

  constructor(public view: EditorView, readonly model: TableModel) {
    this.dom = document.createElement('div');
    this.dom.className = 'cm-table-wrap';
    this.dom.tabIndex = -1;
    editors.set(this.dom, this);
    this.build();
    this.dom.addEventListener('keydown', (e) => this.onWrapKey(e));
    this.dom.addEventListener('copy', (e) => this.onCopy(e, false));
    this.dom.addEventListener('cut', (e) => this.onCopy(e, true));
    this.dom.addEventListener('paste', (e) => this.onPaste(e));
    this.dom.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (this.guard || (to && (this.dom.contains(to) || this.menu?.contains(to)))) return;
      this.clearSelection();
    });
    this.dom.addEventListener('selectstart', (e) => {
      if (this.ranging) e.preventDefault();
    });
    focusPending(view);
  }

  /** the text this grid would write */
  text(): string {
    return serializeTable(this.model);
  }

  // ---- drawing

  private get nCols(): number {
    return this.model.head.length;
  }
  private get nRows(): number {
    return this.model.rows.length + 1;
  }
  private value(r: number, c: number): string {
    return (r === 0 ? this.model.head[c] : this.model.rows[r - 1]?.[c]) ?? '';
  }
  private setValue(r: number, c: number, v: string): void {
    if (r === 0) this.model.head[c] = v;
    else if (this.model.rows[r - 1]) this.model.rows[r - 1]![c] = v;
  }
  cell(r: number, c: number): HTMLElement | null {
    return this.dom.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
  }

  private build(): void {
    const m = this.model;
    const bar = document.createElement('div');
    bar.className = 'cm-table-bar';
    const edit = this.button('cm-table-edit', 'Edit as text', 'Edit the table as Markdown text', () => this.editAsText());
    edit.textContent = '</>';
    bar.append(edit);

    const main = document.createElement('div');
    main.className = 'cm-table-main';
    const scroll = document.createElement('div');
    scroll.className = 'cm-table-scroll';
    const table = document.createElement('table');
    table.className = 'cm-table cm-table-grid';
    this.table = table;
    const group = document.createElement('colgroup');
    const corner = document.createElement('col');
    corner.className = 'cm-col-grip-col';
    group.append(corner);
    this.cols = [];
    for (let c = 0; c < this.nCols; c++) {
      const col = document.createElement('col');
      group.append(col);
      this.cols.push(col);
    }
    table.append(group);
    this.applyWidths();

    const grips = table.createTHead().insertRow();
    grips.className = 'cm-table-grips';
    const all = document.createElement('th');
    all.className = 'cm-table-corner';
    all.append(this.gripButton('Select the whole table', () => this.select({ r0: 0, c0: 0, r1: this.nRows - 1, c1: this.nCols - 1 })));
    grips.append(all);
    for (let c = 0; c < this.nCols; c++) grips.append(this.colGrip(c));

    const head = table.tHead!.insertRow();
    this.fillRow(head, 0);
    const body = table.createTBody();
    for (let r = 1; r < this.nRows; r++) this.fillRow(body.insertRow(), r);
    scroll.append(table);

    const addCol = this.button('cm-table-add-col', '+', 'Add a column', () => this.mutate(() => this.insertCol(this.nCols), { row: 0, col: this.nCols }));
    main.append(scroll, addCol);
    const addRow = this.button('cm-table-add-row', '+', 'Add a row', () => this.mutate(() => this.insertRow(this.nRows), { row: this.nRows, col: 0 }));
    this.dom.append(bar, main, addRow);
  }

  private button(cls: string, label: string, title: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', run);
    return b;
  }

  private gripButton(title: string, run: () => void): HTMLButtonElement {
    const b = this.button('cm-table-grip', '', title, run);
    b.textContent = '\u22EE\u22EE';
    return b;
  }

  private colGrip(c: number): HTMLElement {
    const th = document.createElement('th');
    th.className = 'cm-col-grip';
    th.dataset.grip = 'col';
    th.append(this.gripButton(`Column ${c + 1}: select, insert, delete`, () => this.gripClick(th, 'col', c)));
    th.append(this.resizer('col', c));
    return th;
  }

  private rowGrip(r: number): HTMLElement {
    const th = document.createElement('th');
    th.className = 'cm-row-grip';
    th.dataset.grip = 'row';
    th.append(this.gripButton(`Row ${r + 1}: select, insert, delete`, () => this.gripClick(th, 'row', r)));
    th.append(this.resizer('row', r));
    return th;
  }

  private fillRow(tr: HTMLTableRowElement, r: number): void {
    const h = this.model.heights[r];
    if (h) tr.style.height = `${h}px`;
    tr.append(this.rowGrip(r));
    for (let c = 0; c < this.nCols; c++) {
      const td = document.createElement(r === 0 ? 'th' : 'td');
      td.className = 'cm-table-cell';
      td.dataset.r = String(r);
      td.dataset.c = String(c);
      td.setAttribute('contenteditable', 'plaintext-only');
      td.spellcheck = true;
      if (this.model.align[c]) td.style.textAlign = this.model.align[c]!;
      this.render(td, this.value(r, c));
      this.wireCell(td, r, c);
      tr.append(td);
    }
  }

  private render(td: HTMLElement, raw: string): void {
    td.textContent = '';
    td.dataset.editing = '0';
    renderInline(td, raw);
  }

  private applyWidths(): void {
    const w = this.model.widths;
    const any = w.some((x) => x !== null);
    this.cols.forEach((col, i) => {
      col.style.width = w[i] ? `${w[i]}px` : '';
    });
    this.table.style.tableLayout = any ? 'fixed' : '';
    this.table.style.width = any ? `${28 + w.reduce<number>((s, x) => s + (x ?? 140), 0)}px` : '';
  }

  // ---- cells

  private wireCell(td: HTMLElement, r: number, c: number): void {
    td.addEventListener('pointerdown', (e) => this.onCellDown(e, td, r, c));
    td.addEventListener('focus', () => {
      if (td.dataset.editing === '1') return;
      td.dataset.editing = '1';
      td.textContent = this.value(r, c);
      // arriving by keyboard selects the whole cell, as a spreadsheet does
      if (!this.pointerFocus) selectContents(td);
      this.clearSelection();
    });
    td.addEventListener('blur', () => {
      this.pointerFocus = false;
      const raw = td.textContent ?? '';
      if (raw !== this.value(r, c)) {
        this.setValue(r, c, raw);
        this.write(false);
      }
      if (td.isConnected) this.render(td, this.value(r, c));
    });
    td.addEventListener('input', () => {
      this.setValue(r, c, td.textContent ?? '');
      this.write(false);
    });
    td.addEventListener('keydown', (e) => this.onCellKey(e, td, r, c));
  }

  private pointerFocus = false;
  private ranging = false;
  /** the grid is moving focus itself (to its own frame, for a block of cells): that is not the user leaving */
  private guard = false;

  /** Take focus off the cell being typed in and put it on the grid's frame, which gets the keys for a selected block. */
  private holdFocus(): void {
    this.guard = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    this.dom.focus({ preventScroll: true });
    this.guard = false;
  }

  private onCellDown(e: PointerEvent, td: HTMLElement, r: number, c: number): void {
    if (e.button !== 0) return;
    if (e.shiftKey && this.sel !== null || (e.shiftKey && document.activeElement instanceof HTMLElement && document.activeElement.dataset.r)) {
      const a = this.anchorCell();
      e.preventDefault();
      this.selectBetween(a.r, a.c, r, c);
      return;
    }
    this.anchor = { r, c };
    this.pointerFocus = true;
    this.clearSelection();
    if (td.dataset.editing !== '1') {
      td.dataset.editing = '1';
      td.textContent = this.value(r, c);
    }
    const move = (ev: PointerEvent): void => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-r]');
      if (!under || !this.dom.contains(under)) return;
      const rr = Number(under.dataset.r);
      const cc = Number(under.dataset.c);
      if (!this.ranging && (rr !== r || cc !== c)) {
        this.ranging = true;
        this.holdFocus();
      }
      if (this.ranging) this.selectBetween(this.anchor.r, this.anchor.c, rr, cc);
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.ranging = false;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  private anchorCell(): { r: number; c: number } {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.dataset.r !== undefined && this.dom.contains(a)) return { r: Number(a.dataset.r), c: Number(a.dataset.c) };
    return this.sel ? { r: this.sel.r0, c: this.sel.c0 } : this.anchor;
  }

  private onCellKey(e: KeyboardEvent, td: HTMLElement, r: number, c: number): void {
    const mod = e.ctrlKey || e.metaKey;
    const go = (rr: number, cc: number): void => {
      e.preventDefault();
      const next = this.cell(rr, cc);
      if (next) next.focus();
    };
    const sel = window.getSelection();
    const len = (td.textContent ?? '').length;
    const atStart = !!sel && sel.isCollapsed && offsetIn(td, sel) === 0;
    const atEnd = !!sel && sel.isCollapsed && offsetIn(td, sel) === len;
    if (e.key === 'Tab' && !mod) {
      if (e.shiftKey) return void (c > 0 ? go(r, c - 1) : r > 0 ? go(r - 1, this.nCols - 1) : e.preventDefault());
      if (c < this.nCols - 1) return go(r, c + 1);
      if (r < this.nRows - 1) return go(r + 1, 0);
      e.preventDefault();
      return void this.mutate(() => this.insertRow(this.nRows), { row: this.nRows, col: 0 });
    }
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      if (e.shiftKey) return void document.execCommand('insertText', false, '<br>');
      if (r < this.nRows - 1) return go(r + 1, c);
      return this.mutate(() => this.insertRow(this.nRows), { row: this.nRows, col: c });
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      return this.leave();
    }
    if (!mod && !e.shiftKey && !e.altKey) {
      if (e.key === 'ArrowUp' && r > 0) return go(r - 1, c);
      if (e.key === 'ArrowDown' && r < this.nRows - 1) return go(r + 1, c);
      if (e.key === 'ArrowLeft' && atStart && c > 0) return go(r, c - 1);
      if (e.key === 'ArrowRight' && atEnd && c < this.nCols - 1) return go(r, c + 1);
    }
    if (mod && e.key.toLowerCase() === 'a' && sel && !sel.isCollapsed && (sel.toString() === (td.textContent ?? '') || len === 0)) {
      e.preventDefault();
      this.select({ r0: 0, c0: 0, r1: this.nRows - 1, c1: this.nCols - 1 });
    }
  }

  private onWrapKey(e: KeyboardEvent): void {
    if (e.target !== this.dom || !this.sel) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.clearSelection();
      return this.leave();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.clearCells();
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      this.cell(this.sel.r0, this.sel.c0)?.focus();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.select({ r0: 0, c0: 0, r1: this.nRows - 1, c1: this.nCols - 1 });
    }
  }

  /** Put the text cursor on the line after the table. */
  private leave(): void {
    const at = this.range();
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!at) return;
    const pos = Math.min(this.view.state.doc.length, at.to + 1);
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.view.focus();
  }

  private editAsText(): void {
    const at = this.range();
    if (!at) return;
    this.view.dispatch({ selection: { anchor: Math.min(at.from + 1, at.to) }, scrollIntoView: true });
    this.view.focus();
  }

  // ---- selecting several cells

  private selectBetween(r0: number, c0: number, r1: number, c1: number): void {
    this.select({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
  }

  /** Select a block of cells: they are highlighted and the grid takes the keyboard (for copy, paste and delete). */
  select(rect: Rect): void {
    this.sel = rect;
    this.anchor = { r: rect.r0, c: rect.c0 };
    this.holdFocus();
    this.paint();
  }

  private clearSelection(): void {
    if (!this.sel) return;
    this.sel = null;
    this.paint();
  }

  private paint(): void {
    const s = this.sel;
    this.dom.querySelectorAll<HTMLElement>('.cm-table-cell').forEach((td) => {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      td.classList.toggle('cm-cell-selected', !!s && r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1);
    });
    this.dom.classList.toggle('cm-table-selecting', !!s);
  }

  /** The selected cells as rows of text. */
  selectedCells(): string[][] {
    const s = this.sel;
    if (!s) return [];
    const out: string[][] = [];
    for (let r = s.r0; r <= s.r1; r++) {
      const row: string[] = [];
      for (let c = s.c0; c <= s.c1; c++) row.push(this.value(r, c));
      out.push(row);
    }
    return out;
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    if (!this.sel || !e.clipboardData) return;
    const cells = this.selectedCells();
    e.preventDefault();
    e.clipboardData.setData('text/plain', cellsToTsv(cells));
    e.clipboardData.setData('text/html', cellsToHtml(cells, this.sel.r0 === 0));
    if (cut) this.clearCells();
  }

  private clearCells(): void {
    const s = this.sel;
    if (!s) return;
    for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) this.setValue(r, c, '');
    this.dom.querySelectorAll<HTMLElement>('.cm-cell-selected').forEach((td) => this.render(td, ''));
    this.write(false);
  }

  private onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    if (!data) return;
    const cells = clipboardCells(data.getData('text/html'), data.getData('text/plain'));
    const focused = document.activeElement as HTMLElement | null;
    const inCell = !!focused && focused.dataset.r !== undefined;
    // one value pasted into a cell being typed in is ordinary text
    if (cells.length === 0 || (cells.length === 1 && cells[0]!.length === 1 && inCell)) return;
    e.preventDefault();
    const at = this.sel ? { r: this.sel.r0, c: this.sel.c0 } : inCell ? { r: Number(focused!.dataset.r), c: Number(focused!.dataset.c) } : { r: 0, c: 0 };
    this.mutate(() => {
      const width = Math.max(...cells.map((r) => r.length));
      while (at.c + width > this.nCols) this.insertCol(this.nCols);
      while (at.r + cells.length > this.nRows) this.insertRow(this.nRows);
      cells.forEach((row, i) => row.forEach((v, j) => this.setValue(at.r + i, at.c + j, v)));
    }, { row: at.r, col: at.c });
  }

  // ---- changing the shape

  private insertRow(at: number): void {
    // at is a grid row (1 or more: the header stays first)
    const i = Math.max(1, Math.min(at, this.nRows));
    this.model.rows.splice(i - 1, 0, Array.from({ length: this.nCols }, () => ''));
    this.model.heights.splice(i, 0, null);
  }
  private deleteRow(r: number): void {
    if (r < 1) return;
    this.model.rows.splice(r - 1, 1);
    this.model.heights.splice(r, 1);
  }
  private insertCol(at: number): void {
    const i = Math.max(0, Math.min(at, this.nCols));
    this.model.head.splice(i, 0, `Column ${this.nCols + 1}`);
    this.model.align.splice(i, 0, null);
    this.model.widths.splice(i, 0, null);
    for (const row of this.model.rows) row.splice(i, 0, '');
  }
  private deleteCol(c: number): void {
    if (this.nCols < 2) return;
    this.model.head.splice(c, 1);
    this.model.align.splice(c, 1);
    this.model.widths.splice(c, 1);
    for (const row of this.model.rows) row.splice(c, 1);
  }

  /** Change the shape (or many cells) and write it: the grid is drawn again, with the cursor in the cell asked for. */
  private mutate(change: () => void, focus: { row: number; col: number }): void {
    this.closeMenu?.();
    change();
    this.structural = true;
    const at = this.range();
    pending = at ? { view: this.view, from: at.from, row: Math.min(focus.row, this.nRows - 1), col: Math.min(focus.col, this.nCols - 1) } : null;
    this.write(true);
  }

  private gripClick(anchor: HTMLElement, kind: 'row' | 'col', i: number): void {
    if (kind === 'row') this.select({ r0: i, c0: 0, r1: i, c1: this.nCols - 1 });
    else this.select({ r0: 0, c0: i, r1: this.nRows - 1, c1: i });
    const items: MenuItem[] =
      kind === 'row'
        ? [
            { label: 'Insert row above', disabled: i === 0, run: () => this.mutate(() => this.insertRow(i), { row: i, col: 0 }) },
            { label: 'Insert row below', run: () => this.mutate(() => this.insertRow(i + 1), { row: i + 1, col: 0 }) },
            { label: 'Delete row', disabled: i === 0, run: () => this.mutate(() => this.deleteRow(i), { row: Math.max(0, i - 1), col: 0 }) },
            { label: 'Reset row height', disabled: !this.model.heights[i], run: () => this.mutate(() => void (this.model.heights[i] = null), { row: i, col: 0 }) },
          ]
        : [
            { label: 'Insert column left', run: () => this.mutate(() => this.insertCol(i), { row: 0, col: i }) },
            { label: 'Insert column right', run: () => this.mutate(() => this.insertCol(i + 1), { row: 0, col: i + 1 }) },
            { label: 'Delete column', disabled: this.nCols < 2, run: () => this.mutate(() => this.deleteCol(i), { row: 0, col: Math.min(i, this.nCols - 2) }) },
            { label: 'Align left', checked: this.model.align[i] === 'left', run: () => this.mutate(() => void (this.model.align[i] = 'left'), { row: 0, col: i }) },
            { label: 'Align centre', checked: this.model.align[i] === 'center', run: () => this.mutate(() => void (this.model.align[i] = 'center'), { row: 0, col: i }) },
            { label: 'Align right', checked: this.model.align[i] === 'right', run: () => this.mutate(() => void (this.model.align[i] = 'right'), { row: 0, col: i }) },
            { label: 'Reset column widths', disabled: !this.model.widths.some(Boolean), run: () => this.mutate(() => this.model.widths.fill(null), { row: 0, col: i }) },
          ];
    this.openMenu(anchor, items);
  }

  private openMenu(anchor: HTMLElement, items: MenuItem[]): void {
    this.closeMenu?.();
    installFormatMenuStyles();
    const menu = document.createElement('div');
    menu.className = 'cm-table-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cm-table-menu-item';
      b.setAttribute('role', 'menuitem');
      b.textContent = (it.checked ? '\u2713 ' : '') + it.label;
      b.disabled = !!it.disabled;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        it.run();
      });
      menu.append(b);
    }
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - mr.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(r.bottom + 2, window.innerHeight - mr.height - 4))}px`;
    const onDown = (ev: Event): void => {
      if (!menu.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    const close = (): void => {
      menu.remove();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (this.menu === menu) {
        this.menu = null;
        this.closeMenu = null;
        if (this.sel && this.dom.isConnected) this.dom.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    this.menu = menu;
    this.closeMenu = close;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  // ---- resizing

  private resizer(kind: 'row' | 'col', i: number): HTMLElement {
    const h = document.createElement('div');
    h.className = kind === 'col' ? 'cm-col-resize' : 'cm-row-resize';
    h.title = kind === 'col' ? 'Drag to change the column width (double-click: automatic)' : 'Drag to change the row height (double-click: automatic)';
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const start = kind === 'col' ? e.clientX : e.clientY;
      if (kind === 'col') {
        // the first drag fixes every column at the width it has, so that only the dragged one changes
        for (let c = 0; c < this.nCols; c++) {
          if (!this.model.widths[c]) this.model.widths[c] = Math.round(this.table.querySelector<HTMLElement>(`th[data-c="${c}"]`)?.getBoundingClientRect().width ?? 140);
        }
        this.applyWidths();
      }
      const from = kind === 'col' ? this.model.widths[i]! : this.rowEl(i)?.getBoundingClientRect().height ?? MIN_ROW;
      const move = (ev: PointerEvent): void => {
        const d = (kind === 'col' ? ev.clientX : ev.clientY) - start;
        const v = Math.max(kind === 'col' ? MIN_COL : MIN_ROW, Math.round(from + d));
        if (kind === 'col') {
          this.model.widths[i] = v;
          this.applyWidths();
        } else {
          this.model.heights[i] = v;
          const tr = this.rowEl(i);
          if (tr) tr.style.height = `${v}px`;
        }
      };
      const up = (): void => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        this.write(false);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    h.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.mutate(() => void (kind === 'col' ? (this.model.widths[i] = null) : (this.model.heights[i] = null)), { row: kind === 'col' ? 0 : i, col: kind === 'col' ? i : 0 });
    });
    h.addEventListener('click', (e) => e.stopPropagation());
    return h;
  }

  private rowEl(r: number): HTMLTableRowElement | null {
    return (this.table.querySelector(`[data-r="${r}"]`)?.parentElement as HTMLTableRowElement | null) ?? null;
  }

  // ---- writing it back

  /** Where the table is in the page now (its text and size comment). */
  private range(): { from: number; to: number } | null {
    let from: number;
    try {
      from = this.view.posAtDOM(this.dom);
    } catch {
      return null;
    }
    return tableAt(this.view.state, from);
  }

  /** Replace the table's text by what the grid holds now. */
  write(structural: boolean): void {
    const at = this.range();
    if (!at) return;
    const insert = this.text();
    if (this.view.state.doc.sliceString(at.from, at.to) === insert) {
      this.structural = false;
      return;
    }
    if (structural) this.structural = true;
    this.view.dispatch({ changes: { from: at.from, to: at.to, insert }, userEvent: structural ? 'input.table' : 'input.type' });
  }
}

interface MenuItem { label: string; run: () => void; disabled?: boolean; checked?: boolean }

function selectContents(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The caret's offset within the text of a cell. */
function offsetIn(el: HTMLElement, sel: Selection): number {
  if (!sel.anchorNode || !el.contains(sel.anchorNode)) return -1;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}

// ---------------------------------------------------------------- the widget

export class TableWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(o: TableWidget): boolean {
    return o.text === this.text;
  }
  override get estimatedHeight(): number {
    return (this.text.split('\n').filter((l) => l.trim() !== '').length - 1) * 35 + 60;
  }
  override toDOM(view: EditorView): HTMLElement {
    const model = readTable(this.text);
    if (!model) {
      const wrap = document.createElement('div');
      wrap.className = 'cm-table-wrap';
      return wrap;
    }
    return new TableEditor(view, model).dom;
  }
  /** A change that came from the grid itself leaves it as it is (so typing is not interrupted); any other change draws it again. */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const ed = editors.get(dom);
    if (!ed || ed.structural || ed.text() !== this.text) return false;
    ed.view = view;
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------- copying a table out of the raw text

/**
 * Copying text that lies inside one table (shown as Markdown because the cursor is in it) puts the cells on the
 * clipboard as a spreadsheet wants them, not as pipes: tab-separated text, and an HTML table.
 */
export function tableCopy(): Extension {
  return EditorView.domEventHandlers({
    copy(e, view) {
      const sel = view.state.selection.main;
      if (sel.empty || !e.clipboardData) return false;
      const at = tableAt(view.state, sel.from);
      if (!at || sel.from < at.from || sel.to > at.to) return false;
      const a = view.state.doc.lineAt(sel.from);
      const b = view.state.doc.lineAt(sel.to);
      const rows: string[][] = [];
      for (let n = a.number; n <= b.number; n++) {
        const t = view.state.doc.line(n).text;
        if (META_RE.test(t) || !t.includes('|')) continue;
        const cells = splitRow(t);
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        rows.push(cells);
      }
      if (rows.length === 0) return false;
      // a selection inside one line is a piece of text, not cells
      if (a.number === b.number && rows.length === 1 && sel.from > a.from) return false;
      e.preventDefault();
      e.clipboardData.setData('text/plain', cellsToTsv(rows));
      e.clipboardData.setData('text/html', cellsToHtml(rows, true));
      return true;
    },
  });
}
