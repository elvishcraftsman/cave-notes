import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineFsConformance } from '@cave-notes/platform/conformance';
import { createPluginFs } from '../src/pluginFs';
import { createFakePlugin } from './fakePlugin';

// The Android file layer must behave exactly as Node's fs does where the core code relies on it. This runs the same suite
// that Node's own fs and the in-memory fs pass, against the adapter over a stand-in for the plugin.
defineFsConformance({ describe, it, beforeEach, afterEach }, 'plugin adapter (stand-in plugin)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-pluginfs-'));
  return { fs: createPluginFs(createFakePlugin()), root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
});

describe('plugin adapter: the stat cache fed by listings', () => {
  const counting = () => {
    const real = createFakePlugin();
    const calls: Record<string, number> = {};
    const plugin = new Proxy(real, { get: (t, k: string) => (typeof (t as never)[k] === 'function' ? (...a: unknown[]) => ((calls[k] = (calls[k] ?? 0) + 1), ((t as never)[k] as (...x: unknown[]) => unknown)(...a)) : (t as never)[k]) });
    return { plugin, calls };
  };
  let root = '';
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-statcache-'));
    await fs.writeFile(`${root}/a.md`, 'aaa');
    await fs.writeFile(`${root}/b.md`, 'bb');
    await fs.mkdir(`${root}/sub`);
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('the stat calls that follow a listing are answered from it, with the right values', async () => {
    const { plugin, calls } = counting();
    const pfs = createPluginFs(plugin);
    const names = (await pfs.readdir(root)) as string[];
    expect(calls.stat ?? 0).toBeLessThanOrEqual(1); // the folder itself, once
    const before = calls.stat ?? 0;
    for (const n of names) {
      const s = (await pfs.lstat(`${root}/${n}`)) as { size: number; isDirectory(): boolean; mtimeMs: number };
      const real = await fs.stat(`${root}/${n}`);
      expect(s.isDirectory()).toBe(real.isDirectory());
      if (!real.isDirectory()) expect(s.size).toBe(real.size);
      expect(Math.abs(s.mtimeMs - real.mtimeMs)).toBeLessThan(1);
    }
    expect(calls.stat ?? 0).toBe(before);
  });

  it('a change made through the adapter, or the passing of time, makes the next stat ask again', async () => {
    let t = 1000;
    const { plugin, calls } = counting();
    const pfs = createPluginFs(plugin, { statCacheMs: 2000, now: () => t });
    await pfs.readdir(root);
    await pfs.writeFile(`${root}/a.md`, 'a much longer text than before');
    const size = ((await pfs.lstat(`${root}/a.md`)) as { size: number }).size;
    expect(size).toBe(30);
    await pfs.readdir(root);
    const n = calls.stat ?? 0;
    t += 5000;
    await pfs.lstat(`${root}/b.md`);
    expect(calls.stat ?? 0).toBeGreaterThan(n);
  });
});

describe('plugin adapter: a whole tree in one call', () => {
  let root = '';
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-tree-'));
    await fs.mkdir(`${root}/Sermons/Survival Skills`, { recursive: true });
    await fs.writeFile(`${root}/Intro.md`, 'intro');
    await fs.writeFile(`${root}/Sermons/One.md`, 'one');
    await fs.writeFile(`${root}/Sermons/Survival Skills/pic.jpg`, 'jpg');
    await fs.mkdir(`${root}/empty`);
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  const counting = () => {
    const real = createFakePlugin();
    const calls: Record<string, number> = {};
    const plugin = new Proxy(real, { get: (t, k: string) => (typeof (t as never)[k] === 'function' ? (...a: unknown[]) => ((calls[k] = (calls[k] ?? 0) + 1), ((t as never)[k] as (...x: unknown[]) => unknown)(...a)) : (t as never)[k]) });
    return { plugin, calls };
  };

  it('answers every listing and stat that follows without another call, with the right values', async () => {
    const { plugin, calls } = counting();
    let t = 1000;
    const pfs = createPluginFs(plugin, { now: () => t });
    const r = await pfs.primeTree(root);
    expect(r).toMatchObject({ count: 6, truncated: false });
    expect(calls.tree).toBe(1);
    const seen: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of (await pfs.readdir(dir, { withFileTypes: true })) as Array<{ name: string; isDirectory(): boolean }>) {
        const p = `${dir}/${e.name}`;
        seen.push(p.slice(root.length + 1));
        const s = (await pfs.lstat(p)) as { size: number; isDirectory(): boolean; mtimeMs: number };
        const real = await fs.stat(p);
        expect(s.isDirectory()).toBe(real.isDirectory());
        if (!real.isDirectory()) expect(s.size).toBe(real.size);
        expect(Math.abs(s.mtimeMs - real.mtimeMs)).toBeLessThan(1);
        if (e.isDirectory()) await walk(p);
      }
    };
    await walk(root);
    expect(seen.sort()).toEqual(['Intro.md', 'Sermons', 'Sermons/One.md', 'Sermons/Survival Skills', 'Sermons/Survival Skills/pic.jpg', 'empty']);
    expect(calls.list ?? 0).toBe(0);
    expect(calls.stat ?? 0).toBeLessThanOrEqual(1);
    t += 60_000; // later it asks again
    await pfs.readdir(root);
    expect(calls.list).toBe(1);
  });

  it('forgets it when something is written through the adapter', async () => {
    const { plugin, calls } = counting();
    const pfs = createPluginFs(plugin);
    await pfs.primeTree(root);
    await pfs.writeFile(`${root}/New.md`, 'x');
    expect(((await pfs.readdir(root)) as string[]).sort()).toEqual(['Intro.md', 'New.md', 'Sermons', 'empty']);
    expect(calls.list).toBe(1);
  });

  it('keeps nothing when the plugin cut the listing short', async () => {
    const { plugin, calls } = counting();
    const pfs = createPluginFs({ ...plugin, tree: (o: { path: string }) => plugin.tree({ ...o, limit: 2 }) } as never);
    expect((await pfs.primeTree(root)).truncated).toBe(true);
    await pfs.readdir(root);
    expect(calls.list).toBe(1);
  });
});
