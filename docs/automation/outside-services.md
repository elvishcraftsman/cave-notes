---
order: 8
---
# Plugins that call outside services

*Part of [Automations](../automation.md).*

A plugin that has to talk to something outside Cave Notes (a weather service, a calendar, a translation site, your own server) cannot do it from a script: the `run_js` sandbox **cannot use the network**, open files or start programs. The way out is a [shell command](shell.md) that runs a **helper script** kept in the plugin's own folder. The helper does the talking; the rule hands it the text and puts what comes back into the page.

## The pieces

A plugin that needs a helper is a folder in `.cave-notes/plugins/` (see [Workspace settings files](../workspaces/workspace-files.md)). For a plugin called `weather`:

```
.cave-notes/plugins/weather/
  rules.yaml      the rule
  fetch.sh        the helper script (any language: shell, Python, ...)
```

Make the script runnable (`chmod +x fetch.sh`). It reads what it needs from environment variables or arguments, and **prints its answer to standard output**.

## A minimal `rules.yaml`

```yaml
rules:
  - id: weather-note
    name: Add the weather
    on: { plugin: "Add the weather" }
    runs: once
    do:
      - run_shell:
          argv: [./fetch.sh, "${this.title}"]
          cwd: ".cave-notes/plugins/weather"
          timeout: 1min
```

and `fetch.sh`:

```sh
#!/bin/sh
# $1 is the page title. Print one line: the helper's whole answer.
curl -fsS "https://wttr.in/?format=3"
```

Things to know about this file:

- **`argv`, not `command`.** Each item of `argv` may use `${...}`; no shell is involved, so a page title with odd characters cannot be taken as a command. With `command` the values arrive as `$CAVE_*` variables instead. See [Shell commands](shell.md).
- **`cwd`** is where the command starts. It is a folder inside the workspace, written relative to the workspace folder (or absolute, if it still lies inside it). Here it is the plugin's own folder, so `./fetch.sh` is found. Without `cwd` the command starts in the workspace folder itself, and the path would have to be `./.cave-notes/plugins/weather/fetch.sh`.
- **`runs`** says which of your synced computers does the work. A rule with `run_shell` is switched off until it says: `runs: once` (any one computer, whichever gets there first), `runs: everywhere` (every computer) or `device: <name>` (only that one). For a plugin you start by hand, `runs: once` is usually right; use `device:` when the helper needs something only one computer has (a login, an installed program). See [Several computers](computers.md).
- **`timeout`** is `s`, `min` or `h` (`30s`, `1min`), up to 10 minutes.
- **Approval.** Shell commands are off until you switch them on in Preferences, and the first run asks you to approve this exact command. Edit the command and you are asked again.

## Putting the answer into the page

The text the helper printed is available to the actions after it. To add it at the end of the page, name what to do with a successful run:

```yaml
    do:
      - run_shell:
          argv: [./fetch.sh, "${this.title}"]
          cwd: ".cave-notes/plugins/weather"
          timeout: 1min
          on_success:
            append_to_page: { text: "${shell.stdout}" }
```

(`on_success` and `on_failure` take an action, or a list of them, and can use `shell.stdout`, `shell.stderr` and `shell.code`; see [Values and expressions](values.md). `append_to_page` skips text that is already on the page.)

## If it does not work

- The plugin is not in the Plugins menu: the rule has a mistake and was left out. See [A rule with a mistake is left out](rules.md#a-rule-with-a-mistake-is-left-out): **Help > View Logs…**.
- "switched off until it says where it runs": add `runs: once` (or `device:`).
- The command is stopped: it ran longer than `timeout`. Raise it, up to 10 minutes.
- Nothing happens and no approval dialog: shell commands are off in Preferences → Sync and automation.
