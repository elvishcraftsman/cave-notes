# Automations

Automations make Cave Notes do things for you when something happens: a task is finished, a date arrives, a note has sat untouched for a month. You write rules in plain YAML. A rule says **when** (a trigger), **which pages** (a query) and **what to do** (a list of actions).

All rules live in the workspace's settings files, as a `rules:` list (and, if you want, a `settings:` section): usually `.cave-notes/automations.yaml`, but any YAML file in `.cave-notes` will do, including one that holds all your other settings too (see [workspace-files.md](workspace-files.md)). They are never read from a note's frontmatter, so a note that arrives from another person or computer can't carry a rule with it. Edit the file and the rules reload at once. A workspace with no `rules:` has no automations and costs nothing.

## A first rule

```yaml
rules:
  - id: finished-task
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { completed_at: "${today}" }
      - move_file: Archive/
```

Read it in three parts: `where: kind:task` means "pages whose property `kind` is `task`", `on: { change: status, to: done }` means "when their `status` changes to `done`", and `do:` is what happens then. A page like this:

```
---
kind: task
status: todo
---
# Water the plants
```

changes when you set `status: done` in it. It gets `completed_at: 2026-10-26` (today's date, if today is 26 October 2026) and is moved under the page **Archive**: the file `Water the plants.md` becomes `Archive/Water the plants.md`. A rule needs an `id` (letters, digits, `- _ .`), an `on:` and a `do:`.

Every run, skip and refusal is written to the log: `automation.log` (one JSON line each) in this workspace's folder under the app's data folder, and a line in the main app log. To read them, open **Help > View Logs…** and choose *Automations: <workspace>* (or *Application log*, where each run is one line too). Each time a rule changes something, a message at the bottom of the window says so. There is no automation panel or test button yet. To try a rule without changing anything, a developer can call `automationRun(id, { dry: true })` in the worker; it reports what each action would do and writes nothing.

## The pages of this section

Read them in this order the first time; later, jump to the one you need.

| Page | What is in it |
|---|---|
| [Writing a rule](automation/rules.md) | Every field of a rule, and how `where`, `require`, `unless` and `if` differ. Sharing rules with other workspaces. |
| [Triggers](automation/triggers.md) | When a rule runs: a property changes, a page starts to match, a clock or a date arrives, a page is created, saved or deleted. |
| [Buttons](automation/triggers/buttons.md) | `on: button`: a rule that waits for a click in a page. |
| [Plugins](automation/triggers/plugins.md) | `on: plugin`: a rule you start from the editor, on the text you are writing. |
| [Actions](automation/actions.md) | What a rule can do: set properties, move and create pages, add text, notify, run a program. |
| [Values and expressions](automation/values.md) | `${ }`, dates and durations, and every variable (`this`, `old`, `new`, `today` and the rest). |
| [Functions](automation/values/functions.md) | Every function, by kind, with its result. |
| [JavaScript in rules](automation/javascript.md) | `run_js`: a short script for what the built-in actions cannot do. How to turn it on, what a script can use and return, helpers for headings and cursor, and two worked plugins. |
| [Examples](automation/examples.md) | Fifteen complete rules files for real jobs. |
| [Shell commands](automation/shell.md) | Running programs, and the guards around it. |
| [Several computers](automation/computers.md) | How synced computers take turns, and the `settings:` section. |
| [Safety nets and the background](automation/safety.md) | Loop limits, checked saves, and rules that keep running with the window closed. |

## Where to look something up

- *A word in a rule file you do not know:* a field is in [Writing a rule](automation/rules.md), a value of `on:` in [Triggers](automation/triggers.md), a name under `do:` in [Actions](automation/actions.md).
- *Writing a script:* [JavaScript in rules](automation/javascript.md) lists everything a script can use and every helper.
- *Something inside `${ }`:* a variable is in [Values and expressions](automation/values.md), a function in [Functions](automation/values/functions.md).
- *A `CAVE_…` name:* [Shell commands](automation/shell.md).
- *A `settings:` key* (`sync_delay`, `max_depth` …): [Several computers](automation/computers.md).
