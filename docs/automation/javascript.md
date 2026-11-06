---
order: 6
---
# JavaScript in rules

*Part of [Automations](../automation.md).*

The built-in [actions](actions.md) cover the common jobs. When a job needs a little logic of its own, such as renumbering the headings of one section, a rule can run a short piece of JavaScript with `run_js`. The script reads the page and returns what should change; the app makes the change.

The script works on one page and nothing else. It cannot open files, use the network or start programs (that is what [shell commands](shell.md) are for).

## Turning it on

JavaScript in rules is **off** until you turn it on, on each computer:

1. **Preferences → Automations → Let automations run JavaScript.** The app asks you to confirm.
2. The first time a rule's script runs in a workspace, the app shows you the script and asks: *Deny*, *Allow once* or *Always allow this script*. Change one character of the script and it asks again. Approvals are kept on this computer only, never in the workspace, and *Forget approved commands and scripts* in Preferences clears them.
3. If you trust every workspace you open, switch off **Ask before running a rule's JavaScript** in the same place. The app asks you to confirm that too. Scripts then run without the question, but only while the first switch is on.

## A first script

This plugin puts today's date at the top of the page. Plugins are explained under [Plugins](triggers/plugins.md).

```yaml
rules:
  - id: date-line
    on: { plugin: "Add today's date" }
    do:
      - run_js:
          code: |
            return fn.format(today, "D MMMM YYYY") + "\n\n" + text;
```

`code` is the inside of a function. It can use `return`, and what it returns becomes the new text. Everything it can use is listed below.

## What the script can use

| Name | What it is |
|---|---|
| `text` | The text the rule works on. In a plugin: the selected text, or the whole page (frontmatter included) when nothing is selected. In any other rule: the whole page. |
| `selection` | `true` if `text` is a selection. |
| `cursor` | In a plugin: where the cursor is in `text`, as `{ offset, line, column }`. Otherwise `null`. |
| `page` | `{ path, title, name, folder, parent }` of the page the rule is working on. |
| `props` | The page's properties as plain values: `props.status`, `props.due` (dates are text such as `"2026-10-28"`). |
| `ask` | In a plugin: the answers to its questions, `ask.level`. |
| `today`, `now` | The date and the date with time, as text. |
| `vars` | Every variable the rule's `${ }` can use (`this`, `old`, `new`, `trigger`, `let` ...), as plain values. |
| `fn` | Every [function](values/functions.md): `fn.add(today, "7d")`, `fn.slug(page.title)`. |
| `log(...)` | Adds a line to the automation log. Handy while writing a script. |

### Positions

A **position** is an **offset**: how many characters from the start of the text, so the start is `0`. A line and a column count from 1, as the editor's status bar shows them. Wherever a script gives or takes a position, it can use an offset, or `{ line, column }`.

## What the script returns

Return text to replace the text, or an object with any of these:

| Key | Meaning |
|---|---|
| `text` | The new text. |
| `props` | Properties to set, `{ status: "done", due: null }` (`null` removes one). Not in a plugin: its page is open in the editor, so change the frontmatter in `text` instead. |
| `cursor` | In a plugin: where the cursor ends up. |
| `select` | In a plugin: a selection to leave, `{ from, to }`. |

Return nothing (or `null`) to change nothing. In a plugin the changes go into the editor as one step that Undo takes back; in other rules the page is written, and if it changed while the script ran, nothing is written and the rule tries again on the next change.

## Helpers for Markdown text

These work on any text, so you can use them on `text` or on a piece of it. They already skip the **frontmatter** and **fenced code** (`` ``` `` and `~~~`), so a `#` inside a code block is not a heading.

| Helper | Gives |
|---|---|
| `outline(text)` | Every heading, in order: `{ level, text, line, start, end, textStart }`. `start` and `end` are the offsets of the heading line, and `textStart` is where the heading's words begin (after `## `). |
| `headingAt(text, pos)` | The heading the position is under (the last one that starts at or before it), or `null`. |
| `nextHeading(text, pos, maxLevel)` | The next heading that starts after `pos`. With `maxLevel` it must be that level or higher up (`nextHeading(text, pos, 2)` finds the next `#` or `##`). |
| `previousHeading(text, pos, maxLevel)` | The last heading that starts before `pos`, with the same `maxLevel` rule. |
| `section(text, pos)` | The section of the heading `pos` is under: `{ heading, start, end }`. It runs to the next heading of the same level or higher, so it includes the sub-headings. |
| `fences(text)` | The fenced code blocks as `{ start, end }`. |
| `isInFence(text, pos)` | `true` if the position is inside a fenced code block. |
| `frontmatter(text)` | The frontmatter's `{ start, end }`, or `null`. |
| `lineAt(text, pos)` | `{ line, column, start, end, text }` for the line holding `pos`. |
| `offsetAt(text, line, column)` | The offset of a line and column. |
| `applyEdits(text, edits)` | Makes several changes at once and keeps the offsets right. Each edit is `{ from, to, insert }` (replace `from` to `to` with `insert`). Returns `{ text, map }`, where `map(oldOffset)` gives the matching offset in the new text, which is how a script keeps the cursor where it was. |

Making edits from the last to the first by hand works too, but `applyEdits` does that bookkeeping for you.

## Limits

- The script must finish in **2 seconds** (set `timeout:` in milliseconds beside `code:`, up to 10 seconds) and may use about **64 MB** of memory. Past either, it is stopped and the rule fails with a message.
- It runs **synchronously**: there is no `await`, no timer and no `fetch`.
- It sees only what is listed above. There is no `require`, no `process`, no files, and no `eval`.
- If it throws an error, the rule fails and nothing changes. The message, and the line of the script, appear in the automation log (and as a message when you ran it from the Plugins menu). `throw new Error("Put the cursor in a heading first.")` is the way to tell the person what to fix.
- `${ }` is **not** filled in inside `code`. Use the variables above instead (`props.status`, `ask.level`).
- Inside a rule's YAML, write the script as a block (`code: |`) so its indentation is kept.

## Examples

### Number the headings at the cursor

Run it with the cursor in or under a heading. It numbers every heading of that level (`1. Heading text`, `2. Another heading`) inside the section one level up: with the cursor under a `##`, only the `##` headings of that `#` section. At the top level it numbers the whole page. Running it again renumbers; it never stacks numbers (`1. 1. Intro`).

```yaml
rules:
  - id: number-headings
    on: { plugin: "Number headings at this level" }
    do:
      - run_js:
          code: |
            if (!cursor) throw new Error("This plugin needs the editor's cursor.");
            const here = headingAt(text, cursor.offset);
            if (!here) throw new Error("Put the cursor in or under a heading first.");

            // the part of the page to number: the section of the heading one level up, or the whole page
            const parent = previousHeading(text, here.start, here.level - 1);
            const from = parent ? parent.start : 0;
            const to = parent ? section(text, parent.start).end : text.length;

            const edits = [];
            let n = 0;
            for (const h of outline(text)) {
              if (h.start < from || h.start >= to || h.level !== here.level) continue;
              n++;
              const old = /^\d+[.)]\s+/.exec(h.text);          // a number from an earlier run
              edits.push({ from: h.textStart, to: h.textStart + (old ? old[0].length : 0), insert: n + ". " });
            }
            const result = applyEdits(text, edits);
            return { text: result.text, cursor: result.map(cursor.offset) };
```

### Numbered list to headings

Each top-level item of a numbered or bulleted list becomes a heading of the level you choose, and the items below it move up one level. With level 2, this list

```
1. First
   - a
   - b
2. Second
   1. x
```

becomes

```
## First
- a
- b
## Second
1. x
```

```yaml
rules:
  - id: list-to-headings
    on: { plugin: "Numbered list to headings" }
    ask:
      level: { label: "Heading level for the top items", type: number, default: 2, min: 1, max: 6 }
    do:
      - run_js:
          code: |
            const item = /^(\s*)((?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)]|[-*+])\s+(.*)$/;
            const width = (s) => s.replace(/\t/g, "    ").length;
            const lines = text.split("\n");
            const found = lines.map((l) => item.exec(l));

            // how far one level of indent is: the smallest indent in the text
            const indents = found.filter((m) => m && m[1].length > 0).map((m) => width(m[1]));
            const step = indents.length ? Math.min(...indents) : 0;

            const hashes = "#".repeat(ask.level);
            const out = lines.map((line, i) => {
              const m = found[i];
              if (!m) return line;                                    // not a list line: leave it
              const w = width(m[1]);
              if (w === 0) return hashes + " " + m[3];               // top level: a heading
              return " ".repeat(Math.max(0, w - step)) + m[2] + " " + m[3]; // deeper: one level up
            });
            return out.join("\n");
```

### Put the word count in a property

A rule that is not a plugin works on the page's file. This one writes the number of words into a `words` property every morning, for task and note pages.

```yaml
rules:
  - id: word-count-property
    where: kind:note
    on: { schedule: "0 6 * * *" }
    do:
      - run_js:
          code: |
            const front = frontmatter(text);                       // the properties are not part of the writing
            const body = front ? text.slice(front.end) : text;
            const words = body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
            return { props: { words } };
```

---

Previous: [Values and expressions](values.md) · Next: [Examples](examples.md)
