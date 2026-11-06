import { fork } from 'node:child_process';
import { utilityProcess } from 'electron';
import type { WireError } from '../shared/api';
import { type Level, log, logFile, logLevel } from '../shared/log';

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
  method: string;
  since: number;
  timer: NodeJS.Timeout;
}

/** A call that has had no answer after this long is given up on (the window would otherwise wait for ever). */
const CALL_TIMEOUT_MS = 90_000;
/** A call slower than this is reported in the log. */
const SLOW_CALL_MS = 750;

/**
 * Talks to the workspace worker. In the app the worker is an Electron utilityProcess (it loads the
 * native SQLite module built for Electron). With CAVE_WORKER_NODE=1 it is a plain Node child
 * process instead, which lets the whole app run in environments without an Electron-ABI build.
 */
export class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: string, payload: unknown) => void>();
  private send!: (msg: unknown) => void;
  private killer!: () => void;
  private alive = true;
  pid: number | undefined;
  private killed = false;

  constructor(
    workerPath: string,
    private readonly label = 'workspace',
  ) {
    const who = `ws:${label}`.slice(0, 10);
    const wlog = log.as('main');
    const handle = (msg: unknown): void => {
      const m = msg as { id?: number; ok?: boolean; value?: unknown; error?: WireError; event?: string; payload?: unknown };
      if (typeof m.event === 'string') {
        for (const l of this.listeners) l(m.event, m.payload);
        return;
      }
      const p = typeof m.id === 'number' ? this.pending.get(m.id) : undefined;
      if (!p || typeof m.id !== 'number') {
        if (typeof m.id === 'number') wlog.warn(`${who}: late answer to call #${m.id} (it had already timed out or been cancelled)`);
        return;
      }
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      const ms = Math.round(performance.now() - p.since);
      if (ms >= SLOW_CALL_MS) wlog.warn(`${who}: ${p.method} was slow: ${ms} ms${m.ok ? '' : ' (and failed)'}`);
      else wlog.trace(`${who}: ${p.method} ${ms} ms${m.ok ? '' : ' (failed)'}`);
      if (m.ok) p.resolve(m.value);
      else {
        const e: WireError = m.error ?? { message: 'Unknown worker error' };
        if (e.code !== 'NOT_FOUND' && e.code !== 'COLLISION') wlog.debug(`${who}: ${p.method} failed: ${e.code ?? ''} ${e.message}`);
        p.reject(Object.assign(new Error(e.message), { code: e.code, details: e.details }));
      }
    };
    const failAll = (reason: string): void => {
      this.alive = false;
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.reject(new Error(reason));
      }
    };
    const env = { ...process.env, CAVE_LOG_FILE: logFile() ?? '', CAVE_LOG: logLevel(), CAVE_LOG_TAG: who };

    if (process.env.CAVE_WORKER_NODE) {
      const child = fork(workerPath, [], { execPath: process.env.CAVE_NODE_PATH || 'node', execArgv: [], env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      this.pid = child.pid;
      child.on('message', handle);
      child.on('exit', (code, signal) => {
        (this.killed ? wlog.debug : wlog.warn)(`${who}: worker exited code=${code} signal=${signal ?? ''} with ${this.pending.size} call(s) waiting`);
        failAll(`Worker exited (${code})`);
      });
      this.send = (m) => void child.send(m as never);
      this.killer = () => void child.kill();
    } else {
      const child = utilityProcess.fork(workerPath, [], { serviceName: `cave-notes-${label}`.slice(0, 40), stdio: 'inherit', env });
      child.on('spawn', () => {
        this.pid = child.pid;
        wlog.info(`${who}: worker started pid=${child.pid}`);
      });
      child.on('message', handle);
      child.on('exit', (code) => {
        (this.killed ? wlog.debug : wlog.warn)(`${who}: worker exited code=${code} with ${this.pending.size} call(s) waiting`);
        failAll(`Worker exited (${code})`);
      });
      this.send = (m) => void child.postMessage(m);
      this.killer = () => void child.kill();
    }
  }

  call(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.alive) {
        reject(new Error('The workspace process has stopped. Close and reopen this workspace.'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        log.error(`ws:${this.label}: ${method} (call #${id}) got no answer in ${CALL_TIMEOUT_MS / 1000} s; ${this.pending.size} other call(s) still waiting. The workspace process may be stuck.`);
        reject(Object.assign(new Error(`The workspace did not answer (${method}). Its process may be stuck; closing and reopening the workspace usually fixes it.`), { code: 'TIMEOUT' }));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, method, since: performance.now(), timer });
      this.send({ id, method, args });
    });
  }

  /** How many calls are waiting and for how long (for the diagnostic report). */
  waiting(): Array<{ method: string; ms: number }> {
    const now = performance.now();
    return [...this.pending.values()].map((p) => ({ method: p.method, ms: Math.round(now - p.since) }));
  }

  setLogLevel(level: Level): void {
    if (this.alive) this.send({ logLevel: level });
  }

  onEvent(cb: (event: string, payload: unknown) => void): void {
    this.listeners.add(cb);
  }

  kill(): void {
    this.killed = true;
    this.alive = false;
    this.killer();
  }
}
