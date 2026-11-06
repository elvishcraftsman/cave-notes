/**
 * Five-field cron: minute hour day-of-month month day-of-week, in local time.
 * Supports `*`, lists (1,15), ranges (1-5), steps (*\/10, 0-30/5), month and weekday names, and the shortcuts
 * @hourly @daily @midnight @weekly @monthly @yearly. As in classic cron, when both day-of-month and day-of-week
 * are restricted, a day matches if EITHER does.
 */

const SHORTCUTS = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 1',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function field(text, min, max, names, label) {
  const out = new Set();
  const num = (s) => {
    const k = names ? names.indexOf(s.toLowerCase()) : -1;
    if (k >= 0) return k + (label === 'month' ? 1 : 0);
    if (!/^\d+$/.test(s)) throw new Error(`cron ${label}: "${s}" is not a number`);
    return Number(s);
  };
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron ${label}: bad step in "${part}"`);
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-');
      lo = num(a);
      hi = b === undefined ? (stepText === undefined ? lo : max) : num(b);
    }
    if (label === 'weekday') {
      if (lo === 7) lo = 0;
      if (hi === 7 && lo !== 0) hi = 7;
    }
    if (lo < min || hi > max + (label === 'weekday' ? 1 : 0) || lo > hi) throw new Error(`cron ${label}: "${part}" is out of range (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(label === 'weekday' && v === 7 ? 0 : v);
  }
  return out;
}

/** Parse a cron expression. Throws an Error with a readable message. */
export function parseCron(expr) {
  const raw = String(expr).trim();
  const text = SHORTCUTS[raw.toLowerCase()] ?? raw;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${raw}" needs 5 fields: minute hour day-of-month month weekday`);
  return {
    source: raw,
    minute: field(parts[0], 0, 59, null, 'minute'),
    hour: field(parts[1], 0, 23, null, 'hour'),
    dom: field(parts[2], 1, 31, null, 'day-of-month'),
    month: field(parts[3], 1, 12, MONTH_NAMES, 'month'),
    dow: field(parts[4], 0, 6, DAY_NAMES, 'weekday'),
    domAny: parts[2] === '*',
    dowAny: parts[4] === '*',
  };
}

function dayMatches(c, d) {
  if (!c.month.has(d.getMonth() + 1)) return false;
  const dom = c.dom.has(d.getDate());
  const dow = c.dow.has(d.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow;
}

/** The first matching minute strictly after `after` (a Date), or null if there is none within five years. */
export function nextCron(c, after) {
  const start = new Date(after.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const limit = start.getTime() + 5 * 366 * 86_400_000;
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let guard = 0; day.getTime() < limit && guard < 2000; guard++, day.setDate(day.getDate() + 1)) {
    if (!dayMatches(c, day)) continue;
    const sameDay = day.getTime() === new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    for (let h = 0; h < 24; h++) {
      if (!c.hour.has(h)) continue;
      for (let m = 0; m < 60; m++) {
        if (!c.minute.has(m)) continue;
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        if (sameDay && t.getTime() < start.getTime()) continue;
        return t;
      }
    }
  }
  return null;
}

/** The latest matching minute in (after, upTo], or null. Used to catch up on a missed schedule once. */
export function lastCronBetween(c, after, upTo) {
  let last = null;
  let t = nextCron(c, after);
  let n = 0;
  while (t && t.getTime() <= upTo.getTime() && n++ < 100_000) {
    last = t;
    t = nextCron(c, t);
  }
  return last;
}
