import YAML from 'yaml';
import { AutomationEngine } from '../src/index.js';

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;

export function splitFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { front: {}, body: text };
  return { front: YAML.parse(m[1]) ?? {}, body: m[2] };
}

export function joinFront(front, body) {
  const keys = Object.keys(front);
  return keys.length === 0 ? body : `---\n${YAML.stringify(front).trimEnd()}\n---\n${body}`;
}

const attrEntries = (v) => {
  const one = (x) => {
    if (x instanceof Date) x = x.toISOString().slice(0, 10);
    if (typeof x === 'string' && DATE.test(x)) return { type: 'date', text: x, num: Date.parse(x.slice(0, 10)) };
    if (typeof x === 'number') return { type: 'number', text: String(x), num: x };
    if (typeof x === 'boolean') return { type: 'bool', text: String(x) };
    return { type: 'text', text: String(x) };
  };
  return (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined).map(one);
};

/** A shared pretend clock, and a shared pretend `.cave-notes/devices` folder. */
export class World {
  constructor(start = new Date(2026, 9, 15, 8, 0, 0)) {
    this.t = start.getTime();
    this.devices = new Map();
  }
  advance(ms) {
    this.t += ms;
  }
  at(y, mo, d, h = 0, mi = 0) {
    this.t = new Date(y, mo - 1, d, h, mi).getTime();
  }
}

export class FakeWorkspace {
  constructor(world, files = {}) {
    this.world = world;
    this.pages = new Map();
    for (const [p, text] of Object.entries(files)) this.pages.set(p, { text, mtimeMs: world.t });
  }
  set(path, text) {
    this.pages.set(path, { text, mtimeMs: this.world.t });
  }
  text(path) {
    return this.pages.get(path)?.text ?? null;
  }
  front(path) {
    return splitFront(this.text(path) ?? '').front;
  }
  has(path) {
    return this.pages.has(path);
  }
  paths() {
    return [...this.pages.keys()].sort();
  }
}

/** Build a host for one pretend computer looking at a FakeWorkspace. */
export function makeHost(ws, { rulesState = {}, shell, notes = [] } = {}) {
  const world = ws.world;
  const host = {
    root: '/vault',
    notifications: notes,
    shells: [],
    logs: [],
    state: rulesState.state ?? null,
    now: () => new Date(world.t),
    absolutePath: (p) => `/vault/${p}`,
    async search(query) {
      const q = query.replace(/[()]/g, ' ').trim();
      const terms = q === '' ? [] : q.match(/(?:[^\s"]+|"[^"]*")+/g);
      const paths = [];
      for (const [p, page] of ws.pages) {
        const { front } = splitFront(page.text);
        const lower = Object.fromEntries(Object.entries(front).map(([k, v]) => [k.toLowerCase(), v]));
        let ok = true;
        for (const term of terms) {
          const m = /^(-?)([a-z_]+):(.*)$/i.exec(term);
          if (!m) continue;
          const [, neg, key, rawVal] = m;
          const val = rawVal.replace(/^"|"$/g, '');
          let hit;
          if (key === 'has') hit = lower[val.toLowerCase()] !== undefined;
          else if (key === 'under') {
            const dir = val.replace(/\.md$/, '');
            hit = p.startsWith(`${dir}/`);
          } else if (key === 'path') hit = p === val;
          else if (key === 'modified') hit = page.mtimeMs < world.t - Number(val.replace(/[^0-9]/g, '')) * 86_400_000;
          else {
            const have = lower[key.toLowerCase()];
            const list = Array.isArray(have) ? have : have === undefined ? [] : [have];
            const wants = val.split(',').map((x) => x.toLowerCase());
            hit = list.some((x) => wants.includes(String(x).toLowerCase())); // a comma means "any of", as in the real language
          }
          if (neg ? hit : !hit) ok = false;
        }
        if (ok) paths.push(p);
      }
      return { paths, errors: [] };
    },
    async pageInfo(path) {
      const page = ws.pages.get(path);
      if (!page) return null;
      const { front, body } = splitFront(page.text);
      const attrs = {};
      for (const [k, v] of Object.entries(front)) attrs[k.toLowerCase()] = attrEntries(v);
      const h1 = /^#\s+(.+)$/m.exec(body);
      return { path, title: h1 ? h1[1] : path.split('/').pop().replace(/\.md$/, ''), mtimeMs: page.mtimeMs, attrs };
    },
    async resolvePage(ref) {
      const want = ref.replace(/\.md$/, '').toLowerCase();
      for (const p of ws.pages.keys()) if (p.replace(/\.md$/, '').toLowerCase() === want) return p;
      return null;
    },
    async readText(path) {
      const page = ws.pages.get(path);
      return page ? { text: page.text, hash: String(page.mtimeMs) + page.text.length } : null;
    },
    async writeText(path, text, base) {
      const page = ws.pages.get(path);
      if (!page) return { ok: false };
      if (base !== undefined && base !== String(page.mtimeMs) + page.text.length) return { ok: false };
      ws.pages.set(path, { text, mtimeMs: world.t });
      return { ok: true };
    },
    async setProperties(path, changes) {
      const page = ws.pages.get(path);
      if (!page) throw new Error(`no page ${path}`);
      const { front, body } = splitFront(page.text);
      const before = JSON.stringify(front);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) delete front[k];
        else front[k] = v;
      }
      if (JSON.stringify(front) === before) return { changed: false };
      ws.pages.set(path, { text: joinFront(front, body), mtimeMs: world.t });
      return { changed: true };
    },
    async createPage({ parent, name, content, path }) {
      let full;
      if (path) full = `${path.replace(/\.md$/, '')}.md`;
      else full = `${parent ? `${parent.replace(/\.md$/, '')}/` : ''}${name}.md`;
      if (ws.pages.has(full)) return { path: full, created: false };
      ws.pages.set(full, { text: content ?? `# ${name}\n`, mtimeMs: world.t });
      return { path: full, created: true };
    },
    async movePage(path, dest) {
      const dir = dest.replace(/\/+$/, '').replace(/\.md$/, '');
      const to = `${dir}/${path.split('/').pop()}`;
      if (path === to || path.startsWith(`${dir}/`)) return { moved: false, reason: 'already there' };
      if (!ws.pages.has(path)) return { moved: false, reason: 'the page is gone' };
      if (ws.pages.has(to)) return { moved: false, reason: `${to} already exists` };
      ws.pages.set(to, ws.pages.get(path));
      ws.pages.delete(path);
      return { moved: true, to };
    },
    async notify(n) {
      notes.push(n);
    },
    async shell(spec) {
      host.shells.push(spec);
      return shell ? shell(spec) : { code: 0, stdout: '', stderr: '' };
    },
    async loadState() {
      return host.state;
    },
    async saveState(s) {
      host.state = JSON.parse(JSON.stringify(s));
    },
    async readDevices() {
      return [...world.devices.values()].map((d) => JSON.parse(JSON.stringify(d)));
    },
    async writeDevice(d) {
      world.devices.set(d.id, JSON.parse(JSON.stringify(d)));
    },
    appendLog(entry) {
      host.logs.push(entry);
    },
  };
  return host;
}

export async function makeEngine(world, ws, rules, { id = 'laptop', name = id, host: hostOpts, start = true, wake = false } = {}) {
  const host = makeHost(ws, hostOpts);
  const engine = new AutomationEngine({ host, deviceId: id, deviceName: name });
  await engine.load(rules);
  if (start) await engine.start();
  // most tests are about something else than the wait for sync after starting (wake-delay.test.js is about that one)
  if (!wake) engine.holdUntil = 0;
  return { engine, host };
}

/** Pretend the watcher saw these pages change. */
export const changed = (engine, ...items) => engine.onChanges(items.map((i) => (typeof i === 'string' ? { path: i, kind: 'modified' } : i)));

/** Pretend the watcher saw these pages change, and says whether this computer's own app wrote them ('local') or something else did ('external'). */
export const changedAs = (engine, origin, ...items) => engine.onChanges(items.map((i) => ({ ...(typeof i === 'string' ? { path: i, kind: 'modified' } : i), origin })));
