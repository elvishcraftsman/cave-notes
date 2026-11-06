import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbeds, stripFrontmatter, findSection, embeddedText, replaceEmbedded } from '../src/index.js';

const page = '---\ntitle: X\n---\n# Doc\n\nIntro\n\n## Setup\n\nStep one\n\n### Detail\n\nDeep\n\n## Next\n\nOther\n';

test('parseEmbeds: pages, headings, named blocks, inline', () => {
  const t = 'See ![[Page#Setup]] and ![[@footer]] or ![[Some Page]].';
  const e = parseEmbeds(t);
  assert.deepEqual(e.map((x) => [x.target, x.heading, x.named]), [['Page', 'Setup', false], ['footer', null, true], ['Some Page', null, false]]);
  assert.equal(t.slice(e[0].from, e[0].to), '![[Page#Setup]]');
  assert.deepEqual(parseEmbeds('[[plain]] and ![[]]'), []);
});

test('stripFrontmatter only removes a leading block', () => {
  assert.equal(stripFrontmatter(page).startsWith('# Doc'), true);
  assert.equal(stripFrontmatter('a\n---\nb\n---\n'), 'a\n---\nb\n---\n');
});

test('a section runs to the next heading of the same or higher level', () => {
  const s = findSection(stripFrontmatter(page), 'Setup');
  assert.equal(s.text, 'Step one\n\n### Detail\n\nDeep');
  assert.equal(findSection(stripFrontmatter(page), 'detail').text, 'Deep');
  assert.equal(findSection(stripFrontmatter(page), 'nothing'), null);
});

test('headings inside code fences are ignored', () => {
  const t = '## A\n\n```\n## Not\n```\n\ntext\n\n## B\n';
  assert.equal(findSection(t, 'A').text, '```\n## Not\n```\n\ntext');
});

test('embeddedText: whole page and a missing heading', () => {
  assert.equal(embeddedText(page, null).text.startsWith('# Doc'), true);
  assert.equal(embeddedText(page, 'Nope').ok, false);
});

test('replaceEmbedded edits only that section', () => {
  const next = replaceEmbedded(page, 'Next', 'Changed\n');
  assert.equal(next, page.replace('Other', 'Changed'));
  const mid = replaceEmbedded(page, 'Detail', 'New deep');
  assert.ok(mid.includes('### Detail\n\nNew deep\n\n## Next'));
  assert.equal(replaceEmbedded(page, 'Missing', 'x'), null);
  assert.ok(replaceEmbedded(page, null, 'All new').startsWith('---\ntitle: X\n---\nAll new'));
});
