/**
 * Dates for automations. Everything is local time: a `due: 2026-10-15` means that day where the person is.
 * A DateValue knows whether it is a plain date or has a time of day, and prints the way the index reads it back
 * (a plain date as YYYY-MM-DD, a date with a time with its UTC offset).
 */

const pad = (n, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0');

export class DateValue {
  /** @param {number} ms epoch milliseconds  @param {boolean} dateOnly true when only the day matters */
  constructor(ms, dateOnly = false) {
    this.ms = ms;
    this.dateOnly = dateOnly;
  }
  get date() {
    return new Date(this.ms);
  }
  toString() {
    return this.dateOnly ? formatDate(this.date, 'YYYY-MM-DD') : formatIso(this.date);
  }
  toJSON() {
    return this.toString();
  }
  valueOf() {
    return this.ms;
  }
}

export const isDateValue = (v) => v instanceof DateValue;

/** `2026-10-15T09:30:00+02:00` (local time with its offset). */
export function formatIso(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${formatDate(d, 'YYYY-MM-DDTHH:mm:ss')}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Format with tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH mm ss. Anything else is copied. */
export function formatDate(d, fmt = 'YYYY-MM-DD') {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/g, (t) => {
    switch (t) {
      case 'YYYY': return pad(d.getFullYear(), 4);
      case 'YY': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_LONG[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS_LONG[d.getDay()];
      case 'ddd': return DAYS[d.getDay()];
      case 'HH': return pad(d.getHours());
      case 'mm': return pad(d.getMinutes());
      default: return pad(d.getSeconds());
    }
  });
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A date string (as written in a note) to a DateValue, or null. A plain date is the local day. */
export function parseDateValue(s) {
  if (s instanceof DateValue) return s;
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T ])/, (_m, y, mo, d) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
  let m = DATE_ONLY.exec(t);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() !== Number(m[2]) - 1) return null;
    return new DateValue(d.getTime(), true);
  }
  m = DATE_TIME.exec(t);
  if (m) {
    const [, y, mo, da, h, mi, se, zone] = m;
    if (zone) {
      const ms = Date.parse(t.replace(' ', 'T'));
      return Number.isNaN(ms) ? null : new DateValue(ms, false);
    }
    const d = new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se ?? 0));
    return Number.isNaN(d.getTime()) ? null : new DateValue(d.getTime(), false);
  }
  return null;
}

const UNIT = { min: 'min', mins: 'min', h: 'h', hr: 'h', hrs: 'h', d: 'd', day: 'd', days: 'd', w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w', mo: 'mo', mos: 'mo', month: 'mo', months: 'mo', y: 'y', yr: 'y', yrs: 'y', year: 'y', years: 'y', s: 's', sec: 's', secs: 's' };

/** `7d`, `-2w`, `1mo`, `1y`, `90min`, `2h`, `30s` -> { n, unit }. Throws on anything else (`1m` is ambiguous, so it is refused). */
export function parseDuration(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return { n: x, unit: 'd' };
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(String(x));
  if (!m) throw new Error(`"${x}" is not a duration (try 7d, 2w, 1mo, 1y, 3h, 90min)`);
  const unit = UNIT[m[2].toLowerCase()];
  if (!unit) {
    if (m[2].toLowerCase() === 'm') throw new Error(`"${x}": use mo for months or min for minutes`);
    throw new Error(`"${x}" is not a duration (try 7d, 2w, 1mo, 1y, 3h, 90min)`);
  }
  return { n: Number(m[1]), unit };
}

/** Milliseconds of a short duration such as `30s`, `2min`, `1h`, `1d`. Months and years are refused. */
export function durationMs(x) {
  const { n, unit } = parseDuration(x);
  const per = { s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
  if (!per) throw new Error(`"${x}" is too long here: use seconds, minutes, hours, days or weeks`);
  return n * per;
}

/** Add a duration to a DateValue. Days, weeks, months and years move the calendar (the time of day stays). */
export function addDuration(dv, dur) {
  const { n, unit } = typeof dur === 'object' && dur !== null && 'unit' in dur ? dur : parseDuration(dur);
  const d = new Date(dv.ms);
  switch (unit) {
    case 'd': d.setDate(d.getDate() + n); break;
    case 'w': d.setDate(d.getDate() + n * 7); break;
    case 'mo': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last)); // Jan 31 + 1 month = Feb 28
      break;
    }
    case 'y': {
      const day = d.getDate();
      const month = d.getMonth();
      d.setDate(1);
      d.setFullYear(d.getFullYear() + n);
      const last = new Date(d.getFullYear(), month + 1, 0).getDate();
      d.setMonth(month, Math.min(day, last));
      break;
    }
    case 'h': return new DateValue(dv.ms + n * 3_600_000, false);
    case 'min': return new DateValue(dv.ms + n * 60_000, false);
    default: return new DateValue(dv.ms + n * 1000, false);
  }
  return new DateValue(d.getTime(), dv.dateOnly);
}

export const startOfDay = (dv) => {
  const d = new Date(dv.ms);
  return new DateValue(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), true);
};

/** Start of the week (Monday), month or year containing the date. */
export function startOf(dv, unit) {
  const d = new Date(dv.ms);
  switch (unit) {
    case 'day': return startOfDay(dv);
    case 'week': return new DateValue(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(), true);
    case 'month': return new DateValue(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), true);
    case 'year': return new DateValue(new Date(d.getFullYear(), 0, 1).getTime(), true);
    default: throw new Error(`start_of: unknown unit "${unit}" (day, week, month, year)`);
  }
}

/** Whole calendar days from a to b (negative when b is earlier). */
export function daysBetween(a, b) {
  const x = startOfDay(a).ms;
  const y = startOfDay(b).ms;
  return Math.round((y - x) / 86_400_000);
}

/** "09:30" -> minutes since midnight, or null. */
export function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export const withClock = (dv, minutes) => {
  const d = new Date(dv.ms);
  return new DateValue(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime(), false);
};
