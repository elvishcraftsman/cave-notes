import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

let svc: WorkspaceService | null = null;
afterEach(async () => {
  await svc?.closeWorkspace();
  svc = null;
});

async function open(files: Record<string, string>): Promise<WorkspaceService> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ind-'));
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(root, n), t);
  let done!: () => void;
  const ready = new Promise<void>((r) => (done = r));
  svc = new WorkspaceService((event, payload) => {
    if (event === 'index:status' && (payload as { state: string }).state === 'ready') done();
  }, { workers: 0, watchDebounceMs: 60 });
  await svc.openWorkspace(root, { dataDir: path.join(root, '.data'), notes: { exts: ['.md'], create: '.md' } });
  await ready;
  return svc;
}

describe('page indicators', () => {
  it('lists the indicator text of a page, and nothing for a page that ignores indicators', async () => {
    const s = await open({
      'A.md': '---\nindicatorText: Check the dates\n---\n# A\n',
      'B.md': '---\nindicatorText: Hidden one\nignoreIndicators: true\n---\n# B\n',
      'C.md': '# C\n',
    });
    const items = (await s.listChildren(null)) as Array<{ name: string; indicator?: string; indicatorsIgnored?: boolean }>;
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by.A!.indicator).toBe('Check the dates');
    expect(by.B!.indicator).toBeUndefined();
    expect(by.B!.indicatorsIgnored).toBe(true);
    expect(by.C!.indicator).toBeUndefined();
  });

  it('dismissing (removing indicatorText) and ignoring (ignoreIndicators) change what the tree shows', async () => {
    const s = await open({ 'A.md': '---\nindicatorText: Look here\n---\n# A\n' });
    const get = async () => ((await s.listChildren(null)) as Array<{ indicator?: string; indicatorsIgnored?: boolean }>)[0]!;
    expect((await get()).indicator).toBe('Look here');
    expect(await s.setAttribute('A.md', 'ignoreIndicators', true)).toMatchObject({ ok: true });
    expect(await get()).toMatchObject({ indicatorsIgnored: true });
    expect((await get()).indicator).toBeUndefined();
    expect(await s.setAttribute('A.md', 'ignoreIndicators', null)).toMatchObject({ ok: true });
    expect((await get()).indicator).toBe('Look here');
    expect(await s.setAttribute('A.md', 'indicatorText', null)).toMatchObject({ ok: true });
    expect((await get()).indicator).toBeUndefined();
  });
});
