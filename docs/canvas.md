# Canvases

A canvas is a page you arrange on a surface instead of writing down a column: cards of text, pages, pictures and web links, put where you like, with arrows between them and groups around them. Use one to map out an argument, plan a project, lay out a chapter, sketch how ideas in your pages relate, or gather what you need for a task on one screen.

A canvas is a plain **`.canvas` file** in [JSON Canvas](https://jsoncanvas.org) format, the one Obsidian uses, so a canvas made there opens here, and the other way round.

## Getting started

1. **New ▸ New Canvas…** (the arrow beside the New Page button) asks for a name and makes `Name.canvas` where a page would go. Any `.canvas` file in the workspace is a page: it is in the page tree, can have sub-pages, shows up in search and can be linked to with `[[Name]]`.
2. **Double-click** the empty canvas to add a note card, and type.
3. **Drag a page** from the page tree onto the canvas to add a card for it.
4. Select a card and **drag from the dot beside it** onto another card to join them with an arrow.
5. Select several cards and press **Ctrl+G** to put a group around them.

Everything you do is saved as you go, and every finished change is one step of **Undo**.

## The surface

| To | Do |
|---|---|
| Move around | drag the empty canvas, or scroll; **Alt**-drag or a middle-button drag also pans |
| Zoom | **Ctrl**+scroll or pinch; `+` and `−`; the buttons at the bottom right |
| See everything | the ⤢ button at the bottom right, or **Home** (or `0`) |
| Switch to view mode | the 👁 button at the bottom right (see [View mode](#view-mode)) |

## Cards

There are four kinds of cards.

| Card | What it is | Add it |
|---|---|---|
| 📝 **Note** | Text, written like any page: live preview, lists, `[[links]]`, spell checking | double-click empty canvas, or the 📝 button on the left |
| 📄 **Page or file** | A page of the workspace (shown by name; its text and pictures can be shown too), or a picture | **drag a page from the page tree** onto the canvas (several selected pages make several cards), or the 📄 button and type its name or a file's path |
| 🔗 **Link** | A web address | the 🔗 button |
| ▣ **Group** | A frame around other cards, with a name | the ▣ button, or select cards and press **Ctrl+G** |

- **Edit a note** by double-clicking it (or select it and press **Enter**); **Esc** finishes.
- **Show more of a page card.** A page card is small, with its name and place; the ▸ button on it (or making it taller) shows the page itself, ▾ folds it up again. A page card follows its page when that is renamed or moved.
- **Open what a card shows:** double-click a page card (or press **Enter**) to open the page; a link card opens in your browser.
- **Groups.** A group holds the cards that lie wholly inside it, and moving the group moves them. Double-click a group's name to rename it.

### Selecting, moving and sizing

| To | Do |
|---|---|
| Select | click; **Shift**-click adds; **Shift**-drag draws a box; **Ctrl+A** selects all |
| Move | drag a card; the arrow keys nudge (**Shift**: further) |
| Resize | drag a handle at a corner or side |
| Snap to a grid | the **⊞** button on the left turns snapping on and off while you move and resize. The grid is the dots of the background. The button remembers how you left it |
| Duplicate, delete | **Ctrl+D**; **Delete** |
| Bring to the front, send to the back | right-click ▸ **Bring to Front** / **Send to Back**. Cards are drawn in the order of the file, later ones on top |

### Aligning cards

Select two or more cards and **right-click** one of them. The menu offers:

- **Align Left**, **Align Horizontal Center**, **Align Right**: the cards line up along their left edges, their middles (a vertical line) or their right edges;
- **Align Top**, **Align Vertical Center**, **Align Bottom**: the same across;
- with three or more, **Space Evenly Across** and **Space Evenly Down**, which keep the outermost cards where they are and put the same gap between the others.

Right-clicking also offers Edit or Open, Duplicate, Group and Delete for a card, and for empty canvas Add Note Card Here, Add Page, Add Web Link, Add Group Here, Select All and Show Everything.

## Pictures

A canvas can show pictures in three ways.

- **A picture as a card.** Drag a picture from the folder bar onto the canvas (or add it with the 📄 button and its path): the card is the picture. Resize the card to resize the picture.
- **A picture in the text of a note card.** Write it as in any page, `![description](/Pictures/map.png)`, or right-click the card and choose **Insert Image…**, or use *Insert a picture into the text…* in the sidebar. Both ask for the path of a picture of the workspace from its top folder (`Pictures/map.png`) and add the picture at the end of the text. A path starting with `/` is from the top of the workspace; one without is from the folder the canvas is in. In view mode and in an embedded canvas the pictures are drawn too. Text with spaces in the path goes in angle brackets: `![map](</Pictures/my map.png>)`.
- **A picture behind a card.** Select one or more cards (a note, a page, a link or a group) and right-click ▸ **Set Background Image…**, or **Background picture ▸ Choose…** in the sidebar. The picture is drawn inside the card's shape, behind its text, which is given a soft halo so it can still be read. **Picture fits** chooses how: *Fill the card* (the picture is cropped to cover it), *Show all of it* (the whole picture, with the card showing at the sides) or *Tile it*. **Remove** (or **Remove Background Image** in the menu) takes it away. A fill colour shows through the parts the picture does not cover. A group with a picture behind it makes a map you can lay cards over.

The picture is stored by its path, so it follows nothing: if the file is moved or renamed the card shows without it until the path is put right.

## Arrows

- **Join two cards:** select one and drag from the dot beside it onto the other. The four sides of the card under the pointer show; the arrow joins at the nearest one.
- **Move an end:** select the arrow and drag the dot at either end onto another card or another side of the same one.
- **Label it:** double-click the arrow, or **Edit Label** in the right-click menu.
- **Arrowheads:** select the arrow and press the arrow button in the little bar above it, or the arrowheads button in the sidebar. Each press goes to the next of four looks: `→` an arrowhead at the far end, `←` at the near end, `↔` at both, `—` at neither.
- **Colour:** the little bar above a selected arrow or card offers the six preset colours; the sidebar offers any colour.

Edges leave from the middle of a side of a card.

## The sidebar

With a canvas open, the right sidebar's first tab is **Objects** (instead of Outline; on a phone, the drawer's tab says Objects too).

**The list** shows everything on the canvas, a group first and the cards inside it beneath it, then the arrows. Click one to select it on the canvas (the canvas scrolls to it if it is out of sight); **Shift**- or **Ctrl**-click selects several. What is selected on the canvas is highlighted in the list.

**The properties** of what is selected are below the list:

| Property | |
|---|---|
| X, Y, Width, Height | where it is and how big. Type a number and press Enter to move or resize it exactly |
| Background picture | a picture behind the card, and how it fits (see [Pictures](#pictures)) |
| Border colour | one of the six presets, none, or any colour |
| Fill colour | the inside of the card. A preset colour tints the card softly; any other colour fills it solidly, with black or white text, whichever reads better. *No colour* is the normal card |
| Shape | rounded (the normal one), square corners, pill, ellipse or diamond. A group is rounded or square |
| Border | default, solid, dashed, dotted or none; and its width |
| Name | of a group |
| Address | of a link card |
| Label, colour, arrowheads | of an arrow |

With several cards selected, a change applies to all of them; a property they do not share shows *(mixed)*. In view mode the properties are shown but cannot be changed. The text of cards is drawn in the interface's sans-serif font.

## View mode

The 👁 button at the bottom right switches a canvas to **view mode**: nothing can be changed, so a card cannot be moved or edited by accident, and a **single click** goes to what a card shows:

- a page card opens the page;
- a link card opens the address in your browser;
- a `[[link]]` or web link inside a note card is followed.

Dragging still moves the view, so you can look around, and the sidebar still lists and selects the objects. The ✎ button goes back to editing. The mode is remembered, so a canvas you keep for looking at can open that way. A canvas on a page that is read-only (a page of the documentation, say) is always in view mode.

## A canvas inside a page

`![[Name]]` (or `![[Name.canvas]]`) alone on a line shows the canvas inside the page, like any other embed:

- it is in view mode, and sized to show all of it at the width of the page;
- drag to move about, zoom with the buttons or **Ctrl**+scroll (plain scrolling still scrolls the page), and click a card to go to what it shows;
- **Edit** (top right of the canvas) opens the canvas in a new tab;
- it follows the canvas when that changes.

## Ideas

- **A map of a study.** One note card per idea, page cards for the pages that treat it, arrows labelled *supports* and *answers*, a group for each section. Embed the canvas in the introduction page.
- **A project board.** A group per stage (*to do*, *doing*, *done*), page cards for the tasks. Moving a card into a group is moving it between stages. Give each group a fill colour.
- **A map with pins.** A group with a picture of a map behind it (*Show all of it*), note cards laid over it as labels, arrows to the places they mean.
- **A flow chart.** Diamonds for decisions, pills for start and end, arrows with labels. Turn on snapping and use the align commands to keep it tidy.
- **A reading table.** Page cards laid out in the order you want to read them, with a note card for what you want to remember from each.

## What it holds

`[[wikilinks]]` written in a note card count as links of the canvas, so the page they name lists it under its backlinks, and they follow it when it is renamed or moved, as in any page. Search finds the words on a canvas (note cards, group names, arrow labels, the names of the pages it shows), never the JSON around them.

## The file

The file is laid out as Obsidian writes it: tabs, **one card and one arrow per line**. Changing one card changes one line, so a sync can merge two edits to different cards, and a diff stays readable. Anything in the file this app does not know (a field another program added) is kept exactly as it was. A picture behind a card is stored in `background` and `backgroundStyle` (`cover`, `ratio` or `repeat`), the fields JSON Canvas names for the background of a group, here used for every kind of card. The rest of a card's look is stored in four fields of its own, `shape`, `fill`, `borderStyle` and `borderWidth`, that Obsidian ignores and keeps. A file that is not valid JSON is shown as text, so it can be repaired and is never overwritten.

## Limits

- Pictures and page previews are drawn small; a card far off screen is not drawn until you come near it.
- Edges leave from the middle of a side; a free-floating end is not possible (the format has none).
- Pages that are not Markdown and are not pictures show their name only.
- Obsidian shows the colour of a card but not its shape, fill or border style.
