import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, findUpdate, installUpdate, looksLikeAppImage, parseVersion, pickAsset, sourceRequest, UpdateError, variantOf } from '../src/main/updater';
import { UpdateManager, CHECK_EVERY_MS, RETRY_AFTER_MS } from '../src/main/update-manager';

const asset = (name: string, extra: object = {}) => ({ name, browser_download_url: `https://example.org/dl/${name}`, size: 123, ...extra });
const release = (tag: string, names: string[]) => ({ tag_name: tag, html_url: 'https://example.org/rel', assets: names.map((n) => asset(n)) });
const json = (data: unknown, status = 200) => async () => ({ ok: status < 400, status, json: async () => data, headers: { get: () => null }, body: null });

describe('versions', () => {
  it('reads and compares them', () => {
    expect(parseVersion('v1.2.3')?.nums).toEqual([1, 2, 3, 0]);
    expect(parseVersion('Cave_Notes-0.10.2-x86_64.AppImage')?.nums).toEqual([0, 10, 2, 0]);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-rc1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
  });
  it('knows the runtime a build has', () => {
    expect(variantOf('Cave_Notes-0.1.0-x86_64.AppImage')).toBe('fuse2');
    expect(variantOf('Cave_Notes-0.1.0-x86_64-uruntime.AppImage')).toBe('uruntime');
    expect(variantOf('whatever.AppImage', 'type2\n')).toBe('type2');
  });
});

describe('where to look', () => {
  it('turns the address into a request', () => {
    expect(sourceRequest('').url).toBe('https://api.github.com/repos/elvishcraftsman/cave-notes/releases/latest');
    expect(sourceRequest('https://github.com/a/b.git')).toEqual({ kind: 'github', url: 'https://api.github.com/repos/a/b/releases/latest' });
    expect(sourceRequest('https://example.org/cave.json').kind).toBe('json');
    expect(sourceRequest('https://example.org/x/Cave_Notes-1.0.0-x86_64.AppImage').kind).toBe('file');
    expect(() => sourceRequest('ftp://example.org/x')).toThrow(UpdateError);
    expect(() => sourceRequest('http://example.org/x.json')).toThrow(/https/);
    expect(() => sourceRequest('not an address')).toThrow(UpdateError);
  });
  it('picks the build with the same runtime', () => {
    const names = ['Cave_Notes-0.2.0-x86_64.AppImage', 'Cave_Notes-0.2.0-x86_64-uruntime.AppImage', 'Cave_Notes-0.2.0-x86_64.AppImage.zsync', 'Cave_Notes-0.2.0-aarch64.AppImage'];
    const list = names.map((n) => asset(n));
    expect(pickAsset(list, 'fuse2', 'x64')?.name).toBe('Cave_Notes-0.2.0-x86_64.AppImage');
    expect(pickAsset(list, 'uruntime', 'x64')?.name).toBe('Cave_Notes-0.2.0-x86_64-uruntime.AppImage');
    expect(pickAsset(list, 'type2', 'x64')).toBeNull();
    expect(pickAsset(list, 'fuse2', 'arm64')?.name).toBe('Cave_Notes-0.2.0-aarch64.AppImage');
  });
  it('takes a checksum GitHub gives', () => {
    const sha = 'a'.repeat(64);
    expect(pickAsset([asset('Cave_Notes-1.0.0-x86_64.AppImage', { digest: `sha256:${sha}` })], 'fuse2', 'x64')?.sha256).toBe(sha);
  });
});

describe('finding an update', () => {
  const base = { current: '0.1.0', source: '', variant: 'fuse2' as const, arch: 'x64' };
  it('offers a newer release', async () => {
    const o = await findUpdate({ ...base, fetch: json(release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage'])) });
    expect(o?.version).toBe('0.2.0');
    expect(o?.url).toContain('Cave_Notes-0.2.0-x86_64.AppImage');
  });
  it('offers nothing when this is the newest', async () => {
    expect(await findUpdate({ ...base, fetch: json(release('v0.1.0', ['Cave_Notes-0.1.0-x86_64.AppImage'])) })).toBeNull();
    expect(await findUpdate({ ...base, current: '0.3.0', fetch: json(release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage'])) })).toBeNull();
  });
  it('says so when a newer release has no build for this one', async () => {
    await expect(findUpdate({ ...base, variant: 'type2', fetch: json(release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage'])) })).rejects.toThrow(/no AppImage for this build/);
  });
  it('takes the newest of a list, skipping drafts and pre-releases', async () => {
    const list = [{ ...release('v0.4.0', ['Cave_Notes-0.4.0-x86_64.AppImage']), prerelease: true }, release('v0.3.0', ['Cave_Notes-0.3.0-x86_64.AppImage']), { ...release('v0.5.0', ['Cave_Notes-0.5.0-x86_64.AppImage']), draft: true }, release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage'])];
    expect((await findUpdate({ ...base, source: 'https://example.org/releases.json', fetch: json(list) }))?.version).toBe('0.3.0');
  });
  it('reads a small manifest, and resolves a relative file address', async () => {
    const o = await findUpdate({ ...base, source: 'https://example.org/app/latest.json', fetch: json({ version: '1.0.0', url: 'files/Cave_Notes-1.0.0-x86_64.AppImage', sha256: 'B'.repeat(64) }) });
    expect(o?.url).toBe('https://example.org/app/files/Cave_Notes-1.0.0-x86_64.AppImage');
    expect(o?.sha256).toBe('b'.repeat(64));
  });
  it('reads the version out of a direct file address', async () => {
    const o = await findUpdate({ ...base, source: 'https://example.org/Cave_Notes-0.9.0-x86_64.AppImage', fetch: json({}) });
    expect(o?.version).toBe('0.9.0');
    await expect(findUpdate({ ...base, source: 'https://example.org/Cave.AppImage', fetch: json({}) })).rejects.toThrow(/no version/);
  });
  it('explains what went wrong', async () => {
    await expect(findUpdate({ ...base, fetch: json({}, 404) })).rejects.toThrow(/no releases/);
    await expect(findUpdate({ ...base, fetch: json({}, 403) })).rejects.toThrow(/limiting/);
    await expect(findUpdate({ ...base, source: 'https://example.org/x.json', fetch: json({ hello: 1 }) })).rejects.toThrow(/does not describe a release/);
    await expect(findUpdate({ ...base, fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } })).rejects.toThrow(/Could not reach/);
  });
});

/** an AppImage-looking file of a size the installer accepts */
function fakeAppImage(tag: string, size = 1_200_000): Buffer {
  const b = Buffer.alloc(size, 7);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02]).copy(b, 0);
  Buffer.from(tag).copy(b, 100);
  return b;
}
const stream = (buf: Buffer) => async () => {
  const res = new Response(new Uint8Array(buf), { headers: { 'content-length': String(buf.length) } });
  return { ok: true, status: 200, json: async () => ({}), headers: res.headers, body: res.body };
};

describe('putting the new file in place', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cn-upd-'));
  it('replaces the old file under the same name, keeps a copy of it, and leaves nothing else behind', async () => {
    const dir = tmp();
    const target = path.join(dir, 'Cave_Notes-0.1.0-x86_64.AppImage');
    const old = fakeAppImage('old');
    fs.writeFileSync(target, old, { mode: 0o755 });
    const fresh = fakeAppImage('new');
    const backup = path.join(dir, 'backup');
    const seen: number[] = [];
    await installUpdate({ offer: { version: '0.2.0', url: 'https://example.org/x', name: 'x', sha256: crypto.createHash('sha256').update(fresh).digest('hex') }, target, fetch: stream(fresh), backupDir: backup, onProgress: (d) => seen.push(d) });
    expect(fs.readFileSync(target).equals(fresh)).toBe(true);
    expect(fs.statSync(target).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(path.join(backup, path.basename(target))).equals(old)).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(['Cave_Notes-0.1.0-x86_64.AppImage', 'backup']);
    expect(seen.at(-1)).toBe(fresh.length);
  });
  it('throws a file away that does not match its checksum, and keeps the old one', async () => {
    const dir = tmp();
    const target = path.join(dir, 'App.AppImage');
    fs.writeFileSync(target, fakeAppImage('old'));
    await expect(installUpdate({ offer: { version: '2.0.0', url: 'https://example.org/x', name: 'x', sha256: '0'.repeat(64) }, target, fetch: stream(fakeAppImage('new')), backupDir: path.join(dir, 'b') })).rejects.toThrow(/checksum/);
    expect(fs.readFileSync(target).subarray(100, 103).toString()).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['App.AppImage']);
  });
  it('refuses something that is not an AppImage', async () => {
    const dir = tmp();
    const target = path.join(dir, 'App.AppImage');
    fs.writeFileSync(target, fakeAppImage('old'));
    await expect(installUpdate({ offer: { version: '2.0.0', url: 'https://example.org/x', name: 'x' }, target, fetch: stream(Buffer.alloc(2_000_000, 1)), backupDir: path.join(dir, 'b') })).rejects.toThrow(/not an AppImage/);
    expect(looksLikeAppImage(fakeAppImage('x'))).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['App.AppImage']);
  });
  it('refuses a download that stops short', async () => {
    const dir = tmp();
    const target = path.join(dir, 'App.AppImage');
    fs.writeFileSync(target, fakeAppImage('old'));
    const full = fakeAppImage('new', 3_000_000);
    const short = async () => {
      const res = new Response(new Uint8Array(full.subarray(0, 1_500_000)), { headers: { 'content-length': String(full.length) } });
      return { ok: true, status: 200, json: async () => ({}), headers: res.headers, body: res.body };
    };
    await expect(installUpdate({ offer: { version: '2.0.0', url: 'https://example.org/x', name: 'x' }, target, fetch: short, backupDir: path.join(dir, 'b') })).rejects.toThrow();
    expect(fs.readFileSync(target).subarray(100, 103).toString()).toBe('old');
  });
});

describe('the daily look', () => {
  function manager(over: { mode?: 'install' | 'notify' | 'off'; last?: number; version?: string; appImage?: string | null; fetchImpl?: (url: string) => Promise<unknown> } = {}) {
    let clock = 10 * CHECK_EVERY_MS;
    const settings = { updateMode: over.mode ?? 'install', updateUrl: '', lastUpdateCheck: over.last ?? 0 };
    const events: string[] = [];
    const m = new UpdateManager({
      version: over.version ?? '0.1.0',
      appImage: over.appImage === undefined ? null : over.appImage,
      variant: 'fuse2',
      backupDir: path.join(os.tmpdir(), 'cn-upd-backup'),
      settings: () => settings,
      remember: (p) => Object.assign(settings, p),
      fetch: (over.fetchImpl ?? json(release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage']))) as never,
      emit: (s) => events.push(s.phase),
      now: () => clock,
    });
    return { m, settings, events, advance: (ms: number) => (clock += ms), now: () => clock };
  }
  it('is due when a day has passed, not before, never when off', () => {
    const a = manager({ last: 0 });
    expect(a.m.due()).toBe(true);
    const b = manager();
    b.settings.lastUpdateCheck = b.now() - 3600_000;
    expect(b.m.due()).toBe(false);
    b.advance(CHECK_EVERY_MS);
    expect(b.m.due()).toBe(true);
    const c = manager({ mode: 'off' });
    expect(c.m.due()).toBe(false);
  });
  it('remembers the look, and says a newer version waits when it cannot install itself', async () => {
    const a = manager();
    const st = await a.m.check(false);
    expect(st.phase).toBe('available');
    expect(st.latest).toBe('0.2.0');
    expect(a.settings.lastUpdateCheck).toBe(a.now());
    expect(a.m.due()).toBe(false);
  });
  it('tries again after an hour when a look failed', async () => {
    const a = manager({ fetchImpl: async () => { throw new Error('offline'); } });
    expect((await a.m.check(false)).phase).toBe('error');
    expect(a.settings.lastUpdateCheck).toBe(0);
    expect(a.m.due()).toBe(false);
    a.advance(RETRY_AFTER_MS);
    expect(a.m.due()).toBe(true);
  });
  it('downloads and installs in the install mode, and only tells in the notify mode', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-upd-'));
    const target = path.join(dir, 'Cave_Notes-0.1.0-x86_64.AppImage');
    fs.writeFileSync(target, fakeAppImage('old'));
    const fresh = fakeAppImage('new');
    const fetchImpl = async (url: string) => (url.includes('api.github.com') ? json(release('v0.2.0', ['Cave_Notes-0.2.0-x86_64.AppImage']))() : stream(fresh)());
    const notify = manager({ mode: 'notify', appImage: target, fetchImpl });
    expect((await notify.m.check(false)).phase).toBe('available');
    expect(fs.readFileSync(target).subarray(100, 103).toString()).toBe('old');
    const auto = manager({ mode: 'install', appImage: target, fetchImpl });
    const st = await auto.m.check(false);
    expect(st.phase).toBe('ready');
    expect(fs.readFileSync(target).subarray(100, 103).toString()).toBe('new');
    expect(path.basename(target)).toBe('Cave_Notes-0.1.0-x86_64.AppImage');
  });
});
