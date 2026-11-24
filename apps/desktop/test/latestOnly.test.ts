import { expect, it } from 'vitest';
import { latestOnly } from '../src/renderer/latestOnly';

/** A slow worker: each request waits until the test lets it answer. */
function slowWorker() {
  const sent: number[] = [];
  const waiting: Array<() => void> = [];
  const run = (n: number): Promise<number> => {
    sent.push(n);
    return new Promise((resolve) => waiting.push(() => resolve(n * 10)));
  };
  const answer = async (): Promise<void> => {
    waiting.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sent, run, answer, pending: () => waiting.length };
}

it('sends one request at a time, and only the newest input that waited', async () => {
  const w = slowWorker();
  const shown: number[] = [];
  const r = latestOnly(w.run, (x: number) => shown.push(x));
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4);
  expect(w.sent).toEqual([1]); // 2 and 3 were replaced while 1 was on its way
  await w.answer();
  expect(shown).toEqual([]); // 1's answer is out of date: 4 is waiting
  expect(w.sent).toEqual([1, 4]);
  await w.answer();
  expect(shown).toEqual([40]);
  expect(w.pending()).toBe(0);
});

it('carries on after a request fails, and applies nothing once stopped', async () => {
  let fail = true;
  const shown: string[] = [];
  const r = latestOnly(
    (s: string) => (fail ? Promise.reject(new Error('busy')) : Promise.resolve(s.toUpperCase())),
    (x: string) => shown.push(x),
  );
  r.push('a');
  await new Promise((res) => setTimeout(res, 0));
  fail = false;
  r.push('b');
  await new Promise((res) => setTimeout(res, 0));
  expect(shown).toEqual(['B']);
  const w = slowWorker();
  const after: number[] = [];
  const s = latestOnly(w.run, (x: number) => after.push(x));
  s.push(1);
  s.push(2);
  s.stop();
  await w.answer();
  expect(after).toEqual([]);
  expect(w.sent).toEqual([1]); // the waiting input is dropped, not sent
});
