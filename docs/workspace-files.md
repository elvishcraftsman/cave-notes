# Workspace settings files

A workspace keeps its settings in YAML files in its `.cave-notes` folder. **Which file holds what does not matter.** The app reads every `*.yaml` and `*.yml` file in that folder and takes each section from wherever it finds it. Keep the settings in separate files (`schema.yaml`, `automations.yaml` and so on, made with New Page in *Open Workspace Config Folder*) or all in one. You can also share a setup as a single file, or just a part of one, and drop it into another workspace.

## The sections

Each section is a top-level key. The name tells the app what it is.

| Section | What it holds | Written as |
|---|---|---|
| `attributes:` | Attributes every page has ([attributes.md](attributes.md)) | name: value |
| `files:` | Attributes of files that are not notes | path: attributes |
| `schema:` | The types of attributes (date, select, number …) | name: `{ type: … }` |
| `queries:` | Saved queries ([queries.md](queries.md)) | name: query |
| `relations:` | Relations between saved queries, one-way or mutual (`from`, `to`, `attribute`, `multiple`, `backattribute`, `backname`, `backmultiple`; every field is defined in [queries.md](queries.md#relations)) | a list |
| `rules:` | Automation rules ([automation.md](automation.md)) | a list |
| `settings:` | Settings of the automation engine | name: value |
| `export-style:` | Styles for exporting pages ([export-styles.md](export-styles.md)) | style name: settings |
| `notes:` | Which files count as notes (`extensions`, `create`) | map |
| `presentation-themes`, `presentation-rules` | Slide themes and which layout each kind of slide gets (see [presentations.md](presentations.md)) | a map; a list |
| `styles`, `css` | Named paragraph styles for `::: name` blocks, and extra CSS (see [export-styles.md](export-styles.md)) | a map; text |
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

## Several files

When more than one file has the same section:

- **Lists** (`relations`, `rules`) are joined, in the order of the files.
- **Maps** (`attributes`, `schema`, `queries`, `export-style` …) are merged by name.
- If two files give the **same name**, the file that comes later wins and the app shows a warning saying so. The order is `workspace.yaml` first, then the other files by name.

## Where a change is saved

When you change something in the app (a colour, a saved query, a box in Preferences → Workspace → YAML), it is written into the file that already has that section, and comments and the order of keys are kept. A section that no file has yet goes into the usual file for it (`workspace.yaml`, `schema.yaml`, `automations.yaml` or `export-styles.yaml`) if that exists; otherwise into the first settings file that holds any section. If a section is spread over several files, saving its box in Preferences gathers it into the first of them.

A file that is not valid YAML is not used at all while it is broken, and the app keeps the settings it had until it is fixed. The warning names the file.

## Sharing with other workspaces

Any section can be tagged `!global`, in whichever file it is (see *Settings shared with every workspace* in [attributes.md](attributes.md)). `schema: !global` shares the schema; `rules: !global` shares automation rules. A tag on a single list item or entry shares just that one, and only what is tagged is shared even when several files have the same section.

## Not settings

`state.yaml` and files that start with a dot are ignored, and so are the files in the `templates` and `devices` folders. Files other than YAML are never read for settings.

## The app config folder

Besides each workspace's `.cave-notes` folder, the app has one of its own, for what is the same in every workspace: the **plugins and templates that come with Cave Notes**. It is a settings folder like any other and opens in a tab: in the page tree's toolbar, the arrow beside *Show unlisted files and templates* has **Open App Config Folder**. It lives in the app's data folder (`app-config/.cave-notes/`):

| Folder | What it holds |
|---|---|
| `plugins/` | YAML files with a `rules:` list, each rule a plugin (`on: { plugin: "Name" }`, see [Plugins](automation/triggers/plugins.md)). Every workspace offers them in its Plugins menu, after its own. |
| `templates/` | Pages that every workspace offers as templates, after the workspace's own (see [Templates](templates.md)). |

What ships with the app is copied there the first time (the app's own copy is read-only, inside the AppImage), so you can edit it:

- a file you have **changed** is never touched when the app updates;
- a file you have **not** changed is replaced by a newer shipped version when the app brings one;
- a file you **delete** stays deleted (that is what *Uninstall* does to a default plugin). **Plugins → All plugins… → Restore default plugins** brings back what was deleted.

A workspace's own plugin or template with the same `id` or name wins over the app's.

