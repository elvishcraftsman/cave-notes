// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BUILTIN_STYLES, applyPageBreaks, parseDoc, renderHtml } from '../src/index';

const flowOf = (md: string): HTMLElement => {
  const html = renderHtml(parseDoc(md), BUILTIN_STYLES[0]!, { title: 't', paged: true });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const flow = doc.querySelector<HTMLElement>('.cn-flow')!;
  applyPageBreaks(flow);
  return flow;
};
const starts = (flow: HTMLElement): string[] => Array.from(flow.querySelectorAll<HTMLElement>('*')).filter((e) => e.style.breakBefore === 'column').map((e) => e.textContent ?? '');

describe('page breaks in the paged preview', () => {
  it('start a new column with the element after the marker', () => {
    expect(starts(flowOf('One\n\n+++\n\nTwo\n\nThree'))).toEqual(['Two']);
  });
  it('look past the end of a block that the marker closes', () => {
    expect(starts(flowOf('::: center\nOne\n\n+++\n:::\n\nTwo'))).toEqual(['Two']);
  });
  it('at the very end start nothing, and two in a row leave an empty page', () => {
    expect(starts(flowOf('One\n\n+++'))).toEqual([]);
    const f = flowOf('One\n\n+++\n\n+++\n\nTwo');
    expect(f.querySelectorAll<HTMLElement>('.cn-pagebreak')[1]!.style.breakBefore).toBe('column');
    expect(starts(f).filter((t) => t === 'Two')).toHaveLength(1);
  });
});
