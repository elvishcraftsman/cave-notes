import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, FakeWorkspace, makeEngine } from './helpers.js';

const RULES = fs.readFileSync(new URL('../../../apps/desktop/defaults/plugins/Join wrapped lines/automations/join-wrapped-lines.yaml', import.meta.url), 'utf8');

const run = async (text, selection = true) => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '# A\n' });
  const { engine } = await makeEngine(world, ws, RULES);
  return engine.runPlugin('join-wrapped-lines', { path: 'A.md', text, selection, answers: {} });
};

test('the plugin is listed under its name', async () => {
  const world = new World();
  const { engine } = await makeEngine(world, new FakeWorkspace(world, { 'A.md': '# A\n' }), RULES);
  assert.deepEqual(engine.plugins().map((p) => p.label), ['Join wrapped lines']);
});

test('the lines of a paragraph are joined, and paragraphs stay apart', async () => {
  const r = await run('Permission is hereby granted,\nfree of charge, to any person\nobtaining a copy.\n\nThe above notice\nshall be included.\n');
  assert.equal(r.status, 'done');
  assert.equal(r.text, 'Permission is hereby granted, free of charge, to any person obtaining a copy.\n\nThe above notice shall be included.\n');
});

test('one trailing space and the indent of the next line go, whatever the indent is', async () => {
  assert.equal((await run('one \n    two\n\t three')).text, 'one two three');
});

test('a deliberate line break (two spaces or a backslash) is kept', async () => {
  assert.equal((await run('line one  \nline two\nline three')).text, 'line one  \nline two line three');
  assert.equal((await run('line one\\\nline two\nline three')).text, 'line one\\\nline two line three');
});

test('headings, tables, lists, quotes and rules are not glued to their neighbours', async () => {
  const t = '# Title\nIntro line\ncontinues here\n- item one\n- item two\n  wrapped on\n1. first\n> quote\n> more\n| a | b |\n| - | - |\n---\nafter';
  assert.equal((await run(t)).text, '# Title\nIntro line continues here\n- item one\n- item two wrapped on\n1. first\n> quote\n> more\n| a | b |\n| - | - |\n---\nafter');
});

test('frontmatter and fenced code are left alone', async () => {
  const t = '---\nkind: x\ntags: [a]\n---\nwrapped\ntext\n\n```js\nconst a = 1;\nconst b = 2;\n```\nafter\nthis';
  assert.equal((await run(t, false)).text, '---\nkind: x\ntags: [a]\n---\nwrapped text\n\n```js\nconst a = 1;\nconst b = 2;\n```\nafter this');
});

test('a word split by a hyphen is joined without a space and keeps its hyphen', async () => {
  assert.equal((await run('an exam-\nple of a split')).text, 'an exam-ple of a split');
  assert.equal((await run('a dash -\nthen More')).text, 'a dash - then More'); // not a word split
  assert.equal((await run('end of the 1990-\n2000 range')).text, 'end of the 1990- 2000 range');
});

test('text with nothing to join is not changed', async () => {
  const r = await run('One line\n\nAnother line\n');
  assert.equal(r.changed, false);
});
