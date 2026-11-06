/**
 * The automation engine. It knows nothing about Electron, SQLite or files: everything it needs comes through `host`.
 *
 * host = {
 *   root, now(): Date,
 *   search(query, thisPath?) -> { paths: string[], errors: string[] }     the workspace's own query language
 *   pageInfo(path) -> { path, title, mtimeMs, attrs: { key: [{ type, text, num }] } } | null
 *   absolutePath(path) -> string
 *   resolvePage(ref, fromPath) -> path | null                              a title, file name, alias or path
 *   readText(path) -> { text, hash } | null,  writeText(path, text, baseHash) -> { ok }
 *   setProperties(path, { key: value | null }) -> { changed }
 *   createPage({ parent, name, content, path? }) -> { path, created }      created:false when it already exists
 *   movePage(path, destination) -> { moved, to?, reason? }
 *   notify({ title, body, path }),  js({ ruleId, code, input, timeoutMs, page }) -> { ok, value, logs } | { ok: false, error } | { denied, reason }  (optional: without it scripts run in the sandbox directly),  shell(spec) -> { code, stdout, stderr, timedOut?, denied?, reason? }
 *   loadState() / saveState(obj)        this computer's own bookkeeping (not synced)
 *   readDevices() -> [{ id, name, seen, fired }],  writeDevice(obj)   one small file per computer (synced)
 *   appendLog(entry)                    optional
 * }
 *
 * Several computers may run the same rules on the same synced notes. Three things keep that safe:
 *  1. rules marked `runs: once` wait their turn, and look again before acting. The computer where the person made
 *     the edit (`origin: 'local'`) acts at once. A change that arrived from outside (`origin: 'external'`: sync, another
 *     program) never goes first while other computers are live: it leaves the first slot to the computer where the edit
 *     was made, and its own turn comes one `sync_delay` later, per computer in order. Without an origin (time triggers,
 *     start-up) the live computers simply take turns, the first at once;
 *  2. every computer writes the keys of what it has done into its own device file, and checks the others' first;
 *  3. every action does nothing when its work is already done, and what it writes does not depend on the clock
 *     of the computer that wrote it.
 */
import { DateValue, addDuration, parseClock, parseDateValue, startOfDay, withClock } from './dates.js';
import { lastCronBetween } from './cron.js';
import { evaluate, render, stringify, truthy } from './expr.js';
import { runActions } from './actions.js';
import { runSandbox } from '#sandbox';
import { DEFAULT_SETTINGS, coerceAnswers, parseAutomations } from './schema.js';

/** The names an expression can use. The documentation is checked against this list. */
export const VARIABLES = ['now', 'today', 'this', 'old', 'new', 'rule', 'trigger', 'device', 'let', 'created', 'shell', 'ask', 'selection', 'words', 'characters'];
/** The built-in properties of `this`. */
/** The words and characters of a text, as a plugin sees them. A word is a run of non-space characters with a letter or digit in it, so a lone `-` or `#` of Markdown is not one. */
export function textStats(text) {
  const t = String(text ?? '');
  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return { words, characters: [...t].length };
}

export const THIS_FIELDS = ['title', 'path', 'name', 'folder', 'parent', 'modified'];

const DAY = 86_400_000;
const LEDGER_KEEP = 30 * DAY;
const MATCH_EVERY = 5 * 60_000;
const AT_EVERY = 60_000;
/** The circuit breaker: in any ten minutes, a rule may act on one page this many times... */
const PAGE_WINDOW = 600_000;
const PAGE_MAX_RUNS = 6;
/** ...and fail there this many times without changing anything. Runs skipped by a condition are not counted: they write nothing, so they cannot loop. */
const PAGE_MAX_FAILURES = 30;

const posix = (p) => String(p).replace(/\\/g, '/');
const baseName = (p) => posix(p).split('/').pop().replace(/\.[^.]+$/, '');
const dirName = (p) => {
  const parts = posix(p).split('/');
  parts.pop();
  return parts.join('/');
};

/** An index attribute (list of { type, text, num }) as a value an expression can use. */
export function attrValue(entries) {
  if (!entries || entries.length === 0) return null;
  const one = (e) => {
    // a blank attribute (there, with nothing in it) is empty whatever its declared type, never 0 or false
    if (e.text === '' && (e.num === null || e.num === undefined)) return null;
    if (e.type === 'date') return parseDateValue(e.text) ?? (typeof e.num === 'number' ? new DateValue(e.num + new Date(e.num).getTimezoneOffset() * 60_000, true) : e.text);
    if (e.type === 'number') return typeof e.num === 'number' ? e.num : Number(e.text);
    if (e.type === 'bool') return String(e.text).toLowerCase() === 'true';
    return e.text;
  };
  return entries.length === 1 ? one(entries[0]) : entries.map(one);
}

const textOf = (entries) => (entries && entries.length > 0 ? entries.map((e) => e.text).join('\n') : null);
const has = (text, want) => text !== null && text.split('\n').some((t) => t.toLowerCase() === String(want).toLowerCase());

/** Put the page in place of `$this` / `$parent` in a query. */
export function substituteThis(query, path) {
  if (!path) return query;
  const parent = dirName(path);
  return query.replace(/\$parent\b/g, JSON.stringify(parent ? `${parent}.md` : '')).replace(/\$this\b/g, JSON.stringify(path));
}

export class AutomationEngine {
  /** @param {{ host: object, deviceId: string, deviceName?: string, log?: (level:string, msg:string) => void }} o */
  constructor({ host, deviceId, deviceName, log }) {
    this.host = host;
    this.deviceId = String(deviceId);
    this.deviceName = deviceName || String(deviceId);
    this.logger = log ?? (() => {});
    this.rules = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.problems = [];
    this.state = { v: 1, snapshot: {}, members: {}, sched: {}, pending: [], fired: {} };
    this.ownWrites = new Map(); // path -> { depth, until }
    this.recent = []; // timestamps of recent runs (global rate limit)
    this.perPage = new Map(); // rule|path -> { wrote: timestamps, failed: timestamps } (circuit breaker)
    this.history = []; // the last entries of the log
    this.running = new Set();
    this.lastBeat = 0;
    this.lastAt = 0;
    this.lastMatch = 0;
    this.deviceCache = { at: 0, list: [] };
    this.dirty = false;
    this.ledgerDirty = false;
    this.started = false;
  }

  now() {
    return this.host.now();
  }

  note(level, msg) {
    this.logger(level, msg);
  }

  // ---------------------------------------------------------------- loading

  /** Read the rules (text of the automations file, or null). Safe to call again whenever the file changes. */
  async load(text) {
    const parsed = parseAutomations(text);
    this.rules = parsed.rules;
    this.settings = parsed.settings;
    this.problems = [...parsed.errors.map((m) => ({ level: 'error', message: m })), ...parsed.warnings.map((m) => ({ level: 'warn', message: m }))];
    for (const p of this.problems) this.note(p.level === 'error' ? 'error' : 'warn', `automations: ${p.message}`);
    const saved = await this.host.loadState?.();
    if (saved && saved.v === 1 && !this.started) this.state = { ...this.state, ...saved };
    const ids = new Set(this.rules.map((r) => r.id));
    for (const k of Object.keys(this.state.members)) if (!ids.has(k)) delete this.state.members[k];
    for (const k of Object.keys(this.state.sched)) if (!ids.has(k)) delete this.state.sched[k];
    const props = new Set(this.activeRules().flatMap((r) => r.triggers.filter((t) => t.kind === 'change').map((t) => t.prop)));
    for (const k of Object.keys(this.state.snapshot)) if (!props.has(k)) delete this.state.snapshot[k];
    this.dirty = true;
    return { rules: this.rules.length, problems: this.problems };
  }

  /** The rules file changed: read it again and catch up for anything the new rules care about. */
  async reload(text) {
    const r = await this.load(text);
    if (this.started) {
      await this.catchUp();
      await this.tick();
    }
    return r;
  }

  activeRules() {
    return this.rules.filter((r) => r.enabled && !r.disabledByUser);
  }

  /** Begin: catch up on what happened while the app was closed (changes, missed schedules, due dates). */
  async start() {
    this.started = true;
    await this.catchUp();
    await this.tick();
  }

  // ---------------------------------------------------------------- this computer among the others

  async devices() {
    const t = this.now().getTime();
    if (t - this.deviceCache.at > 10_000) {
      try {
        this.deviceCache = { at: t, list: (await this.host.readDevices?.()) ?? [] };
      } catch (e) {
        this.note('warn', `automations: could not read the other computers' files: ${e.message}`);
        this.deviceCache = { at: t, list: [] };
      }
    }
    return this.deviceCache.list;
  }

  /** How many live computers come before this one (0 = go first). */
  async rank() {
    const t = this.now().getTime();
    const others = (await this.devices()).filter((d) => d.id !== this.deviceId && t - Number(d.seen) <= this.settings.liveWindowMs);
    const prio = this.settings.devices;
    const score = (d) => {
      const k = Math.max(prio.indexOf(String(d.name ?? '').toLowerCase()), prio.indexOf(String(d.id).toLowerCase()));
      return k < 0 ? prio.length : k;
    };
    const me = { id: this.deviceId, name: this.deviceName };
    const all = [...others, me].sort((a, b) => score(a) - score(b) || String(a.id).localeCompare(String(b.id)));
    return all.findIndex((d) => d.id === this.deviceId);
  }

  /** True when no other computer has been seen recently, so nobody else can be reacting to the same change. */
  async aloneHere() {
    const t = this.now().getTime();
    return !(await this.devices()).some((d) => d.id !== this.deviceId && t - Number(d.seen) <= this.settings.liveWindowMs);
  }

  async doneElsewhere(key) {
    for (const d of await this.devices()) if (d.id !== this.deviceId && d.fired && d.fired[key]) return d;
    return null;
  }

  async heartbeat(force = false) {
    if (!this.host.writeDevice) return;
    if (!this.activeRules().some((r) => r.runs === 'once')) return;
    const t = this.now().getTime();
    if (!force && t - this.lastBeat < this.settings.heartbeatMs) return;
    this.lastBeat = t;
    const fired = Object.fromEntries(Object.entries(this.state.fired).sort((a, b) => b[1] - a[1]).slice(0, 2000));
    try {
      await this.host.writeDevice({ id: this.deviceId, name: this.deviceName, seen: t, version: 1, fired });
    } catch (e) {
      this.note('warn', `automations: could not write this computer's file: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------- context for expressions and actions

  thisOf(info, path) {
    if (path === null || path === undefined) return { title: '', path: '', name: '', folder: '', parent: '', modified: null };
    if (!info) return { title: baseName(path), path, name: baseName(path), folder: dirName(path), parent: '', modified: null };
    const out = {};
    for (const [k, v] of Object.entries(info.attrs ?? {})) out[k.toLowerCase()] = attrValue(v);
    const parent = dirName(info.path);
    Object.assign(out, {
      title: info.title,
      path: info.path,
      name: baseName(info.path),
      folder: parent,
      parent: parent ? `${parent}.md` : '',
      modified: typeof info.mtimeMs === 'number' ? new DateValue(info.mtimeMs, false) : null,
    });
    return out;
  }

  varsFor(rule, info, path, trig) {
    const now = this.now();
    const props = {};
    const oldP = {};
    if ((trig.kind === 'change' || trig.kind === 'manual') && trig.prop) {
      oldP[trig.prop] = trig.old === null || trig.old === undefined ? null : trig.old.includes('\n') ? trig.old.split('\n') : trig.old;
      props[trig.prop] = trig.new === null || trig.new === undefined ? null : trig.new.includes('\n') ? trig.new.split('\n') : trig.new;
    }
    return {
      now: new DateValue(now.getTime(), false),
      today: startOfDay(new DateValue(now.getTime(), false)),
      this: this.thisOf(info, path),
      old: oldP,
      new: props,
      rule: { id: rule.id, name: rule.name },
      trigger: {
        kind: trig.kind,
        property: trig.prop ?? null,
        from: trig.old ?? null,
        to: trig.new ?? null,
        at: trig.at === undefined || trig.at === null ? null : new DateValue(trig.at, false),
      },
      device: { id: this.deviceId, name: this.deviceName },
    };
  }

  // ---------------------------------------------------------------- reacting to changes

  /**
   * The workspace changed: `changes` = [{ path, kind: 'created' | 'modified' | 'deleted', origin?: 'local' | 'external' }],
   * after the index looked again. `local` = this computer's own app wrote it (a person's save, or a rule's write);
   * `external` = it was changed by something else (sync, another program); left out when that is not known.
   * Each rule whose trigger fits is queued; this returns when they have been queued (and, for rules that go first, run).
   */
  async onChanges(changes) {
    if (!this.started || changes.length === 0) return;
    const t = this.now().getTime();
    for (const [p, o] of this.ownWrites) if (o.until < t) this.ownWrites.delete(p);
    const cache = new Map();
    const whereSet = async (rule) => {
      if (!cache.has(rule.id)) cache.set(rule.id, new Set(rule.where ? (await this.query(rule, rule.where)).paths : []));
      return cache.get(rule.id);
    };
    const work = [];
    // Several rules may watch the same property. Read each property's old and new value once per page, so the first
    // rule does not move the snapshot on and leave the others seeing no change.
    const seen = new Map(); // `${prop}|${path}` -> { info, old, now } | null (the page could not be read)
    for (const rule of this.activeRules()) {
      for (const trig of rule.triggers) {
        if (trig.kind === 'created' || trig.kind === 'modified' || trig.kind === 'deleted') {
          for (const c of changes) {
            if (c.kind !== trig.kind) continue;
            if (rule.where && c.kind !== 'deleted' && !(await whereSet(rule)).has(c.path)) continue;
            work.push({ rule, path: c.path, trig: { kind: trig.kind }, depth: this.depthOf(c.path), mtime: await this.mtimeOf(c.path), origin: c.origin });
          }
        } else if (trig.kind === 'change') {
          for (const c of changes) {
            if (c.kind === 'deleted') {
              this.snap(trig.prop, c.path, undefined);
              continue;
            }
            const k = `${trig.prop}|${c.path}`;
            if (!seen.has(k)) {
              const info0 = await this.host.pageInfo(c.path);
              if (!info0) {
                seen.set(k, null);
              } else {
                const now0 = textOf(info0.attrs?.[trig.prop] ?? this.attrCI(info0, trig.prop));
                const before = this.state.snapshot[trig.prop]?.[c.path];
                this.snap(trig.prop, c.path, now0);
                seen.set(k, { info: info0, old: before === undefined ? null : before, now: now0 });
              }
            }
            const s = seen.get(k);
            if (!s) continue;
            const { info, old, now } = s;
            if (old === now) continue;
            if (trig.from !== null && !has(old, trig.from)) continue;
            if (trig.to !== null && !has(now, trig.to)) continue;
            if (rule.where && !(await whereSet(rule)).has(c.path)) continue;
            work.push({ rule, path: c.path, trig: { kind: 'change', prop: trig.prop, old, new: now }, depth: this.depthOf(c.path), mtime: info.mtimeMs, origin: c.origin });
          }
        }
      }
    }
    for (const w of work) await this.fire(w.rule, w.path, w.trig, w.depth, w.mtime, w.origin);
    // a page may start to match because of a change elsewhere, so a match takes the origin of the whole batch
    const batch = changes.some((c) => c.origin === 'local') ? 'local' : changes.every((c) => c.origin === 'external') ? 'external' : undefined;
    await this.checkMatches(false, batch);
    await this.flush();
  }

  attrCI(info, prop) {
    for (const [k, v] of Object.entries(info.attrs ?? {})) if (k.toLowerCase() === prop) return v;
    return undefined;
  }

  snap(prop, path, text) {
    const s = (this.state.snapshot[prop] ??= {});
    if (text === undefined || text === null) delete s[path];
    else s[path] = text;
    this.dirty = true;
  }

  depthOf(path) {
    const o = this.ownWrites.get(path);
    return o && o.until >= this.now().getTime() ? o.depth : 0;
  }

  async mtimeOf(path) {
    return (await this.host.pageInfo(path))?.mtimeMs ?? 0;
  }

  async query(rule, q, thisPath) {
    const r = await this.host.search(thisPath ? substituteThis(q, thisPath) : q, thisPath);
    if (r.errors && r.errors.length > 0) {
      const msg = `${rule.id}: the query "${q}" has a problem: ${r.errors.join('; ')}`;
      if (!this.problems.some((p) => p.message === msg)) {
        this.problems.push({ level: 'warn', message: msg });
        this.note('warn', `automations: ${msg}`);
      }
    }
    return { paths: r.paths ?? [], errors: r.errors ?? [] };
  }

  /** Rules with a `match` trigger: pages that now match the query and did not before. */
  async checkMatches(force = false, origin = undefined) {
    const t = this.now().getTime();
    if (!force && t - this.lastMatch < 1000) return;
    this.lastMatch = t;
    for (const rule of this.activeRules()) {
      for (const trig of rule.triggers) {
        if (trig.kind !== 'match') continue;
        const now = new Set((await this.query(rule, rule.where)).paths);
        const first = this.state.members[rule.id] === undefined;
        const before = new Set(this.state.members[rule.id] ?? []);
        this.state.members[rule.id] = [...now];
        this.dirty = true;
        if (first && !trig.existing) continue;
        for (const p of now) {
          if (before.has(p)) continue;
          await this.fire(rule, p, { kind: 'match' }, this.depthOf(p), await this.mtimeOf(p), origin);
        }
      }
    }
  }

  // ---------------------------------------------------------------- time

  /** Called about every half minute: time triggers, rules waiting their turn, the heartbeat. */
  async tick() {
    if (!this.started) return;
    const now = this.now();
    const t = now.getTime();
    await this.heartbeat();
    const waiting = this.state.pending.filter((e) => e.due <= t);
    this.state.pending = this.state.pending.filter((e) => e.due > t);
    for (const e of waiting) await this.execute(e);
    for (const rule of this.activeRules()) {
      for (const trig of rule.triggers) {
        if (trig.kind === 'schedule') await this.tickSchedule(rule, trig, now);
        else if (trig.kind === 'at' && t - this.lastAt >= AT_EVERY) await this.tickAt(rule, trig, now);
      }
    }
    if (t - this.lastAt >= AT_EVERY) this.lastAt = t;
    if (t - this.lastMatch >= MATCH_EVERY) await this.checkMatches(true);
    for (const [k, ts] of Object.entries(this.state.fired)) if (t - ts > LEDGER_KEEP) delete this.state.fired[k];
    await this.flush();
  }

  async tickSchedule(rule, trig, now) {
    const last = this.state.sched[rule.id];
    this.state.sched[rule.id] = now.getTime();
    this.dirty = true;
    if (last === undefined) return; // a new rule starts from now: no backfill
    const due = lastCronBetween(trig.parsed, new Date(last), now);
    if (!due) return;
    const paths = rule.where ? (await this.query(rule, rule.where)).paths : [null];
    for (const p of paths) await this.fire(rule, p, { kind: 'schedule', at: due.getTime() }, 0, 0);
  }

  async tickAt(rule, trig, now) {
    const q = rule.where ? `(${rule.where}) has:${trig.prop}` : `has:${trig.prop}`;
    const { paths } = await this.query(rule, q);
    const t = now.getTime();
    for (const p of paths) {
      const info = await this.host.pageInfo(p);
      if (!info) continue;
      const entries = this.attrCI(info, trig.prop);
      const text = entries?.[0]?.text;
      const base = parseDateValue(text ?? '');
      if (!base) continue;
      const moment = this.dueMoment(base, trig);
      if (moment.ms > t || t - moment.ms > trig.late) continue;
      await this.fire(rule, p, { kind: 'at', prop: trig.prop, value: text, offset: trig.offset, at: moment.ms }, 0, 0);
    }
  }

  dueMoment(base, trig) {
    let m = base.dateOnly ? withClock(base, trig.time) : base;
    if (trig.offset) m = addDuration(m, trig.offset);
    return m;
  }

  /** On start: changes made while the app was closed, and what came due meanwhile. */
  async catchUp() {
    // what changed in each watched property while the app was closed, worked out once per property and shared by every
    // rule that watches it (null: the property was not watched before, so there is nothing to compare with)
    const diffs = new Map();
    for (const rule of this.activeRules()) {
      for (const trig of rule.triggers) {
        if (trig.kind !== 'change') continue;
        const inWhere = rule.where ? new Set((await this.query(rule, rule.where)).paths) : null;
        if (!diffs.has(trig.prop)) {
          const { paths } = await this.query(rule, `has:${trig.prop}`);
          const prev = this.state.snapshot[trig.prop];
          const cur = {};
          for (const p of paths) {
            const info = await this.host.pageInfo(p);
            if (info) cur[p] = { text: textOf(this.attrCI(info, trig.prop)), mtime: info.mtimeMs };
          }
          let found = null;
          if (prev !== undefined) {
            found = [];
            for (const [p, v] of Object.entries(cur)) if (prev[p] !== v.text) found.push({ path: p, old: prev[p] ?? null, now: v.text, mtime: v.mtime });
            for (const p of Object.keys(prev)) if (!(p in cur)) found.push({ path: p, old: prev[p], now: null, mtime: 0 });
          }
          this.state.snapshot[trig.prop] = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.text !== null).map(([p, v]) => [p, v.text]));
          this.dirty = true;
          diffs.set(trig.prop, found);
        }
        const changes = diffs.get(trig.prop);
        if (changes === null) continue;
        for (const c of changes) {
          if (trig.from !== null && !has(c.old, trig.from)) continue;
          if (trig.to !== null && !has(c.now, trig.to)) continue;
          if (c.now === null && trig.to !== null) continue;
          if (inWhere && !inWhere.has(c.path)) continue;
          await this.fire(rule, c.path, { kind: 'change', prop: trig.prop, old: c.old, new: c.now }, 0, c.mtime);
        }
      }
    }
    await this.checkMatches(true);
  }

  // ---------------------------------------------------------------- firing

  /**
   * What identifies one occurrence of a trigger, the same on every computer. Times of edits are rounded to ten
   * minutes: the same edit seen on two computers can differ by seconds (the first computer's own rule writes to the
   * page), but a genuinely new edit is almost always later than that.
   */
  fingerprint(rule, path, trig, mtimeRaw) {
    const p = path ?? '';
    const mtime = Math.floor((mtimeRaw || 0) / 600_000);
    switch (trig.kind) {
      // a person can tick a task, see a rule untick it, and tick it again within minutes: each tick is its own occurrence
      case 'change': return `${rule.id}|${p}|change|${trig.prop}|${trig.new ?? ''}|${Math.floor((mtimeRaw || 0) / 60_000)}`;
      case 'at': return `${rule.id}|${p}|at|${trig.value}|${trig.offset ?? ''}`;
      case 'schedule': return `${rule.id}|${p}|schedule|${trig.at}`;
      default: return `${rule.id}|${p}|${trig.kind}|${mtime}`;
    }
  }

  deviceAllowed(rule) {
    if (rule.device === null) return true;
    const want = rule.device.trim().toLowerCase();
    return want === this.deviceId.toLowerCase() || want === this.deviceName.toLowerCase();
  }

  /** Decide whether and when to run a rule for a page; runs it now if this computer goes first. */
  async fire(rule, path, trig, depth, mtime, origin = undefined) {
    if (!this.deviceAllowed(rule)) return;
    const key = this.fingerprint(rule, path, trig, mtime);
    // A change is only seen once (the snapshot of the property sees to that), so a rule that runs on this computer alone
    // needs no ledger for it: remembering it would swallow a second, genuine change made a few minutes later.
    const remembered = trig.kind === 'change' && (rule.runs !== 'once' || (await this.aloneHere())) ? false : this.state.fired[key];
    if (remembered || this.state.pending.some((e) => e.key === key) || this.running.has(key)) return;
    if (depth >= this.settings.maxDepth) {
      this.record({ rule, path, trig, status: 'skipped', detail: `not run: it would be the ${depth + 1}th rule in a chain of rules reacting to each other (limit ${this.settings.maxDepth})` });
      return;
    }
    const t = this.now().getTime();
    this.recent = this.recent.filter((x) => t - x < 60_000);
    if (this.recent.length >= this.settings.maxRunsPerMinute) {
      this.record({ rule, path, trig, status: 'skipped', detail: `not run: more than ${this.settings.maxRunsPerMinute} rule runs in a minute (a rule may be looping)` });
      return;
    }
    const hits = this.pageHits(rule, path, t);
    if (hits.wrote.length >= PAGE_MAX_RUNS) {
      this.record({ rule, path, trig, status: 'skipped', detail: `not run: this rule has acted on this page ${PAGE_MAX_RUNS} times in 10 minutes (it may be undoing its own work)` });
      return;
    }
    if (hits.failed.length >= PAGE_MAX_FAILURES) {
      this.record({ rule, path, trig, status: 'skipped', detail: `not run: this rule has failed on this page ${PAGE_MAX_FAILURES} times in 10 minutes` });
      return;
    }
    this.recent.push(t);
    const delay = await this.delayFor(rule, origin);
    const entry = { key, ruleId: rule.id, path, trig, depth, due: t + delay };
    if (delay > 0) {
      this.state.pending.push(entry);
      this.dirty = true;
      return;
    }
    await this.execute(entry);
  }

  /** The runs of a rule on a page in the last ten minutes that count towards the circuit breaker. */
  pageHits(rule, path, t = this.now().getTime()) {
    const pk = `${rule.id}|${path ?? ''}`;
    const o = this.perPage.get(pk) ?? { wrote: [], failed: [] };
    const fresh = { wrote: o.wrote.filter((x) => t - x < PAGE_WINDOW), failed: o.failed.filter((x) => t - x < PAGE_WINDOW) };
    this.perPage.set(pk, fresh);
    return fresh;
  }

  /**
   * Count a finished run. A run that did something (any action done, even when a later one failed) counts as acting
   * on the page; a failure that did nothing counts as a failure; a run skipped by where, if, require, unless or an
   * action's own if counts as nothing.
   */
  countRun(rule, path, res) {
    const t = this.now().getTime();
    const hits = this.pageHits(rule, path, t);
    const acted = (res.steps ?? []).some((s) => s.status === 'done');
    if (acted) hits.wrote.push(t);
    else if (res.status === 'failed') hits.failed.push(t);
  }

  /**
   * How long this computer waits before acting on a trigger. The computer where the person made the edit goes first,
   * so a person never waits for a turn that is not theirs. Every other computer leaves that first slot free (if it did
   * not, the one that sorts first would act at the same moment as the one the person is using) and, as before, takes
   * its place in the order after it, looking again before acting.
   */
  async delayFor(rule, origin) {
    if (rule.runs !== 'once') return 0;
    if (origin === 'local') return 0;
    const rank = await this.rank();
    if (origin === 'external' && !(await this.aloneHere())) return (rank + 1) * this.settings.syncDelayMs;
    return rank * this.settings.syncDelayMs;
  }

  async execute(entry) {
    const rule = this.rules.find((r) => r.id === entry.ruleId);
    if (!rule || !rule.enabled) return;
    const { path, trig, key } = entry;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      if (rule.runs === 'once') {
        const other = await this.doneElsewhere(key);
        if (other) {
          this.mark(key, false);
          return this.record({ rule, path, trig, status: 'skipped', detail: `already done by ${other.name ?? other.id}` });
        }
      }
      const res = await this.runOne(rule, path, trig, { depth: entry.depth, check: true });
      this.countRun(rule, path, res);
      this.mark(key, rule.runs === 'once');
      this.record({ rule, path, trig, ...res });
    } catch (e) {
      this.countRun(rule, path, { status: 'failed', steps: [] });
      this.mark(key, rule.runs === 'once');
      this.record({ rule, path, trig, status: 'failed', detail: e.message });
    } finally {
      this.running.delete(key);
    }
  }

  mark(key, shared = false) {
    this.state.fired[key] = this.now().getTime();
    this.dirty = true;
    if (shared) this.ledgerDirty = true;
  }

  /** Look again that the reason to act still holds, then run the actions. Returns { status, detail, steps }. */
  async runOne(rule, path, trig, { depth = 0, check = false, dry = false } = {}) {
    let info = null;
    if (path !== null && trig.kind !== 'deleted') {
      info = await this.host.pageInfo(path);
      if (!info) return { status: 'skipped', detail: 'the page is gone' };
    }
    if (check) {
      if (trig.kind === 'change') {
        const cur = textOf(this.attrCI(info, trig.prop));
        if (trig.new !== null && !has(cur, trig.new)) return { status: 'skipped', detail: `${trig.prop} is no longer "${trig.new}"` };
      } else if (trig.kind === 'match') {
        if (!(await this.query(rule, rule.where)).paths.includes(path)) return { status: 'skipped', detail: 'the page no longer matches' };
      } else if (trig.kind === 'at') {
        const cur = this.attrCI(info, trig.prop)?.[0]?.text;
        if (cur !== trig.value) return { status: 'skipped', detail: `${trig.prop} changed` };
      }
      if (rule.where && trig.kind !== 'match' && path !== null && trig.kind !== 'deleted') {
        if (!(await this.query(rule, rule.where)).paths.includes(path)) return { status: 'skipped', detail: 'the page does not match "where"' };
      }
    }
    if (path !== null && info) {
      if (rule.require && (await this.query(rule, rule.require, path)).paths.length === 0) return { status: 'skipped', detail: 'does not meet "require"' };
      if (rule.unless && (await this.query(rule, rule.unless, path)).paths.length > 0) return { status: 'skipped', detail: 'meets "unless"' };
    }
    const vars = this.varsFor(rule, info, path, trig);
    if (rule.guard !== null && !truthy(evaluate(rule.guard, vars))) return { status: 'skipped', detail: 'the "if" condition is not met' };
    vars.let = {};
    for (const [k, v] of Object.entries(rule.let ?? {})) vars.let[k.toLowerCase()] = render(v, vars); // in order: a later one may use an earlier one
    const page = { path: path ?? '', attrs: vars.this };
    const ctx = { api: this.apiFor(rule, page, trig, vars, { depth, dry }), page, vars, rule, dry, results: [], stopped: false };
    const steps = await runActions(rule.actions, ctx);
    const failed = steps.find((s) => s.status === 'failed');
    const done = steps.filter((s) => s.status === 'done').length;
    const status = dry ? 'dry' : failed ? 'failed' : done === 0 ? 'skipped' : 'done';
    return { status, detail: failed ? failed.detail : steps.map((s) => `${s.action}: ${s.detail || s.status}`).join('; '), steps: [...steps, ...ctx.results.filter((r) => !steps.includes(r))], dry };
  }

  /** The door actions use. It notes which pages a rule writes, so the changes it causes are not mistaken for a person's. */
  apiFor(rule, page, trig, vars, { depth, dry }) {
    const h = this.host;
    const touch = (p) => {
      if (p) this.ownWrites.set(p, { depth: depth + 1, until: this.now().getTime() + 30_000 });
    };
    const api = {
      root: h.root,
      search: async (q, thisPath) => (await h.search(thisPath ? substituteThis(q, thisPath) : q, thisPath)).paths,
      resolvePage: (ref, from) => h.resolvePage(ref, from),
      readText: (p) => h.readText(p),
      async writeText(p, text, base) {
        if (dry) return { ok: true };
        touch(p);
        return h.writeText(p, text, base);
      },
      async setProperties(p, changes) {
        if (dry) return { changed: true };
        touch(p);
        return h.setProperties(p, changes);
      },
      async createPage(spec) {
        if (dry) return { path: spec.path ? `${spec.path}.md` : `${spec.parent ? `${spec.parent.replace(/\.md$/, '')}/` : ''}${spec.name}.md`, created: true };
        const r = await h.createPage(spec);
        touch(r.path);
        return r;
      },
      async movePage(p, dest) {
        if (dry) return { moved: true, to: `${dest.replace(/\/+$/, '').replace(/\.md$/, '')}/${p.split('/').pop()}` };
        touch(p);
        const r = await h.movePage(p, dest);
        if (r.moved) touch(r.to);
        return r;
      },
      async notify(n) {
        if (!dry) await h.notify(n);
      },
      /** Run a rule's JavaScript. A host that has its own door (the app asks the person first) supplies `js`; without one it runs in the sandbox directly. */
      js: async (spec) => {
        if (dry) return { dry: true };
        if (h.js) return h.js({ ruleId: rule.id, code: spec.code, input: spec.input, timeoutMs: spec.timeoutMs, page: page.path });
        return runSandbox(spec.code, spec.input, { timeoutMs: spec.timeoutMs });
      },
      shell: async (spec) => {
        if (dry) return { code: 0, dry: true };
        const info = vars.this;
        const env = {
          CAVE_RULE: rule.id,
          CAVE_TRIGGER: trig.kind,
          CAVE_WORKSPACE: h.root,
          CAVE_PAGE: page.path,
          CAVE_TITLE: stringify(info.title),
          CAVE_FILE_PATH: page.path ? h.absolutePath(page.path) : '',
          CAVE_FOLDER: page.path ? h.absolutePath(info.folder || '') : '',
          CAVE_NOW: stringify(vars.now),
          CAVE_TODAY: stringify(vars.today),
        };
        for (const [k, v] of Object.entries(info)) {
          if (['title', 'path', 'name', 'folder', 'parent', 'modified'].includes(k)) continue;
          if (/^[a-z_][a-z0-9_]*$/i.test(k) && !Array.isArray(v)) env[`CAVE_ATTR_${k.toUpperCase()}`] = stringify(v);
        }
        for (const [k, v] of Object.entries(spec.env ?? {})) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) env[k] = stringify(v);
        return h.shell({ ruleId: rule.id, command: spec.command, argv: spec.argv, cwd: spec.cwd, timeoutMs: spec.timeoutMs, env, page: page.path, template: spec.template });
      },
    };
    return api;
  }

  // ---------------------------------------------------------------- manual runs

  /**
   * Run a rule now, whatever its trigger says. `dry: true` changes nothing and reports what would happen.
   * Without `path` it takes the pages the rule's `where` picks (the first `limit`).
   */
  async runNow(ruleId, { dry = true, path = null, limit = 20 } = {}) {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (!rule) throw new Error(`There is no rule "${ruleId}".`);
    const paths = path !== null ? [path] : rule.where ? (await this.query(rule, rule.where)).paths.slice(0, limit) : [null];
    const out = [];
    const watched = rule.triggers.find((t) => t.kind === 'change');
    for (const p of paths) {
      const trig = { kind: 'manual' };
      if (watched && p !== null) {
        // a rule that reacts to a property gets its current value as "new", so a test run behaves like the real thing
        trig.prop = watched.prop;
        trig.new = textOf(this.attrCI(await this.host.pageInfo(p) ?? { attrs: {} }, watched.prop));
        trig.old = null;
      }
      const res = await this.runOne(rule, p, trig, { dry });
      this.record({ rule, path: p, trig, ...res, dry });
      out.push({ path: p, ...res });
    }
    if (!dry) await this.flush();
    return out;
  }

  // ---------------------------------------------------------------- buttons

  /**
   * A button in a page was clicked: `[=Label](automation:rule-id)`. Only a rule that lists `on: button` can be started
   * this way, so a note (which anyone may write) can never start a rule whose author did not mean it to be a button.
   * The rule runs for the page holding the button, here and now: the person who clicked is the one who made the change,
   * so it does not wait for its turn among several computers. The page must still meet `where`, `require`, `unless` and `if`.
   * Returns { status: 'done' | 'failed' | 'skipped' | 'refused', detail, steps }. `refused` means the rule was not started at all.
   */
  async runButton(ruleId, path) {
    const rule = this.rules.find((r) => r.id === ruleId);
    const refuse = (detail) => ({ status: 'refused', detail, steps: [] });
    if (!rule) return refuse(`There is no rule “${ruleId}” in this workspace's automations.`);
    if (!rule.enabled || rule.disabledByUser) return refuse(`The rule “${ruleId}” is switched off (enabled: false).`);
    if (!rule.triggers.some((t) => t.kind === 'button')) return refuse(`The rule “${ruleId}” cannot be started by a button. Add “button” to its “on:”, for example “on: button”.`);
    if (!this.deviceAllowed(rule)) return refuse(`The rule “${ruleId}” is set to run only on the computer named “${rule.device}”, and this one is “${this.deviceName}”.`);
    if (!path) return refuse('A button runs a rule for the page it is in, and this one is not in a page.');
    const trig = { kind: 'button' };
    let res;
    try {
      res = await this.runOne(rule, path, trig, { check: true });
    } catch (e) {
      res = { status: 'failed', detail: e.message, steps: [] };
    }
    this.record({ rule, path, trig, ...res });
    await this.flush();
    return { status: res.status, detail: res.detail, steps: res.steps ?? [] };
  }

  // ---------------------------------------------------------------- plugins

  /** The rules that show in the Plugins menu: [{ id, label, ask }]. */
  plugins() {
    const out = [];
    for (const r of this.rules) {
      if (!r.enabled || r.disabledByUser || !this.deviceAllowed(r)) continue;
      const t = r.triggers.find((x) => x.kind === 'plugin');
      if (t) out.push({ id: r.id, label: t.label ?? r.name, ask: r.ask });
    }
    return out;
  }

  /**
   * The questions of a plugin as the window shows them: the `label` and `default` of each may use `${ }` with the text the plugin
   * is about to work on (`words`, `characters`, `selection`), which is how a plugin shows a result in a dialog (`type: info`).
   */
  async pluginQuestions(ruleId, { path = null, text = '', selection = false } = {}) {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (!rule) return [];
    let vars = null;
    try {
      const info = path ? await this.host.pageInfo(path) : null;
      vars = this.varsFor(rule, info, path, { kind: 'plugin' });
      vars.ask = {};
      vars.selection = selection;
      Object.assign(vars, textStats(text));
      vars.let = {};
      for (const [k, v] of Object.entries(rule.let ?? {})) vars.let[k.toLowerCase()] = render(v, vars);
    } catch {
      return rule.ask;
    }
    const show = (s) => {
      if (typeof s !== 'string') return s;
      try {
        return String(render(s, vars));
      } catch {
        return s;
      }
    };
    return rule.ask.map((q) => ({ ...q, label: show(q.label), default: show(q.default) }));
  }

  /**
   * Run a plugin: a rule with `on: { plugin }`. It gets the text to work on (the selection, or the whole page when nothing is
   * selected; the window decides which and says so with `selection`) and the answers to its `ask:` questions as `${ask.name}`.
   * Nothing is written to the page here: the changed text goes back to the window, which puts it into the editor (one undo step).
   * Returns { status, detail, steps, text, changed }.
   */
  async runPlugin(ruleId, { path = null, text, selection = false, answers = {}, cursor = null }) {
    const rule = this.rules.find((r) => r.id === ruleId);
    const refuse = (detail) => ({ status: 'refused', detail, steps: [], text, changed: false });
    if (!rule) return refuse(`There is no rule “${ruleId}” in this workspace's automations.`);
    if (!rule.enabled || rule.disabledByUser) return refuse(`The rule “${ruleId}” is switched off (enabled: false).`);
    if (!rule.triggers.some((t) => t.kind === 'plugin')) return refuse(`The rule “${ruleId}” is not a plugin. Add “plugin: Name” to its “on:”.`);
    if (!this.deviceAllowed(rule)) return refuse(`The rule “${ruleId}” is set to run only on the computer named “${rule.device}”.`);
    const trig = { kind: 'plugin' };
    let res;
    let out = text;
    let selectionOut = null;
    let failedOut = false;
    try {
      const info = path ? await this.host.pageInfo(path) : null;
      const vars = this.varsFor(rule, info, path, trig);
      vars.ask = coerceAnswers(rule.ask, answers);
      vars.selection = selection;
      Object.assign(vars, textStats(text));
      vars.let = {};
      for (const [k, v] of Object.entries(rule.let ?? {})) vars.let[k.toLowerCase()] = render(v, vars);
      const page = { path: path ?? '', attrs: vars.this };
      const at = typeof cursor === 'number' && cursor >= 0 ? Math.min(cursor, text.length) : null;
      let cur = null;
      if (at !== null) {
        const start = text.lastIndexOf('\n', at - 1) + 1;
        cur = { offset: at, line: text.slice(0, start).split('\n').length, column: at - start + 1 };
      }
      const ctx = { api: this.apiFor(rule, page, trig, vars, { depth: 0, dry: false }), page, vars, rule, dry: false, results: [], stopped: false, text, selection, cursor: cur, selectionOut: null };
      const steps = await runActions(rule.actions, ctx);
      const failed = steps.find((s) => s.status === 'failed');
      out = failed ? text : ctx.text;
      failedOut = Boolean(failed);
      selectionOut = ctx.selectionOut ?? null;
      const done = steps.filter((s) => s.status === 'done').length;
      res = { status: failed ? 'failed' : done === 0 ? 'skipped' : 'done', detail: failed ? failed.detail : steps.map((s) => `${s.action}: ${s.detail || s.status}`).join('; '), steps };
    } catch (e) {
      res = { status: 'failed', detail: e.message, steps: [] };
    }
    this.record({ rule, path, trig, ...res });
    await this.flush();
    return { ...res, text: out, changed: out !== text, selection: failedOut ? null : selectionOut };
  }

  // ---------------------------------------------------------------- bookkeeping

  record({ rule, path, trig, status, detail, steps, dry }) {
    const entry = { t: this.now().getTime(), rule: rule.id, path: path ?? null, trigger: trig.kind, status, detail: detail ?? '', steps: steps ?? [], dry: dry === true };
    this.history.push(entry);
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.note(status === 'failed' ? 'warn' : 'info', `automation ${rule.id}${path ? ` on ${path}` : ''} (${trig.kind}): ${status}${detail ? ` - ${detail}` : ''}`);
    try {
      this.host.appendLog?.(entry);
    } catch {
      /* the log is a courtesy */
    }
    if (!entry.dry && (status === 'done' || status === 'failed')) {
      try {
        this.host.onRun?.(entry);
      } catch {
        /* telling the window is a courtesy too */
      }
    }
    return entry;
  }

  log(limit = 100) {
    return this.history.slice(-limit).reverse();
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.host.saveState?.(this.state);
    } catch (e) {
      this.note('warn', `automations: could not save state: ${e.message}`);
    }
    if (this.ledgerDirty && this.host.writeDevice && this.activeRules().some((r) => r.runs === 'once')) {
      this.ledgerDirty = false;
      await this.heartbeat(true); // tell the other computers at once what has been done
    }
  }

  /**
   * The rules that are about this page right now: those with a `where`, `require` or `unless` query that the page
   * satisfies (a rule with none of them is about every page, which is not worth pointing out). Triggers and the `if`
   * condition depend on what is happening, so they are not part of the question.
   */
  async rulesFor(path) {
    const out = [];
    if (!path) return out;
    for (const rule of this.activeRules()) {
      if (!rule.where && !rule.require && !rule.unless) continue;
      try {
        if (rule.where && !(await this.query(rule, rule.where)).paths.includes(path)) continue;
        if (rule.require && (await this.query(rule, rule.require, path)).paths.length === 0) continue;
        if (rule.unless && (await this.query(rule, rule.unless, path)).paths.length > 0) continue;
      } catch {
        continue;
      }
      out.push({ id: rule.id, name: rule.name, triggers: rule.triggers.map((t) => t.kind), definition: rule.definition ?? '' });
    }
    return out;
  }

  status() {
    return {
      rules: this.rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, runs: r.runs, device: r.device, triggers: r.triggers.map((t) => t.kind), usesShell: r.usesShell })),
      problems: this.problems,
      pending: this.state.pending.length,
      device: { id: this.deviceId, name: this.deviceName },
    };
  }
}

