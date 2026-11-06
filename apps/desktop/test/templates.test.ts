import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

let root: string;
let svc: WorkspaceService;
let events: Array<{ event: string; payload: unknown }> = [];
const w = async (rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-tpl-'));
  await w('Projects.md', '---\nchildTemplate: Task\n---\n# Projects\n');
  await w('Projects/Task.md', '---\ntemplate: true\nstatus: todo\n---\n## Notes for {{title}}\n\nCreated {{date}}\n');
  await w('.cave-notes/templates/Meeting.md', '# {{title}}\n\nAgenda\n');
  await w('Facts.md', '# Facts\n\n## Address\n\n1 Cave Road\n\n## Phone\n\n555\n');
  await w('Other.md', '# Other\n\nSee ![[Facts#Address]].\n');
  events = [];
  svc = new WorkspaceService((event, payload) => events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
  await svc.openWorkspace(root);
  for (let i = 0; i < 200 && !events.some((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'); i++) await new Promise((r) => setTimeout(r, 25));
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('templates', () => {
  it('lists the ones of the parent and of the workspace', async () => {
    const r = await svc.templatesFor('Projects.md');
    expect(r.templates.map((t) => t.name).sort()).toEqual(['Meeting', 'Task']);
    expect(r.default).toBe('Task');
    expect((await svc.templatesFor(null)).templates.map((t) => t.name)).toEqual(['Meeting']);
  });

  it('starts a new sub-page from the parent’s default template, without making it a template', async () => {
    const p = await svc.createPage('Projects.md', 'Launch');
    const text = await fs.readFile(path.join(root, p), 'utf8');
    expect(text).toContain('status: todo');
    expect(text).not.toContain('template');
    expect(text).toContain('## Notes for Launch');
    expect(text).toMatch(/^# Launch$/m);
    expect(text).toMatch(/Created \d{4}-\d{2}-\d{2}/);
  });

  it('takes the template that was picked, or none', async () => {
    const m = await svc.createPage('Projects.md', 'Weekly', undefined, 'Meeting');
    expect(await fs.readFile(path.join(root, m), 'utf8')).toBe('# Weekly\n\nAgenda\n');
    const n = await svc.createPage('Projects.md', 'Plain', undefined, null);
    expect(await fs.readFile(path.join(root, n), 'utf8')).toBe('# Plain\n\n');
  });

  it('keeps template pages out of the page tree', async () => {
    await svc.rescan?.();
    const kids = await svc.listChildren('Projects.md');
    expect(kids.map((k: { name: string }) => k.name)).not.toContain('Task');
  });
});

describe('embeds', () => {
  it('shows a section, a whole page and a template block', async () => {
    expect(await svc.resolveEmbed('Other.md', 'Facts', 'Address', false)).toMatchObject({ ok: true, text: '1 Cave Road' });
    const all = await svc.resolveEmbed('Other.md', 'Facts', null, false);
    expect(all.ok && all.text.startsWith('# Facts')).toBe(true);
    expect(await svc.resolveEmbed('Projects/Launch.md', 'Meeting', null, true)).toMatchObject({ ok: true });
    expect((await svc.resolveEmbed('Other.md', 'Nope', null, false)).ok).toBe(false);
    expect((await svc.resolveEmbed('Other.md', 'Facts', 'Zip', false)).ok).toBe(false);
  });

  it('edits the source, so every place that shows it changes', async () => {
    expect(await svc.saveEmbed('Other.md', 'Facts', 'Address', false, '2 Cave Road')).toEqual({ ok: true });
    expect(await fs.readFile(path.join(root, 'Facts.md'), 'utf8')).toBe('# Facts\n\n## Address\n\n2 Cave Road\n\n## Phone\n\n555\n');
    expect(await svc.resolveEmbed('Other.md', 'Facts', 'Address', false)).toMatchObject({ text: '2 Cave Road' });
  });
});

import { templateNameOf, mergeWithTemplate } from '@cave-notes/service/templates';
describe('template names written as links', () => {
  it('reads [[name]] (which YAML makes a nested list) and plain names', () => {
    expect(templateNameOf([['Task']])).toBe('Task');
    expect(templateNameOf('[[Task|x]]')).toBe('Task');
    expect(templateNameOf('Task')).toBe('Task');
    expect(templateNameOf(3)).toBeNull();
  });
  it('lays a view’s attributes over the template', () => {
    const out = mergeWithTemplate('---\nstatus: todo\ndue: 1\n---\n# T\n\nBody\n', '---\nstatus: done\n---\n# T\n\n');
    expect(out).toContain('status: done');
    expect(out).toContain('due: 1');
    expect(out).toContain('Body');
  });
});
