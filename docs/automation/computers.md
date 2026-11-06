---
order: 7
---
# Several computers

*Part of [Automations](../automation.md).*

What happens when the same workspace is open on more than one computer.

**Do I need to do anything?** Not if you use one computer. If the same workspace is synced between computers that **all run Cave Notes with its rules**, each change is seen by all of them, and Cave Notes makes sure a change is acted on once. Most people never change a setting here. It works without any sync-specific protocol:

- **Notifications go to every computer.** A rule with only `notify` / `log` runs everywhere (`runs: everywhere`).
- **Changes to files happen once.** A rule that changes files is `runs: once`. Each computer writes a small file `.cave-notes/devices/<id>.yaml` saying it is alive (it has been heard from lately) and what it has done. Before acting, a computer looks again: has another one already done it? Is the reason still true? If so it does nothing.
- **The computer where you made the change acts at once.** If you tick a task, edit a page or drag a card on one computer, that computer runs the rule immediately, whatever its place in the order, so you never wait for a turn that is not yours. Every other computer sees the change arrive and waits: while other computers are alive it never goes first, and takes its turn after one `sync_delay` (default 60 s), then the next one after two, and so on. By then the first computer has said what it did, and the others do nothing. If that computer was closed or went to sleep before it could act, the next one in order does the work after its delay.
- **Changes made by another program** (a text editor, a script, a phone app that writes to the synced folder) count as coming from outside, so they wait like those from another computer. When no other computer is alive, the change is acted on at once.
- **Order.** `devices: [laptop, desktop]` in the rules file sets who goes first among the computers that wait (names are the computer names, lowercase; others follow by id). The name is set in Preferences → Sync and automation → Automations, or is the computer's own. Time triggers (`schedule`, `at`) are seen by every computer at the same moment, so for them the first in order acts at once and the others wait.
- **Offline.** Computers that cannot see each other may both act. Every action is written to do nothing when its work is done (a page that exists is not created again, a moved page is not moved, text already there is not added), and the same work gives the same result on each computer. So write rules that depend on the *trigger*, not on the moment you run: use `${today}`, a property's date or `trigger.at`, not `${now}`, when two computers must agree. `add_days` is the exception: it shifts again each time, so use `set_property` with `add(this.due, "7d")` when in doubt.
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
rules: []
```

---

Previous: [Shell commands](shell.md) · Next: [Safety nets and the background](safety.md)
