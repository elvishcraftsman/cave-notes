import { describe, expect, it } from 'vitest';
import { findExpressions } from '../src/index';

describe('findExpressions', () => {
  it('finds plain, other-page and link expressions', () => {
    const t = 'A ${this.writing} b ${[[Some Page]].status} c [[${this.writing}|={title}]]';
    const f = findExpressions(t);
    expect(f.map((x) => [x.expr, x.link, x.label])).toEqual([
      ['this.writing', false, null],
      ['[[Some Page]].status', false, null],
      ['this.writing', true, '={title}'],
    ]);
    expect(t.slice(f[2]!.index, f[2]!.index + f[2]!.length)).toBe('[[${this.writing}|={title}]]');
  });
  it('ignores text without an expression', () => {
    expect(findExpressions('cost is $5 and {x}')).toEqual([]);
  });
});

import { drawExpression, type ExpressionResult } from '../src/index';

describe('drawExpression', () => {
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const hostWith = (result: ExpressionResult) => {
    const opened: string[] = [];
    let cb: () => void = () => {};
    return {
      opened,
      refresh: () => cb(),
      host: {
        expression: async () => result,
        watch: (f: () => void) => {
          cb = f;
          f();
          return () => {};
        },
        openPage: (p: string) => void opened.push(p),
      },
    };
  };

  it('shows plain text for a value that is not a page', async () => {
    const el = document.createElement('span');
    drawExpression(el, hostWith({ ok: true, values: [{ text: 'On Grace' }] }).host, 'this.writing', false, null);
    await settle();
    expect(el.textContent).toBe('On Grace');
    expect(el.classList.contains('cm-expression')).toBe(true);
  });

  it('shows a page as a link, and as a button when the label starts with =', async () => {
    const el = document.createElement('span');
    const h = hostWith({ ok: true, values: [{ text: 'Grace', path: 'Grace.md', title: 'Grace' }] });
    drawExpression(el, h.host, 'this.writing', true, '={title}');
    await settle();
    expect(el.textContent).toContain('Grace');
    expect(el.querySelector('button, .cm-querylinks-button, a, .cm-wikilink')).not.toBeNull();
  });

  it('says why a value cannot be worked out', async () => {
    const el = document.createElement('span');
    drawExpression(el, hostWith({ ok: false, error: 'No page called “Nope”.' }).host, '[[Nope]].x', false, null);
    await settle();
    expect(el.textContent).toBe('No page called “Nope”.');
    expect(el.classList.contains('cm-expression-bad')).toBe(true);
  });

  it('is worked out again when the host says pages changed', async () => {
    const el = document.createElement('span');
    let n = 0;
    let cb: () => void = () => {};
    drawExpression(
      el,
      { expression: async () => ({ ok: true, values: [{ text: `v${++n}` }] }), watch: (f) => ((cb = f), f(), () => {}) },
      'this.x',
      false,
      null,
    );
    await settle();
    expect(el.textContent).toBe('v1');
    cb();
    await settle();
    expect(el.textContent).toBe('v2');
  });
});
