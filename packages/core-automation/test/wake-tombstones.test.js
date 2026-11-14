import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine, changedAs } from './helpers.js';
import { parseAutomations, render } from '../src/index.js';

const task = (extra = '', title = 'Call Bob') => `---\ntype: task\ncomplete: false\n${extra}---\n# ${title}\n`;
const PRIORITY = `
settings: { devices: [desktop, laptop], sync_delay: 60s, wake_delay: 2min }
rules:
  - id: bump
    where: type:task -complete:true
    on: { schedule: "0 6 * * *" }
    do:
      - set_property: { priority: "\${today}" }
`;
const otherComputer = (world, extra = {}) => world.devices.set('laptop', { id: 'laptop', name: 'laptop', seen: world.t, fired: {}, ...extra });
const front = (ws, p) => ws.front(p);

// ------------------------------------------------------------------ waiting for sync after waking up

test('after waking up, a missed schedule waits for sync, then sees the pages as they are by then', async () => {
  const world = new World(new Date(2026, 10, 13, 5, 0));
  const ws = new FakeWorkspace(world, { 'Tasks/Keep.md': task(), 'Tasks/Deleted elsewhere.md': task('', 'Gone') });
  otherComputer(world);
  const { engine } = await makeEngine(world, ws, PRIORITY, { id: 'desktop' });
  await engine.tick(); // the last tick before the computer goes to sleep
  world.at(2026, 11, 13, 8, 20); // it wakes at 8:20, long after 6:00
  await engine.tick();
  assert.equal(front(ws, 'Tasks/Keep.md').priority, undefined, 'nothing is written in the first moments after waking');
  assert.equal(front(ws, 'Tasks/Deleted elsewhere.md').priority, undefined);
  assert.match(engine.log(1)[0]?.detail ?? '', /^$/);

  world.advance(40_000);
  ws.pages.delete('Tasks/Deleted elsewhere.md'); // sync now delivers the deletion made on the laptop
  await engine.tick();
  assert.equal(front(ws, 'Tasks/Keep.md').priority, undefined);

  world.advance(90_000); // past wake_delay
  await engine.tick();
  assert.equal(front(ws, 'Tasks/Keep.md').priority, '2026-11-13');
  assert.equal(ws.has('Tasks/Deleted elsewhere.md'), false, 'the page deleted elsewhere is not brought back');
});

test('what the person does on this computer is acted on at once, even while waiting for sync', async () => {
  const world = new World(new Date(2026, 10, 13, 8, 0));
  const ws = new FakeWorkspace(world, { 'Tasks/A.md': task() });
  otherComputer(world);
  const { engine } = await makeEngine(world, ws, `
settings: { wake_delay: 2min }
rules:
  - id: stamp
    where: type:task
    on: { change: complete, to: true }
    do: [ { set_property: { completed_at: "\${today}" } } ]
`, { id: 'desktop', wake: true });
  assert.ok(engine.holdUntil > world.t, 'starting with another computer about waits');
  world.advance(5000);
  ws.set('Tasks/A.md', task().replace('complete: false', 'complete: true'));
  await changedAs(engine, 'local', 'Tasks/A.md');
  assert.equal(front(ws, 'Tasks/A.md').completed_at, '2026-11-13');
});

test('a change that arrives by sync while waiting is acted on after the wait', async () => {
  const world = new World(new Date(2026, 10, 13, 8, 0));
  const ws = new FakeWorkspace(world, { 'Tasks/A.md': task() });
  otherComputer(world, { seen: world.t - 3600_000 }); // known, but not alive now
  const { engine } = await makeEngine(world, ws, `
settings: { wake_delay: 2min }
rules:
  - id: stamp
    where: type:task
    on: { change: complete, to: true }
    do: [ { set_property: { completed_at: "\${today}" } } ]
`, { id: 'desktop', wake: true });
  world.advance(5000);
  ws.set('Tasks/A.md', task().replace('complete: false', 'complete: true'));
  await changedAs(engine, 'external', 'Tasks/A.md');
  assert.equal(front(ws, 'Tasks/A.md').completed_at, undefined);
  world.advance(120_000);
  await engine.tick();
  assert.equal(front(ws, 'Tasks/A.md').completed_at, '2026-11-13');
});

test('alone (no other computer has ever shared the workspace) there is no wait, and wake_delay: 0 switches it off', async () => {
  for (const [others, rules] of [[false, PRIORITY], [true, PRIORITY.replace('wake_delay: 2min', 'wake_delay: 0s')]]) {
    const world = new World(new Date(2026, 10, 13, 5, 0));
    const ws = new FakeWorkspace(world, { 'Tasks/Keep.md': task() });
    if (others) otherComputer(world);
    const { engine } = await makeEngine(world, ws, rules, { id: 'desktop', wake: true });
    assert.equal(engine.holdUntil, 0);
    await engine.tick();
    world.at(2026, 11, 13, 8, 20);
    await engine.tick();
    assert.equal(front(ws, 'Tasks/Keep.md').priority, '2026-11-13');
  }
});

test('a long silence is not mistaken for sleep while ticks keep coming', async () => {
  const world = new World(new Date(2026, 10, 13, 5, 0));
  const ws = new FakeWorkspace(world, { 'Tasks/Keep.md': task() });
  otherComputer(world);
  const { engine } = await makeEngine(world, ws, PRIORITY, { id: 'desktop' });
  for (let i = 0; i < 2 * 60 * 2 + 2; i++) {
    world.advance(30_000);
    otherComputer(world); // the laptop is alive too, after the desktop in order
    await engine.tick();
  }
  assert.equal(front(ws, 'Tasks/Keep.md').priority, '2026-11-13');
  assert.equal(engine.holdUntil, 0);
});

// ------------------------------------------------------------------ new_id()

test('new_id() gives a new id each time, never read back as a number, with an optional word in front', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = render('${new_id()}', {});
    assert.match(id, /^[a-z][0-9a-z]{15}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 2000);
  assert.match(render('${new_id("task")}', {}), /^task-[a-z][0-9a-z]{15}$/);
});

test('a rule can give every task a lasting id with new_id()', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'Tasks/A.md': task(), 'Tasks/B.md': task('', 'B') });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: give-id
    where: type:task -has:id
    on: { match: true, existing: true }
    do: [ { set_property: { id: "\${new_id()}" } } ]
`);
  await engine.tick();
  const a = front(ws, 'Tasks/A.md').id;
  const b = front(ws, 'Tasks/B.md').id;
  assert.match(String(a), /^[a-z][0-9a-z]{15}$/);
  assert.notEqual(a, b);
  world.advance(10 * 60_000);
  await engine.tick();
  assert.equal(front(ws, 'Tasks/A.md').id, a, 'it is given once and then kept');
});

// ------------------------------------------------------------------ tombstones

const TOMB = `
settings: { devices: [desktop, laptop], tombstones: { where: type:task } }
rules:
  - id: bump
    where: type:task -complete:true
    on: { schedule: "0 6 * * *" }
    do:
      - set_property: { priority: "\${today}" }
  - id: link-all
    where: type:project
    on: { change: status, to: done }
    do:
      - update_pages: { where: type:task, set: { project_done: true } }
`;

async function twoComputers(files, rules = TOMB) {
  const world = new World(new Date(2026, 10, 13, 5, 0));
  const ws = new FakeWorkspace(world, files);
  const laptop = await makeEngine(world, ws, rules, { id: 'laptop' });
  const desktop = await makeEngine(world, ws, rules, { id: 'desktop' });
  return { world, ws, laptop, desktop };
}

test('a page deleted in the app gets a tombstone that the other computers see, and rules leave it alone if it comes back', async () => {
  const { world, ws, laptop, desktop } = await twoComputers({ 'Tasks/Old.md': task('id: t1abc\n', 'Old'), 'Tasks/Live.md': task('id: t2abc\n', 'Live') });
  assert.equal(await laptop.engine.beforeDelete(['Tasks/Old.md']), 1);
  const text = ws.text('Tasks/Old.md');
  ws.pages.delete('Tasks/Old.md');
  assert.equal(await laptop.engine.afterDelete(['Tasks/Old.md']), 1);
  assert.deepEqual(Object.keys(world.devices.get('laptop').buried), ['t1abc'], 'written into the laptop\'s device file at once');

  // sync brings it back on the desktop (a stale copy somewhere was edited)
  world.advance(60_000);
  ws.set('Tasks/Old.md', text);
  desktop.engine.deviceCache.at = 0;
  await changedAs(desktop.engine, 'external', { path: 'Tasks/Old.md', kind: 'created' });
  assert.equal(desktop.host.notifications.length, 1);
  assert.match(desktop.host.notifications[0].body, /"Old" was deleted on laptop on 2026-11-13/);

  // the morning schedule writes to the live task only
  await desktop.engine.tick();
  world.at(2026, 11, 14, 6, 1);
  await desktop.engine.tick(); // a night without ticks: it waits for sync first
  world.advance(130_000);
  await desktop.engine.tick();
  assert.equal(ws.front('Tasks/Live.md').priority, '2026-11-14');
  assert.equal(ws.front('Tasks/Old.md').priority, undefined);
  assert.ok(desktop.engine.log(10).some((e) => e.path === 'Tasks/Old.md' && /deleted on laptop.*rules leave it alone/.test(e.detail)));

  // a rule that changes other pages skips it too
  ws.set('Proj.md', '---\ntype: project\nstatus: done\n---\n# P\n');
  await changedAs(desktop.engine, 'local', { path: 'Proj.md', kind: 'created' });
  assert.equal(ws.front('Tasks/Live.md').project_done, true);
  assert.equal(ws.front('Tasks/Old.md').project_done, undefined);

  // told once, not on every change
  world.advance(60_000);
  await changedAs(desktop.engine, 'external', 'Tasks/Old.md');
  assert.equal(desktop.host.notifications.length, 1);
});

test('removing the id keeps a page that came back: it is an ordinary page again', async () => {
  const { world, ws, laptop, desktop } = await twoComputers({ 'Tasks/Old.md': task('id: t1abc\n', 'Old') });
  await laptop.engine.beforeDelete(['Tasks/Old.md']);
  const text = ws.text('Tasks/Old.md');
  ws.pages.delete('Tasks/Old.md');
  await laptop.engine.afterDelete(['Tasks/Old.md']);
  ws.set('Tasks/Old.md', text.replace('id: t1abc\n', ''));
  await desktop.engine.tick();
  world.at(2026, 11, 14, 6, 1);
  await desktop.engine.tick();
  world.advance(130_000);
  await desktop.engine.tick();
  assert.equal(ws.front('Tasks/Old.md').priority, '2026-11-14');
});

test('no tombstone when the deletion is cancelled, for pages the setting does not cover, or for pages without an id', async () => {
  const { ws, laptop } = await twoComputers({ 'Tasks/A.md': task('id: a1\n'), 'Notes/N.md': '---\nid: n1\n---\n# N\n', 'Tasks/NoId.md': task() });
  assert.equal(await laptop.engine.beforeDelete(['Tasks/A.md', 'Notes/N.md', 'Tasks/NoId.md']), 1);
  assert.equal(await laptop.engine.afterDelete(['Tasks/A.md']), 0, 'cancelled: the page is still there');
  ws.pages.delete('Notes/N.md');
  ws.pages.delete('Tasks/NoId.md');
  assert.equal(await laptop.engine.afterDelete(['Notes/N.md', 'Tasks/NoId.md']), 0);
  assert.deepEqual(laptop.engine.state.buried, {});
});

test('without the tombstones setting nothing is remembered or skipped', async () => {
  const rules = TOMB.replace(', tombstones: { where: type:task }', '');
  const { ws, laptop } = await twoComputers({ 'Tasks/A.md': task('id: a1\n') }, rules);
  assert.equal(await laptop.engine.beforeDelete(['Tasks/A.md']), 0);
  ws.pages.delete('Tasks/A.md');
  assert.equal(await laptop.engine.afterDelete(['Tasks/A.md']), 0);
});

test('came_back: a folder moves a returning page aside', async () => {
  const rules = TOMB.replace('tombstones: { where: type:task }', 'tombstones: { where: type:task, came_back: "Came back/" }');
  const { ws, laptop, desktop } = await twoComputers({ 'Tasks/Old.md': task('id: t1abc\n', 'Old'), 'Came back.md': '# Came back\n' }, rules);
  await laptop.engine.beforeDelete(['Tasks/Old.md']);
  const text = ws.text('Tasks/Old.md');
  ws.pages.delete('Tasks/Old.md');
  await laptop.engine.afterDelete(['Tasks/Old.md']);
  ws.set('Tasks/Old.md', text);
  desktop.engine.deviceCache.at = 0;
  await changedAs(desktop.engine, 'external', { path: 'Tasks/Old.md', kind: 'created' });
  assert.equal(ws.has('Tasks/Old.md'), false);
  assert.equal(ws.has('Came back/Old.md'), true);
  assert.equal(desktop.host.notifications[0].path, 'Came back/Old.md');
});

test('a page that came back while the app was closed is pointed out when it starts', async () => {
  const world = new World(new Date(2026, 10, 13, 5, 0));
  const ws = new FakeWorkspace(world, { 'Tasks/Old.md': task('id: t1abc\n', 'Old') });
  world.devices.set('laptop', { id: 'laptop', name: 'laptop', seen: world.t, fired: {}, buried: { t1abc: { at: world.t - DAY, path: 'Tasks/Old.md', title: 'Old' } } });
  const { host } = await makeEngine(world, ws, TOMB, { id: 'desktop' });
  assert.equal(host.notifications.length, 1);
});
const DAY = 86_400_000;

test('the tombstones setting is checked', () => {
  const warn = (s) => parseAutomations(`settings: { tombstones: ${s} }\nrules: []`);
  assert.deepEqual(warn('true').settings.tombstones, { where: null, property: 'id', cameBack: 'notify' });
  assert.deepEqual(warn('{ where: "type:task", property: uid, came_back: ignore }').settings.tombstones, { where: 'type:task', property: 'uid', cameBack: 'ignore' });
  for (const bad of ['"yes"', '{ property: "two words" }', '{ came_back: trash }', '{ where: 3 }']) {
    const r = warn(bad);
    assert.equal(r.settings.tombstones, null, bad);
    assert.equal(r.warnings.length, 1, bad);
  }
  assert.equal(parseAutomations('settings: { wake_delay: 5min }\nrules: []').settings.wakeDelayMs, 300_000);
});
