import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateValue, addDuration, formatDate, parseDateValue, parseDuration, parseCron, nextCron, lastCronBetween,
  render, evaluate, parseAutomations, insertText, findOpenTasks, splitTemplate,
} from '../src/index.js';

const d = (s) => parseDateValue(s);
const ctx = (extra = {}) => ({
  now: new DateValue(new Date(2026, 9, 15, 8, 30).getTime(), false),
  today: d('2026-10-15'),
  this: { title: 'Alpha', due: d('2026-10-15'), status: 'Done', tags: ['a', 'b'], n: 3 },
  ...extra,
});

// ------------------------------------------------------------------ dates

test('plain dates are local days and print the way they were written', () => {
  assert.equal(String(d('2026-10-15')), '2026-10-15');
  assert.equal(d('2026-02-30'), null);
  assert.equal(d('not a date'), null);
});

test('adding months stops at the end of a short month', () => {
  assert.equal(String(addDuration(d('2026-01-31'), '1mo')), '2026-02-28');
  assert.equal(String(addDuration(d('2024-02-29'), '1y')), '2025-02-28');
  assert.equal(String(addDuration(d('2026-10-15'), '-2w')), '2026-10-01');
});

test('durations: 1m is refused because it could mean month or minute', () => {
  assert.throws(() => parseDuration('1m'), /mo for months or min for minutes/);
  assert.deepEqual(parseDuration('90min'), { n: 90, unit: 'min' });
  assert.throws(() => parseDuration('soon'), /not a duration/);
});

test('format tokens', () => {
  assert.equal(formatDate(new Date(2026, 9, 5, 7, 3), 'dddd D MMMM YYYY, HH:mm'), 'Monday 5 October 2026, 07:03');
});

// ------------------------------------------------------------------ cron

test('cron: parse, next, ranges, steps, names, day-of-month OR weekday', () => {
  const c = parseCron('*/15 8-9 * * mon-fri');
  const t = nextCron(c, new Date(2026, 9, 15, 8, 20)); // Thursday
  assert.equal(formatDate(t, 'YYYY-MM-DD HH:mm'), '2026-10-15 08:30');
  assert.equal(formatDate(nextCron(parseCron('0 8 * * *'), new Date(2026, 9, 15, 8, 0)), 'YYYY-MM-DD HH:mm'), '2026-10-16 08:00');
  assert.equal(formatDate(nextCron(parseCron('@weekly'), new Date(2026, 9, 15, 8, 0)), 'YYYY-MM-DD'), '2026-10-19'); // Monday
  // 13th OR Friday
  assert.equal(formatDate(nextCron(parseCron('0 0 13 * fri'), new Date(2026, 9, 14)), 'YYYY-MM-DD'), '2026-10-16');
});

test('cron: errors are readable', () => {
  assert.throws(() => parseCron('* * *'), /needs 5 fields/);
  assert.throws(() => parseCron('61 * * * *'), /out of range/);
  assert.throws(() => parseCron('* * * foo *'), /not a number/);
});

test('cron: the latest missed run, once', () => {
  const c = parseCron('0 8 * * *');
  const last = lastCronBetween(c, new Date(2026, 9, 10, 9, 0), new Date(2026, 9, 15, 9, 0));
  assert.equal(formatDate(last, 'YYYY-MM-DD HH:mm'), '2026-10-15 08:00');
  assert.equal(lastCronBetween(c, new Date(2026, 9, 15, 8, 1), new Date(2026, 9, 15, 9, 0)), null);
});

// ------------------------------------------------------------------ expressions

test('expressions: arithmetic, comparison, logic, ternary', () => {
  assert.equal(evaluate('1 + 2 * 3', ctx()), 7);
  assert.equal(evaluate('this.n * 2 == 6 && !false', ctx()), true);
  assert.equal(evaluate('this.n > 2 ? "big" : "small"', ctx()), 'big');
  assert.equal(evaluate('"a" + 1', ctx()), 'a1');
  assert.throws(() => evaluate('1 / 0', ctx()), /division by zero/);
});

test('expressions: text comparison ignores capitals, like queries', () => {
  assert.equal(evaluate('this.status == "done"', ctx()), true);
  assert.equal(evaluate('contains(this.tags, "A")', ctx()), true);
});

test('expressions: dates', () => {
  assert.equal(String(evaluate('add(this.due, "7d")', ctx())), '2026-10-22');
  assert.equal(String(evaluate('this.due + "1mo"', ctx())), '2026-11-15');
  assert.equal(String(evaluate('today - "1w"', ctx())), '2026-10-08');
  assert.equal(evaluate('days_between(this.due, add(this.due, "10d"))', ctx()), 10);
  assert.equal(evaluate('this.due < add(today, "1d")', ctx()), true);
  assert.equal(evaluate('format(today, "DD/MM/YYYY")', ctx()), '15/10/2026');
  assert.equal(evaluate('weekday(today)', ctx()), 4); // Thursday
  assert.equal(String(evaluate('next_weekday(today, 1)', ctx())), '2026-10-19');
  assert.equal(String(evaluate('start_of(today, "week")', ctx())), '2026-10-12');
  assert.equal(evaluate('this.due.year', ctx()), 2026);
});

test('expressions: a missing property is null, an unknown name is an error', () => {
  assert.equal(evaluate('this.nothing', ctx()), null);
  assert.equal(evaluate('coalesce(this.nothing, "x")', ctx()), 'x');
  assert.throws(() => evaluate('nope + 1', ctx()), /unknown name "nope"/);
  assert.throws(() => evaluate('nope(1)', ctx()), /unknown function nope/);
  assert.throws(() => evaluate('1 +', ctx()), /ends too soon/);
});

test('expressions cannot reach anything that is not in the context', () => {
  assert.throws(() => evaluate('process.exit(1)', ctx()), /unexpected/); // methods cannot be called
  assert.throws(() => evaluate('constructor', ctx()), /unknown name/);
  assert.equal(evaluate('this.constructor', ctx()), null);
  assert.equal(evaluate('this.__proto__', ctx()), null);
});

test('templates: one expression keeps its type, mixed text becomes text', () => {
  assert.ok(render('${add(this.due, "7d")}', ctx()) instanceof DateValue);
  assert.equal(render('${this.n}', ctx()), 3);
  assert.equal(render('Task ${this.title} due ${add(this.due, "1d")}', ctx()), 'Task Alpha due 2026-10-16');
  assert.equal(render('$$5 and ${"}"}', ctx()), '$5 and }');
  assert.equal(String(render('$now', ctx())).slice(0, 10), '2026-10-15');
  assert.equal(String(render('$TODAY', ctx())), '2026-10-15');
  assert.equal(render('cost $now.day', ctx()), 'cost $now.day'); // query syntax is left alone
  assert.deepEqual(render({ a: ['${1 + 1}', 'x'] }, ctx()), { a: [2, 'x'] });
  assert.throws(() => splitTemplate('${oops'), /never closed/);
});

// ------------------------------------------------------------------ rules file

const RULES = `
settings:
  devices: [Laptop, Desktop]
  sync_delay: 90s
rules:
  - id: recur
    on: { change: status, to: done }
    where: kind:task
    do:
      - set_property: { completed_at: "$now" }
      - move_file: Archive/
  - id: daily
    on: { schedule: "0 8 * * *" }
    do:
      - notify: Daily review
`;

test('rules file: rules, settings and defaults', () => {
  const r = parseAutomations(RULES);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rules.length, 2);
  assert.equal(r.rules[0].runs, 'once'); // changes files
  assert.equal(r.rules[1].runs, 'everywhere'); // only notifies
  assert.deepEqual(r.settings.devices, ['laptop', 'desktop']);
  assert.equal(r.settings.syncDelayMs, 90_000);
});

test('rules file: a list at the top level and the original long trigger form both work', () => {
  const r = parseAutomations(`
- id: a
  trigger: { on: property_change, property: status, to: completed }
  actions:
    - set_property: { field: completed_at, value: "$NOW" }
- id: b
  trigger: { on: due_date, property: due, offset: -1d }
  actions: [ { notify: soon } ]
- id: c
  trigger: { on: time, cron: "0 8 * * *" }
  actions: [ { notify: hi } ]
`);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.rules.map((x) => x.triggers[0].kind), ['change', 'at', 'schedule']);
});

test('rules file: a bad rule is reported and the others still load', () => {
  const r = parseAutomations(`
rules:
  - on: { change: status }
    do: [ { notify: x } ]
  - id: ok
    on: created
    do: [ { notify: x } ]
  - id: bad-action
    on: created
    do: [ { teleport: home } ]
  - id: two-in-one
    on: created
    do: [ { notify: x, log: y } ]
  - id: ok
    on: created
    do: [ { notify: dup } ]
  - id: bad-expr
    on: created
    do: [ { notify: "\${1 +}" } ]
  - id: no-where
    on: match
    do: [ { notify: x } ]
`);
  assert.deepEqual(r.rules.map((x) => x.id), ['ok']);
  const all = r.warnings.join('\n');
  assert.match(all, /needs an "id"/);
  assert.match(all, /unknown action "teleport"/);
  assert.match(all, /exactly one action/);
  assert.match(all, /used twice/);
  assert.match(all, /ends too soon/);
  assert.match(all, /needs a "where:"/);
});

test('rules file: broken YAML stops with one clear message', () => {
  const r = parseAutomations('rules: [ {');
  assert.equal(r.rules.length, 0);
  assert.match(r.errors[0], /not valid YAML/);
});

test('rules file: shell rules stay off until they say where they run', () => {
  const r = parseAutomations(`
rules:
  - id: deploy
    on: { change: status, to: published }
    do: [ { run_shell: { argv: [make, deploy] } } ]
  - id: deploy2
    device: desktop
    on: { change: status, to: published }
    do: [ { run_shell: { command: "make deploy" } } ]
`);
  const [a, b] = r.rules;
  assert.equal(a.enabled, false);
  assert.match(r.warnings[0], /must say where they run/);
  assert.equal(b.enabled, true);
  assert.equal(b.usesShell, true);
});

test('rules file: schedule that changes the page needs a where', () => {
  const r = parseAutomations(`
rules:
  - id: s
    on: { schedule: "@daily" }
    do: [ { set_property: { a: 1 } } ]
`);
  assert.equal(r.rules.length, 0);
  assert.match(r.warnings[0], /no page to change/);
});

// ------------------------------------------------------------------ text helpers

test('insertText: end of page, and end of a section', () => {
  assert.equal(insertText('# A\n\nx\n', 'new'), '# A\n\nx\n\nnew\n');
  assert.equal(insertText('- [ ] a\n', '- [ ] b'), '- [ ] a\n- [ ] b\n');
  assert.equal(insertText('', 'first'), 'first\n');
  const t = '# A\n\n## Tasks\n\n- [ ] one\n\n## Notes\n\nhi\n';
  assert.equal(insertText(t, '- [ ] two', 'Tasks'), '# A\n\n## Tasks\n\n- [ ] one\n- [ ] two\n\n## Notes\n\nhi\n');
  assert.match(insertText('# A\n', 'x', 'Missing'), /## Missing\n\nx\n$/);
});

test('findOpenTasks: unfinished tasks with their indented lines', () => {
  const tasks = findOpenTasks('- [x] done\n- [ ] one\n  - note\n  - [ ] sub\n\n- [ ] two\n- [>] moved\n');
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0].lines, ['- [ ] one', '  - note', '  - [ ] sub']);
  assert.deepEqual(tasks[1].lines, ['- [ ] two']);
});
