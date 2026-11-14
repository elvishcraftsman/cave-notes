---
order: 2
---
# Triggers

*Part of [Automations](../04-automation.md).*

A trigger says *when* a rule runs. A rule has one trigger or a list of them in its `on:` field.

| Trigger | Fires when | Notes |
|---|---|---|
| `on: { change: status, to: done }` | A property changes. `from` and `to` are optional. | `change: status` is the property called `status`. `from: todo` fires only if the old value was `todo`; `to: done` only if the new value is `done`. Capitals do not matter. Also fires when a **new page appears** with that value. A page that already had the value when the rule was first loaded does not fire. |
| `on: match` | A page **starts** to match `where`. | Needs `where`. Checked after each change and every 5 minutes, so it can notice that a date has passed. `on: { match: true, existing: true }` also fires for pages that already match when the rule is first loaded. |
| `on: { schedule: "0 8 * * *" }` | The clock reaches a time. | See *Writing a schedule* below. With `where`, it runs once for each page found; without, it runs once with no page (then `this` is empty). Missed while the app was closed: it runs **once** when the app is next open, however many times it was missed. A new rule does not run for the past. |
| `on: { at: due, offset: -1d, time: "09:00" }` | The date in a property arrives. | `at: due` is the property called `due` (for a property called `deadline` write `at: deadline`). `offset` moves the moment: `-1d` is one day before, `2w` two weeks after, `1mo` a month after. `time` is the time of day when the property is a date without a time (default 09:00); a property that has its own time (`due: 2026-11-01 14:30`) uses that instead. `late` (default `3d`, at most `30d`) is how late a missed date is still acted on: with `late: 3d`, an app that was closed on the due date still acts if it is opened within 3 days, and stays silent after that. It fires again if the date is changed. |
| `on: created`, `on: modified`, `on: deleted` | A page file is added, saved or removed. | `modified` fires for a save, but not again for the same page in the same ten-minute block: the clock is cut into fixed ten-minute blocks, and a page saved five times in one block fires once. |
| `on: button` | Someone clicks a button that names the rule. | See [Buttons](02-triggers/01-buttons.md). |
| `on: { plugin: "Name" }` | Someone picks the rule from the **Plugins** menu beside the main menu. | `on: plugin` alone uses the rule's `name`. See [Plugins](02-triggers/02-plugins.md). |

Several triggers can be listed: `on: [created, { change: status }]`. The older form `trigger: { on: property_change, property: status, to: done }` with `actions:` also works.

Dates are read in local time. A plain date means that day; `offset` and `time` place the moment within it.

## What a `change` trigger does and does not fire for

For `on: { change: status, to: done }`:

| What happens | Fires? |
|---|---|
| `status` goes from `todo` to `done` | Yes |
| `status` is `done` and you save the page again without changing it | No, nothing changed |
| A new page is created with `status: done` | Yes |
| The page already had `status: done` when you wrote the rule | No |
| `status` goes from `done` to `doing` | No: the new value is not `done` |
| `status` is removed from the page | No (a `change` without `to` does fire, and `new.status` is then empty) |
| The page is moved or renamed while it already has `status: done` | **No, when the app sees it happen**: it recognizes the page (same text, new place) and its last known values go with it. **Yes when it cannot tell**: the page was moved while the app was closed, moved on another computer and arrived by sync, or its text changed in the same moment. It then counts as a new page with that value, like the *new page* row above |

A rule that makes something when a page is finished (the next task, an archive copy) should not rely on this alone: see the guard in the [recurring task example](05-examples.md#recurring-task-creation), which also holds when a page is moved or renamed after it is done.

## Writing a schedule

A schedule is five fields: **minute hour day-of-month month weekday**. `*` means "every". In the weekday field 1 is Monday and 7 is Sunday (0 also means Sunday).

| Schedule | When |
|---|---|
| `"0 8 * * *"` | Every day at 08:00 |
| `"30 17 * * 1-5"` | Monday to Friday at 17:30 |
| `"0 9 * * 1"` | Every Monday at 09:00 |
| `"0 18 * * 0"` | Every Sunday at 18:00 |
| `"0 7 1 * *"` | The 1st of every month at 07:00 |
| `"*/15 * * * *"` | Every 15 minutes |

The shortcuts mean: `@hourly` = every hour on the hour; `@daily` = every day at 00:00; `@weekly` = **Monday** at 00:00; `@monthly` = the 1st at 00:00; `@yearly` = 1 January at 00:00. If you give both a day-of-month and a weekday (`"0 9 1 * 1"`), it fires when **either** matches, as in classic cron.

## Triggers that need their own page

- [Buttons that run a rule](02-triggers/01-buttons.md): `on: button`, started by a click in a page.
- [Plugins: rules you start from the editor](02-triggers/02-plugins.md): `on: { plugin: "Name" }`, started from the Plugins menu on the text you are writing.

---

Previous: [Writing a rule](01-rules.md) · Next: [Actions](04-actions.md)
