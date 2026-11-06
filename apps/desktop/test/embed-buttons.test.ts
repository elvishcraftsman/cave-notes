// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderMini } from '../src/renderer/views/embedHost';

describe('automation buttons in embedded text', () => {
  it('draw as buttons and run their rule on a click', () => {
    const run = vi.fn();
    const box = document.createElement('div');
    box.append(renderMini('Do it: [=Archive now](automation:archive-old) and [plain](Page.md)', undefined, undefined, undefined, run));
    const button = box.querySelector<HTMLElement>('.cm-automation-button')!;
    expect(button.textContent).toBe('Archive now');
    expect(box.querySelectorAll('.cm-automation-button')).toHaveLength(1);
    button.click();
    expect(run).toHaveBeenCalledWith('archive-old');
  });

  it('are plain text when nothing can run them', () => {
    const box = document.createElement('div');
    box.append(renderMini('[=Go](automation:x)'));
    expect(box.querySelector('.cm-automation-button')).toBeNull();
  });
});
