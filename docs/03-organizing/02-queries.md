# Queries, saved queries and views

A query is a line of text that picks pages. You type one in the search bar, and a view in a page uses one to list pages as a table, list, gallery, board or calendar.

## Writing a query

Words and terms are separated by spaces. A page must match all of them.

| You write | It finds |
|---|---|
| `grace` | Pages containing the word. Every word also matches the start of longer words, so results appear as you type (`theo iii` finds “Theology III”). Put a word in quotes to match it exactly. |
| `"justification by faith"` | The exact phrase. |
| `-heresy` | Pages that do **not** contain the word. |
| `title:grace`, `body:grace` | The word in the title, or in the body (headings included). |
| `status:draft` | Pages whose `status` is `draft`. Capitals don't matter. |
| `status:draft,review` | `status` is either. |
| `-status:done` | `status` is not `done`. |
| `tags:a tags:b` | A list attribute that has both. |
| `name:Gr*` | A value that starts with `Gr`. |
| `due:<2026-12-01`, `weight:>=5` | Comparisons: `<`, `<=`, `>`, `>=`. |
| `due:2026-01-01..2026-03-31`, `weight:..10` | A range. Leave one end empty for no limit. |
| `has:due` | Pages that have a `due` attribute. |
| `mtime:<$now.day-30`, `mtime:$now.week`, `mtime:>2026-01-01` | When the page's file was last changed, in the same terms as a date attribute (`$now` periods, dates, ranges). `mtime:<$now.day-30` is "not touched for 30 days". |
| `is:orphan` | Pages nothing links to. Others: `broken` (has a broken link), `ambiguous`, `virtual` (a folder with no page), `leaf` (no sub-pages), `root` (top level), `note` (notes only) and `file` (other files: images, PDFs and so on). |
| `under:"Theology/Soteriology"` | Every page below that page. Give a path, file name, title or alias. |
| `over:\"Theology/Soteriology\"` | The opposite of `under`: every page *above* that page (its parent, grandparent and so on up to the top). |
| `parent:Grace` | Only the direct parent of that page. |
| `children:Grace` | Only the direct sub-pages of that page, not their sub-pages. (`under:` gives all depths.) |
| `doctrine:[[Scripture]]` | Pages whose `doctrine` attribute is a *link* to the page Scripture. See below. |
| `links-to:Grace` | Pages that link to Grace. |
| `backlinks:Grace` | The same, from the other side: pages linking to Grace. |
| `linked-from:Theology` | Pages that Theology links to. |
| `path:soter`, `heading:imputation` | Part of the path, or a heading. |
| `sort:due`, `sort:-title`, `sort:rank,title` | The order. `-` reverses it. You can sort by `rank` (best text match), `title`, `name`, `path`, `mtime` (last change), `order`, or any attribute. Pages without the attribute go last. |

Pages hidden from queries (`hidden: queries`, `all` or `true`; see [Attributes and inheritance](01-attributes.md)) are left out of every result, views and automation rules included, unless the query mentions `hidden`: `hidden:queries` finds every page hidden from queries (the `all` and `true` ones too), `hidden:all` only the ones that say `all`. Pages that are only hidden from the search pane, the page tree or the sub-page bar still show in views and rules. Templates (`template: true`) count as `hidden: all` unless they have a `hidden` attribute of their own, so a query that names `template` (`template:true`, `has:template`) is the way to list them.

**Pages as attribute values.** `doctrine: [[Scripture]]` in a page's frontmatter is a link to the page Scripture, not the word "Scripture" (you do not need quotes around it). To find the pages that link to a page in an attribute, put the page in `[[ ]]`: `doctrine:[[Scripture]]`, or `doctrine:$this` in a view on the Scripture page. `doctrine:Scripture` without brackets finds pages where the attribute is the plain word. Inside a query that has spaces, quote it: `project:\"[[River Bible]]\"`.

Put quotes around a value that has spaces: `owner:"Ann Lee"`. A term that isn't finished (`status:`) is ignored while you type.

## Views

A view is a block in a page. Insert one from the menu (**Insert Database View**) or with **Ctrl+Alt+V**. It looks like this in the file:

````
```view
type: table
query: under:$this status:todo,doing
sort: due
columns: [title, status, due]
```
````

| Setting | Meaning |
|---|---|
| `type` | `table` (the default), `list`, `gallery`, `kanban` or `calendar`. |
| `title` | A heading shown above the view. |
| `query` | Which pages to show. Everything above works. |
| `sort` | The order, like `due` or `-due`. A `sort:` written in the query itself wins. |
| `columns` | What to show for each page, in this order: `title`, `path`, `modified`, `filename`, `filetype`, any attribute, or a relation (see below). Without it, the title and the most common attributes. |
| `newFields` | The fields the **+ New** row asks for, in this order, when they should differ from the shown `columns`: `newFields: [title, type, priority]`. Without it the row asks for the shown columns. The Properties button has a second list for it. Whatever the view's filters imply (`type:task` sets `type`) is still filled in. |
| `group` | Board: the attribute whose values become the columns. Tables and lists: any property to group by, including `title`, `modified`, `filename` and `filetype`. |
| `groupDir` | `desc` puts the last group first (default `asc`). |
| `date` | Calendar: the attribute that places a page on a day. |
| `cover` | Gallery: an attribute holding an image path, relative to each page. |
| `limit` | The most pages to show. Default 200, at most 1000. |
| `relationFiles` | `link` or `skip`: what a relation column does with a file that cannot name this page back (see [Editing a relation](#editing-a-relation)). Without it, you are asked. |

`$this` stands for the page holding the view, and `$parent` for its parent page. `under:$this` lists everything below the current page.

You can change settings with the buttons on the view (type, filter, properties, sort) or by editing the text. Editing a value in a table or board changes that page's own attributes.

## Several views in one block

A `view` block can hold several views. They are an ordinary YAML list under `views:`, one `- ` item per view; the views show as tabs beside the **New** button, with the icon of their type and their name:

````
```view
views:
  - name: Projects        # optional; leave it empty for just the icon
    type: table
    query: under:$this type:project
    columns: [title, type]
  - name:
    type: gallery
    query: !Projects      # the query of the view called Projects
  - name: Complete
    type: list
    query: !Projects status:complete   # that query plus more filters
    columns: [title]
```
````

- `!Name` at the start of a query takes the query of the view with that name; more filters can follow. Use `!"Two words"` for a name with spaces.
- The tab that is open is remembered in the block: choosing another tab puts `open: true` on that view and takes it off the others, and the block opens on the view that has it (the first view when none does; the first view never needs the mark). You can set it by hand too. It is not written in a page that cannot be edited.
- A block with no `views:` list is a single view whose settings stand at the top. (The older way of repeating `view:` lines is not valid YAML and is no longer read; the editor says so if it finds it.)
- At the right of the toolbar are the CSV export, the code button (edit the block as text) and an expander that shows every other control: type (a dropdown), name, grouping, Filter, Properties, Sort, Colors, and **+ View** / **Remove view**. An open pane's button is highlighted and the pane has a close button in its corner.

## Dragging pages in

- A page dragged from the page tree, the search results or the sub-page bar **into the text** becomes a link to it.
- Dragged **onto a view**, it gets the attributes the view's filters name, so that it shows up there. In a grouped table or list, a board column or a calendar day it also gets that group's value.
- If the view wants its pages in a place (`under:`, `children:`) and the dragged page is not there, nothing is changed: that would mean moving the file.
- **New** in a view creates the page under the page named by `under:`, or, without one, under the page that holds the view.
- Right-clicking a row, a card or a sub-page button opens the same menu as in the page tree.

## Saved queries

A saved query is a query with a name. Use it anywhere, so you write it once.

**Make one** in a view: open **Filter**, then **Save as query…** and give it a name. The view now says `query: saved:name`.

Or write it by hand under `queries:` in a settings file of the workspace (usually `.cave-notes/workspace.yaml`), next to the other settings:

```yaml
queries:
  open-tasks: status:todo,doing
  projects:
    query: kind:project
    title: All projects
```

A plain text value is the query. Use the longer form to add a `title`, which is shown in menus.

**Insert a view of one:** select some text (or right-click) in a page to get the formatting menu. Beside **Insert database view** there is a small arrow: it lists the workspace's saved queries, and choosing one inserts a view that shows it.

**Edit one from a view:** a view that uses a saved query shows its name as a chip; **Ctrl+Click** the chip to open the definition and change it. Every view using it changes too. A saved query can also be written into a sentence: `[[?saved:open-tasks]]` (see [Links, embeds and footnotes](../02-writing/01-linking.md)).

**Use one** by writing `saved:name`, alone or with more terms:

```
saved:open-tasks
saved:open-tasks owner:ann -tags:later
saved:"my open tasks"
```

- It works in the search bar and in a view's `query`.
- A saved query can use other saved queries. One that uses itself is reported and ignored.
- `$this` and `$parent` inside a saved query work in views, and mean the page holding the view.
- A `sort:` inside a saved query is used unless the view has its own `sort`.
- Names are not case-sensitive. Quote names with spaces. `-saved:name` is not allowed; write the opposite query instead.
- Edit the file and every view that uses the query updates.

**Saved queries of other workspaces.** Write `saved:Workspace::name` for the saved query *name* of the workspace called *Workspace* (its folder name). Quote it when there are spaces: `saved:"My Notes::open tasks"`. It is run in that workspace, by its own index, and its pages are added to the result. Pages of another workspace can never also be pages of this one, so such a term can only be one of the alternatives of an `OR`:

```
saved:Theology::open-tasks
status:todo under:Projects OR saved:Theology::open-tasks
saved:open-tasks OR saved:Theology::open-tasks OR saved:"My Notes::open tasks"
```

- It works in a view's `query`, also through a local saved query: save `status:todo OR saved:Theology::open-tasks` as `all-tasks` and use `saved:all-tasks`. A saved query of another workspace can in turn use saved queries of its own, and ones of a third workspace; one that leads back to itself is reported and left out.
- Next to other terms (`status:todo saved:Theology::open-tasks`), inside a `NOT` or negated (`-saved:Theology::open-tasks`) it is reported under the view and left out.
- The pages are marked with **⧉**, are shown but not edited here (no selecting, dragging or changing values), and open their own workspace in a tab when clicked.
- The other workspace's saved query is read from its settings and run on its index. That workspace opens in the background if it is not open yet; its index is as current as the last time that workspace was open, or this computer saw it change.
- One `sort:`, written in the query or set in the view, orders the pages of all workspaces together; without one they are ordered by title. A `sort:` inside the saved query of another workspace does not order the joined result.
- It works in views only, not in the search bar or in `[[?…]]` query links in text. A relation's `from` and `to` are names of saved queries of this workspace, and such a query may include one of another workspace; see [Relations that reach other workspaces](#relations-that-reach-other-workspaces).
- Workspaces are found by folder name, in the open tabs and among the workspaces this computer knows (the same names as in `[[Workspace::Page]]` links).

**Insert one into a page.** Open the menu: each saved query is listed below **Insert Database View** as *Insert “name”* (the first eight). It adds a view block that shows it. In an existing view, **Filter**, then **Saved query**, adds one to the query.

## Relations

A relation connects two saved queries, like a Notion relation property. Pages in one name pages in the other through an attribute.

Say each task has a `project` attribute naming a page:

```yaml
---
kind: task
project: "[[River Bible]]"
---
```

(Put `[[...]]` in quotes. A plain page name works too: `project: River Bible`.)

Declare the relation under `relations:`, in the same file as the queries or another one:

```yaml
queries:
  tasks: kind:task
  projects: kind:project
relations:
  - name: Project
    from: tasks
    attribute: project
    to: projects
    reverse: Tasks
```

| Field | Meaning |
|---|---|
| `from` | The saved query of the pages that name others (the tasks). |
| `attribute` | The attribute they name them in. |
| `to` | The saved query of the pages that get named (the projects). |
| `name` | The column in a view of `from`. Defaults to the attribute's name. |
| `multiple` | Optional. `false` if the attribute holds one page only (a task has one project). Default `true`. |
| `reverse` | Optional. The column in a view of `to`, listing the pages that name each one. Worked out from the first attribute; it cannot be edited. |
| `backattribute` | Optional. Makes the relation *mutual*: the attribute in the `to` pages that names the `from` pages back. Both are stored, and the app keeps them in step. |
| `backname` | The column of the other side (the same as `reverse`; use either). Defaults to the `backattribute` with a capital. |
| `backmultiple` | Whether `backattribute` holds one page or several. Default `true`. |

Then ask for the columns by name:

````
```view
type: table
query: saved:tasks
columns: [title, status, Project]
```
````

Each task shows its project as a link. A view of the projects can use `columns: [title, Tasks]` to show each project's tasks. Click a link to open the page. The Properties button lists the relation columns too.

### Editing a relation

Click a relation cell in a view (or Tab to it and press Enter) to change it. A field opens with the pages already named as chips and a list of the pages the relation can name; type to narrow it to titles that start with what you typed, use the arrow keys and Enter (or click) to choose. In a `multiple` cell you can add several and remove one with its **×** or Backspace; in a single cell choosing a page closes the field. Enter on an empty field, **Esc**, Tab or a click elsewhere closes the list and saves what you chose. Nothing is written, and nothing is asked, while you are still choosing.

Changes to a relation are made one at a time, each starting from what the one before wrote, so adding several pages quickly keeps every one of them.

**A file that cannot name the page back.** In a mutual relation the other page is changed too. A file that is not a note (a PDF, an .odt) has no page of its own to hold the link, so you are asked what to do: link it from this page only, or leave it out. Tick **Do this every time in this table** and the answer is written into the view as `relationFiles: link` or `relationFiles: skip`, and you are not asked again in that view. Delete the line to be asked again. The choice is kept per view, so other tables still ask.

### Relations that reach other workspaces

A relation's `from` and `to` are saved queries of this workspace, and a saved query can include one of another workspace (`status:todo OR saved:Theology::open-tasks`, see [Saved queries](#saved-queries)). Then the relation can name pages of that workspace too:

- The list of pages to choose from also holds the pages the other workspace's saved query finds, marked with the workspace's name.
- A page of another workspace is written as a link that names its workspace, `project: "[[Theology::Projects/Plan]]"`, and shown in the cell with **⧉**. Click it to open that workspace at the page.
- With a `backattribute`, the link back is written **in the other workspace's file**, naming this workspace: `tasks: "[[My Notes::Write intro]]"` in *Plan*. Taking the page out of the cell takes the link out of that file, and the other rules apply as for pages here (a side that holds one page is asked about, a page that cannot be changed is asked about, a file changed on disk since it was read is read again before it is written).
- The other workspace's file is changed directly; its own window, if open, shows the change like any other change to a file. The file gets no entry in that workspace's page history.
- The page is chosen from what the other workspace's index says, so that index should be current: with **Keep all workspaces indexed** on (Preferences) it is. A link written by hand is shown as it is written, whether or not the page belongs to the relation.
- A file that is not a note (an .odt, a PDF) can be named too. Its attributes, the back attribute included, are written where a file's attributes always live: in the `files:` block of the page of the folder it is in (`Education.md` for a file in `Education/`), or in the workspace settings for a file at the top level. The file itself is never changed. Clicking such a file in a relation opens it with its own program, also when it belongs to another workspace.
- A saved query that has an OR is used as one unit wherever other terms follow it, so narrowing what you type in the list applies to all of it.
- A workspace is found by its folder name, among those this computer knows; a link to a workspace that cannot be found is left as it is when you change other pages in the cell.

### Mutual relations

Add `backattribute` and both sides are stored and kept in step:

```yaml
relations:
  - name: Project
    from: tasks
    attribute: project
    multiple: false          # a task has one project
    to: projects
    backattribute: tasks     # each project lists its tasks in "tasks:"
    backname: Tasks
    backmultiple: true
```

Edit the **Project** cell of a task and the project's `tasks:` list changes too. Edit the **Tasks** cell of a project and each task's `project:` changes. Taking a page out of one side takes the other out of its. `from` and `to` may be the same query with the same attribute on both sides (`attribute: related`, `backattribute: related`) for a symmetric relation. Links already written on one side only (by hand, or before the relation was mutual) are left alone until you edit that cell; only the pages you add or remove are touched.

When something is in the way you are asked once you leave the field, with a choice for each case:

- **A single-page side already holds another page.** Linking a task that already has a project to a different one: *Move it* (the old project loses the task), *Don't link it* (the rest of the change still happens) or *Cancel*.
- **The other page cannot be changed** (it has no file, its attributes are unreadable, it changed while saving): *Link from this page only*, *Don't link it* or *Cancel*. The same three exist for removing a link.
- A page changed on disk while saving is tried again once on its own. Pages already written are put back if a later one fails, so a change goes through completely or not at all.

Rules:

- Only pages that belong to the queries count. A task naming a page that isn't in `projects` shows nothing; a page that isn't in `tasks` is not listed under a project.
- An attribute may hold several pages: `project: [Alpha, Beta]`.
- Pages in a relation column can be changed right in the view; see *Editing a relation* below. The other column of a relation that is not mutual (no `backattribute`) is worked out from the first and is read-only.
- Column names must be different from each other, and from the attribute names you use as columns.
- A mistake in a saved query or relation (an unknown query name, say) is skipped, and the rest still works. A `saved:` name that doesn't exist shows as an error under the view that uses it.

## Examples

**A to-do list under this page**

```
query: under:$this status:todo,doing
sort: due
```

**A reading board**

````
```view
type: kanban
query: kind:book
group: status
```
````

**Pages nothing links to** (to tidy up): `is:orphan -is:virtual`

**What links here, newest first:** `links-to:$this sort:-mtime`

**Overdue:** `due:<2026-10-11 -status:done` (use today's date; queries have no "today" word)

**A shared definition.** Save `status:todo,doing` as `open`. A board of open tasks anywhere in the workspace is `saved:open`, and a table under one project is `saved:open under:$this`.

**Projects and their tasks.** Save `kind:project` as `projects` and `kind:task` as `tasks`, declare the relation above, then put a view with `query: saved:projects` and `columns: [title, Tasks]` on a dashboard page.

## Groups: AND, OR, NOT

Terms are ANDed. Use `OR` between terms, `NOT` (or `-`) in front of one, and parentheses to group:

```
status:todo (owner:ann OR owner:bo) NOT tags:later
-(status:done OR status:dropped)
```

`AND` is allowed but never needed. `OR` binds looser than the implied AND, so `a b OR c` means `(a b) OR c`. `OR`, `AND`, `NOT` must be written in capitals; in lower case they are ordinary words. `sort:` always works at the top level.

## Today and dates

`$now` stands for today. A period of it is a range:

| Write | Means |
| --- | --- |
| `due:$now.day` | due today |
| `due:$now.week` | this week (starts on the day chosen in Preferences, Sunday by default) |
| `due:$now.month`, `due:$now.year` | this month, this year |
| `due:$now.month-1`, `due:$now.week+1` | last month, next week |
| `due:<$now.day` | before today (overdue) |
| `due:>$now.month` | after the end of this month |
| `due:$now.month..$now.month+2` | from the start of this month to the end of the month after next |

## Date parts (any year)

To match on one part of a date whatever the rest is, add `.year`, `.month`, `.day`, `.weekday` (1 = Monday) or `.week` (week of the year, weeks start on the first day of the week from Preferences) to the attribute name:

```
birthday.month:$now.month                      # birthdays this month, any year
birthday.month:$now.month birthday.day:$now.day   # birthdays today
birthday.month:11..2                           # November to February (a range may wrap)
due.year:<2020                                 # due in a year before 2020
due.weekday:6,7                                # due on a weekend
```

`$now.month`, `$now.day` and so on are the current number for the part when used this way; `$now.month+1` is next month (wrapping after December).

## Files

Every page, and every file in the folder, can be queried. Hidden files (names starting with a dot) and anything inside another workspace are left out. All of them have two attributes without you writing anything: `filename` (with extension) and `filetype` (the extension, lower case).

```
under:$this filetype:pdf,docx          # documents under this page
filename:Report*  sort:filetype,filename
is:file -filetype:png
```

Files have no other attributes unless a `files:` block gives them some (see attributes.md). Files are found when the workspace is scanned.

## View settings

````
```view
type: table
query: under:$this
sort: [due, title]        # several criteria: first decides, the next break ties
group: status             # tables and lists can be grouped
pageSize: 25              # rows per page (0 = all); a pager appears under the view
colors:
  - when: "due:<$now.day -status:done"
    color: red            # red orange yellow green blue purple brown gray, or #rrggbb
  - when: "status:done"
    color: gray
```
````

The first colour rule whose query matches a page colours its row. The **+ New** button above a view opens a row of fields; Enter or Save makes the page, with the values your filters imply (`status:todo` starts the Status field at `todo`), inside the page named by `under:`. The download button exports every row of the view as CSV.

**Properties** lists every property: tick the ones to show, and drag them (or use the arrows) to change their order. The headings of a table can be dragged too. Dates, ticks and choices take only the room they need; text takes the rest.

**Several pages at once.** Tables and lists have a tick box on each row. With rows ticked, a bar offers **Duplicate**, **Move…**, **Delete** and **Set attribute** (one attribute, one value, on all of them; **Remove** takes it away). A duplicate's file name gets `.1` (or its `.number` goes up to the next free one); its title is copied exactly. **Duplicate** is also in the page tree's menu. Sub-pages are copied along.

In **New**, a date field starts on today.


## Notes and files: `is:note` and `is:file`

Queries find notes by default. Other files in the workspace (images, PDFs, audio ...) are in the index too, and `is:file` finds them; `is:note` finds notes only.

- `is:file` lists every file that is not a note. Add words to narrow it: `is:file report`.
- `is:file (png OR jpg)` finds files by name; `path:Attachments is:file` limits it to a folder.
- `is:note` or `-is:file` leaves files out. `is:file OR is:note` brings back both.
- Files have no text of their own, so only their names, folders and any attributes given to them in a `files:` block can be searched.
