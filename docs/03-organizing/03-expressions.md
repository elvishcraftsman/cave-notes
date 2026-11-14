# Expressions and formulas

An **expression** is a small calculation written between `${` and `}`. It can read attributes, add up a column of numbers over all the pages a query finds, count pages, find the largest or smallest value, join titles, work with dates and format the result. Expressions are not a spreadsheet: there are no cells and no grid. The pages and their attributes are the data, a query chooses which pages, and an expression turns them into a value.

You can use expressions in two places:

- **In the text of a page.** `Spent so far: ${sum("under:$this", "cost")}` shows the total, live, right in the sentence.
- **As an attribute (a formula).** `total: ${sum("under:$this", "cost")}` in the attributes at the top of a page makes `total` a real attribute whose value is the result. Queries, sorting, table views and other expressions can use it like any other attribute.

Expressions are also allowed in the text of [automation rules](../04-automation.md), with the same language; see [Values and expressions](../04-automation/03-values.md) there.

## A first example

A folder-page `Trip budget` has three sub-pages, each with a `cost` attribute:

```
Trip budget/Flights.md    cost: 420
Trip budget/Hotel.md      cost: 610.50
Trip budget/Food.md       cost: 180
```

On the page `Trip budget` write:

```
---
total: ${sum("under:$this", "cost")}
items: ${count("under:$this")}
dearest: ${max("under:$this", "cost")}
cheapest: ${min("under:$this", "cost")}
average: ${round(avg("under:$this", "cost"), 2)}
---
# Trip budget

We have spent ${commas(sum("under:$this", "cost"), 2)} on ${count("under:$this")} things.
```

`total` becomes 1210.5, `items` 3, `dearest` 610.5, `cheapest` 180 and `average` 403.5. The text shows *We have spent 1,210.50 on 3 things.* Add a fourth sub-page and everything follows.

## Reading values

| Write | It is |
|---|---|
| `this.cost` | the attribute `cost` of the page the expression is on (names ignore capitals) |
| `this.title`, `this.path`, `this.name` | the page's title, path and file name without its extension |
| `[[Budget]].total` | the attribute `total` of the page Budget (the page is found like a link is) |
| `page("Budget").total` | the same, written as a function |
| `today`, `now` | today's date, the date and time now |
| `this["due date"]` | an attribute whose name has a space or a dot |

An attribute with one value is that value (a number is a number, a date is a date); an attribute with several values is a list. Missing attributes are empty, never an error: an empty value is skipped by `sum`, `avg` and the others.

Expressions understand `+ - * / %`, comparisons (`== != < <= > >=`), `&&`, `||`, `!`, `test ? a : b` and parentheses. `+` also joins text (`"Page " + this.number`) and adds a duration to a date (`this.due + "7d"`).

## Totals, counts, largest and smallest over a query

These functions take a **query** (the same words as in the search box and in [views](02-queries.md); write it in quotes) and, where it makes sense, the name of an **attribute**:

| Write | It is |
|---|---|
| `sum("query", "attr")` | the total of `attr` over the pages the query finds |
| `avg("query", "attr")` | the average (also `average`, `mean`) |
| `min("query", "attr")`, `max("query", "attr")` | the smallest and the largest |
| `median("query", "attr")` | the middle value |
| `product("query", "attr")` | all the values multiplied |
| `count("query")` | how many pages the query finds |
| `count("query", "attr")` | how many of them have a value for `attr` |
| `values("query", "attr")` | the list of values, to give to anything that takes a list |
| `titles("query")` | the list of titles of the pages |

A few queries to start with (all of [Queries](02-queries.md) works):

| Query | Pages |
|---|---|
| `under:$this` | the sub-pages of the page the expression is on, at every depth. `$this` is that page; in text another page pulls in with `![[page]]` it is the page showing the text |
| `children:$this` | only the direct sub-pages |
| `status:done` | every page whose `status` is `done` |
| `saved:Open tasks` | the pages of a saved query |
| `project:$this` | the pages whose attribute `project` links to this page |
| `kind:expense due.month:$now.month` | expenses due this month |

Rules worth knowing:

- **The query and the attribute must be written out in quotes**, not taken from a variable: `sum("status: done", "hours")`. This is what lets the workspace work out the answer before the rest of the expression runs.
- **Only numbers are added.** An empty value, or a value that is not a number (`n/a`), is skipped, as in a spreadsheet. A page with no value does not count towards `avg`; use `count("query", "attr")` to see how many had one.
- **Nothing found is not an error.** `sum` of no pages is 0; `avg`, `min`, `max` and `median` of no pages are empty (shown as *(empty)*).
- **Lists work as well.** `sum(values("under:$this", "cost"))` is the same as `sum("under:$this", "cost")`, and `values` can be combined: `max(values("under:$this", "cost")) - min(values("under:$this", "cost"))` is the spread. Lists of your own can be summed too: `sum(this.hours)` when `hours: [2, 3, 1.5]`.
- Dates work with `min` and `max` through `values`: `first(sort(values("kind:meeting", "date")))` is the earliest meeting.
- **Other workspaces** are not searched; a query reads the workspace the page is in.

## Formula attributes

An attribute whose **whole value** is one expression is a formula:

```yaml
---
total: ${sum("under:$this", "cost")}
share: ${percent(this.cost, [[Trip budget]].total)}
---
```

How it behaves:

- **The file keeps the formula; the index keeps the result.** Open the page and you see the formula. A [view](02-queries.md), a table, a query (`total:>1000`) and `sort:total` see the number. The attribute has the type of its result: a number, a date, true or false, text, or a list.
- **It stays current.** Formulas are worked out when the workspace opens and after every change to pages, so a formula that reads other pages follows them. Formulas can read each other (`label` using `total`). A formula that uses `today` or `now` is brought up to date every half hour and whenever anything changes.
- **Mistakes are reported.** A formula that cannot be worked out keeps its text as its value, and the problem is listed with the page's other diagnostics (see [Troubleshooting](../07-the-app/03-troubleshooting.md)).
- **Editing the value in a view replaces the formula.** If you type over a computed cell in a table view, the page gets the typed value and the formula is gone. Change the formula in the page itself.
- **Quote it in YAML if it needs it.** A formula with `: ` or ` #` in it must be in quotes: `note: "${this.a > 1 ? \"big\" : \"small\"}"`. Use single quotes inside the expression (`'big'`) to avoid escaping.
- **Handed down.** A formula in a `children:` block ([Attributes](01-attributes.md)) is worked out for every sub-page, with `this` being that sub-page: every task can have `days_left: ${days_between(today, this.due)}`.
- **It is a plain text value in other programs.** Other programs, and exports, see the formula text.

## In the text of a page

An expression in the text of a page is drawn where it stands and worked out again when anything it reads changes. Put the cursor in it to change it. See [Values from attributes](../02-writing/01-linking.md#values-from-attributes) for the links and buttons an attribute value can become. Anything more than reading one attribute (`this.x`, `[[Page]].x`) is worked out as described here. A list is shown separated by commas. If it cannot be worked out, the text says why, in red.

Inside code, and in the attributes at the top, `${…}` is not drawn as a value (in the attributes it is a formula, above).

## Using it: some ideas

| You want | Write |
|---|---|
| a project's progress | `done: ${count("under:$this status:done")}` and `progress: ${percent(this.done, count("under:$this"), 0)}` shown as `${this.progress}%` |
| hours spent | `hours: ${sum("project:$this", "hours")}` on a project page whose tasks have `project: [[Project]]` and `hours` |
| the next deadline | `next_due: ${first(sort(values("under:$this -status:done", "due")))}` |
| overdue tasks | `overdue: ${count("under:$this -status:done due:<$now.day")}` |
| a reading list's average rating | `${round(avg("kind:book read:true", "rating"), 1)}` |
| a grade | `grade: ${round(sum("student:$this", "score") / sum("student:$this", "max") * 100)}` |
| stock to reorder | `low: ${count("kind:part stock:<5")}` and `${join(titles("kind:part stock:<5"), ", ")}` |
| someone's age | `age: ${years_between(this.born, today)}` |
| money, nicely | `${commas(this.total, 2)}`, or `${fixed(this.total, 2)}` without separators |
| days until something | `${days_between(today, this.due)}` days left |
| who is on what | `${join(titles("assignee:$this"), ", ")}` |
| an average over the last 30 days | `${avg("kind:log mtime:>$now.day-30", "weight")}` |
| a count by kind | `${count("kind:bug status:open")} open bugs, ${count("kind:bug status:closed")} closed` |

## Formatting numbers

The result of arithmetic is shown without floating-point noise (`0.1 + 0.2` is `0.3`). To control how many decimals show:

| Function | Example | Gives |
|---|---|---|
| `round(n, digits)` | `round(2.456, 2)` | `2.46` |
| `fixed(n, digits)` | `fixed(2.5, 2)` | `2.50` |
| `commas(n, digits)` | `commas(1234567.891, 1)` | `1,234,567.9` |
| `percent(part, whole, digits)` | `percent(3, 8)` | `37.5` |

## Every function

[Functions](../04-automation/03-values/01-functions.md) lists them all: dates and durations, choosing a value, text, lists, numbers, totals and averages, and reading queries and pages.

## Limits

An expression has to end: there are no loops. It is limited to ten thousand steps, and a query can find at most 100,000 pages. A formula can read other pages, but not itself. Expressions cannot change anything; to change attributes use an [automation](../04-automation.md).
