import { EditorView } from '@codemirror/view';

/**
 * Styling for the editor. Colors come from CSS variables the host app defines (see the app's
 * Adwaita stylesheet), so light/dark switching is just a variable change:
 *   --view-fg --view-bg --accent-color --accent-bg --destructive-color --warning-color
 *   --card-bg --dim-fg --border --editor-font --mono-font
 * and, optionally, --editor-ui-size (size base for sans-serif parts that sit in the text, e.g. link buttons; defaults to --editor-font-size) --editor-font-size --editor-weight --editor-line-height
 */
export const noteTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--view-fg)',
    backgroundColor: 'transparent',
    fontSize: 'var(--editor-font-size, 16px)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', fontWeight: 'var(--editor-weight, 400)', lineHeight: 'var(--editor-line-height, 1.7)', letterSpacing: 'var(--editor-letter-spacing, normal)', wordSpacing: 'var(--editor-word-spacing, normal)', overflow: 'auto' },
  // minWidth 0: a long line of code must not keep the text column from getting narrower than the line (the column is a flex item, whose smallest size is otherwise its widest unbreakable line, so the page scrolled sideways in windows narrower than the column)
  '.cm-content': { maxWidth: '48rem', margin: '0 auto', padding: '6px 36px 45vh', caretColor: 'var(--view-fg)', minWidth: '0' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--view-fg)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent-bg) 35%, transparent)',
  },

  '.cm-heading': { fontWeight: '700', lineHeight: '1.3', fontFamily: 'var(--heading-font, inherit)' },
  '.cm-h1': { fontSize: '1.9em', fontWeight: '800', paddingTop: '0.3em' },
  '.cm-h2': { fontSize: '1.5em', paddingTop: '0.25em' },
  '.cm-h3': { fontSize: '1.25em' },
  '.cm-h4': { fontSize: '1.1em' },
  '.cm-h5': { fontSize: '1em' },
  '.cm-h6': { fontSize: '1em', color: 'var(--dim-fg)' },

  '.cm-strong': { fontWeight: '700' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through', color: 'var(--dim-fg)' },
  '.cm-inline-code': {
    fontFamily: 'var(--mono-font)',
    fontSize: 'var(--mono-font-size, 0.9em)',
    background: 'var(--card-bg)',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },

  '.cm-link, .cm-url': { color: 'var(--accent-color)', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-link-syntax, .cm-link-definition, .cm-fence, .cm-list-mark, .cm-table-delimiter, .cm-html': { color: 'var(--dim-fg)' },
  '.cm-wikilink': { color: 'var(--accent-color)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' },
  '.cm-wikilink-raw': { textDecoration: 'none' },
  // a link that leaves this workspace: ⧉ for a page of another workspace, ↗ for the web (not while the link is open as text)
  '.cm-wikilink-workspace::after, .cm-link-workspace::after': { content: '"\\00a0\\29c9"', fontSize: '0.8em', opacity: '0.75', display: 'inline-block', textDecoration: 'none', textIndent: '0', whiteSpace: 'nowrap' },
  '.cm-link-web::after': { content: '"\\00a0\\2197"', fontSize: '0.8em', opacity: '0.75', display: 'inline-block', textDecoration: 'none', textIndent: '0', whiteSpace: 'nowrap' },
  '.cm-wikilink-raw::after': { content: 'none' },
  '.cm-wikilink-broken': { color: 'var(--destructive-color)', textDecorationStyle: 'dashed' },
  '.cm-wikilink-ambiguous': { color: 'var(--warning-color)', textDecorationStyle: 'dashed' },
  '.cm-ctrl-held .cm-link, .cm-ctrl-held .cm-wikilink, .cm-ctrl-held .cm-url': { cursor: 'pointer' },

  '.cm-quote': { borderLeft: '3px solid var(--accent-bg)', paddingLeft: '14px', color: 'var(--dim-fg)' },
  '.cm-bullet': { color: 'var(--dim-fg)', display: 'inline-block', width: '1.4em', textIndent: '0', textAlign: 'left', paddingLeft: '0.2em', boxSizing: 'border-box' },
  '.cm-task-checkbox': { margin: '0 0.5em 0 0', width: '1em', height: '1em', flex: 'none', verticalAlign: 'middle', accentColor: 'var(--accent-bg)', cursor: 'pointer' },
  '.cm-task-done': { color: 'var(--dim-fg)' },

  // long lines in code blocks and plain-text documents scroll sideways unless wrapping is on (class cm-wrapcode)
  '&:not(.cm-wrapcode) .cm-codeblock': { position: 'relative', maxWidth: '100%', boxSizing: 'border-box', whiteSpace: 'pre !important', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' },
  '&:not(.cm-wrapcode) .cm-codeblock::-webkit-scrollbar': { display: 'none' },
  // an invisible marker at `--cn-code-w` (set by codeScroll.ts) gives every line of a block the same scrollable width,
  // so the lines scroll together: a short line can be dragged as far as the longest one
  '&:not(.cm-wrapcode) .cm-codeblock::after': { content: '""', position: 'absolute', top: '0', left: 'calc(var(--cn-code-w, 0px) - 1px)', width: '1px', height: '1px', visibility: 'hidden', pointerEvents: 'none' },
  '&:not(.cm-wrapcode) .cm-content.cm-plain': { whiteSpace: 'pre !important', wordBreak: 'normal !important', overflowWrap: 'normal !important', flexShrink: '0 !important' },
  '.cm-codeblock': {
    fontFamily: 'var(--mono-font)',
    fontSize: 'var(--mono-font-size, 0.9em)',
    background: 'var(--card-bg)',
    padding: '0 14px',
  },
  '.cm-fence-hidden': { lineHeight: '0', height: '0', fontSize: '0', overflow: 'hidden' },
  '.cm-codeblock-first': { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', paddingTop: '6px' },
  '.cm-codeblock-last': { borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px', paddingBottom: '6px' },
  '.cm-hr-line': { backgroundImage: 'linear-gradient(var(--border), var(--border))', backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: '0 50%' },
  '.cm-list-indent': { display: 'inline-block', width: '0', overflow: 'hidden', whiteSpace: 'pre', verticalAlign: 'top', height: '0' },
  // The marker box is as wide as the marker column, with the marker pushed to its right end: the empty room lies before the
  // marker, so the text starts right where the space after it ends (one place for the cursor, not two). break-spaces keeps
  // that last space from being dropped or hung outside the box.
  '.cm-list-prefix': { display: 'inline-block', textIndent: '0', textAlign: 'right', whiteSpace: 'break-spaces' },

  '.cm-frontmatter': { fontFamily: 'var(--mono-font)', fontSize: 'calc(var(--mono-font-size, 0.9em) * 0.9)', color: 'var(--dim-fg)', background: 'var(--card-bg)', padding: '0 14px' },
  '.cm-table-header': { fontWeight: '700' },
  // Block widgets get padding, never margins: CodeMirror cannot measure a margin, and every line below would be off by it.
  // the room for the add-row button is always there (the button itself is out of the flow), so the height of the table never
  // depends on where the pointer is
  '.cm-table-wrap': { position: 'relative', padding: '0.6em 0 calc(22px + 0.4em)', cursor: 'default', outline: 'none' },
  '.cm-table-main': { display: 'flex', alignItems: 'stretch', gap: '4px' },
  // a scrollbar of the browser would add its height when it is shown (and when the pointer is over it): the table scrolls with the wheel, the touch or the arrow keys
  '.cm-table-scroll': { overflowX: 'auto', overflowY: 'hidden', minWidth: '0', paddingBottom: '2px', scrollbarWidth: 'none' },
  '.cm-table-scroll::-webkit-scrollbar': { display: 'none', height: '0' },
  '.cm-table': { borderCollapse: 'collapse', minWidth: '50%', fontSize: '0.95em' },
  '.cm-table th, .cm-table td': { border: '1px solid var(--border)', padding: '5px 12px', textAlign: 'left', verticalAlign: 'top', overflowWrap: 'anywhere' },
  '.cm-table th': { background: 'var(--card-bg)', fontWeight: '700' },
  '.cm-table-cell': { outline: 'none', cursor: 'text', minWidth: '3em' },
  '.cm-table-cell:focus': { boxShadow: 'inset 0 0 0 2px var(--accent-bg)' },
  '.cm-table .cm-cell-selected': { background: 'color-mix(in srgb, var(--accent-bg) 28%, var(--view-bg, transparent))' },
  '.cm-table-selecting .cm-table-cell': { userSelect: 'none', caretColor: 'transparent' },
  '.cm-table-wrap:focus .cm-cell-selected': { boxShadow: 'inset 0 0 0 1px var(--accent-bg)' },
  // the grips: a thin row above and a thin column at the left, with the edge of each draggable
  '.cm-table .cm-col-grip, .cm-table .cm-row-grip, .cm-table .cm-table-corner': { position: 'relative', padding: '0', background: 'transparent', border: '0', width: '28px', minWidth: '28px', height: '18px', fontWeight: '400', userSelect: 'none' },
  '.cm-table .cm-col-grip': { width: 'auto', textAlign: 'center' },
  '.cm-table .cm-row-grip': { height: 'auto', verticalAlign: 'middle' },
  '.cm-table-grip': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: '18px', padding: '0', border: '0', borderRadius: '4px', background: 'transparent', color: 'var(--dim-fg)', fontSize: '10px', lineHeight: '1', letterSpacing: '-2px', cursor: 'pointer', opacity: '0.35' },
  '.cm-col-grip .cm-table-grip': { transform: 'rotate(90deg)' },
  '.cm-table-grip:hover, .cm-table-grip:focus-visible, .cm-table-wrap:hover .cm-table-grip': { opacity: '1' },
  '.cm-table-grip:hover': { background: 'var(--card-bg)', color: 'var(--view-fg)' },
  '.cm-col-resize': { position: 'absolute', top: '0', right: '-3px', bottom: '0', width: '7px', cursor: 'col-resize', zIndex: '2', touchAction: 'none' },
  '.cm-row-resize': { position: 'absolute', left: '0', right: '0', bottom: '-3px', height: '7px', cursor: 'row-resize', zIndex: '2', touchAction: 'none' },
  '.cm-col-resize:hover, .cm-row-resize:hover': { background: 'var(--accent-bg)', opacity: '0.6' },
  '.cm-table-bar': { position: 'absolute', top: '0', right: '0', display: 'flex', gap: '4px', zIndex: '3' },
  '.cm-table-edit, .cm-table-add-col, .cm-table-add-row': { border: '0', borderRadius: '5px', background: 'transparent', color: 'var(--dim-fg)', cursor: 'pointer', font: 'inherit', fontSize: '12px', lineHeight: '1', opacity: '0', transition: 'opacity 0.12s' },
  '.cm-table-edit': { padding: '2px 6px', fontFamily: 'var(--mono-font)' },
  '.cm-table-add-col': { width: '22px', flex: 'none', fontSize: '16px' },
  '.cm-table-add-row': { position: 'absolute', left: '0', right: '0', bottom: '0.4em', display: 'block', boxSizing: 'border-box', width: '100%', height: '20px', margin: '0', padding: '0', fontSize: '16px', lineHeight: '20px' },
  '.cm-table-wrap:hover .cm-table-edit, .cm-table-wrap:hover .cm-table-add-col, .cm-table-wrap:hover .cm-table-add-row, .cm-table-wrap:focus-within .cm-table-edit, .cm-table-edit:focus-visible, .cm-table-add-col:focus-visible, .cm-table-add-row:focus-visible': { opacity: '1' },
  '.cm-table-edit:hover, .cm-table-add-col:hover, .cm-table-add-row:hover': { background: 'var(--card-bg)', color: 'var(--view-fg)' },
  '.cm-table code': { fontFamily: 'var(--mono-font)', fontSize: 'var(--mono-font-size, 0.9em)', background: 'var(--card-bg)', borderRadius: '4px', padding: '0 0.3em' },
  '.cm-line:has(> .cm-view-delete)': { position: 'relative' },
  '.cm-view-delete': { position: 'absolute', top: '3px', right: '6px', zIndex: '3', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', padding: '0', border: '0', borderRadius: '6px', background: 'transparent', color: 'var(--dim-fg)', cursor: 'pointer' },
  '.cm-view-delete:hover': { background: 'var(--card-bg)', color: 'var(--error-color, #c01c28)' },
  '.cm-view-block': { padding: '0.8em 0', cursor: 'default' },
  '.cm-properties-wrap': { paddingBottom: '0.9em', position: 'relative' },
  // YAML (frontmatter, view and yaml blocks)
  '.cm-y-key': { color: 'color-mix(in srgb, var(--view-fg) 55%, #3b82d6)' },
  '.cm-y-string': { color: 'color-mix(in srgb, var(--view-fg) 50%, #2e9d5b)' },
  '.cm-y-number': { color: 'color-mix(in srgb, var(--view-fg) 45%, #d9822b)' },
  '.cm-y-bool': { color: 'color-mix(in srgb, var(--view-fg) 45%, #9b59d0)' },
  '.cm-y-expr': { color: 'color-mix(in srgb, var(--view-fg) 45%, #1fa5a5)' },
  '.cm-y-link': { color: 'color-mix(in srgb, var(--view-fg) 45%, #3b82d6)' },
  '.cm-y-tag': { color: 'color-mix(in srgb, var(--view-fg) 45%, #c2559a)' },
  '.cm-y-punct': { color: 'var(--dim-fg)' },
  '.cm-y-comment': { color: 'var(--dim-fg)', fontStyle: 'italic' },
  '.cm-yaml-reserved': { color: 'var(--accent-color)', textDecoration: 'underline dotted', textUnderlineOffset: '3px', cursor: 'help' },
  '.cm-yaml-bad': { position: 'relative', boxShadow: 'inset 2px 0 0 var(--destructive, #e01b24), inset -2px 0 0 var(--destructive, #e01b24)' },
  '.cm-yaml-bad-first': { boxShadow: 'inset 2px 0 0 var(--destructive, #e01b24), inset -2px 0 0 var(--destructive, #e01b24), inset 0 2px 0 var(--destructive, #e01b24)' },
  '.cm-yaml-bad-last': { boxShadow: 'inset 2px 0 0 var(--destructive, #e01b24), inset -2px 0 0 var(--destructive, #e01b24), inset 0 -2px 0 var(--destructive, #e01b24)' },
  '.cm-yaml-bad-first.cm-yaml-bad-last': { boxShadow: 'inset 0 0 0 2px var(--destructive, #e01b24)' },
  '.cm-yaml-bad-last::after': { content: '"Invalid YAML"', position: 'absolute', right: '8px', bottom: '4px', padding: '0 7px', borderRadius: '999px', background: 'var(--destructive, #e01b24)', color: '#fff', font: '600 11px/18px var(--ui-font)', pointerEvents: 'none' },
  '.cm-properties-invalid': { boxShadow: 'inset 0 0 0 2px var(--destructive, #e01b24)', borderRadius: '6px' },
  '.cm-yaml-tag': { position: 'absolute', right: '8px', bottom: '6px', padding: '0 7px', borderRadius: '999px', background: 'var(--destructive, #e01b24)', color: '#fff', font: '600 11px/18px var(--ui-font)', pointerEvents: 'none' },
  '.cm-properties': { letterSpacing: 'normal', wordSpacing: 'normal', fontFamily: 'var(--ui-font, inherit)', fontWeight: '400', lineHeight: '1.4', display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '6px 12px', fontSize: 'calc(var(--editor-ui-size, var(--editor-font-size, 16px)) * 0.8)', color: 'var(--dim-fg)', borderBottom: '1px solid var(--border)', cursor: 'text' },
  '.cm-properties-empty': { fontStyle: 'italic' },
  '.cm-property-key': { marginRight: '6px', fontWeight: '600' },
  '.cm-property-value': { color: 'var(--window-fg)' },

  '.cm-image': { maxWidth: '100%', maxHeight: '28rem', borderRadius: '8px', display: 'block', padding: '0.4em 0', boxSizing: 'content-box' },
  '.cm-image-wrap': { display: 'block' },
  '.cm-image-alt, .cm-image-missing': { color: 'var(--dim-fg)', fontStyle: 'italic' },

  '.cm-attrbar': { letterSpacing: 'normal', wordSpacing: 'normal', padding: '2px 0 4px', fontFamily: 'var(--ui-font, inherit)', fontSize: '14px', lineHeight: '1.3' },
  '.cm-attrbar-row': { display: 'flex', alignItems: 'center', gap: '6px', height: '22px', opacity: '0', transition: 'opacity 0.12s' },
  '.cm-attrbar:hover .cm-attrbar-row, .cm-attrbar:focus-within .cm-attrbar-row, .cm-attrbar-open .cm-attrbar-row': { opacity: '1' },
  // with frontmatter: no row of its own; the info button sits on the first attribute line, at its right end
  '.cm-attrbar-float': { position: 'relative', padding: '0', height: '0' },
  '.cm-attrbar-float .cm-attrbar-row': { position: 'absolute', top: '1px', right: '6px', zIndex: '3', height: '20px', gap: '0' },
  '.cm-attrbar-float .cm-attr-help': { position: 'absolute', top: '24px', right: '0', left: '0', zIndex: '5', boxShadow: '0 6px 24px var(--shadow)' },
  '.cm-attr-add, .cm-attr-info': { border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim-fg)', borderRadius: '11px', height: '20px', padding: '0 9px', fontSize: '12px', cursor: 'pointer', font: 'inherit' },
  '.cm-attr-add': { fontSize: '12px' },
  '.cm-attr-info': { width: '20px', padding: '0', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '700', fontSize: '12px' },
  '.cm-attr-add:hover, .cm-attr-info:hover, .cm-attrbar-open .cm-attr-info': { color: 'var(--view-fg)', background: 'var(--card-bg)' },
  '.cm-attr-help': { margin: '2px 0 6px', padding: '10px 14px', background: 'var(--card-bg)', borderRadius: '8px', fontSize: '13px', lineHeight: '1.5', color: 'var(--view-fg)' },
  '.cm-attr-help p': { margin: '4px 0' },
  '.cm-attr-help pre': { margin: '6px 0 8px', padding: '8px 10px', borderRadius: '6px', background: 'color-mix(in srgb, var(--view-fg) 7%, transparent)', fontFamily: 'var(--mono-font)', fontSize: '12px', overflowX: 'auto', whiteSpace: 'pre' },
  '.cm-attr-help dl': { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 14px', margin: '0' },
  '.cm-attr-help dt': { fontFamily: 'var(--mono-font)', fontSize: '12px' },
  '.cm-attr-help dd': { margin: '0', color: 'var(--dim-fg)' },

  '.cm-wikilink-button': { letterSpacing: 'normal', wordSpacing: 'normal', display: 'inline-block', padding: '1px 12px', borderRadius: '999px', background: 'var(--accent-bg)', color: 'var(--accent-fg, #fff)', textDecoration: 'none', fontFamily: 'var(--ui-font, inherit)', fontWeight: '600', fontSize: 'calc(var(--editor-ui-size, var(--editor-font-size, 16px)) * 0.92)', cursor: 'pointer' },
  '.cm-querylinks-buttons': { display: 'inline-flex', flexWrap: 'wrap', gap: '4px 6px', verticalAlign: 'baseline' },
  '.cm-wikilink-button:hover': { filter: 'brightness(1.12)' },
  // a button that runs an automation: a small bolt in front of the label
  '.cm-automation-button::before': { content: '"\\26A1\\FE0E"', marginRight: '0.4em', fontWeight: '400' },
  '.cm-expression': { textDecoration: 'underline dotted', textUnderlineOffset: '3px', textDecorationColor: 'var(--dim-fg)' },
  '.cm-expression .cm-wikilink': { textDecoration: 'none' },
  '.cm-expression-empty, .cm-expression-bad': { color: 'var(--dim-fg)', fontStyle: 'italic' },
  '.cm-expression-bad': { color: 'var(--destructive-color)' },
  '.cm-querylinks-empty, .cm-querylinks-bad': { color: 'var(--dim-fg)', fontStyle: 'italic' },
  '.cm-querylinks-bad': { color: 'var(--destructive-color)' },
  '.cm-footnote-ref': { color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.75em', fontWeight: '600', padding: '0 0.1em', verticalAlign: 'super', lineHeight: '0' },
  '.cm-footnote-ref:hover': { textDecoration: 'underline' },
  '.cm-footnote-unknown': { color: 'var(--destructive-color)' },
  '.cm-footnote-raw': { color: 'var(--dim-fg)' },
  '.cm-footnote-def': { fontSize: '0.9em', color: 'var(--dim-fg)' },
  '.cm-footnote-def-mark': { color: 'var(--accent-color)', cursor: 'pointer', fontWeight: '600', marginRight: '0.4em' },
  '.cm-tooltip': { border: 'none' },
});

/** The formatting menu lives in <body>, outside the editor, so its styles are a plain stylesheet. */
export const formatMenuCss = `
.cm-format-menu { position: fixed; z-index: 1000; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; box-sizing: border-box;
  max-width: calc(100vw - 8px); padding: 4px; border-radius: 10px;
  background: var(--popover-bg, var(--view-bg)); color: var(--view-fg); border: 1px solid var(--border); box-shadow: 0 4px 18px rgba(0,0,0,.28);
  font-family: var(--ui-font, inherit); font-size: 14px; }
.cm-format-row { display: flex; align-items: center; gap: 2px; }
.cm-format-group { display: flex; align-items: center; gap: 1px; }
.cm-format-divider { align-self: stretch; width: 1px; margin: 4px 4px; background: var(--border); }
.cm-format-split { display: flex; align-items: center; }
.cm-format-btn { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 28px; height: 28px; padding: 0 5px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
.cm-format-btn:hover, .cm-format-btn:focus-visible, .cm-format-sub-item:hover, .cm-format-sub-item:focus-visible { background: color-mix(in srgb, var(--accent-bg) 25%, transparent); outline: none; }
.cm-format-btn.cm-format-on { background: color-mix(in srgb, var(--accent-bg) 30%, transparent); color: var(--accent-color); }
.cm-format-split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; padding: 0 4px; }
.cm-format-caret { min-width: 16px; width: 16px; padding: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; color: var(--dim-fg); }
.cm-format-btn[aria-expanded="true"] { background: color-mix(in srgb, var(--accent-bg) 25%, transparent); }
.cm-format-heading { padding: 0 4px 0 6px; }
.cm-glyph { font-size: 15px; line-height: 1; min-width: 1em; text-align: center; }
.cm-glyph-bold { font-weight: 800; }
.cm-glyph-italic { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 600; }
.cm-glyph-strike { text-decoration: line-through; text-decoration-thickness: 1.5px; }
.cm-glyph-heading { font-weight: 700; font-size: 14px; }
.cm-format-sub { position: fixed; z-index: 1001; min-width: 190px; padding: 4px; border-radius: 10px;
  background: var(--popover-bg, var(--view-bg)); color: var(--view-fg); border: 1px solid var(--border); box-shadow: 0 4px 18px rgba(0,0,0,.28); }
.cm-format-sub-item { display: flex; align-items: center; width: 100%; gap: 8px; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.cm-format-sub-item.cm-format-on { font-weight: 600; background: color-mix(in srgb, var(--accent-bg) 16%, transparent); }
.cm-format-sub-tick { display: inline-flex; width: 12px; color: var(--accent-color); }
.cm-format-sub-sample { min-width: 6.8em; font-family: var(--mono-font, monospace); font-size: 12px; color: var(--dim-fg); }
.cm-format-sub-label { flex: 1; }
.cm-spell-list { min-width: 170px; }
/* touch: the selection menu sits along the bottom edge (above the keyboard), out of the way of the selection handles and the system's own cut/copy/paste bar */
.cm-format-dock { left: 0; right: 0; bottom: 0; top: auto; max-width: none; align-items: stretch; gap: 4px; overflow-x: auto; border-radius: 14px 14px 0 0; border-bottom: 0;
  padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px)); }
.cm-format-dock .cm-format-row { flex-wrap: nowrap; flex: 1 1 auto; justify-content: space-around; }
.cm-format-dock { flex-direction: row; scrollbar-width: none; }
.cm-format-dock::-webkit-scrollbar { display: none; }
.cm-format-dock .cm-dock-launch { flex-direction: column; gap: 1px; min-width: 56px; height: 52px; padding: 4px 8px; }
.cm-dock-face { display: inline-flex; align-items: center; justify-content: center; height: 22px; font-size: 18px; font-weight: 800; line-height: 1; }
.cm-dock-name { font-size: 11px; line-height: 1; opacity: .8; }
.cm-dock-panel { position: fixed; left: 0; right: 0; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-radius: 14px 14px 0 0; max-height: 50vh; overflow-y: auto; box-shadow: 0 -4px 18px rgba(0,0,0,.22); }
.cm-dock-panel .cm-format-group { flex-wrap: wrap; }
.cm-format-dock .cm-format-btn { min-width: 44px; height: 44px; flex: none; }
.cm-format-dock .cm-format-caret { min-width: 28px; width: 28px; }
.cm-format-dock .cm-glyph { font-size: 18px; }
.cm-format-dock .cm-format-sub-item { min-height: 44px; }
.cm-format-btn[aria-disabled="true"] { opacity: 0.35; cursor: default; }
.cm-spell-suggestion { font-weight: 600; }
.cm-spell-rule { height: 1px; margin: 4px 6px; background: var(--border, rgba(128,128,128,.3)); }
.cm-spell-none { padding: 5px 8px; color: var(--dim-fg, #888); font-style: italic; }
.cm-synonym-list { min-width: 190px; max-height: 320px; overflow-y: auto; }
.cm-synonym-title { padding: 5px 8px 3px; color: var(--dim-fg, #888); font-size: 11px; text-transform: none; letter-spacing: .02em; }
.cm-table-menu { position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 11rem; padding: 4px; border-radius: 10px;
  background: var(--popover-bg, var(--view-bg)); color: var(--view-fg); border: 1px solid var(--border); box-shadow: 0 4px 18px rgba(0,0,0,.28);
  font-family: var(--ui-font, inherit); font-size: 14px; }
.cm-table-menu-item { text-align: left; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; padding: 6px 10px; cursor: pointer; }
.cm-table-menu-item:hover:not(:disabled), .cm-table-menu-item:focus-visible { background: var(--hover-bg, rgba(127,127,127,.18)); outline: none; }
.cm-table-menu-item:disabled { opacity: .45; cursor: default; }
@media (pointer: coarse) { .cm-table-menu-item { padding: 12px 12px; } }
`;

let menuStyleInstalled = false;
/** Add the menu stylesheet to the page once. */
export function installFormatMenuStyles(): void {
  if (menuStyleInstalled || typeof document === 'undefined') return;
  menuStyleInstalled = true;
  const el = document.createElement('style');
  el.textContent = formatMenuCss;
  document.head.appendChild(el);
}
