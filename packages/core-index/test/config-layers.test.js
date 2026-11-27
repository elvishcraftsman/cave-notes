import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, readConfigSync, effectiveSections } from '../src/index.js';

const make = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};

test('the app folder is a base layer: read with the same code, kept apart, under the workspace', async () => {
  const app = make({
    'plugins/trim.yaml': 'rules:\n  - id: trim\n    name: Trim\n    on: { menu: Trim }\n    do: []\nschema:\n  due: { type: date }\n',
    'styles/mine.yaml': 'export-style:\n  Plain: { units: cm }\n',
  });
  const ws = make({ 'workspace.yaml': 'rules:\n  - id: own\n    name: Own\n    on: { menu: Own }\n    do: []\nschema:\n  due: { type: text }\n' });
  const cfg = await readConfig(ws, { baseDir: app });
  // the workspace's own view is untouched: nothing of the app's is in files, owners, present or sections
  assert.deepEqual(cfg.files.map((f) => f.name), ['workspace.yaml']);
  assert.deepEqual(cfg.sections.rules.map((r) => r.id), ['own']);
  assert.equal(cfg.owners.schema.length, 1);
  const eff = effectiveSections(cfg);
  assert.deepEqual(eff.sections.rules.map((r) => r.id), ['trim', 'own']);
  assert.equal(eff.sections.schema.due.type, 'text'); // the workspace wins by name
  assert.ok(eff.sections['export-style'].Plain);
  // the sync reader agrees
  assert.deepEqual(effectiveSections(readConfigSync(ws, { baseDir: app })).sections.rules.map((r) => r.id), ['trim', 'own']);
});

test('an empty rules: of the workspace does not switch off the app\'s automations', async () => {
  const app = make({ 'plugins/a.yaml': 'rules:\n  - id: a\n    name: A\n    on: { menu: A }\n    do: []\n' });
  const ws = make({ 'workspace.yaml': 'rules:\n' });
  assert.deepEqual(effectiveSections(await readConfig(ws, { baseDir: app })).sections.rules.map((r) => r.id), ['a']);
});

test('an installed plugin is read from automations/, definitions/ and styles/ only, with their own sections', async () => {
  const dir = make({
    'plugins/Cash/.installed.json': '{}',
    'plugins/Cash/plugin.yaml': 'plugin: { id: cash }\n',
    'plugins/Cash/automations/a.yaml': 'rules:\n  - id: r1\n    name: R1\n    on: { menu: R1 }\n    do: []\nschema:\n  x: { type: text }\n',
    'plugins/Cash/definitions/d.yaml': 'schema:\n  amount: { type: number }\nrules: []\n',
    'plugins/Cash/styles/s.yaml': 'export-style:\n  Letter: { units: cm }\n',
    'plugins/Cash/templates/t.yaml': 'rules: []\n',
    'plugins/Cash/base/old.yaml': 'schema:\n  stale: { type: text }\n',
    'plugins/Cash/assets/x.yaml': 'schema:\n  stale2: { type: text }\n',
  });
  const cfg = await readConfig(dir);
  assert.deepEqual(cfg.files.map((f) => f.name).sort(), ['plugins/Cash/automations/a.yaml', 'plugins/Cash/definitions/d.yaml', 'plugins/Cash/styles/s.yaml']);
  assert.deepEqual(Object.keys(cfg.sections.schema), ['amount']);
  assert.deepEqual(cfg.sections.rules.map((r) => r.id), ['r1']);
  assert.ok(cfg.sections['export-style'].Letter);
  // a section that does not belong to its part is reported and left out
  assert.ok(cfg.warnings.some((w) => /automations\/a\.yaml.*schema.*not read/.test(w)));
  assert.ok(cfg.warnings.some((w) => /definitions\/d\.yaml.*rules.*not read/.test(w)));
});

test('a plugin folder with a plugin.yaml but no install record was never finished, so it is not loaded', async () => {
  const dir = make({
    'plugins/Half/plugin.yaml': 'plugin: { id: half }\n',
    'plugins/Half/automations/a.yaml': 'rules:\n  - id: half\n    name: H\n    on: { menu: H }\n    do: []\n',
    'plugins/Loose/rules.yaml': 'rules:\n  - id: loose\n    name: L\n    on: { menu: L }\n    do: []\n',
  });
  assert.deepEqual((await readConfig(dir)).sections.rules.map((r) => r.id), ['loose']);
});
