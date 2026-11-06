import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundIndexer, type BackgroundDeps } from '../src/renderer/background';

function make(over: Partial<BackgroundDeps> = {}) {
  const calls: string[] = [];
  let front: Promise<void> = Promise.resolve();
  const deps: BackgroundDeps = {
    list: async () => ['/w/A', '/w/B', '/w/C'],
    open: async (r) => void calls.push(`open ${r}`),
    refresh: async (r) => void calls.push(`refresh ${r}`),
    frontReady: () => front,
    enabled: () => true,
    ...over,
  };
  return { deps, calls, hold: (p: Promise<void>) => (front = p) };
}
const opts = { pauseMs: 0, refreshMs: 1000, retryMs: 500 };

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('keeping every workspace indexed', () => {
  it('opens each one, in order, once', async () => {
    const { deps, calls } = make();
    const b = new BackgroundIndexer(deps, opts);
    const p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    await b.pass();
    expect(calls.filter((c) => c.startsWith('open'))).toEqual(['open /w/A', 'open /w/B', 'open /w/C']);
    expect([...b.keeping]).toEqual(['/w/A', '/w/B', '/w/C']);
  });

  it('waits for the workspace in front to be ready before it opens anything', async () => {
    let release!: () => void;
    const { deps, calls, hold } = make();
    hold(new Promise<void>((r) => (release = r)));
    const b = new BackgroundIndexer(deps, opts);
    const p = b.pass();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
    release();
    hold(Promise.resolve());
    await vi.runAllTimersAsync();
    await p;
    expect(calls).toContain('open /w/A');
  });

  it('does nothing while the setting is off, and a failure does not stop the others', async () => {
    let on = false;
    const { deps, calls } = make({ enabled: () => on, open: async (r) => { if (r === '/w/B') throw new Error('not there'); calls.push(`open ${r}`); } });
    const b = new BackgroundIndexer(deps, opts);
    await b.pass();
    expect(calls).toEqual([]);
    on = true;
    const p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    expect(calls.filter((c) => c.startsWith('open'))).toEqual(['open /w/A', 'open /w/C']);
    expect(b.keeping.has('/w/B')).toBe(false);
  });

  it('tries a failed workspace again only after the wait', async () => {
    let ok = false;
    const { deps, calls } = make({ list: async () => ['/w/B'], open: async (r) => { if (!ok) throw new Error('drive missing'); calls.push(`open ${r}`); } });
    const t0 = 1_000_000;
    let now = t0;
    const b = new BackgroundIndexer(deps, opts, () => now);
    let p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    ok = true;
    now = t0 + 100; // too soon
    p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    expect(calls).toEqual([]);
    now = t0 + 600;
    p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    expect(calls).toEqual(['open /w/B']);
  });

  it('asks the open ones to look for changes now and then, not on every pass', async () => {
    let now = 5_000_000;
    const { deps, calls } = make({ list: async () => ['/w/A'] });
    const b = new BackgroundIndexer(deps, opts, () => now);
    for (const step of [0, 200, 1500, 100, 1100]) {
      now += step;
      const p = b.pass();
      await vi.runAllTimersAsync();
      await p;
    }
    expect(calls.filter((c) => c.startsWith('refresh'))).toHaveLength(2);
  });

  it('keeps at most as many as it is allowed', async () => {
    const { deps, calls } = make({ list: async () => ['/a', '/b', '/c', '/d'] });
    const b = new BackgroundIndexer(deps, { ...opts, max: 2 });
    const p = b.pass();
    await vi.runAllTimersAsync();
    await p;
    expect(calls.filter((c) => c.startsWith('open'))).toEqual(['open /a', 'open /b']);
  });
});
