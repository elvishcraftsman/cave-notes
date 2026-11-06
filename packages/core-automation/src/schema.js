/**
 * Reads `.cave-notes/automations.yaml`. Rules live only in this file, never in a note's frontmatter, so a note
 * that arrives from someone else (or from another computer) can never carry a rule with it.
 *
 *   settings: { devices: [laptop, desktop], sync_delay: 60s }     (optional; also accepted at the top level)
 *   rules:
 *     - id: recur-task
 *       where: kind:task recurs:weekly
 *       on: { change: status, to: done }
 *       do:
 *         - create_page: { ... }
 *
 * A bad rule is reported and skipped; the others still load.
 */
import YAML from 'yaml';
import { durationMs, parseClock, parseDuration } from './dates.js';
import { parseCron } from './cron.js';
import { checkTemplate } from './expr.js';
import { ACTIONS, normalizeActionList } from './actions.js';

export const FILE_CHANGING = new Set(['set_property', 'remove_property', 'add_days', 'move_file', 'create_page', 'append_to_page', 'copy_tasks', 'update_pages']);

export const DEFAULT_SETTINGS = {
  devices: [],
  syncDelayMs: 60_000,
  liveWindowMs: 12 * 60_000,
  heartbeatMs: 5 * 60_000,
  maxDepth: 3,
  maxRunsPerMinute: 120,
};

const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const TRIGGER_ALIASES = { file_create: 'created', file_modify: 'modified', file_delete: 'deleted', created: 'created', modified: 'modified', deleted: 'deleted', match: 'match', button: 'button', plugin: 'plugin' };

function normalizeOne(raw) {
  // original long form: { on: property_change | time | due_date | file_create ..., property, to, cron, ... }
  if (isMap(raw) && typeof raw.on === 'string') {
    const k = raw.on;
    if (k === 'property_change') return normalizeOne({ change: raw.property, from: raw.from, to: raw.to });
    if (k === 'time') return normalizeOne({ schedule: raw.cron });
    if (k === 'due_date') return normalizeOne({ at: raw.property, offset: raw.offset, time: raw.time, late: raw.late });
    return normalizeOne(k);
  }
  if (typeof raw === 'string') {
    const kind = TRIGGER_ALIASES[raw];
    if (!kind) throw new Error(`unknown trigger "${raw}" (try: change, match, schedule, at, created, modified, deleted, button, plugin)`);
    if (kind === 'plugin') return { kind, label: null };
    return kind === 'match' ? { kind, existing: false } : { kind };
  }
  if (!isMap(raw)) throw new Error('a trigger is written as "on: { ... }"');
  const prop = (v, what) => {
    if (typeof v !== 'string' || !/^[A-Za-z_][\w-]*$/.test(v.trim())) throw new Error(`${what} must be a property name`);
    return v.trim().toLowerCase();
  };
  if ('change' in raw) {
    const t = { kind: 'change', prop: prop(raw.change, 'change'), from: raw.from ?? null, to: raw.to ?? null };
    for (const k of ['from', 'to']) if (t[k] !== null && !['string', 'number', 'boolean'].includes(typeof t[k])) throw new Error(`"${k}" must be a plain value`);
    return t;
  }
  if ('schedule' in raw || 'cron' in raw) {
    const src = raw.schedule ?? raw.cron;
    if (typeof src !== 'string') throw new Error('schedule must be a cron expression such as "0 8 * * *" (or @daily, @weekly)');
    const cron = parseCron(src);
    return { kind: 'schedule', cron: src, parsed: cron };
  }
  if ('at' in raw || 'due' in raw) {
    const p = prop(raw.at ?? raw.due, 'at');
    const offset = raw.offset === undefined ? null : raw.offset;
    if (offset !== null) parseDuration(offset);
    let time = null;
    if (raw.time !== undefined) {
      time = parseClock(raw.time);
      if (time === null) throw new Error('time must look like "09:00"');
    }
    let late = 3 * 86_400_000;
    if (raw.late !== undefined) {
      const { n, unit } = parseDuration(raw.late);
      late = n * ({ min: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit] ?? 0);
      if (!(late > 0)) throw new Error('late must be a duration such as 3d (at most 30d)');
    }
    return { kind: 'at', prop: p, offset, time: time ?? 9 * 60, timeGiven: time !== null, late: Math.min(late, 30 * 86_400_000) };
  }
  if ('match' in raw) return { kind: 'match', existing: raw.existing === true };
  // `on: button` (or `on: { button: true }`): the rule runs when someone clicks a button that names it, `[=Label](automation:id)`
  if ('button' in raw) return { kind: 'button' };
  // `on: { plugin: "Name" }`: the rule is listed under the Plugins button of the window and runs on the selected text (or the whole page)
  if ('plugin' in raw) {
    if (raw.plugin !== true && (typeof raw.plugin !== 'string' || raw.plugin.trim() === '')) throw new Error('plugin is the name shown in the Plugins menu: on: { plugin: "Numbered list to headings" }');
    return { kind: 'plugin', label: raw.plugin === true ? null : raw.plugin.trim() };
  }
  for (const k of ['created', 'modified', 'deleted']) if (k in raw) return { kind: k };
  throw new Error(`unknown trigger (found ${Object.keys(raw).join(', ') || 'nothing'}; use change, match, schedule, at, created, modified, deleted, button or plugin)`);
}

function collectActions(list, out = []) {
  for (const a of list) {
    out.push(a.name);
    if (a.name === 'run_shell') {
      collectActions(a.args.on_success, out);
      collectActions(a.args.on_failure, out);
    }
  }
  return out;
}

const ASK_TYPES = new Set(['text', 'number', 'select', 'boolean', 'info']);

/** `ask:` of a rule: the questions a plugin puts to the person before it runs, as a mapping name -> { label, type, default, options, min, max }. */
export function normalizeAsk(raw) {
  if (raw === undefined) return [];
  if (!isMap(raw)) throw new Error('"ask" is a mapping of questions: ask: { level: { label: "Heading level", type: number, default: 2 } }');
  const out = [];
  for (const [name, spec0] of Object.entries(raw)) {
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`ask: the name "${name}" must be letters, digits and _`);
    const spec = isMap(spec0) ? spec0 : { label: typeof spec0 === 'string' ? spec0 : name };
    const type = String(spec.type ?? (Array.isArray(spec.options) ? 'select' : 'text')).toLowerCase();
    if (!ASK_TYPES.has(type)) throw new Error(`ask: "${name}" has type "${type}"; use text, number, select, boolean or info`);
    const options = spec.options === undefined ? null : Array.isArray(spec.options) ? spec.options.map(String) : null;
    if (type === 'select' && (!options || options.length === 0)) throw new Error(`ask: "${name}" is a select and needs a list of options`);
    for (const k of ['min', 'max']) if (spec[k] !== undefined && !Number.isFinite(Number(spec[k]))) throw new Error(`ask: "${name}": ${k} must be a number`);
    out.push({
      name,
      label: typeof spec.label === 'string' && spec.label.trim() ? spec.label.trim() : name,
      type,
      default: spec.default === undefined ? null : spec.default,
      options,
      min: spec.min === undefined ? null : Number(spec.min),
      max: spec.max === undefined ? null : Number(spec.max),
    });
  }
  return out;
}

/** Check the answers a person gave against the questions, and give them the types the rule expects. */
export function coerceAnswers(ask, answers) {
  const values = {};
  for (const q of ask) {
    if (q.type === 'info') continue; // a message, not a question
    let v = answers && q.name in answers ? answers[q.name] : q.default;
    if (q.type === 'number') {
      if (v === null || v === '' || !Number.isFinite(Number(v))) throw new Error(`"${q.label}" needs a number`);
      v = Number(v);
      if (q.min !== null && v < q.min) throw new Error(`"${q.label}" must be at least ${q.min}`);
      if (q.max !== null && v > q.max) throw new Error(`"${q.label}" must be at most ${q.max}`);
    } else if (q.type === 'boolean') v = v === true || v === 'true';
    else if (q.type === 'select') {
      v = v === null || v === undefined ? q.options[0] : String(v);
      if (!q.options.includes(v)) throw new Error(`"${q.label}" must be one of ${q.options.join(', ')}`);
    } else v = v === null || v === undefined ? '' : String(v);
    values[q.name] = v;
  }
  return values;
}

function normalizeRule(raw, index, seen) {
  if (!isMap(raw)) throw new Error('a rule is a mapping with id, on and do');
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(id)) throw new Error('every rule needs an "id" of letters, digits, - _ . (it names the rule in the log)');
  if (seen.has(id)) throw new Error(`the id "${id}" is used twice`);
  const onRaw = raw.on ?? raw.trigger;
  if (onRaw === undefined) throw new Error('the rule has no "on:" trigger');
  const list = Array.isArray(onRaw) ? onRaw : [onRaw];
  const triggers = list.map(normalizeOne);
  const doRaw = raw.do ?? raw.actions;
  if (!Array.isArray(doRaw) || doRaw.length === 0) throw new Error('the rule has no "do:" list of actions');
  const actions = normalizeActionList(doRaw, 'do');
  for (const k of ['where', 'require', 'unless']) if (raw[k] !== undefined && typeof raw[k] !== 'string') throw new Error(`"${k}" must be a query written as text`);
  if (raw.if !== undefined) checkTemplate(`\${${String(raw.if)}}`);
  let lets = null;
  if (raw.let !== undefined) {
    if (!isMap(raw.let)) throw new Error('"let" is a mapping of names to values: let: { days: "${...}" }');
    lets = {};
    for (const [k, v] of Object.entries(raw.let)) {
      if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error(`"let" name "${k}" must be letters, digits and _`);
      if (typeof v === 'string') checkTemplate(v);
      else if (!['number', 'boolean'].includes(typeof v)) throw new Error(`"let ${k}" must be text, a number or true/false`);
      lets[k] = v;
    }
  }
  for (const t of triggers) {
    if (t.kind === 'schedule' && !raw.where && actions.some((a) => ACTIONS[a.name] && FILE_CHANGING.has(a.name) && a.name !== 'create_page' && a.name !== 'append_to_page' && a.name !== 'copy_tasks' && a.name !== 'update_pages')) {
      throw new Error('a schedule without "where:" has no page to change: add a query that picks the pages, or use create_page / append_to_page / copy_tasks');
    }
    if (t.kind === 'match' && !raw.where) throw new Error('the "match" trigger needs a "where:" query to match');
  }
  const names = collectActions(actions);
  const shell = names.includes('run_shell');
  const warnings = [];
  const device = raw.device === undefined ? null : String(raw.device);
  let runs = raw.runs;
  if (runs !== undefined && runs !== 'once' && runs !== 'everywhere') throw new Error('"runs" is once or everywhere');
  let enabled = raw.enabled !== false;
  if (runs === undefined) {
    if (names.some((n) => FILE_CHANGING.has(n))) runs = 'once';
    else if (shell) {
      if (device === null) {
        enabled = false;
        warnings.push(`${id}: shell rules must say where they run: add "device: <name>" or "runs: once" or "runs: everywhere". The rule is switched off until then.`);
      }
      runs = 'once';
    } else runs = 'everywhere';
  }
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    enabled,
    where: raw.where?.trim() || null,
    require: raw.require?.trim() || null,
    unless: raw.unless?.trim() || null,
    guard: raw.if === undefined ? null : String(raw.if),
    let: lets,
    triggers,
    ask: normalizeAsk(raw.ask),
    actions,
    runs,
    device,
    usesShell: shell,
    warnings,
    index,
    definition: ruleDefinition(raw),
  };
}

/** The rule as it was written, as YAML text (for showing it to the person). */
function ruleDefinition(raw) {
  try {
    return YAML.stringify(raw, { lineWidth: 0 }).trimEnd();
  } catch {
    return '';
  }
}

/** Parse the rules file. Returns { rules, settings, warnings, errors }. `errors` stop everything (YAML broken). */
export function parseAutomations(text) {
  const out = { rules: [], settings: { ...DEFAULT_SETTINGS }, warnings: [], errors: [] };
  if (text === null || text === undefined || String(text).trim() === '') return out;
  let doc;
  try {
    doc = YAML.parse(String(text));
  } catch (e) {
    out.errors.push(`The automations file is not valid YAML: ${e.message.split('\n')[0]}`);
    return out;
  }
  if (doc === null || doc === undefined) return out;
  let rawRules;
  let root = {};
  if (Array.isArray(doc)) rawRules = doc;
  else if (isMap(doc)) {
    root = { ...doc, ...(isMap(doc.settings) ? doc.settings : {}) };
    rawRules = doc.rules ?? [];
  } else {
    out.errors.push('The automations file should be a list of rules, or a mapping with "rules:".');
    return out;
  }
  if (!Array.isArray(rawRules)) {
    out.errors.push('"rules:" must be a list.');
    return out;
  }

  const s = out.settings;
  const dur = (key, label) => {
    try {
      return durationMs(root[key]);
    } catch (e) {
      out.warnings.push(`${label}: ${e.message} (using the default)`);
      return null;
    }
  };
  if (Array.isArray(root.devices)) s.devices = root.devices.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  if (root.sync_delay !== undefined) s.syncDelayMs = dur('sync_delay', 'sync_delay') ?? s.syncDelayMs;
  if (root.live_window !== undefined) s.liveWindowMs = dur('live_window', 'live_window') ?? s.liveWindowMs;
  if (root.heartbeat !== undefined) s.heartbeatMs = dur('heartbeat', 'heartbeat') ?? s.heartbeatMs;
  if (Number.isInteger(root.max_depth) && root.max_depth >= 1 && root.max_depth <= 10) s.maxDepth = root.max_depth;
  if (Number.isInteger(root.max_runs_per_minute) && root.max_runs_per_minute >= 1) s.maxRunsPerMinute = root.max_runs_per_minute;

  const seen = new Set();
  rawRules.forEach((raw, i) => {
    const label = isMap(raw) && typeof raw.id === 'string' ? `rule "${raw.id}"` : `rule #${i + 1}`;
    try {
      const rule = normalizeRule(raw, i, seen);
      seen.add(rule.id);
      out.warnings.push(...rule.warnings);
      out.rules.push(rule);
    } catch (e) {
      out.warnings.push(`${label}: ${e.message}`);
    }
  });
  return out;
}
