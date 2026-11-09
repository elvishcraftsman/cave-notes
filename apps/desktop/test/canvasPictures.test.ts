// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMini } from '../src/renderer/views/embedHost';

const draw = (text: string, images?: (h: string) => string | null): HTMLElement => {
  const box = document.createElement('div');
  box.append(renderMini(text, undefined, undefined, undefined, undefined, images));
  return box;
};

it('a picture in the text of a card is drawn, found by its path', () => {
  const seen: string[] = [];
  const box = draw('Look:\n\n![The map](</Pics/my map.png>) and ![](pic.jpg)', (h) => (seen.push(h), `asset://x/${encodeURIComponent(h)}`));
  const imgs = [...box.querySelectorAll('img')];
  expect(imgs).toHaveLength(2);
  expect(imgs[0]!.alt).toBe('The map');
  expect(seen).toEqual(['/Pics/my map.png', 'pic.jpg']);
});

it('a picture that cannot be found shows its description, and links still work', () => {
  const box = draw('![The map](gone.png) and [a link](https://example.org)', () => null);
  expect(box.querySelector('img')).toBeNull();
  expect(box.textContent).toContain('The map');
  expect(box.querySelector<HTMLElement>('[data-url]')?.dataset.url).toBe('https://example.org');
});
