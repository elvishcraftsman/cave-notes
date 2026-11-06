import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeSeams from '../src/node.js';
import * as browserSeams from '../src/browser.js';
import { createMemFs } from '../src/memfs.js';
import { createFsHolder, FS_METHODS } from '../src/fs-holder.js';

describe('fs holder', () => {
  afterEach(() => nodeSeams.resetFs());

  it('calls Node by default and the installed implementation after setFs, then goes back', async () => {
    const mem = createMemFs();
    await mem.mkdir('/only-in-memory');
    assert.equal(await nodeSeams.fs.stat('/only-in-memory').then(() => true, () => false), false);
    nodeSeams.setFs(mem);
    assert.equal((await nodeSeams.fs.stat('/only-in-memory')).isDirectory(), true);
    nodeSeams.resetFs();
    assert.equal(await nodeSeams.fs.stat('/only-in-memory').then(() => true, () => false), false);
  });

  it('a method the implementation lacks fails with a readable message', async () => {
    const h = createFsHolder({ readFile: async () => 'x' });
    assert.equal(await h.fs.readFile('/a'), 'x');
    await assert.rejects(h.fs.cp('/a', '/b'), /fs\.cp is not available on this platform/);
  });

  it('exposes every contract method and constants', () => {
    for (const m of FS_METHODS) assert.equal(typeof nodeSeams.fs[m], 'function', m);
    assert.equal(typeof nodeSeams.fs.constants.F_OK, 'number');
  });

  it('the browser build refuses file access until a file system is installed', async () => {
    await assert.rejects(browserSeams.fs.readFile('/a'), /no file system installed/);
    browserSeams.setFs(createMemFs());
    await browserSeams.fs.mkdir('/ok');
    assert.equal((await browserSeams.fs.stat('/ok')).isDirectory(), true);
    browserSeams.resetFs();
  });
});

describe('host information', () => {
  it('Node answers for real, and the browser build has safe defaults that can be replaced', () => {
    assert.ok(nodeSeams.host.hostname().length > 0);
    assert.ok(nodeSeams.host.cpuCount() >= 1);
    assert.equal(nodeSeams.host.pid(), process.pid);
    assert.equal(typeof browserSeams.host.tmpdir(), 'string');
    assert.equal(browserSeams.host.pid(), 0);
    browserSeams.setHost({ hostname: () => 'Pixel', tmpdir: () => '/data/cache' });
    assert.equal(browserSeams.host.hostname(), 'Pixel');
    assert.equal(browserSeams.host.tmpdir(), '/data/cache');
    assert.equal(browserSeams.host.pid(), 0, 'what was not replaced keeps its default');
    browserSeams.resetHost();
    assert.equal(browserSeams.host.hostname(), 'this device');
  });
});

describe('hashing and URLs: the browser build gives the same answers as Node', () => {
  const samples = ['', 'abc', '# Héllo — “quoted” 日本\n', 'x'.repeat(10_000)];
  it('sha1 of text and bytes', () => {
    for (const s of samples) {
      assert.equal(browserSeams.sha1(s), nodeSeams.sha1(s));
      assert.equal(browserSeams.sha1(new TextEncoder().encode(s)), nodeSeams.sha1(Buffer.from(s)));
    }
    assert.equal(nodeSeams.sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('randomHex gives the right length and is not constant', () => {
    for (const impl of [nodeSeams, browserSeams]) {
      const a = impl.randomHex(3);
      assert.match(a, /^[0-9a-f]{6}$/);
      assert.notEqual(impl.randomHex(8), impl.randomHex(8));
    }
  });
  it('fileURLToPath', () => {
    for (const u of ['file:///a/b.md', 'file:///a/b%20c/d%C3%A9.md', new URL('file:///x/y')]) {
      assert.equal(browserSeams.fileURLToPath(u), nodeSeams.fileURLToPath(u));
    }
    assert.throws(() => browserSeams.fileURLToPath('https://x/y'), TypeError);
  });
});
