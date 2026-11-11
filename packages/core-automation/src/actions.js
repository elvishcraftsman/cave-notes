/**
 * The actions a rule can run. Each one is { summary, raw?, normalize(args), run(ctx, args) }:
 *
 *  - `normalize` checks the YAML when the rules are loaded and returns a clean args object (or throws).
 *  - `run` does the work through `ctx.api`, the only door to the workspace. `run_js` hands a script the same
 *    pieces (text, properties) and applies what it returns through the same `ctx.api`.
 *  - `${...}` in the args is filled in before `run`, except for the keys named in `raw` (shell commands are never
 *    interpolated: values reach them as environment variables).
 *
 * Every action is written to be safe to run twice (a second run finds the work done and changes nothing), because
 * two computers may both react to the same change.
 */
import YAML from 'yaml';
import { DateValue, addDuration, isDateValue, parseDateValue, parseDuration } from './dates.js';
import { checkTemplate, evaluate, render, stringify, truthy } from './expr.js';
import { SANDBOX_DEFAULTS } from '#sandbox';
import { checkJsSyntax } from '#js-syntax';

export const ACTIONS = {};
const defAction = (name, def) => {
  ACTIONS[name] = def;
};

const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const bad = (msg) => {
  throw new Error(msg);
};
const str = (v, what) => {
  if (typeof v !== 'string' || v.trim() === '') bad(`${what} must be text`);
  return v;
};

/** Every text in the args must have well-formed `${...}`. */
function checkTemplates(x, skip = []) {
  if (typeof x === 'string') checkTemplate(x);
  else if (Array.isArray(x)) x.forEach((v) => checkTemplates(v));
  else if (isMap(x)) for (const [k, v] of Object.entries(x)) if (!skip.includes(k)) checkTemplates(v);
}

/** What a value becomes in a note's frontmatter. Dates are written as text; lists item by item. */
export function toStored(v) {
  if (v === undefined) return null;
  if (isDateValue(v)) return v.toString();
  if (Array.isArray(v)) return v.map(toStored);
  return v;
}

// ---------------------------------------------------------------- properties

defAction('set_property', {
  summary: 'Set one or more properties of the page (written into its frontmatter). A value of null removes the property.',
  normalize(a) {
    if (!isMap(a)) bad('set_property needs a mapping');
    const entries = 'field' in a ? [[str(a.field, 'field'), a.value ?? null]] : Object.entries(a);
    if (entries.length === 0) bad('set_property needs a field and a value');
    for (const [k] of entries) if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(k)) bad(`"${k}" is not a valid property name`);
    return { set: entries.map(([k, v]) => [k, v]) };
  },
  async run(ctx, a) {
    const changes = {};
    for (const [k, v] of a.set) changes[k] = toStored(v);
    const r = await ctx.api.setProperties(ctx.page.path, changes);
    return r.changed ? `set ${Object.keys(changes).join(', ')}` : { status: 'skipped', detail: 'already set' };
  },
});

defAction('update_pages', {
  summary: 'Set properties on other pages: every page a query finds, where `$this` in the query means the page that triggered the rule. For keeping related pages in step (a project\'s status on its tasks, an organisation\'s name on the people linked to it).',
  normalize(a) {
    if (!isMap(a)) bad('update_pages needs where and set');
    str(a.where, 'where');
    if (!isMap(a.set) || Object.keys(a.set).length === 0) bad('update_pages needs "set:" with the properties to give');
    for (const k of Object.keys(a.set)) if (!/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(k)) bad(`"${k}" is not a valid property name`);
    const limit = a.limit === undefined ? 100 : Number(a.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) bad('limit is a whole number from 1 to 500');
    return { where: a.where, set: a.set, limit };
  },
  async run(ctx, a) {
    const paths = (await ctx.api.search(String(a.where), ctx.page.path || null)).filter((p) => p !== ctx.page.path);
    const changes = {};
    for (const [k, v] of Object.entries(a.set)) changes[k] = toStored(v);
    let changed = 0;
    for (const p of paths.slice(0, a.limit)) if ((await ctx.api.setProperties(p, changes)).changed) changed++;
    const extra = paths.length > a.limit ? ` (${paths.length - a.limit} more not touched: limit ${a.limit})` : '';
    return changed > 0 ? `updated ${changed} of ${Math.min(paths.length, a.limit)} page(s)${extra}` : { status: 'skipped', detail: `${paths.length === 0 ? 'no pages found' : 'already up to date'}${extra}` };
  },
});

defAction('remove_property', {
  summary: 'Remove one or more properties from the page.',
  normalize(a) {
    const list = typeof a === 'string' ? [a] : Array.isArray(a) ? a : isMap(a) && 'field' in a ? (Array.isArray(a.field) ? a.field : [a.field]) : bad('remove_property needs a property name or a list of them');
    return { fields: list.map((f) => str(f, 'property name')) };
  },
  async run(ctx, a) {
    const changes = Object.fromEntries(a.fields.map((f) => [f, null]));
    const r = await ctx.api.setProperties(ctx.page.path, changes);
    return r.changed ? `removed ${a.fields.join(', ')}` : { status: 'skipped', detail: 'not there' };
  },
});

defAction('add_days', {
  summary: 'Move a date property forward (or back, with a negative number). Not repeat-safe: it shifts every time it runs. Use `from` to shift from a fixed date instead.',
  normalize(a) {
    if (!isMap(a)) bad('add_days needs field and days');
    str(a.field, 'field');
    if (a.days === undefined) bad('add_days needs "days"');
    return { field: a.field, days: a.days, from: a.from ?? null, unit: a.unit ?? 'd' };
  },
  async run(ctx, a) {
    const base = a.from !== null ? parseDateValue(stringify(a.from)) ?? (isDateValue(a.from) ? a.from : null) : parseDateValue(stringify(ctx.vars.this?.[a.field.toLowerCase()] ?? ctx.page.attrs?.[a.field.toLowerCase()]));
    if (!base) throw new Error(`"${a.field}" is not a date on this page (give "from" to start from another date)`);
    const unit = String(a.unit);
    const next = addDuration(base, parseDuration(`${Number(a.days)}${unit}`));
    const r = await ctx.api.setProperties(ctx.page.path, { [a.field]: next.toString() });
    return r.changed ? `${a.field} is now ${next}` : { status: 'skipped', detail: 'already that date' };
  },
});

// ---------------------------------------------------------------- files

defAction('move_file', {
  summary: 'Move the page (with its sub-pages) under another page or folder, updating links to it. Nothing happens if it is already there.',
  normalize(a) {
    const to = typeof a === 'string' ? a : isMap(a) ? a.to : null;
    return { to: str(to, 'move_file destination') };
  },
  async run(ctx, a) {
    const r = await ctx.api.movePage(ctx.page.path, a.to);
    if (!r.moved) return { status: 'skipped', detail: r.reason ?? 'already there' };
    ctx.page.path = r.to;
    if (ctx.vars.this) ctx.vars.this.path = r.to;
    return `moved to ${r.to}`;
  },
});

defAction('create_page', {
  summary: 'Create a page, unless one with that name already exists. Optionally from a template page, with properties. Afterwards `${created.path}` names it.',
  normalize(a) {
    if (!isMap(a)) bad('create_page needs a mapping with a name');
    str(a.name, 'name');
    if (a.properties !== undefined && !isMap(a.properties)) bad('properties must be a mapping');
    return { name: a.name, in: a.in ?? null, content: a.content ?? null, template: a.template ?? null, properties: a.properties ?? {} };
  },
  async run(ctx, a) {
    let content = a.content;
    if (content === null && a.template) {
      const t = await ctx.api.readText(await ctx.api.resolvePage(String(a.template), ctx.page.path) ?? '');
      if (!t) throw new Error(`template page "${a.template}" was not found`);
      content = t.text;
    }
    const r = await ctx.api.createPage({ parent: a.in === null ? null : String(a.in), name: String(a.name), content: content === null ? null : String(content) });
    ctx.vars.created = { path: r.path, title: String(a.name), existed: !r.created };
    if (!r.created) return { status: 'skipped', detail: `${r.path} already exists` };
    const props = {};
    for (const [k, v] of Object.entries(a.properties)) props[k] = toStored(v);
    if (Object.keys(props).length > 0) await ctx.api.setProperties(r.path, props);
    return `created ${r.path}`;
  },
});

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Insert text at the end of a page, or at the end of one of its sections. List items join the list above them. */
export function insertText(text, add, heading = null) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = add.replace(/\r?\n/g, eol).replace(/\s+$/, '');
  const joins = (prev) => LIST_ITEM.test(prev ?? '') && LIST_ITEM.test(block);
  if (!heading) {
    const body = text.replace(/\s+$/, '');
    if (body === '') return `${block}${eol}`;
    const last = body.split(/\r?\n/).pop();
    return `${body}${eol}${joins(last) ? '' : eol}${block}${eol}`;
  }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*#*\\s*$`, 'i').test(l));
  if (at < 0) return `${text.replace(/\s+$/, '')}${eol}${eol}## ${heading}${eol}${eol}${block}${eol}`;
  const level = /^#+/.exec(lines[at])[0].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  while (end > at + 1 && lines[end - 1].trim() === '') end--;
  const prev = end - 1 > at ? lines[end - 1] : '';
  lines.splice(end, 0, ...(joins(prev) ? [] : ['']), ...block.split(/\r?\n/));
  const out = lines.join(eol);
  return end >= lines.length - block.split(/\r?\n/).length ? `${out.replace(/\s+$/, '')}${eol}` : out;
}

defAction('append_to_page', {
  summary: 'Add text to the end of a page (this one by default), or to the end of one of its headings. Skipped if the text is already there.',
  normalize(a) {
    if (!isMap(a)) bad('append_to_page needs a mapping with text');
    str(a.text, 'text');
    return { page: a.page ?? null, text: a.text, heading: a.heading ?? null, create_missing: a.create_missing === true };
  },
  async run(ctx, a) {
    const target = a.page === null ? ctx.page.path : await ctx.api.resolvePage(String(a.page), ctx.page.path);
    let path = target;
    if (!path) {
      if (!a.create_missing) throw new Error(`page "${a.page}" was not found`);
      path = (await ctx.api.createPage({ parent: null, name: String(a.page), content: null, path: String(a.page) })).path;
    }
    const cur = await ctx.api.readText(path);
    if (!cur) throw new Error(`page "${path}" has no file`);
    if (cur.text.includes(String(a.text).trim())) return { status: 'skipped', detail: 'text already there' };
    const next = insertText(cur.text, String(a.text), a.heading === null ? null : String(a.heading));
    const w = await ctx.api.writeText(path, next, cur.hash);
    if (!w.ok) throw new Error(`${path} changed while the rule ran; nothing was written (it will be tried again on the next change)`);
    return `added text to ${path}`;
  },
});

// ---------------------------------------------------------------- transforming text (plugins)

const TEXT_STEPS = {
  regex(a, text) {
    if (!isMap(a) || typeof a.find !== 'string' || a.find === '') bad('regex needs "find" (a regular expression) and "replace"');
    const flags = typeof a.flags === 'string' ? a.flags : 'gm';
    if (!/^[gimsu]*$/.test(flags)) bad('regex flags may be g, i, m, s, u');
    let re;
    try {
      re = new RegExp(a.find, flags);
    } catch (e) {
      bad(`regex: ${e.message}`);
    }
    return text.replace(re, String(a.replace ?? ''));
  },
  heading_shift(a, text) {
    const by = Number(isMap(a) ? a.by : a);
    if (!Number.isInteger(by) || by === 0) bad('heading_shift: by must be a whole number such as 1 or -1');
    return text.replace(/^(#{1,6})(\s)/gm, (_, h, sp) => `${'#'.repeat(Math.min(6, Math.max(1, h.length + by)))}${sp}`);
  },
  trim_lines(_a, text) {
    return text.replace(/[ \t]+$/gm, '');
  },
};

defAction('transform_text', {
  summary: 'In a plugin: change the selected text, or the whole page when nothing is selected. Steps: regex, heading_shift, trim_lines. For anything else, use run_js.',
  normalize(a) {
    const list = isMap(a) && Array.isArray(a.steps) ? a.steps : null;
    if (!list || list.length === 0) bad('transform_text needs "steps:", a list such as - heading_shift: { by: 1 }');
    const steps = list.map((s) => {
      const name = typeof s === 'string' ? s : isMap(s) && Object.keys(s).length === 1 ? Object.keys(s)[0] : null;
      if (!name || !TEXT_STEPS[name]) bad(`transform_text: unknown step (use ${Object.keys(TEXT_STEPS).join(', ')})`);
      return { [name]: typeof s === 'string' ? {} : s[name] };
    });
    checkTemplates(steps);
    return { steps };
  },
  run(ctx, a) {
    if (typeof ctx.text !== 'string') bad('transform_text only works in a plugin (a rule with "on: { plugin: ... }")');
    let text = ctx.text;
    for (const s of a.steps) {
      const [name, args] = Object.entries(s)[0];
      text = TEXT_STEPS[name](args, text);
    }
    if (text === ctx.text) return { status: 'skipped', detail: 'the text did not change' };
    ctx.text = text;
    return `changed the ${ctx.selection ? 'selection' : 'page text'}`;
  },
});

/** The unfinished tasks of a text: each `- [ ]` line with the indented lines beneath it. */
export function findOpenTasks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)[-*+]\s+\[ \]\s+\S/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && /^\s*/.exec(lines[j])[0].length > indent) j++;
    out.push({ start: i, end: j, lines: lines.slice(i, j) });
    i = j - 1;
  }
  return out;
}

defAction('copy_tasks', {
  summary: 'Carry the unfinished tasks (`- [ ]`) of one page into another, creating it if needed. With `mode: move` the originals become `[>]`. Tasks already in the target are not repeated.',
  normalize(a) {
    if (!isMap(a)) bad('copy_tasks needs from and to');
    str(a.from, 'from');
    str(a.to, 'to');
    const mode = a.mode ?? 'copy';
    if (mode !== 'copy' && mode !== 'move') bad('mode must be copy or move');
    return { from: a.from, to: a.to, mode, heading: a.heading ?? null, create_missing: a.create_missing !== false };
  },
  async run(ctx, a) {
    const from = await ctx.api.resolvePage(String(a.from), ctx.page.path);
    if (!from) return { status: 'skipped', detail: `"${a.from}" does not exist` };
    const src = await ctx.api.readText(from);
    if (!src) return { status: 'skipped', detail: 'nothing to read' };
    const tasks = findOpenTasks(src.text);
    if (tasks.length === 0) return { status: 'skipped', detail: 'no open tasks' };
    let to = await ctx.api.resolvePage(String(a.to), ctx.page.path);
    if (!to) {
      if (!a.create_missing) return { status: 'skipped', detail: `"${a.to}" does not exist` };
      to = (await ctx.api.createPage({ parent: null, name: String(a.to), content: null, path: String(a.to) })).path;
    }
    const dst = await ctx.api.readText(to);
    if (!dst) throw new Error(`"${to}" has no file`);
    const fresh = tasks.filter((t) => !dst.text.includes(t.lines[0].trim()));
    if (fresh.length > 0) {
      const block = fresh.map((t) => t.lines.join('\n')).join('\n');
      const w = await ctx.api.writeText(to, insertText(dst.text, block, a.heading === null ? null : String(a.heading)), dst.hash);
      if (!w.ok) throw new Error(`${to} changed while the rule ran; nothing was written`);
    }
    if (a.mode === 'move') {
      const lines = src.text.split(/\r?\n/);
      for (const t of tasks) lines[t.start] = lines[t.start].replace('[ ]', '[>]');
      await ctx.api.writeText(from, lines.join(src.text.includes('\r\n') ? '\r\n' : '\n'), src.hash);
    }
    return fresh.length > 0 ? `carried ${fresh.length} task(s) to ${to}` : { status: 'skipped', detail: 'tasks already there' };
  },
});

// ---------------------------------------------------------------- JavaScript

/** A value a script may be given or hand back, as plain data (dates as text). */
function toPlain(v) {
  if (isDateValue(v)) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toPlain);
  if (isMap(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v === undefined ? null : v;
}

/** The position a script gave (an offset, or { line, column }) as an offset in `text`. */
function toOffset(pos, text, what) {
  if (typeof pos === 'number' && Number.isInteger(pos) && pos >= 0) return Math.min(pos, text.length);
  if (isMap(pos) && Number.isInteger(pos.offset) && pos.offset >= 0) return Math.min(pos.offset, text.length);
  if (isMap(pos) && Number.isInteger(pos.line) && pos.line >= 1) {
    let start = 0;
    for (let n = 1; n < pos.line; n++) {
      const i = text.indexOf('\n', start);
      if (i === -1) return text.length;
      start = i + 1;
    }
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    return Math.min(start + Math.max(0, (Number.isInteger(pos.column) ? pos.column : 1) - 1), end);
  }
  return bad(`the script returned a ${what} that is not a position: use a number (an offset) or { line, column }`);
}

const RULES_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.ya?ml$/;

defAction('install_automations', {
  summary: 'Put a file of automations into the workspace\'s .cave-notes folder, or take it away again (`remove: true`). A rule changing automations is a serious thing: the app shows the person what is about to be written and asks, each time anything would change. Only a file that a rule installed earlier is ever replaced or removed; the person\'s own files are never touched.',
  raw: ['content'],
  normalize(a) {
    if (!isMap(a)) bad('install_automations needs a mapping with a file name and its content (or remove: true)');
    if (typeof a.file !== 'string' || !RULES_FILE.test(a.file)) bad('file must be the name of a YAML file, like chess-game.yaml (letters, digits, . _ -)');
    const remove = a.remove === true;
    if (!remove && (typeof a.content !== 'string' || a.content.trim() === '')) bad('install_automations needs the content of the file (a rules: list), or remove: true');
    if (a.owner !== undefined && (typeof a.owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(a.owner))) bad('owner is a short name (letters, digits, . _ -) shared by the rules that install and remove the same file');
    return { file: a.file, content: remove ? null : a.content, remove, owner: a.owner ?? null };
  },
  async run(ctx, a) {
    const r = await ctx.api.installAutomations({ file: a.file, content: a.content, remove: a.remove, owner: a.owner });
    if (r.dry) return { status: 'done', detail: `would ${a.remove ? 'remove' : 'install'} ${a.file} (dry run)` };
    if (r.denied) return { status: 'failed', detail: `not done: ${r.reason}` };
    if (r.error) return { status: 'failed', detail: r.error };
    if (!r.changed) return { status: 'skipped', detail: r.detail ?? (a.remove ? `${a.file} is not installed` : `${a.file} is already installed`) };
    return a.remove ? `removed ${a.file}` : `${r.created ? 'installed' : 'updated'} ${a.file}`;
  },
});

defAction('run_js', {
  summary: 'Run JavaScript on the page: it reads the text, the cursor and the properties, and returns the changes. Off unless JavaScript is turned on in the app; each new script needs your approval.',
  raw: ['code'],
  normalize(a) {
    const code = typeof a === 'string' ? a : isMap(a) ? a.code : null;
    if (typeof code !== 'string' || code.trim() === '') bad('run_js needs \"code\": the JavaScript to run (a function body: it can use return)');
    try {
      checkJsSyntax(code);
    } catch (e) {
      bad(`the script has a mistake: ${e.message}`);
    }
    let timeout = isMap(a) && a.timeout !== undefined ? a.timeout : SANDBOX_DEFAULTS.timeoutMs;
    if (typeof timeout !== 'number' || !(timeout > 0)) bad('timeout must be a positive number of milliseconds');
    return { code, timeout: Math.min(timeout, SANDBOX_DEFAULTS.maxTimeoutMs) };
  },
  async run(ctx, a) {
    const inPlugin = typeof ctx.text === 'string';
    let text = '';
    let hash;
    if (inPlugin) text = ctx.text;
    else if (ctx.page.path) {
      const cur = await ctx.api.readText(ctx.page.path);
      if (!cur) bad(`the page "${ctx.page.path}" has no file`);
      text = cur.text;
      hash = cur.hash;
    }
    const here = ctx.vars.this ?? {};
    const props = {};
    for (const [k, v] of Object.entries(here)) if (!['title', 'path', 'name', 'folder', 'parent', 'modified'].includes(k)) props[k] = toPlain(v);
    const vars = {};
    for (const k of ['now', 'today', 'this', 'old', 'new', 'trigger', 'device', 'ask', 'let', 'created', 'shell']) if (ctx.vars[k] !== undefined) vars[k] = toPlain(ctx.vars[k]);
    const input = {
      text,
      selection: ctx.selection === true,
      cursor: inPlugin && ctx.cursor ? ctx.cursor : null,
      page: { path: ctx.page.path || '', title: stringify(here.title ?? ''), name: stringify(here.name ?? ''), folder: stringify(here.folder ?? ''), parent: stringify(here.parent ?? '') },
      props,
      ask: toPlain(ctx.vars.ask ?? {}),
      today: toPlain(ctx.vars.today),
      now: toPlain(ctx.vars.now),
      vars,
    };
    const r = await ctx.api.js({ code: a.code, input, timeoutMs: a.timeout });
    if (r.dry) return { status: 'done', detail: 'would run JavaScript (dry run)' };
    if (r.denied) return { status: 'failed', detail: `not run: ${r.reason}` };
    if (!r.ok) return { status: 'failed', detail: r.error };
    const said = (r.logs ?? []).length > 0 ? ` (log: ${r.logs.slice(0, 3).join(' | ')}${r.logs.length > 3 ? ' ...' : ''})` : '';
    let v = r.value;
    if (v === null || v === undefined) return { status: 'skipped', detail: `the script returned nothing${said}` };
    if (typeof v === 'string') v = { text: v };
    if (!isMap(v)) bad('the script must return text, or an object such as { text, props, cursor, select }');
    for (const k of Object.keys(v)) if (!['text', 'props', 'cursor', 'select'].includes(k)) bad(`the script returned "${k}", which is not one of text, props, cursor, select`);
    const changes = [];
    let next = text;
    if (v.text !== undefined) {
      if (typeof v.text !== 'string') bad('"text" must be text');
      next = v.text;
    }
    if (v.props !== undefined) {
      if (!isMap(v.props)) bad('"props" must be an object of property names and values (null removes one)');
      if (inPlugin) bad('a plugin cannot set properties (its page is open in the editor): change the frontmatter in the text instead');
    }
    if (inPlugin) {
      if (next !== text) {
        ctx.text = next;
        changes.push(`changed the ${ctx.selection ? 'selection' : 'page text'}`);
      }
      if (v.cursor !== undefined || v.select !== undefined) {
        const anchor = v.select !== undefined ? toOffset(v.select?.from ?? v.select?.anchor, next, 'select.from') : toOffset(v.cursor, next, 'cursor');
        const head = v.select !== undefined ? toOffset(v.select?.to ?? v.select?.head, next, 'select.to') : anchor;
        ctx.selectionOut = { anchor, head };
        changes.push('moved the cursor');
      }
    } else {
      if (v.cursor !== undefined || v.select !== undefined) changes.push('cursor ignored (the page is not being edited)');
      if (next !== text) {
        if (!ctx.page.path) bad('there is no page to write the text to');
        const w = await ctx.api.writeText(ctx.page.path, next, hash);
        if (!w.ok) bad(`${ctx.page.path} changed while the script ran; nothing was written (it will be tried again on the next change)`);
        changes.push('changed the page text');
      }
      if (v.props !== undefined && Object.keys(v.props).length > 0) {
        if (!ctx.page.path) bad('there is no page to set properties on');
        const stored = Object.fromEntries(Object.entries(v.props).map(([k, x]) => [k, toStored(x)]));
        const r2 = await ctx.api.setProperties(ctx.page.path, stored);
        if (r2.changed) changes.push(`set ${Object.keys(stored).join(', ')}`);
      }
    }
    return changes.length > 0 ? `${changes.join(', ')}${said}` : { status: 'skipped', detail: `nothing changed${said}` };
  },
});

// ---------------------------------------------------------------- the world outside

defAction('notify', {
  summary: 'Show a system notification.',
  normalize(a) {
    if (typeof a === 'string') return { body: a, title: null };
    if (!isMap(a)) bad('notify needs text');
    return { body: str(a.body ?? a.message ?? a.text, 'body'), title: a.title ?? null };
  },
  async run(ctx, a) {
    await ctx.api.notify({ title: a.title === null ? String(ctx.vars.this?.title ?? 'Cave Notes') : String(a.title), body: String(a.body), path: ctx.page.path || null });
    return 'notified';
  },
});

defAction('log', {
  summary: 'Write a line to the automation log (useful with dry runs).',
  normalize(a) {
    return { message: str(typeof a === 'string' ? a : a?.message, 'message') };
  },
  async run(ctx, a) {
    return String(a.message);
  },
});

defAction('stop', {
  summary: 'Stop the rule here: later actions do not run. Handy with `if:`.',
  normalize() {
    return {};
  },
  async run(ctx) {
    ctx.stopped = true;
    return 'stopped';
  },
});

const MAX_TIMEOUT = 600_000;

defAction('run_shell', {
  summary: 'Run a program or shell command on this computer. Off unless shell actions are turned on in the app, and each new command needs your approval.',
  raw: ['command', 'on_success', 'on_failure'],
  normalize(a) {
    if (!isMap(a)) bad('run_shell needs a command');
    const hasCmd = typeof a.command === 'string' && a.command.trim() !== '';
    const hasArgv = Array.isArray(a.argv) && a.argv.length > 0;
    if (hasCmd === hasArgv) bad('run_shell needs exactly one of "command" (a shell command line) or "argv" (a program and its arguments)');
    if (hasArgv && !a.argv.every((x) => typeof x === 'string' || typeof x === 'number')) bad('argv must be a list of text');
    let timeout = a.timeout ?? 30_000;
    if (typeof timeout === 'string') timeout = parseDuration(timeout).n * ({ s: 1000, min: 60_000, h: 3_600_000 }[parseDuration(timeout).unit] ?? bad('timeout: use ms, or s, min, h'));
    if (typeof timeout !== 'number' || !(timeout > 0)) bad('timeout must be a positive number of milliseconds');
    if (a.env !== undefined && !isMap(a.env)) bad('env must be a mapping');
    const out = {
      command: hasCmd ? a.command : null,
      argv: hasArgv ? a.argv.map(String) : null,
      cwd: a.cwd ?? null,
      timeout: Math.min(timeout, MAX_TIMEOUT),
      env: a.env ?? {},
      on_success: a.on_success === undefined ? [] : normalizeActionList(Array.isArray(a.on_success) ? a.on_success : [a.on_success], 'on_success'),
      on_failure: a.on_failure === undefined ? [] : normalizeActionList(Array.isArray(a.on_failure) ? a.on_failure : [a.on_failure], 'on_failure'),
    };
    checkTemplates({ argv: out.argv, cwd: out.cwd, env: out.env });
    return out;
  },
  async run(ctx, a) {
    const raw = ctx.rawArgs ?? a;
    const spec = {
      command: a.command,
      argv: a.argv,
      cwd: a.cwd,
      timeoutMs: a.timeout,
      env: a.env,
      // the command as written in the rules file, before any ${...} is filled in: what a person approves
      template: { command: raw.command ?? null, argv: raw.argv ?? null, cwd: raw.cwd ?? null, env: raw.env ?? {} },
    };
    const r = await ctx.api.shell(spec, ctx);
    ctx.vars.shell = { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ok: r.code === 0 };
    const branch = r.code === 0 ? a.on_success : a.on_failure;
    if (branch.length > 0) {
      const sub = await runActions(branch, ctx);
      ctx.results.push(...sub);
    }
    if (r.code === 0) return { status: 'done', detail: r.dry ? 'would run (dry run)' : 'ran' };
    const why = r.denied ? `not run: ${r.reason}` : r.timedOut ? 'timed out' : `exited with code ${r.code}${r.stderr ? `: ${String(r.stderr).trim().split('\n')[0].slice(0, 200)}` : ''}`;
    // a handled failure (there is an on_failure branch) does not abort the rest of the rule
    return { status: branch.length > 0 ? 'done' : 'failed', detail: why };
  },
});

// ---------------------------------------------------------------- lists of actions

const KEYS_NOT_ACTIONS = new Set(['if', 'name', 'label']);

/** `[{ set_property: {...}, if: "..." }, ...]` -> [{ name, args, if }]. Throws with a readable message. */
export function normalizeActionList(items, where = 'do') {
  if (!Array.isArray(items)) bad(`"${where}" must be a list of actions`);
  return items.map((item, i) => {
    const at = `${where} #${i + 1}`;
    if (typeof item === 'string') {
      if (!ACTIONS[item]) bad(`${at}: unknown action "${item}"`);
      return { name: item, args: tryNormalize(item, true, at), if: null, label: null };
    }
    if (!isMap(item)) bad(`${at}: an action is written as "name: arguments"`);
    const names = Object.keys(item).filter((k) => !KEYS_NOT_ACTIONS.has(k));
    if (names.length !== 1) bad(`${at}: write exactly one action per list item (found ${names.length ? names.join(', ') : 'none'}); put "if:" beside it`);
    const name = names[0];
    if (!ACTIONS[name]) bad(`${at}: unknown action "${name}". Known: ${Object.keys(ACTIONS).join(', ')}`);
    if (item.if !== undefined) checkTemplate(`\${${String(item.if)}}`);
    const args = tryNormalize(name, item[name], at);
    return { name, args, if: item.if === undefined ? null : String(item.if), label: item.name ?? item.label ?? null };
  });
}

function tryNormalize(name, raw, at) {
  const def = ACTIONS[name];
  try {
    const args = def.normalize(raw === true ? undefined : raw);
    checkTemplates(args, def.raw ?? []);
    return args;
  } catch (e) {
    throw new Error(`${at} (${name}): ${e.message}`);
  }
}

/**
 * Run actions in order. `ctx` = { api, page, vars, rule, dry, results, stopped }. A step that fails ends the run
 * (its error is recorded); a step whose `if:` is false is skipped. Returns the list of step results.
 */
export async function runActions(list, ctx) {
  const results = [];
  for (const step of list) {
    if (ctx.stopped) break;
    const entry = { action: step.name, status: 'done', detail: '' };
    try {
      if (step.if !== null && !truthy(evaluate(step.if, ctx.vars))) {
        entry.status = 'skipped';
        entry.detail = 'condition not met';
        results.push(entry);
        continue;
      }
      const def = ACTIONS[step.name];
      const raw = def.raw ?? [];
      const filled = {};
      for (const [k, v] of Object.entries(step.args)) filled[k] = raw.includes(k) ? v : render(v, ctx.vars);
      ctx.results = results;
      ctx.rawArgs = step.args;
      const out = await def.run(ctx, filled);
      if (typeof out === 'string') entry.detail = out;
      else if (out) {
        entry.status = out.status ?? 'done';
        entry.detail = out.detail ?? '';
      }
    } catch (e) {
      entry.status = 'failed';
      entry.detail = e.message;
    }
    results.push(entry);
    if (entry.status === 'failed') break;
  }
  return results;
}

export { DateValue };
export const ACTION_NAMES = () => Object.keys(ACTIONS);
