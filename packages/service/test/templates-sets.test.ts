import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listTemplates } from '../src/templates';

const put = (root: string, rel: string, text = '# t\n'): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

describe('templates folder', () => {
  it('a single file is a template; a notes page with a same-name folder is a set whose notes are templates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
    put(root, '.cave-notes/templates/Meeting.md');
    put(root, '.cave-notes/templates/Project kit.md', '# readme of the set');
    put(root, '.cave-notes/templates/Project kit/Brief.md');
    put(root, '.cave-notes/templates/Project kit/Plan.md');
    put(root, '.cave-notes/templates/loose/Ignored.md'); // a folder without a readme beside it is not a set
    const names = (await listTemplates(root, null)).map((t) => t.name).sort();
    expect(names).toEqual(['Brief', 'Meeting', 'Plan']);
  });
});
