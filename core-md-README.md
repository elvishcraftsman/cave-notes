# @concept-tree/core-md

Parses one Markdown page into frontmatter, headings and links. Pure functions, no filesystem or Electron. Node >= 20.

```js
import { parse } from '@concept-tree/core-md';

const page = parse(text);
page.title;              // first "# H1", else frontmatter `title`, else null (caller falls back to the file name)
page.frontmatter;        // { present, data, error, endLine, endOffset }
page.headings;           // [{ level, text, slug, line, ord }]   slugs are GitHub-style, duplicates get -1, -2
page.links;              // see below
page.error;              // null unless the parse failed catastrophically
```

`parse` never throws. Malformed YAML gives `data: {}` plus `frontmatter.error`; the rest of the page is still parsed.

## Link fields

| Field | Meaning |
|---|---|
| `kind` | `page` (a .md path or same-page `#anchor`), `file` (any other local path or `file:` URL), `web` (http, https, ftp, mailto, tel, sms), `other` (any other scheme such as `javascript:`: **never open these**) |
| `syntax` | `md` or `wiki` |
| `via` | `inline`, `reference`, `autolink` (`<https://...>` or a bare URL), `wikilink` |
| `embed` | true for images (`![](x.png)`) and `![[x]]` |
| `target` | decoded path without the fragment (`''` for web links and same-page anchors) |
| `fragment` | decoded text after `#`, or null |
| `url` | full destination for `web` and `other`, else null |
| `raw` | the destination exactly as written in the source |
| `text` | link text, or the wikilink alias, or null |
| `line`, `column` | 1-based position of the link |
| `start`, `end` | 0-based offsets of the whole link in the input string |
| `pathStart`, `pathEnd` | offsets of just the path part (no `#fragment`, no `|alias`), or null when it is not rewritable (web links, `file:` URLs, same-page anchors). **Slice the source with these to rewrite a link on rename.** |

Reference-style links (`[x][r]`) are reported at the usage, but `pathStart`/`pathEnd` point into the *definition*. If several usages share one definition, dedupe by span before rewriting. Unused definitions are not links.

## What is ignored

Links and wikilinks inside code (inline, fenced, indented), HTML blocks, escaped `\[[x]]`, and frontmatter. Raw inline `<a href>` HTML is not extracted.

## Performance

`npm run bench` on the build machine: about **3 ms per ~1 KB page** (2000 pages in ~6 s). Parsing is the dominant cost of a full index rebuild, so core-index should (a) skip files whose hash is unchanged, (b) run rebuilds in a worker pool, and (c) never parse on the UI thread. The test suite is the contract, so the parsing engine can be swapped for a faster one behind `parse()` without touching callers.
