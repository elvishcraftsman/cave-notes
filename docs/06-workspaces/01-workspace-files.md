# Workspace settings files

A workspace keeps its settings in YAML files in its `.cave-notes` folder. **Which file holds what does not matter.** The app reads every `*.yaml` and `*.yml` file in that folder and takes each section from wherever it finds it. Keep the settings in separate files (`schema.yaml`, `automations.yaml` and so on, made with New Page in *Open Workspace Config Folder*) or all in one. You can also share a setup as a single file, or just a part of one, and drop it into another workspace.

## The sections

Each section is a top-level key. The name tells the app what it is.

| Section | What it holds | Written as |
|---|---|---|
| `attributes:` | Attributes every page has ([Attributes and inheritance](../03-organizing/01-attributes.md)) | name: value |
| `files:` | Attributes of files that are not notes | path: attributes |
| `schema:` | The types of attributes (date, select, number …) | name: `{ type: … }` |
| `queries:` | Saved queries ([Queries, saved queries and views](../03-organizing/02-queries.md)) | name: query |
| `relations:` | Relations between saved queries, one-way or mutual (`from`, `to`, `attribute`, `multiple`, `backattribute`, `backname`, `backmultiple`; every field is defined in [Queries, saved queries and views](../03-organizing/02-queries.md#relations)) | a list |
| `rules:` | Automation rules ([Automations](../04-automation.md)) | a list |
| `settings:` | Settings of the automation engine | name: value |
| `export-style:` | Styles for exporting pages ([Export styles](../05-exporting/01-export-styles.md)) | style name: settings |
| `notes:` | Which files count as notes (`extensions`, `create`) | map |
| `presentation-themes`, `presentation-rules` | Slide themes and which layout each kind of slide gets (see [Presentations](../05-exporting/02-presentations.md)) | a map; a list |
| `styles`, `css` | Named paragraph styles for `::: name` blocks, and extra CSS (see [Export styles](../05-exporting/01-export-styles.md)) | a map; text |
| `color`, `icon`, `font`, `fontSize` | How the workspace looks | single values |

A key that is not in this list is reported as a warning and ignored, so a typo does not go unnoticed.

## One file for everything

```yaml
# .cave-notes/setup.yaml
color: "#3584e4"
schema:
  due:    { type: date }
  status: { type: select, values: [todo, doing, done] }
attributes:
  status: todo
queries:
  open: status:todo,doing
rules:
  - id: finish
    on: { change: status, to: done }
    do: [ { set_property: { property: done_on, value: $today } } ]
export-style:
  Plain:
    units: cm
    body: { font: Georgia, size: 12pt }
```

## The folders: `plugins/`, `styles/` and `templates/`

Beside the settings files, the `.cave-notes` folder has three folders. Cave Notes **always** puts what it makes into them: a new automation in `plugins/`, a new export style in `styles/`, a new template in `templates/`. You can arrange your own files however you like; the app reads them wherever they are.

```
.cave-notes/
  workspace.yaml            the main folder: your settings, which win over everything below
  schema.yaml
  plugins/
    estimate-pages.yaml     a simple plugin: one YAML file
    Chess.md                a bigger plugin: a notes page (its readme) ...
    Chess/                  ... and a folder of the same name with its files
      rules.yaml
      helpers.js
  styles/
    College paper.yaml      export styles, one file each or several in one file
  templates/
    Meeting.md              a template: one file
    Project kit.md          a template set: a notes page (its readme) ...
    Project kit/            ... and a folder of the same name; each page in it is a template
      Brief.md
      Plan.md
```

- A **plugin** is any combination of `schema`, `attributes`, `files`, `queries`, `relations`, `rules` and `settings` that comes as a unit. A simple one is its own YAML file; a complex one is a notes page with a folder of the same name, which can hold several YAML files and helper files (scripts and so on). Because a plugin is one unit, it can be installed and removed by adding or deleting that file or page. Files in a plugin folder that are not YAML are never read as settings; the plugin's rules can use them.
- **Export styles** (`export-style:`, and `styles:` / `css:` for paragraph styles) are in `styles/`, one file each or several in a single file. There are no folders inside `styles/`.
- **Templates** are pages (see [Templates and dynamic blocks](../03-organizing/04-templates.md)): one file, or a set.
- A section is only read from a subfolder when it belongs there: plugins may hold the sections above, styles the style sections. Anything else in such a file (a colour, an icon) is shown as a warning and left out; put it in a file in the main folder.

**Who wins.** Anything in the main folder wins over the same thing in a subfolder: a rule in `workspace.yaml` with the same `id` as one in a plugin replaces it, and so does a query or style with the same name. That is how a workspace changes a plugin without editing it. And a workspace always wins over the app's own folder (see below).

## Adding a plugin, export styles or a template from a file

Plugins, export styles and templates come as files, so you can pass them around, download them or keep them in a folder of your own. Three places in the app add one from a file:

| Where | Button |
|---|---|
| **Plugins → All plugins…** | **Add from file…** |
| **File → Export Styles…** | **Add From a File…** |
| the **New Page** window | **Start from → Add a template from a file…** |

Each opens the same window. **Drag** a file, a folder or a zip onto it, or use **Browse for files…** or **Browse for a folder…** (the system's chooser cannot do both at once). Then choose where it goes:

- **The app folder** (the `plugins/`, `styles/` or `templates/` folder of the app config folder): every workspace on this computer, and only this computer.
- **This workspace's folder** (`.cave-notes/plugins/`, `styles/` or `templates/`): this workspace only, on every computer that has it, because it syncs with the notes.
- **This workspace's folder, shared (`!global`)**: like the one above, and every section of the file that can be shared (`rules`, `schema`, `attributes`, `queries`, `relations`, `export-style`) is tagged `!global`, so every workspace on every computer that has this workspace is offered it (they ask first; see *Settings shared with every workspace* in [Attributes and inheritance](../03-organizing/01-attributes.md)). Templates are pages and cannot be shared this way, so this choice is not offered for them.

What is accepted:

- A **plugin** is a YAML file with at least one of `rules`, `schema`, `attributes`, `queries`, `relations`, `files` or `settings`; a folder (a plugin page, its YAML files and helper files); or a zip of either. A file with nothing a plugin can use, or YAML that does not parse, is refused with the reason.
- **Export styles** are YAML: the styles themselves (`My Report:` with its settings), or the `export-style:` section of a workspace's file. They are written in the form the place needs (the app's folder holds the styles themselves; a workspace's holds them under `export-style:`).
- A **template** is a note file, a folder (a template page with its set), or a zip of them.

Nothing that is already there is overwritten: a name that is taken gets a number (`Shout 2.yaml`). A zip is read by the app itself and refused if it holds a path that leaves its folder or is unreasonably big. Adding from a file needs the desktop app.

## Several files

When more than one file has the same section:

- **Lists** (`relations`, `rules`) are joined, in the order of the files.
- **Maps** (`attributes`, `schema`, `queries`, `export-style` …) are merged by name.
- If two files in the same folder give the **same name**, the file that comes later wins and the app shows a warning saying so. The order is `workspace.yaml` first, then the other files by name. A file in the main folder wins over one in `plugins/` or `styles/` without a warning.

## Where a change is saved

When you change something in the app (a colour, a saved query, a box in Preferences → Workspace → YAML), it is written into the file that already has that section, and comments and the order of keys are kept. A section that no file has yet goes into the usual place for it: automations (`rules:`, `settings:`) into `plugins/automations.yaml` and export styles into `styles/export-styles.yaml` (made if missing); the schema into `schema.yaml` and the rest into `workspace.yaml` if they exist, otherwise into the one settings file in the main folder. If a section is spread over several files, saving its box in Preferences gathers it into the first of them.

A file that is not valid YAML is not used at all while it is broken, and the app keeps the settings it had until it is fixed. The warning names the file.

## Sharing with other workspaces

Any section can be tagged `!global`, in whichever file it is (see *Settings shared with every workspace* in [Attributes and inheritance](../03-organizing/01-attributes.md)). `schema: !global` shares the schema; `rules: !global` shares automation rules. A tag on a single list item or entry shares just that one, and only what is tagged is shared even when several files have the same section.

## Not settings

`state.yaml` and files that start with a dot are ignored, and so are the files in the `templates` and `devices` folders. To keep files or whole folders out of Cave Notes altogether, see [Ignoring files, folders and workspaces: `.caveignore`](02-caveignore.md). Files other than YAML are never read for settings.

## The app config folder

Besides each workspace's `.cave-notes` folder, the app has one of its own, for what is the same in every workspace: the **plugins and templates that come with Cave Notes**. It is a settings folder like any other and opens in a tab: in the page tree's toolbar, the arrow beside *Show unlisted files and templates* has **Open App Config Folder**. It lives in the app's data folder (`app-config/.cave-notes/`):

| Folder | What it holds |
|---|---|
| `plugins/` | YAML files with a `rules:` list, each rule a plugin (`on: { plugin: "Name" }`, see [Plugins](../04-automation/02-triggers/02-plugins.md)). Every workspace offers them in its Plugins menu, after its own. |
| `templates/` | Pages that every workspace offers as templates, after the workspace's own (see [Templates](../03-organizing/04-templates.md)). |

What ships with the app is copied there the first time (the app's own copy is read-only, inside the AppImage), so you can edit it:

- a file you have **changed** is never touched when the app updates;
- a file you have **not** changed is replaced by a newer shipped version when the app brings one;
- a file you **delete** stays deleted (that is what *Uninstall* does to a default plugin). **Plugins → All plugins… → Restore default plugins** brings back what was deleted.

A workspace's own plugin, style or template with the same `id` or name wins over the app's.

