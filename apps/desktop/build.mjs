// Bundles the app into dist/: main, preload and worker with esbuild, and the renderer as one script and one stylesheet.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { workerExternal } from './build-config.mjs';

const watch = process.argv.includes('--minify');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'warning', minify: watch, target: 'node22' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  // The worker is ESM: the plain-JavaScript core packages (and native SQLite) stay external so they load from node_modules as
  // they are. core-export is TypeScript with extensionless imports, which Node cannot load, so it is bundled in.
  build({
    ...common,
    entryPoints: ['src/worker/entry.ts'],
    outfile: 'dist/worker.mjs',
    platform: 'node',
    format: 'esm',
    external: workerExternal,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  }),
  build({
    bundle: true,
    sourcemap: true,
    logLevel: 'warning',
    minify: watch,
    entryPoints: { app: 'src/renderer/main.tsx' },
    outdir: 'dist/renderer',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'css', '.woff2': 'file', '.woff': 'file', '.txt': 'text' },
    define: { __APP_VERSION__: JSON.stringify(version) },
    assetNames: 'fonts/[name]-[hash]',
  }),
  cp('src/renderer/index.html', 'dist/renderer/index.html'),
  cp('assets/fonts', 'dist/fonts', { recursive: true }),
  cp('packaging/icons', 'dist/icons', { recursive: true }),
  // licence texts that go with the app (WordNet's terms require its notice on every copy)
  cp('assets/licenses', 'dist/licenses', { recursive: true }),
]);
console.log('built dist/');
