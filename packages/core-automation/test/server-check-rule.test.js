import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateValue, parseDateValue, parseAutomations, evaluate, render } from '../src/index.js';

const RULE = `
rules:
  - id: server-morning-check
    name: Morning server check
    on: { schedule: "0 8 * * *" }
    where: kind:server-status
    do:
      - notify: { title: "Server not reporting", body: "Last report: \${coalesce(this.checked, this.modified)}" }
        if: coalesce(this.checked, this.modified) == null || coalesce(this.checked, this.modified) < sub(now, "12h")
      - stop: true
        if: coalesce(this.checked, this.modified) == null || coalesce(this.checked, this.modified) < sub(now, "12h")
      - notify: { title: "Server problem (\${this.status})", body: "\${if(is_empty(this.problems), 'status is ' + string(this.status), join(this.problems, '; '))}" }
        if: this.status != "ok" || !is_empty(this.problems)
      - log: "Server check ok, reported \${this.checked}"
`;
const now = new DateValue(new Date(2026, 10, 7, 8, 0).getTime(), false);
const page = (o) => ({ now, today: parseDateValue('2026-11-07'), this: { title: 'Server Status', modified: parseDateValue('2026-11-07 06:00'), ...o } });
const IF_STALE = 'coalesce(this.checked, this.modified) == null || coalesce(this.checked, this.modified) < sub(now, "12h")';
const IF_PROBLEM = 'this.status != "ok" || !is_empty(this.problems)';
const BODY = "${if(is_empty(this.problems), 'status is ' + string(this.status), join(this.problems, '; '))}";

test('the rule parses', () => {
  const r = parseAutomations(RULE);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rules.length, 1);
  assert.equal(r.rules[0].actions.length, 4);
});
test('fresh and ok: nothing to say', () => {
  const c = page({ checked: parseDateValue('2026-11-07 06:00'), status: 'ok', problems: [] });
  assert.equal(evaluate(IF_STALE, c), false);
  assert.equal(evaluate(IF_PROBLEM, c), false);
});
test('a problem is reported with its text', () => {
  const c = page({ checked: parseDateValue('2026-11-07 06:00'), status: 'degraded', problems: ['nginx: down', 'backup: 3 days old'] });
  assert.equal(evaluate(IF_PROBLEM, c), true);
  assert.equal(render(BODY, c), 'nginx: down; backup: 3 days old');
});
test('status down with no list still alerts', () => {
  const c = page({ checked: parseDateValue('2026-11-07 06:00'), status: 'down', problems: null });
  assert.equal(evaluate(IF_PROBLEM, c), true);
  assert.equal(render(BODY, c), 'status is down');
});
test('a report from two days ago is stale, even if it said ok', () => {
  const c = page({ checked: parseDateValue('2026-11-05 06:00'), status: 'ok', problems: [] });
  assert.equal(evaluate(IF_STALE, c), true);
});
test('a file without checked falls back to the file time', () => {
  assert.equal(evaluate(IF_STALE, page({ status: 'ok', problems: [] })), false);
  assert.equal(evaluate(IF_STALE, { ...page({ status: 'ok' }), this: { title: 'x', status: 'ok' } }), true);
});
test('a file with no status at all alerts', () => {
  assert.equal(evaluate(IF_PROBLEM, page({ checked: parseDateValue('2026-11-07 06:00') })), true);
});
test('yesterday morning\'s report is already stale at 08:00 (a server that died after writing it)', () => {
  const c = page({ checked: parseDateValue('2026-11-06 06:30'), status: 'ok', problems: [] });
  assert.equal(evaluate(IF_STALE, c), true);
});
test('this morning\'s report, even a slow sync of it, is not', () => {
  const c = page({ checked: parseDateValue('2026-11-07 00:30'), status: 'ok', problems: [] });
  assert.equal(evaluate(IF_STALE, c), false);
});
