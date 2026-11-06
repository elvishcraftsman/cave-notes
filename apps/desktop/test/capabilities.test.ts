import { describe, expect, it } from 'vitest';
import { capabilitiesOf, CaveError, createDeps, partialMainApi } from '../src/renderer/bridge';
import { DESKTOP_CAPABILITIES } from '../src/shared/api';
import type { RawBridge } from '../src/shared/api';

describe('capabilities', () => {
  it('desktop has every capability', () => {
    expect(Object.values(DESKTOP_CAPABILITIES).every((v) => v === true)).toBe(true);
  });

  it('deps made from the desktop bridge carry them, and deps without any mean everything', () => {
    const raw: RawBridge = { invoke: async () => ({ ok: true, value: null }), on: () => () => undefined, platform: 'linux' };
    expect(createDeps(raw).capabilities).toEqual(DESKTOP_CAPABILITIES);
    expect(capabilitiesOf({})).toEqual(DESKTOP_CAPABILITIES);
    expect(capabilitiesOf({ capabilities: { ...DESKTOP_CAPABILITIES, shell: false } }).shell).toBe(false);
  });
});

describe('partialMainApi', () => {
  it('runs what is implemented and refuses the rest with UNSUPPORTED', async () => {
    const main = partialMainApi({ isFile: async () => true });
    expect(await main.isFile('/a')).toBe(true);
    const err = await main.newWindow().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaveError);
    expect((err as CaveError).code).toBe('UNSUPPORTED');
    expect((err as CaveError).message).toContain('newWindow');
  });
});
