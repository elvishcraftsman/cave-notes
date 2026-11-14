---
order: 1
---
# Functions

*Part of [Values and expressions](../03-values.md).*

Every function you can use inside `${ }` or in an `if:` expression, by kind. The page [Values and expressions](../03-values.md) explains how expressions are written.

## Dates and durations

Dates keep their type: a date stays a date until it is shown as text. Units for durations are `min h d w mo y` (`m` alone is not accepted).

| Function | What it gives |
|---|---|
| `add(date, "7d")` | A date moved forward: `add(today, "7d")` is a week from today. Units: `min h d w mo y`. A negative amount moves back. |
| `sub(date, "7d")` | A date moved back. |
| `date(text)` | Read text as a date (null if it is not one). |
| `format(date, "YYYY-MM-DD")` | Text from a date. Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH mm ss. `format(today, "dddd D MMMM YYYY")` is `Monday 26 October 2026`; `"ddd DD MMM YY"` is `Mon 26 Oct 26`. |
| `days_between(a, b)` | Whole days from a to b (negative if b is earlier): `days_between(today, this.due)` is `3` when it is due in 3 days. Same as `this.due - today`. |
| `start_of(date, "week")` | The first moment of the `day`, `week` (starting Monday), `month` or `year` that holds the date. On Monday 2026-10-26, `"week"` gives 2026-10-26 and `"month"` gives 2026-10-01. |
| `day(date)` | The date without its time of day: `day(this.modified)` for `2026-10-26 14:30` is `2026-10-26`. |
| `weekday(date)` | The day of the week, 1 = Monday ... 7 = Sunday. |
| `next_weekday(date, 1)` | The next date **after** the given one that falls on this weekday, 1 = Monday ... 7 = Sunday. Never the date itself: on Monday 2026-10-26, `next_weekday(today, 1)` is the next Monday, 2026-11-02, and `next_weekday(today, 3)` is Wednesday 2026-10-28. |

```yaml
rules:
  - id: weekly-review-date
    on: { schedule: "0 8 * * 1" }
    do:
      - log: "Next review ${format(next_weekday(today, 5), 'dddd D MMMM')}"
```

## Choosing a value and empty values

A missing property is `null`, not an error. These functions pick a value or fall back when there is none.

| Function | What it gives |
|---|---|
| `if(test, a, b)` | a when the test is true, otherwise b. |
| `coalesce(a, b, ...)` | The first value that is not empty. |
| `default(value, fallback)` | The value, or the fallback when it is empty. |
| `is_empty(value)` | True for null, empty text and empty lists. |

## Ids

| Function | What it gives |
|---|---|
| `new_id()` | A new id that no other page has: 16 lowercase letters and digits, starting with a letter, like `k3f9q2xw7m1t0hbz`. It is random, so it is different every time the rule runs. Write it into a property once and it stays with the page through renames and moves. `new_id("task")` puts a word in front: `task-k3f9q2xw7m1t0hbz`. |

An id is only stable once it is stored, so give it once and never again: a rule with `where: type:task -has:id`, `on: { match: true, existing: true }` and `set_property: { id: "${new_id()}" }` gives every task one, and `create_page` can set `id: "${new_id()}"` among its properties. Two computers that both give the same page an id before they have seen each other's work can each write a different one, and the last write wins; this does no harm unless something already used the first id. [Tombstones](../09-computers.md#pages-deleted-on-purpose-tombstones) use these ids.

## Text

Text compares without regard to capitals, as in queries; `replace` and `trimword` work on the text as written.

| Function | What it gives |
|---|---|
| `upper(text)` | Capitals. |
| `lower(text)` | Lower case. |
| `trim(text)` | Without spaces at the ends. |
| `replace(text, "a", "b")` | Every "a" in the text becomes "b" (plain text, not a pattern). |
| `starts_with(text, prefix)` | True if the text starts with the prefix. |
| `slug(text)` | Text safe for a file name: letters, digits and dashes. `slug("Hello World, again!")` is `hello-world-again`. |
| `trimword(text, count, "start")` | Takes `count` words off the end of the text, or off the start when the third value is `"start"` (a negative count also takes from the start). With the title `Team meeting 2026-10-26`: `trimword(this.title, 1)` is `Team meeting` (the date is gone), and `trimword(this.title, 1, "start")` is `meeting 2026-10-26`. |
| `string(value)` | As text. |

## Lists and text together

These work on a list or on text.

| Function | What it gives |
|---|---|
| `contains(list_or_text, x)` | True if the list has x, or the text includes it (capitals ignored). |
| `join(list, ", ")` | A list as text. |
| `first(list)` | The first item. |
| `last(list)` | The last item. |
| `unique(list)` | The list without repeated items. |
| `sort(list)` | The list in order, smallest first (numbers and dates by value, text without regard to capitals). |
| `reverse(list)` | The list the other way round. |
| `range(from, to)` | The whole numbers from one to the other, as a list (at most 1000): `sum(range(1, 10))` is 55. |
| `split(text, ",")` | Text cut into a list at every separator; the pieces lose their surrounding spaces. |
| `substr(text, start, length)` | Part of a text: from character `start` (the first is 1), `length` characters (to the end when left out). `substr("Chapter", 1, 4)` is `Chap`. |
| `len(value)` | The length of a list or text. |

## Numbers

| Function | What it gives |
|---|---|
| `number(value)` | Read as a number (null if it is not one). |
| `round(n, digits)` | Rounded; digits defaults to 0. |
| `floor(n)` | Rounded down. |
| `ceil(n)` | Rounded up. |
| `abs(n)` | Without its sign. |
| `clamp(n, low, high)` | n kept between low and high. |
| `sqrt(n)` | The square root. |
| `pow(n, power)` | n to the power: `pow(2, 10)` is 1024. |
| `percent(part, whole, digits)` | What percentage part is of whole, rounded to `digits` (default 1): `percent(3, 8)` is 37.5. Null when whole is 0. |
| `fixed(n, digits)` | A number as text with exactly this many decimals: `fixed(2.5, 2)` is `2.50`. |
| `commas(n, digits)` | A number as text with thousands separators: `commas(1234567.5, 1)` is `1,234,567.5`. Digits defaults to what the number has (at most 3). |
| `years_between(a, b)` | Whole years from a to b (negative if b is earlier): `years_between(this.born, today)` is an age. |

## Totals, averages, largest and smallest

These work on a list, on several values, or on the pages a query finds (see [Expressions and formulas](../../03-organizing/03-expressions.md), which explains the query forms). Empty values and text that is no number are skipped, as in a spreadsheet.

| Function | What it gives |
|---|---|
| `sum(list)` | The total of the numbers in a list (or in several values); empty values and text are skipped. `sum("query", "attribute")` adds up the attribute over the pages a query finds. |
| `avg(list)` | The average of the numbers (null when there are none). Also `average` and `mean`. `avg("query", "attribute")` averages over the pages a query finds. |
| `min(a, b, ...)` | The smallest number: of several values or of a list. `min("query", "attribute")` is the smallest over the pages a query finds. |
| `max(a, b, ...)` | The largest number: of several values or of a list. `max("query", "attribute")` is the largest over the pages a query finds. |
| `median(list)` | The middle number of a list. `median("query", "attribute")` works over the pages a query finds. |
| `product(list)` | The numbers of a list multiplied. |
| `count(list)` | How many items a list has that are not empty. `count("query")` is how many pages a query finds; `count("query", "attribute")` how many of them have a value for the attribute. |

## Reading pages and queries

These are for expressions in the text of a page and in attribute formulas, where the workspace can look at other pages. They are not available in automation rules (`sum` and the other totals of a *list* are).

| Function | What it gives |
|---|---|
| `values("query", "attribute")` | The list of an attribute's values on the pages a query finds (numbers stay numbers). Use it where a list is wanted: `sum(values("under:[[Budget]]", "cost"))`. |
| `titles("query")` | The titles of the pages a query finds, as a list: `join(titles("status: active"), ", ")`. |
| `page("Name")` | The page with that name, to read its attributes: `page("Budget").total`. Write `[[Budget]].total` for the same. |

---


