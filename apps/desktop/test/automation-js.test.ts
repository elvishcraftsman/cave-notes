import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleJs, jsApprovalKey } from '../src/main/automation-js';
import { Approvals, type Decision } from '../src/main/automation-shell';

const store = (): Approvals => new Approvals(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cave-js-')), 'approvals.json'));
const base = { root: '/w', ruleId: 'r', code: 'return text;' };

describe('permission to run a rule\'s JavaScript', () => {
  it('is refused while the switch is off, without asking', async () => {
    let asked = 0;
    const r = await handleJs({ ...base, jsOn: false, askOn: true, approvals: store(), ask: async () => (asked++, 'always') });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/switched off/);
    expect(asked).toBe(0);
  });

  it('asks once, remembers "always", and asks again when the script changes', async () => {
    const approvals = store();
    let asked = 0;
    const ask = async (): Promise<Decision> => (asked++, 'always');
    expect((await handleJs({ ...base, jsOn: true, askOn: true, approvals, ask })).allowed).toBe(true);
    expect((await handleJs({ ...base, jsOn: true, askOn: true, approvals, ask })).allowed).toBe(true);
    expect(asked).toBe(1);
    await handleJs({ ...base, code: 'return text + " ";', jsOn: true, askOn: true, approvals, ask });
    expect(asked).toBe(2);
    // another workspace or another rule is another approval
    await handleJs({ ...base, root: '/other', jsOn: true, askOn: true, approvals, ask });
    await handleJs({ ...base, ruleId: 'r2', jsOn: true, askOn: true, approvals, ask });
    expect(asked).toBe(4);
  });

  it('"once" allows this run only, and "deny" is remembered', async () => {
    const approvals = store();
    let asked = 0;
    const once = async (): Promise<Decision> => (asked++, 'once');
    expect((await handleJs({ ...base, jsOn: true, askOn: true, approvals, ask: once })).allowed).toBe(true);
    expect((await handleJs({ ...base, jsOn: true, askOn: true, approvals, ask: once })).allowed).toBe(true);
    expect(asked).toBe(2);
    const deny = async (): Promise<Decision> => 'deny';
    const d = await handleJs({ ...base, code: 'x', jsOn: true, askOn: true, approvals, ask: deny });
    expect(d.allowed).toBe(false);
    const again = await handleJs({ ...base, code: 'x', jsOn: true, askOn: true, approvals, ask: async () => 'always' });
    expect(again.allowed).toBe(false);
    expect(again.reason).toMatch(/refused/);
  });

  it('with the question switched off, scripts run without asking (the first switch still counts)', async () => {
    let asked = 0;
    const ask = async (): Promise<Decision> => (asked++, 'deny');
    expect((await handleJs({ ...base, jsOn: true, askOn: false, approvals: store(), ask })).allowed).toBe(true);
    expect(asked).toBe(0);
    expect((await handleJs({ ...base, jsOn: false, askOn: false, approvals: store(), ask })).allowed).toBe(false);
  });

  it('keys differ with the workspace, the rule and the script', () => {
    const k = jsApprovalKey('/w', 'r', 'a');
    expect(new Set([k, jsApprovalKey('/x', 'r', 'a'), jsApprovalKey('/w', 's', 'a'), jsApprovalKey('/w', 'r', 'b')]).size).toBe(4);
  });
});
