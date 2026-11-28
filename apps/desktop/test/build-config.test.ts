import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build file, no types
import { workerExternal } from '../build-config.mjs';

const packagesDir = path.resolve(__dirname, '../../../packages');

describe('the worker bundle', () => {
  it('bundles the TypeScript packages and leaves only plain JavaScript ones to Node', () => {
    const external = workerExternal as string[];
    expect(external).toContain('better-sqlite3');
    for (const dir of fs.readdirSync(packagesDir)) {
      const pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8')) as { name: string; main?: string };
      if (!pkg.name.startsWith('@cave-notes/core-')) continue;
      const isTs = /\.tsx?$/.test(pkg.main ?? '');
      // Node cannot load a .ts package (its imports have no extensions), so it must not be left external
      expect(external.includes(pkg.name), `${pkg.name} (${pkg.main})`).toBe(!isTs);
    }
  });
});

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { cjsMeta } from '../build-config.mjs';

it('a CommonJS bundle can use import.meta.url at load time (main.cjs bundles packages that do)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-cjs-'));
  writeFileSync(join(dir, 'entry.js'), "export const url = new URL('./sandbox-worker.js', import.meta.url).href;\n");
  await build({ entryPoints: [join(dir, 'entry.js')], outfile: join(dir, 'out.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', ...cjsMeta });
  const out = createRequire(import.meta.url)(join(dir, 'out.cjs')) as { url: string };
  expect(out.url).toMatch(/^file:\/\/.*\/sandbox-worker\.js$/);
});
