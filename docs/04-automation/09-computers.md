---
order: 7
---
# Several computers

*Part of [Automations](../04-automation.md).*

What happens when the same workspace is open on more than one computer.

**Do I need to do anything?** Not if you use one computer. If the same workspace is synced between computers that **all run Cave Notes with its rules**, each change is seen by all of them, and Cave Notes makes sure a change is acted on once. Most people never change a setting here. It works without any sync-specific protocol:

- **Notifications go to every computer.** A rule with only `notify` / `log` runs everywhere (`runs: everywhere`).
- **Changes to files happen once.** A rule that changes files is `runs: once`. Each computer writes a small file `.cave-notes/devices/<id>.yaml` saying it is alive (it has been heard from lately) and what it has done. Before acting, a computer looks again: has another one already done it? Is the reason still true? If so it does nothing.
- **The computer where you made the change acts at once.** If you tick a task, edit a page or drag a card on one computer, that computer runs the rule immediately, whatever its place in the order, so you never wait for a turn that is not yours. Every other computer sees the change arrive and waits: while other computers are alive it never goes first, and takes its turn after one `sync_delay` (default 60 s), then the next one after two, and so on. By then the first computer has said what it did, and the others do nothing. If that computer was closed or went to sleep before it could act, the next one in order does the work after its delay.
- **Changes made by another program** (a text editor, a script, a phone app that writes to the synced folder) count as coming from outside, so they wait like those from another computer. When no other computer is alive, the change is acted on at once.
- **Order.** `devices: [laptop, desktop]` in the rules file sets who goes first among the computers that wait (names are the computer names, lowercase; others follow by id). The name is set in Preferences → Sync and automation → Automations, or is the computer's own. Time triggers (`schedule`, `at`) are seen by every computer at the same moment, so for them the first in order acts at once and the others wait.
- **Offline.** Computers that cannot see each other may both act. Every action is written to do nothing when its work is done (a page that exists is not created again, a moved page is not moved, text already there is not added; "exists" means a file at that exact path, so a page created here and renamed before another computer takes its turn can be created a second time there), and the same work gives the same result on each computer. So write rules that depend on the *trigger*, not on the moment you run: use `${today}`, a property's date or `trigger.at`, not `${now}`, when two computers must agree. `add_days` is the exception: it shifts again each time, so use `set_property` with `add(this.due, "7d")` when in doubt.
- **After starting or waking up.** When the app starts, or the computer wakes from sleep (Cave Notes notices that its half-minute timer went quiet for more than three minutes), the synced folder may still be catching up: a page deleted on another computer can still be here, and a page edited there can still be old. A rule that wrote to such a page now could undo that work; a write to a page deleted elsewhere usually makes the sync service bring it back everywhere. So for `wake_delay` (default 2 min) nothing is acted on except what you do on this computer. A schedule that came due while the computer slept runs when the wait is over, with the pages as they are by then; changes that arrived by sync wait too, and are looked at again. Your own edits are acted on at once. There is no wait when no other computer has ever shared the workspace, and `wake_delay: 0s` switches it off. The log says when a wait begins.
- **Shell commands** run where you say: `device: desktop`.
- **Rules that arrive by sync are not trusted.** Every computer reads the same rules file, but a shell command from it runs only after that computer's owner has switched shell commands on and approved that command.

**A worked example.** You have a laptop and a desktop, both open, and a rule `archive` (`on: { change: status, to: done }`, `move_file: Archive/`). On the laptop you tick a task, so `status: done` is saved at 10:00:00.

| Time | Laptop | Desktop |
|---|---|---|
| 10:00:00 | The change is yours, so the rule runs now: the page moves to `Archive/` and the laptop records it in its device file. | Nothing yet. |
| 10:00:20 | | The synced files arrive. The desktop sees a change it did not make and, because the laptop is alive, waits one `sync_delay`. |
| 10:01:20 | | Its turn comes. It looks again, finds the page already in `Archive/` and the laptop's record, and does nothing. |

If the laptop had been closed at 10:00:00 (you ticked the task on the phone, say), the desktop would have found no other computer alive and acted at once.

```yaml
settings:
  devices: [desktop, laptop]   # who goes first among the computers that wait
  sync_delay: 90s        # how long each other computer waits for the one where the change was made (default 60s)
  live_window: 15min     # a computer not heard from for this long is treated as away (default 12min)
  heartbeat: 5min        # how often a computer says it is alive (default 5min)
  max_depth: 3           # rules triggered by rules triggered by rules: stop after this many (default 3)
  max_runs_per_minute: 120
  wake_delay: 3min       # after starting or waking up, how long to let sync catch up (default 2min)
rules: []
```

## Pages deleted on purpose (tombstones)

A sync service that sees a file deleted on one computer and edited on another usually keeps the edited copy, so a page you delete can come back if another computer (or a rule on it) touches its old copy before the deletion has arrived. Tombstones stop that for the pages you choose. They are off unless you switch them on:

```yaml
settings:
  tombstones:
    where: type:task       # which pages; leave it out for every page that has the property
    property: id           # the property that holds each page's id (default id)
    came_back: notify      # notify (default), ignore, or a folder to move it to, like "Tasks/Came back/"
rules:
  - id: give-tasks-an-id
    where: type:task -has:id
    on: { match: true, existing: true }
    do:
      - set_property: { id: "${new_id()}" }
```

`tombstones: true` is short for every page that has an `id`, with the defaults for `property` and `came_back`.

- **A page needs an id.** Tombstones go by the page's id, not its name or place, so a page that is moved, renamed or archived is the same page, and a new page with the old name is a different one. Give ids with [`new_id()`](03-values/01-functions.md#ids), as above; a page without one is never remembered.
- **When you delete a page in Cave Notes** and it is covered by `where` and has an id, the computer you deleted it on writes a tombstone (the id, when, and the page's path and title) into its device file, which every other computer reads. Cancelling the deletion writes nothing. A page deleted outside the app (in a file manager, by a script, by sync) gets no tombstone: only a deletion you made on purpose counts, so a file that briefly goes missing while syncing is never mistaken for one.
- **Rules leave a tombstoned page alone** on every computer: no rule runs on it, and no rule (an `update_pages`, say) writes to it, so they cannot keep bringing it back. The log says why it was skipped.
- **If it comes back anyway**, each computer tells you once (`came_back: notify`), or moves it into the folder you named and tells you, or says nothing (`ignore`; rules still leave it alone). Delete it again, or, if you want to keep it after all, remove its id or give it a new one: then it is an ordinary page again.
- **Every computer must know about tombstones.** The setting goes in the shared rules file, and a computer running an older version of Cave Notes ignores it and can still bring pages back. Tombstones are kept for a year.

---

Previous: [Shell commands](07-shell.md) · Next: [Safety nets and the background](08-safety.md)
