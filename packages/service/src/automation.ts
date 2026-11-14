/**
 * Runs the automation engine for one open workspace. The engine (packages/core-automation) knows nothing about files or
 * windows; this adapter gives it the workspace (through the same service the app itself uses, so links are kept up to
 * date, saves are checked against the disk and the history sees every change), a place for this computer's bookkeeping,
 * and the two things only the main process may do: show notifications and run shell commands.
 *
 * Where things live:
 *  - the rules:                `rules:` (and `settings:`) in any settings file of <workspace>/.cave-notes (synced with the workspace)
 *  - what each computer did:   <workspace>/.cave-notes/devices/<id>.yaml       (one file per computer, synced)
 *  - this computer's state and log: <app data>/workspaces/<id>/automation-*    (never synced)
 */
import { fs, host, path, randomHex } from '@cave-notes/platform';
import { AutomationEngine, parseAutomations, runSandbox, type AutomationHost, type AutomationPageInfo, type DeviceFile, type JsResult, type JsSpec, type LogEntry, type ShellResult, type ShellSpec } from '@cave-notes/core-automation';
import { defaultNoteExt, isNoteFile, normalizeName, normalizePagePath, pageFolder, pageName, parentPage } from '@cave-notes/core-tree';
import YAML from 'yaml';
import { log } from './log';
import { rulesText } from './workspace-file';
import type { ApplyResult, AttrValue, LinkPlan, PageData, PageInfo, ResolvedLink, SearchResponse, WorkerEvents, WriteResult } from './api';

const DEVICES_DIR = '.cave-notes/devices';
const TICK_MS = 30_000;
const SHELL_WAIT_MS = 10 * 60_000; // a person may take a while to answer the approval question

/** What the adapter needs from the workspace service. */
export interface AutomationDeps {
  search(query: string, opts?: { limit?: number }): Promise<SearchResponse>;
  pageInfo(p: string): Promise<PageInfo | null>;
  readPage(p: string): Promise<PageData>;
  writePage(p: string, text: string, baseHash: string | null): Promise<WriteResult>;
  createPage(parent: string | null, name: string, content?: string): Promise<string>;
  planMove(from: string, newParent: string | null, newName?: string): Promise<LinkPlan>;
  applyPlan(plan: LinkPlan): Promise<ApplyResult>;
  resolveLink(link: { syntax: 'md' | 'wiki'; target: string }, fromPath: string): Promise<ResolvedLink>;
  setFrontmatterValue(text: string, key: string, value: AttrValue | null): string;
}

export interface AutomationOptions {
  root: string;
  dataDir: string;
  deviceName: string;
  /** the rules other workspaces share with this one (`rules: !global`) and the person approved */
  inheritedRules?: () => unknown[] | undefined;
  /** the plugins that come with the app (see app-config.ts); a workspace's own rules with the same id win */
  defaultRules?: () => unknown[] | undefined;
  emit: <K extends keyof WorkerEvents>(event: K, payload: WorkerEvents[K]) => void;
}

/** What a file of rules would be able to do, in a few words, for the question shown to the person. */
function summarize(rules: Array<Record<string, unknown>>): { rules: Array<{ id: string; name: string }>; js: boolean; shell: boolean; installs: boolean } {
  const acts = (r: Record<string, unknown>): string[] => ((r.actions as Array<{ name: string }> | undefined) ?? []).map((a) => a.name);
  return {
    rules: rules.map((r) => ({ id: String(r.id), name: String(r.name ?? r.id) })),
    js: rules.some((r) => acts(r).includes('run_js')),
    shell: rules.some((r) => acts(r).includes('run_shell')),
    installs: rules.some((r) => acts(r).includes('install_automations')),
  };
}

const readText = (file: string): Promise<string | null> => fs.readFile(file, 'utf8').then((t) => t, () => null);

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.cave-tmp-${host.pid()}`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

/** A reference written in a rule ("Journal/2026-10-16", "Tasks.md") as a page path. */
export function refToPath(ref: string): string {
  const clean = ref.trim().replace(/^\/+|\/+$/g, '');
  return isNoteFile(clean) ? clean : `${clean}${defaultNoteExt()}`;
}

export class AutomationRunner {
  private engine: AutomationEngine;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private shellWaiting = new Map<string, (r: ShellResult) => void>();
  private jsWaiting = new Map<string, (r: { allowed: boolean; reason?: string }) => void>();
  private rulesWaiting = new Map<string, (r: { allowed: boolean; reason?: string }) => void>();
  private nextShell = 1;
  private closed = false;
  readonly deviceId: string;
  deviceName: string;

  private constructor(private readonly deps: AutomationDeps, private readonly o: AutomationOptions, deviceId: string) {
    this.deviceId = deviceId;
    this.deviceName = o.deviceName;
    this.engine = new AutomationEngine({
      host: this.makeHost(),
      deviceId,
      deviceName: o.deviceName,
      log: (level, msg) => (level === 'error' ? log.error(msg) : level === 'warn' ? log.warn(msg) : log.info(msg)),
    });
  }

  /** The id of this computer for this workspace: made once, then kept in the app's data folder. */
  static async create(deps: AutomationDeps, o: AutomationOptions): Promise<AutomationRunner> {
    const file = path.join(o.dataDir, 'automation-device-id');
    let id = ((await readText(file)) ?? '').trim();
    if (!/^[a-f0-9]{8,32}$/.test(id)) {
      id = randomHex(5);
      await writeAtomic(file, `${id}\n`).catch(() => undefined);
    }
    return new AutomationRunner(deps, o, id);
  }

  // ---------------------------------------------------------------- running

  /** Serialize everything that touches the engine: file changes, the timer and requests never overlap. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Read the rules and begin. Call once the index is ready. */
  async start(): Promise<void> {
    const text = await rulesText(path.join(this.o.root, '.cave-notes'), this.o.inheritedRules?.(), this.o.defaultRules?.());
    await this.run(async () => {
      await this.engine.load(text);
      this.announce();
      if (this.closed) return;
      await this.engine.start();
    });
    if (this.closed) return;
    this.timer = setInterval(() => void this.run(() => this.engine.tick()).catch((e) => log.warn(`automation tick failed: ${(e as Error).message}`)), TICK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue.catch(() => undefined);
    await this.engine.flush().catch(() => undefined);
    for (const [, done] of this.shellWaiting) done({ code: -1, denied: true, reason: 'the workspace was closed' });
    this.shellWaiting.clear();
    for (const [, done] of this.jsWaiting) done({ allowed: false, reason: 'the workspace was closed' });
    this.jsWaiting.clear();
    for (const [, done] of this.rulesWaiting) done({ allowed: false, reason: 'the workspace was closed' });
    this.rulesWaiting.clear();
  }

  /** The settings files of `.cave-notes` changed. */
  async reload(): Promise<void> {
    const text = await rulesText(path.join(this.o.root, '.cave-notes'), this.o.inheritedRules?.(), this.o.defaultRules?.());
    await this.run(async () => {
      await this.engine.reload(text);
      this.announce();
    });
  }

  /** The files named here were added, changed or removed (after the index looked at them). */
  changes(list: Array<{ path: string; kind: 'created' | 'modified' | 'deleted'; origin?: 'local' | 'external' }>, moves: Array<{ from: string; to: string }> = []): void {
    if (this.closed || list.length === 0) return;
    void this.run(() => this.engine.onChanges(list, moves)).catch((e) => log.warn(`automation change handling failed: ${(e as Error).message}`));
  }

  /** Tell the main process whether anything here needs the app to keep running in the background. */
  private announce(): void {
    const rules = this.engine.status().rules.filter((r) => r.enabled);
    const timed = rules.some((r) => r.triggers.some((t) => t === 'schedule' || t === 'at'));
    this.o.emit('automation:active', { active: rules.length > 0, timed });
  }

  /** The person is about to delete these pages in the app: remember the ids that get a tombstone (see the tombstones setting). */
  beforeDelete(pages: string[]): Promise<number> {
    if (this.closed) return Promise.resolve(0);
    return this.run(() => this.engine.beforeDelete(pages));
  }

  /** The person deleted these pages in the app: those really gone get their tombstone. */
  afterDelete(pages: string[]): Promise<number> {
    if (this.closed) return Promise.resolve(0);
    return this.run(() => this.engine.afterDelete(pages));
  }

  /** The rules whose criteria the page meets (for the indicator on an open page). */
  rulesFor(p: string): Promise<Array<{ id: string; name: string; triggers: string[]; definition: string }>> {
    return this.run(() => this.engine.rulesFor(p));
  }

  status(): ReturnType<AutomationEngine['status']> {
    return this.engine.status();
  }

  recent(limit = 100): LogEntry[] {
    return this.engine.log(limit);
  }

  runRule(ruleId: string, opts: { dry?: boolean; path?: string | null; limit?: number } = {}): Promise<Array<{ path: string | null; status: string; detail: string; steps?: unknown[] }>> {
    return this.run(() => this.engine.runNow(ruleId, opts));
  }

  /** A button in a page was clicked: run the rule named by its `automation:` link for that page (see the engine's runButton). */
  runButton(ruleId: string, page: string, answers: Record<string, unknown> = {}): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; steps: Array<{ action: string; status: string; detail: string }> }> {
    return this.run(() => this.engine.runButton(ruleId, page, answers));
  }

  /** The questions a button's rule asks before it runs (none: it runs at once), with labels worked out for the page. */
  buttonQuestions(ruleId: string, page: string): Promise<{ title: string; ask: unknown[] }> {
    return this.engine.buttonQuestions(ruleId, { path: page });
  }

  /** The rules of the Plugins menu. */
  plugins(): Array<{ id: string; label: string; ask: unknown[] }> {
    return this.engine.plugins();
  }

  /** The questions of a plugin, filled in for the text it is about to work on. */
  pluginQuestions(ruleId: string, opts: { path: string | null; text: string; selection: boolean }): Promise<unknown[]> {
    return this.engine.pluginQuestions(ruleId, opts);
  }

  /** Run a plugin on text from the window (see the engine's runPlugin). */
  runPlugin(ruleId: string, opts: { path: string | null; text: string; selection: boolean; answers: Record<string, unknown>; cursor?: number | null }): Promise<{ status: 'done' | 'failed' | 'skipped' | 'refused'; detail: string; text: string; changed: boolean; selection?: { anchor: number; head: number } | null }> {
    return this.run(() => this.engine.runPlugin(ruleId, opts));
  }

  /** The main process answers "may this rule's script run?". */
  jsResult(id: string, answer: { allowed: boolean; reason?: string }): void {
    const done = this.jsWaiting.get(id);
    this.jsWaiting.delete(id);
    done?.(answer);
  }

  /** The main process answers "may this rule change the automations?". */
  rulesResult(id: string, answer: { allowed: boolean; reason?: string }): void {
    const done = this.rulesWaiting.get(id);
    this.rulesWaiting.delete(id);
    done?.(answer);
  }

  /** The main process answers a shell request. */
  shellResult(id: string, result: ShellResult): void {
    const done = this.shellWaiting.get(id);
    this.shellWaiting.delete(id);
    done?.(result);
  }

  setDeviceName(name: string): void {
    this.deviceName = name;
    this.engine.deviceName = name;
  }

  // ---------------------------------------------------------------- the engine's view of the workspace

  private abs(rel: string): string {
    return path.join(this.o.root, ...rel.split('/'));
  }

  private makeHost(): AutomationHost {
    const d = this.deps;
    const o = this.o;
    const self = this;
    /** A page (or the folder of one) that rules move things into is made when it is not there yet, with the pages above it. */
    const ensurePage = async (p: string): Promise<void> => {
      const info = await d.pageInfo(p).catch(() => null);
      if (info) return;
      if (await fs.stat(self.abs(pageFolder(p))).then((st) => st.isDirectory(), () => false)) return;
      const parent = parentPage(p);
      if (parent !== null) await ensurePage(parent);
      await d.createPage(parent, pageName(p));
    };
    return {
      root: o.root,
      now: () => new Date(),
      absolutePath: (p: string) => (p === '' ? o.root : this.abs(p)),

      async search(query: string) {
        const r = await d.search(query, { limit: 100_000 });
        return { paths: r.results.filter((x) => !x.isVirtual).map((x) => x.path), errors: r.errors };
      },

      async pageInfo(p: string): Promise<AutomationPageInfo | null> {
        const info = await d.pageInfo(p).catch(() => null);
        if (!info || info.isVirtual) return null;
        const st = await fs.stat(self.abs(info.path)).catch(() => null);
        if (!st) return null;
        const attrs: AutomationPageInfo['attrs'] = {};
        for (const [k, v] of Object.entries(info.attributes)) attrs[k.toLowerCase()] = v;
        return { path: info.path, title: info.title, mtimeMs: st.mtimeMs, attrs };
      },

      async resolvePage(ref: string, from: string) {
        const clean = ref.trim();
        if (clean === '') return null;
        try {
          const p = refToPath(clean);
          const info = await d.pageInfo(normalizePagePath(p));
          if (info && !info.isVirtual) return info.path;
        } catch {
          /* not a path: try it as a name */
        }
        const r = await d.resolveLink({ syntax: 'wiki', target: clean }, from || '').catch(() => null);
        return r && r.kind === 'page' && r.status === 'ok' ? r.path : null;
      },

      async readText(p: string) {
        if (!p) return null;
        const r = await d.readPage(p);
        return r.exists && r.hash ? { text: r.text, hash: r.hash } : null;
      },

      async writeText(p: string, text: string, base?: string) {
        const r = await d.writePage(p, text, base ?? null);
        return { ok: r.ok };
      },

      async setProperties(p: string, changes: Record<string, unknown>) {
        const page = await d.readPage(p);
        if (!page.exists) throw new Error(`${p} has no file`);
        let text = page.text;
        for (const [k, v] of Object.entries(changes)) {
          const value = v === null || v === undefined ? null : Array.isArray(v) ? v.map(String) : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
          text = d.setFrontmatterValue(text, k, value as AttrValue | null);
        }
        if (text === page.text) return { changed: false };
        const w = await d.writePage(page.path, text, page.hash);
        if (!w.ok) throw new Error(`${p} changed while the rule ran, so nothing was written`);
        return { changed: true };
      },

      async createPage(spec: { parent: string | null; name: string; content: string | null; path?: string }) {
        let parent: string | null;
        let stem: string;
        if (spec.path) {
          const full = normalizePagePath(refToPath(spec.path));
          parent = parentPage(full);
          stem = pageName(full);
        } else {
          parent = spec.parent === null || spec.parent === '' ? null : normalizePagePath(refToPath(spec.parent));
          stem = normalizeName(spec.name);
        }
        const target = `${parent === null ? '' : `${pageFolder(parent)}/`}${stem}${defaultNoteExt()}`;
        const exists = (await d.pageInfo(target).catch(() => null)) ?? null;
        const onDisk = await fs.stat(self.abs(target)).then(() => true, () => false);
        if (onDisk || (exists && !exists.isVirtual)) return { path: exists?.path ?? target, created: false };
        const made = await d.createPage(parent, stem, spec.content ?? undefined);
        return { path: made, created: true };
      },

      async movePage(p: string, destination: string) {
        const dest = destination.trim().replace(/^\/+|\/+$/g, '');
        const newParent = dest === '' ? null : normalizePagePath(refToPath(dest));
        if (parentPage(p) === newParent || (newParent !== null && p.startsWith(`${pageFolder(newParent)}/`))) return { moved: false, reason: 'already there' };
        if (!(await fs.stat(self.abs(p)).then(() => true, () => false))) return { moved: false, reason: 'the page is gone' };
        if (newParent !== null) await ensurePage(newParent);
        const plan = await d.planMove(p, newParent);
        if (plan.noop) return { moved: false, reason: 'already there' };
        const res = await d.applyPlan(plan);
        return { moved: true, to: res.to };
      },

      notify(n) {
        o.emit('automation:notify', n);
      },

      onRun(entry: LogEntry) {
        o.emit('automation:ran', { rule: entry.rule, path: entry.path, status: entry.status === 'failed' ? 'failed' : 'done', detail: entry.detail, steps: entry.steps.map((s) => ({ action: s.action, status: s.status, detail: s.detail })) });
      },

      shell(spec: ShellSpec): Promise<ShellResult> {
        const id = `s${self.nextShell++}`;
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            self.shellWaiting.delete(id);
            resolve({ code: -1, denied: true, reason: 'the main process did not answer' });
          }, SHELL_WAIT_MS + spec.timeoutMs);
          timer.unref?.();
          self.shellWaiting.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          o.emit('automation:shell', { id, root: o.root, spec });
        });
      },

      /** A rule's JavaScript: the main process decides whether it may run (the switch and the person's approval); it then runs here, in the sandbox. */
      async js(spec: JsSpec): Promise<JsResult> {
        const id = `j${self.nextShell++}`;
        const answer = await new Promise<{ allowed: boolean; reason?: string }>((resolve) => {
          const timer = setTimeout(() => {
            self.jsWaiting.delete(id);
            resolve({ allowed: false, reason: 'the main process did not answer' });
          }, SHELL_WAIT_MS);
          timer.unref?.();
          self.jsWaiting.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          o.emit('automation:js', { id, root: o.root, ruleId: spec.ruleId, code: spec.code, page: spec.page });
        });
        if (!answer.allowed) return { denied: true, reason: answer.reason ?? 'not allowed' };
        return runSandbox(spec.code, spec.input, { timeoutMs: spec.timeoutMs });
      },

      /**
       * A rule puts a file of rules into .cave-notes, or takes it away. The first line says which rule installed it; only
       * such a file, from the same rule, is ever replaced or removed. The person is asked each time anything would change.
       */
      async installAutomations(spec: { ruleId: string; owner: string; file: string; content: string | null; remove: boolean; page: string }) {
        // installed automations always go into plugins/ (an earlier version put them beside the settings files: such a file of
        // ours is found there and moved when it is next installed or removed)
        const legacy = path.join(o.root, '.cave-notes', spec.file);
        const mark = `# installed by "${spec.owner}"`;
        const target = path.join(o.root, '.cave-notes', 'plugins', spec.file);
        let existing = await readText(target);
        if (existing === null) {
          const old = await readText(legacy);
          if (old !== null && old.startsWith(`${mark}\n`)) existing = old;
        }
        const wasLegacy = existing !== null && (await readText(target)) === null;
        if (existing !== null && !existing.startsWith('# installed by "')) return { error: `.cave-notes/plugins/${spec.file} is a file of yours (it was not installed by a rule), so it is left alone` };
        if (existing !== null && !existing.startsWith(`${mark}\n`)) return { error: `.cave-notes/plugins/${spec.file} was installed by something else (not "${spec.owner}"), so it is left alone` };
        let text: string | null = null;
        let summary = { rules: [] as Array<{ id: string; name: string }>, js: false, shell: false, installs: false };
        if (spec.remove) {
          if (existing === null) return { changed: false, detail: `${spec.file} is not installed` };
          const old = parseAutomations(existing);
          summary = summarize(old.rules);
        } else {
          const body = String(spec.content).replace(/\s+$/, '');
          text = `${mark}\n# Delete this file to take these automations away.\n${body}\n`;
          if (existing === text) return { changed: false, detail: `${spec.file} is already installed` };
          const parsed = parseAutomations(text);
          if (parsed.errors.length > 0) return { error: `the rules to install have a mistake: ${parsed.errors[0]}` };
          summary = summarize(parsed.rules);
        }
        const id = `r${self.nextShell++}`;
        const answer = await new Promise<{ allowed: boolean; reason?: string }>((resolve) => {
          const timer = setTimeout(() => {
            self.rulesWaiting.delete(id);
            resolve({ allowed: false, reason: 'the main process did not answer' });
          }, SHELL_WAIT_MS);
          timer.unref?.();
          self.rulesWaiting.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          o.emit('automation:rules', { id, root: o.root, ruleId: spec.ruleId, file: spec.file, remove: spec.remove, created: existing === null, summary, content: text ?? existing ?? '' });
        });
        if (!answer.allowed) return { denied: true, reason: answer.reason ?? 'you did not allow it' };
        if (wasLegacy) await fs.rm(legacy, { force: true });
        if (spec.remove) await fs.rm(target, { force: true });
        else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await writeAtomic(target, text as string);
        }
        // the new rules are picked up when the file watcher sees the file
        return { changed: true, created: existing === null };
      },

      // ---- this computer's own bookkeeping
      async loadState() {
        const t = await readText(path.join(o.dataDir, 'automation-state.json'));
        try {
          return t ? JSON.parse(t) : null;
        } catch {
          return null;
        }
      },
      async saveState(state: unknown) {
        await writeAtomic(path.join(o.dataDir, 'automation-state.json'), JSON.stringify(state));
      },

      // ---- the other computers' files
      async readDevices(): Promise<DeviceFile[]> {
        const dir = self.abs(DEVICES_DIR);
        const names = await fs.readdir(dir).catch(() => [] as string[]);
        const out: DeviceFile[] = [];
        for (const n of names) {
          if (!n.endsWith('.yaml')) continue;
          try {
            const doc = YAML.parse((await fs.readFile(path.join(dir, n), 'utf8')) as string) as Partial<DeviceFile> | null;
            if (doc && typeof doc.id === 'string' && typeof doc.seen === 'number') {
              out.push({
                id: doc.id,
                name: typeof doc.name === 'string' ? doc.name : doc.id,
                seen: doc.seen,
                fired: doc.fired && typeof doc.fired === 'object' ? doc.fired : {},
                ...(doc.buried && typeof doc.buried === 'object' ? { buried: doc.buried } : {}),
              });
            }
          } catch {
            /* a half-synced file: the next read will do */
          }
        }
        return out;
      },
      async writeDevice(device: DeviceFile) {
        if (!/^[a-f0-9]{8,32}$/.test(device.id)) return;
        await writeAtomic(path.join(self.abs(DEVICES_DIR), `${device.id}.yaml`), `# One file per computer that runs this workspace's automations. Safe to delete; it is made again.\n${YAML.stringify(device)}`);
      },

      appendLog(entry: unknown) {
        const file = path.join(o.dataDir, 'automation.log');
        void (async () => {
          try {
            const st = await fs.stat(file).catch(() => null);
            if (st && st.size > 2_000_000) await fs.rename(file, `${file}.1`);
            await fs.appendFile(file, `${JSON.stringify(entry)}\n`);
          } catch {
            /* the log is a courtesy */
          }
        })();
      },
    };
  }
}

export const defaultDeviceName = (): string => host.hostname().split('.')[0]!.toLowerCase() || 'this-computer';
