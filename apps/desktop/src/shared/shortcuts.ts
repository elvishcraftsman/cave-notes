/** Every keyboard shortcut, for the Keyboard Shortcuts dialog and docs/02-writing/06-shortcuts.md (a test keeps the two in step). */
export interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; does: string }>;
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Windows and tabs',
    items: [
      { keys: 'Ctrl+N', does: 'New page' },
      { keys: 'Ctrl+Shift+N', does: 'New window' },
      { keys: 'Ctrl+O', does: 'Open a folder' },
      { keys: 'Ctrl+T', does: 'New tab (a copy of this one)' },
      { keys: 'Ctrl+W', does: 'Close the tab' },
      { keys: 'Ctrl+Tab / Ctrl+Shift+Tab', does: 'Next / previous tab, in tab order' },
      { keys: 'Ctrl+PageDown / Ctrl+PageUp', does: 'Next / previous tab, in tab order' },
      { keys: 'Alt+W', does: 'Switch to the tab you used before this one; keep Alt down and press W again to go further back (Shift+Alt+W goes the other way)' },
      { keys: 'Alt+Left / Alt+Right', does: 'Back / forward in this tab' },
      { keys: 'Ctrl+,', does: 'Preferences' },
      { keys: 'Ctrl+/', does: 'This list of shortcuts' },
      { keys: 'F1', does: 'Help (documentation, shortcuts, logs, about)' },
    ],
  },
  {
    title: 'Moving around',
    items: [
      { keys: 'F6', does: 'Move the keyboard between the page tree and the editor' },
      { keys: 'F9 / Shift+F9', does: 'Show or hide the page sidebar / the outline sidebar' },
      { keys: 'Ctrl+Shift+F', does: 'Search all pages' },
      { keys: 'F2', does: 'Rename the open page (in the tree: the selected one)' },
    ],
  },
  {
    title: 'Page tree',
    items: [
      { keys: 'Up / Down', does: 'Select the previous / next page (and open it)' },
      { keys: 'Right', does: 'Expand, or go to the first sub-page' },
      { keys: 'Left', does: 'Collapse, or go to the parent' },
      { keys: 'Home / End', does: 'Select the first / last page' },
      { keys: 'Enter', does: 'Move to the editor' },
      { keys: 'F2', does: 'Rename the page' },
      { keys: 'Delete', does: 'Delete the page (asks first)' },
      { keys: 'Any letter', does: 'Open the tree\'s find box with that letter: matching pages light up, Up / Down move between them without opening, Enter opens the current one, Esc closes the box' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: 'Ctrl+S', does: 'Save now' },
      { keys: 'Ctrl+Z', does: 'Undo' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', does: 'Redo' },
      { keys: 'Alt+Z', does: 'Wrap or unwrap long lines in code blocks and plain-text files' },
      { keys: 'Ctrl+F', does: 'Find in this page (wherever the keyboard is, not only in the editor)' },
      { keys: 'Ctrl+H', does: 'Find and replace' },
      { keys: 'F3 / Ctrl+G', does: 'Next match (Shift for the previous one)' },
      { keys: 'Ctrl+B / Ctrl+I / Ctrl+E', does: 'Bold / italic / code' },
      { keys: 'Ctrl+Shift+X', does: 'Strike-through' },
      { keys: 'Ctrl+K', does: 'Insert a link' },
      { keys: 'Ctrl+Alt+V', does: 'Insert a database view' },
      { keys: 'Tab / Shift+Tab', does: 'Indent / outdent a list item' },
      { keys: 'Alt+Up / Alt+Down', does: 'Move a list item up / down' },
      { keys: 'Ctrl+Click', does: 'Open the link under the pointer' },
    ],
  },
  {
    title: 'Settings boxes (YAML)',
    items: [
      { keys: 'Tab / Shift+Tab', does: 'Indent / outdent the lines selected' },
      { keys: 'Esc, then Tab', does: 'Leave the box instead of indenting' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: 'Ctrl+Shift+E', does: 'Export the page' },
      { keys: 'Ctrl+Shift+L', does: 'Light or dark theme' },
    ],
  },
];
