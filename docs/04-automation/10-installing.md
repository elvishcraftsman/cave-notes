# A rule that installs rules

*Part of [Actions](04-actions.md).*

A rule can put a file of rules into the workspace, which lets a plugin set itself up the first time it is used, and lets the whole thing be removed by deleting one file. The action is `install_automations`:

```yaml
rules:
  - id: new-chess-game
    on: { plugin: "New chess game" }
    do:
      - install_automations:
          file: chess-game.yaml
          owner: chess
          content: |
            rules:
              - id: chess-play
                on: button
                ...
```

`remove: true` instead of `content` takes the file away again.

## It always asks

A rule that changes the automations changes what the workspace will do from then on, so the app **asks the person every time anything would change**, in a window that shows the file name, what kind of rules it contains (how many, and whether any run scripts or programs) and the file's text. There is no *always allow*: **Deny** or **Allow**. Nothing is asked if the file is already installed exactly as it is. The rules in the file still need their own permissions: a rule that runs JavaScript still needs *Let automations run JavaScript* in Preferences and its own approval.

## What it can and cannot touch

- The file goes into the workspace's `.cave-notes/plugins/` folder, with a name like `chess-game.yaml` (letters, digits, `.`, `_` and `-`).
- The app puts a first line in it, `# installed by "chess"`, naming the **owner** (`owner: chess` in the action; the rule's own `id` when you leave it out). Only a file with this line, and the same owner, is ever replaced or removed. Giving two rules the same owner lets one install a file and another remove it. **A file you wrote yourself is never touched**, and neither is one installed under another owner: the action fails and says so.
- The content must be valid automations: a file with mistakes is refused before you are asked.
- Only the desktop app can ask the question; where nothing can ask, the action does nothing.

## Taking it away

Delete the file (it is an ordinary file in `.cave-notes/plugins/`) or run a rule with `remove: true`. (An earlier version put the file straight into `.cave-notes`; such a file is found there and moved the next time the rule installs or removes it.) The rules are gone the moment the file is.
