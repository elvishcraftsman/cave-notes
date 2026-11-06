---
order: 4
---
# Values and expressions

*Part of [Automations](../automation.md).*

Any text in an action can contain `${expression}`. This page covers the syntax, dates and durations, and the variables you can use.

Any text in an action can contain `${expression}`. A few examples, if `this.due` is 2026-11-01 and `this.title` is `Water plants`:

| Written | Becomes |
|---|---|
| `"Due ${this.due}"` | The text `Due 2026-11-01` |
| `"${this.due}"` | The **date** 2026-11-01. When the whole text is one expression it keeps its type, so a date stays a date and a number stays a number. |
| `"${add(this.due, '7d')}"` | The date 2026-11-08 |
| `$today` | Today's date, on its own as the whole value: `{ completed_at: $today }` is the same as `"${today}"`. `$now` is the same for the moment. |
| `"$$5"` | The text `$5` (`$$` is a dollar sign) |

Where a field wants an **expression** and not text (the `if:` of a rule or of an action), write it bare: `if: this.priority == "high"`, not `if: "${this.priority == 'high'}"`.

Expressions have numbers, text (`"..."` or `'...'`), `true false null`, `+ - * / %`, `== != < <= > >=`, `&& || !`, `a ? b : c`, parentheses, `x.y` and `x["y-z"]`. Text compares without regard to capitals, as in queries. A missing property is `null`, not an error. A bare name that is not a variable (`due` on its own) **is** an error: write `this.due`.

Dates and durations, with `today` = 2026-10-26 and `this.due` = 2026-10-29:

| Expression | Result | Meaning |
|---|---|---|
| `this.due + "7d"` | 2026-11-05 | A date plus a duration. Units: `min h d w mo y` (`m` alone is not accepted). |
| `today - "1w"` | 2026-10-19 | A date minus a duration. |
| `this.due - today` | `3` | Two dates subtracted give a **number of days**: positive when the first is later, so `3` means "due in 3 days" and `-3` would be "3 days overdue". |
| `this.due < today` | `false` | Overdue is `this.due < today`. |

## Variables

| Variable | Holds |
|---|---|
| `now`, `today` | The moment, and today's date. |
| `this` | The page the rule is running for. Its properties by name (`this.status`, `this.due`), plus `title`, `path`, `name`, `folder`, `parent` and `modified` (a date). `this.path` is the path **inside the workspace** (`Records/Smith.md`), not a full path. If a property has one of those names, the built-in one wins. Empty for a time trigger that has no `where`. |
| `old`, `new` | For a `change` trigger only: the property that was watched, before and after. With `change: status`, `old.status` was `todo` and `new.status` is `done`. Other properties are not available as old values: use `this.x` for what they are now. |
| `trigger` | `trigger.kind`, `trigger.property`, `trigger.from`, `trigger.to`, `trigger.at` (the moment a schedule or date trigger was due). |
| `rule` | `rule.id`, `rule.name`. |
| `device` | `device.id`, `device.name` of this computer. |
| `let` | The names defined in the rule's `let:`. |
| `ask` | In a plugin: the answers to its `ask:` questions, `${ask.level}`. |
| `selection` | In a plugin: `true` if the plugin works on selected text, `false` if on the whole page. |
| `words`, `characters` | In a plugin: how many words and characters the text it works on has (see *Showing a message* under [Plugins](triggers/plugins.md)). |
| `created` | After `create_page`: `created.path`, `created.title`, `created.existed`. |
| `shell` | In `on_success` and `on_failure` of `run_shell`: `shell.code`, `shell.stdout`, `shell.stderr`, `shell.ok`. |

A date has `.year .month .day .weekday .hour .minute` (`this.due.year` is `2026`). `.day` is the day of the month and `.weekday` is 1 for Monday up to 7 for Sunday, as for `weekday()`.

## Functions

There are about forty, for dates, text, lists and numbers: `add(today, "7d")`, `format(this.due, "D MMMM")`, `coalesce(this.owner, "nobody")`. They are listed with examples in [Functions](values/functions.md).

---

Previous: [Actions](actions.md) · Next: [JavaScript in rules](javascript.md)
