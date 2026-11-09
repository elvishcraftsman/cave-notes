import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

let root: string;
let svc: WorkspaceService;

const write = async (rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
};
const events: Array<{ event: string; payload: unknown }> = [];
const settle = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (events.some((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the index did not become ready');
};

beforeEach(async () => {
  events.length = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-src-'));
  await write('Tasks.md', '---\nchildren:\n  priority:\n  area: home\n---\n# Tasks\n');
  await write('Tasks/Wash.md', '---\nstatus: open\n---\n# Wash\n');
  svc = new WorkspaceService((event: string, payload: unknown) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
  await svc.openWorkspace(root);
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('attribute sources', () => {
  it('says where each attribute of a page is set', async () => {
    await settle();
    const list = await svc.attributeSources('Tasks/Wash.md');
    const by = Object.fromEntries(list.map((a) => [a.key, a]));
    expect(by['status']?.source).toEqual({ kind: 'page' });
    expect(by['area']).toMatchObject({ value: 'home', source: { kind: 'children', page: 'Tasks.md' } });
    expect(by['priority']?.source).toEqual({ kind: 'children', page: 'Tasks.md' });
    // the page's own come first
    expect(list[0]!.source.kind).toBe('page');
  });
});

describe('names typed for new pages', () => {
  it('leaves the question mark and trailing dot out of the file name and keeps them in the title', async () => {
    await settle();
    const a = await svc.createPage(null, 'Why not?');
    expect(a).toBe('Why not.md');
    expect((await svc.readPage('Why not.md')).text).toContain('# Why not?');
    const b = await svc.createPage(null, 'Draft v2.');
    expect(b).toBe('Draft v2.md');
    expect((await svc.readPage('Draft v2.md')).text).toContain('# Draft v2.');
  });
});
