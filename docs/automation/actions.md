---
order: 3
---
# Actions

*Part of [Automations](../automation.md).*

The `do:` list of a rule holds actions, run in order.

Each item of `do:` is one action: `name: arguments`. Add `if: <expression>` beside it, as a second key of the same item, to run it only sometimes; add `name: "a label"` beside it if you want to name it. If an action fails, the rest of the rule stops and the reason is logged.

```yaml
do:
  - set_property: { owner: me }       # one action
    if: new.status == "doing"         # ...which only runs when this is true
```

| Action | What it does |
|---|---|
| `set_property` | Sets properties on this page. One property: `{ field: due, value: "2026-11-01" }`. Several at once: `{ status: done, completed_at: "${today}" }`. A value of `null` removes the property. (A property that is itself called `field` has to be set with the first form.) |
| `remove_property` | `rating` or `[a, b]`: takes those properties off the page. |
| `add_days` | `{ field: due, days: 7 }` moves the date in `due` forward by 7 days. It shifts **every time it runs**; for something safe to repeat use `set_property` with a computed date. `unit:` changes what `days` counts: `{ field: due, days: 2, unit: w }` is two **weeks** (units: `d`, `w`, `mo`, `y`). `from:` starts from another date instead of the property's own: `{ field: next_review, days: 3, from: "${today}" }` is three days from today. |
| `move_file` | `Archive/` moves the page, with its sub-pages, **under the page called Archive** (the page `Archive.md` and its folder `Archive/`). Before: `Water.md`. After: `Archive/Water.md`. If Archive does not exist it is made. Links to the page are kept working. Nothing happens if the page is already there. |
| `create_page` | `{ name, in, content, template, properties }` makes a page unless one with that name already exists. `name` is the title; `in` is the page it goes under (leave it out for the top level); `content` is Markdown text and may use `${ }`; `template` starts the page from a template page instead (if you give both, `content` wins); `properties` are set afterwards. After it, `${created.path}` names the page. |
| `append_to_page` | `{ text, page, heading }` adds `text` to the end of a page (this one by default). With `heading: Agenda` it goes to the end of the section under that heading, and the heading is added at the end of the page if it is not there. Skipped if the same text is already anywhere in the page. If `page` names a page that does not exist it is an error, unless you add `create_missing: true`. |
| `copy_tasks` | `{ from, to, mode, heading }` carries unfinished tasks (lines like `- [ ] Call Sam`, with the indented lines under them) from one page to another. Ticked tasks stay behind. `mode: copy` (the default) leaves the originals as they are; `mode: move` marks them `- [>] Call Sam` in `from`. A task already in `to` is not added again. `heading` puts them under that heading of `to`. `to` is made if it is missing (add `create_missing: false` to skip instead). |
| `update_pages` | `{ where, set, limit }` sets properties on every page a query finds. `$this` in `where` is the page that triggered the rule; the page itself is never one of the pages updated. At most `limit` pages (default 100, at most 500). Keeps related pages in step. |
| `transform_text` | Only in a [plugin](triggers/plugins.md): changes the selected text, or the whole page if nothing is selected, in steps: `regex` (find and replace), `heading_shift` (`by: 1` or `-1`) and `trim_lines`. For anything else use `run_js`. |
| `notify` | A system notification: `notify: "text"` or `{ title, body }`. Without a title it is the page's title. |
| `log` | `log: "text"` writes a line to the automation log. |
| `stop` | Ends the rule here, and counts as done. Use it with `if:`: `- stop: true` with `if: this.priority == "low"` means "low priority pages stop here". |
| `run_js` | Runs a short piece of JavaScript on the page: it reads the text, the cursor and the properties and returns the changes. See [JavaScript in rules](javascript.md). |
| `run_shell` | Runs a program. See [Shell commands](shell.md). |

Page references (`in`, `page`, `from`, `to`, `template`) are a path, name or title: `Journal/2026-10-16`, `Tasks`.

---

Previous: [Triggers](triggers.md) · Next: [Values and expressions](values.md)
