# Highlights and comments

You can highlight text and leave comments on it, to mark a draft for yourself or for someone you share it with. They are written in **CriticMarkup**, a plain-text way of marking up a page, so they stay in the file as ordinary text and any other program that reads it sees what they say:

```
He said it plainly: {==grace is not earned==}{>>Check the quote: Eph 2:8 is closer<<}, and that is all.

This sentence needs a source.{>>Find one<<}
```

| Written as | What it is |
|---|---|
| `{==text==}` | a **highlight** |
| `{==text==}{>>comment<<}` | a highlight **with a comment**; the comment must come right after the highlight |
| `{>>comment<<}` | a **comment** on its own, at a point in the text |

In the editor, a highlight has a yellow background and a comment is a small speech bubble that shows its text when you hold the pointer over it. Click the bubble, or move the cursor into the highlight, and the whole thing shows as it is written, so you can edit it.

## Adding a comment

Select the text and press the **Comment** button of the selection toolbar (the speech bubble; also **Ctrl+Alt+M**). The text is highlighted and the cursor is inside the new comment, ready for you to type. With nothing selected, the button adds a comment at the cursor.

## Taking one away

Put the cursor in a highlight or comment and press the same button again: it shows as pressed there, and pressing it takes the highlight and comment away (the text stays, a comment on its own is deleted). In the sidebar and the right-click menu there are the same choices, below.

## The Notes tab

When a page has any highlights or comments, a **Notes** tab appears beside *Outline* and *Links* in the right sidebar. It lists them in order, each with the highlighted text and its comment:

- **Click** one to go to it in the page.
- The **bin button** beside it removes it.
- **Right-click** it for the menu: *Go to It* and *Remove Highlight and Comment* (or *Remove Comment*).

A page with none has no Notes tab.

## In exported files

Highlights and comments are exported, and never as the raw braces:

- **Word (.docx)**: the highlight is yellow highlighting, and each comment is a real Word comment (it shows in the margin and in the Review pane), attached to the highlighted text, or to the point where a lone comment was.
- **OpenDocument (.odt)**: the same, as the program's own annotations.
- **PDF**: a PDF made from the page cannot carry comments of its own, so the highlight is drawn in yellow, each comment is marked with a small number like `[1]`, and the comments are listed under a **Comments** heading at the end of the last page.

Comment text does not count as words of the page, and the markers are never part of the text. A highlight or comment inside a code block or a front matter is just text. A comment that is never closed (`{>>` without `<<}`) is shown as it was written.
