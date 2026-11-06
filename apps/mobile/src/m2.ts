// Milestone 2 check page: starts the service in its Web Worker, opens a workspace through it, and shows what it costs on this phone.
// It is a measuring tool, not the app's screen (that is Milestone 3).
import { createWebWorkerHost, type WebWorkerHost } from '@cave-notes/service/web-host';
import { CaveFs } from './caveFs';
import { createPluginFs } from './pluginFs';

export function startM2(): void {
const panel = document.createElement('details');
panel.className = 'm2';
panel.innerHTML = `
  <summary>Service check (M2)</summary>
  <div class="m2-row">
    <button id="m2-start">1 Start service</button>
    <button id="m2-open">2 Open workspace</button>
    <button id="m2-close">3 Close</button>
    <button id="m2-save">Save index</button>
  </div>
  <div class="m2-row">
    <input id="m2-q" type="text" placeholder="search words" autocapitalize="off" autocomplete="off" spellcheck="false" />
    <button id="m2-search">Search</button>
  </div>
  <pre id="m2-out" class="m2-out"></pre>`;
document.getElementById('app')!.prepend(panel);
const css = document.createElement('style');
css.textContent = `
  .m2 { padding: 0 8px; font-size: 13px; }
  .m2 summary { padding: 6px 0; }
  .m2-row { display: flex; gap: 6px; padding: 4px 0; flex-wrap: wrap; }
  .m2-row input { flex: 1; min-width: 0; padding: 8px; font-size: 14px; }
  .m2-row button { padding: 8px 10px; font-size: 13px; }
  .m2-out { max-height: 38vh; overflow: auto; white-space: pre-wrap; font-size: 12px; margin: 4px 0; padding: 6px; border: 1px solid rgba(128,128,128,.3); }
`;
document.head.append(css);

const out = document.getElementById('m2-out') as HTMLElement;
const log = (line: string): void => {
  out.textContent += `${line}\n`;
  out.scrollTop = out.scrollHeight;
};
const ms = (t0: number): string => `${Math.round(performance.now() - t0)} ms`;
const heap = (): string => {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? `${Math.round(m.usedJSHeapSize / 1048576)} MB (page heap)` : 'n/a';
};
const rootPath = (): string => (document.getElementById('m0-path') as HTMLInputElement).value.trim();
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};

let host: WebWorkerHost | null = null;
let files = '';
let opened: string | null = null;
const fsImpl = createPluginFs(CaveFs);

async function start(): Promise<void> {
  if (host) {
    log('service already running');
    return;
  }
  const t0 = performance.now();
  const paths = await CaveFs.appPaths();
  files = paths.files;
  const wasm = await (await fetch('sqlite3.wasm')).arrayBuffer();
  log(`sqlite3.wasm ${Math.round(wasm.byteLength / 1024)} KB fetched in ${ms(t0)}`);
  const worker = new Worker('service-worker.js');
  worker.addEventListener('error', (e) => log(`worker error: ${e.message}`));
  host = createWebWorkerHost({
    worker: worker as never,
    fs: fsImpl as never,
    init: { wasmBinary: new Uint8Array(wasm), host: { hostname: 'Android', tmpdir: paths.cache, cpuCount: navigator.hardwareConcurrency }, logLevel: 'info' },
  });
  host.onEvent((event, payload) => {
    if (event === 'index:status') {
      const p = payload as { state?: string; pages?: number; percent?: number };
      if (p.state === 'ready') log(`index ready: ${p.pages} pages`);
    }
  });
  await host.ready;
  log(`service ready in ${ms(t0)}`);
}

async function openWorkspace(): Promise<void> {
  if (!host) return log('start the service first');
  const root = rootPath();
  const t0 = performance.now();
  let tReady = 0;
  const ready = new Promise<void>((resolve) => {
    const off = host!.onEvent((event, payload) => {
      if (event === 'index:status' && (payload as { state?: string }).state === 'ready') {
        tReady = performance.now();
        off();
        resolve();
      }
    });
  });
  const dataDir = `${files}/index/${hash(root)}`;
  const had = await fsImpl.stat(`${dataDir}/index.db`).then(
    (s) => `${Math.round(s.size / 1024)} KB`,
    () => null,
  );
  log(`opening ${root}${had ? ` (saved index ${had})` : ' (no saved index: first build)'}`);
  const info = await host.api.openWorkspace(root, { dataDir });
  log(`opened in ${ms(t0)} (the tree can show now): ${info.name}`);
  const top = await host.api.listChildren(null);
  log(`top level: ${top.length} pages, listed at ${ms(t0)}`);
  await ready;
  log(`indexing finished at ${Math.round(tReady - t0)} ms`);
  const st = await host.api.stats();
  log(`${JSON.stringify(st)}; ${heap()}`);
  opened = root;
}

async function search(): Promise<void> {
  if (!host || !opened) return log('open a workspace first');
  const q = (document.getElementById('m2-q') as HTMLInputElement).value.trim();
  if (!q) return;
  const times: number[] = [];
  let res = await host.api.search(q);
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    res = await host.api.search(q);
    times.push(performance.now() - t);
  }
  log(`"${q}": ${res.total ?? res.results.length} hit(s); median ${Math.round(times.sort((a, b) => a - b)[2] ?? 0)} ms over 5 runs`);
  for (const r of res.results.slice(0, 5)) log(`  ${r.path}`);
}

async function saveIndex(): Promise<void> {
  if (!host) return;
  const t0 = performance.now();
  await host.saveIndex();
  const s = await fsImpl.stat(`${files}/index/${hash(rootPath())}/index.db`).catch(() => null);
  log(`index saved in ${ms(t0)}${s ? `: ${Math.round(s.size / 1024)} KB` : ''}`);
}

async function closeWorkspace(): Promise<void> {
  if (!host || !opened) return;
  const t0 = performance.now();
  await host.api.closeWorkspace();
  await host.saveIndex();
  log(`closed; index saved in ${ms(t0)}`);
  opened = null;
}

const run = (f: () => Promise<void>) => () => void f().catch((e: Error) => log(`failed: ${e.message}`));
document.getElementById('m2-start')!.onclick = run(start);
document.getElementById('m2-open')!.onclick = run(openWorkspace);
document.getElementById('m2-close')!.onclick = run(closeWorkspace);
document.getElementById('m2-save')!.onclick = run(saveIndex);
document.getElementById('m2-search')!.onclick = run(search);

}
