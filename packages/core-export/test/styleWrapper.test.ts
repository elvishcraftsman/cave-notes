import { describe, expect, it } from 'vitest';
import { parseStyleSetsYaml } from '../src/index';

describe('style files with a heading', () => {
  const body = 'Mine:\n  units: cm\n';
  it('reads styles written directly', () => {
    expect(parseStyleSetsYaml(body).sets.map((s) => s.name)).toEqual(['Mine']);
  });
  it('reads styles under export-style:', () => {
    expect(parseStyleSetsYaml('export-style:\n  Mine:\n    units: cm\n').sets.map((s) => s.name)).toEqual(['Mine']);
  });
  it('reads styles under export-styles:', () => {
    const r = parseStyleSetsYaml('export-styles:\n  Mine:\n    units: cm\n');
    expect(r.errors).toEqual([]);
    expect(r.sets.map((s) => s.name)).toEqual(['Mine']);
  });
});
