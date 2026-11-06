import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

import { automationDocs } from './docs-text.js';
const doc = automationDocs();
const blocks = [...doc.matchAll(/(`{3,})yaml\n([\s\S]*?)\n\1/g)].map((m) => m[2]);
/** The rules file of the documentation example holding this rule. */
const example = (id) => {
  const b = blocks.find((x) => new RegExp(`id: ${id}\\b`).test(x));
  assert.ok(b, `no example with id ${id}`);
  return b;
};

test('docs: recurring tasks (weekly and monthly)', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, {
    'Tasks/Water.md': '---\nkind: task\nstatus: todo\nrecurs: weekly\ndue: 2026-10-15\n---\n# Water plants\n',
    'Tasks/Rent.md': '---\nkind: task\nstatus: todo\nrecurs: monthly\ndue: 2026-10-31\n---\n# Pay rent\n',
  });
  const { engine } = await makeEngine(world, ws, example('recur'));
  world.advance(5000);
  ws.set('Tasks/Water.md', '---\nkind: task\nstatus: done\nrecurs: weekly\ndue: 2026-10-15\n---\n# Water plants\n');
  ws.set('Tasks/Rent.md', '---\nkind: task\nstatus: done\nrecurs: monthly\ndue: 2026-10-31\n---\n# Pay rent\n');
  await changed(engine, 'Tasks/Water.md', 'Tasks/Rent.md');
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'));
  assert.ok(ws.has('Tasks/Pay rent 2026-11-30.md')); // Oct 31 + 1 month stops at Nov 30
  assert.equal(ws.front('Tasks/Pay rent 2026-11-30.md').recurs, 'monthly');
});

test('docs: spaced repetition', async () => {
  const world = new World();
  const card = (extra) => `---\nkind: card\ninterval_days: 4\n${extra}---\n# Card\n`;
  const ws = new FakeWorkspace(world, { 'C/a.md': card(''), 'C/b.md': card(''), 'C/c.md': card('') });
  const { engine } = await makeEngine(world, ws, example('review-card'));
  world.advance(5000);
  ws.set('C/a.md', card('rating: again\n'));
  ws.set('C/b.md', card('rating: hard\n'));
  ws.set('C/c.md', card('rating: easy\n'));
  await changed(engine, 'C/a.md', 'C/b.md', 'C/c.md');
  const [a, b, c] = ['a', 'b', 'c'].map((x) => ws.front(`C/${x}.md`));
  assert.deepEqual([a.interval_days, b.interval_days, c.interval_days], [1, 5, 14]);
  assert.equal(a.next_review, '2026-10-16');
  assert.equal(c.next_review, '2026-10-29');
  assert.equal(a.rating, undefined);
});

test('docs: kanban assignment uses old/new and per-action conditions', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'K/x.md': '---\nkind: card\nstatus: todo\n---\n# X\n' });
  const { engine } = await makeEngine(world, ws, example('card-moved'));
  world.advance(5000);
  ws.set('K/x.md', '---\nkind: card\nstatus: doing\n---\n# X\n');
  await changed(engine, 'K/x.md');
  let f = ws.front('K/x.md');
  assert.equal(f.owner, 'me');
  assert.equal(f.previous_status, 'todo');
  assert.equal(f.done_on, undefined);
  world.advance(20 * 60_000);
  ws.set('K/x.md', `---\nkind: card\nstatus: done\nowner: ann\nstatus_changed: ${f.status_changed}\nprevious_status: doing\n---\n# X\n`);
  await changed(engine, 'K/x.md');
  f = ws.front('K/x.md');
  assert.equal(f.owner, 'ann'); // not reassigned
  assert.equal(f.done_on, '2026-10-15');
});

test('docs: meeting setup and the weekly review page', async () => {
  const world = new World(new Date(2026, 9, 18, 17, 59)); // Sunday
  const ws = new FakeWorkspace(world, { 'Standup.md': '---\ntype: note\n---\n# Standup\n' });
  const { engine } = await makeEngine(world, ws, `${example('meeting-setup')}\n${example('weekly-review').replace(/^rules:\n/, '')}`);
  world.advance(5000);
  ws.set('Standup.md', '---\ntype: meeting\n---\n# Standup\n## Agenda\n');
  await changed(engine, 'Standup.md');
  assert.ok(ws.has('Meetings/Standup.md'));
  assert.equal(ws.front('Meetings/Standup.md').status, 'planned');
  assert.match(ws.text('Meetings/Standup.md'), /\(add agenda items\)/);
  world.advance(2 * 60_000);
  await engine.tick();
  const page = ws.text('Reviews/Week of 2026-10-12.md');
  assert.ok(page, ws.paths().join(', '));
  assert.match(page, /```view\ntype: table\nquery: under:"Journal" date:\$now\.week/);
});
