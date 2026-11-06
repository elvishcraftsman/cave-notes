// A stand-in for the CaveFs plugin made of Node's own fs, offering exactly the plugin's primitives (and rejecting with a POSIX
// `code`, as the Java side does). It lets the adapter in pluginFs.ts be tested without a phone.
import fs from 'node:fs/promises';
import type { CaveFsPlugin } from '../src/caveFs';

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

export function createFakePlugin(dirs: { files: string; cache: string } = { files: '/tmp/files', cache: '/tmp/cache' }): CaveFsPlugin {
  return {
    async hasAccess() {
      return { granted: true };
    },
    async requestAccess() {},
    async list({ path }) {
      const names = await fs.readdir(path);
      const entries = await Promise.all(
        names.map(async (name) => {
          const s = await fs.lstat(`${path}/${name}`);
          return { name, isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
        }),
      );
      return { entries };
    },
    async tree({ path, limit = 300000 }) {
      const lines: string[] = [];
      let truncated = false;
      const walk = async (dir: string, rel: string): Promise<void> => {
        for (const name of await fs.readdir(dir)) {
          if (lines.length >= limit) {
            truncated = true;
            return;
          }
          const s = await fs.lstat(`${dir}/${name}`);
          const r = rel ? `${rel}/${name}` : name;
          lines.push(`${s.isDirectory() ? 'd' : 'f'}|${s.isDirectory() ? 0 : s.size}|${Math.trunc(s.mtimeMs)}|${r}`);
          if (s.isDirectory()) await walk(`${dir}/${name}`, r);
        }
      };
      await walk(path, '');
      return { data: lines.map((l) => `${l}\n`).join(''), count: lines.length, truncated };
    },
    async read({ path }) {
      const buf = await fs.readFile(path);
      return { text: buf.toString('utf8'), size: buf.length, mtime: (await fs.stat(path)).mtimeMs };
    },
    async write({ path, text }) {
      const tmp = `${path}.tmp-${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, path);
      const s = await fs.stat(path);
      return { size: s.size, mtime: s.mtimeMs };
    },
    async stat({ path }) {
      try {
        const s = await fs.stat(path);
        return { exists: true, isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, isDir: false, size: 0, mtime: 0 };
        throw e;
      }
    },
    async mkdir({ path, recursive }) {
      await fs.mkdir(path, { recursive: recursive === true });
    },
    async readBase64({ path }) {
      const buf = await fs.readFile(path);
      return { data: b64(buf), size: buf.length, mtime: (await fs.stat(path)).mtimeMs };
    },
    async writeBase64({ path, data, flag = 'w' }) {
      const bytes = Buffer.from(data, 'base64');
      if (flag === 'wx') await fs.writeFile(path, bytes, { flag: 'wx' });
      else if (flag === 'a') await fs.appendFile(path, bytes);
      else {
        const tmp = `${path}.tmp-${Math.random().toString(36).slice(2)}`;
        await fs.writeFile(tmp, bytes);
        await fs.rename(tmp, path);
      }
      const s = await fs.stat(path);
      return { size: s.size, mtime: s.mtimeMs };
    },
    async rename({ from, to }) {
      await fs.rename(from, to);
    },
    async remove({ path }) {
      const s = await fs.lstat(path);
      if (s.isDirectory()) await fs.rmdir(path);
      else await fs.unlink(path);
    },
    async copyFile({ from, to, exclusive }) {
      await fs.copyFile(from, to, exclusive ? 1 : 0);
    },
    async appPaths() {
      return dirs;
    },
    async realpath({ path }) {
      return { path: await fs.realpath(path) };
    },
  };
}
