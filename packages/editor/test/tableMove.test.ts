import { describe, expect, it } from 'vitest';
import { type TableModel, dropIndex, moveColIn, moveRowIn } from '../src/index';

const model = (): TableModel => ({
  head: ['A', 'B', 'C'],
  align: ['left', null, 'right'],
  rows: [['a1', 'b1', 'c1'], ['a2', 'b2', 'c2'], ['a3', 'b3', 'c3']],
  widths: [100, null, 300],
  heights: [30, 40, null, 60],
});

describe('moving table rows and columns', () => {
  it('moves a row with its height, and never the header', () => {
    const m = model();
    moveRowIn(m, 1, 3);
    expect(m.rows.map((r) => r[0])).toEqual(['a2', 'a3', 'a1']);
    expect(m.heights).toEqual([30, null, 60, 40]);
    moveRowIn(m, 0, 2);
    moveRowIn(m, 2, 0);
    expect(m.rows.map((r) => r[0])).toEqual(['a2', 'a3', 'a1']);
  });
  it('moves a column with its header, width and alignment', () => {
    const m = model();
    moveColIn(m, 0, 2);
    expect(m.head).toEqual(['B', 'C', 'A']);
    expect(m.align).toEqual([null, 'right', 'left']);
    expect(m.widths).toEqual([null, 300, 100]);
    expect(m.rows[0]).toEqual(['b1', 'c1', 'a1']);
  });
  it('finds where a drop ends up', () => {
    expect(dropIndex(1, 3)).toBe(2);
    expect(dropIndex(2, 0)).toBe(0);
    expect(dropIndex(2, 2)).toBe(2);
    expect(dropIndex(2, 3)).toBe(2);
  });
});
