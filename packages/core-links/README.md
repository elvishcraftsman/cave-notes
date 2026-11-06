# @cave-notes/core-links

Moving or renaming pages without breaking links. It plans every link edit, shows a preview, applies it safely, and can undo it. Depends on `core-tree` (the move), `core-md` (exact link positions) and `core-index` (what links where, and how names resolve).

```js
import { planMove, planRename, applyPlan, undo, describePlan, listJournal } from '@cave-notes/core-links';

const plan = await planMove({ tree, index, from: 'Theology/Grace.md', newParent: 'Doctrine.md' });
// or: await planRename({ tree, index, page: 'Theology/Grace.md', newName: 'Mercy' });

plan.summary;          // { pagesMoved, filesEdited, linksRewritten, warnings }
describePlan(plan);    // ['Notes.md:7  Theology/Grace.md  →  Doctrine/Grace.md', ...]
plan.warnings;         // [{ file, line, message }]  things worth showing the user

await applyPlan(plan, { tree, index });   // edits files, moves pages, journals, refreshes the index
await undo({ tree, index });              // puts everything back, byte for byte
```

`planMove` changes nothing. A plan is plain JSON, so it can cross an IPC boundary for the preview dialog and come back to be applied.

## What gets rewritten

| Link | Rule |
|---|---|
| `[x](A/B.md#h "t")`, `![](pic.png)`, `[x][ref]` definitions, `<angle brackets>` | The path is recomputed relative to the page's (possibly new) location. Fragment, title, `./` prefix, angle brackets and percent-encoding style are preserved. Shared reference definitions are edited once. |
| `[x](/A/B.md)` (workspace-root) | Updated if the target moves. |
| Links to attachments (`Foo/pic.png`) and broken links under a moved folder | Follow the folder. Links that move together with their target are left alone. |
| `[[Name]]`, `![[Name#h\|alias]]` | Only rewritten if they would stop resolving to the **same page**: after a rename of a page titled by its file name, or because moving a page changes which duplicate is "closest". Title and alias links are untouched. The plan simulates resolution before and after the move to decide. |
| `[[A/B]]`, `[[../B]]` | Path-style wikilinks are updated like Markdown paths. |
| Links that would otherwise be captured by a moved page | Converted to an explicit path (`[[X/Intro]]`, or `[[/Intro]]` for a top-level page) with a warning, so they keep meaning what they meant. |

Never touched: code, frontmatter, raw HTML, external URLs, links that were already broken or ambiguous, links that leave the workspace (warned), and files that are not valid UTF-8 (warned). Line endings, BOMs and file permissions are preserved.

Wikilinks accept explicit anchors, resolved by `core-index`: `[[/A/B]]` is a path from the workspace root, `[[./B]]` and `[[../B]]` are relative to the current page.

## Safety

1. **Stale check.** `applyPlan` re-reads every file it will edit and compares content hashes; if anything changed since planning it throws `STALE` and touches nothing. Applying the same plan twice is refused the same way.
2. **Journal first.** Original contents are saved under `.cave-notes/journal/<id>/` before any write (or under `journalDir` if you pass one, as the desktop app does).
3. **Atomic edits.** Each file is written to a temp file and renamed; permissions are kept.
4. **All or nothing.** Files are edited, then the pages are moved. If any step fails, every file is restored and the pages are moved back (`APPLY_FAILED`).
5. **Undo.** `undo()` reverses the latest applied operation (or `{ id }`). If you edited a rewritten file since, it throws `UNDO_CONFLICT` listing the files; `{ force: true }` undoes everything else and leaves those files alone. The newest 20 journals are kept (`keepJournals`).

The test suite includes a randomized integrity check: hundreds of random moves and renames over trees full of every link form (including duplicate names), asserting after each that **every link that worked before still points at the same page**, and that undo restores the workspace byte for byte.

## Options

- `planMove({ reconcile })`: default `true` rescans the workspace first. Pass `false` when a file watcher keeps the index current; every page the plan reads is still verified against the index by content hash.
- `applyPlan(plan, { index })`: refreshes only the affected pages in the index.

## Performance

`npm run bench` on 9,310 pages with 45,000 links, one slow CPU core, index kept current:

| Operation | Plan | Apply | Undo |
|---|---|---|---|
| Rename one page (1 link rewritten) | 90 ms | 65 ms | 70 ms |
| Move a 30-page branch (79 links, 50 files) | 0.4 s | 0.13 s | 0.18 s |
| Rename a 930-page topic (1,806 links, 1,645 files) | 4.3 s | 2.9 s | 3.0 s |

Zero broken links before, after, and after undo in every case. With `reconcile: true` add about 0.4 s for the rescan.

## Notes for the app

- Show `describePlan(plan)` and `plan.warnings` in a confirmation dialog for any plan with edits; for plans with no edits you can apply immediately.
- Pause or ignore file-watcher events while applying; `applyPlan` refreshes the index itself.
- Deleting a page needs no rewriting, but you can list its backlinks first with `index.backlinks(path)`.
