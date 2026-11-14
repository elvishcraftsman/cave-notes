import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipFolder, crc32 } from '../src/main/zip';

describe('zip writer', () => {
  it('crc32 of "123456789" is cbf43926', () => {
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926');
  });

  it('makes an archive that unzip accepts, with the docs inside a folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipt-'));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.mkdirSync(path.join(dir, '.cave-notes'));
    fs.writeFileSync(path.join(dir, '01-a.md'), '# A\nhéllo\n'.repeat(50));
    fs.writeFileSync(path.join(dir, 'sub', '01-b.md'), '# B\n');
    fs.writeFileSync(path.join(dir, '.cave-notes', 'x.yaml'), 'font: serif\n');
    const zip = path.join(dir, '..', `zipt-${Date.now()}.zip`);
    fs.writeFileSync(zip, zipFolder(dir, 'Cave Notes Documentation'));
    let list = '';
    try {
      list = execFileSync('unzip', ['-tq', zip]).toString();
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return; // no unzip here: nothing to compare with
      throw e;
    }
    expect(list).toMatch(/No errors/);
    const names = execFileSync('unzip', ['-Z1', zip]).toString().trim().split('\n');
    expect(names).toEqual(['Cave Notes Documentation/01-a.md', 'Cave Notes Documentation/sub/01-b.md']);
    expect(execFileSync('unzip', ['-p', zip, 'Cave Notes Documentation/sub/01-b.md']).toString()).toBe('# B\n');
  });
});
