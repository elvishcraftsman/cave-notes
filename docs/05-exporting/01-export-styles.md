# Export styles

A style set says how an exported page looks: paper, fonts, headings, blockquotes, footnotes. Export a page to Word (.docx), OpenDocument (.odt) or PDF from the page menu; when it is done, a window offers to show the file in the file manager or open it. The export window's preview shows the pages as they will print, with their breaks and how many there are. Open **Preferences → Import and export → Export Styles…** (or **Edit Styles…** in the export window) to see and change the sets next to a sample page.

## Where they are kept

- **This workspace:** the `export-style:` section of a file in `.cave-notes/styles/` (one style per file or several in one; new ones go into `styles/export-styles.yaml`), or of any settings file in `.cave-notes` (a style in the main folder wins over one in `styles/`; see [Workspace settings files](../06-workspaces/01-workspace-files.md)). It travels with the notes.
- **All workspaces:** `styles/export-styles.yaml` in the app config folder. **The styles that come with the app (Clean, Manuscript and Report) are written there the first time the app runs**, so you can edit them like your own; delete one from the file and the built-in version is used again. A new style you make is kept there too, unless you choose *This workspace* in the window. Any other YAML file in that `styles/` folder (for example one added with **Add From a File…**) is read as well, and the styles in `export-styles.yaml` win over them. (The window edits it; the first time, an older `export-styles.yaml` from the app's data folder is moved there).

A set of the same name in the workspace wins over one for all workspaces, which wins over a built-in one (Clean, Manuscript, Report).

## The file

One entry per set. Everything is optional: what you leave out comes from the built-in *Clean* set, or from the set named in `base`.

```yaml
My Report:
  base: Report              # start from another set
  units: in                 # cm or in: what bare numbers in lengths mean
  page: { size: Letter, margin: 1in }     # A4, Letter or A5
  body: { font: Libre Baskerville, size: 11pt, color: "#202020", lineHeight: 1.5, justify: true, spaceAfter: 6pt, firstLineIndent: 0.5in, indentAfterHeading: false }
  h1: { font: Open Sans, size: 22pt, color: "#7a1f1f", bold: true, italic: false, before: 0pt, after: 12pt }
  h2: { size: 16pt }        # h1 to h6
  code: { font: Inconsolata, size: 9pt, color: "#222222", background: "#eeeeee" }
  blockquote: { color: "#444444", italic: true, indent: 1cm, bar: "#7a1f1f" }
  link: { color: "#7a1f1f", underline: false }
  list: { indent: 0.8cm }
  table: { headerBackground: "#eeeeee", border: "#999999" }
  footnotes: { size: 9pt, color: "#333333", italic: false, placement: endnotes }
  title: { fromPage: true } # the page's title as a heading when it has none
  header: { right: "{title}" }   # running text; see Headers, footers and page numbers
  footer: { center: "{page}" }
  styles:                   # named paragraph styles for ::: blocks (see below)
    poem: { indent: 2cm, italic: true, after: 0pt }
  css: ""                   # extra CSS for HTML and PDF
```

## Every setting, defined

Each line says what the setting does and what it is measured in. Where two settings look alike, the difference is spelled out.

### Spacing: `before`, `after`, `spaceAfter`

All three are **vertical gaps** (a length; a bare number counts in points) and they only differ in *what they belong to*:

| Setting | Belongs to | Meaning |
|---|---|---|
| `body.spaceAfter` | every ordinary body paragraph | The gap left **below each paragraph** of running text, before whatever comes next. |
| `h1.before` … `h6.before` | that heading level | The gap **above the heading**, between it and what came before. |
| `h1.after` … `h6.after` | that heading level | The gap **below the heading**, between it and the text that follows. |
| `before` / `after` in a `styles:` entry | paragraphs written in that named style (`::: poem`) | The gap above and below *each paragraph of that style*, replacing `body.spaceAfter` for them. |

So `after` and `spaceAfter` are the same kind of gap on different things: `spaceAfter` is the one for body text (there is no `body.before`), and `after` is a heading's (or a named style's) own. Word and OpenDocument add the gap below one block to the gap above the next; HTML and PDF let the two gaps share the space (the larger one wins), so a heading with a large `before` right under a paragraph with a large `spaceAfter` can sit a little tighter in a PDF.

### Page and text

| Setting | Meaning |
|---|---|
| `units` | `cm` or `in`: what a bare number means in *page* measures (`margin`, `indent`, `firstLineIndent`). Type measures (`size`, `before`, `after`, `spaceAfter`) are always points when bare. |
| `page.size` | The paper: `A4`, `Letter` or `A5`. |
| `page.margin` | The margin on all four sides, between the paper's edge and the text (and where headers and footers sit: halfway into it). |
| `body.font` | Font family of running text. Word and LibreOffice need it installed; see Fonts below. |
| `body.size` | Type size in points. |
| `body.color` | Text colour, `"#rrggbb"`. |
| `body.lineHeight` | Line spacing as a multiple of the type size: `1.5` is one and a half lines, `2` is double. |
| `body.justify` | `true` spreads each line to both margins; `false` leaves the right edge ragged. |
| `body.firstLineIndent` | How far the **first line** of each paragraph is pushed in (see below). `body.indent` is another name for it. |
| `body.indentAfterHeading` | `false` leaves the paragraph right after a heading flush left. |

### Headings (`h1` … `h6`)

`font`, `size` (points), `color`, `bold`, `italic` and `lineHeight` work as for the body. `before` and `after` are the gaps above and below the heading (see Spacing).

### Everything else

| Setting | Meaning |
|---|---|
| `code.font`, `code.size`, `code.color` | The type of code, inline and in blocks. |
| `code.background` | The shading behind code blocks. |
| `blockquote.indent` | How far each level of quote is moved in from the left margin. |
| `blockquote.bar` | The colour of the vertical bar down the quote's left edge. |
| `blockquote.color`, `blockquote.italic` | The quote's text colour and whether it is slanted. |
| `link.color`, `link.underline` | How links look. |
| `list.indent` | How far each level of a list is moved in; the bullet or number hangs in that space. |
| `table.headerBackground` | Shading of the header row. |
| `table.border` | Colour of the lines between cells. |
| `footnotes.size`, `.color`, `.italic` | The type of notes. |
| `footnotes.placement` | `footnotes` (foot of the page) or `endnotes` (collected at the end). |
| `title.fromPage` | `true` prints the page's own title as a heading at the top when the page has none. |
| `styles:` | Your own paragraph styles for `:::` blocks (below). |
| `css:` | Raw CSS added to HTML, PDF and the editor (below). |

### Lengths

`2.5cm`, `25mm`, `1in` or `72pt`. A number without a unit counts in the set's `units` for page measures (`margin`, `indent`) and in points for type measures (`size`, `before`, `after`, `spaceAfter`). Colours are `"#rrggbb"`. A value that cannot be read is ignored and the base set's value is used. Whatever the unit you choose, the form shows and edits lengths in it too.

### First-line indents

`body.firstLineIndent` indents the first line of every body paragraph (`0.5in`, `1.27cm`; the default is none). It applies to ordinary paragraphs only: not to headings, lists, quotes, tables or footnotes. `indentAfterHeading: false` leaves the paragraph right after a heading flush left, as many books do.

A paragraph that a block quote cuts in two is **one paragraph**: the text after the quote is not indented as if it began a new one, as long as no blank line separates the parts. Because Markdown pulls a plain line that follows a quote into the quote, end the quote with a bare `>` line:

```
He wrote:
> Grace is not a thing we earn.
>
and the argument goes on from there.
```

With a blank line before or after the quote, each side is its own paragraph and is indented.

A paragraph can also go on after a **list**. A plain line right under a list is pulled into the list's last item, so the same trick is a line holding only `<!-- -->` (an HTML comment, which prints nothing) under the list:

```
There are three things to remember:
- grace
- faith
- works
<!-- -->
and none of them is earned.
```

The last line is not part of the *works* item, and in the export it goes on with the paragraph above the list: it is not indented as a new paragraph would be. Leave a blank line after the `<!-- -->` and it is a new paragraph again. Other Markdown programs show the comment as nothing and the last line as a paragraph of its own, so the page still reads well there.

The same works after a **block quote**. A plain line right under a quote is pulled into the quote (Markdown calls that a lazy continuation), so a line holding only `<!-- -->` under the quote ends the quote without ending the paragraph:

```
He said it plainly:
> Grace is not a thing we earn.
<!-- -->
and the argument goes on from there.
```

The quote is a quote, and the last line is outside it and goes on with the paragraph above the quote, without the indent of a new paragraph. A blank line after the comment makes it a new paragraph again.

### Hanging indents and your own paragraph styles

Write a block between two lines of colons (the notation Pandoc, Quarto and MyST use for "fenced divs", so other programs understand it too) and name the style after the opening colons:

```
::: hanging
Augustine. *Confessions*. Translated by Henry Chadwick. Oxford: Oxford University Press, 1991.

Aquinas, Thomas. *Summa Theologiae*. Notre Dame: Ave Maria Press, 1981.
:::
```

Every paragraph in the block takes the style. `::: {.hanging}` and Pandoc's `::: {custom-style="Name"}` mean the same; several names (`::: hanging wide`) combine, later ones winning. The closing line is `:::` alone. Blocks work at the top level of a page, and a `:::` line inside a code block is only text. In the editor the lines of a block are shown with the style, and the colon lines are dimmed.

### Blocks inside blocks, and leaving a block out of the word count

A block can hold other blocks, and a block can have several names. A block named **`nocount`** is **not counted in the word count** (the count in the status bar, and in the export window), with everything in it. A bibliography, for example, can be left out and still have its hanging indent, in either of two ways:

```
::: hanging nocount
Augustine. *Confessions*. Translated by Henry Chadwick. Oxford: Oxford University Press, 1991.

Aquinas, Thomas. *Summa Theologiae*. Notre Dame: Ave Maria Press, 1981.
:::
```

or with the block around the heading too:

```
::: nocount
# Bibliography
::: hanging
Augustine. *Confessions*. Oxford: Oxford University Press, 1991.

Aquinas, Thomas. *Summa Theologiae*. Notre Dame: Ave Maria Press, 1981.
::: :::
```

Each line of colons closes the innermost block that is open. A line of **several** (`::: :::`) closes that many at once, innermost first, so the two blocks above end on one line. `nocount` itself changes nothing on the page: it only says what is not counted. Footnotes are never counted.

Built-in styles: `hanging` (a 1.27 cm hanging indent), `noindent`, `center` and `right`. Change them or add your own under `styles:` in a set, or once for the whole workspace in a `styles:` section of any file in `.cave-notes` (a set's own definition wins; bare lengths in a workspace's `styles:` count in cm, so write units):

```yaml
styles:
  hanging: { indent: 1.27cm, hanging: 1.27cm }   # left margin, and how far the first line sticks out
  poem:    { indent: 2cm, italic: true, lineHeight: 1.2, after: 0pt }
  warning: { background: "#fff2cc", color: "#7a4b00", font: Open Sans, size: 10pt }
```

Properties: `indent` (left margin), `hanging`, `firstLineIndent`, `align` (`left`, `right`, `center`, `justify`), `font`, `size`, `color`, `background`, `bold`, `italic`, `lineHeight`, `before`, `after`. Word, OpenDocument, HTML, PDF and the editor all read them.

**Your own CSS.** `css:` (in a set, or as a `css:` section for the workspace) is raw CSS added to the editor, HTML and PDF. A block is `<div class="cn-NAME">` in exports and its lines carry `cm-div-NAME` in the editor. Word and OpenDocument files cannot use CSS, so use `styles:` for anything they should show:

```yaml
css: |
  .cn-poem > p { letter-spacing: 0.02em; }      /* exports */
  .cm-line.cm-div-poem { letter-spacing: 0.02em; }  /* editor */
```

### Blockquotes

The `blockquote` entry styles text that starts with `>` (older files that say `quote` still work).

### Footnotes

`placement: footnotes` puts the notes at the foot of the page, `endnotes` collects them at the end. Word and OpenDocument files get real footnotes (and real endnotes in OpenDocument). **PDF and the preview always collect the notes after the text**, because the printing engine cannot place notes per page. In Word, endnotes are written as a numbered *Notes* list at the end.

## Headers, footers and page numbers

`header:` and `footer:` put running text above and below the text of every page. Each has three places, `left`, `center` and `right`:

```yaml
My Report:
  footer:
    center: "{page}"                 # a page number in the middle of every page
  header:
    right: "{title}"
    firstPage: false                 # no header on the first page (a title page)
    size: 9pt
    color: "#666666"
```

In the text, `{page}` is the number of the page, `{pages}` how many pages there are and `{title}` the page's title (so `"Page {page} of {pages}"` works). Word and OpenDocument keep these as live fields, so they stay right when the file is edited.

**Odd and even pages** can differ, for a book that is bound on one side. Put the three places under `odd:` and `even:` (page 1 is odd):

```yaml
  footer:
    odd:  { right: "{page}" }        # the outer edge of a right-hand page
    even: { left: "{page}", center: "{title}" }
```

Places written beside `odd:` and `even:` apply to both, and either one can override them. A place left out is empty. `firstPage: false` leaves the first page without that header or footer (the footer, say, can stay while the header goes). `size` and `color` set the type; the font is the body font. Headers and footers sit halfway into the margin, so the margin must be large enough to hold a line of text.

The export window's preview shows each page's header and footer. They work in Word, OpenDocument and PDF files.

## Page and slide counts

Give a page the attribute `exportStyle: My Report` and the sidebar under the outline counts its **pages** (laid out as an export in that style would, with the engine that prints PDFs) as well as its words. The export window then starts with that style. Choosing another style there and exporting writes it into the page's `exportStyle` attribute, so the page remembers it; **Cancel, but save theme** (beside Cancel) saves the choice without exporting. The attribute can be handed down by `children:` to a whole folder (see [Attributes and inheritance](../03-organizing/01-attributes.md)). A page without it shows only words; a presentation (a page with `presentationTheme:`) shows **slides** instead. Word and LibreOffice may break a page or two differently from the PDF, so the count is exact for PDF and close for the others.

## Fonts

Linux Libertine, Crimson Pro, Libre Baskerville, Open Sans, Roboto and Inconsolata come with Cave Notes (all under the SIL Open Font License). They are used in previews and PDFs on any computer. Word and LibreOffice use fonts installed on the computer, so install the bundled ones to see the same there: **Export Styles → Fonts that come with Cave Notes → Install for Me** (copies them to `~/.local/share/fonts/cave-notes`), or **Save the Font Files…** to put them in a folder of your choice.

## What an exported file contains

Word and OpenDocument files are checked against pandoc and LibreOffice (and python-docx and odfpy) with the tests in `packages/core-export`; the same page reads back with the same headings, links, lists, tables, code and notes.

- A note referred to twice (`[^a]` used in two places) is written twice, each with its own number, as Word and LibreOffice number notes by reference.
- Tables are as GitHub reads them: every row has as many cells as the header, short rows are padded and extra cells ignored. A table inside a list item is written after the text that comes before it, and the list carries on with its numbering afterwards (OpenDocument cannot hold a table inside a list item).
- HTML tags in a page are not printed, only the text between them; text in angle brackets that is not HTML (`<like this>`) is kept. HTML comments are dropped.
- Images are written as their description in square brackets.
- A page that starts with `---` followed by a blank line is a horizontal rule, not front matter.
- Word and LibreOffice measure “140% line spacing” a little differently, so a page can break a line or two differently in the two programs even though the file says the same thing.
