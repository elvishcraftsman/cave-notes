import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Build a temp workspace. `layout` maps relative paths to file content,
 * or to null for an (empty) directory.
 */
export async function tmpWorkspace(t, layout = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(layout)) {
    const p = path.join(root, ...rel.split('/'));
    if (content === null) {
      await fs.mkdir(p, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
    }
  }
  return root;
}

/** Sorted list of every entry; directories end with "/". */
export async function snapshot(root) {
  const out = [];
  async function walk(dir, rel) {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        out.push(`${r}/`);
        await walk(path.join(dir, d.name), r);
      } else {
        out.push(r);
      }
    }
  }
  await walk(root, '');
  return out.sort();
}

/** Map of every .md path -> content. */
export async function readAllMd(root) {
  const out = new Map();
  async function walk(dir, rel) {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(path.join(dir, d.name), r);
      else if (d.name.endsWith('.md')) out.set(r, await fs.readFile(path.join(dir, d.name), 'utf8'));
    }
  }
  await walk(root, '');
  return out;
}

export async function collect(iter) {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
}

export async function rejectsWith(assert, promise, code) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.name, 'TreeError');
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}
