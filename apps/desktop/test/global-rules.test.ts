import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSettings } from '@cave-notes/service/workspace-file';
import { rulesText } from '@cave-notes/service/workspace-file';
import { describe as describeOffer, inheritedFor, publishOffer, readOffers, type Consent } from '@cave-notes/service/globals';

let a: string;
let b: string;
let shared: string;
const put = async (dir: string, name: string, text: string): Promise<void> => {
  await fs.mkdir(path.join(dir, '.cave-notes'), { recursive: true });
  await fs.writeFile(path.join(dir, '.cave-notes', name), text);
};

beforeEach(async () => {
  a = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-gr-a-'));
  b = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-gr-b-'));
  shared = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-gr-s-'));
});
afterEach(async () => {
  for (const d of [a, b, shared]) await fs.rm(d, { recursive: true, force: true });
});

const RULE = '  - id: archive\n    on: { change: status, to: done }\n    do: [ { set_property: { property: archived, value: true } } ]\n';

describe('rules shared with !global', () => {
  it('are offered, approved, and run in the other workspace next to its own', async () => {
    await put(a, 'more-rules.yaml', `rules: !global\n${RULE}`);
    await publishOffer(shared, a, await readSettings(path.join(a, '.cave-notes')));
    const offers = await readOffers(shared);
    expect(offers).toHaveLength(1);
    expect(describeOffer(offers[0]!.sections).join(' ')).toMatch(/1 automation rule: archive/);
    const consent: Consent = { [a]: { hash: offers[0]!.hash, apply: [b], decided: [b] } };
    const taken = inheritedFor(b, offers, consent);
    expect(taken.rules).toHaveLength(1);

    // b has no rules of its own: it gets the shared one
    await fs.mkdir(path.join(b, '.cave-notes'), { recursive: true });
    const only = YAML.parse((await rulesText(path.join(b, '.cave-notes'), taken.rules))!) as { rules: Array<{ id: string }> };
    expect(only.rules.map((r) => r.id)).toEqual(['archive']);

    // its own rules win by id and add to the shared ones
    await put(b, 'automations.yaml', 'rules:\n  - id: archive\n    on: { change: status, to: closed }\n    do: []\n  - id: mine\n    on: { change: x }\n    do: []\n');
    const both = YAML.parse((await rulesText(path.join(b, '.cave-notes'), taken.rules))!) as { rules: Array<{ id: string; on: { to?: string } }> };
    expect(both.rules.map((r) => r.id).sort()).toEqual(['archive', 'mine']);
    expect(both.rules.find((r) => r.id === 'archive')!.on.to).toBe('closed');

    // an empty `rules:` switches the shared ones off
    await put(b, 'automations.yaml', 'rules: []\n');
    const off = YAML.parse((await rulesText(path.join(b, '.cave-notes'), taken.rules))!) as { rules: unknown[] };
    expect(off.rules).toEqual([]);
  });

  it('are not taken until approved', async () => {
    await put(a, 'r.yaml', `rules: !global\n${RULE}`);
    await publishOffer(shared, a, await readSettings(path.join(a, '.cave-notes')));
    expect(inheritedFor(b, await readOffers(shared), {}).rules).toBeUndefined();
  });
});
