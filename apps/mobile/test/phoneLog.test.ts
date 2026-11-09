// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PhoneLog } from '../src/phoneLog';

/** A file system that keeps files in memory, or refuses writes. */
function memFs(opts: { failWrites?: boolean } = {}): ConstructorParameters<typeof PhoneLog>[0] {
  const files = new Map<string, string>();
  const nope = new Error('EACCES: permission denied');
  return {
    mkdir: async () => undefined,
    stat: async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return { size: files.get(p)!.length };
    },
    rm: async (p: string) => void files.delete(p),
    rename: async (a: string, b: string) => void (files.set(b, files.get(a) ?? ''), files.delete(a)),
    readFile: async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p)!;
    },
    writeFile: async (p: string, t: string) => {
      if (opts.failWrites) throw nope;
      files.set(p, t);
    },
    appendFile: async (p: string, t: string) => {
      if (opts.failWrites) throw nope;
      files.set(p, (files.get(p) ?? '') + t);
    },
  } as never;
}

describe('the phone log window', () => {
  it('shows what was written', async () => {
    const log = new PhoneLog(memFs(), '/app/logs', '/dl/log.txt');
    await log.start();
    log.line('INFO', 'open', 'attach /storage/emulated/0/Notes');
    const text = await log.read();
    expect(text).toContain('==== start');
    expect(text).toContain('attach /storage/emulated/0/Notes');
    expect(text).not.toContain('could not be written');
  });

  it('still shows this run, and says why, when the file cannot be written', async () => {
    const log = new PhoneLog(memFs({ failWrites: true }), '/app/logs', '/dl/log.txt');
    await log.start();
    log.line('ERROR', 'worker', 'the service worker failed to start (service-worker.js:1:1)');
    const text = await log.read();
    expect(text).toContain('The log file could not be written (EACCES: permission denied)');
    expect(text).toContain('the service worker failed to start');
    expect(text).toContain('==== start');
  });
});

describe('when the phone\'s file layer does not answer', () => {
  it('the log window still shows this run\'s lines (after a few seconds) instead of waiting for ever', async () => {
    const stuck = new Promise<never>(() => undefined);
    const fs = { ...memFs(), appendFile: () => stuck, readFile: () => stuck, stat: async () => { throw new Error('ENOENT'); } } as never;
    const log = new PhoneLog(fs, '/app/logs', '/Download/cave-notes-log.txt');
    log.line('INFO', 'open', 'attach /storage/emulated/0/Sync/Notes');
    const text = await log.read();
    expect(text).toContain('timed out');
    expect(text).toContain('attach /storage/emulated/0/Sync/Notes');
  }, 10000);
});
