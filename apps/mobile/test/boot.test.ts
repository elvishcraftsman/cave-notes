// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { createRequire } from 'node:module';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { startWebWorker } from '@cave-notes/service/web-worker-core';

// The shared window, started through the Android deps exactly as boot.tsx does, against a stand-in for the phone's storage
// (the plugin over a temporary folder) and the service running behind a message channel. It catches the startup calls the
// window makes that this platform does not answer.

const h = vi.hoisted(() => ({ plugin: null as unknown, wasm: null as Uint8Array | null }));
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => ((h.plugin as Record<string, (...x: unknown[]) => unknown>)[k] as (...x: unknown[]) => unknown)(...a) }),
  Capacitor: { convertFileSrc: (u: string) => u.replace('file://', 'https://localhost/_capacitor_file_') },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => undefined }), exitApp: async () => undefined, minimizeApp: async () => undefined } }));

const require = createRequire(import.meta.url);
let tmp = '';
let ws = '';

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  private port: import('node:worker_threads').MessagePort;
  private stop: () => void;
  constructor() {
    const ch = new MessageChannel();
    this.stop = startWebWorker(ch.port2 as never, { initSqlite: () => sqlite3InitModule(), snapshotEveryMs: 600_000 });
    this.port = ch.port1;
    this.port.onmessage = (e: { data: unknown }) => this.onmessage?.(e);
  }
  postMessage(m: unknown): void {
    this.port.postMessage(m);
  }
  addEventListener(): void {}
  terminate(): void {
    this.stop();
    this.port.close();
  }
}

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cave-boot-'));
  ws = `${tmp}/Notes`;
  await fsp.mkdir(`${ws}/.cave-notes`, { recursive: true });
  await fsp.mkdir(`${ws}/Projects`, { recursive: true });
  await fsp.writeFile(`${ws}/Home.md`, '# Home\nWelcome to the notes. See [[Projects]].\n');
  await fsp.writeFile(`${ws}/Projects.md`, '# Projects\nThe alpha project runs quickly.\n');
  await fsp.writeFile(`${ws}/Projects/Alpha.md`, '# Alpha\nDetails about alpha.\n');
  const { createFakePlugin } = await import('./fakePlugin');
  h.plugin = createFakePlugin({ files: `${tmp}/app-files`, cache: `${tmp}/app-cache` });
  h.wasm = new Uint8Array(await fsp.readFile(require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm')));
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', async () => ({ arrayBuffer: async () => h.wasm!.buffer.slice(h.wasm!.byteOffset, h.wasm!.byteOffset + h.wasm!.byteLength) }));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined); // a worker may still be saving its index
});

describe('the shared window on the Android deps', () => {
  it('starts, opens a workspace through the service, shows its pages, and finds text', async () => {
    const { createAndroidDeps } = await import('../src/androidApp');
    const { Controller } = await import('../../desktop/src/renderer/controller');
    const { deps: real } = await createAndroidDeps();
    // note every platform call that was answered "not available on this device"
    const unsupported = new Set<string>();
    const deps = {
      ...real,
      main: new Proxy(real.main, {
        get: (target, k: string) => async (...a: unknown[]) => {
          try {
            return await (target as never as Record<string, (...x: unknown[]) => Promise<unknown>>)[k]!(...a);
          } catch (e) {
            if ((e as { code?: string }).code === 'UNSUPPORTED') unsupported.add(k);
            throw e;
          }
        },
      }),
    };
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '));
    try {
      const ctl = new Controller(deps);
      await ctl.init();
      await ctl.openFolder(ws);
      await vi.waitFor(() => expect(ctl.tabs.value.length).toBe(1), { timeout: 15_000 });
      const settings = await deps.main.getSettings();
      expect(settings.recent).toContain(ws);
      // the page tree came through the worker
      const api = deps.wsFor(ws);
      expect((await api.listChildren(null)).map((i) => i.path).sort()).toEqual(['Home.md', 'Projects.md']);
      await vi.waitFor(async () => expect((await api.search('alpha')).results.length).toBeGreaterThan(0), { timeout: 15_000 });
      // an image path in a page turns into an address the WebView can load
      const url = (ctl as unknown as { assetUrlFor(p: string, href: string): string | null }).assetUrlFor('Projects/Alpha.md', '../pic one.png');
      expect(url).toBe(`https://localhost/_capacitor_file_${ws}/pic%20one.png`);
      await ctl.openPage('Projects/Alpha.md');
      await vi.waitFor(() => expect(ctl.current.value?.path).toBe('Projects/Alpha.md'), { timeout: 10_000 });
      // what the window asked of the platform and was told "not here" is listed, so a startup call that matters cannot hide
      console.log('UNSUPPORTED CALLS:', JSON.stringify([...unsupported]));
      console.log('CONSOLE ERRORS:', JSON.stringify(errors.slice(0, 5)));
      expect([...unsupported]).toEqual([]);
    } finally {
      console.error = orig;
    }
  }, 60_000);
});
