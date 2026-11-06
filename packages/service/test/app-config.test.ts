import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefaultPlugins, removeDefaultPlugin, removeRuleFromFile, removedDefaults, seedDefaults } from '../src/app-config';
import { orderPlugins } from '../src/service';
import { rulesText } from '../src/workspace-file';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cn-appcfg-'));
const plugin = (id: string, label: string): string => `rules:\n  - id: ${id}\n    on: { plugin: "${label}" }\n    do:\n      - log: "hi"\n`;

function shippedWith(files: Record<string, string>): string {
  const dir = tmp();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe('the plugins that come with the app', () => {
  it('copies them into the app config folder, once', async () => {
    const shipped = shippedWith({ 'plugins/a.yaml': plugin('a', 'Alpha'), 'plugins/b.yaml': plugin('b', 'Beta'), 'plugins/notes.txt.bak': 'x' });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    const r = await seedDefaults(shipped, target);
    expect(r.added.sort()).toEqual(['plugins/a.yaml', 'plugins/b.yaml']);
    expect(fs.existsSync(path.join(target, 'templates'))).toBe(true);
    expect((await seedDefaults(shipped, target)).added).toEqual([]);
    const loaded = await loadDefaultPlugins(target);
    expect(loaded.rules.map((x) => (x as { id: string }).id)).toEqual(['a', 'b']);
    expect(loaded.fileOf.get('b')).toBe('plugins/b.yaml');
  });

  it('updates a copy nobody changed, and never touches one the person changed', async () => {
    const shipped = shippedWith({ 'plugins/a.yaml': plugin('a', 'Alpha'), 'plugins/b.yaml': plugin('b', 'Beta') });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    await seedDefaults(shipped, target);
    fs.writeFileSync(path.join(target, 'plugins/b.yaml'), plugin('b', 'My own Beta'));
    fs.writeFileSync(path.join(shipped, 'plugins/a.yaml'), plugin('a', 'Alpha 2'));
    fs.writeFileSync(path.join(shipped, 'plugins/b.yaml'), plugin('b', 'Beta 2'));
    const r = await seedDefaults(shipped, target);
    expect(r.updated).toEqual(['plugins/a.yaml']);
    expect(fs.readFileSync(path.join(target, 'plugins/a.yaml'), 'utf8')).toContain('Alpha 2');
    expect(fs.readFileSync(path.join(target, 'plugins/b.yaml'), 'utf8')).toContain('My own Beta');
  });

  it('keeps an uninstalled one gone until it is restored', async () => {
    const shipped = shippedWith({ 'plugins/a.yaml': plugin('a', 'Alpha'), 'plugins/b.yaml': plugin('b', 'Beta') });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    await seedDefaults(shipped, target);
    expect(await removeDefaultPlugin(target, 'a')).toBe(true);
    expect(fs.existsSync(path.join(target, 'plugins/a.yaml'))).toBe(false);
    await seedDefaults(shipped, target);
    expect(fs.existsSync(path.join(target, 'plugins/a.yaml'))).toBe(false);
    expect(await removedDefaults(shipped, target)).toEqual(['plugins/a.yaml']);
    await seedDefaults(shipped, target, { restore: true });
    expect(fs.existsSync(path.join(target, 'plugins/a.yaml'))).toBe(true);
    expect(await removedDefaults(shipped, target)).toEqual([]);
  });

  it('removes one rule of a file with several and keeps the rest', async () => {
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugins/two.yaml'), `# mine\nrules:\n  - id: a\n    on: { plugin: "A" }\n  - id: b\n    on: { plugin: "B" }\n`);
    expect(await removeDefaultPlugin(target, 'a')).toBe(true);
    const text = fs.readFileSync(path.join(target, 'plugins/two.yaml'), 'utf8');
    expect(text).toContain('# mine');
    expect(text).toContain('id: b');
    expect(text).not.toContain('id: a');
  });

  it('skips a file that is not valid YAML and says why', async () => {
    const target = path.join(tmp(), '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugins/bad.yaml'), 'rules: [unclosed');
    fs.writeFileSync(path.join(target, 'plugins/ok.yaml'), plugin('ok', 'Fine'));
    const r = await loadDefaultPlugins(target);
    expect(r.rules).toHaveLength(1);
    expect(r.problems[0]).toContain('bad.yaml');
  });
});

describe('a workspace and the plugins that come with the app', () => {
  const shippedRule = { id: 'a', on: { plugin: 'Alpha' }, do: [{ log: 'shipped' }] };
  it('has them even with no settings of its own', async () => {
    const dir = tmp();
    expect(await rulesText(dir, undefined)).toBeNull();
    const text = (await rulesText(dir, undefined, [shippedRule]))!;
    expect(text).toContain('id: a');
  });
  it('lets its own rule with the same id win, and an empty rules: does not switch them off', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'rules:\n  - id: a\n    on: { plugin: "Mine" }\n');
    const text = (await rulesText(dir, undefined, [shippedRule, { id: 'z', on: { plugin: 'Z' } }]))!;
    expect(text).toContain('Mine');
    expect(text).not.toContain('Alpha');
    expect(text).toContain('id: z');
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'rules: []\n');
    expect((await rulesText(dir, undefined, [shippedRule]))!).toContain('id: a');
  });
  it('removes a rule from a settings file, dropping the key with the last one', async () => {
    const file = path.join(tmp(), 'workspace.yaml');
    fs.writeFileSync(file, 'name: x\nrules:\n  - id: a\n    on: { plugin: A }\n  - id: b\n    on: { plugin: B }\n');
    expect(await removeRuleFromFile(file, 'a')).toBe(true);
    expect(await removeRuleFromFile(file, 'nope')).toBe(false);
    expect(await removeRuleFromFile(file, 'b')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('name: x\n');
  });
});

describe('the order of the Plugins menu', () => {
  it('puts the person’s own first, as written, then those offered, then the shipped ones by name', () => {
    const p = (id: string, label: string, extra: object = {}) => ({ id, label, ask: [], origin: 'workspace' as const, ...extra });
    const out = orderPlugins([p('z', 'zebra', { origin: 'default' }), p('m2', 'My second'), p('a', 'apple', { origin: 'default' }), p('o', 'Offered', { pending: { source: '/x', name: 'X' } }), p('m1', 'My first'), p('b', 'Banana', { origin: 'default' })]);
    expect(out.map((x) => x.id)).toEqual(['m2', 'm1', 'o', 'a', 'b', 'z']);
  });
});

describe('templates of the app', () => {
  it('are offered in a workspace, and the workspace’s own of the same name win', async () => {
    const { listTemplates, findTemplate } = await import('../src/templates');
    const root = tmp();
    const app = tmp();
    fs.mkdirSync(path.join(root, '.cave-notes', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cave-notes', 'templates', 'Meeting.md'), '# Workspace meeting\n');
    fs.writeFileSync(path.join(app, 'Meeting.md'), '# App meeting\n');
    fs.writeFileSync(path.join(app, 'Journal.md'), '# App journal\n');
    const list = await listTemplates(root, null, app);
    expect(list.map((t) => t.name).sort()).toEqual(['Journal', 'Meeting']);
    expect((await findTemplate(root, null, 'Meeting', app))!.text).toContain('Workspace meeting');
    const j = (await findTemplate(root, null, 'journal', app))!;
    expect(j.abs).toBe(path.join(app, 'Journal.md'));
    expect(j.text).toContain('App journal');
    expect((await listTemplates(root, null)).map((t) => t.name)).toEqual(['Meeting']);
  });
});
