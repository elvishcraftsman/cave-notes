import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine, changed, changedAs, splitFront } from './helpers.js';

const MIN = 60_000;
const task = (status, due = '2026-10-15', title = 'Water plants') => `---\nkind: task\nstatus: ${status}\ndue: ${due}\n---\n# ${title}\n`;

const RECUR = `
settings: { devices: [laptop, desktop], sync_delay: 60s }
rules:
  - id: recur
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { completed_at: "\${today}" }
      - create_page:
          name: "\${this.title} \${add(this.due, '7d')}"
          in: Tasks
          properties: { kind: task, status: todo, due: "\${add(this.due, '7d')}" }
      - set_property: { recurred_to: "\${created.path}" }
`;

const setup = (files, start) => {
  const world = new World(start);
  const ws = new FakeWorkspace(world, files);
  return { world, ws };
};

// ------------------------------------------------------------------ change trigger

test('a finished task spawns its next occurrence, once', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const { engine } = await makeEngine(world, ws, RECUR);
  world.advance(5000);
  ws.set('Tasks/Water.md', task('done'));
  await changed(engine, 'Tasks/Water.md');

  const next = 'Tasks/Water plants 2026-10-22.md';
  assert.ok(ws.has(next), ws.paths().join(', '));
  assert.equal(ws.front(next).due, '2026-10-22');
  assert.equal(ws.front(next).status, 'todo');
  assert.equal(ws.front('Tasks/Water.md').completed_at, '2026-10-15');
  assert.equal(ws.front('Tasks/Water.md').recurred_to, next);

  // the same change reported again does nothing
  await changed(engine, 'Tasks/Water.md');
  assert.equal(ws.paths().length, 2);

  // running the rule again by hand finds the work done and changes nothing
  const [again] = await engine.runNow('recur', { dry: false, path: 'Tasks/Water.md' });
  assert.equal(again.status, 'skipped');
  assert.equal(ws.paths().length, 2);
});

test('changes made while the app was closed are noticed on the next start', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const first = await makeEngine(world, ws, RECUR);
  const saved = first.host.state;
  world.advance(3600_000);
  ws.set('Tasks/Water.md', task('done'));
  const second = await makeEngine(world, ws, RECUR, { host: { rulesState: { state: saved } } });
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'));
  assert.equal(second.engine.log()[0].status, 'done');
});

test('a rule is quiet about pages that were already done before it existed', async () => {
  const { world, ws } = setup({ 'Tasks/Old.md': task('done', '2026-01-01', 'Old') });
  const { engine } = await makeEngine(world, ws, RECUR);
  assert.equal(ws.paths().length, 1);
  assert.equal(engine.log().length, 0);
});

test('from/to and where narrow a change trigger', async () => {
  const { world, ws } = setup({ 'A.md': task('todo'), 'B.md': '---\nstatus: todo\n---\n# B\n' });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: only-doing-to-done
    where: kind:task
    on: { change: status, from: doing, to: done }
    do: [ { notify: hit } ]
`);
  world.advance(5000);
  ws.set('A.md', task('done'));
  ws.set('B.md', '---\nstatus: done\n---\n# B\n');
  await changed(engine, 'A.md', 'B.md');
  assert.equal(host.notifications.length, 0); // A went todo -> done, B is not a task
  ws.set('A.md', task('doing'));
  await changed(engine, 'A.md');
  world.advance(1000);
  ws.set('A.md', task('done'));
  await changed(engine, 'A.md');
  assert.equal(host.notifications.length, 1);
});

// ------------------------------------------------------------------ time

test('due dates: notified once, on time, not for ancient dates', async () => {
  const { world, ws } = setup({
    'Today.md': task('todo', '2026-10-15', 'Today'),
    'Ancient.md': task('todo', '2026-09-01', 'Ancient'),
    'Later.md': task('todo', '2026-10-20', 'Later'),
  });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: due
    where: kind:task
    on: { at: due, time: "09:00" }
    do: [ { notify: { title: "Due today", body: "\${this.title}" } } ]
`);
  assert.equal(host.notifications.length, 0); // 08:00: not yet
  world.advance(61 * MIN);
  await engine.tick();
  assert.deepEqual(host.notifications.map((n) => n.body), ['Today']);
  world.advance(30 * MIN);
  await engine.tick();
  assert.equal(host.notifications.length, 1);
  // its date moves: it will be due again
  ws.set('Today.md', task('todo', '2026-10-16', 'Today'));
  world.at(2026, 10, 16, 9, 5);
  await engine.tick();
  assert.equal(host.notifications.length, 2);
});

test('an offset runs the trigger earlier', async () => {
  const { world, ws } = setup({ 'T.md': task('todo', '2026-10-16', 'T') });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: heads-up
    on: { at: due, offset: -1d, time: "08:30" }
    do: [ { notify: tomorrow } ]
`);
  world.advance(31 * MIN);
  await engine.tick();
  assert.equal(host.notifications.length, 1);
});

test('schedule: fires at the time, catches up once after a long absence, no backfill for a new rule', async () => {
  const { world, ws } = setup({}, new Date(2026, 9, 15, 7, 59));
  const rules = `
rules:
  - id: daily
    on: { schedule: "0 8 * * *" }
    do: [ { notify: review } ]
`;
  const a = await makeEngine(world, ws, rules);
  world.advance(2 * MIN);
  await a.engine.tick();
  assert.equal(a.host.notifications.length, 1);
  world.advance(60 * MIN);
  await a.engine.tick();
  assert.equal(a.host.notifications.length, 1);
  // closed for three days, then opened
  world.advance(3 * 86_400_000);
  const b = await makeEngine(world, ws, rules, { host: { rulesState: { state: a.host.state } } });
  assert.equal(b.host.notifications.length, 1); // one catch-up, not three
  // a brand-new rule does not run for the past
  const c = await makeEngine(world, ws, rules);
  assert.equal(c.host.notifications.length, 0);
});

test('schedule over pages: stalled projects are flagged unless a child is moving', async () => {
  const { world, ws } = setup({
    'Projects/Alpha.md': '---\nkind: project\nstatus: active\n---\n# Alpha\n',
    'Projects/Alpha/Task.md': '---\nstatus: doing\n---\n# t\n',
    'Projects/Beta.md': '---\nkind: project\nstatus: active\n---\n# Beta\n',
    'Projects/Beta/Task.md': '---\nstatus: todo\n---\n# t\n',
  }, new Date(2026, 9, 15, 8, 59));
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: stalled
    where: kind:project status:active
    unless: under:$this status:doing
    on: { schedule: "0 9 * * *" }
    do: [ { set_property: { status: blocked } } ]
`);
  world.advance(2 * MIN);
  await engine.tick();
  assert.equal(ws.front('Projects/Alpha.md').status, 'active');
  assert.equal(ws.front('Projects/Beta.md').status, 'blocked');
});

test('end-of-day rollover moves open tasks to tomorrow and does not repeat them', async () => {
  const { world, ws } = setup({
    'Journal/2026-10-15.md': '# Thu\n\n- [x] done thing\n- [ ] call Sam\n  - number is in contacts\n- [ ] buy milk\n',
  }, new Date(2026, 9, 15, 23, 59));
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: rollover
    on: { schedule: "0 0 * * *" }
    do:
      - copy_tasks:
          from: "Journal/\${format(sub(today, '1d'), 'YYYY-MM-DD')}"
          to: "Journal/\${format(today, 'YYYY-MM-DD')}"
          mode: move
`);
  world.advance(2 * MIN);
  await engine.tick();
  const tomorrow = ws.text('Journal/2026-10-16.md');
  assert.match(tomorrow, /- \[ \] call Sam\n {2}- number is in contacts\n- \[ \] buy milk/);
  assert.match(ws.text('Journal/2026-10-15.md'), /- \[>\] call Sam/);
  assert.match(ws.text('Journal/2026-10-15.md'), /- \[x\] done thing/);
  const [again] = await engine.runNow('rollover', { dry: false });
  assert.equal(again.status, 'skipped');
});

// ------------------------------------------------------------------ match, created

test('match: pages that start matching are acted on; those already matching are not', async () => {
  const { world, ws } = setup({ 'Inbox/Old.md': '---\nstatus: inbox\n---\n# Old\n' });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: flag
    where: status:inbox
    on: match
    do: [ { set_property: { flagged: true } } ]
`);
  world.advance(5000);
  ws.set('Inbox/New.md', '---\nstatus: inbox\n---\n# New\n');
  await changed(engine, { path: 'Inbox/New.md', kind: 'created' });
  assert.equal(ws.front('Inbox/New.md').flagged, true);
  assert.equal(ws.front('Inbox/Old.md').flagged, undefined);
});

test('smart template: a created page gets its frontmatter and moves to its folder', async () => {
  const { world, ws } = setup({});
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: meeting
    where: type:meeting
    on: created
    do:
      - set_property: { attendees: [], date: "\${today}" }
      - move_file: Meetings/
`);
  ws.set('Standup.md', '---\ntype: meeting\n---\n# Standup\n');
  await changed(engine, { path: 'Standup.md', kind: 'created' });
  assert.ok(ws.has('Meetings/Standup.md'));
  assert.equal(ws.front('Meetings/Standup.md').date, '2026-10-15');
  assert.ok(!ws.has('Standup.md'));
});

// ------------------------------------------------------------------ safety

test('a rule that keeps triggering itself is stopped by the chain limit', async () => {
  const { world, ws } = setup({ 'Loop.md': '---\nkind: loop\nn: 0\n---\n# L\n' });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: count-up
    where: kind:loop
    on: { change: n }
    do: [ { set_property: { n: "\${this.n + 1}" } } ]
`);
  world.advance(1000);
  ws.set('Loop.md', '---\nkind: loop\nn: 1\n---\n# L\n'); // a person edits it
  for (let i = 0; i < 10; i++) {
    await changed(engine, 'Loop.md'); // the app reports every write, including the rule's own
    world.advance(1000);
  }
  const log = engine.log(50);
  assert.equal(log.filter((e) => e.status === 'done').length, 3);
  assert.ok(log.some((e) => /chain of rules/.test(e.detail)));
  assert.equal(ws.front('Loop.md').n, 4);
});

test('the same edit reported twice within minutes is acted on once', async () => {
  const { world, ws } = setup({ 'Loop.md': '---\nkind: loop\n---\n# L\n' });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: ping
    where: kind:loop
    on: modified
    do: [ { notify: edited } ]
`);
  for (let i = 0; i < 5; i++) {
    world.advance(1000);
    ws.set('Loop.md', `---\nkind: loop\n---\n# L ${i}\n`);
    await changed(engine, 'Loop.md');
  }
  assert.equal(host.notifications.length, 1);
});

test('dry run reports what would happen and writes nothing', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('done') });
  const { engine, host } = await makeEngine(world, ws, RECUR);
  const before = JSON.stringify([...ws.pages]);
  const out = await engine.runNow('recur', { dry: true });
  assert.equal(out[0].status, 'dry');
  assert.match(out[0].detail, /create_page: created/);
  assert.equal(JSON.stringify([...ws.pages]), before);
  assert.equal(host.notifications.length, 0);
});

test('an action that fails stops the rule and says why; nothing later runs', async () => {
  const { world, ws } = setup({ 'A.md': '---\nstatus: todo\n---\n# A\n' });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: oops
    on: { change: status, to: done }
    do:
      - add_days: { field: due, days: 1 }
      - set_property: { after: yes }
`);
  world.advance(5000);
  ws.set('A.md', '---\nstatus: done\n---\n# A\n');
  await changed(engine, 'A.md');
  const e = engine.log()[0];
  assert.equal(e.status, 'failed');
  assert.match(e.detail, /"due" is not a date/);
  assert.equal(ws.front('A.md').after, undefined);
});

// ------------------------------------------------------------------ shell

const SHELL_RULE = `
rules:
  - id: publish
    device: laptop
    where: kind:post
    on: { change: status, to: published }
    do:
      - run_shell:
          command: 'make deploy "$CAVE_TITLE"'
          cwd: "\${this.folder}"
          timeout: 5s
          on_success: { set_property: { published_at: "\${today}" } }
          on_failure: { notify: "Publish failed" }
`;
const post = (status, title = 'Hello') => `---\nkind: post\nstatus: ${status}\n---\n# ${title}\n`;

test('shell: the command line is never interpolated; values arrive as environment variables', async () => {
  const { world, ws } = setup({ 'Posts/p.md': post('draft', '$(touch /tmp/pwned); x') });
  const { engine, host } = await makeEngine(world, ws, SHELL_RULE);
  world.advance(5000);
  ws.set('Posts/p.md', post('published', '$(touch /tmp/pwned); x'));
  await changed(engine, 'Posts/p.md');
  assert.equal(host.shells.length, 1);
  const s = host.shells[0];
  assert.equal(s.command, 'make deploy "$CAVE_TITLE"');
  assert.equal(s.env.CAVE_TITLE, '$(touch /tmp/pwned); x');
  assert.equal(s.env.CAVE_FILE_PATH, '/vault/Posts/p.md');
  assert.equal(s.env.CAVE_ATTR_STATUS, 'published');
  assert.equal(s.cwd, 'Posts');
  assert.equal(s.timeoutMs, 5000);
  assert.equal(s.template.cwd, '${this.folder}'); // what a person approves is the rule as written
  assert.equal(ws.front('Posts/p.md').published_at, '2026-10-15');
});

test('shell: a failing command runs the on_failure branch', async () => {
  const { world, ws } = setup({ 'Posts/p.md': post('draft') });
  const { engine, host } = await makeEngine(world, ws, SHELL_RULE, { host: { shell: () => ({ code: 2, stderr: 'boom' }) } });
  world.advance(5000);
  ws.set('Posts/p.md', post('published'));
  await changed(engine, 'Posts/p.md');
  assert.deepEqual(host.notifications.map((n) => n.body), ['Publish failed']);
  assert.equal(ws.front('Posts/p.md').published_at, undefined);
});

test('shell: a rule pinned to one computer does not run on another', async () => {
  const { world, ws } = setup({ 'Posts/p.md': post('draft') });
  const { engine, host } = await makeEngine(world, ws, SHELL_RULE, { id: 'desktop' });
  world.advance(5000);
  ws.set('Posts/p.md', post('published'));
  await changed(engine, 'Posts/p.md');
  assert.equal(host.shells.length, 0);
});

// ------------------------------------------------------------------ several computers

test('two computers: the first acts, the second looks again and finds it done', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const laptop = await makeEngine(world, ws, RECUR, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' });
  world.advance(15_000);
  ws.set('Tasks/Water.md', task('done'));
  await changed(laptop.engine, 'Tasks/Water.md');
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'));

  world.advance(3000); // the change reaches the desktop (already carrying the laptop's edits)
  await changed(desktop.engine, 'Tasks/Water.md');
  assert.equal(desktop.engine.state.pending.length, 1); // it waits its turn
  world.advance(30_000);
  await desktop.engine.tick();
  assert.equal(desktop.engine.state.pending.length, 1);
  world.advance(40_000);
  await desktop.engine.tick();
  assert.equal(desktop.engine.state.pending.length, 0);
  assert.equal(ws.paths().length, 2); // still one new task
  assert.match(desktop.engine.log()[0].detail, /already done by laptop/);
});

test('two computers: when the first one is not there, the second goes at once', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  world.devices.set('laptop', { id: 'laptop', name: 'laptop', seen: world.t - 3600_000, fired: {} }); // last seen an hour ago
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' });
  world.advance(5000);
  ws.set('Tasks/Water.md', task('done'));
  await changed(desktop.engine, 'Tasks/Water.md');
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'));
});

test('two computers who both act while offline still make one new task', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const laptop = await makeEngine(world, ws, RECUR, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' });
  world.advance(15 * MIN); // each stops seeing the other's file
  ws.set('Tasks/Water.md', task('done'));
  await changed(laptop.engine, 'Tasks/Water.md');
  await changed(desktop.engine, 'Tasks/Water.md');
  assert.equal(ws.paths().length, 2);
  assert.equal(ws.front('Tasks/Water.md').completed_at, '2026-10-15');
});

test('two computers: the edit is acted on at once where it was made, even by the computer that sorts second', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const laptop = await makeEngine(world, ws, RECUR, { id: 'laptop' }); // first in `devices`
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' }); // second: it used to wait a minute for its turn
  world.advance(15_000);
  ws.set('Tasks/Water.md', task('done'));
  await changedAs(desktop.engine, 'local', 'Tasks/Water.md'); // the person ticked it on the desktop
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'), 'acted at once');
  assert.equal(desktop.engine.state.pending.length, 0);

  world.advance(3000); // the change reaches the laptop: it must not go first now
  await changedAs(laptop.engine, 'external', 'Tasks/Water.md');
  assert.equal(laptop.engine.state.pending.length, 1);
  assert.equal(ws.paths().length, 2);
  world.advance(70_000);
  await laptop.engine.tick();
  assert.equal(laptop.engine.state.pending.length, 0);
  assert.equal(ws.paths().length, 2); // still one new task
  assert.match(laptop.engine.log()[0].detail, /already done by desktop/);
});

test('two computers: a change from outside leaves the first slot to the computer where it was made', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const laptop = await makeEngine(world, ws, RECUR, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' });
  world.advance(15_000);
  ws.set('Tasks/Water.md', task('done'));
  await changedAs(laptop.engine, 'external', 'Tasks/Water.md');
  await changedAs(desktop.engine, 'external', 'Tasks/Water.md');
  assert.equal(ws.paths().length, 1, 'neither acts at once');
  assert.equal(laptop.engine.state.pending[0].due - world.t, 60_000);
  assert.equal(desktop.engine.state.pending[0].due - world.t, 120_000); // the order among the others is kept
});

test('two computers: if the one where the edit was made never acts, the next in order does, after its delay', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  world.devices.set('desktop', { id: 'desktop', name: 'desktop', seen: world.t, fired: {} }); // alive a moment ago, then the lid was shut
  const laptop = await makeEngine(world, ws, RECUR, { id: 'laptop' });
  world.advance(5000);
  ws.set('Tasks/Water.md', task('done'));
  await changedAs(laptop.engine, 'external', 'Tasks/Water.md');
  assert.equal(ws.paths().length, 1);
  world.advance(30_000);
  await laptop.engine.tick();
  assert.equal(ws.paths().length, 1);
  world.advance(35_000);
  await laptop.engine.tick();
  assert.equal(ws.paths().length, 2);
});

test('a change from outside is acted on at once when no other computer is alive', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  world.devices.set('laptop', { id: 'laptop', name: 'laptop', seen: world.t - 3600_000, fired: {} });
  const desktop = await makeEngine(world, ws, RECUR, { id: 'desktop' });
  world.advance(5000);
  ws.set('Tasks/Water.md', task('done'));
  await changedAs(desktop.engine, 'external', 'Tasks/Water.md');
  assert.ok(ws.has('Tasks/Water plants 2026-10-22.md'));
});

test('two computers: a match caused by a local edit goes first where it was made, and not on the others', async () => {
  const { world, ws } = setup({ 'Inbox/A.md': '---\nkind: note\n---\n# A\n' });
  const MATCH = `
settings: { devices: [laptop, desktop], sync_delay: 60s }
rules:
  - id: flag
    where: kind:note flagged:yes
    on: match
    do:
      - set_property: { seen: yes }
`;
  const laptop = await makeEngine(world, ws, MATCH, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, MATCH, { id: 'desktop' });
  world.advance(15_000);
  ws.set('Inbox/A.md', '---\nkind: note\nflagged: yes\n---\n# A\n');
  await changedAs(desktop.engine, 'local', 'Inbox/A.md');
  assert.equal(ws.front('Inbox/A.md').seen, 'yes');
  await changedAs(laptop.engine, 'external', 'Inbox/A.md');
  assert.equal(laptop.engine.state.pending.length, 1);
});

test('two computers: notifications go to both, file changes to one', async () => {
  const { world, ws } = setup({ 'T.md': task('todo', '2026-10-15', 'T') });
  const rules = `
rules:
  - id: due
    on: { at: due, time: "08:30" }
    do: [ { notify: due } ]
`;
  const laptop = await makeEngine(world, ws, rules, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, rules, { id: 'desktop' });
  world.advance(31 * MIN);
  await laptop.engine.tick();
  await desktop.engine.tick();
  assert.equal(laptop.host.notifications.length, 1);
  assert.equal(desktop.host.notifications.length, 1);
});

test('the rules file can be reloaded; removed rules stop firing', async () => {
  const { world, ws } = setup({ 'A.md': task('todo') });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: n
    on: { change: status, to: done }
    do: [ { notify: one } ]
`);
  await engine.load('rules: []');
  world.advance(5000);
  ws.set('A.md', task('done'));
  await changed(engine, 'A.md');
  assert.equal(host.notifications.length, 0);
});

test('splitFront helper sanity', () => {
  assert.equal(splitFront('---\na: 1\n---\nbody').front.a, 1);
});

// ------------------------------------------------------------------ let, update_pages

test('let: named values used by several actions, in order, only when the rule runs', async () => {
  const { world, ws } = setup({ 'Card.md': '---\nkind: card\ninterval_days: 4\n---\n# Card\n' });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: review
    where: kind:card
    if: "!is_empty(new.rating)"
    on: { change: rating }
    let:
      days: "\${if(new.rating == 'again', 1, round(default(this.interval_days, 1) * 2.5))}"
      label: "in \${let.days} days"
    do:
      - set_property:
          interval_days: "\${let.days}"
          next_review: "\${add(today, string(let.days) + 'd')}"
          note: "\${let.label}"
      - remove_property: rating
`);
  world.advance(5000);
  ws.set('Card.md', '---\nkind: card\ninterval_days: 4\nrating: good\n---\n# Card\n');
  await changed(engine, 'Card.md');
  const f = ws.front('Card.md');
  assert.equal(f.interval_days, 10);
  assert.equal(f.next_review, '2026-10-25');
  assert.equal(f.note, 'in 10 days');
  assert.equal(f.rating, undefined);
  // removing the rating is itself a change, but the guard stops it
  assert.equal(engine.log().filter((e) => e.status === 'done').length, 1);
});

test('update_pages: related pages follow a property, found with $this in the query', async () => {
  const { world, ws } = setup({
    'Orgs/Acme.md': '---\nkind: org\nstatus: active\n---\n# Acme\n',
    'People/Ann.md': '---\nkind: person\norg: Acme\n---\n# Ann\n',
    'People/Bob.md': '---\nkind: person\norg: Acme\n---\n# Bob\n',
    'People/Cy.md': '---\nkind: person\norg: Other\n---\n# Cy\n',
  });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: org-status
    where: kind:org
    on: { change: status }
    do:
      - update_pages:
          where: kind:person org:"\${this.title}"
          set: { org_status: "\${new.status}" }
`);
  world.advance(5000);
  ws.set('Orgs/Acme.md', '---\nkind: org\nstatus: closed\n---\n# Acme\n');
  await changed(engine, 'Orgs/Acme.md');
  assert.equal(ws.front('People/Ann.md').org_status, 'closed');
  assert.equal(ws.front('People/Bob.md').org_status, 'closed');
  assert.equal(ws.front('People/Cy.md').org_status, undefined);
  const [again] = await engine.runNow('org-status', { dry: false, path: 'Orgs/Acme.md' });
  assert.equal(again.status, 'skipped'); // already up to date
});

test('a task ticked again a few seconds after the rule unticked it runs the rule again', async () => {
  const RULES = `
rules:
  - id: recur
    where: recurs:weekly
    on: { change: complete, to: true }
    do:
      - set_property: { due: "\${add(this.due, '7d')}" }
      - set_property: { complete: false }
`;
  const fm = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n# Task\n`;
  const world = new World();
  const ws = new FakeWorkspace(world, { 'T.md': fm({ due: '2026-10-16', recurs: 'weekly', complete: false }) });
  const { engine } = await makeEngine(world, ws, RULES);
  for (const due of ['2026-10-23', '2026-10-30', '2026-11-06']) {
    world.advance(5_000);
    ws.set('T.md', fm({ ...ws.front('T.md'), complete: true }));
    await changed(engine, 'T.md');
    await changed(engine, 'T.md');
    assert.equal(String(ws.front('T.md').due), due);
    assert.equal(ws.front('T.md').complete, false);
  }
});

// ------------------------------------------------------------------ what a page is about, and telling when a rule ran

test('rulesFor lists the rules whose where/require/unless a page meets, with the rule as written', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo'), 'Notes/Idea.md': '# Idea\n' });
  const { engine } = await makeEngine(world, ws, RECUR);
  const hits = await engine.rulesFor('Tasks/Water.md');
  assert.deepEqual(hits.map((h) => h.id), ['recur']);
  assert.match(hits[0].definition, /where: kind:task/);
  assert.match(hits[0].definition, /create_page:/);
  assert.deepEqual(await engine.rulesFor('Notes/Idea.md'), []);
});

test('the host hears of each rule that ran, not of skipped or dry runs', async () => {
  const { world, ws } = setup({ 'Tasks/Water.md': task('todo') });
  const ran = [];
  const { engine, host } = await makeEngine(world, ws, RECUR);
  host.onRun = (e) => ran.push(e);
  world.advance(5000);
  ws.set('Tasks/Water.md', task('done'));
  await changed(engine, 'Tasks/Water.md');
  assert.equal(ran.length, 1);
  assert.equal(ran[0].rule, 'recur');
  assert.equal(ran[0].status, 'done');
  assert.ok(ran[0].steps.some((s) => s.action === 'set_property'));
  await engine.runNow('recur', { dry: true, path: 'Tasks/Water.md' });
  assert.equal(ran.length, 1);
});
