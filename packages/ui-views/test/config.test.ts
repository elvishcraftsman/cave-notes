import { describe, expect, it } from 'vitest';
import { parseViewConfig } from '../src/config';

describe('relationFiles', () => {
  it('reads link and skip, and ignores anything else', () => {
    const ok = (src: string) => parseViewConfig(src);
    expect(ok('type: table\nquery: x\nrelationFiles: link')).toMatchObject({ ok: true, config: { relationFiles: 'link' } });
    expect(ok('type: table\nquery: x\nrelationFiles: Skip')).toMatchObject({ ok: true, config: { relationFiles: 'skip' } });
    const other = ok('type: table\nquery: x\nrelationFiles: maybe');
    expect(other.ok && other.config.relationFiles).toBeUndefined();
  });
});

describe('newFields', () => {
  it('lists the fields the New row asks for, separately from the columns', () => {
    const r = parseViewConfig('type: table\nquery: x\ncolumns: [title, status, due]\nnewFields: [title, priority]');
    expect(r).toMatchObject({ ok: true, config: { columns: ['title', 'status', 'due'], newFields: ['title', 'priority'] } });
    expect(parseViewConfig('type: table\nquery: x\nnewFields: title, type')).toMatchObject({ ok: true, config: { newFields: ['title', 'type'] } });
    expect(parseViewConfig('type: table\nquery: x\nnewFields: 5')).toMatchObject({ ok: false });
  });
});
