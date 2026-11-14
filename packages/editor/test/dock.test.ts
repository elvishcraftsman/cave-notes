import { runScopeHandlers } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

/** An editor with `text`; `‸` marks the cursor. */
function make(text: string): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  const at = text.indexOf('‸');
  ed.load(at < 0 ? text : text.replace('‸', ''));
  if (at >= 0) ed.view.dispatch({ selection: { anchor: at } });
  return ed;
}

const press = (ed: NoteEditor, key: string, mods: { shift?: boolean; alt?: boolean } = {}): void => {
  runScopeHandlers(ed.view, new KeyboardEvent('keydown', { key, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true }), 'editor');
};

/** the text with the cursor put back in as ‸ */
const show = (ed: NoteEditor): string => {
  const t = ed.text();
  const p = ed.state.selection.main.head;
  return t.slice(0, p) + '‸' + t.slice(p);
};


import { closeFormatMenu, showFormatMenu } from '../src/index';

suite('the docked (touch) toolbar', () => {
  it('is one row of grouped buttons, each opening a panel of tools', () => {
    const ed = make('Some text here');
    ed.view.dispatch({ selection: { anchor: 0, head: 4 } });
    showFormatMenu(ed.view, 0, 0, undefined, undefined, { dock: true });
    const menu = document.querySelector('.cm-format-menu.cm-format-dock')!;
    expect(menu.querySelectorAll(':scope > .cm-format-row')).toHaveLength(1);
    const launchers = [...menu.querySelectorAll<HTMLElement>('.cm-dock-launch')];
    expect(launchers.map((b) => b.getAttribute('aria-label'))).toEqual(['Format', 'Blocks', 'Lists', 'Insert', 'Select']);
    const panel = (name: string): HTMLElement => menu.querySelector<HTMLElement>(`.cm-dock-panel[aria-label="${name}"]`)!;
    expect(panel('Format').style.display).toBe('none');
    launchers[0]!.click();
    expect(panel('Format').style.display).toBe('');
    expect(panel('Format').querySelector('[data-format="bold"]')).not.toBeNull();
    expect(panel('Format').querySelector('[data-format="comment"]')).not.toBeNull();
    launchers[2]!.click();
    expect(panel('Format').style.display).toBe('none');
    expect(panel('Lists').querySelector('[data-format="indent"]')).not.toBeNull();
    closeFormatMenu();
  });

  it('is replaced in one step when the selection changes, never shown twice', () => {
    const ed = make('Some text here');
    showFormatMenu(ed.view, 0, 0, undefined, undefined, { dock: true });
    const first = document.querySelector('.cm-format-dock');
    showFormatMenu(ed.view, 0, 0, undefined, undefined, { dock: true });
    expect(document.querySelectorAll('.cm-format-dock')).toHaveLength(1);
    expect(document.querySelector('.cm-format-dock')).not.toBe(first);
    expect(first!.isConnected).toBe(false);
    closeFormatMenu();
    expect(document.querySelectorAll('.cm-format-dock')).toHaveLength(0);
  });

  it('the mouse menu is unchanged: two rows', () => {
    const ed = make('Some text here');
    showFormatMenu(ed.view, 10, 10);
    expect(document.querySelector('.cm-format-menu:not(.cm-format-dock)')!.querySelectorAll(':scope > .cm-format-row')).toHaveLength(2);
    closeFormatMenu();
  });
});
