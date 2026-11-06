import { fs, path, sha1, utf8Length } from '@cave-notes/platform';

/**
 * A little version history for the pages being worked on, kept outside the workspace (so a sync tool never
 * sees it). Texts are stored once by hash; each page keeps its last `maxPerFile` versions, and only the
 * `maxFiles` most recently touched pages are kept.
 *
 * entry: { id, t, source, size }   source: 'saved' | 'disk' | 'merged' | 'conflict-copy' | 'discarded' | 'before-restore'
 */
export class HistoryStore {
  constructor(dir, { maxPerFile = 30, maxFiles = 120 } = {}) {
    this.dir = dir;
    this.maxPerFile = maxPerFile;
    this.maxFiles = maxFiles;
    this.chain = Promise.resolve();
  }

  #run(fn) {
    const r = this.chain.then(fn);
    this.chain = r.catch(() => {});
    return r;
  }

  #recordFile(rel) {
    return path.join(this.dir, 'pages', `${sha1(rel)}.json`);
  }
  #blob(id) {
    return path.join(this.dir, 'blobs', id);
  }

  async #load(rel) {
    try {
      return JSON.parse(await fs.readFile(this.#recordFile(rel), 'utf8'));
    } catch {
      return { path: rel, entries: [] };
    }
  }

  async #save(rec) {
    const file = this.#recordFile(rec.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rec));
    await fs.rename(tmp, file);
  }

  /** Remember a version of a page. A text identical to the newest one is not added again. */
  add(rel, text, source, t = Date.now()) {
    return this.#run(async () => {
      const rec = await this.#load(rel);
      const id = sha1(text);
      if (rec.entries[0]?.id === id) return null;
      await fs.mkdir(path.dirname(this.#blob(id)), { recursive: true });
      await fs.writeFile(this.#blob(id), text);
      const entry = { id, t, source, size: utf8Length(text) };
      rec.entries = [entry, ...rec.entries.filter((e) => e.id !== id)].slice(0, this.maxPerFile);
      await this.#save(rec);
      await this.#prune();
      return entry;
    });
  }

  /** Versions of a page, newest first. */
  list(rel) {
    return this.#run(async () => (await this.#load(rel)).entries);
  }

  async read(rel, id) {
    return this.#run(async () => {
      const rec = await this.#load(rel);
      if (!rec.entries.some((e) => e.id === id)) return null;
      try {
        return await fs.readFile(this.#blob(id), 'utf8');
      } catch {
        return null;
      }
    });
  }

  /** The texts of a page's versions, newest first (candidates for a common ancestor). */
  async texts(rel, limit = 12) {
    const entries = (await this.list(rel)).slice(0, limit);
    const out = [];
    for (const e of entries) {
      const t = await this.read(rel, e.id);
      if (t !== null) out.push(t);
    }
    return out;
  }

  /** A page moved: its history goes with it. */
  rename(from, to) {
    return this.#run(async () => {
      const rec = await this.#load(from);
      if (rec.entries.length === 0) return;
      const target = await this.#load(to);
      const seen = new Set();
      const merged = [...rec.entries, ...target.entries].filter((e) => !seen.has(e.id) && seen.add(e.id));
      merged.sort((x, y) => y.t - x.t);
      await this.#save({ path: to, entries: merged.slice(0, this.maxPerFile) });
      await fs.rm(this.#recordFile(from), { force: true });
    });
  }

  async #prune() {
    let names;
    try {
      names = await fs.readdir(path.join(this.dir, 'pages'));
    } catch {
      return;
    }
    if (names.length <= this.maxFiles) return;
    const recs = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(await fs.readFile(path.join(this.dir, 'pages', n), 'utf8'));
        recs.push({ n, t: rec.entries[0]?.t ?? 0, ids: rec.entries.map((e) => e.id) });
      } catch {
        /* skip */
      }
    }
    recs.sort((x, y) => y.t - x.t);
    const keep = new Set();
    for (const r of recs.slice(0, this.maxFiles)) for (const id of r.ids) keep.add(id);
    for (const r of recs.slice(this.maxFiles)) await fs.rm(path.join(this.dir, 'pages', r.n), { force: true });
    try {
      for (const b of await fs.readdir(path.join(this.dir, 'blobs'))) if (!keep.has(b)) await fs.rm(this.#blob(b), { force: true });
    } catch {
      /* none */
    }
  }
}
