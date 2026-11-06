// The file-system conformance suite: what any implementation of the `fs` seam must do, written once and run against Node's own
// fs (a temporary folder), the in-memory fs, and later the Android file plugin. It states the Node behaviour the core packages
// rely on: return shapes and error codes included.
import assert from 'node:assert/strict';

const bytesOf = (b) => Array.from(b);

/**
 * @param {{ describe: Function, it: Function }} t the test functions (node:test)
 * @param {string} name label for the implementation under test
 * @param {() => Promise<{ fs: object, root: string, cleanup?: () => Promise<void> }>} make a fresh, empty working folder
 */
export function defineFsConformance(t, name, make) {
  t.describe(`fs conformance: ${name}`, () => {
    let env;
    let fs;
    let root;
    const at = (...p) => `${root}/${p.join('/')}`;
    t.beforeEach(async () => {
      env = await make();
      fs = env.fs;
      root = env.root;
    });
    t.afterEach(async () => {
      await env.cleanup?.();
    });

    const code = async (promise) => {
      try {
        await promise;
      } catch (e) {
        return e.code;
      }
      return 'no error';
    };

    t.it('writes and reads text, including non-ASCII', async () => {
      await fs.writeFile(at('a.md'), '# Héllo — “quoted” 日本');
      assert.equal(await fs.readFile(at('a.md'), 'utf8'), '# Héllo — “quoted” 日本');
      assert.equal(await fs.readFile(at('a.md'), { encoding: 'utf8' }), '# Héllo — “quoted” 日本');
    });

    t.it('keeps a leading byte-order mark when reading text', async () => {
      await fs.writeFile(at('bom.md'), Uint8Array.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]));
      assert.equal(await fs.readFile(at('bom.md'), 'utf8'), '\uFEFF# A');
    });

    t.it('reads bytes without an encoding and writes bytes back unchanged', async () => {
      const data = Uint8Array.from([0, 1, 2, 250, 255, 128]);
      await fs.writeFile(at('b.bin'), data);
      assert.deepEqual(bytesOf(await fs.readFile(at('b.bin'))), bytesOf(data));
    });

    t.it('overwrites an existing file, and the wx flag refuses to', async () => {
      await fs.writeFile(at('a.md'), 'one');
      await fs.writeFile(at('a.md'), 'two');
      assert.equal(await fs.readFile(at('a.md'), 'utf8'), 'two');
      assert.equal(await code(fs.writeFile(at('a.md'), 'three', { flag: 'wx' })), 'EEXIST');
      assert.equal(await fs.readFile(at('a.md'), 'utf8'), 'two');
      await fs.writeFile(at('new.md'), 'x', { flag: 'wx' });
      assert.equal(await fs.readFile(at('new.md'), 'utf8'), 'x');
    });

    t.it('reports missing files and folders with ENOENT', async () => {
      assert.equal(await code(fs.readFile(at('nope.md'), 'utf8')), 'ENOENT');
      assert.equal(await code(fs.writeFile(at('no-folder', 'a.md'), 'x')), 'ENOENT');
      assert.equal(await code(fs.stat(at('nope.md'))), 'ENOENT');
      assert.equal(await code(fs.lstat(at('nope.md'))), 'ENOENT');
      assert.equal(await code(fs.readdir(at('nope'))), 'ENOENT');
      assert.equal(await code(fs.access(at('nope'))), 'ENOENT');
      assert.equal(await code(fs.realpath(at('nope'))), 'ENOENT');
      assert.equal(await code(fs.rename(at('nope'), at('other'))), 'ENOENT');
    });

    t.it('reading a folder as a file fails with EISDIR', async () => {
      await fs.mkdir(at('d'));
      assert.equal(await code(fs.readFile(at('d'), 'utf8')), 'EISDIR');
    });

    t.it('mkdir: recursive builds the whole path and is repeatable; plain mkdir is strict', async () => {
      await fs.mkdir(at('x', 'y', 'z'), { recursive: true });
      await fs.mkdir(at('x', 'y', 'z'), { recursive: true });
      assert.equal((await fs.stat(at('x', 'y', 'z'))).isDirectory(), true);
      assert.equal(await code(fs.mkdir(at('x'))), 'EEXIST');
      assert.equal(await code(fs.mkdir(at('p', 'q'))), 'ENOENT');
    });

    t.it('readdir lists names, and Dirents tell files from folders', async () => {
      await fs.mkdir(at('sub'));
      await fs.writeFile(at('a.md'), 'a');
      await fs.writeFile(at('b.md'), 'b');
      assert.deepEqual((await fs.readdir(root)).sort(), ['a.md', 'b.md', 'sub']);
      const ents = (await fs.readdir(root, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name));
      assert.deepEqual(
        ents.map((e) => [e.name, e.isFile(), e.isDirectory(), e.isSymbolicLink()]),
        [
          ['a.md', true, false, false],
          ['b.md', true, false, false],
          ['sub', false, true, false],
        ],
      );
      assert.equal(await code(fs.readdir(at('a.md'))), 'ENOTDIR');
    });

    t.it('stat and lstat give kind, byte size and a modification time', async () => {
      await fs.writeFile(at('a.md'), 'héllo'); // 6 bytes
      await fs.mkdir(at('d'));
      for (const stat of [fs.stat, fs.lstat]) {
        const s = await stat.call(fs, at('a.md'));
        assert.equal(s.isFile(), true);
        assert.equal(s.isDirectory(), false);
        assert.equal(s.isSymbolicLink(), false);
        assert.equal(s.size, 6);
        assert.equal(typeof s.mode, 'number');
        assert.equal(typeof s.mtimeMs, 'number');
        assert.ok(Math.abs(s.mtimeMs - Date.now()) < 60_000, 'mtime is recent');
        assert.equal((await stat.call(fs, at('d'))).isDirectory(), true);
      }
      assert.equal(await code(fs.stat(at('a.md', 'inside'))), 'ENOTDIR');
    });

    t.it('a rewrite does not move the modification time backwards', async () => {
      await fs.writeFile(at('a.md'), 'one');
      const before = (await fs.stat(at('a.md'))).mtimeMs;
      await new Promise((r) => setTimeout(r, 15));
      await fs.writeFile(at('a.md'), 'two');
      assert.ok((await fs.stat(at('a.md'))).mtimeMs >= before);
    });

    t.it('rename moves files and folders, replaces a file, and keeps content', async () => {
      await fs.writeFile(at('a.md'), 'A');
      await fs.rename(at('a.md'), at('b.md'));
      assert.equal(await code(fs.stat(at('a.md'))), 'ENOENT');
      assert.equal(await fs.readFile(at('b.md'), 'utf8'), 'A');
      await fs.writeFile(at('c.md'), 'C');
      await fs.rename(at('c.md'), at('b.md')); // replaces
      assert.equal(await fs.readFile(at('b.md'), 'utf8'), 'C');
      await fs.mkdir(at('dir', 'inner'), { recursive: true });
      await fs.writeFile(at('dir', 'inner', 'n.md'), 'N');
      await fs.rename(at('dir'), at('moved'));
      assert.equal(await fs.readFile(at('moved', 'inner', 'n.md'), 'utf8'), 'N');
      assert.equal(await code(fs.stat(at('dir'))), 'ENOENT');
    });

    t.it('write to a temporary file, then rename over the target (the safe-save pattern)', async () => {
      await fs.writeFile(at('note.md'), 'old');
      await fs.writeFile(at('.note.md.tmp'), 'new');
      await fs.rename(at('.note.md.tmp'), at('note.md'));
      assert.equal(await fs.readFile(at('note.md'), 'utf8'), 'new');
      assert.deepEqual(await fs.readdir(root), ['note.md']);
    });

    t.it('rm: files, missing paths with and without force, folders only when recursive', async () => {
      await fs.writeFile(at('a.md'), 'a');
      await fs.rm(at('a.md'));
      assert.equal(await code(fs.stat(at('a.md'))), 'ENOENT');
      assert.equal(await code(fs.rm(at('a.md'))), 'ENOENT');
      assert.equal(await code(fs.rm(at('a.md'), { force: true })), 'no error');
      await fs.mkdir(at('d', 'e'), { recursive: true });
      await fs.writeFile(at('d', 'e', 'f.md'), 'f');
      assert.ok(['ERR_FS_EISDIR', 'EISDIR', 'EPERM'].includes(await code(fs.rm(at('d')))), 'a folder needs recursive');
      await fs.rm(at('d'), { recursive: true, force: true });
      assert.equal(await code(fs.stat(at('d'))), 'ENOENT');
    });

    t.it('rmdir removes an empty folder only', async () => {
      await fs.mkdir(at('d'));
      await fs.writeFile(at('d', 'x.md'), 'x');
      assert.equal(await code(fs.rmdir(at('d'))), 'ENOTEMPTY');
      await fs.rm(at('d', 'x.md'));
      await fs.rmdir(at('d'));
      assert.equal(await code(fs.stat(at('d'))), 'ENOENT');
      await fs.writeFile(at('f.md'), 'f');
      assert.equal(await code(fs.rmdir(at('f.md'))), 'ENOTDIR');
    });

    t.it('appendFile creates and extends; unlink and copyFile work on files', async () => {
      await fs.appendFile(at('log.txt'), 'one\n');
      await fs.appendFile(at('log.txt'), 'two\n');
      assert.equal(await fs.readFile(at('log.txt'), 'utf8'), 'one\ntwo\n');
      await fs.copyFile(at('log.txt'), at('copy.txt'));
      assert.equal(await fs.readFile(at('copy.txt'), 'utf8'), 'one\ntwo\n');
      await fs.unlink(at('log.txt'));
      assert.equal(await code(fs.stat(at('log.txt'))), 'ENOENT');
      assert.equal(await code(fs.unlink(at('log.txt'))), 'ENOENT');
    });

    t.it('cp copies a folder tree when recursive', async () => {
      await fs.mkdir(at('src', 'sub'), { recursive: true });
      await fs.writeFile(at('src', 'sub', 'a.md'), 'A');
      await fs.cp(at('src'), at('dst'), { recursive: true });
      assert.equal(await fs.readFile(at('dst', 'sub', 'a.md'), 'utf8'), 'A');
      assert.equal(await fs.readFile(at('src', 'sub', 'a.md'), 'utf8'), 'A');
    });

    t.it('access and realpath succeed for what exists', async () => {
      await fs.writeFile(at('a.md'), 'a');
      await fs.access(at('a.md'));
      const real = await fs.realpath(at('a.md'));
      assert.ok(real.endsWith('/a.md'));
    });

    t.it('handles a few hundred files in one folder', async () => {
      await Promise.all(Array.from({ length: 300 }, (_, i) => fs.writeFile(at(`n${i}.md`), `# ${i}`)));
      assert.equal((await fs.readdir(root)).length, 300);
    });
  });
}
