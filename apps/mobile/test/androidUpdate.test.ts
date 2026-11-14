import { describe, expect, it } from 'vitest';
import { AndroidUpdater, compareVersions, offerFrom, sourceUrl } from '../src/androidUpdate';

const release = (tag: string, apk = true, extra: object = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  assets: [{ name: 'Cave_Notes-x86_64.AppImage', browser_download_url: 'https://x/app.AppImage' }, ...(apk ? [{ name: 'cave-notes-debug.apk', browser_download_url: `https://x/${tag}.apk` }] : [])],
  ...extra,
});

describe('android update', () => {
  it('compares versions', () => {
    expect(compareVersions('0.9.1', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.9', '0.9.0')).toBe(0);
  });

  it('finds the newest release that has an apk, skipping drafts, prereleases and releases without one', () => {
    const offer = offerFrom([release('v0.9.3', false), release('v0.9.2'), release('v0.9.4', true, { prerelease: true }), release('v0.9.1')]);
    expect(offer).toMatchObject({ version: '0.9.2', url: 'https://x/v0.9.2.apk' });
    expect(offerFrom({ version: 'v1.2.0', url: 'https://u/a.apk' })).toEqual({ version: '1.2.0', url: 'https://u/a.apk' });
    expect(offerFrom(release('v1.0.0', false))).toBeNull();
  });

  it('turns the update address into the releases address', () => {
    expect(sourceUrl('')).toBe('https://api.github.com/repos/elvishcraftsman/cave-notes/releases/latest');
    expect(sourceUrl('https://github.com/me/notes/')).toBe('https://api.github.com/repos/me/notes/releases/latest');
    expect(sourceUrl('https://example.com/u.json')).toBe('https://example.com/u.json');
  });

  it('offers a newer version, says nothing is new otherwise, and opens the apk on install', async () => {
    const opened: string[] = [];
    let last = 0;
    const mk = (v: string, rel: unknown) =>
      new AndroidUpdater({ current: v, setting: () => '', fetchJson: async () => rel, open: (u) => opened.push(u), remember: (t) => (last = t), lastCheck: () => last, now: () => 1e12 });
    const a = mk('0.9.0', [release('v0.9.1')]);
    expect((await a.check()).phase).toBe('available');
    a.install();
    expect(opened).toEqual(['https://x/v0.9.1.apk']);
    expect(last).toBe(1e12);
    const b = mk('0.9.1', [release('v0.9.1')]);
    expect((await b.check()).phase).toBe('current');
    b.install();
    expect(opened).toHaveLength(1);
    const c = new AndroidUpdater({ current: '0.9.0', setting: () => '', fetchJson: async () => { throw new Error('offline'); }, open: () => {}, remember: () => {}, lastCheck: () => 0 });
    expect((await c.check()).message).toContain('offline');
  });

  it('looks about once a day, and never when told never', async () => {
    let calls = 0;
    const u = (mode: string, last: number) => new AndroidUpdater({ current: '0.9.0', setting: () => '', fetchJson: async () => (calls++, []), open: () => {}, remember: () => {}, lastCheck: () => last, now: () => 100 * 3600 * 1000 });
    await u('off', 0).maybeCheck('off');
    await u('install', 99 * 3600 * 1000).maybeCheck('install');
    expect(calls).toBe(0);
    await u('install', 1000).maybeCheck('install');
    expect(calls).toBe(1);
  });
});
