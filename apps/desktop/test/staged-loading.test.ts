import { describe, expect, it } from 'vitest';
import { Controller } from '../src/renderer/controller';

/** A stand-in for everything the controller talks to: every function answers with nothing. */
const quiet = (): unknown => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : quiet()), apply: () => Promise.resolve(undefined) });

describe('what waits for the index to be complete', () => {
  const make = (): Controller => new Controller(quiet() as never);

  it('knows whether the index is complete, and a stale one (opened from the saved index) is not', () => {
    const ctl = make();
    expect(ctl.indexFresh.value).toBe(true);
    ctl.indexStatus.value = { state: 'indexing', pages: 3, percent: 40 };
    expect(ctl.indexFresh.value).toBe(false);
    ctl.indexStatus.value = { state: 'ready', pages: 3, percent: 100, stale: true };
    expect(ctl.indexFresh.value).toBe(false);
    ctl.indexStatus.value = { state: 'ready', pages: 3, percent: 100 };
    expect(ctl.indexFresh.value).toBe(true);
  });

  it('refuses moving, renaming and changing many pages until then, and says why', async () => {
    const ctl = make();
    const said: string[] = [];
    (ctl as unknown as { toast: (t: string) => void }).toast = (t) => void said.push(t);
    ctl.indexStatus.value = { state: 'indexing', pages: 3, percent: 40 };
    expect(await ctl.movePage('A/B', null)).toBeNull();
    await ctl.movePagesTo(['A/B'], null);
    await ctl.renamePage('A/B');
    expect(await ctl.setAttributeOnPages(['A/B'], 'x', 1)).toBe(0);
    expect(said).toHaveLength(4);
    expect(said[0]).toMatch(/Wait until the index is up to date before moving pages or folders \(it is at 40%\)/);
    ctl.indexStatus.value = { state: 'ready', pages: 3, percent: 100 };
    said.length = 0;
    expect(ctl.requireFreshIndex('moving pages')).toBe(true);
    expect(said).toEqual([]);
  });
});
