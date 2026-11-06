import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { configureLog } from '../src/shared/log';
import { WorkspaceService } from '@cave-notes/service/service';

it('logs what is on disk when a listed page cannot be read', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-diag-'));
  const logPath = path.join(dir, 'log', 'cave-notes.log');
  configureLog({ file: logPath, level: 'info', tag: 'test', mirror: false });
  await fs.mkdir(path.join(dir, 'ws'));
  await fs.writeFile(path.join(dir, 'ws', 'Real.md'), '# Real');
  const svc = new WorkspaceService(() => {}, { workers: 0 });
  await svc.openWorkspace(path.join(dir, 'ws'), { dataDir: path.join(dir, 'data') });
  const page = await svc.readPage('Gone.md');
  expect(page.exists).toBe(false);
  await svc.closeWorkspace();
  const text = await fs.readFile(logPath, 'utf8');
  expect(text).toMatch(/WARN .*readPage: ENOENT page=Gone\.md .*root-exists=true dir-exists=true .*index-knows-page=false/);
  expect(text).toContain('opening workspace root=');
  configureLog({ file: null });
  await fs.rm(dir, { recursive: true, force: true });
});
