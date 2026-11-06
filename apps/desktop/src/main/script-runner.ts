/**
 * The Run button of a code block marked as a shell script (sh, bash, zsh, shell).
 *
 * The person clicks it on purpose, so unlike an automation it does not ask about each script. It asks once per workspace
 * ("run scripts from this workspace?") and remembers the answer in the app's data folder, never in the workspace itself:
 * a workspace is synced and shared, and must not be able to vouch for its own scripts. Scripts run in the folder of the page
 * (inside the workspace), with the same short environment as automation commands plus CAVE_* values.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEnv, confineCwd, runCommand, type ShellRequest } from './automation-shell';

export interface ScriptResult {
  ran: boolean;
  code?: number | null;
  output?: string;
  timedOut?: boolean;
  stopped?: boolean;
  reason?: string;
  /** It was handed to a terminal window: what it prints and how it ends are not known here. */
  terminal?: boolean;
}

const SHELLS: Record<string, string> = { sh: 'sh', shell: 'sh', bash: 'bash', zsh: 'zsh' };

/** A script that asks for a password (sudo) cannot run without a terminal: it has nowhere to ask. */
export function needsTerminal(code: string): boolean {
  return /(^|[\s;&|(`])(sudo|su|pkexec|doas)(\s|$)/m.test(code);
}

const shq = (t: string): string => `'${t.replace(/'/g, `'\\''`)}'`;

/** The terminals tried in order (the newest Fedora/GNOME ones first), with how each is told to run a script file. */
const TERMINALS: Array<[string, (file: string) => string[]]> = [
  ['ptyxis', (f) => ['--new-window', '-x', `bash ${shq(f)}`]],
  ['gnome-terminal', (f) => ['--', 'bash', f]],
  ['kgx', (f) => ['-e', `bash ${shq(f)}`]],
  ['konsole', (f) => ['-e', 'bash', f]],
  ['xfce4-terminal', (f) => ['-x', 'bash', f]],
  ['mate-terminal', (f) => ['-x', 'bash', f]],
  ['tilix', (f) => ['-e', `bash ${shq(f)}`]],
  ['kitty', (f) => ['bash', f]],
  ['alacritty', (f) => ['-e', 'bash', f]],
  ['foot', (f) => ['bash', f]],
  ['wezterm', (f) => ['start', '--', 'bash', f]],
  ['x-terminal-emulator', (f) => ['-e', 'bash', f]],
  ['xterm', (f) => ['-e', 'bash', f]],
];

/** The first terminal program found on PATH (CAVE_TERMINAL, e.g. `foot`, wins when it is set and found), with its arguments. */
export function findTerminal(file: string, pathVar: string = process.env.PATH ?? '', prefer: string | undefined = process.env.CAVE_TERMINAL): { cmd: string; args: string[] } | null {
  const has = (name: string): boolean => pathVar.split(path.delimiter).some((d) => d !== '' && fs.existsSync(path.join(d, name)));
  const order = prefer ? [...TERMINALS.filter(([n]) => n === prefer), ...TERMINALS.filter(([n]) => n !== prefer)] : TERMINALS;
  for (const [name, args] of order) if (has(name)) return { cmd: name, args: args(file) };
  return null;
}

/**
 * Write the script to a private temporary folder and open it in a terminal window, where sudo can ask for the password.
 * The window waits for Enter at the end so the output can be read, and the temporary files remove themselves.
 */
function openInTerminal(o: { shell: string; code: string; cwd: string; env: Record<string, string>; log: (m: string) => void; launch?: typeof findTerminal }): ScriptResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cave-run-'));
  const body = path.join(dir, 'script');
  const wrapper = path.join(dir, 'run.sh');
  fs.writeFileSync(body, `${o.code}\n`, { mode: 0o600 });
  const exports = Object.entries(o.env)
    .filter(([k]) => /^CAVE_/.test(k))
    .map(([k, v]) => `export ${k}=${shq(v)}`)
    .join('\n');
  fs.writeFileSync(
    wrapper,
    `#!/bin/bash\ncd ${shq(o.cwd)} || exit 1\n${exports}\n${o.shell} ${shq(body)}\ncode=$?\necho\nif [ "$code" -eq 0 ]; then echo "[Finished. Press Enter to close this window.]"; else echo "[Finished with exit code $code. Press Enter to close this window.]"; fi\nread -r _\nrm -rf ${shq(dir)}\n`,
    { mode: 0o700 },
  );
  const t = (o.launch ?? findTerminal)(wrapper, o.env.PATH);
  if (!t) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ran: false, reason: 'No terminal program was found. Install one (for example gnome-terminal or ptyxis), or set CAVE_TERMINAL to its name.' };
  }
  try {
    const child = spawn(t.cmd, t.args, { cwd: o.cwd, env: o.env, stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ran: false, reason: `The terminal could not be started: ${(e as Error).message}` };
  }
  o.log(`script block opened in ${t.cmd}`);
  return { ran: true, terminal: true, code: null, output: '' };
}

/** The workspaces the person agreed to run scripts from. */
export class ScriptTrust {
  private roots = new Set<string>();
  constructor(private readonly file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { roots?: unknown };
      for (const r of Array.isArray(j.roots) ? j.roots : []) if (typeof r === 'string') this.roots.add(r);
    } catch {
      /* none yet */
    }
  }
  isTrusted(root: string): boolean {
    return this.roots.has(path.resolve(root));
  }
  trust(root: string): void {
    this.roots.add(path.resolve(root));
    this.save();
  }
  count(): number {
    return this.roots.size;
  }
  clear(): void {
    this.roots.clear();
    this.save();
  }
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ roots: [...this.roots] }, null, 1));
    } catch {
      /* it will be asked again */
    }
  }
}

export async function runScript(o: {
  root: string;
  /** The page holding the block, relative to the workspace. */
  page: string;
  code: string;
  lang: string;
  /** Open it in a terminal window instead of running it here (needed when it asks for a password). Also chosen automatically for sudo. */
  terminal?: boolean;
  trust: ScriptTrust;
  /** Shows "run scripts from this workspace?"; resolves true for yes. */
  ask: (root: string) => Promise<boolean>;
  signal?: AbortSignal;
  baseEnv?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}): Promise<ScriptResult> {
  const say = o.log ?? (() => {});
  const shell = SHELLS[o.lang.toLowerCase()];
  if (!shell) return { ran: false, reason: `“${o.lang}” is not a shell script.` };
  if (o.code.trim() === '') return { ran: false, reason: 'There is nothing to run.' };
  if (!o.trust.isTrusted(o.root)) {
    if (!(await o.ask(o.root))) return { ran: false, reason: 'Not run: you did not allow scripts from this workspace.' };
    o.trust.trust(o.root);
  }
  const folder = o.page ? path.dirname(o.page) : '';
  const cwd = confineCwd(o.root, folder === '.' ? '' : folder) ?? confineCwd(o.root, '');
  if (cwd === null) return { ran: false, reason: 'The workspace folder is not there.' };
  const abs = o.page ? path.join(path.resolve(o.root), o.page) : '';
  const env = cleanEnv(o.baseEnv ?? process.env, {
    CAVE_WORKSPACE: path.resolve(o.root),
    CAVE_PAGE: o.page,
    CAVE_FILE: abs,
    CAVE_FOLDER: cwd,
    CAVE_TITLE: path.basename(o.page, path.extname(o.page)),
  });
  if (o.terminal || needsTerminal(o.code)) {
    say(`script block (${o.lang}) in ${cwd}: ${o.code.split('\n')[0]}${o.code.includes('\n') ? ' …' : ''} (in a terminal)`);
    return openInTerminal({ shell, code: o.code, cwd, env, log: say });
  }
  const req: ShellRequest = { ruleId: 'code-block', command: o.code, argv: null, cwd: null, timeoutMs: 600_000, env: {}, page: o.page, template: { command: o.code, argv: null, cwd: null, env: {} }, shell };
  say(`script block (${o.lang}) in ${cwd}: ${o.code.split('\n')[0]}${o.code.includes('\n') ? ' …' : ''}`);
  const res = await runCommand(req, cwd, env, o.signal);
  say(`script block finished: code ${res.code}${res.timedOut ? ' (timed out)' : ''}${res.stopped ? ' (stopped)' : ''}`);
  const output = [res.stdout ?? '', res.stderr ?? ''].filter((t) => t !== '').join(res.stdout && res.stderr ? '\n' : '');
  return { ran: true, code: res.code, output, timedOut: res.timedOut, stopped: res.stopped };
}
