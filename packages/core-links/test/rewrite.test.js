import test from 'node:test';
import assert from 'node:assert/strict';
import { planMove, planRename, applyPlan, describePlan } from '../src/index.js';
import { setup } from './helpers.js';

/** Plan and apply a move, then return the plan. */
async function move(env, from, newParent, newName) {
  const plan = await planMove({ tree: env.tree, index: env.index, from, newParent, newName });
  await applyPlan(plan, { tree: env.tree, index: env.index });
  return plan;
}
async function rename(env, page, newName) {
  const plan = await planRename({ tree: env.tree, index: env.index, page, newName });
  await applyPlan(plan, { tree: env.tree, index: env.index });
  return plan;
}

const brokenCount = (env) => env.index.stats().brokenLinks;

// ------------------------------------------------------------------ markdown links

test('rename: inline links keep their style, fragment and title', async (t) => {
  const env = await setup(t, {
    'A/Grace.md': '# Grace',
    'Notes.md': [
      '[a](A/Grace.md)',
      '[b](./A/Grace.md#sec)',
      '[c](A/Grace.md "A title")',
      '[d](<A/Grace.md>)',
      '[e](A/Grace.md#x "t")',
    ].join('\n\n'),
  });
  const plan = await rename(env, 'A/Grace.md', 'Mercy');
  assert.equal(plan.summary.linksRewritten, 5);
  assert.equal(
    await env.w.read('Notes.md'),
    ['[a](A/Mercy.md)', '[b](./A/Mercy.md#sec)', '[c](A/Mercy.md "A title")', '[d](<A/Mercy.md>)', '[e](A/Mercy.md#x "t")'].join('\n\n'),
  );
  assert.equal(brokenCount(env), 0);
});

test('move: relative links from other pages, at different depths', async (t) => {
  const env = await setup(t, {
    'A/Grace.md': '# Grace',
    'B.md': '# B',
    'C/Deep.md': '[up](../A/Grace.md)',
    'D/E/Deeper.md': '[up](../../A/Grace.md)',
    'Top.md': '[down](A/Grace.md)',
  });
  await move(env, 'A/Grace.md', 'B.md');
  assert.equal(await env.w.read('C/Deep.md'), '[up](../B/Grace.md)');
  assert.equal(await env.w.read('D/E/Deeper.md'), '[up](../../B/Grace.md)');
  assert.equal(await env.w.read('Top.md'), '[down](B/Grace.md)');
  assert.equal(brokenCount(env), 0);
});

test("a moved page's own relative links are recomputed; links between co-moved pages are untouched", async (t) => {
  const env = await setup(t, {
    'A.md': '# A\n[kid](A/Kid.md) [top](Top.md) [pdf](docs/spec.pdf)',
    'A/Kid.md': '# Kid\n[parent](../A.md) [top](../Top.md)',
    'Top.md': '# Top',
    'Dest.md': '# Dest',
    'Dest/Sub/Other.md': '# Other',
  });
  const plan = await move(env, 'A.md', 'Dest.md');
  // A.md now lives in Dest/: its link to Kid is still the same relative path; Top.md and the pdf moved "up".
  assert.equal(await env.w.read('Dest/A.md'), '# A\n[kid](A/Kid.md) [top](../Top.md) [pdf](../docs/spec.pdf)');
  // Kid moved with its parent, so '../A.md' still works; '../Top.md' needs one more level.
  assert.equal(await env.w.read('Dest/A/Kid.md'), '# Kid\n[parent](../A.md) [top](../../Top.md)');
  assert.equal(plan.summary.linksRewritten, 3);
  assert.equal(brokenCount(env), 0);
  assert.equal(env.index.links('Dest/A.md').filter((l) => l.status === 'broken').length, 0);
});

test('root-absolute page links (/path.md)', async (t) => {
  const env = await setup(t, { 'A/Grace.md': '# Grace', 'Z.md': '[x](/A/Grace.md#f) [y](/Other.md)', 'Other.md': '' });
  await move(env, 'A/Grace.md', null);
  assert.equal(await env.w.read('Z.md'), '[x](/Grace.md#f) [y](/Other.md)');
  assert.equal(brokenCount(env), 0);
});

test('links into a moved folder: attachments and broken links follow, and in-folder links stay', async (t) => {
  const env = await setup(t, {
    'Foo.md': '# Foo\n![own](Foo/pic.png)',
    'Foo/pic.png': 'binary',
    'Bar.md': '# Bar',
    'Z.md': '![p](Foo/pic.png) [gone](Foo/Missing.md)',
  });
  await move(env, 'Foo.md', 'Bar.md');
  assert.equal(await env.w.read('Z.md'), '![p](Bar/Foo/pic.png) [gone](Bar/Foo/Missing.md)');
  assert.equal(await env.w.read('Bar/Foo.md'), '# Foo\n![own](Foo/pic.png)'); // unchanged: both moved together
  assert.equal(await env.w.exists('Bar/Foo/pic.png'), true);
});

test('destinations needing escapes are encoded; angle-bracket links keep raw spaces', async (t) => {
  const env = await setup(t, {
    'A/Grace.md': '# Grace',
    'My Folder.md': '# F',
    'Z.md': '[plain](A/Grace.md) [angle](<A/Grace.md>)',
  });
  await move(env, 'A/Grace.md', 'My Folder.md');
  assert.equal(await env.w.read('Z.md'), '[plain](My%20Folder/Grace.md) [angle](<My Folder/Grace.md>)');
  assert.equal(brokenCount(env), 0);
});

test('reference-style definitions are rewritten once', async (t) => {
  const env = await setup(t, { 'A/Grace.md': '# Grace', 'Z.md': '[a][r] and [b][r]\n\n[r]: A/Grace.md#x "title"\n' });
  const plan = await rename(env, 'A/Grace.md', 'Mercy');
  assert.equal(plan.summary.linksRewritten, 1);
  assert.equal(await env.w.read('Z.md'), '[a][r] and [b][r]\n\n[r]: A/Mercy.md#x "title"\n');
});

test('code, frontmatter and external links are never touched', async (t) => {
  const z = [
    '---',
    'source: "[x](A/Grace.md)"',
    '---',
    '`[x](A/Grace.md)` and [[Grace]] in code: `[[Grace]]`',
    '',
    '```',
    '[x](A/Grace.md) [[Grace]]',
    '```',
    '',
    '[web](https://example.com/A/Grace.md) \\[[Grace]]',
    '',
    '[real](A/Grace.md)',
  ].join('\n');
  const env = await setup(t, { 'A/Grace.md': 'no heading, so the title is the file name', 'Z.md': z });
  await rename(env, 'A/Grace.md', 'Mercy');
  assert.equal(await env.w.read('Z.md'), z.replace('[real](A/Grace.md)', '[real](A/Mercy.md)').replace('and [[Grace]] in code', 'and [[Mercy]] in code'));
});

test('links that leave the workspace are warned about, not rewritten', async (t) => {
  const env = await setup(t, { 'A/Grace.md': '# Grace\n[out](../../outside.md)', 'Dest.md': '' });
  const plan = await planMove({ tree: env.tree, index: env.index, from: 'A/Grace.md', newParent: 'Dest.md' });
  assert.equal(plan.files.length, 0);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0].message, /leaves the workspace/);
});

// ------------------------------------------------------------------ wikilinks

test('rename: wikilinks by file name are rewritten, with fragments, aliases, embeds and .md preserved', async (t) => {
  const env = await setup(t, {
    'Grace.md': 'no heading',
    'Z.md': '[[Grace]] [[grace#Sub|alias]] ![[Grace]] [[Grace.md]] [[ Grace ]]',
  });
  await rename(env, 'Grace.md', 'Mercy');
  assert.equal(await env.w.read('Z.md'), '[[Mercy]] [[Mercy#Sub|alias]] ![[Mercy]] [[Mercy.md]] [[ Mercy ]]');
  assert.equal(brokenCount(env), 0);
});

test('rename: wikilinks by title or alias are left alone', async (t) => {
  const env = await setup(t, {
    'Grace.md': '---\naliases: [Charis]\n---\n# A Fancy Title',
    'Z.md': '[[A Fancy Title]] [[Charis]] [[Grace]]',
  });
  await rename(env, 'Grace.md', 'Mercy');
  assert.equal(await env.w.read('Z.md'), '[[A Fancy Title]] [[Charis]] [[Mercy]]');
  assert.equal(brokenCount(env), 0);
});

test('a page titled by its file name: renaming changes the title, so title-form wikilinks follow too', async (t) => {
  const env = await setup(t, { 'Old Name.md': 'no heading', 'Z.md': '[[Old Name]]' });
  await rename(env, 'Old Name.md', 'New Name');
  assert.equal(await env.w.read('Z.md'), '[[New Name]]');
});

test('path-form wikilinks (rooted and relative) are updated on move', async (t) => {
  const env = await setup(t, {
    'A/Grace.md': '# Grace',
    'B.md': '# B',
    'Z.md': '[[A/Grace]] [[A/Grace.md|alias]]',
    'C/Deep.md': '[[../A/Grace]]',
  });
  await move(env, 'A/Grace.md', 'B.md');
  assert.equal(await env.w.read('Z.md'), '[[B/Grace]] [[B/Grace.md|alias]]');
  assert.equal(await env.w.read('C/Deep.md'), '[[../B/Grace]]');
  assert.equal(brokenCount(env), 0);
});

test('moving a page so a bare wikilink would resolve differently converts it to a path (with a warning)', async (t) => {
  const env = await setup(t, {
    'X/Intro.md': '# Intro X',
    'Y/Intro.md': '# Intro Y',
    'X/Page.md': '[[Intro]] and [[Intro#h|see]]', // closest is X/Intro
    'Z.md': '# Z',
  });
  const plan = await move(env, 'X/Page.md', 'Z.md'); // from Z/, X/Intro and Y/Intro are equally far
  assert.equal(await env.w.read('Z/Page.md'), '[[X/Intro]] and [[X/Intro#h|see]]');
  assert.equal(plan.warnings.length, 2);
  assert.deepEqual(env.index.links('Z/Page.md').map((l) => [l.status, l.resolvedPage]), [
    ['ok', 'X/Intro.md'],
    ['ok', 'X/Intro.md'],
  ]);
});

test("moving a page next to someone else's link so it would steal the link converts that link", async (t) => {
  const env = await setup(t, {
    'A/Intro.md': '# Intro A',
    'B/Intro.md': '# Intro B',
    'A/sub/Doc.md': '[[Intro]]', // resolves to A/Intro (one folder away)
  });
  const plan = await move(env, 'B/Intro.md', 'A/sub.md'); // would now be right next to Doc.md
  assert.equal(await env.w.read('A/sub/Doc.md'), '[[A/Intro]]');
  assert.equal(plan.warnings.length, 1);
  assert.equal(env.index.links('A/sub/Doc.md')[0].resolvedPage, 'A/Intro.md');
});

test('already-broken or ambiguous wikilinks are not touched', async (t) => {
  const env = await setup(t, {
    'X/Intro.md': '# Intro X',
    'Y/Intro.md': '# Intro Y',
    'Z/Page.md': '[[Intro]] [[Nothing]]', // ambiguous and broken
    'Dest.md': '',
  });
  const plan = await move(env, 'Z/Page.md', 'Dest.md');
  assert.equal(plan.files.length, 0);
  assert.equal(await env.w.read('Dest/Page.md'), '[[Intro]] [[Nothing]]');
});

test('a page linking to itself by name follows its own rename', async (t) => {
  const env = await setup(t, { 'Self.md': 'see [[Self]] and [me](Self.md)' });
  await rename(env, 'Self.md', 'Other');
  assert.equal(await env.w.read('Other.md'), 'see [[Other]] and [me](Other.md)');
});

// ------------------------------------------------------------------ misc

test('virtual pages (folders without a page file) can be moved; links to their children follow', async (t) => {
  const env = await setup(t, { 'V/X.md': '# X', 'Dest.md': '', 'Z.md': '[x](V/X.md) [[X]]' });
  assert.equal(env.index.getPage('V.md').isVirtual, true);
  await move(env, 'V.md', 'Dest.md');
  assert.equal(await env.w.read('Z.md'), '[x](Dest/V/X.md) [[X]]');
  assert.equal(brokenCount(env), 0);
});

test('line endings and BOMs are preserved', async (t) => {
  const env = await setup(t, {
    'A/Grace.md': 'no heading',
    'Crlf.md': '# C\r\n\r\n[x](A/Grace.md)\r\n[[Grace]]\r\n',
    'Bom.md': '\uFEFF---\na: 1\n---\n[x](A/Grace.md)',
  });
  await rename(env, 'A/Grace.md', 'Mercy');
  assert.equal(await env.w.read('Crlf.md'), '# C\r\n\r\n[x](A/Mercy.md)\r\n[[Mercy]]\r\n');
  assert.equal(await env.w.read('Bom.md'), '\uFEFF---\na: 1\n---\n[x](A/Mercy.md)');
});

test('files that are not valid UTF-8 are left untouched, with a warning', async (t) => {
  const env = await setup(t, { 'A/Grace.md': '# Grace' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(env.w.abs('Latin.md'), Buffer.concat([Buffer.from('[x](A/Grace.md) caf'), Buffer.from([0xe9])]));
  await env.index.reconcile();
  const plan = await planMove({ tree: env.tree, index: env.index, from: 'A/Grace.md', newParent: null });
  assert.deepEqual(plan.files, []);
  assert.match(plan.warnings[0].message, /UTF-8/);
});

test('plans are previewable, describe every rewrite, and are plain JSON', async (t) => {
  const env = await setup(t, { 'A/Grace.md': 'no heading', 'Z.md': 'intro\n\n[x](A/Grace.md) and [[Grace]]' });
  const plan = await planRename({ tree: env.tree, index: env.index, page: 'A/Grace.md', newName: 'Mercy' });
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  assert.deepEqual(describePlan(plan), ['Z.md:3  A/Grace.md  →  A/Mercy.md', 'Z.md:3  Grace  →  Mercy']);
  assert.deepEqual(plan.summary, { pagesMoved: 1, filesEdited: 1, linksRewritten: 2, warnings: 0 });
  assert.equal(await env.w.exists('A/Grace.md'), true); // planning changed nothing
});

test('a no-op move produces an empty plan', async (t) => {
  const env = await setup(t, { 'A.md': '# A', 'Z.md': '[a](A.md)' });
  const plan = await planMove({ tree: env.tree, index: env.index, from: 'A.md', newParent: null });
  assert.equal(plan.noop, true);
  const res = await applyPlan(plan, { tree: env.tree });
  assert.equal(res.filesEdited, 0);
});

test('tree errors surface from planning (collision, moving into itself)', async (t) => {
  const env = await setup(t, { 'A.md': '', 'A/B.md': '', 'C.md': '' });
  await assert.rejects(planMove({ tree: env.tree, index: env.index, from: 'A.md', newParent: 'A/B.md' }), { code: 'MOVE_INTO_SELF' });
  await assert.rejects(planRename({ tree: env.tree, index: env.index, page: 'A.md', newName: 'C' }), { code: 'COLLISION' });
});

test('an index that is out of date is refreshed before planning', async (t) => {
  const env = await setup(t, { 'A/Grace.md': '# Grace', 'Z.md': '# Z' });
  await env.w.write('Z.md', '# Z\n[late](A/Grace.md)'); // added after the index was built
  const plan = await planRename({ tree: env.tree, index: env.index, page: 'A/Grace.md', newName: 'Mercy' });
  assert.equal(plan.summary.linksRewritten, 1);
});
