import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAutomations } from '../src/index.js';
import { docRules } from './docs-text.js';
import { World, FakeWorkspace, makeEngine } from './helpers.js';

const RULES = `${docRules('list-to-headings')}${docRules('tidy').replace(/^rules:\n/, '')}${docRules('number-headings').replace(/^rules:\n/, '')}
  - id: not-a-plugin
    on: button
    do:
      - transform_text: { steps: [ trim_lines ] }
`;

const setup = async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '# A\n' });
  return makeEngine(world, ws, RULES);
};

const TEXT = '1. First\n   - a\n   - b\n2. Second\n   1. x\n   2. y\n3. Third';

test('plugins are listed with their questions', async () => {
  const { engine } = await setup();
  const list = engine.plugins();
  assert.deepEqual(list.map((p) => [p.id, p.label]), [['list-to-headings', 'Numbered list to headings'], ['tidy', 'Remove trailing spaces'], ['number-headings', 'Number headings at this level']]);
  assert.equal(list[0].ask[0].name, 'level');
  assert.equal(list[0].ask[0].default, 2);
});

test('a plugin transforms the text it is given, using the answers', async () => {
  const { engine } = await setup();
  const r = await engine.runPlugin('list-to-headings', { path: 'A.md', text: TEXT, selection: true, answers: { level: '3' } });
  assert.equal(r.status, 'done');
  assert.equal(r.changed, true);
  assert.equal(r.text, '### First\n- a\n- b\n### Second\n1. x\n2. y\n### Third');
  const d = await engine.runPlugin('list-to-headings', { path: 'A.md', text: TEXT, answers: {} }); // the default, 2
  assert.ok(d.text.startsWith('## First'));
});

test('bad answers, other rules and plain buttons are refused or fail without touching the text', async () => {
  const { engine } = await setup();
  const bad = await engine.runPlugin('list-to-headings', { path: 'A.md', text: TEXT, answers: { level: 9 } });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.text, TEXT);
  assert.match(bad.detail, /at most 6/);
  assert.equal((await engine.runPlugin('not-a-plugin', { path: 'A.md', text: TEXT })).status, 'refused');
  assert.equal((await engine.runPlugin('nope', { path: 'A.md', text: TEXT })).status, 'refused');
  const same = await engine.runPlugin('tidy', { path: 'A.md', text: 'clean' });
  assert.equal(same.changed, false);
});

test('transform_text outside a plugin fails clearly, and a bad regex is reported when the rules load', () => {
  const r = parseAutomations('rules:\n  - id: x\n    on: button\n    do:\n      - transform_text: { steps: [ { regex: { find: "(" , replace: "" } } ] }\n');
  assert.equal(r.rules.length, 1); // a regex is checked when it runs, like other actions
  const bad = parseAutomations('rules:\n  - id: y\n    on: plugin\n    ask: { q: { type: select } }\n    do:\n      - transform_text: { steps: [ trim_lines ] }\n');
  assert.equal(bad.rules.length, 0);
  assert.match(JSON.stringify(bad), /needs a list of options/);
});

test('a plugin can show a message worked out from the text (type: info, ${words})', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '# A\n' });
  const { engine } = await makeEngine(world, ws, `
rules:
  - id: page-count
    on: { plugin: "Estimate page count" }
    ask:
      result:
        type: info
        label: "\${words} words is about \${round(words / 250, 1)} pages\${selection ? ' (selected text)' : ''}."
    do:
      - log: "\${words} words"
`);
  const text = '# Title\n\n- one two three\n\n' + 'word '.repeat(497) + '\n---\n';
  assert.equal(engine.plugins()[0].ask[0].type, 'info');
  const [q] = await engine.pluginQuestions('page-count', { path: 'A.md', text, selection: false });
  assert.equal(q.label, '501 words is about 2 pages.');
  const [s] = await engine.pluginQuestions('page-count', { path: 'A.md', text: 'one two three', selection: true });
  assert.equal(s.label, '3 words is about 0 pages (selected text).');
  // asking the person for nothing: the answers need no value for an info line
  const res = await engine.runPlugin('page-count', { path: 'A.md', text, selection: false, answers: {} });
  assert.equal(res.status, 'done');
  assert.equal(res.changed, false);
});

test('the documented list-to-headings plugin makes top level headings and moves the rest up one level', async () => {
  const { engine } = await setup();
  const run = (text, level) => engine.runPlugin('list-to-headings', { path: 'A.md', text, answers: { level } });
  assert.equal((await run(TEXT, 2)).text, '## First\n- a\n- b\n## Second\n1. x\n2. y\n## Third');
  assert.equal((await run('- one\n    - deep\n        - deeper', 3)).text, '### one\n- deep\n    - deeper');
  assert.equal((await run('plain\n- one', 1)).text, 'plain\n# one');
});

const DOC = '# Book\n\n## Intro\ntext\n\n## Body\n\n### Alpha\n\n### Beta\n\n## 7. End\n\n# Second\n\n## Other\n\n```\n## not a heading\n```\n\n## Last\n';
const numbered = async (cursorAt, text = DOC) => {
  const { engine } = await setup();
  return engine.runPlugin('number-headings', { path: 'A.md', text, cursor: text.indexOf(cursorAt) });
};

test('number-headings numbers the headings of the cursor level inside the section one level up', async () => {
  const r = await numbered('Intro');
  assert.equal(r.status, 'done', r.detail);
  // only the ## headings of the first # section; the one that was already numbered is renumbered, not stacked
  assert.equal(r.text, DOC.replace('## Intro', '## 1. Intro').replace('## Body', '## 2. Body').replace('## 7. End', '## 3. End'));
  // the cursor stays on the same word
  assert.equal(r.text.slice(r.selection.head, r.selection.head + 5), 'Intro');
});

test('number-headings: from under a deeper heading, in another section, at the top level and not inside code', async () => {
  const deep = await numbered('Beta');
  assert.equal(deep.text, DOC.replace('### Alpha', '### 1. Alpha').replace('### Beta', '### 2. Beta'));
  const second = await numbered('Other');
  assert.equal(second.text, DOC.replace('## Other', '## 1. Other').replace('## Last', '## 2. Last'));
  const top = await numbered('Second');
  assert.equal(top.text, DOC.replace('# Book', '# 1. Book').replace('# Second', '# 2. Second'));
  // running it again changes nothing more
  const again = await numbered('Intro', deep.text);
  assert.ok(!/1\. 1\./.test(again.text));
});

test('number-headings tells the person what to do when there is no heading or no cursor', async () => {
  const none = await numbered('plain', 'plain text\n');
  assert.equal(none.status, 'failed');
  assert.match(none.detail, /Put the cursor in or under a heading/);
  const { engine } = await setup();
  const noCursor = await engine.runPlugin('number-headings', { path: 'A.md', text: DOC });
  assert.equal(noCursor.status, 'failed');
  assert.match(noCursor.detail, /needs the editor's cursor/);
  assert.equal(noCursor.text, DOC);
});

const JS_RULES = `
rules:
  - id: caret
    on: { plugin: "Move" }
    do:
      - run_js:
          code: |
            return { text: text + "!", select: { from: { line: 1, column: 1 }, to: 3 } };
  - id: words
    on: { schedule: "0 6 * * *" }
    where: kind:note
    do:
      - run_js:
          code: |
            log("counting");
            const front = frontmatter(text);
            const body = front ? text.slice(front.end) : text;
            return { props: { words: body.split(/\\s+/).filter(Boolean).length, due: fn.add(today, "1d") } };
  - id: rewrite
    on: { change: status }
    do:
      - run_js:
          code: |
            return text.replace("old", "new");
  - id: bad-props
    on: { plugin: "Bad" }
    do:
      - run_js: { code: "return { props: { a: 1 } };" }
  - id: broken
    on: { plugin: "Broken" }
    do:
      - run_js: { code: "return (;" }
`;

test('run_js: a script with a syntax mistake is rejected when the rules load', () => {
  const r = parseAutomations(JS_RULES);
  assert.ok(r.rules.find((x) => x.id === 'caret'));
  assert.ok(!r.rules.find((x) => x.id === 'broken'));
  assert.match(JSON.stringify(r), /the script has a mistake/);
});

test('run_js in a plugin moves the cursor or the selection, and cannot set properties', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '# A\n' });
  const { engine } = await makeEngine(world, ws, JS_RULES);
  const r = await engine.runPlugin('caret', { path: 'A.md', text: 'one\ntwo', cursor: 1 });
  assert.equal(r.text, 'one\ntwo!');
  assert.deepEqual(r.selection, { anchor: 0, head: 3 });
  const bad = await engine.runPlugin('bad-props', { path: 'A.md', text: 'x' });
  assert.equal(bad.status, 'failed');
  assert.match(bad.detail, /cannot set properties/);
});

test('run_js in an ordinary rule reads the page and sets its properties, and writes changed text', async () => {
  const world = new World(new Date(2026, 9, 15, 8, 0));
  const ws = new FakeWorkspace(world, {
    'N.md': '---\nkind: note\n---\n# N\none two three\n',
    'S.md': '---\nstatus: open\n---\n# S\nold text\n',
  });
  const { engine } = await makeEngine(world, ws, JS_RULES);
  world.at(2026, 10, 16, 6, 0);
  await engine.tick();
  assert.equal(ws.front('N.md').words, 5); // "# N one two three"
  assert.equal(String(ws.front('N.md').due), '2026-10-17');
  const { changed } = await import('./helpers.js');
  ws.set('S.md', '---\nstatus: done\n---\n# S\nold text\n');
  await changed(engine, 'S.md');
  assert.ok(ws.text('S.md').includes('new text'));
});

test('run_js is not run in a dry run, and a host can refuse it', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'S.md': '---\nstatus: open\n---\n# S\nold\n' });
  const { engine, host } = await makeEngine(world, ws, JS_RULES);
  const dry = await engine.runNow('rewrite', { dry: true, path: 'S.md' });
  assert.match(JSON.stringify(dry), /would run JavaScript/);
  assert.ok(ws.text('S.md').includes('old'));
  host.js = async () => ({ denied: true, reason: 'JavaScript is switched off in Preferences' });
  const r = await engine.runPlugin('caret', { path: 'S.md', text: 'x', cursor: 0 });
  assert.equal(r.status, 'failed');
  assert.match(r.detail, /switched off in Preferences/);
});

test('a plugin can have its own icon and a several-line description', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '# A\n' });
  const rules = `
rules:
  - id: fancy
    name: Fancy
    icon: wand-sparkles
    description: |
      First line of the text.
      Second line.

      A new paragraph.
    on: { plugin: "Fancy plugin" }
    do:
      - transform_text: { steps: [ trim_lines ] }
  - id: bad-icon
    icon: "Not An Icon!"
    on: { plugin: "Plain" }
    do:
      - transform_text: { steps: [ trim_lines ] }
`;
  const { engine } = await makeEngine(world, ws, rules);
  const [fancy, plain] = engine.plugins();
  assert.equal(fancy.icon, 'wand-sparkles');
  assert.equal(fancy.description, 'First line of the text.\nSecond line.\n\nA new paragraph.');
  assert.equal(plain.icon, undefined, 'an icon name that is not a plain name is left out');
  assert.equal(plain.description, undefined);
});
