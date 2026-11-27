import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePackage } from '@cave-notes/service/plugins';
import { readPluginSources } from '../src/main/pluginSource';
import { zipFiles } from '../src/main/zip';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cn-src-'));
const MANIFEST = 'plugin:\n  id: demo\n  name: Demo\n  version: 1.0.0\n  description: A demo.\nautomations:\n  - automations/a.yaml\n';
const RULES = 'rules:\n  - id: a\n    name: A\n    on: { plugin: A }\n    do: [ { log: hi } ]\n';
const w = (root: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

describe('reading what was chosen as a plugin', () => {
  it('reads a folder that is a package', () => {
    const d = tmp();
    w(d, 'plugin.yaml', MANIFEST);
    w(d, 'automations/a.yaml', RULES);
    const r = readPluginSources([d]);
    expect(r.ok && Object.keys(r.files).sort()).toEqual(['automations/a.yaml', 'plugin.yaml']);
    expect(r.ok && parsePackage(r.files).ok).toBe(true);
  });

  it('reads a zip of a package, with or without the folder around it', () => {
    const d = tmp();
    const enc = new TextEncoder();
    const inner = [{ name: 'plugin.yaml', data: enc.encode(MANIFEST) }, { name: 'automations/a.yaml', data: enc.encode(RULES) }];
    fs.writeFileSync(path.join(d, 'flat.cnplugin'), zipFiles(inner));
    fs.writeFileSync(path.join(d, 'wrapped.zip'), zipFiles(inner, 'Demo'));
    for (const f of ['flat.cnplugin', 'wrapped.zip']) {
      const r = readPluginSources([path.join(d, f)]);
      expect(r.ok && Object.keys(r.files).sort()).toEqual(['automations/a.yaml', 'plugin.yaml']);
    }
  });

  it('makes a package of loose files: a settings file, a note and a folder of notes', () => {
    const d = tmp();
    w(d, 'mine.yaml', `${RULES}schema:\n  x: { type: text }\n`);
    w(d, 'Meeting.md', '# {{title}}\n');
    w(d, 'Set/Day.md', '# {{title}}\n');
    const r = readPluginSources([path.join(d, 'mine.yaml'), path.join(d, 'Meeting.md'), path.join(d, 'Set')]);
    expect(r.ok && Object.keys(r.files).sort()).toEqual(['automations/mine.yaml', 'definitions/mine.yaml', 'plugin.yaml', 'templates/Meeting.md', 'templates/Set/Day.md']);
    expect(r.ok && parsePackage(r.files).ok).toBe(true);
  });

  it('says so when a file cannot be used or does not exist', () => {
    const d = tmp();
    w(d, 'x.png', 'x');
    const r = readPluginSources([path.join(d, 'x.png')]);
    expect(r.ok).toBe(false);
    expect(readPluginSources([path.join(d, 'nope.yaml')]).ok).toBe(false);
    expect(readPluginSources([]).ok).toBe(false);
  });
});
