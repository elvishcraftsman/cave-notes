---
order: 2
---
# Plugins: rules you start from the editor

*Part of [Triggers](../triggers.md).*

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

For a plugin that needs more than a regular expression, write it in JavaScript with `run_js`. [JavaScript in rules](../javascript.md) has two complete ones: *Numbered list to headings* (with a question for the heading level) and *Number headings at this level* (which uses the cursor's position). With level 2, the first turns this list

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

Questions (`ask:`) have a `label`, a `type` (`text`, `number`, `select`, `boolean` or `info`), a `default`, and `min` and `max` for numbers or `options` for a select. The changed text is put into the editor as one step that Undo takes back. A plugin may also use other actions (`notify`, `set_property` on the current page); `transform_text` (see [Actions](../actions.md)) and [`run_js`](../javascript.md) are the ones that change the text. A plugin runs on this computer, right away, and does not wait for other computers.

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

Its first line is a **search box** (type, and Enter runs the first plugin that matches). Below it come the plugins **you wrote** (the workspace's own, and those other workspaces share with it), then a line, then the plugins **that come with the app**, by name. **All plugins…** at the bottom opens a window listing every plugin with a switch to turn it on or off (for this computer and this workspace, like *Turn off this plugin* above) and an **Uninstall** button: for your own plugin the rule is removed from its settings file, for one that comes with the app its file is removed from the [app config folder](../workspace-files.md#the-app-config-folder). **Restore default plugins** there brings back the ones that came with the app and were uninstalled.

The plugins that come with the app are ordinary rules in files you can read and edit (**Open App Config Folder**, or the button in that window). They are: *Number headings at this level*, *Convert a numbered list to headings*, *Estimate page count* and *Remove trailing spaces*. A rule of your own with the same `id` replaces the one that comes with the app.

## Plugins and the cursor

A plugin written in JavaScript can ask where the cursor is and put it somewhere else when it has changed the text. See [JavaScript in rules](../javascript.md).

---

Previous: [Buttons](buttons.md)
