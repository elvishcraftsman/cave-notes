// Which packages the worker bundle leaves out of itself (they load from node_modules at run time, as plain Node ESM).
// Only plain-JavaScript packages may be listed: TypeScript ones (core-export, with extensionless imports) cannot be loaded by Node
// as they are and must be bundled. test/build-config.test.ts checks this against the packages' `main` files.
import { readdirSync, readFileSync } from 'node:fs';

const packages = new URL('../../packages/', import.meta.url);

/** every workspace package whose entry file is plain JavaScript */
export const plainJsPackages = readdirSync(packages, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => JSON.parse(readFileSync(new URL(`${d.name}/package.json`, packages), 'utf8')))
  // the platform package is external too, so the worker and the core packages share one copy (and one setFs)
  .filter((p) => typeof p.main === 'string' && p.main.endsWith('.js') && (p.name.startsWith('@cave-notes/core-') || p.name === '@cave-notes/platform'))
  .map((p) => p.name);

export const workerExternal = ['better-sqlite3', ...plainJsPackages];
