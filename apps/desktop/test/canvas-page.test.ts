import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

let root: string;
let svc: WorkspaceService;
const events: Array<{ event: string; payload: any }> = [];

const ready = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (events.some((e) => e.event === 'index:status' && e.payload.state === 'ready')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the index did not become ready');
};

beforeEach(async () => {
  events.length = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-cv-'));
  await fs.writeFile(path.join(root, 'Old.canvas'), '{"nodes":[{"id":"a","type":"text","text":"Grace","x":0,"y":0,"width":9,"height":9}],"edges":[]}');
  svc = new WorkspaceService((event: string, payload: any) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
  await svc.openWorkspace(root);
  await ready();
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('canvas pages', () => {
  it('a .canvas file in the workspace is a page, with the default note types', async () => {
    const info = await svc.pageInfo('Old.canvas');
    expect(info?.path).toBe('Old.canvas');
    expect(info?.title).toBe('Old');
  });

  it('a name typed with .canvas makes an empty canvas file', async () => {
    const created = await svc.createPage(null, 'Plan.canvas');
    expect(created).toBe('Plan.canvas');
    const text = (await svc.readPage('Plan.canvas')).text;
    expect(JSON.parse(text)).toEqual({ nodes: [], edges: [] });
    expect(text).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
  });

  it('a canvas is found by the words in its cards', async () => {
    const r = await svc.search('Grace', {});
    expect(r.results?.map((x: any) => x.path)).toEqual(['Old.canvas']);
  });

  it('an ordinary page is still made as Markdown', async () => {
    const created = await svc.createPage(null, 'Plain');
    expect(created).toBe('Plain.md');
    expect((await svc.readPage('Plain.md')).text).toContain('# Plain');
  });
});
