import type { AttrValue, AttributeKey } from '../../shared/api';
import { coerceValue } from '@cave-notes/ui-views';
import type { Controller } from '../controller';
import { keyInfo } from './cells';

/**
 * Spreadsheet-style keyboard use of a table: arrows move between cells, Enter or F2 edits the cell, Space ticks a checkbox,
 * Ctrl+D fills the cell down from the one above, and pasting text copied from a spreadsheet (tabs and lines) fills cells from
 * the focused one. Cells are the `td[data-col]` of the table; rows of other workspaces, folders without a page file, computed
 * columns and the title/path/modified columns are never written.
 */

const DATA_ROWS = 'tbody tr:not(.vb-group-row):not(.vb-footer)';
const NOT_WRITABLE = new Set(['title', 'path', 'modified', 'filename', 'filetype']);

const cellOf = (el: EventTarget | null): HTMLTableCellElement | null => (el as HTMLElement | null)?.closest?.('td[data-col]') ?? null;
const dataRows = (table: HTMLElement): HTMLTableRowElement[] => [...table.querySelectorAll<HTMLTableRowElement>(DATA_ROWS)].filter((r) => r.querySelector('td[data-col]'));
const cellsOf = (row: HTMLTableRowElement): HTMLTableCellElement[] => [...row.querySelectorAll<HTMLTableCellElement>('td[data-col]')];

const inField = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Can the cell be written (a plain attribute of a page of this workspace)? */
export function writable(td: HTMLElement, computed: Set<string>, isRelation: (k: string) => boolean): boolean {
  const col = td.dataset.col ?? '';
  return td.dataset.readonly !== 'true' && !NOT_WRITABLE.has(col) && !computed.has(col.toLowerCase()) && !isRelation(col);
}

const coerce = (text: string, info: AttributeKey | undefined): AttrValue | null => coerceValue(text, info);

export interface GridContext {
  ctl: Controller;
  keys: AttributeKey[];
  computed: Set<string>;
  isRelation: (k: string) => boolean;
}

export function onGridKeyDown(e: KeyboardEvent, g: GridContext): void {
  const td = cellOf(e.target);
  if (!td || inField(e.target) || (e.target as HTMLElement) !== td) return; // a field inside the cell has its own keys
  const table = td.closest('table') as HTMLElement | null;
  if (!table) return;
  const rows = dataRows(table);
  const tr = td.parentElement as HTMLTableRowElement;
  const ri = rows.indexOf(tr);
  const ci = cellsOf(tr).indexOf(td);
  const focus = (r: number, c: number): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, r))];
    const cells = row ? cellsOf(row) : [];
    const cell = cells[Math.max(0, Math.min(cells.length - 1, c))];
    if (cell) { cell.focus(); cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  };
  const mod = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); focus(ri + 1, ci); return;
    case 'ArrowUp': e.preventDefault(); focus(ri - 1, ci); return;
    case 'ArrowRight': e.preventDefault(); focus(ri, ci + 1); return;
    case 'ArrowLeft': e.preventDefault(); focus(ri, ci - 1); return;
    case 'Home': e.preventDefault(); focus(ri, 0); return;
    case 'End': e.preventDefault(); focus(ri, 1e6); return;
    case 'Enter': case 'F2': {
      e.preventDefault();
      const inner = td.querySelector<HTMLElement>('input, select, textarea, [tabindex="0"]');
      if (inner) { inner.focus(); return; }
      // text shows as text until clicked: click it, then put the caret in the field that appears
      (td.querySelector('.vb-cellbox > *, .vb-edit > *') as HTMLElement | null)?.click();
      setTimeout(() => td.querySelector<HTMLElement>('input, textarea, select')?.focus(), 0);
      return;
    }
    case ' ': {
      const box = td.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (box) { e.preventDefault(); box.click(); }
      return;
    }
    case 'Delete': case 'Backspace': {
      if (!writable(td, g.computed, g.isRelation)) return;
      e.preventDefault();
      void g.ctl.setPageAttribute(td.dataset.path!, td.dataset.col!, null);
      return;
    }
    case 'd': case 'D': {
      if (!mod || ri < 1) return;
      e.preventDefault();
      const above = cellsOf(rows[ri - 1]!)[ci];
      if (!above || !writable(td, g.computed, g.isRelation)) return;
      const text = (above.querySelector('.vb-cellbox')?.textContent ?? '').trim();
      void g.ctl.setPageAttribute(td.dataset.path!, td.dataset.col!, coerce(text === '—' ? '' : text, keyInfo(g.keys, td.dataset.col!)));
      return;
    }
    default:
  }
}

/** Text pasted onto a focused cell fills the cells from there down and across (a single value fills just that cell). */
export function onGridPaste(e: ClipboardEvent, g: GridContext): void {
  const td = cellOf(document.activeElement);
  if (!td || inField(e.target)) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (text === '') return;
  e.preventDefault();
  const table = td.closest('table') as HTMLElement;
  const rows = dataRows(table);
  const ri = rows.indexOf(td.parentElement as HTMLTableRowElement);
  const ci = cellsOf(td.parentElement as HTMLTableRowElement).indexOf(td);
  const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
  let written = 0;
  for (let r = 0; r < grid.length; r++) {
    const row = rows[ri + r];
    if (!row) break;
    const cells = cellsOf(row);
    for (let c = 0; c < grid[r]!.length; c++) {
      const cell = cells[ci + c];
      if (!cell || !writable(cell, g.computed, g.isRelation)) continue;
      void g.ctl.setPageAttribute(cell.dataset.path!, cell.dataset.col!, coerce(grid[r]![c]!, keyInfo(g.keys, cell.dataset.col!)));
      written++;
    }
  }
  if (written > 1) g.ctl.toast(`Filled ${written} cells.`);
}
