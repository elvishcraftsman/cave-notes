/**
 * Deciding whether a rule's JavaScript may run. The script itself runs in the sandbox (packages/core-automation), away from
 * the app and the workspace; this is only the permission, and it lives in the main process so that a page or a rule cannot
 * grant itself anything:
 *
 *  - off unless the person switched JavaScript on (Preferences, with a confirmation);
 *  - while "Ask before running a rule's JavaScript" is on (the default), each script is approved once by the person, in a
 *    dialog showing the script exactly as the rules file says it. The approval is tied to the workspace, the rule and the
 *    script's text, so changing one character asks again. Approvals are kept in the app's data folder, never in a workspace.
 *  - with that question switched off (also a confirmed choice), approved scripts need no question, but the first switch still
 *    has to be on.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type { Approvals, Decision } from './automation-shell';

/** What identifies a script for approval: where it runs, which rule, and the script as written. */
export function jsApprovalKey(root: string, ruleId: string, code: string): string {
  return crypto.createHash('sha256').update(JSON.stringify(['js', path.resolve(root), ruleId, code])).digest('hex');
}

export interface JsAnswer {
  allowed: boolean;
  reason?: string;
}

export async function handleJs(o: {
  root: string;
  ruleId: string;
  code: string;
  jsOn: boolean;
  askOn: boolean;
  approvals: Approvals;
  ask: (what: { root: string; ruleId: string; code: string }) => Promise<Decision>;
  log?: (msg: string) => void;
}): Promise<JsAnswer> {
  const say = o.log ?? (() => {});
  const refuse = (reason: string): JsAnswer => {
    say(`automation JavaScript refused (rule ${o.ruleId}): ${reason}`);
    return { allowed: false, reason };
  };
  if (!o.jsOn) return refuse('JavaScript in rules is switched off in Preferences');
  if (!o.askOn) return { allowed: true };
  const key = jsApprovalKey(o.root, o.ruleId, o.code);
  if (o.approvals.isDenied(key)) return refuse('you refused this script earlier (Preferences can forget that)');
  if (!o.approvals.isAllowed(key)) {
    const d = await o.ask({ root: o.root, ruleId: o.ruleId, code: o.code });
    if (d === 'deny') {
      o.approvals.deny(key);
      return refuse('you refused this script');
    }
    if (d === 'always') o.approvals.allow(key);
  }
  return { allowed: true };
}
