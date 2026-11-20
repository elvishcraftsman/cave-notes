import { describe, expect, it } from 'vitest';
import { logLinesOfDay } from '../src/renderer/logText';

describe('logLinesOfDay', () => {
  it('keeps the lines of one day, and the lines that continue them', () => {
    const noon = new Date(2026, 10, 20, 12, 0, 0);
    const t = (d: Date): string => d.toISOString();
    const text = [`${t(new Date(2026, 10, 19, 23, 0, 0))} INFO  [main] yesterday`, `${t(new Date(2026, 10, 20, 0, 5, 0))} INFO  [main] today a`, 'continued line', `${t(new Date(2026, 10, 20, 9, 0, 0))} WARN  [fs] today b`, `${t(new Date(2026, 10, 21, 1, 0, 0))} INFO  [main] tomorrow`].join('\n');
    expect(logLinesOfDay(text, noon).split('\n')).toEqual([`${t(new Date(2026, 10, 20, 0, 5, 0))} INFO  [main] today a`, 'continued line', `${t(new Date(2026, 10, 20, 9, 0, 0))} WARN  [fs] today b`]);
    expect(logLinesOfDay('nothing here', noon)).toBe('');
  });
});
