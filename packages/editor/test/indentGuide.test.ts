import { describe, expect, it } from 'vitest';
import { wantsIndentGuide } from '../src/indentGuide';

describe('indent guide', () => {
  it('shows for indented lines that are not list items', () => {
    expect(wantsIndentGuide('    some text')).toBe(true);
    expect(wantsIndentGuide('\tcontinued')).toBe(true);
    expect(wantsIndentGuide('no indent')).toBe(false);
    expect(wantsIndentGuide('   ')).toBe(false);
    for (const item of ['  - a', '   1. a', '   A. a', '  ii) a', '  * a', '  - [ ] task']) expect(wantsIndentGuide(item)).toBe(false);
  });
});
