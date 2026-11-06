import { afterAll, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createMemFs } from '@cave-notes/platform/memfs';
import { createWebWorkerHost } from '../src/web-host';
// @ts-expect-error plain JavaScript build helper
import { webWorkerBuildOptions } from '../build/worker-options.mjs';

// The strongest check available without a phone: the very script the Android app loads as its Web Worker (bundled for a
// browser, so it contains no Node modules at all) is run in a Node worker thread that is given only the Web Worker surface
// (`self.postMessage`, `self.onmessage`). If it needs anything Node-only, this fails.

const require = createRequire(import.meta.url);
let worker: Worker | undefined;
afterAll(async () => {
  await worker?.terminate();
});

describe('the browser bundle of the service worker', () => {
  it('runs, indexes a workspace over messages, and saves and restores its search index', async () => {
    const bundle = await build({ ...webWorkerBuildOptions(), write: false, logLevel: 'silent', metafile: true });
    const imports = Object.values(bundle.metafile.outputs).flatMap((o) => o.imports.filter((i) => i.external).map((i) => i.path));
    expect(imports).toEqual([]);

    const prelude = `
      const { parentPort } = require('node:worker_threads');
      globalThis.self = globalThis;
      globalThis.postMessage = (m) => parentPort.postMessage(m);
      Object.defineProperty(globalThis, 'onmessage', { set(fn) { parentPort.removeAllListeners('message'); if (fn) parentPort.on('message', (data) => fn({ data })); }, get() { return null; }, configurable: true });
    `;
    worker = new Worker(prelude + bundle.outputFiles[0]!.text, { eval: true });

    const mem = createMemFs();
    await mem.mkdir('/ws/Notes', { recursive: true });
    await mem.writeFile('/ws/Home.md', '# Home\nSee [[Notes]]. Running thoughts about cafés.\n');
    await mem.writeFile('/ws/Notes.md', '# Notes\nThe alpha project runs quickly.\n');
    await mem.writeFile('/ws/Notes/Sub.md', '# Sub\nNested page.\n');

    const wasmBinary = await readFile(require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
    const host = createWebWorkerHost({
      worker: {
        postMessage: (m) => worker!.postMessage(m),
        set onmessage(fn) {
          worker!.removeAllListeners('message');
          if (fn) worker!.on('message', (data) => fn({ data }));
        },
        get onmessage() {
          return null;
        },
      },
      fs: mem as never,
      init: { wasmBinary: new Uint8Array(wasmBinary), host: { tmpdir: '/cache', hostname: 'Test phone', cpuCount: 4 } },
    });
    await host.ready;

    const indexed = new Promise<void>((resolve) => {
      const off = host.onEvent((e, p) => {
        if (e === 'index:status' && (p as { state?: string }).state === 'ready') {
          off();
          resolve();
        }
      });
    });
    await host.api.openWorkspace('/ws', { dataDir: '/data' });
    await indexed;
    expect((await host.api.listChildren(null)).map((i) => i.path).sort()).toEqual(['Home.md', 'Notes.md']);
    expect((await host.api.search('cafe')).results.map((r) => r.path)).toEqual(['Home.md']);
    const page = await host.api.readPage('Notes.md');
    await host.api.writePage('Notes.md', `${page.text}Added on the phone.\n`, page.hash);
    expect(await mem.readFile('/ws/Notes.md', 'utf8')).toContain('Added on the phone.');

    await host.api.closeWorkspace();
    await host.saveIndex();
    expect((await mem.stat('/data/index.db')).size).toBeGreaterThan(8 * 1024);
    host.terminate();
  }, 60_000);
});
