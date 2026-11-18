import { afterEach, describe, expect, it } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createMemFs } from '@cave-notes/platform/memfs';
import { resetFs } from '@cave-notes/platform';
import { createWebWorkerHost, type WebWorkerHost } from '../src/web-host';
import { startWebWorker } from '../src/web-worker-core';

// The service as the Android app runs it: in a worker that has no file system and no native SQLite of its own. Here the worker
// side runs in this process, joined to the "page" side by a real MessageChannel (so messages are structured-cloned exactly as
// between a page and a Web Worker), with an in-memory file system standing in for the phone's storage.

const NOTES: Record<string, string> = {
  '/ws/Home.md': '---\nstatus: open\n---\n# Home\nWelcome. See [[Projects]].\n',
  '/ws/Home/Ideas.md': '# Ideas\nRunning thoughts about cafés.\n',
  '/ws/Projects.md': '# Projects\nBack to [[Home]].\n',
  '/ws/Projects/Alpha.md': '# Alpha\nThe alpha project runs quickly.\n',
};

async function phone() {
  const mem = createMemFs();
  await mem.mkdir('/ws/Home', { recursive: true });
  await mem.mkdir('/ws/Projects', { recursive: true });
  for (const [p, text] of Object.entries(NOTES)) await mem.writeFile(p, text);
  return mem;
}

let stops: Array<() => void> = [];
let hosts: WebWorkerHost[] = [];
afterEach(() => {
  for (const h of hosts) h.terminate();
  for (const s of stops) s();
  hosts = [];
  stops = [];
  resetFs();
});

async function start(mem: ReturnType<typeof createMemFs>, extra: { snapshotAfterIndexMs?: number } = {}): Promise<WebWorkerHost> {
  const channel = new MessageChannel();
  const stop = startWebWorker(channel.port2 as never, { initSqlite: () => sqlite3InitModule(), snapshotEveryMs: 60_000, ...extra });
  const host = createWebWorkerHost({
    worker: Object.assign(channel.port1, { terminate: () => channel.port1.close() }) as never,
    fs: mem as never,
    init: { host: { tmpdir: '/cache', hostname: 'Test phone', cpuCount: 4 } },
  });
  stops.push(() => {
    stop();
    channel.port2.close();
  });
  hosts.push(host);
  await host.ready;
  return host;
}

/** Open a workspace and wait until the background indexing has finished (the app shows the tree at once and search fills in). */
async function openAndIndex(host: WebWorkerHost, root = '/ws') {
  const indexed = new Promise<void>((resolve) => {
    const off = host.onEvent((event, payload) => {
      if (event === 'index:status' && (payload as { state?: string }).state === 'ready') {
        off();
        resolve();
      }
    });
  });
  const info = await host.api.openWorkspace(root, { dataDir: '/data' });
  await indexed;
  return info;
}

describe('the service in a worker, over messages', () => {
  it('opens a workspace, lists the tree, reads and saves a page, and searches', async () => {
    const mem = await phone();
    const host = await start(mem);
    const info = await openAndIndex(host);
    expect(info.root).toBe('/ws');

    const top = await host.api.listChildren(null);
    expect(top.map((i) => i.path).sort()).toEqual(['Home.md', 'Projects.md']);

    const page = await host.api.readPage('Home.md');
    expect(page.text).toContain('Welcome');
    expect(page.hash).toMatch(/^[0-9a-f]{40}$/);

    const saved = await host.api.writePage('Home.md', `${page.text}\nA new line about cafés.\n`, page.hash);
    expect(saved).toBeTruthy();
    expect(await mem.readFile('/ws/Home.md', 'utf8')).toContain('A new line about cafés.');

    const hits = await host.api.search('cafe');
    expect(hits.results.map((r) => r.path).sort()).toEqual(['Home.md', 'Home/Ideas.md']);
    expect((await host.api.search('alpha')).results[0]?.path).toBe('Projects/Alpha.md');
  });

  it('reports a missing folder as the service would, with its code', async () => {
    const host = await start(await phone());
    await expect(host.api.openWorkspace('/nowhere', { dataDir: '/data' })).rejects.toMatchObject({ code: 'NOT_A_FOLDER' });
  });

  it('saves the index soon after indexing finishes, without waiting for the app to close or go to the background', async () => {
    const mem = await phone();
    const host = await start(mem, { snapshotAfterIndexMs: 20 });
    await openAndIndex(host);
    // the app is never told to save and the workspace is not closed (a phone can stop it at any moment)
    let size = 0;
    for (let i = 0; i < 100 && size === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      size = await mem.stat('/data/index.db').then((s) => s.size, () => 0);
    }
    expect(size).toBeGreaterThan(8 * 1024);
  });

  it('saves the search index to storage when the workspace closes, and a later start restores it', async () => {
    const mem = await phone();
    const first = await start(mem);
    await openAndIndex(first);
    await first.api.closeWorkspace();
    await first.saveIndex(); // waits for the index to finish closing and reach storage
    const snapshot = await mem.stat('/data/index.db');
    expect(snapshot.size).toBeGreaterThan(8 * 1024);

    // a new worker (the app was restarted): it must read the snapshot instead of starting from nothing
    const reads: string[] = [];
    const watching = new Proxy(mem, { get: (t, k: string) => (k === 'readFile' ? async (p: string, ...rest: unknown[]) => (reads.push(p), (t as never as Record<string, (...a: unknown[]) => Promise<unknown>>)[k]!(p, ...rest)) : (t as never)[k]) });
    const second = await start(watching as never);
    await openAndIndex(second);
    expect(reads).toContain('/data/index.db');
    expect((await second.api.search('alpha')).results[0]?.path).toBe('Projects/Alpha.md');
  });

  it('opens from the saved index at once, says it is stale, and brings the open pages up to date before the rest', async () => {
    const mem = await phone();
    const first = await start(mem);
    await openAndIndex(first);
    await first.api.closeWorkspace();
    await first.saveIndex();
    // changed while the app was closed (a sync tool): the saved index does not know
    await mem.writeFile('/ws/Projects/Beta.md', '# Beta\nZebrafish arrived from the desktop.\n');
    await mem.writeFile('/ws/Projects/Alpha.md', '# Alpha\nQuokka arrived from the desktop.\n');

    const second = await start(mem);
    const events: Array<{ state?: string; stale?: boolean }> = [];
    second.onEvent((event, payload) => {
      if (event === 'index:status') events.push(payload as { state?: string; stale?: boolean });
    });
    const info = await second.api.openWorkspace('/ws', { dataDir: '/data', deferIndexing: true });
    expect(info.stale).toBe(true);
    // usable from the saved index, which still has the old text
    expect((await second.api.search('alpha')).results[0]?.path).toBe('Projects/Alpha.md');
    expect((await second.api.search('zebrafish')).results).toHaveLength(0);
    // the page open in a tab is brought up to date first; the rest is still as it was
    await second.api.prioritizePages(['Projects/Beta.md']);
    expect((await second.api.search('zebrafish')).results[0]?.path).toBe('Projects/Beta.md');
    expect((await second.api.search('quokka')).results).toHaveLength(0);
    // then the look at everything else, and the status is no longer stale
    await second.api.refreshIndex();
    expect((await second.api.search('quokka')).results[0]?.path).toBe('Projects/Alpha.md');
    expect(events[0]).toMatchObject({ state: 'ready', stale: true });
    expect(events.at(-1)).toMatchObject({ state: 'ready' });
    expect(events.at(-1)?.stale).toBeUndefined();
  });

  it('saveIndex writes the snapshot on request (the app is going to the background)', async () => {
    const mem = await phone();
    const host = await start(mem);
    await openAndIndex(host);
    expect(await mem.stat('/data/index.db').catch(() => null)).toBeNull();
    await host.saveIndex();
    expect((await mem.stat('/data/index.db')).size).toBeGreaterThan(8 * 1024);
  });

  it('an edit made outside the app is seen after a rescan', async () => {
    const mem = await phone();
    const host = await start(mem);
    await openAndIndex(host);
    await mem.writeFile('/ws/Projects/Beta.md', '# Beta\nSynced from the desktop.\n');
    await host.api.rescan();
    expect((await host.api.search('desktop')).results.map((r) => r.path)).toEqual(['Projects/Beta.md']);
  });
});
