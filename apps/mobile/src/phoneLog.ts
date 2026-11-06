// The log of the Android app. The desktop app writes a log file the user can paste; the phone had only the console, which is
// gone when the app is. This keeps lines in a file in the app's folder and a copy in Download, with what is needed to find out
// why the app froze: how long the page was blocked and what it was doing then, how long each file operation and each call to
// the service took (and how many waited), memory, and whether the last run ended cleanly. Note text is never logged: only
// paths, counts, sizes and durations.
//
//   2026-11-03T18:54:28.152Z WARN  [main      ] blocked 1840 ms (event loop). doing: openWorkspace Theology (4.1 s so far) | fs queue 38, 3 running
//
// The worker of each workspace sends its own log lines here (`[ws:Theology]`), so one file tells the whole story.
import type { createPluginFs } from './pluginFs';

type Fs = ReturnType<typeof createPluginFs>;
type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_BYTES = 1_500_000;
/** The page did not get its turn for this long: a freeze that matters (Android's own limit is 5 s of not answering a touch). */
const BLOCKED_MS = 400;
const SLOW_FS_MS = 300;
const BIG_RESULT = 512 * 1024;
const SLOW_CALL_MS = 400;

interface Doing {
  what: string;
  since: number;
}

export class PhoneLog {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly doing = new Map<number, Doing>();
  private nextDoing = 1;
  private fsStats = { ops: 0, ms: 0, byOp: new Map<string, number>(), maxQueue: 0, maxWait: 0, bytes: 0, since: Date.now(), timer: null as ReturnType<typeof setTimeout> | null };
  private fsState = { running: 0, queued: 0 };
  private lastTick = Date.now();
  private foreground = true;

  constructor(
    private readonly fs: Fs,
    private readonly dir: string,
    private readonly copyTo: string,
  ) {}

  get file(): string {
    return `${this.dir}/cave-notes.log`;
  }

  /** Open the log: rotate it, say how the last run ended, and start watching. */
  async start(info: { version?: string } = {}): Promise<void> {
    try {
      await this.fs.mkdir(this.dir, { recursive: true });
      const st = await this.fs.stat(this.file).catch(() => null);
      if (st && st.size > MAX_BYTES) {
        await this.fs.rm(`${this.file}.1`, { force: true }).catch(() => undefined);
        await this.fs.rename(this.file, `${this.file}.1`).catch(() => undefined);
      }
    } catch {
      /* a log must never stop the app */
    }
    const marker = `${this.dir}/state`;
    const before = await this.fs.readFile(marker, 'utf8').then((t) => String(t).trim(), () => '');
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    this.line('INFO', 'main', `==== start ${info.version ?? ''} ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '')} cpus=${navigator.hardwareConcurrency} memory=${mem ?? '?'} GB`);
    if (before === 'running') this.line('WARN', 'main', 'the last run did not end cleanly while the app was in front (a crash, or Android stopped it because it did not answer)');
    else if (before === 'background') this.line('INFO', 'main', 'the last run was stopped while in the background (Android takes the memory back from apps that are not shown)');
    else if (before === '') this.line('INFO', 'main', 'first run (no earlier state)');
    this.setState('running');
    this.hook();
  }

  private setState(s: 'running' | 'background'): void {
    void this.fs.writeFile(`${this.dir}/state`, s).catch(() => undefined);
  }

  // ---------------------------------------------------------------- writing

  line(level: Level, who: string, text: string): void {
    this.buffer.push(`${new Date().toISOString()} ${level.padEnd(5)} [${who.padEnd(10)}] ${text}\n`);
    if (level === 'ERROR' || this.buffer.length > 80) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1500);
  }

  /** A line the worker's logger made (it has its own time and name already). */
  raw(line: string): void {
    this.buffer.push(line.endsWith('\n') ? line : `${line}\n`);
    if (this.buffer.length > 80) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1500);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = this.buffer.join('');
    this.buffer = [];
    if (!text) return this.writing;
    this.writing = this.writing.then(async () => {
      try {
        await this.fs.appendFile(this.file, text);
      } catch {
        /* a log must never stop the app */
      }
    });
    return this.writing;
  }

  /** Keep a copy where it can be fetched with a file manager (or sent from it): the end of the log, in Download. */
  async publish(): Promise<void> {
    await this.flush();
    try {
      const old = await this.fs.readFile(`${this.file}.1`, 'utf8').then(String, () => '');
      const now = await this.fs.readFile(this.file, 'utf8').then(String, () => '');
      const all = old + now;
      await this.fs.mkdir(this.copyTo.replace(/\/[^/]*$/, ''), { recursive: true });
      await this.fs.writeFile(this.copyTo, all.length > KEEP_BYTES ? all.slice(all.length - KEEP_BYTES) : all);
    } catch {
      /* no Download folder, or no permission: the log in the app's folder is still there */
    }
  }

  /** The text of the log for the Logs window: the earlier file and this one. */
  async read(): Promise<string> {
    await this.flush();
    const old = await this.fs.readFile(`${this.file}.1`, 'utf8').then(String, () => '');
    const now = await this.fs.readFile(this.file, 'utf8').then(String, () => '');
    const all = old + now;
    return all.length > 400_000 ? `… (the start is left out; the whole log is in ${this.copyTo})\n${all.slice(all.length - 400_000)}` : all;
  }

  // ---------------------------------------------------------------- what the page is doing

  /** Say what is going on until the returned function is called (for freeze reports: "doing: ..."). Slow things are logged when they end. */
  begin(what: string, slowMs = SLOW_CALL_MS): (extra?: string) => void {
    const id = this.nextDoing++;
    const at = Date.now();
    this.doing.set(id, { what, since: at });
    return (extra) => {
      this.doing.delete(id);
      const ms = Date.now() - at;
      if (ms >= slowMs) this.line(ms >= 3000 ? 'WARN' : 'INFO', 'main', `${what} took ${this.secs(ms)}${extra ? ` ${extra}` : ''}`);
    };
  }

  private secs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  }

  private doingNow(): string {
    const now = Date.now();
    const list = [...this.doing.values()].sort((a, b) => a.since - b.since).slice(0, 4).map((d) => `${d.what} (${this.secs(now - d.since)} so far)`);
    const fs = this.fsState.running + this.fsState.queued > 0 ? `fs ${this.fsState.running} running, ${this.fsState.queued} waiting` : '';
    return [list.join(', '), fs].filter(Boolean).join(' | ') || 'nothing known';
  }

  /** Called by the file layer for each operation: how long it waited for its turn, how long it ran, how much it brought back. */
  fsDone(op: string, target: string, waitMs: number, runMs: number, bytes: number, state: { running: number; queued: number }): void {
    this.fsState = state;
    const s = this.fsStats;
    s.ops++;
    s.ms += runMs;
    s.bytes += bytes;
    s.byOp.set(op, (s.byOp.get(op) ?? 0) + 1);
    s.maxQueue = Math.max(s.maxQueue, state.queued);
    s.maxWait = Math.max(s.maxWait, waitMs);
    if (runMs >= SLOW_FS_MS || bytes >= BIG_RESULT) this.line('INFO', 'fs', `${op} ${target} took ${this.secs(runMs)} (waited ${this.secs(waitMs)}), ${Math.round(bytes / 1024)} KB`);
    if (!s.timer) {
      s.timer = setTimeout(() => {
        const ops = [...s.byOp].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
        this.line('INFO', 'fs', `${s.ops} operations in ${this.secs(Date.now() - s.since)} (${ops}); ${this.secs(s.ms)} in the plugin, ${Math.round(s.bytes / 1024)} KB, longest wait ${this.secs(s.maxWait)}, most waiting ${s.maxQueue}`);
        this.fsStats = { ops: 0, ms: 0, byOp: new Map(), maxQueue: 0, maxWait: 0, bytes: 0, since: Date.now(), timer: null };
      }, 5000);
    }
  }

  // ---------------------------------------------------------------- watching

  private hook(): void {
    for (const [name, level] of [['warn', 'WARN'], ['error', 'ERROR']] as const) {
      const orig = console[name].bind(console);
      console[name] = (...args: unknown[]): void => {
        orig(...args);
        this.line(level, 'console', args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safe(a))).join(' ').slice(0, 600));
      };
    }
    window.addEventListener('error', (e) => this.line('ERROR', 'main', `uncaught ${e.message} at ${e.filename?.replace(/^.*\//, '')}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => this.line('ERROR', 'main', `unhandled rejection: ${(e.reason as Error)?.message ?? String(e.reason)}`));

    // the page not getting its turn: a timer that comes late says so, and what was going on
    this.lastTick = Date.now();
    setInterval(() => {
      const now = Date.now();
      const late = now - this.lastTick - 250;
      this.lastTick = now;
      if (late >= BLOCKED_MS && this.foreground) this.line(late >= 2000 ? 'ERROR' : 'WARN', 'main', `blocked ${this.secs(late)} (the page could not answer). doing: ${this.doingNow()}`);
    }, 250);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration >= 200) this.line('INFO', 'main', `long task ${this.secs(Math.round(e.duration))} (script or layout)`);
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* not supported */
    }
    // memory, now and then while in front
    setInterval(() => {
      if (!this.foreground) return;
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (m) this.line('DEBUG', 'main', `memory: page ${Math.round(m.usedJSHeapSize / 1048576)} MB of ${Math.round(m.jsHeapSizeLimit / 1048576)} MB`);
    }, 30_000);
    document.addEventListener('visibilitychange', () => this.line('INFO', 'main', `page ${document.visibilityState}`));
    document.addEventListener('freeze', () => this.line('INFO', 'main', 'page frozen by the system'));
    document.addEventListener('resume', () => this.line('INFO', 'main', 'page resumed by the system'));
    window.addEventListener('pagehide', (e) => {
      this.line('INFO', 'main', `pagehide${(e as PageTransitionEvent).persisted ? ' (kept)' : ''}`);
      void this.flush();
    });
  }

  /** The app went to the background or came back. */
  lifecycle(active: boolean): void {
    this.foreground = active;
    this.line('INFO', 'main', active ? 'app in front' : 'app in the background');
    this.setState(active ? 'running' : 'background');
    this.lastTick = Date.now();
    if (!active) void this.publish();
  }
}

const safe = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
