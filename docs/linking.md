# Links, embeds and footnotes

Everything that points from one place to another, in one page. For templates and the `![[@name]]` blocks, see [templates.md](templates.md); for queries, [queries.md](queries.md).

## Links to pages

| Write | You get |
|---|---|
| `[[Grace]]` | A link to the page called Grace (its title, file name or an alias). |
| `[[Theology/Grace]]` | The same, by path. Use a path when two pages share a name. |
| `[[Grace\|God's favour]]` | The link shows *God's favour*. |
| `[[Grace#Imputation]]` | A link to a heading in the page. |
| `[text](Theology/Grace.md)` | An ordinary Markdown link; relative paths work. |

### Wikilink paths

| Write | Where it looks |
|---|---|
| `[[Grace]]` | By file name, then title or alias, anywhere in the workspace. With two matches the one nearest to this page wins; if they are equally near the link is ambiguous. |
| `[[Theology/Grace]]` | By path, from the workspace root first, then from this page's folder, then anywhere that ends with that path. |
| `[[/Theology/Grace]]` | A path from the **workspace root** only. |
| `[[./Grace]]`, `[[../Grace]]` | A path from **this page's folder**. |

### Ordinary Markdown links in detail

`[text](destination)` takes more than a plain path:

| Write | Meaning |
|---|---|
| `[x](Theology/Grace.md)` | Relative to the folder of the page the link is in. |
| `[x](/Theology/Grace.md)` | A **leading `/`** counts from the workspace root, so the link keeps working if the page holding it moves. (For a file that is not a note, a leading `/` is a path on the computer.) |
| `[x](Theology/Grace.md#Imputation)` | A heading in that page. `[x](#Imputation)` is a heading in this page. |
| `[x](My notes/Free grace.md)` | **A path with spaces.** Written as it is, it works. |
| `[x](<My notes/Free grace.md>)` | The same with the path in **angle brackets**, the standard way to allow spaces. Needed only when the path would otherwise be mistaken for a link with a title, or when it has a parenthesis in it. |
| `[x](My%20notes/Free%20grace.md)` | The same with `%20` for each space; other `%` codes are read too. |
| `[x](Grace.md "A tooltip")` | A title after the path, in quotes, as standard Markdown allows. A path with spaces *and* a title needs the angle brackets: `[x](<My notes/Grace.md> "A tooltip")`. |
| `[x][grace]` and, anywhere, `[grace]: Grace.md` | **Reference style**: the destination is written once and used many times. Renaming the page rewrites the one definition. |
| `<https://example.com>` | A web address written out as a link. Plain addresses (`https://…`, `mailto:`) typed in the text become links too. |
| `[x](file:///home/me/paper.pdf)` | A file by its full address. Links to the computer's own paths (`/home/me/…`, `C:\…`) are not changed when pages move. |

Links in code (`` `…` `` or a code block), in raw HTML and in the frontmatter are ignored, and a backslash switches one off: `\[[Grace]]`. Links that point outside the workspace (`../../elsewhere.md`) are kept as they are when something is renamed, with a warning.

**Ctrl+Click** a link to follow it. Put the cursor in a link to see and change it as text. Links are updated when you rename or move a page.

A broken link is drawn in red and an ambiguous one (two pages with that name) in amber. Both are listed in the Links tab, and `is:broken` / `is:ambiguous` find them.

### Links drawn as buttons

Start the label with `=`:

```
[[Grace|=Open the Grace page]]
```

It is drawn as a button, and **one click** goes to the page (no Ctrl needed). Ordinary Markdown links work the same way: `[=Open the Grace page](Grace.md)`, and so does `[=Our website](https://example.com)`. To change it, put the cursor next to it and press the arrow key: when the cursor reaches the button it opens up as text. The link counts as a link to Grace everywhere else (backlinks, rename).

### Buttons that run an automation

A button can also run a rule from the page's automations instead of opening something. Write the rule's `id` after `automation:`:

```
[=Mark as done](automation:finish-task)
```

It is always drawn as a button (the `=` is optional here), and a click runs the rule **for the page the button is in**, as if that page had just triggered it. The rule has to say it may be started this way (`on: button`), and the page still has to meet the rule's `where`. Say a page has a `kind: task` property and this rule exists:

```yaml
rules:
  - id: finish-task
    where: kind:task -status:done
    on: button
    do:
      - set_property: { status: done, completed_at: "${today}" }
```

Clicking **Mark as done** in a task page sets `status: done`. Clicking it in a page that is not a task, or is already done, does nothing and says why. The page is saved before the rule runs, so it sees what you just typed. See [Automation: buttons](automation.md#buttons-that-run-a-rule) for the details.

### Links that a query fills in

`[[?query]]` writes the pages a query finds, in the text, as links separated by commas:

```
Still open: [[?status:todo under:$this]].
Next: [[?status:todo sort:due|{title} ({due})]]
```

After the `|` you say how each page is written. `{title}`, `{name}` and `{path}` are the page, and any attribute can be put in braces. Saved queries work too (`[[?saved:open-tasks]]`), and `$this` means the page it is written in. At most 50 pages are shown. Ctrl+Click one to open it. A query link is not a link to a page, so it never shows as broken.

**As buttons.** Start the part after the `|` with `=` and each page is drawn as a button, like `[[Page|=Label]]`: `[[?doctrine:scripture|={title}]]`. One click opens it.

**Always current.** The list updates by itself when pages change, including when a file is edited elsewhere (another device, a sync). **In dynamic text.** A query link inside text that another page pulls in with `![[page]]` works the same: `![[systematic-theology]]` where that page holds `Writings: [[?doctrine:scripture|{title}]]` shows the pages. There `$this` means the page *showing* the text, so one shared block can say `under:$this`.

### Values from attributes: `${…}`

`${this.writing}` writes the value of the attribute `writing` of the page itself, right in the text. `${[[Grace]].writing}` reads it from another page, here the page Grace. The value is drawn underlined, so you can tell it from text you typed; hover it to see the expression. `${this.title}` is the title of the page. Attribute names are not case-sensitive.

```
My latest work is ${this.writing}.
Grace says: ${[[Grace]].summary}
```

- **A page is a link.** When the attribute names a page (`writing: [[On Grace]]`), the value is drawn as a link to it, written with the page's title. Ctrl+Click opens it. A list gives each value, separated by commas.
- **As a button.** To make a link out of the page an expression names, put the expression where the page name goes: `[[${this.writing}|={title}]]`. The part after `|` says how it is written, as in a [query link](#links-that-a-query-fills-in): `{title}` is the page, and `=` at the start draws it as a button, which opens the page with one click. Without a label, `[[${this.writing}]]` is a plain link. If the value is not the name of a page, it is shown in red.
- **Live.** The value is worked out again whenever the page, or the page it reads, changes. Edit the attribute and the text follows once the change is saved. An expression that cannot be worked out says why (no such page, or the page has no file yet); an attribute the page does not have is shown as *(empty)*.
- **While you write.** Put the cursor in an expression to see it as text and change it. Expressions inside code and in the attributes block at the top are left alone.
- **In dynamic text.** Inside text that another page pulls in with `![[page]]`, `this` is the page *showing* the text, as `$this` is, so one shared block can say `${this.writing}` and show each page's own value. `${[[Page]].name}` works there too.
- **Other workspaces and files.** When the attribute holds a link to a page of another workspace (`[[Theology::Grace]]`) or to a file in one (`[[Sync::1. Main Document.odt]]`), the value is drawn as a link marked ⧉ that opens that page, or the file with its own program. A link to a file of this workspace that is not a note is shown by the file's name only. Reading an attribute *of* a page in another workspace (`${[[Theology::Grace]].summary}`) is not possible yet.
- An expression is not a link to a page, so it does not show in backlinks and is never reported as broken.

## Links to other workspaces

| Write | You get |
|---|---|
| `[[Theology::Writings/Grace]]` | A link to the page `Writings/Grace` in the workspace called *Theology* (its folder name). |
| `[[Theology::Grace\|favour]]` | The same with a label; `#heading` works too. |
| `[x](cave://Theology/Writings/Grace.md)` | The same as an ordinary Markdown link. |

Following one (**Ctrl+Click**, or a click on a button-style link) opens that workspace in a tab of its own, if it is not open yet, with the page shown. The text of the link ends with **⧉** so that you can tell it from a link inside this workspace; web links end with **↗**. A link to another workspace is never broken or ambiguous here, and renaming or moving pages here does not change it. The Links tab lists them under *Other Workspaces*.

**Dragging.** Drag a page from the page tree, the sub-page bar or the search results into the text of a page to make a link; you can drop it anywhere in the editor, also on the empty space below a short page. Dragged from another window (another workspace), it becomes a link to that workspace. A file that is not a note, dragged from the sub-page bar, becomes an ordinary Markdown link to it, written relative to the page (an image can be embedded instead; you are asked). A file of another workspace cannot be linked this way.

**Saved queries of another workspace.** A view whose query is `saved:Theology::open-tasks` shows the pages that saved query of the *Theology* workspace finds. They are marked with ⧉, open that workspace when clicked, and cannot be edited from here. It can be joined to a query of this workspace by `OR`, like `status:todo OR saved:Theology::open-tasks`; see [queries.md](queries.md#saved-queries). A `[[?…]]` query link in text can use them too: `[[?status:todo OR saved:Theology::open-tasks]]` lists the pages of both workspaces. Pages of the other workspace are marked with ⧉ and open that workspace when clicked; `{workspace}` in the template (`[[?saved:Theology::open-tasks|{title} ({workspace})]]`) writes its name.

## Files and web addresses

| Write | You get |
|---|---|
| `[the PDF](../files/paper.pdf)` | A link to a file; it opens in its own program. |
| `[the site](https://example.com)` | A web link. |
| `![a picture](images/cave.png)` | An image, drawn in the page. |

Files that are not notes are listed in the bottom bar of the page and can have attributes through a `files:` block (see [attributes.md](attributes.md)).

## Embeds: showing something kept elsewhere

`![[…]]` shows the content of another page instead of linking to it. It works on a line of its own (a block) or inside a sentence.

| Write | It shows |
|---|---|
| `![[Page]]` | The whole page, without its attributes. |
| `![[Page#Heading]]` | The text under that heading. |
| `![[@name]]` | A template block called *name*. |
| `![[@name#Heading]]` | Only that part of the block. |

Hover an embed and click **Edit** to change its source; every page that shows it changes. Embeds inside code are left alone.

## Linked blocks and views

A `view` block shows a live list of pages (see [queries.md](queries.md)). Ctrl+Click the **saved query** chip on a view to open the definition of that query and edit it.

## Footnotes

```
Grace is a gift.[^1] It is not earned.[^note]

[^1]: The first footnote.
[^note]: A named one. It can go on
    over several lines if the next lines are indented.
```

- The mark is drawn as a small raised number. **Click** it to go to the footnote; click the number in front of the footnote to come back. **Hover** the mark to read the whole footnote in a box (it scrolls when it is long).
- Footnotes are **numbered by where they are first used**. When you add, move or delete a mark, the numbers and the footnotes below are put in order for you, in the same step as your edit (one Ctrl+Z undoes both). A page whose footnotes are out of order is put in order when you open it.
- Numbered labels are rewritten. A named label (`[^note]`) keeps its name and takes its place in the order.
- A mark with no footnote, or a footnote that nothing refers to, is left alone and not counted, so a half-written footnote is not rewritten while you type.
- **Ctrl+Alt+F** adds a mark at the cursor and an empty footnote at the end of the page, with the cursor in it.
- In exports, footnotes follow the page's [export style](export-styles.md): at the foot of the page, or as endnotes.
