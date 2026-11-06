import { describe, expect, it } from 'vitest';
import { noteLetter } from '../src/slides';
import { BUILTIN_THEMES, buildSlides, chooseLayout, cleanRules, cleanTheme, gridCells, placeSlide, renderSlidesHtml, setSlideLayout, splitSlides, themeWarnings, themesFromConfig } from '../src/index';

const kinds = (md: string, opts = {}) => buildSlides(md, opts).map((s) => s.blocks.map((b) => b.kind));
const layouts = (md: string, opts = {}, rules: any[] = []) => buildSlides(md, opts).map((s) => chooseLayout(s, rules));

describe('splitting a page into slides', () => {
  it('cuts at horizontal rules, skipping front matter, code, tables and empty slides', () => {
    const md = '---\npresentationTheme: Clean\n---\n\n# One\n\n---\n\n# Two\n\n```\n---\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n---\n\n# Three\n';
    const segs = splitSlides(md);
    expect(segs).toHaveLength(3);
    expect(segs.map((s) => s.text.trim().split('\n')[0])).toEqual(['# One', '# Two', '# Three']);
  });
});

describe('what the blocks of a slide are', () => {
  it('sorts headings, text, images and captions', () => {
    expect(kinds('# Title\n\n## Sub\n')).toEqual([['title', 'subtitle']]);
    expect(kinds('# T\n\n- a\n- b\n\nA paragraph\n')).toEqual([['title', 'text']]);
    const size = (u: string) => (u === 'tall.png' ? { w: 100, h: 200 } : { w: 200, h: 100 });
    expect(kinds('![a](wide.png)\n\n*A caption*\n\n![b](tall.png)\n', { imageSize: size })).toEqual([['landscape', 'caption', 'portrait']]);
  });
  it('reads left and right from blocks and from {.left} after an image', () => {
    const s = buildSlides('::: left\nL text\n:::\n\n::: right\nR text\n:::\n\n![x](a.png){.right}\n')[0]!;
    expect(s.blocks.map((b) => `${b.kind}:${b.side}`)).toEqual(['text-left:left', 'text-right:right', 'landscape:right']);
  });
});

describe('choosing a layout', () => {
  it('uses the built-in rules', () => {
    expect(layouts('# T\n\n## S\n')).toEqual(['title']);
    expect(layouts('# T\n')).toEqual(['section']);
    expect(layouts('# T\n\n- a\n')).toEqual(['content']);
    expect(layouts('# T\n\ntext\n\n![i](a.png)\n')).toEqual(['image-right']);
    expect(layouts('# T\n\ntext\n\n![i](a.png){.left}\n')).toEqual(['image-left']);
    expect(layouts('# T\n\n::: left\nA\n:::\n\n::: right\nB\n:::\n')).toEqual(['compare']);
    expect(layouts('# T\n\n![i](a.png)\n')).toEqual(['picture']);
    expect(layouts('# T\n\n![i](a.png)\n\n![j](b.png)\n\n![k](c.png)\n')).toEqual(['gallery']);
  });
  it('lets your own rules and a manual layout win', () => {
    const rules = cleanRules([{ when: ['title', 'text+'], layout: 'mine' }, { when: 'bad', layout: 'not a name!' }]);
    expect(rules).toHaveLength(1);
    expect(layouts('# T\n\n- a\n', {}, rules)).toEqual(['mine']);
    expect(layouts(':::: {layout=compare}\n# T\n\n- a\n::::\n')).toEqual(['compare']);
  });
  it('changes a slide\'s layout by wrapping it, and takes the wrapper away again', () => {
    const md = '# One\n\n- a\n\n---\n\n# Two\n\n- b\n';
    const once = setSlideLayout(md, 1, 'compare');
    expect(once).toContain(':::: {layout=compare}\n# Two');
    expect(layouts(once)).toEqual(['content', 'compare']);
    const twice = setSlideLayout(once, 1, 'picture');
    expect(twice.match(/layout=/g)).toHaveLength(1);
    expect(setSlideLayout(twice, 1, null)).toBe(md);
  });
});

describe('themes', () => {
  it('has built-in themes with the standard layouts', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(4);
    for (const t of BUILTIN_THEMES) for (const l of ['title', 'section', 'content', 'compare', 'image-left', 'image-right', 'picture', 'gallery']) expect(t.layouts[l]).toBeTruthy();
  });
  it('lets you tweak one region, or define a layout of your own', () => {
    const [t] = themesFromConfig({
      Mine: { base: 'Midnight', accent: '#ff0000', layouts: { content: { regions: { body: { size: 40 } } }, trio: { regions: { title: { at: [5, 5, 90, 15] }, a: { at: [5, 25, 28, 60], holds: ['text'] } } } } },
    }).filter((x) => x.name === 'Mine');
    expect(t!.accent).toBe('#ff0000');
    expect(t!.background).toBe('#1b2230');
    expect(t!.layouts.content!.regions.body!.sizePt).toBe(40);
    expect(t!.layouts.content!.regions.body!.at).toEqual([10, 34, 80, 50]);
    expect(Object.keys(t!.layouts.trio!.regions)).toEqual(['title', 'a']);
  });
  it('warns about css that will not carry over', () => {
    const t = cleanTheme('X', { css: '.slide{}', layouts: { content: { regions: { body: { css: 'border:1px solid red' } } } } });
    expect(themeWarnings(t)).toHaveLength(2);
    expect(themeWarnings(BUILTIN_THEMES[0]!)).toEqual([]);
  });
});

describe('placing and drawing slides', () => {
  const theme = BUILTIN_THEMES[0]!;
  it('puts blocks in the boxes of the layout and reports what does not fit', () => {
    const p = placeSlide(buildSlides('# T\n\n## S\n\ntext\n')[0]!, theme);
    expect(p.layoutName).toBe('content');
    expect(p.regions.find((r) => r.name === 'title')!.blocks).toHaveLength(1);
    const q = placeSlide(buildSlides(':::: {layout=picture}\n# T\n\n## S\n\n![i](a.png)\n::::\n')[0]!, theme);
    expect(q.dropped.map((b) => b.kind)).toEqual(['subtitle']);
  });
  it('arranges several images to fill the box', () => {
    const cells = gridCells([1.5, 1.5, 1.5, 1.5], 800, 400);
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((c) => Math.round(c.y))).size).toBe(2); // 2 x 2 fills more of the box than one row of four
    expect(gridCells([1.5, 1.5, 1.5], 800, 400).map((c) => Math.round(c.x))).toEqual([0, 51, 25]); // a short last row is centred
    expect(gridCells([1], 800, 400)[0]).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
  it('writes a page with every slide, sized in points, with images resolved', () => {
    const { html, placed } = renderSlidesHtml('# Hi\n\n- one\n\n![p](pic.png)\n\n---\n\n# Bye\n', theme, { imageSrc: (u) => `x://${u}` });
    expect(placed).toHaveLength(2);
    expect(html.match(/<section class="slide/g)).toHaveLength(2);
    expect(html).toContain('x://pic.png');
    expect(html).toContain('@page { size: 960pt 540pt');
    expect(html).toContain('layout-image-right');
  });
});

describe('implicit slide breaks', () => {
  it('a heading after something that is not a heading starts a new slide', () => {
    const md = '# One\n\n## Sub\n\ntext\n\n# Two\n\n- a\n\n## Three\n\ntext\n';
    const segs = splitSlides(md);
    expect(segs.map((s) => s.text.trim().split('\n')[0])).toEqual(['# One', '# Two', '## Three']);
    expect(kinds(md)).toEqual([['title', 'subtitle', 'text'], ['title', 'text'], ['title', 'text']]);
  });
  it('does not cut inside a block marked left or right, a wrapped slide, or code', () => {
    expect(splitSlides('# A\n\n::: left\ntext\n\n## Inside\n:::\n').length).toBe(1);
    expect(splitSlides('# A\n\n```\n# not a heading\n```\n').length).toBe(1);
  });
});

describe('presenter notes', () => {
  const md = '# Title\n\nA point[^note] and another[^note2] and a plain one[^1].\n\n[^note]: Say this first.\n[^note2]: Then this.\n[^1]: A real footnote.\n\n---\n\nNext slide[^note3].\n\n[^note3]: Only for the second.\n';
  it('letters the notes of each slide and keeps them out of the text', () => {
    const slides = buildSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0]!.notes.map((n) => n.letter)).toEqual(['a', 'b']);
    expect(slides[1]!.notes.map((n) => n.letter)).toEqual(['a']);
    expect(slides[0]!.blocks.map((b) => b.kind)).toEqual(['title', 'text']);
  });
  it('shows the letters only in the presenter\'s page, and without taking room', () => {
    const { html, presenter } = renderSlidesHtml(md, BUILTIN_THEMES[0]!);
    expect(html).not.toContain('nref"><sup>');
    expect(presenter).toContain('nref\\">\\u003csup>a');
    expect(presenter).toContain('Say this first.');
    expect(presenter).toContain('.deck .nref { display: inline-block; width: 0');
  });
  it('counts a, b, … z, aa, ab', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(noteLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab', 'az', 'ba']);
  });
});
