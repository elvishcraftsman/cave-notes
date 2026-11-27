import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

const enc = new TextEncoder();
const pack = (files: Record<string, string>): Record<string, Uint8Array> => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)]));

const FILES = pack({
  'plugin.yaml': `plugin:
  id: tills
  name: Tills
  version: 1.0.0
  description: Count the tills.
setup:
  folder: { type: text, label: "Put the pages under", default: "Cash" }
automations:
  - automations/tills.yaml
definitions:
  - definitions/tills.yaml
templates:
  - path: templates/Till Count.md
    managed: true
pages:
  - from: Till Count
    path: "{{setup.folder}}/Till Count"
    open: true
`,
  'automations/tills.yaml': `rules:\n  - id: tills-note\n    name: Tills note\n    on: { plugin: "Tills note" }\n    do:\n      - log: "hi"\n`,
  'definitions/tills.yaml': `schema:\n  float: { type: number }\n`,
  'templates/Till Count.md': `---\nfloat: 100\n---\n# {{title}}\n\nCounted {{date}}\n`,
});

let root: string;
let appCfg: string;
let svc: WorkspaceService;
let events: Array<{ event: string; payload: unknown }> = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-plug-'));
  appCfg = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-app-'));
  await fs.writeFile(path.join(root, 'Home.md'), '# Home\n');
  events = [];
  svc = new WorkspaceService((event, payload) => events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
  await svc.openWorkspace(root, { appConfigDir: appCfg } as never);
  for (let i = 0; i < 200 && !events.some((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'); i++) await new Promise((r) => setTimeout(r, 25));
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(appCfg, { recursive: true, force: true });
});

describe('installing a plugin package', () => {
  it('shows what it would do without writing anything', async () => {
    const p = await svc.pluginPreview({ files: FILES, scope: 'workspace', answers: { folder: 'Tills' } });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.name).toBe('Tills');
    expect(p.pages).toEqual([{ path: 'Tills/Till Count', open: true }]);
    expect(p.problem).toBeNull();
    await expect(fs.stat(path.join(root, '.cave-notes', 'plugins'))).rejects.toThrow();
  });

  it('installs into the workspace: a folder with a record, the starter page tied to its template, the automation loaded', async () => {
    const r = await svc.pluginInstall({ files: FILES, scope: 'workspace', answers: { folder: 'Tills' } });
    expect(r).toMatchObject({ ok: true, folder: 'Tills' });
    expect(r.open).toBe('Tills/Till Count.md');
    const page = await fs.readFile(path.join(root, 'Tills/Till Count.md'), 'utf8');
    expect(page).toContain('pluginPage: tills/till-count-1');
    expect(page).toContain('float: 100');
    expect(page).not.toContain('managed');
    expect(page).not.toContain('plugin: tills');
    // the parent page of the starter page was made, as an ordinary page
    expect(await fs.readFile(path.join(root, 'Tills.md'), 'utf8')).toContain('# Tills');
    const installed = await svc.pluginsInstalled();
    expect(installed.map((i) => [i.name, i.where, i.scope])).toEqual([['Tills', 'workspace', 'workspace']]);
    const plugins = await svc.automationPlugins();
    expect(plugins.map((x) => x.label)).toContain('Tills note');
    // the template is offered for new pages, from the plugin's folder
    expect((await svc.templatesFor(null)).templates.map((t) => t.name)).toContain('Till Count');
  });

  it('installs for the whole app, where every workspace sees its automations', async () => {
    const r = await svc.pluginInstall({ files: FILES, scope: 'app' });
    expect(r.ok).toBe(true);
    expect((await fs.readdir(path.join(appCfg, 'plugins')))).toContain('Tills');
    expect((await svc.automationPlugins()).map((x) => x.label)).toContain('Tills note');
    const where = (await svc.pluginsInstalled()).map((i) => i.where);
    expect(where).toEqual(['app']);
  });

  it('a broken package says what is wrong', async () => {
    const bad = await svc.pluginInstall({ files: pack({ 'plugin.yaml': 'plugin: { id: x }\n' }), scope: 'workspace' });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/name.*missing/);
  });

  it('a new version of an installed plugin updates it: yours kept, the rest replaced, the starter page not made again', async () => {
    await svc.pluginInstall({ files: FILES, scope: 'workspace', answers: { folder: 'Tills' } });
    const mine = path.join(root, '.cave-notes/plugins/Tills/automations/tills.yaml');
    await fs.appendFile(mine, '# mine\n');
    const v2 = pack({
      'plugin.yaml': new TextDecoder().decode(FILES['plugin.yaml']).replace('1.0.0', '1.1.0'),
      'automations/tills.yaml': `rules:\n  - id: tills-note\n    name: Tills note\n    on: { menu: "Tills note" }\n    do:\n      - log: "v2"\n`,
      'definitions/tills.yaml': `schema:\n  float: { type: number }\n  drawer: { type: text }\n`,
      'templates/Till Count.md': new TextDecoder().decode(FILES['templates/Till Count.md']),
    });
    const p = await svc.pluginPreview({ files: v2, scope: 'workspace' });
    expect(p.ok && p.update).toMatchObject({ installedVersion: '1.0.0', direction: 'upgrade', kept: ['automations/tills.yaml'], replaced: ['definitions/tills.yaml'] });
    expect(p.ok && p.answers.folder).toBe('Tills');
    const r = await svc.pluginInstall({ files: v2, scope: 'workspace' });
    expect(r).toMatchObject({ ok: true, open: null });
    expect(r.message).toMatch(/updated from 1\.0\.0 to 1\.1\.0.*1 replaced.*1 of yours kept/);
    expect(await fs.readFile(mine, 'utf8')).toContain('# mine');
    expect(await fs.readFile(path.join(root, '.cave-notes/plugins/Tills/definitions/tills.yaml'), 'utf8')).toContain('drawer');
    expect((await svc.pluginsInstalled()).map((i) => [i.name, i.version])).toEqual([['Tills', '1.1.0']]);
    // the starter page was made once
    expect((await fs.readdir(path.join(root, 'Tills'))).sort()).toEqual(['Till Count.md']);
  });

  it('removes the plugin and leaves its pages as ordinary pages', async () => {
    await svc.pluginInstall({ files: FILES, scope: 'workspace', answers: { folder: 'Tills' } });
    const r = await svc.pluginRemove('Tills', 'workspace');
    expect(r.ok).toBe(true);
    expect(await svc.pluginsInstalled()).toEqual([]);
    const page = await fs.readFile(path.join(root, 'Tills/Till Count.md'), 'utf8');
    expect(page).not.toContain('pluginPage');
    expect(page).toContain('float: 100');
    expect((await svc.automationPlugins()).map((x) => x.label)).not.toContain('Tills note');
  });
});

describe('the plugins that come with the app', () => {
  const shipped = path.resolve(__dirname, '../defaults');
  const open = async (): Promise<WorkspaceService> => {
    await svc.closeWorkspace();
    events = [];
    svc = new WorkspaceService((event, payload) => events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
    await svc.openWorkspace(root, { appConfigDir: appCfg, shippedDefaultsDir: shipped } as never);
    return svc;
  };

  it('are installed as packages, listed as the app’s, removed one at a time and brought back', async () => {
    await open();
    const labels = (await svc.automationPlugins()).map((p) => p.label).sort();
    expect(labels).toEqual(['Estimate page count', 'Join wrapped lines', 'Number headings at this level', 'Numbered list to headings', 'Remove trailing spaces']);
    expect((await fs.readdir(path.join(appCfg, 'plugins'))).sort()).toContain('Join wrapped lines');
    expect((await svc.pluginsInstalled()).filter((i) => i.where === 'app')).toHaveLength(5);
    const gone = await svc.uninstallPlugin('remove-trailing-spaces');
    expect(gone.ok).toBe(true);
    expect((await svc.automationPlugins()).map((p) => p.label)).not.toContain('Remove trailing spaces');
    // it stays gone when the app starts again
    await open();
    expect((await svc.automationPlugins()).map((p) => p.label)).not.toContain('Remove trailing spaces');
    expect(await svc.restoreDefaultPlugins()).toBe(1);
    expect((await svc.automationPlugins()).map((p) => p.label)).toContain('Remove trailing spaces');
  });

  it('leave a workspace’s own YAML alone: settings files, loose plugin files and folders without a manifest still work', async () => {
    await fs.mkdir(path.join(root, '.cave-notes/plugins/Mine'), { recursive: true });
    await fs.writeFile(path.join(root, '.cave-notes/workspace.yaml'), 'schema:\n  mood: { type: text }\nrules:\n  - id: own\n    name: Own\n    on: { menu: Own }\n    do: [ { log: hi } ]\n');
    await fs.writeFile(path.join(root, '.cave-notes/plugins/loose.yaml'), 'rules:\n  - id: loose\n    name: Loose\n    on: { menu: Loose }\n    do: [ { log: hi } ]\n');
    await fs.writeFile(path.join(root, '.cave-notes/plugins/Mine/rules.yaml'), 'rules:\n  - id: folder\n    name: Folder\n    on: { plugin: Folder }\n    do: [ { log: hi } ]\n');
    await open();
    const labels = (await svc.automationPlugins()).map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['Own', 'Loose', 'Folder', 'Join wrapped lines']));
  });
});
