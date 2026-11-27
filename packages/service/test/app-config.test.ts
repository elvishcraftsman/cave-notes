import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRuleFiles, removeAppRule, removeRuleFromFile } from '../src/app-config';
import { markBuiltinRemoved, removedBuiltins, restoreBuiltins, syncBuiltins } from '../src/builtins';
import { listInstalled } from '../src/plugins';
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

/** A built-in package: its folder in `plugins/` of the shipped folder, with one automation. */
const pkg = (id: string, label: string, version = '1.0.0', log = 'hi'): Record<string, string> => ({
  [`plugins/${label}/plugin.yaml`]: `plugin:\n  id: ${id}\n  name: ${label}\n  version: ${version}\n  description: ${label}.\nautomations:\n  - automations/${id}.yaml\n`,
  [`plugins/${label}/automations/${id}.yaml`]: `rules:\n  - id: ${id}\n    on: { menu: "${label}" }\n    do:\n      - log: "${log}"\n`,
});

describe('the plugins that come with the app', () => {
  it('installs them as packages into the app config folder, once', async () => {
    const shipped = shippedWith({ ...pkg('a', 'Alpha'), ...pkg('b', 'Beta') });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    const r = await syncBuiltins(shipped, target);
    expect(r.installed.sort()).toEqual(['a', 'b']);
    expect((await syncBuiltins(shipped, target)).installed).toEqual([]);
    expect((await listInstalled(target)).map((i) => i.record.plugin)).toEqual(['a', 'b']);
    const files = await appRuleFiles(target);
    expect([...files.keys()]).toEqual(['a', 'b']);
    expect(files.get('b')).toBe('plugins/Beta/automations/b.yaml');
  });

  it('updates the files nobody changed when the app brings a newer version, and never touches one the person changed', async () => {
    const shipped = shippedWith({ ...pkg('a', 'Alpha'), ...pkg('b', 'Beta') });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    await syncBuiltins(shipped, target);
    fs.appendFileSync(path.join(target, 'plugins/Beta/automations/b.yaml'), '# mine\n');
    for (const [rel, text] of Object.entries({ ...pkg('a', 'Alpha', '1.1.0', 'new a'), ...pkg('b', 'Beta', '1.1.0', 'new b') })) fs.writeFileSync(path.join(shipped, rel), text);
    const r = await syncBuiltins(shipped, target);
    expect(r.updated.sort()).toEqual(['a', 'b']);
    expect(fs.readFileSync(path.join(target, 'plugins/Alpha/automations/a.yaml'), 'utf8')).toContain('new a');
    const mine = fs.readFileSync(path.join(target, 'plugins/Beta/automations/b.yaml'), 'utf8');
    expect(mine).toContain('# mine');
    expect(mine).not.toContain('new b');
    // the same version again changes nothing
    expect((await syncBuiltins(shipped, target)).updated).toEqual([]);
  });

  it('keeps a removed one gone until it is restored', async () => {
    const shipped = shippedWith({ ...pkg('a', 'Alpha'), ...pkg('b', 'Beta') });
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    await syncBuiltins(shipped, target);
    fs.rmSync(path.join(target, 'plugins/Alpha'), { recursive: true });
    await markBuiltinRemoved(target, 'a');
    expect((await syncBuiltins(shipped, target)).installed).toEqual([]);
    expect(await removedBuiltins(target)).toEqual(['a']);
    expect(await restoreBuiltins(shipped, target)).toBe(1);
    expect((await listInstalled(target)).map((i) => i.record.plugin)).toEqual(['a', 'b']);
  });

  it('moves from the old single files: an unchanged copy gives way, an edited one stays and is not installed twice, a deleted one stays removed', async () => {
    const shipped = shippedWith({ ...pkg('a', 'Alpha'), ...pkg('b', 'Beta'), ...pkg('c', 'Gamma') });
    const root = tmp();
    const target = path.join(root, 'app-config', '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins'), { recursive: true });
    const old = (id: string): string => plugin(id, id);
    const sha = (t: string): string => crypto.createHash('sha1').update(t).digest('hex');
    fs.writeFileSync(path.join(target, 'plugins/a.yaml'), old('a'));
    fs.writeFileSync(path.join(target, 'plugins/b.yaml'), `${old('b')}# edited\n`);
    fs.writeFileSync(path.join(root, 'app-config', 'seeded.json'), JSON.stringify({ 'plugins/a.yaml': sha(old('a')), 'plugins/b.yaml': sha(old('b')), 'plugins/c.yaml': sha(old('c')) }));
    const r = await syncBuiltins(shipped, target);
    expect(r.installed).toEqual(['a']);
    expect(fs.existsSync(path.join(target, 'plugins/a.yaml'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'plugins/b.yaml'), 'utf8')).toContain('# edited');
    expect(await removedBuiltins(target)).toEqual(['b', 'c']);
    expect(fs.existsSync(path.join(root, 'app-config', 'seeded.json'))).toBe(false);
    expect([...(await appRuleFiles(target)).keys()].sort()).toEqual(['a', 'b']);
  });

  it('removes one rule of a file with several and keeps the rest', async () => {
    const target = path.join(tmp(), 'app-config', '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugins/two.yaml'), `# mine\nrules:\n  - id: a\n    on: { plugin: "A" }\n  - id: b\n    on: { plugin: "B" }\n`);
    expect(await removeAppRule(target, 'a')).toBe(true);
    const text = fs.readFileSync(path.join(target, 'plugins/two.yaml'), 'utf8');
    expect(text).toContain('# mine');
    expect(text).toContain('id: b');
    expect(text).not.toContain('id: a');
  });

  it('skips a file that is not valid YAML', async () => {
    const target = path.join(tmp(), '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugins/bad.yaml'), 'rules: [unclosed');
    fs.writeFileSync(path.join(target, 'plugins/ok.yaml'), plugin('ok', 'Fine'));
    expect([...(await appRuleFiles(target)).keys()]).toEqual(['ok']);
  });

  it('reads the automations of an installed plugin folder as well', async () => {
    const target = path.join(tmp(), '.cave-notes');
    fs.mkdirSync(path.join(target, 'plugins/Tools/automations'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugins/Tools/.installed.json'), '{}');
    fs.writeFileSync(path.join(target, 'plugins/Tools/automations/t.yaml'), plugin('t', 'Tool'));
    expect((await appRuleFiles(target)).get('t')).toBe('plugins/Tools/automations/t.yaml');
  });
});

describe('a workspace and the plugins that come with the app', () => {
  const app = (): string => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins/a.yaml'), `rules:\n  - id: a\n    on: { plugin: \"Alpha\" }\n    do: [ { log: shipped } ]\n  - id: z\n    on: { plugin: \"Z\" }\n    do: [ { log: z } ]\n`);
    return dir;
  };
  it('has them even with no settings of its own', async () => {
    const dir = tmp();
    expect(await rulesText(dir, undefined)).toBeNull();
    const text = (await rulesText(dir, undefined, app()))!;
    expect(text).toContain('id: a');
  });
  it('lets its own rule with the same id win, and an empty rules: does not switch them off', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'rules:\n  - id: a\n    on: { plugin: "Mine" }\n');
    const base = app();
    const text = (await rulesText(dir, undefined, base))!;
    expect(text).toContain('Mine');
    expect(text).not.toContain('Alpha');
    expect(text).toContain('id: z');
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'rules: []\n');
    expect((await rulesText(dir, undefined, base))!).toContain('id: a');
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
