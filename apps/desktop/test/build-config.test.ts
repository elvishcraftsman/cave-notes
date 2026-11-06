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
