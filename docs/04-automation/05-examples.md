---
order: 5
---
# Examples

*Part of [Automations](../04-automation.md).*

Each example is a complete rules file; put several rules under one `rules:`.

### Due date notifications

```yaml
rules:
  - id: due-today
    where: kind:task -status:done
    on: { at: due, time: "09:00" }
    do:
      - notify: { title: "Due today", body: "${this.title}" }
  - id: due-tomorrow
    where: kind:task -status:done
    on: { at: due, offset: -1d, time: "17:00" }
    do:
      - notify: "${this.title} is due tomorrow"
```

### Recurring task creation

When a task is finished, make the next one, a week later or a month later.

```yaml
rules:
  - id: recur
    where: kind:task recurs:weekly,monthly
    on: { change: status, to: done }
    if: is_empty(this.recurred_to)
    let:
      next: "${add(this.due, if(this.recurs == 'monthly', '1mo', '7d'))}"
    do:
      - set_property: { completed_at: "${today}" }
      - create_page:
          name: "${this.title} ${let.next}"
          in: Tasks
          properties: { kind: task, status: todo, recurs: "${this.recurs}", due: "${let.next}", previous_task: "[[${this.title}]]" }
      - set_property: { recurred_to: "${created.path}" }
```

How it reads: `recurs:weekly,monthly` is "the property `recurs` is `weekly` or `monthly`" (a comma means *or*). `let: next` works the date out once: a week after `due`, or a month after if `recurs` is `monthly`. A task `Water plants` with `due: 2026-10-26` and `recurs: weekly` is finished; the rule stamps it, makes **Water plants 2026-11-02** under `Tasks` with `due: 2026-11-02`, and writes the new page's path in the old one's `recurred_to`.

**The guard.** `if: is_empty(this.recurred_to)` makes the rule do nothing for a task that already made its next one. `create_page` only skips a page that exists at exactly the path it would write to, so a task that is renamed or moved after it was finished (an archive rule, say, moving finished tasks to another folder) could otherwise make its next task a second time. The old task's `recurred_to` is what the guard reads, whatever the page is called or wherever it is. `previous_task` links the new task back to the old.

One thing to watch: the new title is the old title plus a date, so the next time round it would be `Water plants 2026-11-02 2026-11-09`. If your titles end in their date, take the old date off first: `name: "${trimword(this.title, 1)} ${let.next}"` gives `Water plants 2026-11-09`.

### Ephemeral capture ingestion

Flag inbox notes nobody has touched for three days, once. Read the query as: pages **under** the page `Inbox` (`under:"Inbox"`), last changed **before** three days ago (`mtime:<$now.day-3`), that do **not yet** have a `stale` property (`-has:stale`). Setting `stale: true` is what stops the rule from flagging the same page again tomorrow.

```yaml
rules:
  - id: stale-inbox
    where: under:"Inbox" mtime:<$now.day-3 -has:stale
    on: { schedule: "0 7 * * *" }
    do:
      - set_property: { stale: true }
```

### Stale document archiving

```yaml
rules:
  - id: archive-stale
    where: kind:note status:active mtime:<$now.day-180
    on: { schedule: "@weekly" }
    do:
      - set_property: { status: archived, archived_at: "${today}" }
      - move_file: Archive/
```

### Legal and compliance retention

Flag a page when its retention date passes. Redacting text is left to a script you write and approve. The script path `./scripts/redact.sh` is relative to the workspace folder (commands start there unless `cwd` says otherwise), so the script lives in a `scripts` folder at the top of the workspace. `${this.path}` is handed to it as the page's path inside the workspace, for example `Records/Smith.md`.

```yaml
rules:
  - id: retention-flag
    where: has:retain_until -status:expired
    on: { at: retain_until, time: "00:00", late: 30d }
    do:
      - set_property: { status: expired }
      - notify: "Retention date passed: ${this.title}"
  - id: retention-redact
    device: desktop
    where: kind:record status:expired -has:redacted
    on: { change: status, to: expired }
    do:
      - run_shell:
          argv: [./scripts/redact.sh, "${this.path}"]
          on_success: { set_property: { redacted: "${today}" } }
```

### Spaced repetition review scheduling

Rate a card (`rating: again|hard|good|easy`); the rule works out the next interval and date, then clears the rating. A daily study queue is a view: `query: kind:card next_review:<=$now.day`.

The interval is multiplied by a factor that depends on the rating: `again` goes back to 1 day, `hard` is the old interval times 1.2 (at least 1), `good` times 2.5 and `easy` times 3.5. A card whose `interval_days` is 4 and is rated `good` gets `round(4 × 2.5)` = 10 days, so `next_review` is ten days from today. The first `default(this.interval_days, 1)` means "use 1 day for a card that has never been reviewed".

The line `if: "!is_empty(new.rating)"` matters: the last action removes `rating`, and removing it is itself a change of `rating`, which would run the rule again. With the `if`, that second run sees an empty rating and stops.

```yaml
rules:
  - id: review-card
    where: kind:card
    if: "!is_empty(new.rating)"
    on: { change: rating }
    let:
      days: "${if(new.rating == 'again', 1, if(new.rating == 'hard', max(1, round(default(this.interval_days, 1) * 1.2)), if(new.rating == 'good', round(default(this.interval_days, 1) * 2.5), round(default(this.interval_days, 1) * 3.5))))}"
    do:
      - set_property:
          interval_days: "${let.days}"
          next_review: "${add(today, string(let.days) + 'd')}"
      - remove_property: rating
```

### Progressive summarization prompts

A week after you mark an extract as highlighted, get a prompt and a place to write.

```yaml
rules:
  - id: summarize-prompt
    where: kind:extract has:highlighted -has:summary
    on: { at: highlighted, offset: 7d, time: "09:00" }
    do:
      - append_to_page: { heading: Summary, text: "(write your summary here)" }
      - notify: "Write a summary of ${this.title}"
```

### Kanban workflow auto-assignment

```yaml
rules:
  - id: card-moved
    where: kind:card
    on: { change: status }
    do:
      - set_property: { status_changed: "${today}", previous_status: "${old.status}" }
      - set_property: { owner: "${default(this.owner, 'me')}" }
        if: new.status == "doing"
      - set_property: { done_on: "${today}" }
        if: new.status == "done"
```

### Stalled project detection

Every Monday at 09:00 (`"0 9 * * 1"`), each active project is looked at, and the ones with no sub-page changed in the last two weeks are marked blocked. `unless: under:$this mtime:>$now.day-14` reads: *unless there is a page below this one that was changed less than 14 days ago*.

```yaml
rules:
  - id: stalled
    where: kind:project status:active
    unless: under:$this mtime:>$now.day-14
    on: { schedule: "0 9 * * 1" }
    do:
      - set_property: { status: blocked, blocked_since: "${today}" }
```

### End-of-day task rollover

At midnight, unfinished tasks of yesterday's journal page move to today's. "Move" here means copied into today's page and marked `- [>]` in yesterday's (`mode: move`); with the default `mode: copy` yesterday's page would be left untouched. Pages are named by date, for example `Journal/2026-10-25` and `Journal/2026-10-26`.

```yaml
rules:
  - id: rollover
    on: { schedule: "0 0 * * *" }
    do:
      - copy_tasks:
          from: "Journal/${format(sub(today, '1d'), 'YYYY-MM-DD')}"
          to: "Journal/${format(today, 'YYYY-MM-DD')}"
          mode: move
```

### Periodic metric rollups

Every Sunday evening, make the week's review page with a table of the week's daily notes (edit `columns` to your own properties). Sums and averages are for a view or a script.

````yaml
rules:
  - id: weekly-review
    on: { schedule: "0 18 * * 0" }
    do:
      - create_page:
          name: "Week of ${format(start_of(today, 'week'), 'YYYY-MM-DD')}"
          in: Reviews
          content: |
            # Week of ${format(start_of(today, 'week'), 'YYYY-MM-DD')}

            ```view
            type: table
            query: under:"Journal" date:$now.week
            sort: date
            columns: [title, mood, sleep, steps]
            ```

            ## Reflections
````

### Smart template injection

When a page is given `type: meeting`, give it the properties a meeting needs and file it.

```yaml
rules:
  - id: meeting-setup
    where: -has:date
    on: { change: type, to: meeting }
    do:
      - set_property: { date: "${today}", status: planned }
      - append_to_page: { heading: Agenda, text: "(add agenda items)" }
      - move_file: Meetings/
```

### Backlink and property sync

When an organisation's status changes, copy it to every person page that names it. Here `${this.title}` and `${new.status}` are filled in even inside `where`, because it is the `where` of the action `update_pages`, not of the rule. If the organisation `Acme` changes to `status: closed`, every page with `kind: person` and `org: Acme` gets `org_status: closed`.

```yaml
rules:
  - id: org-status
    where: kind:org
    on: { change: status }
    do:
      - update_pages:
          where: kind:person org:"${this.title}"
          set: { org_status: "${new.status}" }
```

### Auto-publishing

```yaml
rules:
  - id: publish
    device: desktop
    where: kind:post
    on: { change: status, to: published }
    do:
      - run_shell:
          argv: [./scripts/publish.sh, "${this.path}"]
          timeout: 120s
          on_success: { set_property: { published_at: "${today}" } }
          on_failure: { notify: "Publishing ${this.title} failed" }
```

### Local calendar syncing

When a page gets an `event_date`, create the entry with a command-line calendar (khal here; any command works).

```yaml
rules:
  - id: calendar-entry
    device: desktop
    where: has:event_date -has:calendar_added
    if: "!is_empty(new.event_date)"
    on: { change: event_date }
    do:
      - run_shell:
          argv: [khal, new, "${format(new.event_date, 'YYYY-MM-DD')}", "${this.title}"]
          on_success: { set_property: { calendar_added: "${today}" } }
```

---

Previous: [JavaScript in rules](06-javascript.md) · Next: [Shell commands](07-shell.md)
