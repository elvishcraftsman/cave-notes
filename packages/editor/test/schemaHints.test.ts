import { describe, expect, it } from 'vitest';
import { RESERVED_FRONTMATTER, reservedFrontmatter, schemaTip } from '../src/yamlHints';

describe('hover text for schema attributes', () => {
  it('says what the schema knows', () => {
    const tip = schemaTip({ key: 'status', type: 'string', declared: true, schemaType: 'enum', values: ['open', 'done'], pages: 3, implies: { done: { closed: true } } });
    expect(tip).toContain('select (one choice)');
    expect(tip).toContain('Choices: open, done.');
    expect(tip).toContain('done sets closed: true');
    expect(tip).toContain('On 3 pages.');
    expect(schemaTip({ key: 'tags', type: 'string', declared: true, schemaType: 'list', list: true })).toContain('list of text');
  });

  it('explains the indicator names too', () => {
    expect(RESERVED_FRONTMATTER.indicatorText).toBeTruthy();
    expect(reservedFrontmatter('IgnoreIndicators')).toBeTruthy();
  });
});
