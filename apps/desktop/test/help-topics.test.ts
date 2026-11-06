import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS } from '../src/renderer/helpTopics';

describe('the Help window’s list of documentation pages', () => {
  const docs = join(__dirname, '../../../docs');
  it('names only pages that exist, once each', () => {
    const files = HELP_TOPICS.map((t) => t[0]);
    for (const f of files) expect(existsSync(join(docs, f)), f).toBe(true);
    expect(new Set(files).size).toBe(files.length);
  });
  it('misses no page of the documentation', () => {
    const listed = new Set(HELP_TOPICS.map((t) => t[0]));
    const all = readdirSync(docs).filter((f) => f.endsWith('.md'));
    expect(all.filter((f) => !listed.has(f))).toEqual([]);
  });
});
