import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Approvals, approvalKey, cleanEnv, confineCwd, handleShell, type Decision, type ShellRequest } from '../src/main/automation-shell';

let dir: string;
let root: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cave-shell-'));
  root = path.join(dir, 'vault');
  fs.mkdirSync(path.join(root, 'Posts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outside'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const req = (over: Partial<ShellRequest> = {}): ShellRequest => ({
  ruleId: 'r1',
  command: 'printf %s "$CAVE_TITLE"',
  argv: null,
  cwd: null,
  timeoutMs: 5000,
  env: { CAVE_TITLE: '$(touch pwned); `id`' },
  page: 'Posts/p.md',
  template: { command: 'printf %s "$CAVE_TITLE"', argv: null, cwd: null, env: {} },
  ...over,
});

const run = (r: ShellRequest, o: { shellOn?: boolean; answer?: Decision; approvals?: Approvals } = {}) => {
  const asked: string[] = [];
  const approvals = o.approvals ?? new Approvals(path.join(dir, 'approvals.json'));
  return handleShell({
    root,
    req: r,
    shellOn: o.shellOn ?? true,
    approvals,
    ask: async (w) => {
      asked.push(w.command);
      return o.answer ?? 'once';
    },
    baseEnv: { PATH: process.env.PATH, HOME: '/home/x', SECRET_TOKEN: 'abc', ELECTRON_RUN_AS_NODE: '1' },
  }).then((out) => ({ out, asked, approvals }));
};

describe('confineCwd', () => {
  it('keeps the working folder inside the workspace', () => {
    expect(confineCwd(root, null)).toBe(fs.realpathSync(root));
    expect(confineCwd(root, 'Posts')).toBe(fs.realpathSync(path.join(root, 'Posts')));
    expect(confineCwd(root, '..')).toBeNull();
    expect(confineCwd(root, path.join(dir, 'outside'))).toBeNull();
    expect(confineCwd(root, 'Missing')).toBeNull();
  });
  it('follows symbolic links before checking', () => {
    fs.symlinkSync(path.join(dir, 'outside'), path.join(root, 'sneaky'));
    expect(confineCwd(root, 'sneaky')).toBeNull();
  });
});

describe('cleanEnv', () => {
  it('passes ordinary variables and CAVE_* values, drops the rest', () => {
    const e = cleanEnv({ PATH: '/bin', HOME: '/h', SECRET_TOKEN: 's', LC_ALL: 'C', ELECTRON_RUN_AS_NODE: '1' }, { CAVE_X: '1', LD_PRELOAD: '/evil.so', NODE_OPTIONS: '--x', 'BAD-NAME': 'x' });
    expect(e).toEqual({ PATH: '/bin', HOME: '/h', LC_ALL: 'C', CAVE_X: '1' });
  });
});

describe('handleShell', () => {
  it('does nothing while shell commands are switched off', async () => {
    const { out, asked } = await run(req(), { shellOn: false });
    expect(out.denied).toBe(true);
    expect(out.reason).toMatch(/switched off/);
    expect(asked).toHaveLength(0);
  });

  it('asks the first time, remembers "always", and never interpolates values into the command line', async () => {
    const first = await run(req(), { answer: 'always' });
    expect(first.asked).toEqual(['printf %s "$CAVE_TITLE"']);
    expect(first.out.code).toBe(0);
    expect(first.out.stdout).toBe('$(touch pwned); `id`'); // printed, not executed
    expect(fs.existsSync(path.join(root, 'pwned'))).toBe(false);
    const again = await run(req(), { approvals: new Approvals(path.join(dir, 'approvals.json')) });
    expect(again.asked).toHaveLength(0);
    expect(again.out.code).toBe(0);
  });

  it('asks again when the command is edited', async () => {
    const a = new Approvals(path.join(dir, 'approvals.json'));
    a.allow(approvalKey(root, req()));
    const edited = req({ command: 'echo changed', template: { command: 'echo changed', argv: null, cwd: null, env: {} } });
    const { asked } = await run(edited, { approvals: a, answer: 'deny' });
    expect(asked).toEqual(['echo changed']);
  });

  it('a refusal is remembered and the command does not run', async () => {
    const r = await run(req({ command: 'touch ran', template: { command: 'touch ran', argv: null, cwd: null, env: {} } }), { answer: 'deny' });
    expect(r.out.denied).toBe(true);
    expect(fs.existsSync(path.join(root, 'ran'))).toBe(false);
    const again = await run(req({ command: 'touch ran', template: { command: 'touch ran', argv: null, cwd: null, env: {} } }), { approvals: r.approvals });
    expect(again.asked).toHaveLength(0);
    expect(again.out.reason).toMatch(/refused/);
  });

  it('runs argv directly, without a shell', async () => {
    const r = await run(req({ command: null, argv: ['printf', '%s', 'a b;$HOME'], template: { command: null, argv: ['printf', '%s', 'a b;$HOME'], cwd: null, env: {} } }), { answer: 'once' });
    expect(r.out.stdout).toBe('a b;$HOME');
  });

  it('runs in the working folder, and refuses one outside the workspace', async () => {
    const ok = await run(req({ command: 'pwd', cwd: 'Posts', template: { command: 'pwd', argv: null, cwd: 'Posts', env: {} } }));
    expect(ok.out.stdout?.trim()).toBe(fs.realpathSync(path.join(root, 'Posts')));
    const bad = await run(req({ cwd: '../outside' }));
    expect(bad.out.denied).toBe(true);
    expect(bad.out.reason).toMatch(/not inside the workspace/);
  });

  it('does not hand over the app environment', async () => {
    const r = await run(req({ command: 'echo "[$SECRET_TOKEN][$ELECTRON_RUN_AS_NODE][$HOME]"', template: { command: 'x', argv: null, cwd: null, env: {} } }));
    expect(r.out.stdout?.trim()).toBe('[][]['+'/home/x'+']');
  });

  it('stops a command that runs too long, with whatever it started', async () => {
    const t0 = Date.now();
    const r = await run(req({ command: 'sleep 30 & sleep 30', timeoutMs: 1000, template: { command: 'sleep', argv: null, cwd: null, env: {} } }));
    expect(r.out.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 15_000);

  it('reports a failing exit code', async () => {
    const r = await run(req({ command: 'echo boom >&2; exit 3', template: { command: 'e', argv: null, cwd: null, env: {} } }));
    expect(r.out.code).toBe(3);
    expect(r.out.stderr).toMatch(/boom/);
  });
});
