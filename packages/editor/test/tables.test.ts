import { describe as suite, expect, it } from 'vitest';
import { NoteEditor, blankTable, cellsToHtml, cellsToTsv, insertTable, parseTsv, readTable, serializeTable, sortTable, sortedRowOrder, tableMetaLine, type TableExportFormat } from '../src/index';

function make(text: string, cursor?: number): { ed: NoteEditor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text);
  ed.view.dispatch({ selection: { anchor: cursor ?? text.length } });
  return { ed, el };
}

const DOC = 'Intro\n\n| A | B |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |\n\nend';

suite('table text', () => {
  it('writes a padded pipe table and reads it back', () => {
    const m = readTable('| A | B |\n|:--|--:|\n| one | 2 |')!;
    expect(m.align).toEqual(['left', 'right']);
    expect(serializeTable(m)).toBe('| A   | B   |\n| :-- | --: |\n| one | 2   |');
    expect(readTable(serializeTable(m))).toEqual(m);
  });

  it('escapes pipes and keeps line breaks as <br>', () => {
    const m = blankTable(2, 2);
    m.rows[0] = ['a|b', 'x\ny'];
    const text = serializeTable(m);
    expect(text).toContain('a\\|b');
    expect(text).toContain('x<br>y');
    expect(readTable(text)!.rows[0]![0]).toBe('a|b');
  });

  it('keeps sizes in a comment under the table, and leaves none when all are automatic', () => {
    const m = blankTable(3, 3);
    expect(serializeTable(m).split('\n')).toHaveLength(4);
    m.widths = [120, null, 200];
    m.heights = [null, null, 48];
    expect(tableMetaLine(m)).toBe('<!-- cave-table: cols=120,,200 rows=,,48 -->');
    const back = readTable(serializeTable(m))!;
    expect(back.widths).toEqual([120, null, 200]);
    expect(back.heights).toEqual([null, null, 48]);
  });

  it('is a 2 x 2 table when inserted', () => {
    const t = blankTable(2, 2);
    expect(t.head).toHaveLength(2);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toHaveLength(2);
  });
});

suite('cells for spreadsheets', () => {
  it('makes tab-separated text with quoting, and strips Markdown marks', () => {
    expect(cellsToTsv([['**a**', 'b'], ['x\ty', '[[Page|shown]]']])).toBe('a\tb\n"x\ty"\tshown');
  });
  it('makes an HTML table, escaped', () => {
    expect(cellsToHtml([['a<b', 'c']], true)).toBe('<table><tr><th>a&lt;b</th><th>c</th></tr></table>');
  });
  it('reads what a spreadsheet copies', () => {
    expect(parseTsv('a\tb\r\n"c\nd"\t"e""f"\r\n')).toEqual([['a', 'b'], ['c<br>d', 'e"f']]);
  });
});

suite('the table grid', () => {
  it('draws an editable grid with grips, in place of the text', () => {
    const { el } = make(DOC);
    expect(el.querySelectorAll('.cm-table-cell')).toHaveLength(6);
    expect(el.querySelectorAll('.cm-col-grip')).toHaveLength(2);
    expect(el.querySelectorAll('.cm-row-grip')).toHaveLength(3);
    expect(el.querySelector('.cm-table-cell')!.getAttribute('contenteditable')).toBe('plaintext-only');
  });

  it('shows the raw text while the cursor is inside the table', () => {
    const { el } = make(DOC, DOC.indexOf('| 1') + 3);
    expect(el.querySelector('.cm-table-grid')).toBeNull();
  });

  it('writes a typed cell back into the Markdown without redrawing the grid', () => {
    const { ed, el } = make(DOC);
    const grid = el.querySelector('.cm-table-grid')!;
    const cell = el.querySelector<HTMLElement>('[data-r="1"][data-c="0"]')!;
    cell.focus();
    cell.textContent = 'one';
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.text()).toContain('| one | 2 ');
    expect(el.querySelector('.cm-table-grid')).toBe(grid);
  });

  it('adds a row and a column with the + buttons', () => {
    const { ed, el } = make(DOC);
    el.querySelector<HTMLElement>('.cm-table-add-row')!.click();
    expect(ed.text().split('\n').filter((l) => l.startsWith('|'))).toHaveLength(5);
    el.querySelector<HTMLElement>('.cm-table-add-col')!.click();
    const head = ed.text().split('\n').find((l) => l.startsWith('| A'))!;
    expect(head.split('|').length - 2).toBe(3);
    expect(el.querySelectorAll('.cm-table-cell')).toHaveLength(12);
  });

  it('inserts and deletes rows and columns from the grips', () => {
    const { ed, el } = make(DOC);
    const pick = (label: string): void => {
      [...document.querySelectorAll<HTMLElement>('.cm-table-menu-item')].find((b) => b.textContent?.includes(label))!.click();
    };
    el.querySelector<HTMLElement>('[data-grip="row"] button')!.click(); // header row grip
    pick('Insert row below');
    expect(ed.text()).toMatch(/\| A\s+\| B\s+\|\n\|[^\n]+\n\|\s+\|\s+\|\n\| 1/);
    el.querySelectorAll<HTMLElement>('[data-grip="row"] button')[1]!.click();
    pick('Delete row');
    expect(ed.text()).not.toMatch(/\|\s+\|\s+\|\n\| 1/);
    el.querySelectorAll<HTMLElement>('[data-grip="col"] button')[0]!.click();
    pick('Delete column');
    expect(ed.text()).not.toContain('| A');
    expect(ed.text()).toContain('| B');
  });

  it('will not delete the header row or the last column', () => {
    const { el } = make('| A |\n| --- |\n| 1 |\n\nend');
    el.querySelector<HTMLElement>('[data-grip="row"] button')!.click();
    const del = [...document.querySelectorAll<HTMLButtonElement>('.cm-table-menu-item')].find((b) => b.textContent === 'Delete row')!;
    expect(del.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    el.querySelector<HTMLElement>('[data-grip="col"] button')!.click();
    expect([...document.querySelectorAll<HTMLButtonElement>('.cm-table-menu-item')].find((b) => b.textContent === 'Delete column')!.disabled).toBe(true);
  });

  it('selects cells from a grip and copies them as tab-separated text and an HTML table', () => {
    const { el } = make(DOC);
    el.querySelectorAll<HTMLElement>('[data-grip="row"] button')[1]!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.querySelectorAll('.cm-cell-selected')).toHaveLength(2);
    const store: Record<string, string> = {};
    const ev = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { setData: (k: string, v: string) => (store[k] = v) } });
    el.querySelector('.cm-table-wrap')!.dispatchEvent(ev);
    expect(store['text/plain']).toBe('1\t2');
    expect(store['text/html']).toBe('<table><tr><td>1</td><td>2</td></tr></table>');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('pastes cells copied from a spreadsheet, growing the table', () => {
    const { ed, el } = make(DOC);
    el.querySelector<HTMLElement>('[data-r="2"][data-c="1"]')!.focus();
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { getData: (k: string) => (k === 'text/plain' ? 'x\ty\nz\tw' : '') } });
    el.querySelector('.cm-table-cell[data-r="2"][data-c="1"]')!.dispatchEvent(ev);
    expect(ed.text()).toMatch(/\| 3\s+\| x\s+\| y\s+\|/);
    expect(ed.text()).toMatch(/\|\s+\| z\s+\| w\s+\|/);
  });

  it('copies cells selected in the raw text as tab-separated text', () => {
    const { ed } = make(DOC, DOC.indexOf('| 1') + 3);
    const from = DOC.indexOf('| A');
    const to = DOC.indexOf('| 3') + 9;
    ed.view.dispatch({ selection: { anchor: from, head: to } });
    const store: Record<string, string> = {};
    const ev = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { setData: (k: string, v: string) => (store[k] = v) } });
    ed.view.contentDOM.dispatchEvent(ev);
    expect(store['text/plain']).toBe('A\tB\n1\t2\n3\t4');
  });

  it('inserts a 2 x 2 table after the cursor line', () => {
    const { ed, el } = make('Hello', 5);
    insertTable(ed.view);
    expect(ed.text()).toBe('Hello\n\n| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |\n\n');
    expect(el.querySelectorAll('.cm-table-cell')).toHaveLength(4);
  });
});

suite('sorting a table by a column', () => {
  const col = (cells: string[]): string[][] => cells.map((c) => [c]);
  it('puts numbers in order of value, not of spelling', () => {
    const rows = col(['10', '9', '1,200', '$3.50', '(2)', '12%']);
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual(['(2)', '12%', '$3.50', '9', '10', '1,200']);
    expect(sortedRowOrder(rows, 0, 'desc').map((i) => rows[i]![0])).toEqual(['1,200', '10', '9', '$3.50', '12%', '(2)']);
  });
  it('puts dates in order of time, in any of the written forms', () => {
    const rows = col(['4 Mar 2026', '2025-12-31', 'January 5, 2026']);
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual(['2025-12-31', 'January 5, 2026', '4 Mar 2026']);
  });
  it('sorts words without regard to case or accents, and numbers inside words in their natural order', () => {
    const rows = col(['banana', 'Apple', 'élan', 'item 10', 'item 9', 'cherry']);
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual(['Apple', 'banana', 'cherry', 'élan', 'item 9', 'item 10']);
  });
  it('does not read a code with a leading zero as a number, but still sorts it in natural order', () => {
    const rows = col(['10001', '02134', '9']);
    expect(sortedRowOrder(rows, 0, 'asc').map((i) => rows[i]![0])).toEqual(['9', '02134', '10001']);
  });
  it('leaves empty cells last whichever way it goes, and rows that tie where they were', () => {
    const rows = [['b', '1'], ['', '2'], ['a', '3'], ['b', '4'], ['', '5']];
    expect(sortedRowOrder(rows, 0, 'asc')).toEqual([2, 0, 3, 1, 4]);
    expect(sortedRowOrder(rows, 0, 'desc')).toEqual([0, 3, 2, 1, 4]);
  });
  it('keeps the header first and the heights of rows with their rows', () => {
    const m = readTable('| N | V |\n| - | - |\n| c | 3 |\n| a | 1 |\n| b | 2 |\n<!-- cave-table: rows=,30,,50 -->')!;
    sortTable(m, 0, 'asc');
    expect(m.head).toEqual(['N', 'V']);
    expect(m.rows.map((r) => r[0])).toEqual(['a', 'b', 'c']);
    expect(m.heights).toEqual([null, null, 50, 30]);
  });
  it('is in the column menu and written to the page', () => {
    const { ed, el } = make('| N | V |\n| - | - |\n| c | 3 |\n| a | 1 |\n| b | 2 |\n');
    el.querySelectorAll<HTMLElement>('[data-grip="col"] button')[1]!.click();
    [...document.querySelectorAll<HTMLElement>('.cm-table-menu-item')].find((b) => b.textContent?.startsWith('Sort descending'))!.click();
    expect(ed.text().split('\n').filter((l) => /^\| [abc]/.test(l)).map((l) => l[2])).toEqual(['c', 'b', 'a']);
  });
});

suite('exporting a table', () => {
  it('has export entries only when the app says how, and hands over plain cells', () => {
    const plain = make(DOC);
    plain.el.querySelectorAll<HTMLElement>('[data-grip="col"] button')[0]!.click();
    expect([...document.querySelectorAll('.cm-table-menu-item')].some((b) => /Export/.test(b.textContent ?? ''))).toBe(false);
    plain.ed.destroy();

    const got: Array<[TableExportFormat, string[], string[][]]> = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el, onExportTable: (f, t) => got.push([f, t.head, t.rows]) });
    ed.load('| **Name** | [Link](http://x.y) |\n| --- | --- |\n| *a* | 2 |\n');
    ed.view.dispatch({ selection: { anchor: 0 } });
    el.querySelectorAll<HTMLElement>('[data-grip="col"] button')[0]!.click();
    [...document.querySelectorAll<HTMLElement>('.cm-table-menu-item')].find((b) => b.textContent?.includes('(.xlsx)'))!.click();
    expect(got).toHaveLength(1);
    expect(got[0]![0]).toBe('xlsx');
    expect(got[0]![1]).toEqual(['Name', 'Link']);
    expect(got[0]![2]).toEqual([['a', '2']]);
  });
});
