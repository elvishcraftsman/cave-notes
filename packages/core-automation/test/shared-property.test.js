import test from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

// Two rules that watch the same property must both see a change to it.
const RULES = `
rules:
  - id: first
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { a: 1 }
  - id: second
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { b: 2 }
`;

test('every rule watching a property sees a change to it', async () => {
  const w = new World();
  const ws = new FakeWorkspace(w, { 'T.md': '---\nkind: task\nstatus: todo\n---\n# T\n' });
  const { engine } = await makeEngine(w, ws, RULES);
  w.advance(120_000);
  ws.set('T.md', '---\nkind: task\nstatus: done\n---\n# T\n');
  await changed(engine, 'T.md');
  assert.equal(ws.front('T.md').a, 1);
  assert.equal(ws.front('T.md').b, 2);
});

test('every rule watching a property catches up on a change made while the app was closed', async () => {
  const w = new World();
  const ws = new FakeWorkspace(w, { 'T.md': '---\nkind: task\nstatus: todo\n---\n# T\n' });
  const first = await makeEngine(w, ws, RULES);
  await first.engine.flush();
  const saved = first.host.state;
  w.advance(120_000);
  ws.set('T.md', '---\nkind: task\nstatus: done\n---\n# T\n');
  await makeEngine(w, ws, RULES, { host: { rulesState: { state: saved } } });
  assert.equal(ws.front('T.md').a, 1);
  assert.equal(ws.front('T.md').b, 2);
});
