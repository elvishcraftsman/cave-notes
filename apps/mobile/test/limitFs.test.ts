import { describe, expect, it } from 'vitest';
import { limitFs } from '../src/limitFs';

describe('limitFs', () => {
  it('runs at most `max` operations at once, and finishes them all in order of asking', async () => {
    let now = 0;
    let top = 0;
    const done: number[] = [];
    const fake = {
      kind: 'fake',
      async op(n: number): Promise<number> {
        now++;
        top = Math.max(top, now);
        await new Promise((r) => setTimeout(r, 2));
        now--;
        done.push(n);
        return n * 2;
      },
    };
    const fs = limitFs(fake, { max: 2, breathe: 3 });
    const out = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => fs.op(n)));
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(top).toBeLessThanOrEqual(2);
    expect(done).toHaveLength(7);
    expect(fs.kind).toBe('fake');
  });

  it('passes errors on and keeps going', async () => {
    const fs = limitFs({ async boom(): Promise<void> { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }, async ok(): Promise<string> { return 'fine'; } }, { max: 1 });
    await expect(fs.boom()).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.ok()).resolves.toBe('fine');
  });
});
