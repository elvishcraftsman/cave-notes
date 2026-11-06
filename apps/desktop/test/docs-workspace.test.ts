import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

const DOCS = path.resolve(__dirname, '../../../docs');
let svc: WorkspaceService | null = null;
let ready: Promise<void>;

async function open(): Promise<WorkspaceService> {
  let done!: () => void;
  ready = new Promise((r) => (done = r));
  svc = new WorkspaceService((event, payload) => {
    if (event === 'index:status' && (payload as { state: string }).state === 'ready') done();
  }, { workers: 0, watchDebounceMs: 60 });
  const info = await svc.openWorkspace(DOCS, { docs: true, dataDir: path.join(DOCS, '..', 'node_modules', '.docs-test-data'), notes: { exts: ['.md'], create: '.md' } });
  expect(info).toMatchObject({ name: 'Documentation', docs: true, config: true });
  await ready;
  return svc;
}

afterEach(async () => {
  await svc?.closeWorkspace();
  svc = null;
});

describe('the built-in documentation workspace', () => {
  it('opens the Introduction and resolves its links to the other pages', async () => {
    const s = await open();
    const page = (await s.readPage('Introduction.md')) as { exists: boolean; text: string };
    expect(page.exists).toBe(true);
    const targets = [...page.text.matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => m[1]!);
    expect(targets.length).toBeGreaterThan(3);
    for (const t of targets) {
      const r = await s.resolveLink({ syntax: 'md', target: t }, 'Introduction.md');
      expect(r, t).toMatchObject({ kind: 'page', status: 'ok', path: t });
    }
  });

  it('can be searched', async () => {
    const s = await open();
    const r = (await s.search('conflict')) as { results?: unknown[] } | unknown[];
    expect((Array.isArray(r) ? r : r.results ?? []).length).toBeGreaterThan(0);
  });

  it('refuses every change', async () => {
    const s = await open();
    for (const [method, args] of [['writePage', ['Introduction.md', 'x', null]], ['createPage', [null, 'New']], ['planMove', ['attributes.md', null, 'Other']]] as const) {
      await expect(s.call(method, [...args])).rejects.toMatchObject({ code: 'READ_ONLY' });
    }
  });
});
