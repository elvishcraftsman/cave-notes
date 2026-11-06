---
order: 1
---
# Writing a rule

*Part of [Automations](../automation.md).*

Every rule is a few lines of YAML with the same fields. This page lists the fields and explains how the four conditions (`where`, `require`, `unless`, `if`) differ.

| Field | Meaning |
|---|---|
| `id` | Short name, shown in the log. Required, unique. |
| `name` | A longer name (optional). |
| `enabled` | `false` switches the rule off without deleting it. |
| `on` | The trigger, or a list of triggers. See [Triggers](triggers.md). |
| `where` | A query (the same language as search and views) that picks the pages the rule is about. The page has to be one of its results. |
| `require` | A query that must find **at least one page**. `$this` stands for the page the rule is looking at. |
| `unless` | A query that must find **no page at all**. `$this` stands for the page the rule is looking at. |
| `if` | An expression that must be true. It can use `this`, `old`, `new`, `now`, `today`. Written bare, without `${ }`. |
| `let` | Named values worked out once and used by several actions: `let: { days: "${...}" }`, then `${let.days}`. They are worked out in order, after `if`. |
| `ask` | Questions a plugin puts to the person before it runs. See [Plugins](triggers/plugins.md). |
| `do` | The actions, run in order. |
| `runs` | `once`: only one of your computers does the work (the default for rules that change files). `everywhere`: every computer does it (the default for rules that only notify or log). See [Several computers](computers.md). |
| `device` | Run only on the computer with this name, for example `device: desktop`. The name is set in Preferences → Sync and automation → Automations; if you never set one, it is the computer's own name. |

## Where, require, unless and if: which one do I use?

All four are conditions, and a rule runs only when all of the ones it has are met. They ask different questions:

| Field | The question it asks | Example | Meaning of the example |
|---|---|---|---|
| `where` | Is **this page** one of the results of the query? | `where: kind:task -status:done` | Only for task pages that are not done. |
| `require` | Does the query find **any** page, looking out from this page? | `require: under:$this status:todo` | Only if this page has at least one sub-page with `status: todo`. |
| `unless` | Does the query find **no** page, looking out from this page? | `unless: under:$this mtime:>$now.day-14` | Only if no sub-page was changed in the last 14 days. |
| `if` | Is the **expression** true? | `if: this.priority == "high"` | Only if this page's `priority` is `high`. |

`under:$this` means "pages below this one" and `mtime:>$now.day-14` means "changed less than 14 days ago", so the `unless` above reads: *this project has gone quiet*. Use `where` to pick pages, `require` / `unless` to look at the pages around one, and `if` for a test on values (it can compare `old` with `new`, which a query cannot).

Two things to know:

- `where` is checked against the page **as it is after the change**. A rule with `where: -status:done` and `on: { change: status, to: done }` can never fire, because by then the page is done. Leave the `-status:done` out, or test the old value: `if: old.status != "done"`.
- Query text (`where`, `require`, `unless`) is not filled in with `${ }`: there `$this` and `$now.day-14` keep their query meaning. The `where` **of the action** `update_pages` is different: it is an action argument, so `${ }` works there (see the examples).

## Sharing rules between workspaces

Tag the `rules:` section with `!global` and the other workspaces on this computer can use the rules too:

```yaml
rules: !global
  - id: stamp-finished
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { completed_at: "${today}" }
```

To share just some rules, put `- !global` on those rules instead of tagging the whole section; the others stay private. It works like the other shared sections (see *Settings shared with every workspace* in [attributes.md](../attributes.md)): a workspace is asked first, and what it answers is kept on this computer only. Things to know:

- A shared rule is **added to the workspace's own rules**. If both have a rule with the same `id`, the workspace's own wins. A `rules:` section that is present but empty switches the shared rules off for that workspace.
- The rules apply in each workspace that took them, to that workspace's pages. The rule stays in the workspace that offers it; edit it there.
- A shared rule that runs a program does not skip the guards: each workspace still needs *Let automations run shell commands* on and its own approval of the command (see [Shell commands](shell.md)).
- A workspace that has no `rules:` of its own starts its automations as soon as it takes a shared rule.

## Queries in rules

Rules use the search language (see [queries.md](../queries.md)). Two parts matter most for rules: `$this` (the page the rule is looking at, in `require`, `unless` and `update_pages`) and `mtime:` for when a file was last changed: `mtime:<$now.day-30` is "not touched for 30 days".

---

Next: [Triggers](triggers.md)
