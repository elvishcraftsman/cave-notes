import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

// Things the documentation says in words, checked against the engine.

const page = (props) => `---\nkind: task\n${props}---\n# T\n`;

test('docs: removing a property fires a plain change trigger, but not one with "to"', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': page('status: todo\n'), 'B.md': page('status: todo\n') });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: plain
    where: 'path:A.md'
    on: { change: status }
    do: [ { set_property: { fired: true } } ]
  - id: with-to
    where: 'path:B.md'
    on: { change: status, to: done }
    do: [ { set_property: { fired: true } } ]
`);
  world.advance(5000);
  ws.set('A.md', page(''));
  ws.set('B.md', page(''));
  await changed(engine, 'A.md');
  await changed(engine, 'B.md');
  assert.equal(ws.front('A.md').fired, true);
  assert.equal(ws.front('B.md').fired, undefined);
});

test('docs: "$today" on its own and "stop" with an if both work', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': page('priority: low\n') });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: r
    on: button
    do:
      - set_property: { stamped: $today }
      - stop: true
        if: this.priority == "low"
      - set_property: { after: yes }
`);
  await engine.runButton('r', 'A.md');
  assert.equal(String(ws.front('A.md').stamped), '2026-10-15');
  assert.equal(ws.front('A.md').after, undefined);
});

test('docs: a "where" that excludes the new value never lets a change trigger fire', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': page('status: todo\n') });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: never
    where: kind:task -status:done
    on: { change: status, to: done }
    do: [ { set_property: { fired: true } } ]
`);
  world.advance(5000);
  ws.set('A.md', page('status: done\n'));
  await changed(engine, 'A.md');
  assert.equal(ws.front('A.md').fired, undefined);
});
