import { describe, expect, it } from 'vitest';
import { cleanWindow } from '../src/settings';

describe('window defaults', () => {
  it('keeps only what makes sense', () => {
    expect(cleanWindow({ left: true, right: false, width: 1200.4, height: 800 })).toEqual({ left: true, right: false, width: 1200, height: 800 });
    expect(cleanWindow({ left: 'yes', width: 50, height: 99999 })).toBeNull();
    expect(cleanWindow({ right: false })).toEqual({ right: false });
    expect(cleanWindow(null)).toBeNull();
    expect(cleanWindow([1])).toBeNull();
  });
});
