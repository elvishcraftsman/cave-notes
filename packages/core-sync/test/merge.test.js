import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { conflictOriginal, HistoryStore, isConflictName, matchPairs, mergeDocuments, pickBase } from '../src/index.js';

const m = (base, local, remote, t = {}) => mergeDocuments({ base, local, remote, ...t });

test('edits to different lines merge cleanly', () => {
  const r = m('# T\n\none\ntwo\nthree\n', '# T\n\nONE\ntwo\nthree\n', '# T\n\none\ntwo\nTHREE\n');
  assert.equal(r.text, '# T\n\nONE\ntwo\nTHREE\n');
  assert.equal(r.conflicts, 0);
});

test('two edits inside one long paragraph merge by words', () => {
  const base = 'The quick brown fox jumps over the lazy dog.\n';
  const r = m(base, 'The quick red fox jumps over the lazy dog.\n', 'The quick brown fox jumps over the sleepy dog.\n');
  assert.equal(r.text, 'The quick red fox jumps over the sleepy dog.\n');
});

test('the same edit on both sides is not a conflict', () => {
  assert.equal(m('a\nb\n', 'a\nB\n', 'a\nB\n').text, 'a\nB\n');
});

test('both sides appending keeps both, in the same order whichever side is local', () => {
  const x = m('a\n', 'a\nfrom local\n', 'a\nfrom remote\n').text;
  const y = m('a\n', 'a\nfrom remote\n', 'a\nfrom local\n').text;
  assert.equal(x, y);
  assert.match(x, /from local/);
  assert.match(x, /from remote/);
});

test('a real clash keeps both versions between markers, identically on both devices', () => {
  const a = m('x\nold line\ny\n', 'x\nmine\ny\n', 'x\ntheirs\ny\n');
  const b = m('x\nold line\ny\n', 'x\ntheirs\ny\n', 'x\nmine\ny\n');
  assert.equal(a.conflicts, 1);
  assert.equal(a.text, b.text);
  assert.ok(a.text.includes('mine') && a.text.includes('theirs') && a.text.includes('<<<<<<<'));
});

test('a delete against an edit of other lines keeps both', () => {
  const r = m('a\nb\nc\nd\n', 'a\nc\nd\n', 'a\nb\nc\nD\n');
  assert.equal(r.text, 'a\nc\nD\n');
});

test('frontmatter: different keys merge; a clash goes to the later save and is reported', () => {
  const base = '---\nstatus: todo\ndue: 2026-01-01\n---\nbody\n';
  const ok = m(base, base.replace('todo', 'doing'), base.replace('2026-01-01', '2026-02-02'));
  assert.equal(ok.text, '---\nstatus: doing\ndue: 2026-02-02\n---\nbody\n');
  const clash = m(base, base.replace('todo', 'doing'), base.replace('todo', 'done'), { localTime: 5, remoteTime: 9 });
  assert.equal(clash.text, '---\nstatus: done\ndue: 2026-01-01\n---\nbody\n');
  assert.equal(clash.lost.length, 1);
  assert.equal(clash.conflicts, 0);
});

test('frontmatter lists written inline gain items from both sides', () => {
  const base = '---\ntags: [a, b]\n---\n';
  const r = m(base, '---\ntags: [a, b, c]\n---\n', '---\ntags: [a, b, d]\n---\n');
  assert.equal(r.text, '---\ntags: [a, b, c, d]\n---\n');
});

test('the merge is symmetric and never loses a word (fuzz)', () => {
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'.split(' ');
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const edit = (lines) => {
    const out = [...lines];
    for (let k = 0; k < 1 + rnd(3); k++) {
      const p = rnd(out.length + 1);
      const r = rnd(3);
      if (r === 0) out.splice(p, 0, `new ${words[rnd(10)]}${rnd(100)}\n`);
      else if (r === 1) out.splice(p, 1);
      else if (p < out.length) out.splice(p, 1, out[p].replace(/\w+/, `${words[rnd(10)]}${rnd(100)}`));
    }
    return out;
  };
  for (let n = 0; n < 400; n++) {
    const base = Array.from({ length: 3 + rnd(10) }, (_, i) => `line ${i} ${words[rnd(10)]} ${words[rnd(10)]}\n`);
    const a = edit(base);
    const b = edit(base);
    const x = m(base.join(''), a.join(''), b.join(''));
    const y = m(base.join(''), b.join(''), a.join(''));
    assert.equal(x.text, y.text);
    // anything one side wrote that the base did not have is in the result
    for (const side of [a, b]) for (const line of side) if (!base.includes(line) && /^new /.test(line)) assert.ok(x.text.includes(line.trim()), `lost ${line}`);
  }
});

test('pickBase prefers the closest known ancestor, and falls back to the shared lines', () => {
  const old = 'a\nb\nc\n';
  const a = 'a\nB\nc\n';
  const b = 'a\nb\nc\nd\n';
  assert.equal(pickBase(['totally\nelse\n', old], a, b), old);
  const noBase = mergeDocuments({ base: pickBase([], a, b), local: a, remote: b }).text;
  assert.ok(noBase.includes('B') && noBase.includes('d'));
});

test('conflict copy names', () => {
  assert.ok(isConflictName('Grace.sync-conflict-20260101-120000-ABCDEFG.md'));
  assert.ok(!isConflictName('Grace.md'));
  assert.equal(conflictOriginal('A/Grace.sync-conflict-20260101-120000-ABCDEFG.md'), 'A/Grace.md');
  assert.equal(conflictOriginal('A/Grace.md'), null);
});

test('matchPairs finds a common subsequence', () => {
  assert.deepEqual(matchPairs([...'kitten'], [...'sitting']).length, 4);
});

test('history keeps versions, dedupes, prunes and follows a rename', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-hist-'));
  const h = new HistoryStore(dir, { maxPerFile: 3, maxFiles: 2 });
  for (const t of ['one', 'two', 'two', 'three', 'four']) await h.add('A.md', t, 'saved');
  assert.deepEqual(await h.texts('A.md'), ['four', 'three', 'two']);
  const list = await h.list('A.md');
  assert.equal(await h.read('A.md', list[0].id), 'four');
  await h.rename('A.md', 'B.md');
  assert.equal((await h.list('A.md')).length, 0);
  assert.equal((await h.list('B.md')).length, 3);
  await h.add('C.md', 'c', 'saved');
  await h.add('D.md', 'd', 'saved');
  assert.equal((await h.list('B.md')).length, 0); // pruned: oldest page beyond the cap
  await fs.rm(dir, { recursive: true, force: true });
});

test('textChanges turn one text into the other with small edits', async () => {
  const { textChanges } = await import('../src/index.js');
  const apply = (s, ch) => ch.reduceRight((acc, c) => acc.slice(0, c.from) + c.insert + acc.slice(c.to), s);
  const cases = [['a\nb\nc\n', 'a\nB\nc\nd\n'], ['hello world\n', 'hello brave world\n'], ['', 'x'], ['x', ''], ['same', 'same']];
  for (const [x, y] of cases) assert.equal(apply(x, textChanges(x, y)), y);
  assert.deepEqual(textChanges('hello world\n', 'hello brave world\n'), [{ from: 6, to: 6, insert: 'brave ' }]);
});
