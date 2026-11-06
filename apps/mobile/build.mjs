// Bundles the spike page into www/: one script, one stylesheet (the desktop theme, which also styles the editor).
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { webWorkerBuildOptions } from '@cave-notes/service/build/worker-options';

const require = createRequire(import.meta.url);

await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });
await build({
  bundle: true,
  sourcemap: true,
  logLevel: 'warning',
  entryPoints: { app: 'src/boot.tsx' },
  outdir: 'www',
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __APP_VERSION__: JSON.stringify('android-dev') },
  loader: { '.css': 'css', '.woff2': 'file', '.woff': 'file', '.txt': 'text' },
  assetNames: 'fonts/[name]-[hash]',
});
// the service, as the one script the app starts as its Web Worker, and the SQLite WebAssembly it loads
await build({ ...webWorkerBuildOptions(), outfile: 'www/service-worker.js', sourcemap: true, logLevel: 'warning' });
await cp(require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'), 'www/sqlite3.wasm');
await cp('src/index.html', 'www/index.html');
console.log('built www/');
