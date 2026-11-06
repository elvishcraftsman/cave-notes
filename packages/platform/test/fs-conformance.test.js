import { describe, it, beforeEach, afterEach } from 'node:test';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineFsConformance } from '../src/conformance.js';
import { createMemFs } from '../src/memfs.js';

const t = { describe, it, beforeEach, afterEach };

defineFsConformance(t, 'Node fs (temporary folder)', async () => {
  const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'cave-fs-'));
  return { fs: nodeFs, root, cleanup: () => nodeFs.rm(root, { recursive: true, force: true }) };
});

defineFsConformance(t, 'in-memory fs', async () => {
  const fs = createMemFs();
  await fs.mkdir('/work', { recursive: true });
  return { fs, root: '/work' };
});
