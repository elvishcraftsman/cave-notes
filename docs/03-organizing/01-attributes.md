# Attributes and inheritance

Attributes are facts about a page: `status: done`, `due: 2026-12-01`, `tags: [a, b]`. Search and database views use them.

A page starts with **no attributes**. It gets them from three places.

## Where attributes come from

From weakest to strongest:

1. **Global attributes**, set once for the whole workspace. Every page gets them.
2. **`children:` blocks** in the pages above it. They hand attributes to sub-pages.
3. **The page's own attributes**, written at the top of its file.

A stronger source wins, one attribute at a time. Anything not overridden carries on.

## The rules

1. A page's own attributes apply to that page only. They are never passed down by themselves.
2. Global attributes and `children:` blocks are passed down. A page's own attributes do not interrupt them: if a page overrides `status`, its sub-pages still get the value that came from above.
3. A `children:` block reaches all sub-pages at every depth, unless you limit it.
4. A sub-page can override a handed-down value for itself, or for its own sub-pages with a `children:` block of its own. Only the attributes it names change.
5. An attribute is replaced as a whole. A list does not merge with another list.
6. The file itself is never rewritten. Inheritance is worked out when the page is indexed.

## Calculated attributes

A value written as one expression, `total: ${sum("under:$this", "cost")}`, is a formula: the file keeps the formula and the index holds the result, which stays current as other pages change. See [Expressions and formulas](03-expressions.md).

## Global attributes

Put them under `attributes:` in a settings file of the workspace (`.cave-notes/workspace.yaml` is the usual one; see [Workspace settings files](../06-workspaces/01-workspace-files.md)). Keep the other keys (`color`, `icon`) as they are.

```yaml
attributes:
  status: idea
  lang: en
```

Every page now has `status: idea` and `lang: en` unless something stronger says otherwise. Changes apply as soon as you save the file.

## Attributes for files that are not notes

Images, PDFs, Word files and the like can have attributes too, so they show up in views and queries. List them in a `files:` block, either in the frontmatter of a note or in a settings file of the workspace:

```yaml
---
files:
  map.png:
    status: done
    tags: [travel]
  Trip/scan.pdf:
    status: todo
---
```

A list works as well, naming the file in `file:`:

```yaml
files:
  - file: report.docx
    status: done
```

- In a note, a name is relative to the folder the note is in (then to the note's own sub-page folder). A leading `/` means the workspace root. In `workspace.yaml`, names are relative to the workspace root.
- A file gets only the attributes written for it: nothing is inherited, and the file is never changed.
- A file that cannot be found is skipped, with a warning on the note that lists it.
- In queries, `is:file` finds these files and `is:note` finds notes. Files have no body text, links or sub-pages.
- Names of notes (files whose type is one of the workspace's note types) cannot be listed here: notes have frontmatter of their own.

## Your own attributes

```yaml
---
status: done
due: 2026-12-01
---
```

## `children:` blocks

```yaml
---
children:
  status: todo
  owner: Ann
---
```

All sub-pages, at any depth, get `status: todo` and `owner: Ann`.

A block has two optional settings, then the attributes to hand down.

| Setting | Values | Meaning |
|---|---|---|
| `defaults` | `default` (if omitted), `inherit`, `original`, `none`, or a link to a page | What happens to attributes the block does not list |
| `inheritance` | `all` (if omitted), `children` | How far the block reaches |

**`defaults`**

| Value | Sub-pages get |
|---|---|
| `default` | Nothing extra. They keep whatever the workspace and the pages above hand down. |
| `inherit` | Every attribute this page has, including its own, at every depth. |
| `original` | Back to the workspace's global values. Whatever the pages above handed down is dropped. |
| `none` | A blank slate: no attributes except those listed. Every depth below is blank too. This page keeps its own. |
| a link | Every attribute of the page you link to, at every depth. |

```yaml
children:
  defaults: "[[Chapter Template]]"
```

Put the link in quotes. A page that can't be found changes nothing, and the page holding the block shows a warning. Change the linked page and every page that follows it updates. Only a link to a page works here; use `inherit` to follow the page the block is in.

```yaml
children:
  defaults: inherit
```

**`inheritance`**

| Value | Reaches |
|---|---|
| `all` | Every sub-page, at every depth. |
| `children` | Only the pages directly below. Their sub-pages are not affected. |

```yaml
children:
  inheritance: children
  status: todo
```

### Several blocks

Make `children:` a list. Each list item can have its own `inheritance`, so different attributes can reach different distances.

`defaults` only needs to appear in one item, in any position. Every item's `defaults` is applied first, then every item's attributes, top to bottom; a later item wins when two set the same attribute.

```yaml
children:
  - defaults: inherit
    inheritance: children    # direct sub-pages copy everything from this page
  - color: red               # every sub-page, at every depth, gets this
```

An item that has `defaults` uses its own `inheritance` for them. Here, only the direct sub-pages copy this page's values; `color` still reaches every depth.

## Empty, `none` and the three words

Use these as a whole value, on a page or inside a `children:` block. Capitals don't matter.

A **blank value** (`due:`, with nothing or only spaces after it) means the attribute is **there, with nothing in it**. Pages show it as an empty field in views, ready to fill in. It is how to give every sub-page a `due` before anyone has chosen a date. `none` is the opposite: the attribute is not there at all.

```yaml
children:
  due:            # every sub-page has a due date, empty for now
  reviewer: none  # and none has a reviewer
```

An empty attribute has no type of its own. Declare it in the `schema:` section (or in Workspace Preferences, under YAML) as `due: {type: date}` so its field is a date picker before any page has a date. Without that, it takes the type of the other values of the same name, and is a text field when nobody has set one.

In the workspace's `attributes:`, a blank value gives every page the attribute, empty. `inherit` and `none` there mean the same as leaving it out, since nothing is above the workspace.

| Word | Result |
|---|---|
| `inherit` | The parent's value (empty if the parent's is empty). If the parent has none, the attribute is left out. |
| `original` | The workspace's global value, whether a value or empty. If there is none, the attribute is left out. (`default` means the same here.) |
| `none` | The attribute is not there. |

Inside a `children:` block, `inherit` means *this page's* value, since that is the parent of the pages receiving it.

```yaml
status: inherit       # take my parent's status
due: original         # forget what the pages above set; use the workspace's due
reviewer: none        # no reviewer
```

## Pages as values

An attribute can name another page: `doctrine: [[Scripture]]` (quotes are optional; `"[[Scripture]]"` means the same). That is a link to the page, which is not the same as the plain word `doctrine: Scripture`. Queries tell them apart: `doctrine:[[Scripture]]` (or `doctrine:$this` on the Scripture page) finds pages linking to it, `doctrine:Scripture` finds the plain word. A list works too: `doctrine: [[[Scripture]], [[Grace]]]`. See [Queries, saved queries and views](02-queries.md#relations) for relations built on this.

### Relations, and `backattribute`

A **relation** (declared in `relations:`, see [Queries, saved queries and views](02-queries.md#relations)) is an attribute whose values are pages of a saved query, shown as clickable links in a view. Its fields:

| Field | Meaning |
|---|---|
| `from`, `to` | The saved queries of the pages that name others, and of the pages that get named. |
| `attribute` | The attribute the `from` pages name them in (`project: [[Plan]]`). |
| `name` | The column's name in a view of `from`. |
| `multiple` | `false` when the attribute holds one page. |
| `backattribute` | Makes the relation **mutual**: the attribute in the `to` pages that names the `from` pages back. Both sides are written, and the app keeps them in step. |
| `backname`, `backmultiple` | The other side's column name, and whether it holds one page or several. |

Without `backattribute` the other side is worked out from the first and is read-only. With it, editing either cell changes both pages' files.

## Reserved by Cave Notes

| Name | Where | What it does |
|---|---|---|
| `icon` | an icon name | The page's icon in the page tree and, in a gallery, in place of its initial. Set it from the page's right-click menu (**Set Icon…**). |
| `indicatorText` | text | Puts a **dot** at the right edge of the page's row in the page tree, to point the page out (a rule can set it: see [Actions](../04-automation/04-actions.md)). Hover over the dot to read the text, or click it for the text and two choices: **Dismiss** removes the `indicatorText` property, and **Ignore All for This Page** sets `ignoreIndicators: true`. |
| `ignoreIndicators` | `true` | The page never shows an indicator dot, whatever sets `indicatorText`. To undo it, right-click the page in the tree and choose **Show Indicators Again** (or remove the property by hand). |
| `hidden` | text or list | Where the page is hidden: `tree` (the page tree; `files` means the same), `children` (the sub-page bar), `search` (the search pane) and `queries` (views, rules and every other query; `query` means the same). Name one, several (`tree, children` or a list) or use `all` or `true` for all four. `false`, a missing attribute or any other word hides nothing. A query that names `hidden` finds hidden pages again: `hidden:queries` finds every page hidden from queries, `hidden: all` and `true` ones included. Rules and views still see pages that are only hidden from the tree, the sub-page bar or the search pane. The sidebar's **Show Unlisted Files/Templates** button shows the pages hidden from the tree (`files`, `tree`, `all` or `true`). Can be handed down with `children:`. A page with `template: true` is `hidden: all` unless it has a `hidden` of its own. |
| `exportStyle` | any attribute | The name of the export style set the page is exported in (see [Export styles](../05-exporting/01-export-styles.md)); the export window starts with it. A page that has one also shows its **page count** under the outline, next to the word count. Can be handed down with `children:`, so one line can set the style of a whole folder of chapters. A name that matches no style falls back to *Clean* (and the count is marked with ⚠). |
| `presentationTheme` | own only | Makes the page a presentation in the named slide theme (see [Presentations](../05-exporting/02-presentations.md)). The sidebar then shows a **slide count** instead of a page count. |
| `template` | any attribute | `true` marks a template (see [Templates and dynamic blocks](04-templates.md)). Counts as `hidden: all` unless the page sets `hidden` itself. |
| `aliases` | own only | Other names that `[[wikilinks]]` accept for this page. |
| `order` | own only | Sorts pages in the tree, lowest first. |
| `title` | own only | The page's title, when it has no title heading (a `# Heading` that is the first thing on the page, after the frontmatter; a level-1 heading further down is a section, not the title). |
| `children` | own only | Holds `children:` blocks. It is not an attribute. |
| `defaults`, `inheritance` | inside a block | The block's settings. They cannot be attribute names there. |
| `attributes`, `color`, `icon` | a settings file | Global attributes, and the workspace's look. |

- `aliases`, `order` and `title` describe one page. They are never handed down, and global or block entries for them are ignored with a warning.
- `inherit`, `original`, `default` and `none` can't be used as plain values. A page can't have `priority: none` meaning the word itself.
- Names are not case-sensitive: `Status` and `status` are the same attribute.
- Types (dates, choices, numbers) come from the `schema:` section of the settings files. They are separate from inheritance.

A mistake in a `children:` block (an unknown `defaults` value, say) shows as a warning on that page, and the rest of the block still applies.

## Examples

**A to-do list.** On the parent page:

```yaml
children:
  done: false
```

Every task under it has `done: false`; tick one and only its own file changes. A view with `query: under:$this` lists them.

**A shared status for a whole project.** On the project page:

```yaml
children:
  project: River Bible
  status: planning
```

Every page in the project, however deep, is `planning`. A page that finishes sets `status: done` and its own sub-pages stay `planning`.

**Hide an archive.** On the Archive page:

```yaml
children:
  hidden: true
```

**A workspace-wide default.** In `workspace.yaml`: `attributes:` with `status: idea` under it. New pages are `idea` until something says otherwise. On a page that should never show it: `status: none`.

**A section with different rules.** The workspace says `status: idea`, but pages under Journal need no status and have a mood:

```yaml
children:
  defaults: none
  mood: unset
```

Everything below Journal is a blank slate with only `mood`. Anything the pages above handed down is gone, at every depth.

**Copy a page's settings to its sub-pages.** Chapter 1 has `author: Lynn` and `draft: 2`, and wants all of its pages to match:

```yaml
author: Lynn
draft: 2
children:
  defaults: inherit
```

**Only the next level.** A Season page gives its episodes a status, and nothing below them:

```yaml
children:
  inheritance: children
  status: unwatched
```

**Mixed.** A Project page: direct sub-pages copy its owner and status, and every page below gets a colour:

```yaml
owner: Ann
status: active
children:
  - defaults: inherit
    inheritance: children
  - color: blue
```

**Reset one value part-way down.** Everything under Projects is `todo`; the Done page resets it to the workspace's value:

```yaml
# Projects/Done.md
children:
  status: original
```

**Reset everything part-way down.**

```yaml
children:
  defaults: original
```

**Sub-pages that follow a template.** The page *Chapter Template* holds the settings; every page under Book follows it:

```yaml
# Book.md
children:
  defaults: "[[Chapter Template]]"
  inheritance: all
```

## A folder without a page

`children:` lives in a page's frontmatter. A folder with no page file of its own can't hold one: create the page (`Folder.md` next to `Folder/`) and put the block there.

## Attribute types

Every value is read as text, a number, a date or true/false by looking at it: `3` is a number, `2026-11-01` is a date, `true` is a checkbox. To be certain (or to get a date picker or a dropdown before any page has a value), declare the attribute's type in the `schema:` section of a settings file (`.cave-notes/schema.yaml` is the usual place), or in Workspace Preferences under YAML. The section lists the attributes, each with a `type`:

```yaml
schema:
  due:      { type: date }
  done:     { type: bool }
  estimate: { type: number }
  status:   { type: select, values: [todo, doing, done] }   # `options:` works in place of `values:`
  tags:     { type: multiselect, values: [home, work, urgent] }
  notes:    { type: text }
```

| Type (also written as) | What it holds | In views and queries |
|---|---|---|
| `text` (`string`) | Any text. | Text box. `status:todo` finds a whole value, plain words search the text. |
| `number` | `3`, `-2.5` | Number box; compares with `<`, `>` and ranges (`estimate:1..5`). |
| `date` | `2026-11-01`, or with a time `2026-11-01 14:30`. A single-digit month or day is fine: `2026-11-1`. | Date picker; `due:<$now.day`, `due:$now.month` and so on (see queries.md). New rows start on today. |
| `bool` (`boolean`, `checkbox`) | `true` or `false` | Checkbox. |
| `select` (`enum`) | One of `values`. | Dropdown. |
| `multiselect` (`multi`, `list`) | Several of `values`, written as a list: `[home, work]`. | Dropdown with several choices. |

A value that does not fit its declared type (`due: tomorrow`) is kept as text and the page shows a warning.

### Values that imply other attributes

An attribute in the schema can say what each of its values brings with it, with `implies:`. This is how `template: true` already counts as `hidden: all`; now you can add your own:

```yaml
schema:
  type:
    type: select
    values: [task, note, project]
    implies:
      task: { hidden: true }
      project: { icon: folder-kanban }
```

Every page with `type: task` now behaves as if it also had `hidden: true`: it keeps out of the page tree, the sub-page bar, search and queries, and `hidden:true` finds it in a query. Things to know:

- The implied attribute is never written into the page's file. Take `type: task` away and `hidden` goes with it.
- A page's own word wins. A task that says `hidden: false` stays visible, and so does a page that gets `hidden: false` from a `children:` block.
- For a list (`multiselect`), any one of the values brings its attributes.
- An implied attribute can imply others, up to four steps. Names are not case-sensitive.
- `type` is an ordinary attribute name. Inside the schema it is also the word for an attribute's kind (`type: {type: select}` is the attribute `type`, written as a select), and the position tells them apart.

### Today's date as a default

Inheritance hands down fixed values, so a date that means "the day this page was made" is written as `$today` in the block. When a page is created under the page that holds it, the day is filled in once, and the page keeps that date from then on. Add a distance to count from today: `$today+7d`, `$today-1w`, `$today+1m` (d days, w weeks, m months, y years).

```yaml
children:
  hidden: true
  due: $today
```

Pages that already exist keep what they have; `$today` is only filled in for pages made after it was written.

## Settings shared with every workspace (`!global`)

Tag a section of a workspace's settings files (any of them, see [Workspace settings files](../06-workspaces/01-workspace-files.md)) with `!global` and the other workspaces on the same computer can use it too:

```yaml
attributes: !global
  status: idea
queries: !global
  open-tasks: status:todo,doing
```

```yaml
schema: !global
  due: { type: date }
```

You can also tag **one entry** and share only that, keeping its neighbours private:

```yaml
rules:
  - !global              # this rule is shared
    id: stamp-finished
    on: { change: status, to: done }
    do: [ { set_property: { completed_at: "${today}" } } ]
  - id: only-here        # this one is not
queries:
  open: !global status:todo,doing   # a value tagged like this is read as text
  mine: status:todo
```

Only what is tagged is offered. A tag on a section in one file never shares the same section of another file (`rules: !global` in one file and a plain `rules:` in another share only the first).

This works for `attributes`, `schema`, `queries`, `relations` and `rules` (automation rules, see [Writing a rule](../04-automation/01-rules.md)). The tagged sections apply to their own workspace as usual. Because they live in that workspace's files, they travel with it when it syncs between your computers.

- **Asking first.** When a workspace has not been asked about an offered section (or the offer changed since), it shows a window listing what is offered and which workspaces should take it. Your answers are kept on this computer only, never inside a workspace, so syncing does not carry them to another computer.
- **The workspace wins.** A section the workspace leaves out takes the shared one. A section with entries is merged over it by name, and the workspace's own entries win. A section that is present but empty switches the shared one off for that workspace.
- **Switching it all off.** *Preferences → Workspaces → Settings shared between workspaces* (on by default). Off, a workspace neither takes nor offers anything.
