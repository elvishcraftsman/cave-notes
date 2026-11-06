import test from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

const page = (v) => `---\nkind: task\nvalue: ${v}\n---\n# T\n`;

test('runs skipped by a condition do not count towards the per-page limit', async () => {
  const rules = `
rules:
  - id: copy-date
    where: kind:task
    if: "!is_empty(date(new.value))"
    on: { change: value }
    do:
      - set_property: { copied: "\${new.value}" }
`;
  const w = new World();
  const ws = new FakeWorkspace(w, { 'T.md': page('x') });
  const { engine, host } = await makeEngine(w, ws, rules);
  for (const v of ['2', '20', '202', '2026', '2026-', '2026-1', '2026-11', '2026-11-', '2026-11-0', '2026-11-05']) {
    w.advance(5_000);
    ws.set('T.md', page(v));
    await changed(engine, 'T.md');
  }
  assert.equal(String(ws.front('T.md').copied), '2026-11-05');
  assert.ok(!host.logs.some((l) => /times in 10 minutes/.test(l.detail)));
});

test('a rule that keeps acting on the same page is still stopped after 6 runs', async () => {
  const rules = `
rules:
  - id: copy
    where: kind:task
    on: { change: value }
    do:
      - set_property: { copied: "\${new.value}" }
`;
  const w = new World();
  const ws = new FakeWorkspace(w, { 'T.md': page('v0') });
  const { engine, host } = await makeEngine(w, ws, rules);
  for (let i = 1; i <= 10; i++) {
    w.advance(40_000); // apart enough that the person's edits are not taken for the rule's own (30 s)
    ws.set('T.md', page(`v${i}`));
    await changed(engine, 'T.md');
  }
  assert.equal(host.logs.filter((l) => l.status === 'done').length, 6);
  assert.ok(host.logs.some((l) => /acted on this page 6 times/.test(l.detail)));
});

test('failures that change nothing are allowed many more tries, but not endless ones', async () => {
  const rules = `
rules:
  - id: needs-date
    where: kind:task
    on: { change: value }
    do:
      - set_property: { later: "\${add(new.value, '1d')}" }
`;
  const w = new World();
  const ws = new FakeWorkspace(w, { 'T.md': page('x0') });
  const { engine, host } = await makeEngine(w, ws, rules);
  for (let i = 1; i <= 40; i++) {
    w.advance(5_000);
    ws.set('T.md', page(`x${i}`));
    await changed(engine, 'T.md');
  }
  assert.equal(host.logs.filter((l) => l.status === 'failed').length, 30);
  assert.ok(host.logs.some((l) => /failed on this page 30 times/.test(l.detail)));
});
