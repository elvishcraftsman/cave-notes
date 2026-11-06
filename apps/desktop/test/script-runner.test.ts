import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptTrust, findTerminal, needsTerminal, runScript } from '../src/main/script-runner';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cn-script-'));

function setup() {
  const dir = tmp();
  const root = path.join(dir, 'ws');
  fs.mkdirSync(path.join(root, 'Notes'), { recursive: true });
  const trust = new ScriptTrust(path.join(dir, 'trust.json'));
  return { dir, root, trust };
}

describe('the Run button of a code block', () => {
  it('asks once per workspace, then remembers (also after a restart)', async () => {
    const { dir, root, trust } = setup();
    let asked = 0;
    const ask = async () => (asked++, true);
    const a = await runScript({ root, page: 'Notes/A.md', code: 'echo hi', lang: 'bash', trust, ask });
    const b = await runScript({ root, page: 'Notes/A.md', code: 'echo again', lang: 'sh', trust, ask });
    expect([a.ran, a.output?.trim(), b.output?.trim(), asked]).toEqual([true, 'hi', 'again', 1]);
    const later = new ScriptTrust(path.join(dir, 'trust.json'));
    expect(later.isTrusted(root)).toBe(true);
    expect(new ScriptTrust(path.join(dir, 'other.json')).isTrusted(root)).toBe(false);
  });

  it('does not run, and does not remember, when the answer is no', async () => {
    const { root, trust } = setup();
    const res = await runScript({ root, page: 'Notes/A.md', code: 'touch made', lang: 'bash', trust, ask: async () => false });
    expect(res.ran).toBe(false);
    expect(trust.isTrusted(root)).toBe(false);
    expect(fs.existsSync(path.join(root, 'Notes', 'made'))).toBe(false);
  });

  it('runs in the folder of the page and tells the script where it is', async () => {
    const { root, trust } = setup();
    const res = await runScript({ root, page: 'Notes/A.md', code: 'pwd; echo "$CAVE_PAGE|$CAVE_TITLE"', lang: 'bash', trust, ask: async () => true });
    const [pwd, vars] = res.output!.trim().split('\n');
    expect(fs.realpathSync(pwd!)).toBe(fs.realpathSync(path.join(root, 'Notes')));
    expect(vars).toBe('Notes/A.md|A');
  });

  it('reports a failing script with its exit code and what it printed', async () => {
    const { root, trust } = setup();
    const res = await runScript({ root, page: 'A.md', code: 'echo out; echo oops >&2; exit 3', lang: 'bash', trust, ask: async () => true });
    expect(res.code).toBe(3);
    expect(res.output).toContain('out');
    expect(res.output).toContain('oops');
  });

  it('can be stopped', async () => {
    const { root, trust } = setup();
    const ac = new AbortController();
    const p = runScript({ root, page: 'A.md', code: 'sleep 30', lang: 'sh', trust, ask: async () => true, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const res = await p;
    expect(res.stopped).toBe(true);
  });

  it('refuses other languages and empty blocks', async () => {
    const { root, trust } = setup();
    expect((await runScript({ root, page: 'A.md', code: 'print(1)', lang: 'python', trust, ask: async () => true })).ran).toBe(false);
    expect((await runScript({ root, page: 'A.md', code: '  \n', lang: 'sh', trust, ask: async () => true })).ran).toBe(false);
  });

  it('forgets every workspace when cleared', async () => {
    const { root, trust } = setup();
    trust.trust(root);
    trust.clear();
    expect(trust.isTrusted(root)).toBe(false);
  });
});

describe('scripts that need a terminal (sudo)', () => {
  it('recognises scripts that ask for a password', () => {
    expect(needsTerminal('sudo dnf update')).toBe(true);
    expect(needsTerminal('echo hi\n  sudo -k')).toBe(true);
    expect(needsTerminal('cd /x && sudo make install')).toBe(true);
    expect(needsTerminal('echo pseudo; ls sudoers')).toBe(false);
    expect(needsTerminal('echo hello')).toBe(false);
  });

  it('picks the first terminal on PATH, preferring CAVE_TERMINAL', () => {
    const { dir } = setup();
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const n of ['xterm', 'konsole']) fs.writeFileSync(path.join(bin, n), '#!/bin/sh\n', { mode: 0o755 });
    expect(findTerminal('/t/run.sh', bin, undefined)?.cmd).toBe('konsole');
    expect(findTerminal('/t/run.sh', bin, 'xterm')?.cmd).toBe('xterm');
    expect(findTerminal('/t/run.sh', path.join(dir, 'empty'), undefined)).toBeNull();
  });

  it('opens a terminal instead of running the script, and the wrapper runs it in the page folder', async () => {
    const { dir, root, trust } = setup();
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(dir, 'args.txt');
    fs.writeFileSync(path.join(bin, 'xterm'), `#!/bin/sh\necho "$@" > ${log}\n`, { mode: 0o755 });
    const res = await runScript({ root, page: 'Notes/A.md', code: 'sudo true', lang: 'bash', trust, ask: async () => true, baseEnv: { PATH: `${bin}:/usr/bin:/bin` } });
    expect(res.ran).toBe(true);
    expect(res.terminal).toBe(true);
    for (let i = 0; i < 50 && !fs.existsSync(log); i++) await new Promise((r) => setTimeout(r, 40));
    const args = fs.readFileSync(log, 'utf8').trim().split(' ');
    expect(args.slice(0, 3)).toEqual(['-e', 'bash', args[2]]);
    const wrapper = fs.readFileSync(args[2]!, 'utf8');
    expect(wrapper).toContain(fs.realpathSync(path.join(root, 'Notes')));
    expect(wrapper).toContain('export CAVE_PAGE=');
  });

  it('says so when there is no terminal', async () => {
    const { root, trust } = setup();
    const res = await runScript({ root, page: 'A.md', code: 'echo hi', lang: 'bash', terminal: true, trust, ask: async () => true, baseEnv: { PATH: '/nonexistent' } });
    expect(res.ran).toBe(false);
    expect(res.reason).toMatch(/No terminal/);
  });
});
