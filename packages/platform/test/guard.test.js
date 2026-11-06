// Keeps the core packages portable: they may reach the operating system only through @cave-notes/platform.
// The few files below still import Node modules directly; each has a reason, and the list may only get shorter.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED = {
  'core-index/src/driver-better-sqlite3.js': 'the Node/Electron database driver (better-sqlite3 on disk); Android uses the sqlite-wasm driver',
  'core-index/src/pool.js': 'parse worker pool uses worker_threads; Android parses inline (M2)',
  'core-index/src/parse-worker.js': 'the worker side of that pool',
  'core-automation/src/js-syntax.js': 'checks a JavaScript rule with node:vm; the browser build uses js-syntax-none.js',
  'core-automation/src/sandbox.js': 'JavaScript rules run in a worker_threads sandbox; not available on Android',
  'core-automation/src/sandbox-worker.js': 'the worker side of that sandbox',
};

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(js|mjs|ts)$/.test(name) && !/conformance\.js$/.test(name)) yield full; // conformance suites are test support, loaded only by tests
  }
}

describe('core packages stay portable', () => {
  const files = [];
  for (const pkg of readdirSync(packagesDir).filter((n) => n.startsWith('core-') && n !== 'core-export')) {
    const src = join(packagesDir, pkg, 'src');
    try {
      files.push(...sources(src));
    } catch {
      /* no src */
    }
  }

  it('finds the core sources', () => assert.ok(files.length > 30));

  it('imports no node: module outside the allowlist', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(packagesDir, f);
      if (ALLOWED[rel]) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](node:[^'"]+|fs|path|crypto|os|url|worker_threads)['"]/g)) offenders.push(`${rel}: ${m[1]}`);
    }
    assert.deepEqual(offenders, []);
  });

  it('uses no Node globals that a WebView lacks', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(packagesDir, f);
      if (ALLOWED[rel]) continue;
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/\b(Buffer\.|process\.(?!env\.NODE_ENV))/g)) offenders.push(`${rel}: ${m[1]}`);
    }
    assert.deepEqual(offenders, []);
  });

  it("does not decode bytes with Buffer-only methods (a plain byte array has no toString('utf8'))", () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(packagesDir, f);
      if (ALLOWED[rel]) continue;
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/\.toString\(\s*['"](utf-?8|hex|base64|latin1|binary)['"]/g)) offenders.push(`${rel}: ${m[0]}`);
    }
    assert.deepEqual(offenders, []);
  });

  it('every allowlisted file still exists (remove entries as files are cleaned up)', () => {
    const present = new Set(files.map((f) => relative(packagesDir, f)));
    for (const rel of Object.keys(ALLOWED)) assert.ok(present.has(rel), `${rel} is allowlisted but gone`);
  });
});
