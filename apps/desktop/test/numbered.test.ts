import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';
import { indentSelection } from '../src/renderer/components/Dialogs';

let root: string;
let svc: WorkspaceService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-num-'));
  await fs.writeFile(path.join(root, 'Idea.md'), '# Idea\n\n');
  svc = new WorkspaceService(() => undefined, { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
  await svc.openWorkspace(root);
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('duplicate names when creating a page', () => {
  it('knows a name is taken, whatever the extension', async () => {
    expect(await svc.pageNameTaken(null, 'Idea')).toBe(true);
    expect(await svc.pageNameTaken(null, 'Other')).toBe(false);
  });

  it('numbers the file but keeps the title', async () => {
    const a = await svc.createPageNumbered(null, 'Idea', '# Idea\n\n');
    const b = await svc.createPageNumbered(null, 'Idea', '# Idea\n\n');
    expect([a, b]).toEqual(['Idea.1.md', 'Idea.2.md']);
    expect(await fs.readFile(path.join(root, 'Idea.2.md'), 'utf8')).toBe('# Idea\n\n');
  });
});

describe('saved queries and relations boxes', () => {
  it('round-trips them through workspace.yaml', async () => {
    expect(await svc.setWorkspaceYaml('queries', 'open: status:todo\n')).toEqual({ ok: true });
    expect(await svc.setWorkspaceYaml('relations', '- name: P\n  from: open\n  attribute: project\n  to: open\n')).toEqual({ ok: true });
    const y = await svc.getWorkspaceYaml();
    expect(YAML.parse(y.queries)).toEqual({ open: 'status:todo' });
    expect(Array.isArray(YAML.parse(y.relations))).toBe(true);
    expect((await svc.setWorkspaceYaml('relations', 'a: b')).ok).toBe(false);
  });
});

describe('indentSelection', () => {
  it('inserts two spaces at a caret', () => {
    expect(indentSelection('a:', 2, 2, false)).toEqual({ value: 'a:  ', start: 4, end: 4 });
  });
  it('indents and outdents every touched line', () => {
    const r = indentSelection('a:\nb: 1\nc: 2', 3, 8, false);
    expect(r.value).toBe('a:\n  b: 1\nc: 2');
    expect(indentSelection('a\nb\nc', 0, 5, false).value).toBe('  a\n  b\n  c');
    expect(indentSelection('  a\n  b', 0, 7, true).value).toBe('a\nb');
  });
});
