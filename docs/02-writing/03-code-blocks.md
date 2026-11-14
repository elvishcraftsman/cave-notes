# Code blocks

A code block is text between two lines of three backticks:

````
```bash
echo "Hello from $CAVE_TITLE"
```
````

## Copy

Every code block has a **Copy** button at its top right corner. It copies the code only, without the lines of backticks. A block that is indented by four spaces instead of fenced is copied without those four spaces. The button stays in place when a wide line scrolls sideways. The built-in documentation has the buttons too, so you can copy any example from it.

## Run

A block whose first word after the backticks is `bash`, `sh`, `zsh` or `shell` also has a **Run** button. Other languages (`python`, `yaml`, ...) only have Copy: to run one of those, write a shell block that calls it, for example `python3 script.py`.

| Marked as | Run with |
|---|---|
| `bash` | `bash` |
| `zsh` | `zsh` |
| `sh`, `shell` | `sh` |

**The first time you press Run in a workspace**, Cave Notes asks "Are you sure you want to run scripts from this workspace?". A script can do anything you can do on this computer, and a workspace can change under you when other people or computers share it, so the answer is yours alone: it is kept in the app's data folder, never in the workspace, and a workspace cannot answer for itself. Say yes and Run works for every script in that workspace from then on; say Cancel and nothing runs and nothing is remembered. **Preferences → Sync and automation → Forget all approvals and refusals** makes it ask again (it also makes automations ask again before running a shell command).

While a script runs, the button says **Stop**. When it ends, a small panel under the buttons shows what it printed and how it ended: *Finished*, *Finished with exit code 3*, *Stopped*, or *It ran too long and was stopped* (the limit is 10 minutes). Close the panel with ×. Only the first 16 KB of output is kept.

### Shell blocks open a terminal

A shell block (`sh`, `bash`, `zsh` or `shell`) opens **in a terminal window** when you press Run (the button says **Run in terminal**). That way scripts can ask for a password (`sudo`, `su`, `pkexec`, `doas`), show progress, and be answered when they ask a question. To run a block quietly instead, with its output in the panel under the block, write `no-terminal` after the language:

````
```bash no-terminal
df -h /
```
````

A script that uses `sudo`, `su`, `pkexec` or `doas` still opens a terminal even then, because it would have nowhere to ask for the password. (`terminal` after the language is still accepted, and means the same as writing nothing.)

Cave Notes tries `ptyxis`, `gnome-terminal`, `kgx`, `konsole`, `xfce4-terminal` and a few others, in that order; set the environment variable `CAVE_TERMINAL` (for example `CAVE_TERMINAL=foot`) to prefer another. The window waits for Enter when the script ends so you can read the output, and it removes its temporary files. The same workspace approval as for Run applies. Output of a script that opened in a terminal is not captured: the panel only says it was opened in a terminal. Automations never open terminals and have no way to type a password, so a `sudo` command in a `shell:` action will not work unattended.

### Where the script runs

- In the **folder of the page** that holds the block. A page `Projects/Garden.md` runs its scripts in `Projects/`, so `ls` lists the files beside it and `./build.sh` finds a script placed there.
- With a short list of ordinary environment variables (`PATH`, `HOME`, `LANG`, ...), never the app's own environment, plus these, which a script can use as `"$CAVE_TITLE"`:

| Variable | Value | Example |
|---|---|---|
| `CAVE_WORKSPACE` | Absolute path of the workspace | `/home/lynn/Notes` |
| `CAVE_PAGE` | The page's path in the workspace | `Projects/Garden.md` |
| `CAVE_FILE` | The page's absolute file path | `/home/lynn/Notes/Projects/Garden.md` |
| `CAVE_FOLDER` | The folder the script runs in | `/home/lynn/Notes/Projects` |
| `CAVE_TITLE` | The page's file name without its extension | `Garden` |

- The page is saved first, so a script that reads `$CAVE_FILE` sees what you just typed.
- Run is not offered in the built-in documentation: copy the example instead.
- Inside a Flatpak, scripts run inside its sandbox and see only what the sandbox allows.

Run is for scripts you start by hand. To run a command when something happens in your notes, use an [automation](../04-automation.md); to start an automation from a button, see [Buttons that run a rule](../04-automation.md#buttons-that-run-a-rule).
