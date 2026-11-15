// Bundles the spike page into www/: one script, one stylesheet (the desktop theme, which also styles the editor).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version) },
  loader: { '.css': 'css', '.woff2': 'file', '.woff': 'file', '.txt': 'text' },
  assetNames: 'fonts/[name]-[hash]',
});
// the service, as the one script the app starts as its Web Worker, and the SQLite WebAssembly it loads
await build({ ...webWorkerBuildOptions(), outfile: 'www/service-worker.js', sourcemap: true, logLevel: 'warning' });
await cp(require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'), 'www/sqlite3.wasm');
await cp('src/index.html', 'www/index.html');
// the documentation, as one file (the app writes it out as a folder when it is asked to show it)
const docs = {};
const walk = async (dir, rel = '') => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(`${dir}/${e.name}`, r);
    else if (/\.(md|yaml)$/.test(e.name)) docs[r] = await readFile(`${dir}/${e.name}`, 'utf8');
  }
};
await walk(new URL('../../docs', import.meta.url).pathname);
await writeFile('www/docs.json', JSON.stringify(docs));
console.log('built www/');
