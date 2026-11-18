---
order: 4
---

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

## Typing and reading: two modes

The page is always in one of two modes, never in between (the toolbar never covers the last lines of the page: there is room for it below the text):

- **Typing**: the editor has the focus and the keyboard is up. The toolbar is shown and the sub-page bar is out of the way.
- **Reading**: the keyboard is down and the editor does not have the focus. The sub-page bar is shown and the toolbar is not.

When you put the keyboard away (the back gesture, or the keyboard's own button), the editor lets go of the focus, so you are reading again. This is done only when the app has **seen the keyboard go down**. With a hardware keyboard Android usually shows no on-screen keyboard at all; nothing then goes down, so the editor keeps the focus for as long as you type, and tapping outside the text leaves the typing mode. While the keyboard is up for something other than the editor (the search box, a dialog) the sub-page bar stays out of the way too.

## Opening again is quick

The first time a workspace is opened, the app reads the whole folder and builds a search index, which can take minutes on a big one. After that the index is kept, and opening the workspace again shows it at once; the look at what changed since (files from your sync tool, for instance) then runs in the background a few seconds later. A page that takes more than a moment to open shows a small spinner at the top.

## While the index catches up

Until the background look at what changed has finished, the workspace works as a notes app, and the things that need an exact, complete index wait:

- **Works at once:** the page tree (from the index saved last time), opening, typing in and saving any page, formatting, tables, export, and opening a page from a link or a tab. The pages open in tabs are brought up to date first, so what is on screen is right.
- **Works, with a note:** search and database views use the saved index. They say that the index is still being brought up to date, because a page changed by your sync tool may be missing or out of date.
- **Waits, and is grayed out or says so:** moving and renaming pages and folders, changing many pages at once (the selection bar of a view, replace in all pages), and automation buttons. These rewrite other pages from what the index knows, so they must not use an out-of-date one. They turn on by themselves when the index is up to date, and the progress bar at the bottom of the page shows how far it is.
- **A page that is not found**, because it was moved or renamed while the app was closed, is not given up on: the app says so, and when the index is up to date it looks for the page by name and opens it where it is now.

## Workspaces and tabs

Open **Workspaces and tabs…** in the menu, or tap the tab counter at the top. The list at the bottom shows every workspace you have added: tap one to go to it (its tab if it is open, a new tab if not), **Add workspace…** picks another folder, and the ✕ on a row takes it off the list (the folder and its notes are left alone; add the folder again to bring it back). Several workspaces can be open at once, each in its own tab; each one keeps its own search index in memory, so on a big workspace close the tabs you are done with.

## The documentation

**Help → Open the documentation** works on the phone: the pages are inside the app and are shown as a read-only workspace of their own.

## Big folders and the `.caveignore` file

Every file call on a phone goes through the system's storage layer, which is much slower than on a computer, and a folder with tens of thousands of entries keeps it busy. The usual cause is not notes but **folders of generated files** that live among them: the `build` and `node_modules` folders of a software project, for example. They are not notes, and they are indexed all the same. Tell the app to leave them out with a `.caveignore` file at the top of the workspace (see [Ignoring files, folders and workspaces](../workspaces/caveignore.md)):

```
build/
node_modules/
release/
dist/
```

If the phone seems to freeze or Android offers to close the app, this is the first thing to try. Opening again after that takes a fraction of the time.

The search index is also saved less often on a big workspace, and always when you leave the app. It is also saved a few seconds after the first full indexing finishes, so a phone that stops the app right afterwards does not have to do it all again.

## Building the app, and signing it

An APK can only be installed over (as an update of) another one if both are signed with **the same key**. The debug key Android's tools make is different on every computer, so an APK built on a second computer would not update the first one's. Use one key of your own instead, and keep it with you:

1. Once, on any computer: `bash apps/mobile/scripts/make-keystore.sh`. It asks for a password, writes `android/cave-notes.jks` and `android/keystore.properties` (git ignores both) and prints the key as base64 text.
2. Store in a password manager: the password, the alias (`cavenotes`) and the base64 text. Never put them in the repository.
3. On a computer that has no key yet, either save the base64 text to a file and set it for one build,

   ```
   CAVE_KEYSTORE_B64="$(cat key.b64)" CAVE_KEYSTORE_PASSWORD=… CAVE_KEY_ALIAS=cavenotes CAVE_KEY_PASSWORD=… bash apps/mobile/scripts/build-apk.sh
   ```

   or put the same four values in an `android/keystore.properties` file there (`storeFile=`, `storePassword=`, `keyAlias=`, `keyPassword=`).

The build script says which key it is using, and warns when it has none. The first time you switch to your own key, uninstall the old app once (its notes are in your folder, not in the app; only the app's saved settings and indexes go).

In a build service such as GitHub Actions the same four values are *secrets* and the build script gets them as environment variables.
