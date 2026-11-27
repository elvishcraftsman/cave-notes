---
order: 2
---

# Making a plugin

A **plugin** is one folder (or one `.cnplugin` file, which is that folder as a zip) that adds several things at once: automations, definitions (attributes, saved searches, relations), export styles, templates, a starter page, pictures. A person adds it through **Plugins → All plugins… → Add from file…**, sees what it does before it goes in, answers its setup questions, and can take it out again in one step.

Everything below is also what the app does for you when you add loose files: it makes a plugin of them.

## The folder

```
Cash Collection/
  plugin.yaml            what it is (required)
  README.md              shown when it is added (optional)
  automations/           files with rules: and settings:
  definitions/           files with schema:, attributes:, files:, queries:, relations:
  styles/                files of export styles
  templates/             notes that are templates
  assets/                pictures and fonts
```

To try it, choose the folder itself in the **Add a Plugin** window. To hand it out, zip it (the folder's contents, or the folder) and name the file `something.cnplugin`.

## `plugin.yaml`

```yaml
plugin:
  id: cash-collection        # lowercase letters, digits and -
  name: Cash Collection
  version: 1.0.0
  description: Reconcile the tills and record each deposit.
  author: Your Name          # optional
  homepage: https://example.com   # optional
  minAppVersion: 0.20.0      # optional: refused on an older app
  scopes: [workspace, app, shared]   # optional: where it may go (default: all)
  icon: assets/icon.svg      # optional

setup:                       # optional: questions asked when it is added
  folder:  { type: text,   label: "Put the pages under", default: "Cash" }
  company: { type: text,   label: "Company name", default: "Acme" }

automations:
  - automations/cash.yaml
definitions:
  - definitions/cash.yaml
export-styles:
  - styles/letterhead.yaml
templates:
  - path: templates/Cash Collection.md
    managed: true            # its pages carry a pluginPage attribute
  - path: templates/Cash Record.md
    hidden: true             # used by automations, not offered in New Page
pages:                       # starter pages made when it is added
  - from: Cash Collection
    path: "{{setup.folder}}/Cash Collection"
    open: true               # opened afterwards (one at most)
assets:
  - assets/
```

Every file the manifest names must be in the package, and the app checks each one with the code that will load it before anything is written. A file may only hold the sections of its folder: an `automations/` file only `rules` and `settings`, a `definitions/` file only `schema`, `attributes`, `files`, `queries` and `relations`; anything else is refused with the file and the section named. A `styles/` file is either the styles themselves or the same under `export-style:`; it is always installed under `export-style:`.

## Setup questions

Questions use the same types as an automation's `ask:`: `text`, `number`, `select` (with `options`), `boolean` and `info`. Where an answer belongs, write `{{setup.name}}` in any of the plugin's YAML files, notes or page paths:

```yaml
Letterhead:
  header: {{setup.company}}
```

An answer goes in as a proper value: an answer with a colon, a `#` or a quote in it cannot break the file, and a number answer filling a whole value stays a number. Other `{{…}}` marks (`{{title}}`, `{{date}}`) and `${…}` formulas are left alone. A `{{setup.typo}}` that names no question is refused when the package is read.

## What happens when it is added

- **One folder** is made in `plugins/` of the place it goes (the workspace's `.cave-notes` or the app config folder), named after the plugin. It holds your files, a `base/` copy of them as installed, and, written last, an `.installed.json` record. A folder with a `plugin.yaml` but no record (an install that was cut short) is not loaded. If anything fails midway, nothing is left behind.
- **Names that are taken are kept by what was there.** An export style, template or saved search with the same name as one the plugin brings is left alone, and the plugin's gets *(plugin name)* after it, along with every reference to it inside the plugin. A schema entry the workspace already has is added to, never replaced. A starter page that exists gets a number.
- **Templates** in `templates/` are offered like any other (after the workspace's own); a `hidden: true` one only to automations (`create_page`'s `template:`) and `childTemplate`.
- **Scopes.** *This workspace* and *The whole app* write the files as they are; *Shared* tags every shareable section `!global`.
- The window tells the person, from your files alone, what the plugin **adds** and what it **can do**: it changes pages, runs on its own (and when), runs JavaScript, runs programs, installs further automations, or only adds content.

## Updating

To update a plugin, **add the new version the same way**: drop the new folder or `.cnplugin` on **Add a Plugin**. The window sees that a plugin with the same `id` is installed, shows what would change in each file, and says **Update**. The version number can be higher, the same or lower; the window says which.

For each file of the plugin:

- one you **have not edited** is replaced by the new version;
- one you **have edited** stays as you made it, and the new version of it is put in the plugin folder's `base/` so you can compare;
- a file the new version **adds** is added, and one it **no longer has** is removed (if you had not edited it);
- a file you **deleted** stays deleted.

Your setup answers are kept (and shown again, so you can change them), and so are the names a plugin was given when something else had its own. Starter pages are not made again, and pages made from the plugin's templates are not changed. If anything goes wrong while writing, the old version is put back exactly as it was.

The plugins that come with Cave Notes are packages like these and are updated the same way when the app brings a newer version of one. One you removed stays removed until you use **Restore default plugins**.

## Not yet

Merging an edited file with the plugin's new version of it (today yours simply stays), and changing the pages made from `managed` templates when the template changes: `managed` only marks those pages (with a `pluginPage` attribute) so that this can come later. `renamed:` is read and ignored for now.
