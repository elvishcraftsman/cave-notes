import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex, parseQuery, HIGHLIGHT_START, HIGHLIGHT_END } from '../src/index.js';
import { tmpRoot, ws, paths } from './helpers.js';

const CORPUS = {
  'Theology.md': '---\nstatus: draft\ntags: [a, b]\ndue: 2026-11-01\nweight: 5\n---\n# Theology\nGrace and faith. See [[Grace]] and [[Soteriology]].',
  'Theology/Grace.md': "---\naliases: [Charis]\nstatus: review\ntags: [a]\ndue: 2026-12-15\nweight: 10\n---\n# Grace\nGod's favor and justification by faith.\n\n## Imputation\nsome text",
  'Theology/Soteriology.md': '---\nstatus: done\ntags: [b]\nweight: 3\n---\n# Soteriology\n[[Grace]] mentioned. Heresy is condemned.',
  'Theology/Soteriology/Imputation.md': '# Imputed righteousness\nleaf page',
  'Notes.md': '# Notes\nheresy and grace',
  'V/Kid.md': '# Kid\n[[Missing]]',
};

const G = 'Theology/Grace.md';
const S = 'Theology/Soteriology.md';
const I = 'Theology/Soteriology/Imputation.md';
const T = 'Theology.md';

async function setup(t) {
  const root = await tmpRoot(t);
  await ws(root).writeAll(CORPUS);
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  return idx;
}

const q = (idx, query, opts) => [...paths(idx.search(query, opts))].sort();

// ------------------------------------------------------------------ full text

test('full-text: words, prefix on the last word, phrases, exclusion', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'grace'), ['Notes.md', T, G, S]);
  assert.deepEqual(q(idx, 'favo'), [G]); // prefix on the last bare word
  assert.deepEqual(q(idx, '"favo"'), []); // a quoted phrase is exact
  assert.deepEqual(q(idx, 'favo', { prefixLast: false }), []);
  assert.deepEqual(q(idx, '"justification by faith"'), [G]);
  assert.deepEqual(q(idx, 'grace -heresy'), [T, G]);
  assert.deepEqual(q(idx, 'grace faith'), [T, G]); // implicit AND
  assert.deepEqual(q(idx, 'faith grace'), [T, G]);
});

test('full-text: stemming and diacritics', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'imputed'), [G, I]); // "Imputation" heading text and "Imputed" title share a stem
  assert.deepEqual(q(idx, 'GRÀCE'), q(idx, 'grace'));
});

test('title: and body: restrict the full-text column', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'title:righteousness'), [I]);
  assert.deepEqual(q(idx, 'title:grace'), [G]);
  assert.deepEqual(q(idx, 'body:leaf'), [I]);
  assert.deepEqual(q(idx, 'title:leaf'), []);
  assert.deepEqual(q(idx, 'body:righteousness'), [I]); // the body includes heading text
  assert.deepEqual(q(idx, 'grace -title:grace'), ['Notes.md', T, S]);
});

test('snippets carry control-character highlight markers, never HTML', async (t) => {
  const idx = await setup(t);
  const hit = idx.search('faith').results.find((r) => r.path === G);
  assert.ok(hit.snippet.includes(`${HIGHLIGHT_START}faith${HIGHLIGHT_END}`), hit.snippet);
  assert.equal(typeof hit.rank, 'number');
  assert.equal(idx.search('status:draft').results[0].snippet, null);
});

// ------------------------------------------------------------------ attributes

test('attributes: equals, any-of, negation, wildcard, case-insensitive keys and values', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'status:draft'), [T]);
  assert.deepEqual(q(idx, 'STATUS:Draft'), [T]);
  assert.deepEqual(q(idx, 'status:draft,review'), [T, G]);
  assert.deepEqual(q(idx, 'status:rev*'), [G]);
  assert.deepEqual(q(idx, '-status:done'), ['Notes.md', T, G, I, 'V.md', 'V/Kid.md']); // pages without status match too
  assert.deepEqual(q(idx, 'status:"draft"'), [T]);
  assert.deepEqual(q(idx, 'status:nonexistent'), []);
});

test('attributes: list values (all-of with repeats, any-of with commas)', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'tags:a'), [T, G]);
  assert.deepEqual(q(idx, 'tags:a tags:b'), [T]);
  assert.deepEqual(q(idx, 'tags:a,b'), [T, G, S]);
  assert.deepEqual(q(idx, 'tags:b -tags:a'), [S]);
});

test('attributes: numeric comparisons and ranges', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'weight:>=5'), [T, G]);
  assert.deepEqual(q(idx, 'weight:>5'), [G]);
  assert.deepEqual(q(idx, 'weight:<5'), [S]);
  assert.deepEqual(q(idx, 'weight:<=5'), [T, S]);
  assert.deepEqual(q(idx, 'weight:3..5'), [T, S]);
  assert.deepEqual(q(idx, 'weight:..5'), [T, S]);
  assert.deepEqual(q(idx, 'weight:10..'), [G]);
  assert.deepEqual(q(idx, 'weight:=5'), [T]);
  assert.deepEqual(q(idx, 'weight:9'), []);
});

test('attributes: date comparisons and ranges', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'due:<2026-12-01'), [T]);
  assert.deepEqual(q(idx, 'due:>2026-12-01'), [G]);
  assert.deepEqual(q(idx, 'due:2026-11-01..2026-12-31'), [T, G]);
  assert.deepEqual(q(idx, 'due:2026-11-01'), [T]);
  assert.deepEqual(q(idx, 'due:2026-11*'), [T]);
});

test('attributes: mixing a date and a number in one range is reported, not run', async (t) => {
  const idx = await setup(t);
  const r = idx.search('weight:2026-01-01..5');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /cannot compare/);
});

test('has: and combined filters', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'has:due'), [T, G]);
  assert.deepEqual(q(idx, '-has:due'), ['Notes.md', S, I, 'V.md', 'V/Kid.md']);
  assert.deepEqual(q(idx, 'has:due,weight'), [T, G, S]);
  assert.deepEqual(q(idx, 'grace status:draft,done tags:b'), [T, S]);
  assert.deepEqual(q(idx, 'heresy weight:<5'), [S]);
});

// ------------------------------------------------------------------ structure

test('is: filters', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'is:leaf'), ['Notes.md', G, I, 'V/Kid.md']);
  assert.deepEqual(q(idx, 'is:root'), ['Notes.md', T, 'V.md']);
  assert.deepEqual(q(idx, 'is:virtual'), ['V.md']);
  assert.deepEqual(q(idx, 'is:broken'), ['V/Kid.md']);
  assert.deepEqual(q(idx, 'is:orphan'), ['Notes.md', T, I, 'V.md', 'V/Kid.md']);
  assert.deepEqual(q(idx, '-is:virtual -is:orphan'), [G, S]);
  assert.equal(idx.search('is:bogus').errors.length, 1);
});

test('under: lists descendants by path, title, alias or name', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'under:Theology'), [G, S, I]);
  assert.deepEqual(q(idx, 'under:"Theology/Soteriology"'), [I]);
  assert.deepEqual(q(idx, 'under:Soteriology.md'), [I]);
  assert.deepEqual(q(idx, 'under:Nonexistent'), []);
  assert.deepEqual(q(idx, 'under:Theology grace'), [G, S]);
  assert.deepEqual(q(idx, 'under:V'), ['V/Kid.md']); // virtual pages work too
});

test('links-to / backlinks / linked-from follow resolved links, including aliases', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'links-to:Grace'), [T, S]);
  assert.deepEqual(q(idx, 'backlinks:Charis'), [T, S]);
  assert.deepEqual(q(idx, 'linked-from:Theology'), [G, S]);
  assert.deepEqual(q(idx, 'links-to:Nobody'), []);
  assert.deepEqual(q(idx, '-links-to:Grace under:Theology'), [G, I]);
});

test('path: and heading: filters', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'path:soter'), [S, I]);
  assert.deepEqual(q(idx, 'path:100%'), []); // LIKE wildcards are escaped
  assert.deepEqual(q(idx, 'heading:imputation'), [G]);
});

// ------------------------------------------------------------------ sorting & paging

test('sort: built-ins and attributes (missing values always last)', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(paths(idx.search('has:weight sort:-weight')), [G, T, S]);
  assert.deepEqual(paths(idx.search('has:weight sort:weight')), [S, T, G]);
  const all = paths(idx.search('sort:weight'));
  assert.deepEqual(all.slice(0, 3), [S, T, G]);
  const allDesc = paths(idx.search('sort:-weight'));
  assert.deepEqual(allDesc.slice(0, 3), [G, T, S]); // pages without weight still last
  assert.deepEqual(paths(idx.search('has:status sort:status')), [S, T, G]); // done, draft, review
  assert.deepEqual(paths(idx.search('under:Theology sort:-title')), [S, I, G]);
  assert.deepEqual(paths(idx.search('is:root sort:title')), ['Notes.md', T, 'V.md']);
  assert.deepEqual(paths(idx.search('has:due sort:-due')), [G, T]);
});

test('default order is title; text queries rank by relevance with title boosted', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(paths(idx.search('')).slice(0, 3), [G, I, 'V/Kid.md']);
  const ranked = paths(idx.search('grace'));
  assert.equal(ranked[0], G); // "Grace" in the title wins
});

test('pagination reports the total', async (t) => {
  const idx = await setup(t);
  const page = idx.search('', { limit: 2, offset: 1 });
  assert.deepEqual(page.results.map((r) => r.path), [I, 'V/Kid.md']);
  assert.equal(page.total, 7);
  assert.equal(idx.search('grace', { limit: 1 }).total, 4);
});

// ------------------------------------------------------------------ robustness

test('incomplete tokens are ignored while typing', async (t) => {
  const idx = await setup(t);
  assert.equal(idx.search('status:').total, 7);
  assert.equal(idx.search('-').total, 7);
  assert.equal(idx.search('   ').total, 7);
  assert.equal(idx.search('tags:a status:').total, 2);
  assert.deepEqual(q(idx, 'status:draft sort:'), [T]);
});

test('hostile or malformed input never throws or damages the index', async (t) => {
  const idx = await setup(t);
  const before = idx.stats();
  const nasty = [
    '"unbalanced', 'AND OR NOT', '(', ')', '*', '**', '""', "'; DROP TABLE pages; --", 'a:"b', 'status:"x" OR 1=1',
    'title:', 'NEAR(a b)', 'x'.repeat(5000), '\u0000', '\u0001\u0002', 'tags:%', 'path:_', '-"', '-title:"', 'sort:-', 'due:>', 'weight:..',
    'under:' + '"'.repeat(10), 'status:\\', '{a b}', '^a', 'a + b', 'a:b:c',
  ];
  for (const s of nasty) {
    const r = idx.search(s);
    assert.ok(Array.isArray(r.results), s);
    assert.ok(Array.isArray(r.errors), s);
  }
  assert.deepEqual(idx.stats(), before);
  assert.equal(idx.search('status:draft').total, 1); // still works afterwards
});

test('parseQuery exposes terms for rendering filter chips', () => {
  const { terms } = parseQuery('a "b c" -d status:x,y due:>=2026-01-01 weight:1..5 -is:orphan sort:-title title:foo');
  assert.deepEqual(
    terms.map((t) => [t.type, t.negated, t.key ?? t.column ?? null, t.kind ?? (t.phrase ? 'phrase' : null)]),
    [
      ['text', false, null, null],
      ['text', false, null, 'phrase'],
      ['text', true, null, null],
      ['attr', false, 'status', 'any'],
      ['attr', false, 'due', 'cmp'],
      ['attr', false, 'weight', 'range'],
      ['special', true, 'is', null],
      ['special', false, 'sort', null],
      ['text', false, 'title', null],
    ],
  );
  assert.deepEqual(terms[3].values, ['x', 'y']);
  assert.deepEqual([terms[4].op, terms[4].value], ['>=', '2026-01-01']);
  assert.equal(terms[0].raw, 'a');
});

// ------------------------------------------------------------------ facets

test('attributeKeys lists keys with page counts', async (t) => {
  const idx = await setup(t);
  const keys = Object.fromEntries(idx.attributeKeys().map((k) => [k.key, [k.pages, k.type]]));
  assert.deepEqual(keys, {
    status: [3, 'string'], tags: [3, 'string'], weight: [3, 'number'], due: [2, 'date'], aliases: [1, 'string'],
  });
});

test('attributeValues gives value counts, optionally within a query (for filter dropdowns)', async (t) => {
  const idx = await setup(t);
  const vals = (key, query) => idx.attributeValues(key, { query }).map((v) => [v.value, v.count]);
  assert.deepEqual(vals('tags'), [['a', 2], ['b', 2]]);
  assert.deepEqual(vals('status'), [['done', 1], ['draft', 1], ['review', 1]]);
  assert.deepEqual(vals('status', 'under:Theology'), [['done', 1], ['review', 1]]);
  assert.deepEqual(vals('status', 'grace -heresy'), [['draft', 1], ['review', 1]]);
  assert.deepEqual(vals('tags', 'tags:a'), [['a', 2], ['b', 1]]);
  assert.deepEqual(vals('nope'), []);
});

// ------------------------------------------------------------------ groups: AND, OR, NOT, parentheses

test('groups: OR, NOT and parentheses', async (t) => {
  const idx = await setup(t);
  assert.deepEqual(q(idx, 'status:draft OR status:done'), [T, S]);
  assert.deepEqual(q(idx, '(status:draft OR status:done) weight:>=4'), [T]);
  assert.deepEqual(q(idx, 'status:draft OR status:done weight:3'), [T, S].filter((p) => p !== T).concat(T).sort()); // AND binds tighter: draft, or (done and weight 3)
  assert.deepEqual(q(idx, 'NOT status:draft has:status'), [G, S]);
  assert.deepEqual(q(idx, 'has:status -(status:draft OR status:review)'), [S]);
  assert.deepEqual(q(idx, 'has:status NOT (status:draft OR status:review)'), [S]);
  assert.deepEqual(q(idx, 'status:draft AND tags:a'), [T]);
  // nested
  assert.deepEqual(q(idx, '(status:draft OR (status:review AND weight:10)) tags:a'), [T, G]);
  // words inside a group
  assert.deepEqual(q(idx, '(heresy OR charis) has:status'), [S].concat(q(idx, 'charis has:status')).sort());
  // lower case or/and/not are ordinary words
  assert.deepEqual(q(idx, 'grace and faith'), q(idx, 'grace faith'));
});

test('groups keep sort and the word ranking working', async (t) => {
  const idx = await setup(t);
  const r = idx.search('grace (status:draft OR status:review) sort:-weight');
  assert.deepEqual(paths(r), [G, T]);
});

// ------------------------------------------------------------------ $now and date parts

const NOW = new Date(2026, 10, 14); // 14 November 2026

test('$now: whole days, months, years and the comparisons', async (t) => {
  const idx = await setup(t);
  const at = (query) => [...paths(idx.search(query, { now: NOW }))].sort();
  assert.deepEqual(at('due:$now.month'), [T]);                  // 2026-11-01 is in November 2026
  assert.deepEqual(at('due:$now.month+1'), [G]);                // December
  assert.deepEqual(at('due:$now.year'), [T, G]);
  assert.deepEqual(at('due:$now.day'), []);
  assert.deepEqual(at('due:<$now.month'), []);                  // before the start of November
  assert.deepEqual(at('due:>$now.month'), [G]);                 // after the end of November
  assert.deepEqual(at('due:>=$now.month'), [T, G]);
  assert.deepEqual(at('due:<=$now.month'), [T]);
  assert.deepEqual(at('due:$now.month..$now.month+1'), [T, G]);
  assert.deepEqual(at('due:$now.month-1..$now.month'), [T]);
  assert.deepEqual(at('-due:$now.month has:due'), [G]);
  assert.deepEqual(at('due:<$now.day+30'), [T]);                // before 14 December
});

test('$now.week starts on Sunday unless told otherwise', async (t) => {
  const { periodRange, setWeekStart } = await import('../src/query.js');
  t.after(() => setWeekStart(0));
  // Saturday 14 November 2026: the week is Sunday 8th to Saturday 14th
  const r = periodRange('week', 0, NOW);
  assert.equal(new Date(r.lo).toISOString(), '2026-11-08T00:00:00.000Z');
  assert.equal(new Date(r.hi).toISOString(), '2026-11-14T23:59:59.999Z');
  setWeekStart(1); // Monday: the 9th to the 15th
  const m = periodRange('week', 0, NOW);
  assert.equal(new Date(m.lo).toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(new Date(m.hi).toISOString(), '2026-11-15T23:59:59.999Z');
  assert.equal(new Date(periodRange('week', 1, NOW).lo).toISOString(), '2026-11-16T00:00:00.000Z');
});

test('date parts: the same month or day in any year', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({
    'A.md': '---\nbirthday: 1980-11-14\n---\n# A',
    'B.md': '---\nbirthday: 1991-11-02\n---\n# B',
    'C.md': '---\nbirthday: 2001-03-14\n---\n# C',
    'D.md': '---\nbirthday: 1975-01-20\n---\n# D',
  });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  const at = (query) => [...paths(idx.search(query, { now: NOW }))].sort();
  assert.deepEqual(at('birthday.month:$now.month'), ['A.md', 'B.md']);
  assert.deepEqual(at('birthday.month:$now.month birthday.day:$now.day'), ['A.md']);   // an anniversary today
  assert.deepEqual(at('birthday.day:$now.day'), ['A.md', 'C.md']);
  assert.deepEqual(at('birthday.month:11..12'), ['A.md', 'B.md']);
  assert.deepEqual(at('birthday.month:11..2'), ['A.md', 'B.md', 'D.md']);                 // a range may wrap past December
  assert.deepEqual(at('birthday.month:$now.month+1'), []);
  assert.deepEqual(at('birthday.month:$now.month-1'), []);
  assert.deepEqual(at('birthday.year:<1990'), ['A.md', 'D.md']);
  assert.deepEqual(at('birthday.year:$now.year'), []);
  assert.deepEqual(at('birthday.weekday:1,2'), at('birthday.weekday:1,2')); // runs without error
  assert.equal(idx.search('birthday.month:abc', { now: NOW }).errors.length, 1);
});

// ------------------------------------------------------------------ filename, filetype and files that are not notes

test('every file takes part: filename and filetype, and under:', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    'Project.md': '# Project',
    'Project/Notes.txt': 'plain',
    'Project/Sub.md': '# Sub',
    'Project/photo.JPG': 'x',
    'Project/data/table.csv': 'a,b',
    'Project/.hidden.png': 'x',
    'Other/readme': 'x',
  });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(q(idx, 'under:Project filetype:jpg'), ['Project/photo.JPG']);
  assert.deepEqual(q(idx, 'under:Project filetype:.csv'), ['Project/data/table.csv']);
  assert.deepEqual(q(idx, 'under:Project filetype:md'), ['Project/Sub.md']);
  assert.deepEqual(q(idx, 'filetype:md,txt under:Project'), ['Project/Notes.txt', 'Project/Sub.md']);
  assert.deepEqual(q(idx, 'filename:photo.jpg'), ['Project/photo.JPG']);
  assert.deepEqual(q(idx, 'filename:Sub*'), ['Project/Sub.md']);
  // (with the default note types only .md is a note, so Notes.txt is a file here)
  assert.deepEqual(q(idx, 'under:Project is:file'), ['Project/Notes.txt', 'Project/data/table.csv', 'Project/photo.JPG']);
  assert.deepEqual(q(idx, 'is:file -filetype:csv'), ['Other/readme', 'Project/Notes.txt', 'Project/photo.JPG']);
  // a file with no extension has no type; hidden files are not listed
  assert.deepEqual(q(idx, 'under:Other'), ['Other/readme']);
  assert.deepEqual(q(idx, 'filename:.hidden.png'), []);
  assert.deepEqual(paths(idx.search('is:file sort:filetype,filename')), ['Other/readme', 'Project/data/table.csv', 'Project/photo.JPG', 'Project/Notes.txt']);
});

// ------------------------------------------------------------------ mtime

test('mtime: when the file was last changed, in the same terms as a date attribute', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({ 'Old.md': '# Old\n', 'Mid.md': '# Mid\n', 'New.md': '# New\n', 'Folder/Child.md': '# Child\n' }); // Folder has no page of its own
  const day = 86400000;
  const set = async (rel, daysAgo) => {
    const when = new Date(NOW.getTime() - daysAgo * day + 12 * 3600_000);
    await fs.utimes(path.join(root, rel), when, when);
  };
  await set('Old.md', 45);
  await set('Mid.md', 10);
  await set('New.md', 0);
  await set('Folder/Child.md', 0);
  const idx = await openIndex(root, { workers: 0, dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  const at = (q) => paths(idx.search(q, { now: NOW })).sort();
  assert.deepEqual(at('mtime:<$now.day-30'), ['Old.md']);
  assert.deepEqual(at('mtime:>$now.day-30'), ['Folder/Child.md', 'Mid.md', 'New.md']);
  assert.deepEqual(at('mtime:$now.day'), ['Folder/Child.md', 'New.md']);
  assert.deepEqual(at('mtime:$now.week-2..$now.week'), ['Folder/Child.md', 'Mid.md', 'New.md']);
  assert.deepEqual(at('-mtime:<$now.day-30').filter((p) => p !== 'Folder.md'), ['Folder/Child.md', 'Mid.md', 'New.md']);
  assert.deepEqual(at('mtime:<$now.day-30 OR mtime:$now.day'), ['Folder/Child.md', 'New.md', 'Old.md']);
  const lit = (rel) => new Date(NOW.getTime() - rel * day);
  const d = lit(10);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.deepEqual(at(`mtime:${ymd}`), ['Mid.md']);
  assert.deepEqual(at(`mtime:>=${ymd}`), ['Folder/Child.md', 'Mid.md', 'New.md']);
  const bad = idx.search('mtime:<soon', { now: NOW });
  assert.match(bad.errors[0], /not a date/);
});

test('dates with a single-digit month or day are dates', async () => {
  const { parseDate } = await import('../src/attrs.js');
  assert.equal(parseDate('2026-11-1'), parseDate('2026-11-01'));
  assert.equal(parseDate('2026-1-5'), parseDate('2026-01-05'));
  assert.equal(parseDate('2026-2-31'), null);
});

test('unlisted pages stay out of results unless the query names the attribute', async (t) => {
  const root = await tmpRoot(t);
  await ws(root).writeAll({ 'A.md': '# A\nword', 'B.md': '---\nunlisted: true\n---\n# B\nword', 'C.md': '---\nunlisted: false\n---\n# C\nword' });
  const idx = await openIndex(root, { dbPath: ':memory:' });
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(q(idx, 'word'), ['A.md', 'C.md']);
  assert.deepEqual(q(idx, 'word unlisted:true'), ['B.md']);
  assert.deepEqual(q(idx, 'has:unlisted'), ['B.md', 'C.md']);
  assert.deepEqual(q(idx, 'word -unlisted:true'), ['A.md', 'C.md']);
});
