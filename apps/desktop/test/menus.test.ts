// @vitest-environment jsdom
import { h, render, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { MenuItem, Popover } from '../src/renderer/components/Overlays';
import { cleanDictionary, DEFAULT_SETTINGS, portableSettings } from '../src/main/settings';

/** Long enough for the page to redraw and for effects (which Preact runs after a paint) to have run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 130));

/** The same shape as the header's main menu: a button and its popover side by side in one anchor. */
function Demo(): JSX.Element {
  const [open, setOpen] = useState(false);
  return h('div', { class: 'menu-anchor' },
    h('button', { id: 'toggle', onClick: () => setOpen(!open) }, 'menu'),
    h(Popover, { open, onClose: () => setOpen(false), children: h(MenuItem, { label: 'Item', onClick: () => undefined }) }),
  );
}

/** A press and release, the way a mouse click arrives. */
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await tick(); // the page redraws between the press and the release
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await tick();
};

describe('a popover menu and the button that opens it', () => {
  it('the button opens it and closes it again', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Demo, {}), root);
    const toggle = root.querySelector('#toggle')!;
    expect(root.querySelector('.popover')).toBeNull();
    await click(toggle);
    expect(root.querySelector('.popover')).not.toBeNull();
    await click(toggle);
    expect(root.querySelector('.popover')).toBeNull();
    await click(toggle);
    expect(root.querySelector('.popover')).not.toBeNull();
  });

  it('a click elsewhere still closes it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Demo, {}), root);
    await click(root.querySelector('#toggle')!);
    expect(root.querySelector('.popover')).not.toBeNull();
    await click(document.body);
    expect(root.querySelector('.popover')).toBeNull();
  });
});

describe('the dictionary preference', () => {
  it('keeps single words, once each, in order', () => {
    expect(cleanDictionary(['Zeta', 'alpha', 'ALPHA', ' beta ', 'two words', '', 5, 'x'.repeat(61)])).toEqual(['alpha', 'beta', 'Zeta']);
    expect(cleanDictionary('nope')).toEqual([]);
  });

  it('is on by default with no words', () => {
    expect(DEFAULT_SETTINGS.spellcheck).toBe(true);
    expect(DEFAULT_SETTINGS.dictionary).toEqual([]);
  });

  it('travels in an exported settings file, checked', () => {
    const out = portableSettings({ spellcheck: false, dictionary: ['Selah', 'selah', 'Maccabees', 3] });
    expect(out.spellcheck).toBe(false);
    expect(out.dictionary).toEqual(['Maccabees', 'Selah']);
    expect(portableSettings({ spellcheck: 'yes' }).spellcheck).toBeUndefined();
  });
});
