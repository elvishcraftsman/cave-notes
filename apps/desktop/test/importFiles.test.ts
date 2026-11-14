import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTagged } from '@cave-notes/core-index';
import { importFromFiles, tagGlobal } from '../src/main/importFiles';
import { readZip, zipFiles } from '../src/main/zip';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
const put = (dir: string, rel: string, text: string): string => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const PLUGIN = 'rules:\n  - id: shout\n    name: Shout\n    on: { plugin: "Shout" }\n    do:\n      - transform_text: { steps: [ trim_lines ] }\n';

describe('zip reading', () => {
  it('reads what zipFiles wrote, and refuses unsafe paths', () => {
    const z = zipFiles([{ name: 'a/b.txt', data: Buffer.from('hello hello hello') }, { name: 'c.txt', data: Buffer.from('x') }]);
    expect(readZip(z).map((e) => [e.name, e.data.toString()])).toEqual([['a/b.txt', 'hello hello hello'], ['c.txt', 'x']]);
    expect(() => readZip(zipFiles([{ name: '../evil.txt', data: Buffer.from('x') }]))).toThrow(/unsafe/);
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/not a zip/);
  });
});

describe('adding from files', () => {
  it('puts a plugin file into the app folder, the workspace folder, or the workspace folder tagged !global', () => {
    const app = tmp();
    const ws = tmp();
    const src = put(tmp(), 'Shout.yaml', PLUGIN);
    expect(importFromFiles({ kind: 'plugin', where: 'app', sources: [src] }, app)).toMatchObject({ ok: true, added: ['Shout.yaml'] });
    expect(fs.existsSync(path.join(app, 'plugins', 'Shout.yaml'))).toBe(true);
    expect(importFromFiles({ kind: 'plugin', where: 'workspace', sources: [src], workspaceRoot: ws }, app).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, '.cave-notes', 'plugins', 'Shout.yaml'), 'utf8')).toBe(PLUGIN);
    expect(importFromFiles({ kind: 'plugin', where: 'global', sources: [src], workspaceRoot: ws }, app)).toMatchObject({ ok: true, added: ['Shout 2.yaml'] }); // the name was taken
    const tagged = parseTagged(fs.readFileSync(path.join(ws, '.cave-notes', 'plugins', 'Shout 2.yaml'), 'utf8'));
    expect(tagged.globalKeys).toEqual(['rules']);
    expect((tagged.value as { rules: Array<{ id: string }> }).rules[0]!.id).toBe('shout');
  });

  it('takes a plugin folder, or a zip of one, as it is', () => {
    const app = tmp();
    const src = tmp();
    put(src, 'Big/Big.md', '# readme');
    put(src, 'Big/rules.yaml', PLUGIN);
    put(src, 'Big/helper.js', '// helper');
    expect(importFromFiles({ kind: 'plugin', where: 'app', sources: [path.join(src, 'Big')] }, app).ok).toBe(true);
    expect(fs.readdirSync(path.join(app, 'plugins', 'Big')).sort()).toEqual(['Big.md', 'helper.js', 'rules.yaml']);
    const zip = path.join(tmp(), 'Pack.zip');
    fs.writeFileSync(zip, zipFiles([{ name: 'Pack.yaml', data: Buffer.from(PLUGIN) }, { name: 'Pack/notes.md', data: Buffer.from('# n') }]));
    const r = importFromFiles({ kind: 'plugin', where: 'app', sources: [zip] }, app);
    expect(r.added.sort()).toEqual(['Pack.yaml', 'Pack/notes.md']);
  });

  it('refuses something that is not a plugin, and invalid YAML', () => {
    const app = tmp();
    expect(importFromFiles({ kind: 'plugin', where: 'app', sources: [put(tmp(), 'x.yaml', 'color: red\n')] }, app).ok).toBe(false);
    expect(importFromFiles({ kind: 'plugin', where: 'app', sources: [put(tmp(), 'y.yaml', 'a: [\n')] }, app).message).toMatch(/not valid YAML/);
    expect(importFromFiles({ kind: 'plugin', where: 'workspace', sources: [put(tmp(), 'z.yaml', PLUGIN)] }, app).message).toMatch(/Open a workspace/);
  });

  it('writes export styles in the form of the place they go: bare styles in the app folder, export-style: in a workspace', () => {
    const app = tmp();
    const ws = tmp();
    const src = put(tmp(), 'Mine.yaml', 'Mine:\n  base: Clean\n  body: { font: Georgia, size: 12pt }\n');
    expect(importFromFiles({ kind: 'style', where: 'app', sources: [src] }, app).ok).toBe(true);
    expect(fs.readFileSync(path.join(app, 'styles', 'Mine.yaml'), 'utf8')).toMatch(/^Mine:/);
    expect(importFromFiles({ kind: 'style', where: 'global', sources: [src], workspaceRoot: ws }, app).ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, '.cave-notes', 'styles', 'Mine.yaml'), 'utf8');
    expect(text).toMatch(/^export-style: !global/);
    expect(parseTagged(text).globalKeys).toEqual(['export-style']);
    // a workspace file (export-style:) goes into the app folder as bare styles
    const wsFile = path.join(ws, '.cave-notes', 'styles', 'Mine.yaml');
    const app2 = tmp();
    expect(importFromFiles({ kind: 'style', where: 'app', sources: [wsFile] }, app2).ok).toBe(true);
    expect(fs.readFileSync(path.join(app2, 'styles', 'Mine.yaml'), 'utf8')).toMatch(/^Mine:/);
    expect(importFromFiles({ kind: 'style', where: 'app', sources: [put(tmp(), 'bad.yaml', 'Bad: [\n')] }, app).ok).toBe(false);
  });

  it('adds templates, or a template set, but never as !global', () => {
    const app = tmp();
    const src = tmp();
    put(src, 'Kit.md', '# readme');
    put(src, 'Kit/Brief.md', '# brief');
    expect(importFromFiles({ kind: 'template', where: 'app', sources: [path.join(src, 'Kit.md'), path.join(src, 'Kit')] }, app).added.sort()).toEqual(['Kit.md', 'Kit/Brief.md']);
    expect(importFromFiles({ kind: 'template', where: 'global', sources: [path.join(src, 'Kit.md')], workspaceRoot: tmp() }, app).ok).toBe(false);
    expect(importFromFiles({ kind: 'template', where: 'app', sources: [put(tmp(), 'a.png', 'x')] }, app).ok).toBe(false);
  });

  it('tagGlobal tags only the sections that can be shared', () => {
    const r = tagGlobal('rules:\n  - id: a\ncolor: red\nschema:\n  n: { type: number }\nfiles:\n  x: 1\n');
    expect(r.tagged).toEqual(['rules', 'schema']);
    expect(r.text).toContain('rules: !global');
  });
});
