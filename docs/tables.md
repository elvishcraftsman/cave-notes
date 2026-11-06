# Tables

Insert a table from the formatting menu (right-click in the text, then the grid button): a 2 × 2 table, ready to type in.

- **Type** in any cell. Tab and Shift+Tab move between cells (Tab in the last cell adds a row), Enter moves down, Esc leaves the table.
- **Rows and columns**: the grips (⋮⋮) along the top and left open a menu to insert, delete and align. The **+** bars at the right and bottom add a column or row. **Edit as text** (`</>`) shows the Markdown.
- **Resize**: drag the edge of a column grip or row grip; double-click the edge to make it automatic. Sizes are saved in one comment line under the table, `<!-- cave-table: cols=120,,200 rows=,48 -->`, which other Markdown programs ignore.
- **Select cells**: drag across them, Shift+click, or click a grip to select a row or column. Delete clears them.
- **Spreadsheets**: Ctrl+C on selected cells copies tab-separated text plus an HTML table, so Excel, LibreOffice and Google Sheets paste them as separate cells. Cells copied from a spreadsheet paste into the grid, which grows to fit. Text selected in the raw Markdown copies the same way.
