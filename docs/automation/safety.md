---
order: 8
---
# Safety nets and the background

*Part of [Automations](../automation.md).*

What stops a rule from doing harm, and how rules with a clock keep running.

## Safety nets

- **No endless loops.** Changes a rule makes count as one step deeper; a chain of rules that trigger each other stops after `max_depth`. The same rule on the same page runs at most 6 times in 10 minutes, and no more than `max_runs_per_minute` runs happen in a minute. The log says when something was stopped.
- **Saves are checked.** A rule writes through the same path as the editor: if you changed the page in the meantime, the rule's write is refused rather than overwriting you, and the page's history keeps earlier versions.
- **Bad rules are skipped, not fatal.** A rule with a mistake is reported (with its id and what is wrong) and the others keep working.
- **Programs and scripts are guarded.** Shell commands and JavaScript are each off until you switch them on (with a confirmation), and each new command or script asks you first. A script runs in a sandbox: it works on one page's text and properties and cannot open files, use the network or start programs. See [Shell commands](shell.md) and [JavaScript in rules](javascript.md).
- **Where things are.** Rules and device files: in the workspace's `.cave-notes` folder (synced). This computer's state, approvals and log: the app's data folder (not synced).

## Running in the background

A rule with a clock (`schedule` or `at`) only runs while Cave Notes runs. Turn on Preferences → Sync and automation → Automations, "Keep running in the background" and closing the last window leaves the app running for the workspaces that have such rules (a tray icon, where your desktop shows one, opens it or quits it; opening Cave Notes again also shows a window). To have it ready after login, start it with `cave-notes --background`, for example from your desktop's startup applications: it opens the workspaces from last time without windows. When it has been closed, missed schedules and dates run once the next time it starts.


---

Previous: [Several computers](computers.md)
