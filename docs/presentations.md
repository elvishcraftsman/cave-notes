# Presentations

Any page can be a presentation. Put `presentationTheme:` in its attributes (the YAML at the top) and name a theme:

```yaml
---
presentationTheme: Clean
---
```

That one line is all there is to it: the theme decides how the slides look, and the page gets a **Present** button beside the Plugins button. **Preview slides…** shows the slides one at a time and lets you change the theme and the layout of each slide; **Present** (or **Present full screen**) shows them full screen in a window of their own (Right and Down arrows, Page Down, Space or a click go to the next slide; Left and Up arrows, Page Up or Backspace go back; `Esc` ends the show). The preview takes the same keys; **Export as PDF…** and **Export as HTML…** save a file with the pictures inside. PowerPoint (`.pptx`) and OpenDocument (`.odp`) export are planned; everything here is designed so that it will carry over.

## Slides

A horizontal rule on a line of its own, `---`, ends a slide. A `---` inside a code block, a table or the attributes is not a break. Empty slides are skipped.

A heading that comes after something that is not a heading starts a new slide by itself, so a rule is not needed there. A heading right after another heading (a title and its subtitle) stays on the same slide, and so do headings inside a `left` or `right` block.

```markdown
# Grace
## A short introduction

---

# Three points

- It is a gift
- It is not earned
- It changes us

---

# The mosaic

![The floor](floor.jpg)

*Floor mosaic, fourth century*
```

## What a slide holds

Every block of a slide is one of these **kinds**, and the kinds decide the layout:

| Kind | What it is |
|---|---|
| `title` | The larger heading of the slide (its highest heading level) |
| `subtitle` | A smaller heading, after the title |
| `text` | Anything else: paragraphs, lists, quotes, code, tables. Neighbouring pieces are one block |
| `text-left`, `text-right` | Text in a block marked `left` or `right` (below) |
| `landscape`, `portrait` | An image, by its shape (wider than tall, or taller than wide) |
| `caption` | An all-italic paragraph right after an image, or a block marked `caption` |

**Left and right.** Put text or images in a block named `left` or `right`, in the same notation as other styled blocks (see [Export styles](export-styles.md)):

```markdown
::: left
Things we know.
:::

::: right
![The map](map.png)
:::
```

A single image can say its side with `{.left}` or `{.right}` after it: `![The map](map.png){.right}`. `{.portrait}` and `{.landscape}` set its shape when it cannot be told from the file.

## Notes for the presenter

A footnote whose label begins with `note` is a presenter's note: `[^note]`, `[^note2]`, `[^note-intro]`. Write the text anywhere in the page, such as right under its slide:

```markdown
# Grace

It is a gift[^note], not a wage.

[^note]: Pause here. Ask who has read Romans 4.
```

Notes never show on the slides the audience sees. In the presenter window each one appears as a small superscript letter in the text where it is referred to (**a**, **b**, … **z**, **aa**, **ab**, …, starting again on each slide), without taking up any room, so the lines break exactly as they do on the audience's screen, and its text is listed under the slide. Other footnotes are not shown on slides.

## Presenting, screens and the presenter window

**Preferences, Presentations** chooses the screen the slides are shown on (*Automatic* takes a screen other than the one the app is on, when there is one) and, if you switch on **Show a presenter window**, the screen of that window (by default the one with the app). The presenter window shows the slide being shown, the next one, your notes for this slide and a clock. The two windows follow each other: change slides in either. `Esc` in either ends the show. With one screen only, the slides fill it and the presenter window is behind them (`Alt+Tab` reaches it).

## Layouts

A layout is how a slide is arranged. These come with every theme:

| Layout | Used when the slide has |
|---|---|
| `title` | A title and a subtitle |
| `section` | Only a title |
| `content` | A title and text (the default) |
| `compare` | Blocks on both the left and the right |
| `image-right`, `image-left` | Text and one image (on the left if it says so, otherwise on the right) |
| `picture` | An image (and perhaps a title and caption) |
| `gallery` | Several images: they are arranged to fill the slide as well as they can |

**Choosing a layout yourself.** In the preview, pick a layout from **Layout of this slide**. It wraps the slide in a block, which you can also write by hand (four colons, so that it can hold blocks marked `left` and `right`):

```markdown
:::: {layout=compare}
# Two ways
...
::::
```

Choose **Automatic** to take the wrapper away and let the rules decide again.

## Which kinds get which layout

The table of rules is a short YAML list in the workspace's settings (any file in `.cave-notes`), under `presentation-rules:`. The first rule a slide fits is used; your rules come before the built-in ones.

```yaml
presentation-rules:
  - when: [title, text+, caption]      # a title, some text and a caption
    layout: figure
  - when: [title?, text+]
    sides: none                        # no left or right blocks
    layout: content
```

`when` lists the kinds a slide may have, in any order (a slide with a kind that is not listed does not fit):

| Written | Means |
|---|---|
| `title` | exactly one |
| `text+` | one or more |
| `caption*` | any number, even none |
| `subtitle?` | none or one |
| `text\|text-left\|text-right+` | one or more of any of those |
| `image` | `landscape` or `portrait` |

`sides` is optional: `left` or `right` (a block is marked that side and none the other), `both`, or `none`.

## Themes

A theme is colours, fonts and a set of layouts. The built-in themes have wide margins (10% of the slide at the sides and the top) and large text (52 pt for the body on a 13.3 in slide), with 1.5 lines between paragraphs and the same small gap between all items of a list, at any level; a theme can change them (`--para` and `--item` in its `css:`, or the sizes of its regions). Four come with the app: **Clean**, **Midnight**, **Paper** and **Bold**. Write your own under `presentation-themes:`, starting from one of them with `base:`:

```yaml
presentation-themes:
  Church:
    base: Paper
    accent: "#6b2d5c"
    font: Crimson Pro
    background: "#fffdf8"
    layouts:
      content:
        regions:
          body: { size: 32 }          # change one box, keep the rest
```

Theme settings: `size` (`16:9` or `4:3`), `background`, `color`, `font`, `headingFont`, `fontSize`, `accent`, `css`, and `layouts`. Anything you leave out comes from the base theme.

### Writing your own layout

A layout is a list of named boxes, **regions**, each placed with four numbers: `at: [x, y, width, height]`, in percent of the slide. That is the whole model:

```yaml
presentation-themes:
  Church:
    layouts:
      trio:
        regions:
          title:  { at: [5, 5, 90, 15], size: 36, bold: true, valign: middle }
          left:   { at: [5, 25, 28, 65], side: left }
          middle: { at: [36, 25, 28, 65], holds: [text] }
          right:  { at: [67, 25, 28, 65], side: right }
```

Use it with `:::: {layout=trio}` or from a rule. A region takes the blocks it **holds**: by default what its name says (`title`, `subtitle`, `body`, `left`, `right`, `image`, `images`, `caption`), or what you list in `holds:`. `side: left` or `right` makes it take blocks of that side.

Region settings: `at`, `holds`, `side`, `font`, `size` (pt), `color`, `bold`, `italic`, `align` (`left`, `center`, `right`, `justify`), `valign` (`top`, `middle`, `bottom`), `background`, `padding` (percent of the slide's width), `fit` (`shrink`, the default for text, makes text smaller until it fits; or `none`), `grid` (arrange several images to fill the box) and `css`. A region set to `null` is taken away from a layout you start from.

### CSS, and what will carry over

`css:` on a theme (a whole stylesheet: slides are `.slide`, with `.layout-NAME`, and boxes are `.r.r-NAME`), on a layout, or on a region (declarations such as `border-left: 4px solid red`) can do anything a web page can. It shows in the preview, the PDF and the HTML, but **not** in PowerPoint or OpenDocument files when those formats come: they only have boxes, positions, fonts and colours. The preview warns you when a theme uses CSS. A theme made only of regions and the settings above carries over completely.

## Pictures

A picture written at the end of a line of text goes on the right of that text, and one at the start of it on the left:

```markdown
Consumerism and comfort![sofa](<sofa.jpg>)
```

(A picture in the middle of a sentence, or in a list item or quotation, stays where it is.) In the slide layouts `image-left` and `image-right` the picture sits against the edge of the slide, and the title and text make room for it.

**Size.** By default a picture is scaled to fit a box as tall as the slide and `imageWidth` percent of its width (55; set `imageWidth:` in the theme to change it). A landscape picture therefore takes 55% of the width; a portrait one is scaled up until it takes that much or the whole height. In the preview, the **Expand to slide height** button makes it as tall as the slide (and **Shrink** goes back); it is grayed out when that would change nothing, as with a tall portrait picture. It is written as `fit=tall`.

**Settings** go in braces after the picture:

```markdown
![sofa](sofa.jpg){.right crop="[10%, 0, 5%, 0]" width=40% fit=tall}
```

| Setting | Meaning |
|---|---|
| `.left`, `.right` | which side the picture is on |
| `crop="[left, top, right, bottom]"` | what to cut off, in `%`, `px`, `in` or `mm` (no unit: `px`). Measured on the picture itself; an inch is 96 of its pixels. |
| `width=`, `height=` | a size of its own, measured on the slide (a 16:9 slide is 13.33 × 7.5 in); `%` is of the slide's width or height |
| `fit=tall` | as tall as the slide |
| `.background` | the picture is the slide's background (see below) |
| `dim=40%` | darken a background picture |

**Crop and size…** in the preview opens the picture with a frame to drag, the four numbers in the unit you like, and a live view of the slide.

## A picture behind the slide

```markdown
![](mountains.jpg){.background dim=35%}
```

fills the whole slide behind its text (`dim` darkens it so the text can be read). In the preview, **Use as background** does the same to a picture already on the slide.

## Presenter's notes

`[^note]`, `[^note2]`, … are the presenter's notes. In the editor they are lettered a, b, c … afresh on each slide, as in the presenter's window, and they take no part in the numbering of the other footnotes.

## Screens on Wayland

A program on Wayland cannot choose where its window goes, so choosing a screen works differently there: the slide window asks the browser engine for full screen on the chosen screen. If that is not available the window opens full screen on whichever screen the desktop picks. To get exact placement, start the app with `--ozone-platform=x11`, which runs it through XWayland.
