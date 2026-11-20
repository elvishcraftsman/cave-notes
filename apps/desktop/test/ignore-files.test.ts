import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findIgnoreFiles, readGlobalIgnore, removeIgnoreFile, writeIgnoreFile } from '../src/main/ignoreFiles';
import { configCreateExt } from '@cave-notes/service/config-folder';

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-files-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('.caveignore files in the settings', () => {
  it('lists the computer\'s and the workspace\'s even when they do not exist, and finds the others', () => {
    const app = tmp();
    const ws = tmp();
    const outside = tmp();
    fs.mkdirSync(path.join(ws, 'sub/deeper'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'sub/deeper/.caveignore'), '*.tmp\n');
    fs.writeFileSync(path.join(outside, '.caveignore'), 'old\n');
    const list = findIgnoreFiles({ appConfigDir: app, workspaceRoot: ws, scanRoots: [], extraFolders: [outside] });
    expect(list[0]).toMatchObject({ scope: 'computer', exists: false, file: path.join(app, '.caveignore') });
    expect(list[1]).toMatchObject({ scope: 'workspace', exists: false, file: path.join(ws, '.caveignore') });
    const rest = list.slice(2);
    expect(rest.map((f) => f.file).sort()).toEqual([path.join(ws, 'sub/deeper/.caveignore'), path.join(outside, '.caveignore')].sort());
    expect(rest.find((f) => f.file.startsWith(ws))).toMatchObject({ scope: 'folder', insideWorkspace: true, text: '*.tmp\n' });
    expect(rest.find((f) => f.file.startsWith(outside))?.insideWorkspace).toBeUndefined();
  });

  it('writes, reads and removes only files called .caveignore', () => {
    const app = tmp();
    const file = path.join(app, '.caveignore');
    writeIgnoreFile(file, 'build\n');
    expect(readGlobalIgnore(app)).toBe('build\n');
    removeIgnoreFile(file);
    expect(readGlobalIgnore(app)).toBeNull();
    expect(() => writeIgnoreFile(path.join(app, 'notes.md'), 'x')).toThrow();
    expect(() => removeIgnoreFile('relative/.caveignore')).toThrow();
  });
});

describe('new files in a config folder', () => {
  it('are YAML except inside templates', () => {
    expect(configCreateExt(null)).toBe('.yaml');
    expect(configCreateExt('plugins')).toBe('.yaml');
    expect(configCreateExt('styles')).toBe('.yaml');
    expect(configCreateExt('other/folder')).toBe('.yaml');
    expect(configCreateExt('templates')).toBe('.md');
    expect(configCreateExt('templates/Meeting.md')).toBe('.md');
  });
});
