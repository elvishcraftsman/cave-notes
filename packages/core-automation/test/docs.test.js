import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACTIONS, FUNCTION_DOCS, VARIABLES, THIS_FIELDS, parseAutomations } from '../src/index.js';
import { World, FakeWorkspace, makeEngine, changed } from './helpers.js';

import { automationDocs } from './docs-text.js';
const doc = automationDocs();
const mentions = (s) => doc.includes(s);

test('every YAML example in the documentation is a valid rules file', () => {
  const blocks = [...doc.matchAll(/(`{3,})yaml\n([\s\S]*?)\n\1/g)].map((m) => m[2]).filter((b) => /^(rules|settings):/m.test(b));
  assert.ok(blocks.length >= 16, `found ${blocks.length} rules examples`);
  for (const b of blocks) {
    const r = parseAutomations(b);
    assert.deepEqual([r.errors, r.warnings], [[], []], b.split('\n').slice(0, 4).join(' | '));
  }
});

test('the documentation names every action, trigger, variable, function and setting', () => {
  for (const name of Object.keys(ACTIONS)) assert.ok(mentions(`\`${name}\``), `action ${name}`);
  for (const f of FUNCTION_DOCS) assert.ok(mentions(f.sig), `function ${f.name}`);
  for (const v of VARIABLES) assert.ok(mentions(`\`${v}\``), `variable ${v}`);
  for (const f of THIS_FIELDS) assert.ok(mentions(`\`${f}\``), `this.${f}`);
  for (const t of ['change', 'match', 'schedule', 'at', 'created', 'modified', 'deleted', 'button', 'plugin']) assert.ok(mentions(`on: { ${t}`) || mentions(`on: ${t}`) || mentions(`\`on: ${t}`), `trigger ${t}`);
  for (const k of ['devices', 'sync_delay', 'live_window', 'heartbeat', 'max_depth', 'max_runs_per_minute']) assert.ok(mentions(k), `setting ${k}`);
  for (const k of ['id', 'name', 'enabled', 'on', 'where', 'require', 'unless', 'if', 'let', 'do', 'runs', 'device']) assert.ok(mentions(`| \`${k}\``), `rule field ${k}`);
  for (const k of ['trigger.kind', 'trigger.property', 'trigger.at', 'rule.id', 'device.name', 'created.path', 'shell.code']) assert.ok(mentions(k), k);
});

test('the documentation lists every environment variable a shell command gets', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'P/p.md': '---\nkind: post\nstatus: draft\n---\n# T\n' });
  const { engine, host } = await makeEngine(world, ws, `
rules:
  - id: s
    device: laptop
    where: kind:post
    on: { change: status, to: published }
    do: [ { run_shell: { command: "true" } } ]
`);
  world.advance(5000);
  ws.set('P/p.md', '---\nkind: post\nstatus: published\n---\n# T\n');
  await changed(engine, 'P/p.md');
  const keys = Object.keys(host.shells[0].env);
  assert.ok(keys.length >= 10);
  for (const k of keys) assert.ok(mentions(k.startsWith('CAVE_ATTR_') ? 'CAVE_ATTR_<NAME>' : k), `env ${k}`);
});
