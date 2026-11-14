import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openTree, parseIgnore, decideIgnore } from '../src/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'caveignore-'));
const put = (root, rel, text = '# x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

test('patterns: names, folders, anchoring, wildcards and negation', () => {
  const rules = parseIgnore('# comment\n\nbuild/\n*.psd\n!keep.psd\n/top\n*/docs/.cave-notes\n');
  const rf = (d) => (d === '' ? rules : null);
  const ig = (p, dir = false) => decideIgnore(rf, p, dir).ignored;
  assert.equal(ig('x/build', true), true);
  assert.equal(ig('x/build', false), false, 'a trailing slash means folders only');
  assert.equal(ig('x/y/a.psd'), true);
  assert.equal(ig('x/keep.psd'), false);
  assert.equal(ig('top', true), true);
  assert.equal(ig('x/top', true), false, 'a leading slash counts from the ignore file\'s folder');
  assert.equal(ig('a/docs/.cave-notes', true), true);
  assert.equal(ig('a/b/docs/.cave-notes', true), false, '* is one level');
  assert.equal(ig('build/deep/page.md'), true, 'everything inside an ignored folder is ignored');
});

test('a .caveignore keeps pages, folders and nested workspaces out of the tree', async () => {
  const root = tmp();
  put(root, '.caveignore', 'secret.md\nattachments/\n*/docs/.cave-notes\n');
  put(root, 'Home.md');
  put(root, 'secret.md');
  put(root, 'attachments/Note.md');
  put(root, 'Proj/docs/Readme.md');
  fs.mkdirSync(path.join(root, 'Proj/docs/.cave-notes'), { recursive: true });
  put(root, 'Other/Page.md');
  fs.mkdirSync(path.join(root, 'Other/.cave-notes'), { recursive: true });
  const tree = openTree(root);
  const names = (await tree.listChildren(null, { workspaces: true })).map((c) => `${c.name}${c.workspace ? '*' : ''}`);
  assert.deepEqual(names, ['Home', 'Other*', 'Proj'], 'secret and attachments are gone; Other is still a workspace');
  const docs = await tree.listChildren('Proj.md', { workspaces: true });
  assert.deepEqual(docs.map((c) => `${c.name}${c.workspace ? '*' : ''}`), ['docs'], 'docs is an ordinary folder, not a workspace');
  const inner = await tree.listChildren('Proj/docs.md');
  assert.deepEqual(inner.map((c) => c.name), ['Readme'], 'its pages belong to the outer workspace');
});

test('a .caveignore in a sub-folder counts from that folder', async () => {
  const root = tmp();
  put(root, 'A/.caveignore', 'hidden.md\n');
  put(root, 'A/hidden.md');
  put(root, 'A/shown.md');
  put(root, 'B/hidden.md');
  const tree = openTree(root);
  assert.deepEqual((await tree.listChildren('A.md')).map((c) => c.name), ['shown']);
  assert.deepEqual((await tree.listChildren('B.md')).map((c) => c.name), ['hidden']);
});

test('! brings back what an earlier line ignored; file: and folder: pick out kinds; {a,b} gives alternatives', () => {
  const rules = parseIgnore('attachments/**\n!attachments/**/\n!attachments/**/*.{md,txt}\nfile:*.tmp\nfolder:cache\n!keep.tmp\n');
  const rf = (d) => (d === '' ? rules : null);
  const ig = (p, dir = false) => decideIgnore(rf, p, dir).ignored;
  // everything in attachments is ignored but its folders and its .md and .txt files
  assert.equal(ig('attachments/a.png'), true);
  assert.equal(ig('attachments/n.md'), false);
  assert.equal(ig('attachments/sub', true), false);
  assert.equal(ig('attachments/sub/n.txt'), false);
  assert.equal(ig('attachments/sub/x.pdf'), true);
  // kinds
  assert.equal(ig('x.tmp'), true, 'file: matches files');
  assert.equal(ig('x.tmp', true), false, 'and not folders');
  assert.equal(ig('a/cache', true), true, 'folder: matches folders');
  assert.equal(ig('a/cache'), false, 'and not files');
  assert.equal(ig('keep.tmp'), false, 'a later ! line wins');
});

test('only the notes of a folder are kept: the folders stay open, other files are gone', async () => {
  const root = tmp();
  put(root, '.caveignore', 'Papers/**\n!Papers/**/\n!Papers/**/*.{md,txt}\n');
  put(root, 'Home.md');
  put(root, 'Papers/Intro.md');
  put(root, 'Papers/figure.png', 'x');
  put(root, 'Papers/Ch1/Notes.md');
  put(root, 'Papers/Ch1/data.csv', 'x');
  put(root, 'Papers/Empty/data.csv', 'x');
  const tree = openTree(root);
  const kids = async (p) => (await tree.listChildren(p, { workspaces: true })).map((c) => c.name);
  assert.deepEqual(await kids(null), ['Home', 'Papers']);
  assert.deepEqual(await kids('Papers.md'), ['Ch1', 'Empty', 'Intro'], 'Empty is a folder the lines bring back, like any folder');
  assert.deepEqual(await kids('Papers/Ch1.md'), ['Notes']);
  assert.equal(await tree.isIgnored('Papers/figure.png', false), true);
  assert.equal(await tree.isIgnored('Papers/Ch1/Notes.md', false), false);
});
