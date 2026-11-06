/**
 * Running the shell commands of automations. This is the only place that starts a program on behalf of a rule, and it
 * lives in the main process, away from the worker that evaluates rules:
 *
 *  - off unless the person switched shell commands on (Preferences); that is checked by the caller;
 *  - a command is approved once, by the person, in a dialog showing the command exactly as the rules file says it; the
 *    approval is tied to the workspace, the rule and the command's text, so changing the command asks again;
 *  - the working folder must lie inside the workspace (symbolic links are followed before checking);
 *  - the program gets a short list of ordinary environment variables plus CAVE_* values, never the app's own environment
 *    (no tokens, no Electron settings);
 *  - a time limit (default 30 s) after which the program is stopped, and a cap on how much output is kept.
 *
 * A rule's values never become part of the command line: a command written as text is run by `sh -c` with the values in
 * the environment (`"$CAVE_TITLE"`), and a command written as `argv` is run directly, without a shell at all.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface ShellRequest {
  ruleId: string;
  command: string | null;
  argv: string[] | null;
  cwd: string | null;
  timeoutMs: number;
  env: Record<string, string>;
  page: string;
  template: { command: string | null; argv: string[] | null; cwd: string | null; env: Record<string, unknown> };
  /** Which shell runs a text command (default `sh`). Used by the Run button of a code block marked bash or zsh. */
  shell?: string;
}

export interface ShellOutcome {
  code: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  stopped?: boolean;
  denied?: boolean;
  reason?: string;
}

/** What identifies a command for approval: where it runs, which rule, and the command as written. */
export function approvalKey(root: string, req: Pick<ShellRequest, 'ruleId' | 'template'>): string {
  return crypto.createHash('sha256').update(JSON.stringify([path.resolve(root), req.ruleId, req.template.command, req.template.argv, req.template.cwd, req.template.env])).digest('hex');
}

/** The command in words, for the approval question and the log. */
export function describeCommand(req: Pick<ShellRequest, 'template'>): string {
  const t = req.template;
  if (t.argv) return t.argv.map((a) => (/^[\w./:=@%+-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');
  return t.command ?? '';
}

/** `cwd` (a path in the workspace, absolute or relative to its root) as an absolute path inside the workspace, or null. */
export function confineCwd(root: string, cwd: string | null): string | null {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  const want = cwd === null || cwd === '' ? realRoot : path.isAbsolute(cwd) ? cwd : path.resolve(realRoot, cwd);
  let real: string;
  try {
    real = fs.realpathSync(want);
  } catch {
    return null; // a folder that is not there
  }
  const rel = path.relative(realRoot, real);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return real;
  return null;
}

const KEEP = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK', 'TERM', 'SHELL']);

/** The environment a command gets: a short, ordinary list from the app's, then the rule's CAVE_* values and its own `env:`. */
export function cleanEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && (KEEP.has(k) || k.startsWith('LC_'))) out[k] = v;
  if (!out.PATH) out.PATH = '/usr/local/bin:/usr/bin:/bin';
  for (const [k, v] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || /^(ELECTRON|NODE_|LD_|DYLD_)/.test(k)) continue; // nothing that changes how programs load
    out[k] = String(v);
  }
  return out;
}

const OUTPUT_CAP = 16_384;

/** Run it. Resolves (never rejects) with the exit code and the start of what the command printed. */
export function runCommand(req: ShellRequest, cwd: string, env: Record<string, string>, signal?: AbortSignal): Promise<ShellOutcome> {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let stopped = false;
    let finished = false;
    const finish = (o: ShellOutcome): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ...o, stdout: out, stderr: err, timedOut, stopped });
    };
    let child;
    try {
      child = req.argv ? spawn(req.argv[0]!, req.argv.slice(1), { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(req.shell ?? '/bin/sh', ['-c', req.command ?? ''], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      resolve({ code: 127, stderr: (e as Error).message });
      return;
    }
    const add = (cur: string, d: Buffer): string => (cur.length >= OUTPUT_CAP ? cur : (cur + d.toString('utf8')).slice(0, OUTPUT_CAP));
    child.stdout?.on('data', (d: Buffer) => (out = add(out, d)));
    child.stderr?.on('data', (d: Buffer) => (err = add(err, d)));
    const kill = (sig: NodeJS.Signals): void => {
      try {
        // the shell was started in its own process group: stop everything it started too
        if (!req.argv && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 3000).unref();
    }, Math.max(1000, Math.min(req.timeoutMs, 600_000)));
    timer.unref();
    const onAbort = (): void => {
      stopped = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 3000).unref();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      err = `${err}${(e as Error).message}`;
      finish({ code: 127 });
    });
    child.on('close', (code, sig) => finish({ code: timedOut ? 124 : (code ?? (sig ? 128 : 1)) }));
  });
}

/** The commands the person approved (or refused for good), kept in the app's data folder, never in a workspace. */
export class Approvals {
  private allowed = new Set<string>();
  private denied = new Set<string>();
  constructor(private readonly file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { allowed?: unknown; denied?: unknown };
      for (const k of Array.isArray(j.allowed) ? j.allowed : []) if (typeof k === 'string') this.allowed.add(k);
      for (const k of Array.isArray(j.denied) ? j.denied : []) if (typeof k === 'string') this.denied.add(k);
    } catch {
      /* none yet */
    }
  }
  isAllowed(key: string): boolean {
    return this.allowed.has(key);
  }
  isDenied(key: string): boolean {
    return this.denied.has(key);
  }
  allow(key: string): void {
    this.denied.delete(key);
    this.allowed.add(key);
    this.save();
  }
  deny(key: string): void {
    this.allowed.delete(key);
    this.denied.add(key);
    this.save();
  }
  /** Forget everything (Preferences: "Forget approved commands"). */
  clear(): void {
    this.allowed.clear();
    this.denied.clear();
    this.save();
  }
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ allowed: [...this.allowed], denied: [...this.denied] }, null, 1));
    } catch {
      /* the next question will simply be asked again */
    }
  }
}

export type Decision = 'always' | 'once' | 'deny';

/**
 * The whole decision for one request. `shellOn` is the Preferences switch; `ask` shows the question (the main process
 * supplies a dialog). Returns the outcome to hand back to the worker.
 */
export async function handleShell(o: {
  root: string;
  req: ShellRequest;
  shellOn: boolean;
  approvals: Approvals;
  ask: (what: { root: string; ruleId: string; command: string; cwd: string }) => Promise<Decision>;
  baseEnv?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}): Promise<ShellOutcome> {
  const { root, req, approvals } = o;
  const say = o.log ?? (() => {});
  const refuse = (reason: string): ShellOutcome => {
    say(`automation shell refused (rule ${req.ruleId}): ${reason}`);
    return { code: -1, denied: true, reason };
  };
  if (!o.shellOn) return refuse('shell commands are switched off in Preferences');
  if (!req.argv && !(typeof req.command === 'string' && req.command.trim() !== '')) return refuse('there is no command');
  const cwd = confineCwd(root, req.cwd);
  if (cwd === null) return refuse(`the working folder "${req.cwd ?? ''}" is not inside the workspace`);
  const key = approvalKey(root, req);
  if (approvals.isDenied(key)) return refuse('you refused this command earlier (Preferences can forget that)');
  if (!approvals.isAllowed(key)) {
    const d = await o.ask({ root, ruleId: req.ruleId, command: describeCommand(req), cwd: req.template.cwd ?? '(the workspace folder)' });
    if (d === 'deny') {
      approvals.deny(key);
      return refuse('you refused this command');
    }
    if (d === 'always') approvals.allow(key);
  }
  say(`automation shell (rule ${req.ruleId}) in ${cwd}: ${describeCommand(req)}`);
  const res = await runCommand(req, cwd, cleanEnv(o.baseEnv ?? process.env, req.env));
  say(`automation shell (rule ${req.ruleId}) finished: code ${res.code}${res.timedOut ? ' (timed out)' : ''}`);
  return res;
}
