import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { tmpRoot, ws, paths } from './helpers.js';

async function sample(t) {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Doctrine.md': '# Doctrine',
    'Doctrine/Scripture.md': '# Scripture',
    'Doctrine/Scripture/Canon.md': '# Canon',
    'Doctrine/Scripture/Canon/Council.md': '# Council',
    'Doctrine/Grace.md': '# Grace',
    'Other.md': '# Other',
    'Writing One.md': '---\ndoctrine: [[Scripture]]\n---\n# Writing One',
    'Writing Two.md': '---\ndoctrine: Scripture\n---\n# Writing Two',
    'Writing Three.md': '---\ndoctrine: "[[Doctrine/Grace|grace]]"\n---\n# Writing Three',
    'Writing Four.md': '---\ndoctrine: [[[Scripture]], [[Grace]]]\n---\n# Writing Four',
    'Tpl.md': '---\ntemplate: true\n---\n# Tpl',
    'Tpl Shown.md': '---\ntemplate: true\nunlisted: false\n---\n# Tpl Shown',
    'Secret.md': '---\nunlisted: true\n---\n# Secret',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  return idx;
}

test('an unquoted [[Page]] attribute is a link, and differs from the plain word', async (t) => {
  const idx = await sample(t);
  const at = idx.getPage('Writing One.md').attributes.doctrine;
  assert.equal(at[0].text, '[[Scripture]]');
  assert.deepEqual(paths(idx.search('doctrine:[[Scripture]]')).sort(), ['Writing Four.md', 'Writing One.md']);
  assert.deepEqual(paths(idx.search('doctrine:"[[Doctrine/Scripture]]"')).sort(), ['Writing Four.md', 'Writing One.md']);
  assert.deepEqual(paths(idx.search('doctrine:[[Grace]]')).sort(), ['Writing Four.md', 'Writing Three.md']);
  assert.deepEqual(paths(idx.search('doctrine:Scripture')), ['Writing Two.md']);
  assert.deepEqual(paths(idx.search('doctrine:[[Nowhere]]')), []);
});

test('over:, parent: and children:', async (t) => {
  const idx = await sample(t);
  assert.deepEqual(paths(idx.search('over:Council')).sort(), ['Doctrine.md', 'Doctrine/Scripture.md', 'Doctrine/Scripture/Canon.md']);
  assert.deepEqual(paths(idx.search('parent:Council')), ['Doctrine/Scripture/Canon.md']);
  assert.deepEqual(paths(idx.search('children:Doctrine')).sort(), ['Doctrine/Grace.md', 'Doctrine/Scripture.md']);
  assert.deepEqual(paths(idx.search('under:Doctrine children:Scripture')), ['Doctrine/Scripture/Canon.md']);
  assert.deepEqual(paths(idx.search('over:Other')), []);
  assert.deepEqual(paths(idx.search('children:Other')), []);
  assert.deepEqual(paths(idx.search('over:Nope')), []);
});

test('templates are unlisted unless they say otherwise', async (t) => {
  const idx = await sample(t);
  const all = paths(idx.search('', { limit: 100 }));
  assert.ok(!all.includes('Tpl.md'));
  assert.ok(!all.includes('Secret.md'));
  assert.ok(all.includes('Tpl Shown.md'));
  assert.deepEqual(paths(idx.search('template:true')).sort(), ['Tpl Shown.md', 'Tpl.md']);
  assert.deepEqual([...idx.unlistedPaths()].sort(), ['Secret.md', 'Tpl.md']);
  assert.ok(idx.hiddenPaths().has('Tpl.md'));
  assert.ok(!idx.hiddenPaths().has('Tpl Shown.md'));
});
