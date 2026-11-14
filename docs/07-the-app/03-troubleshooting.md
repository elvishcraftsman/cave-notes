# Troubleshooting and logs

Cave Notes writes one log for the whole app (main process, every workspace's worker, and the console errors of every
window): `~/.config/Cave Notes/logs/cave-notes.log` (Flatpak: `~/.var/app/<id>/config/Cave Notes/logs/`). The previous
session's log is kept as `cave-notes.log.1`. Note text is never logged: only paths, counts, durations and error messages.

**Help > View Logs…** (or *View Logs…* in the main menu, the button with three lines) shows the logs as plain text, already
scrolled to the newest lines. The list at the top chooses which log: the application log (the default), the earlier part
of it, the automation log of each open workspace (one line per rule run, with the time, the rule, the page and what it
did), or all of them one after the other. *Refresh* reads the file again and goes to the end, *Copy all* puts the text on
the clipboard, and *Open log folder* shows the files. A large log is shown from its last 2 MB; the file holds the rest.
Escape closes the screen.

**Help > Copy Diagnostic Report** puts versions, settings, open workspaces, per-process CPU/memory and the last 250 log
lines on the clipboard. Paste it into a bug report.

**Help > Verbose Logging** (or start with `CAVE_LOG=debug`, or `trace`) adds file-change batches, every slow call,
and a CPU/memory line per process every 30 seconds.

What to look for:

| Log line | Means |
|---|---|
| `HIGH CPU … utility "cave-notes-<workspace>"` | that workspace's worker is busy (indexing or watching); see `watcher ready … watching N folders` |
| `HIGH CPU … Browser` | the main process: look for `workspace scan: N folders in … ms` just before |
| `HIGH CPU … Tab` | the window's renderer |
| `workspace scan gave up …` | the home folder (or a mount in it) is too big; narrow it in Preferences → Workspaces or turn the scan off |
| `readPage: ENOENT page=… dir-exists=… index-knows-page=…` | the tree listed a page whose file could not be read: says whether the folder, the file or the whole workspace is missing |
| `event loop was blocked for … ms` | something ran synchronously that long in that process |
| `… got no answer in 90 s` / `[save] failed or timed out` | a workspace worker is stuck |
| `window … UNRESPONSIVE` | the window's page stopped handling events |
| `received SIGTERM: quitting, keeping the N open window(s)` | a kill from a terminal; windows come back at next start |

## A page edited elsewhere does not update

An open page follows its file: a change made by another program, device or sync tool is merged in within a moment, without losing what you are typing. As a safety net for file events that never arrive (some sync tools and network folders), the open page is also compared with its file whenever the window gets the focus back and every few seconds. Views, embedded text (`![[page]]`) and query links (`[[?query]]`) refresh when any page changes. If a page still looks stale, tell me what changed it and how; the log (see above) records each external change it noticed.
