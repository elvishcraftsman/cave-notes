# Templates and dynamic blocks

For links, buttons, query links and footnotes see [linking.md](linking.md).

Two things share one idea: write something once, use it in many places.

## Dynamic blocks: `![[…]]`

A one-line call that shows content kept somewhere else. It works on a line of its own (drawn as a block) and inside a sentence (drawn as text).

| Write | It shows |
|---|---|
| `![[Page]]` | the whole page, without its attributes |
| `![[Page#Heading]]` | the text under that heading, up to the next heading of the same or a higher level |
| `![[@name]]` | a template block called *name* (see below) |
| `![[@name#Heading]]` | only the part of that block under a heading |

The call is read-only on the page. **Hover it and click Edit** to change the source: a text box opens, **Save** writes the source (so every page that shows it changes), **Cancel** or Esc leaves it alone. Put the cursor in the call itself to see and change it as text. Calls inside code are left alone. A call that cannot be filled (no such page, no such heading) shows a warning with the reason.

A ` ```view ` block in the text it shows is drawn as a query view, not as code, and `$this` in it (and in `[[?query]]`) is **the page the text is inserted in**, never the page it comes from. Changes you make to such a view's settings last only while it is shown; the source is not touched. In the same way `${this.name}` in the text is an attribute of the page the text is inserted in (see [Values from attributes](linking.md#values-from-attributes)), so one shared block shows each page's own value.

## Templates

A template is a page with `template: true` in its attributes. Template pages never show in the page tree.

Where it lives decides where it is offered:

- **As a sub-page of any page.** It is offered for that page's sub-pages, and for theirs, down the tree.
- **In `.cave-notes/templates/`.** It is offered everywhere in the workspace (these need no `template: true`). The folder syncs with the workspace.

When two templates share a name, the nearest one wins.

### What a new page gets

- **Choosing one.** *New Page* has a *Start from* list when templates are on offer: the default, *Blank page*, or any template by name.
- **A default for sub-pages.** Put `childTemplate: Name` in a page's attributes, or in one of its `children:` blocks, and new sub-pages start from that template. A page's own setting beats its parents'.
- **Applying one to an existing page.** Right-click a page → *Apply Template…*. If the page already has content, it asks before replacing it; Ctrl+Z undoes it.

A page made from a template gets its text and its other attributes. `template` and `childTemplate` are not copied, so it is not itself a template. In the text:

- `{{title}}` becomes the page's title, and `{{date}}` today's date (2026-10-17).
- A `# title` heading is added if the template has none.

### Template pages can hold dynamic blocks

A template may contain `![[…]]` calls. They are copied as calls, so a page made from the template keeps showing the shared content.

### Example

`Projects/Task.md`:

```markdown
---
template: true
status: todo
---
## Notes for {{title}}

![[@checklist]]
```

`Projects.md`:

```markdown
---
childTemplate: Task
---
```

`.cave-notes/templates/checklist.md` holds the checklist; edit it once (or via Edit on any page that shows it) and every task changes.

## Seeing and editing your templates

**Show Unlisted Files/Templates.** A page with `template: true` counts as `unlisted: true` unless it has an `unlisted` attribute of its own (`unlisted: false` makes a template an ordinary page). Unlisted pages stay out of the page tree, search and queries. The button beside **New** in the sidebar toolbar shows every unlisted page, templates and others (outlined with a dashed border, in italics); click it again to hide them. The arrow beside it opens a small menu with the same switch. `hidden: true` pages stay hidden either way. To list templates in a query use `template:true`.

**The workspace config folder.** *Open Workspace Config Folder* in that menu opens the workspace's `.cave-notes` folder in a new tab, as a light workspace: a page tree, the editor and nothing else (no index, no schema of its own, no search). It makes the `.cave-notes` folder if it is missing, but no files: you make them yourself with New Page. A new page at the top level is a `.yaml` settings file (the settings can stay in separate files or move into any one file, see [workspace-files.md](workspace-files.md)); a page inside `templates` is a Markdown template. Templates open as pages; the YAML files open as plain text, without the Markdown preview. The tab wears the workspace's colour and a gear.

## Templates of the app

Templates kept in the app config folder (`templates/`, opened with **Open App Config Folder** from the arrow beside *Show unlisted files and templates*; see [Workspace settings files](workspace-files.md#the-app-config-folder)) are offered in every workspace, after the workspace's own: a template of the workspace with the same name wins. In the template list they are marked as coming from *the app*.

