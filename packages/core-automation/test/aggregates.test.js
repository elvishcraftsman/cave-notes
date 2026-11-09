import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseExpr, hostCalls, rewritePageRefs, queryValue } from '../src/index.js';

test('totals and friends work on lists and on several values, skipping what is no number', () => {
  assert.equal(evaluate('sum(range(1, 4))', {}), 10);
  assert.equal(evaluate('avg(1, 2, "n/a", "", 6)', {}), 3);
  assert.equal(evaluate('max(3, 9, 4)', {}), 9);
  assert.equal(evaluate('min(range(5, 8))', {}), 5);
  assert.equal(evaluate('median(range(1, 4))', {}), 2.5);
  assert.equal(evaluate('avg(range(1, 0))', {}), null);
  assert.equal(evaluate('count(range(1, 5))', {}), 5);
  assert.equal(evaluate('percent(3, 8)', {}), 37.5);
  assert.equal(evaluate('commas(1234567.5, 1)', {}), '1,234,567.5');
  assert.equal(evaluate('fixed(2.5, 2)', {}), '2.50');
  assert.equal(evaluate('join(sort(unique(split("b, a, b", ","))), "-")', {}), 'a-b');
});

test('calls that read a query are found, and wait for the host', () => {
  const tree = parseExpr(rewritePageRefs('sum("under:[[Budget]]", "cost") + [[Budget]].total + count("x")'));
  assert.deepEqual(hostCalls(tree).map((c) => `${c.kind}:${c.name}`), ['query:sum', 'page:page', 'query:count']);
  assert.throws(() => evaluate('sum("a", "b")', {}), /text in quotes|automation rule/);
});

test('what a query found becomes the value', () => {
  const data = { count: 3, titles: ['A', 'B', 'C'], values: [{ type: 'number', text: '1', num: 1 }, { type: 'number', text: '4', num: 4 }, { type: 'string', text: 'n/a', num: null }] };
  assert.equal(queryValue('sum', ['q', 'x'], data), 5);
  assert.equal(queryValue('max', ['q', 'x'], data), 4);
  assert.equal(queryValue('count', ['q'], data), 3);
  assert.equal(queryValue('count', ['q', 'x'], data), 3);
  assert.deepEqual(queryValue('titles', ['q'], data), ['A', 'B', 'C']);
});
