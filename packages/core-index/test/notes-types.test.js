import test from 'node:test';
import assert from 'node:assert/strict';
import { configureNotes } from '@cave-notes/core-tree';
import { openIndex } from '../src/index.js';
import { tmpRoot, ws } from './helpers.js';

const paths = (r) => r.results.map((x) => x.path);
const reset = () => configureNotes({ exts: ['.md'] });

test('txt notes are indexed, linked and found; other files are not pages', async (t) => {
  t.after(reset);
  configureNotes({ exts: ['.md', '.txt'] });
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Home.md': '# Home\nSee [[Plain]] and [text](Plain.txt) and [pic](pic.png)',
    'Plain.txt': '---\nstatus: draft\n---\nSome plain words',
    'pic.png': 'x',
    'Plain/Child.md': '# Child',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('plain words')), ['Plain.txt']);
  assert.deepEqual(paths(idx.search('status:draft')), ['Plain.txt']);
  const links = idx.links('Home.md');
  assert.deepEqual(links.map((l) => [l.kind, l.status]), [['page', 'ok'], ['page', 'ok'], ['file', 'file']]);
  // a .md child of a .txt page: the parent is the real .txt page, not a made-up virtual one
  assert.equal(idx.getPage('Plain/Child.md').parentPath, 'Plain.txt');
  assert.equal(idx.getPage('Plain.md'), null);
});

test('a nested workspace is left out of the outer index', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Home.md': '# Home',
    'School/Math.md': '# Math',
    'School/.cave-notes/workspace.yaml': 'attributes:\n  status: school\n',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('')).sort(), ['Home.md']);
});

test('a page that appears inside a nested workspace is not indexed by refresh', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'Home.md': '# Home', 'School/.cave-notes/workspace.yaml': '', 'School/Math.md': '# Math' });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  await idx.refresh(['School/Math.md', 'School.md']);
  assert.deepEqual(paths(idx.search('')), ['Home.md']);
});

test('workspace.yaml may be written as YAML', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ '.cave-notes/workspace.yaml': 'attributes:\n  status: idea\n', 'A.md': '# A' });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('status:idea')), ['A.md']);
});

test('files that are not notes take part in queries when a note or workspace.yaml gives them attributes', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Trip.md': '---\nfiles:\n  map.png:\n    status: done\n    tags: [travel]\n---\n# Trip',
    'map.png': 'png',
    'Trip/Ticket.md': '# Ticket\n',
    'Trip/scan.pdf': 'pdf',
    'Plan.md': '---\nfiles:\n  - file: Trip/scan.pdf\n    status: todo\n  - file: missing.docx\n    status: todo\n---\n# Plan',
    '.cave-notes/workspace.yaml': 'files:\n  /report.docx:\n    status: done\n',
    'report.docx': 'doc',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('status:done')).sort(), ['map.png', 'report.docx']);
  assert.deepEqual(paths(idx.search('status:todo')), ['Trip/scan.pdf']);
  assert.deepEqual(paths(idx.search('is:file')).sort(), ['Trip/scan.pdf', 'map.png', 'report.docx']);
  assert.ok(idx.search('is:file').results.every((r) => r.isFile));
  assert.deepEqual(paths(idx.search('is:note')).sort(), ['Plan.md', 'Trip.md', 'Trip/Ticket.md']);
  // files do not act as pages: no links, no tree, not counted as sub-pages
  assert.equal(idx.stats().pages, 3);
  assert.equal(idx.stats().files, 3);
  assert.deepEqual(paths(idx.search('is:leaf')).sort(), ['Plan.md', 'Trip/Ticket.md']);
  assert.ok(idx.diagnostics('Plan.md').some((d) => /missing\.docx/.test(d.message)));

  // changing the block updates the rows
  await w.write('Trip.md', '---\nfiles:\n  map.png:\n    status: later\n---\n# Trip');
  await idx.refresh(['Trip.md']);
  assert.deepEqual(paths(idx.search('status:later')), ['map.png']);
  assert.deepEqual(paths(idx.search('status:done')), ['report.docx']);
});
