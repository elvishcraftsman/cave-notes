import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  normalizePagePath,
  pageFolder,
  pageName,
  parentPage,
  joinPage,
  ancestors,
  isSelfOrDescendant,
  foldKey,
} from '../src/paths.js';

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e.name === 'TreeError' && e.code === code, `expected ${code}`);

test('normalizeName accepts ordinary names and strips .md', () => {
  assert.equal(normalizeName('Grace'), 'Grace');
  assert.equal(normalizeName('  Grace  '), 'Grace');
  assert.equal(normalizeName('Grace.md'), 'Grace');
  assert.equal(normalizeName('Grace.MD'), 'Grace');
  assert.equal(normalizeName('notes v2.1'), 'notes v2.1');
  assert.equal(normalizeName('Cafe\u0301'), 'Caf\u00e9'); // NFC
});

test('normalizeName rejects bad names', () => {
  for (const bad of ['', '   ', '.md', '.hidden', 'a/b', 'a\\b', 'a\u0000b', 'ends.', 'tab\tname']) {
    throwsCode(() => normalizeName(bad), 'INVALID_NAME');
  }
  throwsCode(() => normalizeName(42), 'INVALID_NAME');
  throwsCode(() => normalizeName('x'.repeat(300)), 'INVALID_NAME');
});

test('normalizePagePath accepts good paths', () => {
  assert.equal(normalizePagePath('A.md'), 'A.md');
  assert.equal(normalizePagePath('A/B/C.md'), 'A/B/C.md');
});

test('normalizePagePath rejects bad paths', () => {
  for (const bad of ['', '.md', '/abs.md', 'a\\b.md', 'a.txt', 'A', '../x.md', 'A/../x.md', './x.md', 'A//x.md', '.hid/x.md', 'A/.x.md']) {
    throwsCode(() => normalizePagePath(bad), 'INVALID_PATH');
  }
});

test('folder/name/parent/join helpers', () => {
  assert.equal(pageFolder('A/B.md'), 'A/B');
  assert.equal(pageName('A/B.md'), 'B');
  assert.equal(parentPage('A/B/C.md'), 'A/B.md');
  assert.equal(parentPage('A.md'), null);
  assert.equal(joinPage(null, 'X'), 'X.md');
  assert.equal(joinPage('A/B.md', 'X'), 'A/B/X.md');
  assert.deepEqual(ancestors('A/B/C.md'), ['A/B.md', 'A.md']);
  assert.deepEqual(ancestors('A.md'), []);
});

test('isSelfOrDescendant does not confuse prefix siblings', () => {
  assert.equal(isSelfOrDescendant('A.md', 'A.md'), true);
  assert.equal(isSelfOrDescendant('A/B.md', 'A.md'), true);
  assert.equal(isSelfOrDescendant('A/B/C.md', 'A.md'), true);
  assert.equal(isSelfOrDescendant('AB.md', 'A.md'), false);
  assert.equal(isSelfOrDescendant('AB/C.md', 'A.md'), false);
  assert.equal(isSelfOrDescendant('A.md', 'A/B.md'), false);
});

test('foldKey ignores case and Unicode normalization form', () => {
  assert.equal(foldKey('GRACE'), foldKey('grace'));
  assert.equal(foldKey('Cafe\u0301'), foldKey('CAF\u00c9'));
});

test('fileStem leaves question marks and a trailing dot out of the file name', async () => {
  const { fileStem } = await import('../src/index.js');
  assert.equal(fileStem('Why?'), 'Why');
  assert.equal(fileStem('Notes v1.'), 'Notes v1');
  assert.equal(fileStem('What is this?...'), 'What is this');
  assert.equal(fileStem('Plain'), 'Plain');
  assert.throws(() => fileStem('???'), /empty/);
});
