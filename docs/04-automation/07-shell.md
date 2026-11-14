---
order: 6
---
# Shell commands

*Part of [Automations](../04-automation.md).*

Rules can run programs. Because that is powerful, it is guarded.

Rules can run programs: deploy a site, create a calendar entry, call a script. Because that is powerful, it is guarded:

1. **Off until you turn it on.** Preferences → Sync and automation → Automations, "Let automations run shell commands". The app asks you to confirm.
2. **You approve each command.** The first time a rule wants to run a command, a dialog shows the command exactly as the rules file says it. Choose Deny, Allow once, or Always allow. The approval belongs to that workspace, rule and command text; edit the command and you are asked again. A refusal is remembered too (*Forget all approvals and refusals* in Preferences clears both). A long command is shown only in part; **Open the full text** opens a copy of all of it.
3. **Rules cannot put values into a command line.** A page's title could contain anything, including characters a shell treats as commands, so a value is never pasted into command text. There are two safe ways to get a value to a program. With `command`, the value arrives as an environment variable that you read in the command (`"$CAVE_TITLE"`). With `argv`, you list the program and its arguments one by one, and each argument may use `${...}`; no shell is involved, so nothing in the value can be taken as a command.

   | | `command` | `argv` |
   |---|---|---|
   | Written as | One line of text | A list: program first, then arguments |
   | Runs with | `sh -c`, so pipes, `&&` and `$VARIABLES` work | The program directly, no shell |
   | Values from the rule | Only through `$CAVE_*` variables (no `${...}` in the text) | `${...}` in any item |
   | Good for | `git commit -am "Backup of $CAVE_TITLE" && git push` | `./scripts/publish.sh "${this.path}"` |

   Wrong: `command: 'echo ${this.title}'` (the `${...}` is **not** filled in, and the shell would see it as text). Right: `command: 'echo "$CAVE_TITLE"'` or `argv: [echo, "${this.title}"]`.

```yaml
- run_shell:
    command: 'git commit -am "Backup of $CAVE_TITLE" && git push'
    cwd: "${this.folder}"
    timeout: 30s
- run_shell:
    argv: [./scripts/publish.sh, "${this.path}"]
```

Relative paths in `argv` and `command` (`./scripts/publish.sh`) start from the working folder: the workspace folder, unless `cwd` names another folder inside it.

4. **Limits.** The working folder (`cwd`, default the workspace folder) must be inside the workspace. The default time limit is 30 seconds (`timeout`, up to 10 minutes); a command that runs over is stopped together with what it started. Only a short list of ordinary environment variables is passed on (`PATH`, `HOME`, `LANG`, display and session variables), never the app's own environment.
5. **Which computer.** A rule with `run_shell` is switched off until it says where it runs, so that two computers do not both run a command by accident. Pick one: `device: desktop` (only the computer with that name, for example the one that has `git` set up), `runs: once` (any one computer: whichever gets there first), or `runs: everywhere` (every computer runs it).

`on_success:` and `on_failure:` take an action or a list; use them to record the result or notify. A failure that has an `on_failure` is handled, so the rest of the rule goes on. Inside them `${shell.code}` (the exit code, 0 means success) and `${shell.stderr}` (what the program wrote as error output) are available:

```yaml
rules:
  - id: backup
    device: desktop
    on: { schedule: "@daily" }
    do:
      - run_shell:
          command: 'git add -A && git commit -m "Backup" && git push'
          on_failure: { notify: "Backup failed (code ${shell.code}): ${shell.stderr}" }
```

To run a command by hand from a note instead, use a *Run* button on a shell [code block](../02-writing/03-code-blocks.md).

## Environment variables for commands

| Variable | Value |
|---|---|
| `CAVE_RULE` | The rule's id. |
| `CAVE_TRIGGER` | The trigger kind (`change`, `schedule`, ...). |
| `CAVE_WORKSPACE` | Absolute path of the workspace. |
| `CAVE_PAGE` | The page's path in the workspace. |
| `CAVE_FILE_PATH` | The page's absolute file path. |
| `CAVE_FOLDER` | Absolute path of the folder holding the page. |
| `CAVE_TITLE` | The page's title. |
| `CAVE_NOW`, `CAVE_TODAY` | The moment and the date. |
| `CAVE_ATTR_<NAME>` | Each single-valued property of the page, name in capitals (`CAVE_ATTR_STATUS`). |
| your own | `env: { KEY: value }` in the action (values may use `${...}`). |

Inside a Flatpak, commands run inside its sandbox and see only what the sandbox allows.

---

Previous: [Examples](05-examples.md) · Next: [Several computers](09-computers.md)
