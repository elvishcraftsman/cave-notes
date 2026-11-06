---
order: 1
---
# Functions

*Part of [Values and expressions](../values.md).*

Every function you can use inside `${ }` or in an `if:` expression, by kind. The page [Values and expressions](../values.md) explains how expressions are written.

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
| `len(value)` | The length of a list or text. |

## Numbers

| Function | What it gives |
|---|---|
| `number(value)` | Read as a number (null if it is not one). |
| `round(n, digits)` | Rounded; digits defaults to 0. |
| `floor(n)` | Rounded down. |
| `ceil(n)` | Rounded up. |
| `min(a, b, ...)` | The smallest number. |
| `max(a, b, ...)` | The largest number. |
| `abs(n)` | Without its sign. |
| `clamp(n, low, high)` | n kept between low and high. |

---


