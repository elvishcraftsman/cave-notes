import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureNotes } from '@cave-notes/core-tree';
import { openIndex } from '../src/index.js';

const CANVAS = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"Grace and [[Faith]] together","x":0,"y":0,"width":250,"height":60},
\t\t{"id":"b2","type":"file","file":"Notes/Idea.md","subpath":"#Top","x":300,"y":0,"width":400,"height":400},
\t\t{"id":"c3","type":"link","url":"https://example.com/x","x":0,"y":200,"width":250,"height":100},
\t\t{"id":"d4","type":"group","label":"Salvation map","x":-50,"y":-50,"width":900,"height":600}
\t],
\t"edges":[
\t\t{"id":"e5","fromNode":"a1","toNode":"b2","label":"leads to"}
\t]
}`;

async function make(t) {
  configureNotes({ exts: ['.md', '.canvas'], defaultExt: '.md' });
  t.after(() => configureNotes({ exts: ['.md'], defaultExt: '.md' }));
  const root = await mkdtemp(path.join(tmpdir(), 'cv-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Notes'));
  await writeFile(path.join(root, 'Notes', 'Idea.md'), '# Idea\n\ntext\n');
  await writeFile(path.join(root, 'Faith.md'), '# Faith\n');
  await writeFile(path.join(root, 'Board.canvas'), CANVAS);
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  return idx;
}

test('a canvas is a page, found by the words in its cards but not by its JSON', async (t) => {
  const idx = await make(t);
  const q = (s) => idx.search(s).results.map((r) => r.path).sort();
  assert.deepEqual(q('Salvation'), ['Board.canvas']);
  assert.deepEqual(q('leads'), ['Board.canvas']);
  assert.deepEqual(q('nodes'), []); // a key of the file format, not a word in the canvas
  assert.deepEqual(q('width'), []);
});

test('a file card is a link to its page, and the page has the canvas as a backlink', async (t) => {
  const idx = await make(t);
  const links = idx.links('Board.canvas');
  const file = links.find((l) => l.target === '/Notes/Idea.md' || l.targetPath === 'Notes/Idea.md');
  assert.ok(file, JSON.stringify(links));
  const back = idx.backlinks ? idx.backlinks('Notes/Idea.md') : [];
  assert.ok(JSON.stringify(back).includes('Board.canvas'), JSON.stringify(back));
});

test('a wikilink in a text card is a link too', async (t) => {
  const idx = await make(t);
  const back = idx.backlinks('Faith.md');
  assert.ok(JSON.stringify(back).includes('Board.canvas'), JSON.stringify(back));
});

test('a canvas that is not valid JSON still indexes, as a page with a problem', async (t) => {
  const idx = await make(t);
  const root = idx.root;
  await writeFile(path.join(root, 'Bad.canvas'), '{"nodes": [');
  await idx.refresh(['Bad.canvas']);
  assert.ok(idx.getPage('Bad.canvas'));
  assert.deepEqual(idx.search('nodes').results, []);
});
