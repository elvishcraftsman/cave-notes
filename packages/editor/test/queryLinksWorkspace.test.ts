import { describe, expect, it, vi } from 'vitest';
import { fillQueryLinks, formatQueryLink } from '../src/queryLinks';

describe('query links across workspaces', () => {
  const items = [
    { path: 'A.md', title: 'A', attrs: {} },
    { path: 'Tasks/B.md', title: 'B', workspace: 'Theology', attrs: {} },
  ];
  it('marks pages of another workspace and passes the workspace to open', () => {
    const el = document.createElement('span');
    const open = vi.fn();
    fillQueryLinks(el, items, null, open);
    const [a, b] = Array.from(el.querySelectorAll<HTMLElement>('.cm-querylink'));
    expect(a!.dataset.workspace).toBeUndefined();
    expect(b!.dataset.workspace).toBe('Theology');
    expect(b!.textContent).toContain('\u29c9');
    b!.dispatchEvent(new MouseEvent('mousedown', { button: 0, ctrlKey: true, bubbles: true }));
    expect(open).toHaveBeenCalledWith('Tasks/B.md', expect.anything(), 'Theology');
    a!.dispatchEvent(new MouseEvent('mousedown', { button: 0, ctrlKey: true, bubbles: true }));
    expect(open).toHaveBeenLastCalledWith('A.md', expect.anything(), undefined);
  });
  it('{workspace} fills in the workspace name', () => {
    expect(formatQueryLink(items[1]!, '{title} ({workspace})')).toBe('B (Theology)');
    expect(formatQueryLink(items[0]!, '{title}{workspace}')).toBe('A');
  });
});
