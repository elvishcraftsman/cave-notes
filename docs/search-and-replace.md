# Search and replace

The search pane (the magnifier above the page tree) also replaces. Press **Replace** in its toolbar.

- The search box and the filters above choose **which pages** are looked in. Leave them empty for every page of the workspace, or type a search (`under:"Sermons" status:draft`) to keep to the pages it finds.
- **Find** is plain text, or a regular expression with the `.*` button. **Aa** matches case; **ab** matches whole words only (in a regular expression, write `\b`).
- **Replace with** is the new text. In a regular expression `$1`, `$&` and `$<name>` stand for what was matched.
- **Look in** decides which parts of a page are searched; turn a part off to keep it out of the results:
  - **Text**: paragraphs, lists, quotations, tables.
  - **Headings**.
  - **Attributes**: the YAML block at the top of the page.
  - **Code**: fenced code blocks.
  - **File names**: the names of pages. Matching pages are renamed, and links to them follow.
- A match never crosses a line, so `^` and `$` are the ends of a line.

The list shows every match as it is now and as it would become (red and green), grouped by page. Everything is ticked at first: untick a match, or a whole page, to leave it alone; click the line number to open the page there. **Replace N** asks once, then makes exactly the ticked changes. A page that changed while you were looking is left alone and named in the message. The earlier text of every changed page stays in its history (right-click a page, History).

Pages marked `hidden: search` (or `all`) are not offered by the plain search, but they are looked in here: this looks in files, not in search results.
