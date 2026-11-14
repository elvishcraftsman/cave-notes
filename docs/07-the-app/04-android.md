# The Android app

The Android app is the same notes app on a phone: your notes are the same Markdown files in a folder you choose, and everything is indexed on the phone. This page is about what is different on a small screen.

## Opening a workspace

Opening a big folder takes a while the first time: the app reads the whole folder before it can show it. While it does, a small **progress dialog** with a circle says what it is doing. The circle turns on its own while the length of the wait is not known (listing the folder) and fills as the steps are done. The first time a folder is opened the app also builds its search index; you can use the pages while that goes on. The index is kept on the phone and saved when you leave the app, so later openings are quick.

## The page list

The page list slides in from the side. **Collapsing idle branches** (Preferences → Pages) works differently here: the seconds count only while the list is **closed**. Open the list and the count stops; close it, and it starts again from zero. A branch that you have open and then put the list away is collapsed that many seconds later, never while you are looking at it.

## The toolbar

When you are editing, a toolbar is docked above the keyboard. It is **one row**, and it scrolls sideways if it does not fit. Each button opens a panel of its kind of tools just above the row:

| Button | Holds |
|---|---|
| **Format** | bold, italic, strike-through, code, link, footnote, comment |
| **Blocks** | paragraph, headings, quote, code block |
| **Lists** | bulleted and numbered lists, tasks, indent and outdent (the keyboard has no Tab key) |
| **Insert** | table and database view |
| **Select** | select all, as text or as HTML |

Choosing something closes its panel. The toolbar stays where it is while you select text; it is not taken away and put back.

## Big folders and the `.caveignore` file

Every file call on a phone goes through the system's storage layer, which is much slower than on a computer, and a folder with tens of thousands of entries keeps it busy. The usual cause is not notes but **folders of generated files** that live among them: the `build` and `node_modules` folders of a software project, for example. They are not notes, and they are indexed all the same. Tell the app to leave them out with a `.caveignore` file at the top of the workspace (see [Ignoring files, folders and workspaces](../06-workspaces/02-caveignore.md)):

```
build/
node_modules/
release/
dist/
```

If the phone seems to freeze or Android offers to close the app, this is the first thing to try. Opening again after that takes a fraction of the time.

The search index is also saved less often on a big workspace, and always when you leave the app.
