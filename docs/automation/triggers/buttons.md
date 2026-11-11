---
order: 1
---
# Buttons that run a rule

*Part of [Triggers](../triggers.md).*

A rule can wait for a click instead of a change. Give it `on: button`, then put a button in any page that names the rule's `id` after `automation:`:

```yaml
rules:
  - id: finish-task
    where: kind:task -status:done
    on: button
    do:
      - set_property: { status: done, completed_at: "${today}" }
      - move_file: Archive/
```

```
[=Mark as done](automation:finish-task)
```

How it works, step by step:

1. The text `finish-task` after `automation:` is the rule's `id`. If it is spelled differently, a message says there is no such rule.
2. The button is drawn with a ⚡ in front of its label. The `=` is optional for automation buttons, because they are always drawn as buttons. One click runs the rule, with no confirmation; Ctrl+click on the raw text of the link does the same. Put the cursor next to the button to see and edit its text.
3. The rule runs **for the page that holds the button**: `this` is that page, so `${this.title}` is its title.
   A button also works in text shown inside a page with `![[Page]]` (or `![[Page#Heading]]`, or a `![[@block]]`). There the rule runs for the page the text is shown in, not for the page the text comes from, the same way `${this.…}` and `$this` in embedded text mean the page showing it. Click it while the text is shown; the source page is not touched.
4. The page is saved first, so the rule sees what you just typed.
5. `where`, `require`, `unless` and `if` still apply. If the page does not meet them, nothing changes and a message says why: in the example above, clicking in a page that already has `status: done` says the page does not match `where`.
6. The click happens on this computer, so the rule runs here and now. It does not wait for another computer's turn.

## Buttons that ask first

A button's rule can have an `ask:` list, just like a [plugin](plugins.md): the click opens a small dialog with the questions, and the rule runs when the person presses **Run**. The answers are `${ask.name}` in the actions (and `ask.name` in a [script](../javascript.md)). **Cancel** runs nothing.

```yaml
  - id: pay-rent
    where: kind:account
    on: button
    ask:
      note:   { type: info, label: "Balance: ${this.balance}" }
      amount: { type: number, label: "How much?", default: 1000 }
    do:
      - set_property: { field: balance, value: "${this.balance - ask.amount}" }
```

Questions of type `info` only show a message (its label can use `${this.…}` for the page the button is in), so a rule with nothing but an `info` question is a confirmation: *Are you sure?* and **OK** or **Cancel**. Labels and defaults are worked out for the page just before the dialog opens.

A rule can only be started by a button if it lists `button` in its `on:`. This is deliberate: a note can come from another person, and without this rule a note could contain a button for any rule in your workspace. A rule can have a button and other triggers together: `on: [button, { schedule: "@daily" }]` means "every day, and also whenever I click". A button run has no `old` or `new` (they only exist for `change`).

---

Next: [Plugins](plugins.md)
