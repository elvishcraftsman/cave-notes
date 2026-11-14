---
order: 2
---
# Plugins: rules you start from the editor

*Part of [Triggers](../02-triggers.md).*

A plugin is a rule that works on the text you are writing. It is listed in the **Plugins** menu next to the main menu button, and runs on the selected text (or on the whole page if nothing is selected). Give it `on: { plugin: "Name" }`, and, if it needs to know something, an `ask:` list: the window shows a small dialog with those questions first, and the answers are `${ask.name}` in the actions.

```yaml
rules:
  - id: tidy
    on: { plugin: "Remove trailing spaces" }
    do:
      - transform_text:
          steps:
            - regex: { find: "[ ]+$", replace: "" }
```

For a plugin that needs more than a regular expression, write it in JavaScript with `run_js`. [JavaScript in rules](../06-javascript.md) has two complete ones: *Numbered list to headings* (with a question for the heading level) and *Number headings at this level* (which uses the cursor's position). With level 2, the first turns this list

```
1. First
   - a
   - b
2. Second
   1. x
```

into

```
## First
- a
- b
## Second
1. x
```

Questions (`ask:`) work the same in a [button](01-buttons.md#buttons-that-ask-first). They have a `label`, a `type` (`text`, `number`, `select`, `boolean` or `info`), a `default`, and `min` and `max` for numbers or `options` for a select. The changed text is put into the editor as one step that Undo takes back. A plugin may also use other actions (`notify`, `set_property` on the current page); `transform_text` (see [Actions](../04-actions.md)) and [`run_js`](../06-javascript.md) are the ones that change the text. A plugin runs on this computer, right away, and does not wait for other computers.

## Showing a message

A question of `type: info` is not a question: it shows its `label` as a message, with an **OK** button instead of *Run*. The label may use `${ }` with what the plugin is about to work on: `${words}` and `${characters}` (of the selected text, or of the whole page), `${selection}`, and the usual variables. The message is worked out when the dialog opens.

```yaml
rules:
  - id: page-count
    on: { plugin: "Estimate page count" }
    ask:
      result:
        type: info
        label: "${words} words is about ${round(words / 250, 1)} pages at 250 words per page${selection ? ' (selected text)' : ''}."
    do:
      - log: "page count shown"
```

A word is a run of characters with at least one letter or digit, so a lone `-` or `#` of Markdown is not counted. A plugin whose questions are all `info` just shows its message; the `do:` list still runs when you press OK.

### Turning a plugin off

Every plugin dialog, a question or a message, has a **Turn off this plugin** button, so that a plugin that asks too often can be silenced at once. It is kept on this computer (not in the workspace, so syncing does not carry it to your other computers). The plugin stays in the Plugins menu, dimmed and marked *off*; choosing it there turns it on again. The rule itself is not changed.

## The Plugins menu

Its first line is a **search box** (type, and Enter runs the first plugin that matches). Below it come the plugins **you wrote** (the workspace's own, and those other workspaces share with it), then a line, then the plugins **that come with the app**, by name. **All plugins…** at the bottom opens a window listing every plugin with a switch to turn it on or off (for this computer and this workspace, like *Turn off this plugin* above) and an **Uninstall** button: for your own plugin the rule is removed from its settings file, for one that comes with the app its file is removed from the [app config folder](../../06-workspaces/01-workspace-files.md#the-app-config-folder). **Restore default plugins** there brings back the ones that came with the app and were uninstalled.

The plugins that come with the app are ordinary rules in files you can read and edit (**Open App Config Folder**, or the button in that window). They are: *Number headings at this level*, *Convert a numbered list to headings*, *Estimate page count* and *Remove trailing spaces*. A rule of your own with the same `id` replaces the one that comes with the app.

## An icon and a description

A plugin can have its own **icon** and a longer **description**, written on the rule beside `name`:

```yaml
rules:
  - id: tidy-lines
    name: Tidy lines
    icon: wand-sparkles
    description: |
      Removes the spaces at the end of every line.

      Works on the selected text, or on the whole page when
      nothing is selected. Nothing else is changed.
    on: { plugin: "Tidy lines" }
    do:
      - transform_text: { steps: [ trim_lines ] }
```

- `icon` is the name of an icon of the bundled set, the same names the **Set Icon…** window offers for a page. It appears beside the plugin in the Plugins menu and in the **All plugins** window. A name that is not one of those, or a plugin without an icon, shows the usual lightning bolt in the menu and no icon in the window.
- `description` can be as long as you like and can have several lines and paragraphs. The **All plugins** window shows its first few lines, with **Read more** to open the rest (and **Show less** to fold it again).

## Adding a plugin from a file

**All plugins…** has an **Add from file…** button: drag in a YAML file, a folder or a zip, and choose whether it goes in the app folder, this workspace, or this workspace shared with every workspace. See [Workspace settings files](../../06-workspaces/01-workspace-files.md#adding-a-plugin-export-styles-or-a-template-from-a-file).

## Plugins and the cursor

A plugin written in JavaScript can ask where the cursor is and put it somewhere else when it has changed the text. See [JavaScript in rules](../06-javascript.md).

---

Previous: [Buttons](01-buttons.md)
