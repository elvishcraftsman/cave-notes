import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';
import { isConfigRoot } from '@cave-notes/service/config-folder';
import type { WorkerEvents } from '../src/shared/api';

type Ev = { event: keyof WorkerEvents; payload: unknown };
let root: string;
let events: Ev[];
let svc: WorkspaceService;

const write = async (rel: string, text: string): Promise<void> => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
};
const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);
async function waitFor<T>(fn: () => T | undefined | false, what: string, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const ready = (): Promise<Ev> => waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'ready');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-cfg-'));
  events = [];
  svc = new WorkspaceService((event, payload) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('showing templates in the tree', () => {
  const files = {
    'Notes.md': '# Notes',
    'Notes/Meeting.md': '---\ntemplate: true\n---\n# Meeting',
    'Notes/Secret.md': '---\nhidden: true\n---\n# Secret',
    'Notes/Plain.md': '# Plain',
    'Solo.md': '# Solo',
    'Solo/OnlyTemplate.md': '---\ntemplate: true\n---\n# T',
    'Top template.md': '---\ntemplate: true\n---\n# Top',
  };
  const open = async (): Promise<void> => {
    for (const [k, v] of Object.entries(files)) await write(k, v);
    await svc.openWorkspace(root);
    await ready();
  };

  it('keeps templates and hidden pages out of the tree by default', async () => {
    await open();
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['Notes.md', 'Solo.md']);
    expect((await svc.listChildren('Notes.md')).map((i) => i.path)).toEqual(['Notes/Plain.md']);
    // a page whose sub-pages are all templates has nothing to expand
    expect((await svc.listChildren(null)).find((i) => i.path === 'Solo.md')?.hasChildren).toBe(false);
  });

  it('a page hidden from the tree that is not a template is kept out of it, and shown with the others when asked', async () => {
    await write('Notes/Unlisted.md', '---\nhidden: files\n---\n# Unlisted');
    await open();
    expect((await svc.listChildren('Notes.md')).map((i) => i.path)).toEqual(['Notes/Plain.md']);
    const kids = await svc.listChildren('Notes.md', { unlisted: true });
    expect(kids.find((i) => i.path === 'Notes/Unlisted.md')).toMatchObject({ unlisted: true });
    expect(kids.find((i) => i.path === 'Notes/Unlisted.md')?.template).toBeUndefined();
  });

  it('brings the pages hidden from the tree (templates among them) back, marked, when asked', async () => {
    await open();
    const top = await svc.listChildren(null, { unlisted: true });
    expect(top.map((i) => i.path)).toEqual(['Notes.md', 'Solo.md', 'Top template.md']);
    expect(top.find((i) => i.path === 'Top template.md')).toMatchObject({ template: true });
    expect(top.find((i) => i.path === 'Notes.md')?.template).toBeUndefined();
    expect(top.find((i) => i.path === 'Solo.md')?.hasChildren).toBe(true);
    const kids = await svc.listChildren('Notes.md', { unlisted: true });
    expect(kids.map((i) => i.path)).toEqual(['Notes/Meeting.md', 'Notes/Plain.md', 'Notes/Secret.md']); // `hidden: true` hides from the tree too
    expect(kids[0]).toMatchObject({ template: true });
  });
});

describe('the settings folder', () => {
  it('is made when missing, with nothing in it, and nothing that exists is touched', async () => {
    await write('A.md', '# A');
    await svc.openWorkspace(root);
    await ready();
    const dir = await svc.ensureConfigFolder();
    expect(dir).toBe(path.join(root, '.cave-notes'));
    expect(await fs.readdir(dir)).toEqual([]);
    await write('.cave-notes/schema.yaml', 'mine: true\n');
    await svc.ensureConfigFolder();
    expect(await fs.readdir(dir)).toEqual(['schema.yaml']);
    expect(await fs.readFile(path.join(dir, 'schema.yaml'), 'utf8')).toBe('mine: true\n');
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md']);
  });

  it('opens as a workspace with no index, schema or .cave-notes of its own, listing its files and templates', async () => {
    await write('.cave-notes/workspace.yaml', 'color: "#3584e4"\n');
    await write('.cave-notes/schema.yaml', '# schema\n');
    await write('.cave-notes/templates/Meeting.md', '# Meeting\n');
    const cfg = path.join(root, '.cave-notes');
    expect(isConfigRoot(cfg)).toBe(true);
    const info = await svc.openWorkspace(cfg, { config: true });
    expect(info).toMatchObject({ root: cfg, config: true });
    expect(info.name).toContain('(config)');
    await ready();
    expect((await svc.listChildren(null)).map((i) => i.path).sort()).toEqual(['schema.yaml', 'templates.md', 'workspace.yaml']);
    expect((await svc.listChildren('templates.md')).map((i) => i.path)).toEqual(['templates/Meeting.md']);
    // nothing of a workspace was made inside it
    expect(await exists(path.join(cfg, '.cave-notes'))).toBe(false);
    expect(await exists(path.join(cfg, 'index.db'))).toBe(false);
    expect(await svc.getNoteTypes()).toMatchObject({ own: null });
  });

  it('edits the files: reads and writes YAML and templates, and takes its colour from the workspace', async () => {
    await write('.cave-notes/workspace.yaml', 'color: "#3584e4"\n');
    await write('.cave-notes/templates/Meeting.md', '# Meeting\n');
    const cfg = path.join(root, '.cave-notes');
    await svc.openWorkspace(cfg, { config: true });
    await ready();
    const page = await svc.readPage('workspace.yaml');
    expect(page).toMatchObject({ exists: true, text: 'color: "#3584e4"\n' });
    const w = await svc.writePage('workspace.yaml', 'color: "#e01b24"\nicon: house\n', page.hash);
    expect(w).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(cfg, 'workspace.yaml'), 'utf8')).toBe('color: "#e01b24"\nicon: house\n');
    const t = await svc.readPage('templates/Meeting.md');
    await svc.writePage('templates/Meeting.md', '---\ntemplate: true\n---\n# {{title}}\n', t.hash);
    expect(await fs.readFile(path.join(cfg, 'templates', 'Meeting.md'), 'utf8')).toContain('{{title}}');
    const look = await svc.getAppearance();
    expect(look).toMatchObject({ color: '#e01b24', icon: 'settings' });
    // asking to change the look does not write anything
    await svc.setAppearance({ color: '#000000' });
    expect(await fs.readFile(path.join(cfg, 'workspace.yaml'), 'utf8')).toContain('#e01b24');
    // a new template can be made in the templates folder
    const made = await svc.createPage('templates.md', 'Weekly', '# Weekly\n');
    expect(made).toBe('templates/Weekly.md');
    // a new settings file at the top level is YAML, and starts empty
    const yml = await svc.createPage(null, 'rules', undefined);
    expect(yml).toBe('rules.yaml');
    expect(await fs.readFile(path.join(cfg, 'rules.yaml'), 'utf8')).toBe('');
    expect(await exists(path.join(cfg, 'templates', 'Weekly.md'))).toBe(true);
  });

  it('refuses to open its own settings folder from inside', async () => {
    const cfg = path.join(root, '.cave-notes');
    await fs.mkdir(cfg, { recursive: true });
    await svc.openWorkspace(cfg, { config: true });
    await expect(svc.ensureConfigFolder()).rejects.toThrow(/no workspace/i);
  });
});
