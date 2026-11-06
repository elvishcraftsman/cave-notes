import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function tmpRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

export function ws(root) {
  const abs = (rel) => path.join(root, ...rel.split('/'));
  return {
    root,
    async write(rel, content) {
      await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
      await fs.writeFile(abs(rel), content);
    },
    async writeAll(files) {
      for (const [rel, c] of Object.entries(files)) await this.write(rel, c);
    },
    rm: (rel) => fs.rm(abs(rel), { recursive: true, force: true }),
    read: (rel) => fs.readFile(abs(rel), 'utf8'),
    /** Change mtime without changing content. */
    touch: (rel, secondsAhead = 10) => {
      const when = new Date(Date.now() + secondsAhead * 1000);
      return fs.utimes(abs(rel), when, when);
    },
  };
}

export const paths = (res) => res.results.map((r) => r.path);
