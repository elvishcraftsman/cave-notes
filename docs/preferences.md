# Preferences

Open **Preferences** from the main menu (the button at the right of the title bar) or with `Ctrl+,`. There are two tabs: **App Preferences** apply everywhere, **Workspace Preferences** belong to the open workspace and are kept in its `.cave-notes` folder. Each tab has a list of categories on the left. The dialog keeps the same size whichever category you open.

## App preferences

| Category | What is in it |
|---|---|
| Appearance | dark or light theme, the accent colour for workspaces without their own, the typeface and size of page text |
| Editing | spell checking and your dictionary, fixing accidental double capitals, synonyms, list styles, wrapping of code and plain text |
| Pages and files | which files are notes, where new pages go, collapsing of idle branches in the page tree, numbered lists in the outline, what happens to files dragged in |
| Views | the first day of the week, and how wide table columns may grow |
| Workspaces | nested workspaces, searching for workspaces, how folders opened from outside appear, settings shared between workspaces |
| Presentations | which screen the slides are shown on, and whether a presenter window opens (and on which screen); see [Presentations](presentations.md) |
| Sync and automation | what to do with Syncthing conflict copies, shell commands, JavaScript (**Let automations run JavaScript**, and **Ask before running a rule's JavaScript**, which is on until you turn it off) and background running of automations, and **Forget all approvals and refusals** (the commands and scripts automations may run, and the ones you refused, and the workspaces whose scripts the Run button of a [code block](code-blocks.md) may run) |
| Updates | how often and whether the AppImage looks for a newer version and replaces itself, and the address it looks at; see [Updating the app](updates.md) |
| Import and export | export styles, and saving your preferences to a file or loading them from one |

## Help

The main menu's **Help** (also `F1`) opens a window laid out like Preferences, with the documentation, the keyboard shortcuts, the logs, and **About** (the version of the app, and the credits).

## Workspace preferences

| Category | What is in it |
|---|---|
| Appearance | the workspace's accent colour, page text and icon |
| File types | note types for this workspace only |
| YAML | the workspace's attributes, schema, queries and other settings as text |

## Accidental double capitals

A word typed as **THis** (the shift key held a moment too long) becomes **This** when you end the word with a space or punctuation. Undo straight afterwards brings back what you typed. Only a word of two capitals followed by small letters is changed, and **not when the small letters are just an s**: HIs, PCs and IDs may be plurals of abbreviations. Units such as MHz and MPa, words in code, addresses, `[[page links]]` and front matter are left alone. *Preferences → Editing → Fix accidental double capitals* switches it off.

## Spelling and your dictionary

Misspelt words are underlined in the editor. **Right-click** one for suggested corrections and **Add to Dictionary**; a suggestion replaces the word, and a word you add stops being underlined. The right-click menu of a correct word is the usual formatting bar.

*Preferences → Editing → Spelling* switches checking on or off and shows **Your dictionary**: add words there (several at once, separated by spaces), search the list, and remove a word with its × button. The dictionary is part of your preferences, so **Import and export → Export…** saves it with everything else and **Import…** brings it back on another computer. The spell checker's language follows the system's.

## Synonyms

Right-click a single word, or select exactly one word and right-click it, and a list of synonyms hangs under the formatting toolbar. Pick one and it replaces the word, keeping its capitals ("Big" becomes "Large") and, for ordinary verb and plural forms, its ending ("walking" offers "strolling"). Undo puts the old word back.

Nothing is offered for articles, prepositions, conjunctions, pronouns and similar small words, for words with digits, for several words at once, or for words in code, web addresses, `[[page links]]` and front matter. A misspelt word shows its spelling suggestions instead. *Preferences → Editing → Suggest synonyms* switches the menu off.

The word lists work offline and are part of the app. They come from WordNet 3.0 (Princeton University) and the Moby Thesaurus II (Grady Ward, public domain); **Help → About Cave Notes** credits both and shows the WordNet licence. The suggestions are English only.

## Keeping every workspace indexed

With **Preferences → Workspaces → Keep all workspaces indexed** on (the default), Cave Notes opens every workspace it knows on this computer quietly in the background after it starts: the one you are working in first, and only once its own index is ready, then the others one at a time. They stay open, watched for changes, and every ten minutes each one is also asked to look for changes a watcher can miss (a sync tool replacing files, a network folder). A workspace that cannot be opened (a drive that is not plugged in) is tried again later.

This keeps what one workspace asks of another accurate: views with `saved:Workspace::name` and relations that name pages of another workspace (see [queries.md](queries.md#relations-that-reach-other-workspaces)) read the other workspace's current index, and a view here refreshes when it changes. The progress of the workspaces in the background is not shown in the page tree's indexing indicator; the indicator is for the one in front.

Each open workspace is a process of its own and uses some memory, so up to thirty are kept. Switch the setting off to open workspaces only when you use them (a view that reaches into one still opens it, as before); the ones kept only for this are then closed.

## Numbered lists with levels

By default a numbered list changes its marker with its level, following this chain: `I.`, `A.`, `1.`, `a.`, `i.`, `1)`, `a)`, `i)` (App preferences, Lists, where the chain and the switch "Nested items take the style of their level" are).

The chain is followed from where the list starts. A list that begins with `1.` has `a.` under it and `i.` under that; one that begins with `I.` has `A.`, then `1.`. The first level keeps whatever you started with.

- **Tab** on one item nests it under the item above. On several items it moves them together, with the items under them that are selected too, so the levels inside keep their order. The first item of a nested list has nothing above it: Tab moves it, and the items selected with it, one marker's width further in.
- **Shift+Tab** takes the same step back.
- **Enter** continues the list at any level, whatever the markers above are.
- Pasting an outline (a copied numbered list) into a numbered item drops its first marker and keeps the levels under it, moved by the difference in the width of the markers. A single line such as `A. Smith went home` is pasted as it is.

Computers that already had settings keep the chain they had; change it in App preferences if you want this one.
