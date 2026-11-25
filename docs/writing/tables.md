---
order: 2
---

# Tables

Insert a table from the formatting menu (right-click in the text, then the grid button): a 2 × 2 table, ready to type in.

- **Type** in any cell. Tab and Shift+Tab move between cells (Tab in the last cell adds a row), Enter moves down, Esc leaves the table.
- **Rows and columns**: the grips (⋮⋮) along the top and left open a menu to insert, delete and align. The **+** bars at the right and bottom add a column or row. **Edit as text** (`</>`) shows the Markdown.
- **Resize**: drag the edge of a column grip or row grip; double-click the edge to make it automatic. Sizes are saved in one comment line under the table, `<!-- cave-table: cols=120,,200 rows=,48 -->`, which other Markdown programs ignore.
- **Select cells**: drag across them, Shift+click, or click a grip to select a row or column. Delete clears them.
- **Spreadsheets**: Ctrl+C on selected cells copies tab-separated text plus an HTML table, so Excel, LibreOffice and Google Sheets paste them as separate cells. Cells copied from a spreadsheet paste into the grid, which grows to fit. Text selected in the raw Markdown copies the same way.
- **Sort**: the column grip's menu has **Sort ascending** and **Sort descending**. The rows are reordered in the Markdown itself, so any program sees the sorted table, and Ctrl+Z puts them back. Numbers (`1,200`, `$3.50`, `(2)`, `12%`) sort by value, dates (`2026-03-04`, `4 Mar 2026`, `March 4, 2026`) by time, and everything else as text, ignoring case and accents, with the digits in `item 9`, `item 10` in their natural order. A column is read as numbers or dates only when every filled cell is one. Empty cells always go last, the header stays on top, and rows that tie keep their order. Row heights move with their rows.
- **Export**: the same menu has **Export table as CSV…**, **Excel (.xlsx)…** and **OpenDocument (.ods)…** (in the desktop app). Cells are written as plain text, without the Markdown marks. In the Excel and OpenDocument files, numbers, percentages and dates are real values (so a sheet can add, sort and chart them), and the header row is bold and stays in view. A code with a leading zero such as `02134`, or a number of more than 15 digits, stays text, because a spreadsheet would change it. The CSV file has a byte-order mark so Excel reads accents correctly.

- **Values in cells**: a `${…}` expression in a cell is drawn as its value, the same as in the text of the page (see [Expressions and formulas](../organizing/expressions.md)), and kept up to date. Click the cell to see and change the expression. `${highlight(…)}` colours a cell's value.
- **Input cells**: a body cell that holds nothing but `${=this.name}` shows the attribute `name` of the page and is typed into like any other cell, but what you type is saved in the page's attributes, not in the table: the table keeps `${=this.name}`. Tab, Shift+Tab and Enter move between cells as usual and save as they leave. Several lines pasted into an input cell become one line with spaces between them (in other cells they fill the grid as described above). Input cells are drawn as fields: a light tint of the accent colour with a thin border, and the attribute's name in grey while the field is empty, so you can tell them from text at a glance. This turns a table into a small form: one row per item, input cells for what you count, and expression cells for what follows from it.

```
---
shop_collected: 50
shop_txns: 12.50 30
---
| Till | Collected | Expected | Difference |
| --- | --- | --- | --- |
| Shop | ${=this.shop_collected} | ${=this.shop_txns} | ${highlight(this.shop_collected - sum(numbers(this.shop_txns)), abs(this.shop_collected - sum(numbers(this.shop_txns))) > 5)} |
```

Sorting, copying and exporting use the text of the cells, so an input cell copies as `${=this.name}`.
- **Moving rows and columns**: drag a grip to move its row or column; a line shows where it will land. A click without moving still opens the grip's menu. The header row stays first. A column keeps its width and alignment, and a row its height. Ctrl+Z puts it back.
