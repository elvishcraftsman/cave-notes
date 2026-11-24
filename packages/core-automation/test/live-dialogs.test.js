import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, numbersInText, normalizeAsk, previewAnswers } from '../src/index.js';
import { World, FakeWorkspace, makeEngine } from './helpers.js';

test('numbers() reads every number written in a text', () => {
  assert.deepEqual(numbersInText('12.50 30 7.25'), [12.5, 30, 7.25]);
  assert.deepEqual(numbersInText('$1,200.50\n$45\n(7)'), [1200.5, 45, -7]);
  assert.deepEqual(numbersInText('12,30, 4'), [12, 30, 4]);
  assert.deepEqual(numbersInText('-5 and -$3.25 and .5'), [-5, -3.25, 0.5]);
  assert.deepEqual(numbersInText('none here'), []);
  assert.equal(evaluate('sum(numbers("12.50 30 7.25"))', {}), 49.75);
  assert.deepEqual(evaluate('numbers(this.x)', { this: { x: [3, '4 5', null] } }), [3, 4, 5]);
  assert.deepEqual(evaluate('numbers(this.x)', { this: { x: 42 } }), [42]);
  assert.deepEqual(evaluate('numbers(this.x)', { this: { x: null } }), []);
});

test('highlight() is the value itself outside the text of a page', () => {
  assert.equal(evaluate('highlight(7, 7 > 5)', {}), 7);
  assert.equal(evaluate('highlight("a", false, "red")', {}), 'a');
  assert.throws(() => evaluate('highlight(1)', {}));
});

test('previewAnswers never refuses half-typed answers', () => {
  const ask = normalizeAsk({ n: { type: 'number', min: 0 }, t: { type: 'text' }, s: { options: ['a', 'b'] }, b: { type: 'boolean' }, i: { type: 'info', label: 'x' } });
  assert.deepEqual(previewAnswers(ask, { n: '', t: 'x', s: 'zzz', b: true }), { n: null, t: 'x', s: 'a', b: true });
  assert.deepEqual(previewAnswers(ask, { n: '-3' }), { n: -3, t: '', s: 'a', b: false });
});

const RULES = `
rules:
  - id: pay
    on: button
    let:
      left: "\${this.balance - ask.amount}"
    ask:
      amount: { type: number, label: "How much?", default: "\${this.usual}" }
      note:   { type: info, label: "Balance after: \${let.left}" }
      fixed:  { type: info, label: "Balance now: \${this.balance}" }
    do:
      - set_property: { balance: "\${let.left}" }
`;

test('a dialog label can follow the answers (ask, and let: worked out after them)', async () => {
  const world = new World();
  const ws = new FakeWorkspace(world, { 'A.md': '---\nbalance: 100\nusual: 30\n---\n# A\n' });
  const { engine } = await makeEngine(world, ws, RULES);
  // when the dialog opens, the answers are the defaults
  const first = await engine.buttonQuestions('pay', { path: 'A.md' });
  const by = (qs) => Object.fromEntries(qs.map((q) => [q.name, q]));
  let q = by(first.ask);
  assert.equal(q.amount.default, 30);
  assert.equal(q.note.label, 'Balance after: 70');
  assert.equal(q.note.live, true);
  assert.equal(q.fixed.live, undefined);
  // while it is open, what has been typed
  q = by((await engine.buttonQuestions('pay', { path: 'A.md', answers: { amount: '45' } })).ask);
  assert.equal(q.note.label, 'Balance after: 55');
  assert.equal(q.amount.default, 30); // the default does not follow the typing
  // a field that is still empty: that part of the label is a dash, not an error
  q = by((await engine.buttonQuestions('pay', { path: 'A.md', answers: { amount: '' } })).ask);
  assert.match(q.note.label, /^Balance after: /);
  // the run uses the answers as before
  const res = await engine.runButton('pay', 'A.md', { amount: 45 });
  assert.equal(res.status, 'done');
  assert.match(ws.text('A.md'), /balance: 55/);
});
