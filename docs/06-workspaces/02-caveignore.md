# Ignoring files, folders and workspaces: `.caveignore`

A file called `.caveignore` tells Cave Notes to pretend that some files, folders or workspaces are not there. What it lists is **not indexed at all and shows up nowhere**: not in the file tree, not in search, queries or the sub-page bar, not in the list of files, and it is not watched for changes.

Put a `.caveignore` in any folder: the top of a workspace, a folder inside it, or a folder you scan for workspaces (such as your home folder). Its lines are read relative to the folder it is in. It is a plain text file; it syncs with your notes like any other.

## The lines

The lines are read in order, and for any file or folder **the last line that matches it decides**. So a line can be undone by a later one.

| Line | What it does |
|---|---|
| `# a comment` | nothing: blank lines and lines that start with `#` are skipped |
| `secret.md` | ignores a file or folder called `secret.md`, at any depth below this folder |
| `*.psd` | `*` stands for any characters inside one name; `?` for exactly one |
| `*.{md,txt}` | `{a,b}` stands for either one: everything that ends in `.md` or in `.txt` |
| `attachments/` | with a slash at the end: **folders only** (`folder:attachments` says the same) |
| `file:*.tmp` | with `file:` at the start: **files only**. `file:*` is every file and no folder |
| `/archive` | with a slash at the start (or anywhere in the middle): counted from this folder only, not at any depth |
| `*/docs/.cave-notes` | `*` is one folder level here: the `.cave-notes` of any `docs` folder one level down |
| `**/old` | `**` crosses folder levels: any `old`, anywhere |
| `!keep.md` | a line that starts with `!` **brings back** what an earlier line ignored. It can be followed by `file:` or `folder:` too |

A folder that matches is ignored together with everything in it, **unless a later `!` line brings something in it back**. Names are matched exactly as written (capital letters count).

### Keeping only some kinds of file

To ignore everything in a folder except certain files, ignore it all, then bring back what you want, and its folders so the app can get to them:

```
attachments/**
!attachments/**/
!attachments/**/*.{md,txt}
```

The first line ignores everything below `attachments`, the second brings back its folders (a pattern that ends in a slash is about folders), and the third brings back the `.md` and `.txt` files in them. A picture or a PDF in there is not indexed and shows nowhere; a folder in which nothing is brought back does not show up at all unless a line brings the folder itself back, as the second line does.

The same with the kinds the other way round: `file:*.tmp` ignores the files that end in `.tmp` and leaves a folder with such a name alone; `folder:cache` ignores folders called `cache` and not files.

## Keeping a folder from being a workspace

Any folder with a `.cave-notes` folder inside it is a workspace of its own. That is not always wanted: a project you keep in your notes may carry a `docs/.cave-notes` of its own that you do not want to see as a separate workspace. List the `.cave-notes` folder:

```
*/docs/.cave-notes
```

Then `docs` is an ordinary folder, and its pages belong to the workspace around it. (The workspace you open is never affected: its own `.cave-notes` cannot be ignored.)

When Cave Notes scans your computer for workspaces (the list of recent workspaces), it reads the `.caveignore` files of the folders it scans. **A line that would leave no workspace at all is ignored**: if the scan finds nothing while some line kept it from looking, it looks again without those lines, and the log says which. So a line like `.cave-notes` cannot make every workspace disappear.

## Notes

- Changing a `.caveignore` takes effect straight away, also in open workspaces.
- Things that start with a dot are never notes anyway; `.caveignore` is for the rest.
- To keep a file out of *syncing* (not out of Cave Notes), use your sync tool's own ignore list.
