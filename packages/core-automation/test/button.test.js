import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAutomations } from '../src/index.js';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

const task = (status, extra = '') => `---\nkind: task\nstatus: ${status}\n${extra}---\n# Water plants\n`;

const RULES = `
rules:
  - id: finish
    where: kind:task -status:done
    on: button
    do:
      - set_property: { status: done, completed_at: "\${today}" }
  - id: remind
    on: [ button, { schedule: "@daily" } ]
    where: kind:task
    do:
      - notify: "Remember: \${this.title}"
  - id: quiet
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { seen: true }
  - id: only-on-desktop
    device: desktop
    where: kind:task
    on: button
    do:
      - set_property: { desktop: true }
`;

const setup = async (files = { 'Tasks/Water.md': task('todo') }) => {
  const world = new World();
  const ws = new FakeWorkspace(world, files);
  const { engine, host } = await makeEngine(world, ws, RULES);
  return { world, ws, engine, host };
};

test('"on: button" is a trigger, alone or among others, in both spellings', () => {
  for (const on of ['button', '[button]', '{ button: true }', '[button, { schedule: "@daily" }]']) {
    const r = parseAutomations(`rules:\n  - id: b\n    on: ${on}\n    do: [ { log: hi } ]\n`);
    assert.deepEqual([r.errors, r.warnings], [[], []], on);
    assert.ok(r.rules[0].triggers.some((t) => t.kind === 'button'), on);
  }
});

test('a button runs the rule for the page that holds it', async () => {
  const { ws, engine } = await setup();
  const res = await engine.runButton('finish', 'Tasks/Water.md');
  assert.equal(res.status, 'done');
  assert.equal(ws.front('Tasks/Water.md').status, 'done');
  assert.equal(ws.front('Tasks/Water.md').completed_at, '2026-10-15');
  const last = engine.log()[0];
  assert.deepEqual([last.rule, last.trigger, last.path, last.status], ['finish', 'button', 'Tasks/Water.md', 'done']);
});

test('a button cannot start a rule that does not list "button"', async () => {
  const { ws, engine } = await setup();
  const res = await engine.runButton('quiet', 'Tasks/Water.md');
  assert.equal(res.status, 'refused');
  assert.match(res.detail, /on: button/);
  assert.equal(ws.front('Tasks/Water.md').seen, undefined);
});

test('a button for a rule that does not exist is refused, with the id in the message', async () => {
  const { engine } = await setup();
  const res = await engine.runButton('nope', 'Tasks/Water.md');
  assert.equal(res.status, 'refused');
  assert.match(res.detail, /nope/);
});

test('"where" still decides which pages a button works on', async () => {
  const { ws, engine } = await setup({ 'Tasks/Done.md': task('done'), 'Notes/Idea.md': '# Idea\n' });
  const finished = await engine.runButton('finish', 'Tasks/Done.md');
  assert.equal(finished.status, 'skipped');
  assert.match(finished.detail, /where/);
  const elsewhere = await engine.runButton('finish', 'Notes/Idea.md');
  assert.equal(elsewhere.status, 'skipped');
  assert.equal(ws.front('Notes/Idea.md').status, undefined);
});

test('a button on a page of no particular place is refused', async () => {
  const { engine } = await setup();
  assert.equal((await engine.runButton('finish', null)).status, 'refused');
});

test('a rule set to one computer is refused on another', async () => {
  const { ws, engine } = await setup();
  const res = await engine.runButton('only-on-desktop', 'Tasks/Water.md');
  assert.equal(res.status, 'refused');
  assert.match(res.detail, /desktop/);
  assert.equal(ws.front('Tasks/Water.md').desktop, undefined);
});

test('a switched-off rule is refused', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'T.md': task('todo') });
  const { engine } = await makeEngine(world, ws, 'rules:\n  - id: off\n    enabled: false\n    on: button\n    do: [ { log: x } ]\n');
  assert.equal((await engine.runButton('off', 'T.md')).status, 'refused');
});

test('a rule with several triggers can also be started by its button, and notifies', async () => {
  const { host, engine } = await setup();
  const res = await engine.runButton('remind', 'Tasks/Water.md');
  assert.equal(res.status, 'done');
  assert.equal(host.notifications.at(-1).body, 'Remember: Water plants');
});

test('a button works every time it is clicked, not once', async () => {
  const { world, engine, host } = await setup();
  await engine.runButton('remind', 'Tasks/Water.md');
  world.advance(2000);
  await engine.runButton('remind', 'Tasks/Water.md');
  assert.equal(host.notifications.length, 2);
});

test('what a button changes can start other rules, one step deeper', async () => {
  const { ws, engine } = await setup();
  await engine.runButton('finish', 'Tasks/Water.md');
  await changed(engine, 'Tasks/Water.md');
  assert.equal(ws.front('Tasks/Water.md').seen, true);
});

test('a rule that fails is reported as failed, not thrown', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'T.md': task('todo') });
  const { engine } = await makeEngine(world, ws, 'rules:\n  - id: bad\n    on: button\n    do:\n      - add_days: { field: due, days: 1 }\n');
  const res = await engine.runButton('bad', 'T.md');
  assert.equal(res.status, 'failed');
  assert.match(res.detail, /due/);
});
