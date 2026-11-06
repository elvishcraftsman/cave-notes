# Introduction to Cave Notes

Cave Notes is a Linux app for thinking in hierarchies. You write ordinary Markdown pages and arrange them as a tree: a page that has sub-pages gets a folder of the same name beside it (`Grace.md` and `Grace/`). Search, attributes, saved queries, live views and automations sit on top of that tree, and everything you write stays in plain files you can open with any other program.

## Notes in place

Your notes are never moved into a database. The folder on disk *is* the workspace, and each page is one text file in it.

- **Any folder is a workspace.** Open it and it works; the settings live in a `.cave-notes` folder inside it. Take that folder away and the notes are exactly what they were.
- **Plain files.** Pages are Markdown with optional YAML at the top (the *attributes*). Other tools, scripts and sync programs can read and write them at any time, and the app follows.
- **Nothing proprietary to carry.** The search index, version history and undo journals are rebuilt or kept in the app's own data folder, never in your workspace, so they never need syncing.

The point of this is longevity and freedom: if Cave Notes disappeared tomorrow, you would still have a tidy folder of readable files.

## What it gives you, and how the parts work together

| Part | What it does | Works with |
|---|---|---|
| **Page tree** | Shows the hierarchy; arrow keys move through it, and dragging a page reorganises it. | Moves rewrite the links that point at the page, so nothing breaks. |
| **Editor** | Shows rendered Markdown and reveals the syntax only where you are typing. | The outline and links panels on the right follow the page. |
| **Links** | `[[Page]]` and ordinary Markdown links, kept correct when pages are renamed or moved. See [Links](linking.md). | Backlinks, the tree and queries all use them. |
| **Attributes** | Values such as `status` or `due` in a page's header, which sub-pages can inherit. See [Attributes](attributes.md). | Queries filter on them and automations change them. |
| **Search and queries** | Fast full-text search with attribute filters; saved queries and relations. See [Queries](queries.md). | Live views inside pages show query results as tables, boards, calendars and more. |
| **Code blocks** | Every code block has a **Copy** button; blocks marked `bash`, `sh`, `zsh` or `shell` also have **Run**. See [Code blocks](code-blocks.md). | Run asks once per workspace before it runs a script. |
| **Templates** | Starting text for new pages and reusable blocks. See [Templates](templates.md). | Automations can create pages from them. |
| **Automations** | Rules that act when a page changes or at a set time. See [Automation](automation.md). | They use attributes and queries to decide what to do. |
| **Presentations** | Put `presentationTheme:` in a page's attributes and its `---`-separated slides can be previewed, presented and exported to PDF or HTML, with layouts chosen from what each slide holds. See [Presentations](presentations.md). | Slides use plain boxes, so PowerPoint and OpenDocument export can follow. |
| **Export** | Pages to Word, OpenDocument and PDF with styles you design. See [Export styles](export-styles.md). | Uses the same rendering as the editor. |

A typical flow: a project is a page; its tasks are sub-pages that inherit `status: todo` from it; a view on the project page lists open tasks as a board; moving a card changes the task's `status`; a rule archives the finished ones.

## Drawbacks of keeping notes in place, and how they are handled

Plain files in a folder are simple, but they bring real risks. Cave Notes is built to reduce each of them.

- **Other programs can change a file while you have it open.** The open page follows its file. If both sides changed, the two versions are merged word by word against the text they both grew from, and where both rewrote the same words both are kept between conflict markers, which the editor shows as two boxes (**Version A** and **Version B**) that you can edit like the rest of the page, with **Keep A**, **Keep B** and **Keep Both** in the corner of the first. The markers are ordinary lines in the file (`<<<<<<< conflict: both versions kept`, `=======`, `>>>>>>> end of conflict`), so other programs see them as text. Nothing you typed is thrown away.
- **Sync tools make conflict copies.** Copies such as `Name.sync-conflict-…md` are hidden from the tree, and the app offers to merge them into the page and delete them. A copy is deleted only after the merged page is safely written, and its text stays in the history.
- **Files can be moved or deleted behind your back.** A page that moves on disk stays open at its new place; one that is deleted asks whether to keep it. Either way the text goes into the version history first.
- **Renaming a page can break links.** Moves and renames show a preview of every link they will change, write a journal first, edit files by writing a temporary file and renaming it, and put everything back if any step fails. **Undo Last Move or Rename** reverses a finished one.
- **Mistakes in a page.** **Page History** keeps recent versions of pages you use, kept on this computer only, and restores one as an ordinary edit you can undo.
- **A workspace can be huge.** The index is built in the background and the app stays usable while it runs; search and views use it once it is ready.
- **Several computers can run the same automations.** They take turns and check before acting, so each change is made once.
- **Rules that run programs are dangerous.** Shell commands are off until you switch them on, and each command is approved before it runs.
- **Something goes wrong.** Every step of a move, and everything slow or failing in the app, is written to a log that never contains your note text. See [Troubleshooting](troubleshooting.md).

What is left over: Cave Notes only understands the files it can read, so a page with a broken header is shown as it is and flagged, not repaired; and attributes and queries are features of this app, so another program will see them as plain text at the top of the page.

## Where to start

Open the **Shortcuts** page for keys and [Preferences](preferences.md) for the settings, then [Attributes](attributes.md) and [Queries](queries.md) for the features that make the tree more than a folder. This documentation is read only; your own pages are never touched from here.
