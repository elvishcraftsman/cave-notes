// How to bundle src/web-worker.ts into the one classic script the Android app starts as a Web Worker. Shared by the app's build
// (apps/mobile/build.mjs) and by the test that runs this exact bundle, so what is tested is what ships.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export function webWorkerBuildOptions() {
  const require = createRequire(`${here}../package.json`);
  // core-md's own dependencies, resolved from where core-md sits
  const fromMd = createRequire(require.resolve('@cave-notes/core-md'));
  return {
    entryPoints: [fileURLToPath(new URL('../src/web-worker.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    // A classic script has no import.meta; sqlite-wasm builds URLs from it before looking at the wasmBinary / locateFile it is given.
    define: { 'import.meta.url': JSON.stringify('https://localhost/web-worker.js') },
    alias: {
      // Its "browser" build decodes character references with document.createElement, and a Web Worker has no document.
      // The plain JavaScript build (with its own table of names) does the same job anywhere.
      'decode-named-character-reference': fromMd.resolve('decode-named-character-reference'),
    },
  };
}
