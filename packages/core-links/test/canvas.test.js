import test from 'node:test';
import assert from 'node:assert/strict';
import { configureNotes } from '@cave-notes/core-tree';
import { applyPlan, planRename } from '../src/index.js';
import { setup } from './helpers.js';

const board = (file) => `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"keep [[Idea]] as it is","x":0,"y":0,"width":250,"height":60},
\t\t{"id":"b2","type":"file","file":${JSON.stringify(file)},"subpath":"#Top","x":300,"y":0,"width":400,"height":400},
\t\t{"id":"c3","type":"file","file":"Other.md","x":0,"y":200,"width":250,"height":100}
\t],
\t"edges":[
\t\t{"id":"e5","fromNode":"a1","toNode":"b2"}
\t]
}`;

async function world(t, file = 'Notes/Idea.md') {
  configureNotes({ exts: ['.md', '.canvas'], defaultExt: '.md' });
  t.after(() => configureNotes({ exts: ['.md'], defaultExt: '.md' }));
  return setup(t, { 'Notes/Idea.md': '# Idea\n', 'Other.md': '# Other\n', 'Board.canvas': board(file) });
}

test('renaming a page rewrites the file cards that show it, as valid JSON', async (t) => {
  const { tree, index, w } = await world(t);
  const plan = await planRename({ tree, index, page: 'Notes/Idea.md', newName: 'Concept' });
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].path, 'Board.canvas');
  await applyPlan(plan, { tree, index });
  const text = await w.read('Board.canvas');
  const json = JSON.parse(text);
  assert.equal(json.nodes[1].file, 'Notes/Concept.md');
  assert.equal(json.nodes[1].subpath, '#Top');
  assert.equal(json.nodes[2].file, 'Other.md');
  // only that one line changed
  assert.equal(text.split('\n').filter((l, i) => l !== board('Notes/Idea.md').split('\n')[i]).length, 1);
});

test('names with quotes and unicode are written as valid JSON', async (t) => {
  const { tree, index, w } = await world(t);
  const plan = await planRename({ tree, index, page: 'Notes/Idea.md', newName: 'Ünïcode “quoted” idea' });
  await applyPlan(plan, { tree, index });
  const json = JSON.parse(await w.read('Board.canvas'));
  assert.equal(json.nodes[1].file, 'Notes/Ünïcode “quoted” idea.md');
});

test('renaming a page rewrites the wikilinks in text cards, keeping the alias and heading', async (t) => {
  configureNotes({ exts: ['.md', '.canvas'], defaultExt: '.md' });
  t.after(() => configureNotes({ exts: ['.md'], defaultExt: '.md' }));
  const text = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"See [[Idea]] and [[Idea#Top|the top]]\\nline two with \\"quotes\\" and [[Other]]","x":0,"y":0,"width":250,"height":60},
\t\t{"text":"keys first: [[Idea]]","id":"a2","type":"text","x":0,"y":100,"width":250,"height":60}
\t],
\t"edges":[]
}`;
  const { tree, index, w } = await setup(t, { 'Notes/Idea.md': '# A different title\n', 'Other.md': '# Other\n', 'Board.canvas': text });
  const plan = await planRename({ tree, index, page: 'Notes/Idea.md', newName: 'Concept' });
  await applyPlan(plan, { tree, index });
  const out = await w.read('Board.canvas');
  const json = JSON.parse(out);
  assert.equal(json.nodes[0].text, 'See [[Concept]] and [[Concept#Top|the top]]\nline two with "quotes" and [[Other]]');
  assert.equal(json.nodes[1].text, 'keys first: [[Concept]]');
});

test('a wikilink whose name has characters JSON writes as escapes is rewritten in place', async (t) => {
  configureNotes({ exts: ['.md', '.canvas'], defaultExt: '.md' });
  t.after(() => configureNotes({ exts: ['.md'], defaultExt: '.md' }));
  const text = '{"nodes":[{"id":"a","type":"text","text":"x \\u00e9 [[Caf\\u00e9]] \\ud83d\\ude00 [[Caf\\u00e9]]","x":0,"y":0,"width":9,"height":9}],"edges":[]}';
  const { tree, index, w } = await setup(t, { 'Café.md': '# Drinks\n', 'Board.canvas': text });
  const plan = await planRename({ tree, index, page: 'Café.md', newName: 'Tea' });
  await applyPlan(plan, { tree, index });
  assert.equal(JSON.parse(await w.read('Board.canvas')).nodes[0].text, 'x é [[Tea]] 😀 [[Tea]]');
});
