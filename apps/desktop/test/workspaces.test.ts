import YAML from 'yaml';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';
import { scanForWorkspaces } from '../src/main/scan';
import { noLongerWorkspaces, promoteFolder, removeWorkspace, workspaceStatus } from '../src/main/workspaces';
import { cleanNoteTypes } from '../src/main/settings';
import { parseNoteTypes } from '../src/renderer/paths';
import type { WorkerEvents } from '../src/shared/api';

let root: string;
let events: Array<{ event: keyof WorkerEvents; payload: unknown }>;
let svc: WorkspaceService;

const write = async (rel: string, text = ''): Promise<void> => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
};
const exists = (rel: string): Promise<boolean> => fs.stat(path.join(root, ...rel.split('/'))).then(() => true, () => false);

async function waitReady(): Promise<void> {
  const t0 = Date.now();
  while (!events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready')) {
    if (Date.now() - t0 > 8000) throw new Error('indexing did not finish');
    await new Promise((r) => setTimeout(r, 25));
  }
  events.length = 0;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-ws-'));
  events = [];
  svc = new WorkspaceService((event, payload) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('file types', () => {
  it('lists .txt notes next to .md ones, creates notes with the chosen type, and leaves other files out', async () => {
    await write('A.md', '# A');
    await write('B.txt', 'plain');
    await write('pic.png', 'x');
    await svc.openWorkspace(root, { notes: { exts: ['.md', '.txt'], create: '.txt' } });
    await waitReady();
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md', 'B.txt']);
    const made = await svc.createPage(null, 'Fresh');
    expect(made).toBe('Fresh.txt');
    expect(await exists('Fresh.txt')).toBe(true);
  });

  it('a workspace can choose its own types, saved in workspace.yaml without losing what is there', async () => {
    await write('A.md', '# A');
    await write('B.txt', 'plain');
    await write('.cave-notes/workspace.yaml', '# my settings\nattributes:\n  lang: en\n');
    await svc.openWorkspace(root, { notes: { exts: ['.md', '.txt'], create: '.md' } });
    await waitReady();
    await svc.setNoteTypes({ exts: ['.txt'], create: '.txt' }, { exts: ['.md', '.txt'], create: '.md' });
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['B.txt']);
    const text = await fs.readFile(path.join(root, '.cave-notes', 'workspace.yaml'), 'utf8');
    expect(text).toContain('# my settings');
    expect(YAML.parse(text)).toMatchObject({ attributes: { lang: 'en' }, notes: { extensions: ['.txt'], create: '.txt' } });
    expect((await svc.getNoteTypes()).own).toEqual({ exts: ['.txt'], create: '.txt' });
    await svc.setNoteTypes(null, { exts: ['.md'], create: '.md' });
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md']);
    expect(YAML.parse(await fs.readFile(path.join(root, '.cave-notes', 'workspace.yaml'), 'utf8')).notes).toBeUndefined();
  });

  it('cleans the types people type', () => {
    expect(parseNoteTypes('md, .TXT; markdown md', 'txt')).toEqual({ exts: ['.md', '.txt', '.markdown'], create: '.txt' });
    expect(parseNoteTypes('', 'md')).toBeNull();
    expect(parseNoteTypes('a/b ../x', 'md')).toBeNull();
    expect(cleanNoteTypes(['.md', 'TXT', 5, 'bad name'], 'org')).toEqual({ exts: ['.md', '.txt', '.org'], create: '.org' });
  });
});

describe('nested workspaces', () => {
  it('keeps a workspace inside another out of its tree, or shows it as a marked folder', async () => {
    await write('Home.md', '# Home');
    await write('School/Math.md', '# Math');
    await write('School/.cave-notes/workspace.yaml', '');
    await svc.openWorkspace(root);
    await waitReady();
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['Home.md']);
    const shown = await svc.listChildren(null, { workspaces: true });
    expect(shown.map((i) => i.path)).toEqual(['Home.md', 'School.md']);
    expect(shown[1]).toMatchObject({ exists: false, hasChildren: false, workspaceRoot: path.join(root, 'School') });
    expect((await svc.search('Math')).results).toHaveLength(0);
  });

  it('shows a nested workspace with the icon assigned to it in its own settings', async () => {
    await write('Home.md', '# Home');
    await write('School/Math.md', '# Math');
    await write('School/.cave-notes/workspace.yaml', 'icon: settings\n');
    await write('Plain/A.md', '# A');
    await write('Plain/.cave-notes/workspace.yaml', '');
    await svc.openWorkspace(root);
    await waitReady();
    const shown = await svc.listChildren(null, { workspaces: true });
    expect(shown.find((i) => i.name === 'School')?.icon).toBe('settings');
    expect(shown.find((i) => i.name === 'Plain')?.icon).toBeUndefined();
  });

  it('takes pages out of the outer index when a folder is promoted, and back when it is removed', async () => {
    await write('Home.md', '# Home');
    await write('Area/Deep.md', '# Deep\n\nzebra');
    await svc.openWorkspace(root);
    await waitReady();
    expect((await svc.search('zebra')).results.map((r) => r.path)).toEqual(['Area/Deep.md']);
    await promoteFolder(path.join(root, 'Area'), null);
    await svc.rescan();
    expect((await svc.search('zebra')).results).toHaveLength(0);
    await removeWorkspace(path.join(root, 'Area'));
    await svc.rescan();
    expect((await svc.search('zebra')).results.map((r) => r.path)).toEqual(['Area/Deep.md']);
  });

  it('promoting with "keep settings" copies the schema and shared settings', async () => {
    await write('.cave-notes/schema.yaml', 'schema:\n  status:\n    type: text\n');
    await write('.cave-notes/workspace.yaml', 'color: "#3584e4"\nattributes:\n  lang: en\nfiles:\n  x.png:\n    a: 1\n');
    await write('Inner/A.md', '# A');
    await promoteFolder(path.join(root, 'Inner'), root);
    // the settings of the other workspace arrive as one file, whichever files they were in there
    const copied = YAML.parse(await fs.readFile(path.join(root, 'Inner', '.cave-notes', 'workspace.yaml'), 'utf8'));
    expect(copied).toEqual({ color: '#3584e4', attributes: { lang: 'en' }, schema: { status: { type: 'text' } } });
    expect(await workspaceStatus(path.join(root, 'Inner'))).toEqual({ isWorkspace: true, containing: root });
    expect(await workspaceStatus(path.join(root, 'Inner', 'Sub'))).toEqual({ isWorkspace: false, containing: path.join(root, 'Inner') });
  });
});

describe('files that are not notes', () => {
  it('lists the files of a page folder, opens them by path, and gives them attributes through the page', async () => {
    await write('Trip.md', '---\nfiles:\n  Trip/map.png:\n    status: done\n---\n# Trip');
    await write('Trip/map.png', 'png');
    await write('Trip/Ticket.md', '# Ticket');
    await write('Trip/.hidden', 'x');
    await svc.openWorkspace(root);
    await waitReady();
    expect(await svc.listFiles('Trip.md')).toEqual([{ path: 'Trip/map.png', name: 'map.png', size: 3 }]);
    expect(await svc.filePath('Trip/map.png')).toBe(path.join(root, 'Trip', 'map.png'));
    await expect(svc.filePath('../x')).rejects.toThrow();
    expect((await svc.search('status:done')).results.map((r) => r.path)).toEqual(['Trip/map.png']);
  });
});

describe('files that belong to one computer', () => {
  it('live in the data folder, so nothing in the workspace needs to be excluded from syncing', async () => {
    await write('A.md', '# A\n');
    await write('.cave-notes/workspace.yaml', 'accent: green\n');
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-data-'));
    await svc.openWorkspace(root, { dataDir: data });
    await waitReady();
    await svc.writePage('A.md', '# A\nedited\n', (await svc.readPage('A.md')).hash);
    await svc.setState({ lastPage: 'A.md' });
    await svc.closeWorkspace();
    expect((await fs.readdir(path.join(root, '.cave-notes'))).sort()).toEqual(['workspace.yaml']);
    expect(await exists('.stignore')).toBe(false);
    const names = await fs.readdir(data);
    expect(names).toContain('index.db');
    expect(names).toContain('history');
    expect(names).toContain('state.yaml');
    await fs.rm(data, { recursive: true, force: true });
  });
});

describe('looking for workspaces', () => {
  it('finds them, nested ones too, and leaves out hidden folders, node_modules and ignored folders', async () => {
    for (const d of ['One', 'One/Inner', 'Two/Deep', 'Skip/Me', '.hidden/Ws', 'node_modules/Ws']) await write(`${d}/.cave-notes/workspace.yaml`, '');
    const found = await scanForWorkspaces([root], [path.join(root, 'Skip')]);
    expect(found.map((p) => path.relative(root, p))).toEqual(['One', 'One/Inner', 'Two/Deep']);
  });
});

describe('a workspace removed on another computer', () => {
  it('can still be "removed" here: nothing to delete is not an error', async () => {
    await write('A.md', '# A');
    await expect(removeWorkspace(root)).resolves.toBeUndefined();
    expect(await exists('A.md')).toBe(true);
  });

  it('is found out by noLongerWorkspaces, while a missing folder (unplugged drive) is left alone', async () => {
    await write('A.md', '# A');
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-ws2-'));
    await fs.mkdir(path.join(other, '.cave-notes'));
    const missing = path.join(os.tmpdir(), 'cave-ws-not-there');
    try {
      expect(await noLongerWorkspaces([root, other, missing])).toEqual([root]);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});
