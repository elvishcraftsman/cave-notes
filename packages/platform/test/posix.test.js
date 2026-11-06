import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import posix from '../src/posix.js';

const PATHS = [
  '', '.', '..', '/', '//', 'a', 'a/', '/a', '/a/', 'a/b', 'a/b/', '/a/b/c.md', 'a//b', 'a/./b', 'a/../b', '../a', '../../a/b',
  '/a/../..', '/a/b/../../..', './a', './', 'a/b/..', 'a/b/../', 'dir/Name With Spaces.md', '.hidden', 'a/.hidden', 'a/b.c.d', 'a/b.',
  '/..', 'a/..', '...', 'a/...', '/storage/emulated/0/Syncthing/BBT/Tasks/Reply to reviews.md',
];

describe('posix path matches node:path.posix', () => {
  for (const fn of ['normalize', 'dirname', 'basename', 'extname', 'isAbsolute']) {
    it(fn, () => {
      for (const p of PATHS) assert.deepEqual(posix[fn](p), nodePath.posix[fn](p), `${fn}(${JSON.stringify(p)})`);
    });
  }
  it('basename with an extension argument', () => {
    for (const p of PATHS.filter((x) => x.replace(/\//g, '') !== '')) for (const ext of ['.md', 'md', '.c.d', 'a']) assert.equal(posix.basename(p, ext), nodePath.posix.basename(p, ext), `basename(${JSON.stringify(p)}, ${ext})`);
  });
  it('join and resolve', () => {
    for (const a of PATHS) {
      for (const b of PATHS) {
        assert.equal(posix.join(a, b), nodePath.posix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
        assert.equal(posix.resolve('/base', a, b), nodePath.posix.resolve('/base', a, b), `resolve(/base, ${JSON.stringify(a)}, ${JSON.stringify(b)})`);
      }
    }
    assert.equal(posix.join(), nodePath.posix.join());
  });
  it('relative', () => {
    const abs = ['/', '/a', '/a/b', '/a/b/c', '/a/c', '/x/y', '/a/b/../c', '/a/b/'];
    for (const a of abs) for (const b of abs) assert.equal(posix.relative(a, b), nodePath.posix.relative(a, b), `relative(${a}, ${b})`);
  });
  it('rejects non-strings like node does', () => {
    assert.throws(() => posix.join('a', 5), TypeError);
    assert.throws(() => posix.normalize(null), TypeError);
  });
  it('has the constants and a posix self-reference', () => {
    assert.equal(posix.sep, '/');
    assert.equal(posix.posix, posix);
  });
});
