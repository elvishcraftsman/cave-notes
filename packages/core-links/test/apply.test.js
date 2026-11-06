import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openTree } from '@cave-notes/core-tree';
import { planRename, planMove, applyPlan, undo, listJournal } from '../src/index.js';
import { setup, readAll, rejectsWith } from './helpers.js';

const FILES = {
  'A/Grace.md': 'no heading',
  'B.md': '# B',
  'Z.md': '[a](A/Grace.md) [[Grace]]',
  'Y/Deep.md': '[up](../A/Grace.md)',
  'Untouched.md': '# Untouched',
};

async function plan(env, newName = 'Mercy') {
  return planRename({ tree: env.tree, index: env.index, page: 'A/Grace.md', newName });
}

test('apply edits the files, moves the pages, journals, and reconciles the index', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  const res = await applyPlan(p, { tree: env.tree, index: env.index });
  assert.deepEqual([res.from, res.to, res.filesEdited, res.linksRewritten], ['A/Grace.md', 'A/Mercy.md', 2, 3]);
  assert.equal(await env.w.read('Z.md'), '[a](A/Mercy.md) [[Mercy]]');
  assert.equal(await env.w.read('Y/Deep.md'), '[up](../A/Mercy.md)');
  assert.equal(await env.w.exists('A/Mercy.md'), true);
  assert.equal(await env.w.exists('A/Grace.md'), false);
  assert.equal(env.index.getPage('A/Mercy.md').title, 'Mercy');
  assert.equal(env.index.stats().brokenLinks, 0);
  assert.deepEqual((await listJournal(env.root)).map((j) => j.state), ['applied']);
});

test('stale: a file edited after planning aborts everything before any change', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await env.w.write('Z.md', '[a](A/Grace.md) [[Grace]] and someone typed more');
  const before = await readAll(env.root);
  await rejectsWith(assert, applyPlan(p, { tree: env.tree, index: env.index }), 'STALE');
  assert.deepEqual(await readAll(env.root), before);
  assert.deepEqual(await listJournal(env.root), []); // nothing was journaled
});

test('stale: the pages themselves changed after planning', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await env.tree.renamePage('A/Grace.md', 'Sneaky');
  await rejectsWith(assert, applyPlan(p, { tree: env.tree, index: env.index }), 'STALE');
});

test('applying the same plan twice is refused', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await applyPlan(p, { tree: env.tree, index: env.index });
  await rejectsWith(assert, applyPlan(p, { tree: env.tree, index: env.index }), 'STALE');
});

test('bad plans: malformed, or from another workspace', async (t) => {
  const env = await setup(t, FILES);
  const other = await setup(t, { 'X.md': '' });
  await rejectsWith(assert, applyPlan({}, { tree: env.tree }), 'BAD_PLAN');
  await rejectsWith(assert, applyPlan(await plan(env), { tree: other.tree }), 'BAD_PLAN');
});

test('a failure while writing edits rolls everything back byte for byte', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  const before = await readAll(env.root);
  let renames = 0;
  const fs = {
    rename: async (a, b) => {
      if (String(b).endsWith('.md') && String(a).includes('.cave-tmp-') && ++renames === 2) {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return fsp.rename(a, b);
    },
  };
  await rejectsWith(assert, applyPlan(p, { tree: env.tree, index: env.index, fs }), 'APPLY_FAILED');
  assert.deepEqual(await readAll(env.root), before);
  assert.deepEqual((await listJournal(env.root)).map((j) => j.state), ['failed']);
  const leftovers = Object.keys(await readAll(env.root)).filter((k) => k.includes('.cave-tmp-'));
  assert.deepEqual(leftovers, []);
});

test('a failure while moving the pages restores the edited files', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  const before = await readAll(env.root);
  const failing = openTree(env.root, {
    fs: { rename: async () => { throw Object.assign(new Error('nope'), { code: 'EIO' }); } },
  });
  await rejectsWith(assert, applyPlan(p, { tree: failing, index: env.index }), 'APPLY_FAILED');
  assert.deepEqual(await readAll(env.root), before);
});

// ------------------------------------------------------------------ undo

test('undo moves the pages back and restores every file byte for byte', async (t) => {
  const env = await setup(t, FILES);
  const before = await readAll(env.root);
  await applyPlan(await plan(env), { tree: env.tree, index: env.index });
  assert.notDeepEqual(await readAll(env.root), before);

  const res = await undo({ tree: env.tree, index: env.index });
  assert.deepEqual(res.restored.sort(), ['Y/Deep.md', 'Z.md']);
  assert.deepEqual(await readAll(env.root), before);
  assert.equal(env.index.getPage('A/Grace.md').title, 'Grace');
  assert.equal(env.index.stats().brokenLinks, 0);
  assert.deepEqual((await listJournal(env.root)).map((j) => j.state), ['undone']);
  await rejectsWith(assert, undo({ tree: env.tree }), 'NO_JOURNAL'); // nothing left to undo
});

test('undo goes back one operation at a time, most recent first', async (t) => {
  const env = await setup(t, FILES);
  const s0 = await readAll(env.root);
  await applyPlan(await plan(env, 'Mercy'), { tree: env.tree, index: env.index });
  const s1 = await readAll(env.root);
  await applyPlan(
    await planMove({ tree: env.tree, index: env.index, from: 'A/Mercy.md', newParent: 'B.md' }),
    { tree: env.tree, index: env.index },
  );
  assert.equal(await env.w.read('Z.md'), '[a](B/Mercy.md) [[Mercy]]');
  await undo({ tree: env.tree, index: env.index });
  assert.deepEqual(await readAll(env.root), s1);
  await undo({ tree: env.tree, index: env.index });
  assert.deepEqual(await readAll(env.root), s0);
});

test('undo refuses when a rewritten file was edited since, unless forced', async (t) => {
  const env = await setup(t, FILES);
  await applyPlan(await plan(env), { tree: env.tree, index: env.index });
  await env.w.write('Z.md', '[a](A/Mercy.md) [[Mercy]] plus my new thoughts');
  const afterEdit = await readAll(env.root);

  await assert.rejects(undo({ tree: env.tree, index: env.index }), (e) => {
    assert.equal(e.code, 'UNDO_CONFLICT');
    assert.deepEqual(e.details.files, ['Z.md']);
    return true;
  });
  assert.deepEqual(await readAll(env.root), afterEdit); // refused before changing anything

  const res = await undo({ tree: env.tree, index: env.index, force: true });
  assert.deepEqual(res.skipped, ['Z.md']);
  assert.equal(await env.w.read('Z.md'), '[a](A/Mercy.md) [[Mercy]] plus my new thoughts'); // the user's edit survives
  assert.equal(await env.w.read('Y/Deep.md'), '[up](../A/Grace.md)'); // the rest is restored
  assert.equal(await env.w.exists('A/Grace.md'), true);
});

test('undo can target a specific journal id; unknown ids are NO_JOURNAL', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await applyPlan(p, { tree: env.tree, index: env.index });
  await rejectsWith(assert, undo({ tree: env.tree, id: 'nope' }), 'NO_JOURNAL');
  const res = await undo({ tree: env.tree, id: p.id });
  assert.equal(res.id, p.id);
});

test('old journals are pruned', async (t) => {
  const env = await setup(t, { 'A.md': '# A', 'Z.md': '[a](A.md)' });
  const names = ['B', 'C', 'D', 'E'];
  let current = 'A.md';
  for (const n of names) {
    const p = await planRename({ tree: env.tree, index: env.index, page: current, newName: n });
    await applyPlan(p, { tree: env.tree, index: env.index, keepJournals: 2 });
    current = `${n}.md`;
  }
  assert.equal((await listJournal(env.root)).length, 2);
  assert.equal(await env.w.read('Z.md'), '[a](E.md)');
});

test('file permissions survive rewriting and undo', async (t) => {
  const env = await setup(t, FILES);
  await fsp.chmod(env.w.abs('Z.md'), 0o640);
  await applyPlan(await plan(env), { tree: env.tree, index: env.index });
  assert.equal((await fsp.stat(env.w.abs('Z.md'))).mode & 0o777, 0o640);
  await undo({ tree: env.tree, index: env.index });
  assert.equal((await fsp.stat(env.w.abs('Z.md'))).mode & 0o777, 0o640);
});

test('the journal lives under .cave-notes and does not appear in the page tree', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await applyPlan(p, { tree: env.tree, index: env.index });
  const dir = path.join(env.root, '.cave-notes', 'journal', p.id);
  assert.equal((await fsp.readdir(dir)).sort().join(), 'files,journal.json');
  const pages = [];
  for await (const x of env.tree.allPages()) pages.push(x.path);
  assert.equal(pages.some((x) => x.includes('journal')), false);
});

test('journals can be kept outside the workspace', async (t) => {
  const env = await setup(t, FILES);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cave-journal-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const p = await plan(env);
  await applyPlan(p, { tree: env.tree, index: env.index, journalDir: dir });
  assert.deepEqual((await listJournal(env.root, { journalDir: dir })).map((j) => j.state), ['applied']);
  assert.deepEqual(await listJournal(env.root), []);
  assert.equal(await env.w.exists('.cave-notes/journal'), false);
  await undo({ tree: env.tree, index: env.index, journalDir: dir });
  assert.deepEqual((await listJournal(env.root, { journalDir: dir })).map((j) => j.state), ['undone']);
  assert.equal(await env.w.exists('A/Grace.md'), true);
});

test('onStep reports each phase of a plan and of applying it, with timings', async (t) => {
  const env = await setup(t, FILES);
  const steps = [];
  const onStep = (m) => steps.push(m);
  const p = await planRename({ tree: env.tree, index: env.index, page: 'A/Grace.md', newName: 'Mercy', onStep });
  assert.ok(steps.some((s) => /^plan: from=A\/Grace\.md/.test(s)), steps.join('\n'));
  assert.ok(steps.some((s) => /tree check done in \d+ ms/.test(s)));
  assert.ok(steps.some((s) => /plan: done in \d+ ms: 2 file\(s\) to edit, 3 link\(s\)/.test(s)));
  steps.length = 0;
  await applyPlan(p, { tree: env.tree, index: env.index, onStep });
  for (const phase of ['step 1', 'step 2', 'step 3a', 'step 3b', 'apply: done in']) {
    assert.ok(steps.some((s) => s.includes(phase)), `${phase} missing in:\n${steps.join('\n')}`);
  }
});

test('onStep says why an apply failed', async (t) => {
  const env = await setup(t, FILES);
  const p = await plan(env);
  await env.w.write('Z.md', 'changed behind the plan');
  const steps = [];
  await rejectsWith(assert, applyPlan(p, { tree: env.tree, index: env.index, onStep: (m) => steps.push(m) }), 'STALE');
  assert.ok(steps.some((s) => /step 1 failed: Z\.md changed since the plan was made/.test(s)), steps.join('\n'));
});
