// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { DialogHost } from '../src/renderer/components/Dialogs';
import type { Controller } from '../src/renderer/controller';
import { THESAURUS_CREDITS, WORDNET_NOTICE } from '../src/renderer/credits';
import { DEFAULT_SETTINGS, portableSettings } from '../src/main/settings';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

function fakeController(opened: string[], page: 'docs' | 'shortcuts' | 'logs' | 'about' = 'about'): Controller {
  return {
    dialog: signal({ kind: 'help', page }),
    caps: { windows: true },
    update: signal(null),
    openUrl: (u: string) => void opened.push(u),
    logSources: async () => ({ dir: '', sources: [] }),
  } as unknown as Controller;
}

describe('the Help window', () => {
  it('has the documentation, shortcuts, logs and about pages, opening at the one asked for', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(DialogHost, { ctl: fakeController([], 'shortcuts') }), root);
    await tick();
    const tabs = [...root.querySelectorAll('.prefs-nav button')].map((b) => b.textContent);
    expect(tabs).toEqual(['Documentation', 'Keyboard shortcuts', 'Logs', 'About']);
    expect(root.querySelector('.prefs-nav button.on')?.textContent).toBe('Keyboard shortcuts');
    expect(root.querySelector('.prefs')?.textContent).toContain('Redo');
    render(null, root);
  });

  it('lists the documentation pages, and each opens that page', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const opened: string[] = [];
    const ctl = fakeController([], 'docs');
    (ctl as unknown as { openDocumentation: (f?: string) => void }).openDocumentation = (f) => void opened.push(f ?? '');
    render(h(DialogHost, { ctl }), root);
    await tick();
    const links = [...root.querySelectorAll('.help-topics .about-link')] as HTMLElement[];
    expect(links.length).toBeGreaterThan(10);
    links.find((l) => l.textContent === 'Export styles')!.click();
    expect(opened).toEqual(['export-styles.md']);
    expect(ctl.dialog.value).toBeNull();
    render(null, root);
  });
});

describe('the About page', () => {
  it('says what the app is and credits both word lists, with their licences', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(DialogHost, { ctl: fakeController([]) }), root);
    await tick();
    const text = root.textContent ?? '';
    expect(text).toContain('About Cave Notes');
    expect(text).toMatch(/Version\s*\S+/);
    expect(text).toContain('Markdown');
    expect(text).toContain('WordNet 3.0');
    expect(text).toContain('Princeton University');
    expect(text).toContain('Moby Thesaurus II');
    expect(text).toContain('Grady Ward');
    expect(text).toContain('Public domain');
    expect(root.querySelector('.about-notice pre')?.textContent).toContain('WordNet 3.0 Copyright 2006 by Princeton University');
    render(null, root);
  });

  it('opens a credit’s home page and closes with its button', async () => {
    const opened: string[] = [];
    const ctl = fakeController(opened);
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(DialogHost, { ctl }), root);
    await tick();
    (root.querySelector('.about-link') as HTMLElement).click();
    expect(opened).toEqual([THESAURUS_CREDITS[0]!.url]);
    (root.querySelector('.dialog-actions button') as HTMLElement).click();
    expect(ctl.dialog.value).toBeNull();
    render(null, root);
  });

  it('the WordNet notice shown is the licence file that ships with the app', () => {
    const file = readFileSync(join(__dirname, '../assets/licenses/wordnet-LICENSE.txt'), 'utf8').trim().replace(/\n{3,}/g, '\n\n');
    expect(WORDNET_NOTICE).toBe(file);
    expect(readFileSync(join(__dirname, '../assets/licenses/moby-NOTICE.txt'), 'utf8')).toContain('public domain');
  });
});

describe('the synonyms preference', () => {
  it('is on by default, travels in a settings file, and ignores junk', () => {
    expect(DEFAULT_SETTINGS.synonyms).toBe(true);
    expect(portableSettings({ synonyms: false }).synonyms).toBe(false);
    expect(portableSettings({ synonyms: 'no' }).synonyms).toBeUndefined();
    expect(DEFAULT_SETTINGS.indexAllWorkspaces).toBe(true);
    expect(portableSettings({ indexAllWorkspaces: false }).indexAllWorkspaces).toBe(false);
  });
});
