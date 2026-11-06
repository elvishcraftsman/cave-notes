import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { formatAutomationLine, listLogSources, readLogSource } from '../src/main/logs';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-logs-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const T = Date.UTC(2026, 9, 22, 11, 30, 0);

it('lists the application log, its earlier part and the automation log of each workspace that has one', async () => {
  const app = path.join(dir, 'cave-notes.log');
  await fs.writeFile(app, 'a\n');
  await fs.writeFile(`${app}.1`, 'old\n');
  await fs.writeFile(path.join(dir, 'one.log'), '');
  const sources = await listLogSources(app, [
    { root: '/w/Notes', name: 'Notes', file: path.join(dir, 'one.log') },
    { root: '/w/None', name: 'None', file: path.join(dir, 'missing.log') },
  ]);
  expect(sources.map((s) => s.id)).toEqual(['app', 'app-earlier', 'automation:/w/Notes', 'all']);
  expect(sources[0]!.label).toBe('Application log');
});

it('has no "all" entry when there is only one log, and nothing at all without a log file', async () => {
  const app = path.join(dir, 'cave-notes.log');
  await fs.writeFile(app, 'a\n');
  expect((await listLogSources(app, [])).map((s) => s.id)).toEqual(['app']);
  expect(await listLogSources(null, [])).toEqual([]);
});

it('tells two workspaces with the same name apart by their place', async () => {
  const a = path.join(dir, 'a.log');
  const b = path.join(dir, 'b.log');
  await fs.writeFile(a, '');
  await fs.writeFile(b, '');
  const sources = await listLogSources(null, [{ root: '/x/Notes', name: 'Notes', file: a }, { root: '/y/Notes', name: 'Notes', file: b }]);
  expect(sources.map((s) => s.label)).toEqual(['Automations: /x/Notes', 'Automations: /y/Notes', 'All logs']);
});

it('shows an automation log entry as one plain line', () => {
  const line = JSON.stringify({ t: T, rule: 'recur', path: 'Tasks/Water.md', trigger: 'change', status: 'done', detail: 'set_property: done', steps: [], dry: false });
  expect(formatAutomationLine(line)).toBe('2026-10-22T11:30:00.000Z DONE    recur on Tasks/Water.md (change) - set_property: done');
  expect(formatAutomationLine(JSON.stringify({ t: T, rule: 'x', path: null, trigger: 'schedule', status: 'skipped', detail: '', dry: true }))).toBe('2026-10-22T11:30:00.000Z SKIPPED x (schedule) [dry run]');
  expect(formatAutomationLine('not json')).toBe('not json');
});

it('reads one log, turning an automation log into text', async () => {
  const app = path.join(dir, 'cave-notes.log');
  const auto = path.join(dir, 'automation.log');
  await fs.writeFile(app, 'line one\nline two\n');
  await fs.writeFile(auto, `${JSON.stringify({ t: T, rule: 'r', path: 'A.md', trigger: 'created', status: 'done', detail: 'ok' })}\n`);
  const sources = await listLogSources(app, [{ root: '/w/W', name: 'W', file: auto }]);
  expect((await readLogSource(sources, 'app')).text).toBe('line one\nline two\n');
  expect((await readLogSource(sources, 'automation:/w/W')).text).toBe('2026-10-22T11:30:00.000Z DONE    r on A.md (created) - ok\n');
  await expect(readLogSource(sources, '../../etc/passwd')).rejects.toThrow('no such log');
});

it('"all" puts the earlier part first, then the application log, then the automation logs', async () => {
  const app = path.join(dir, 'cave-notes.log');
  const auto = path.join(dir, 'automation.log');
  await fs.writeFile(`${app}.1`, 'earlier\n');
  await fs.writeFile(app, 'now\n');
  await fs.writeFile(auto, `${JSON.stringify({ t: T, rule: 'r', path: null, trigger: 'schedule', status: 'done', detail: '' })}\n`);
  const sources = await listLogSources(app, [{ root: '/w/W', name: 'W', file: auto }]);
  const { text } = await readLogSource(sources, 'all');
  expect(text.indexOf('earlier')).toBeGreaterThan(-1);
  expect(text.indexOf('earlier')).toBeLessThan(text.indexOf('now'));
  expect(text.indexOf('now')).toBeLessThan(text.indexOf('DONE'));
  expect(text).toContain('===== Application log (earlier part)');
  expect(text).toContain('===== Automations: W');
});

it('shows only the end of a large log, from a whole line, and says so', async () => {
  const app = path.join(dir, 'cave-notes.log');
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(40)}`);
  await fs.writeFile(app, `${lines.join('\n')}\n`);
  const { text } = await readLogSource(await listLogSources(app, []), 'app', 5000);
  expect(text.startsWith('[Only the end of this log is shown')).toBe(true);
  expect(text).toContain('line 1999');
  expect(text).not.toContain('line 0000');
  const body = text.split('\n\n').slice(1).join('\n\n').split('\n').filter(Boolean);
  expect(body.every((l) => /^line \d{4} x{40}$/.test(l))).toBe(true); // no piece of a line at the start
});

it('says so for an empty log', async () => {
  const app = path.join(dir, 'cave-notes.log');
  await fs.writeFile(app, '');
  expect((await readLogSource(await listLogSources(app, []), 'app')).text).toContain('nothing has been logged yet');
});
