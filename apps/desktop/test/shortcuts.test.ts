import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../src/shared/shortcuts';

describe('docs/02-writing/06-shortcuts.md', () => {
  it('lists every shortcut of the dialog (regenerate it when this fails)', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../../../docs/02-writing/06-shortcuts.md'), 'utf8');
    for (const g of SHORTCUTS) {
      expect(doc).toContain(`## ${g.title}`);
      for (const i of g.items) expect(doc).toContain(`\`${i.keys}\` | ${i.does} |`);
    }
  });
});
