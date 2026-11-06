import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, buildSlides, cleanTheme, cropFractions, fitImage, formatImageAttrs, imagesInLines, parseImageAttrs, placeSlide, renderSlidesHtml, slidePx, withImageAttrs } from '../src/index';

const theme = BUILTIN_THEMES[0]!;
const size = (w: number, h: number) => () => ({ w, h });
const slide169 = slidePx(960, 540);

describe('picture settings', () => {
  it('reads and writes them', () => {
    const a = parseImageAttrs('.right crop="[10%, 0, 5%, 2mm]" width=40% fit=tall dim=30%');
    expect(a.side).toBe('right');
    expect(a.crop?.map((l) => `${l.v}${l.unit}`)).toEqual(['10%', '0px', '5%', '2mm']);
    expect(a.width).toEqual({ v: 40, unit: '%' });
    expect(a.fit).toBe('tall');
    expect(parseImageAttrs('crop=[1,2,3]').crop).toBeUndefined(); // needs four
    expect(formatImageAttrs(a)).toBe('.right crop="[10%, 0, 5%, 2mm]" width=40% fit=tall dim=30%');
  });

  it('turns crop lengths into fractions of the picture', () => {
    const c = cropFractions(parseImageAttrs('crop="[10%, 0, 0.5in, 0]"').crop, { w: 960, h: 600 });
    expect(c.l).toBeCloseTo(0.1);
    expect(c.r).toBeCloseTo(48 / 960);
    expect(cropFractions(parseImageAttrs('crop="[0, 0, 0, 1in]"').crop, null).b).toBe(0); // no size: cannot say
  });
});

describe('how big a picture is', () => {
  it('lets a landscape picture take 55% of the width', () => {
    const f = fitImage(1.5, {}, slide169, 55);
    expect(f.w).toBeCloseTo(55);
    expect(f.canToggle).toBe(true);
    expect(fitImage(1.5, { fit: 'tall' }, slide169, 55).h).toBeCloseTo(100);
  });
  it('scales a portrait picture up to 55% of the width or the whole height', () => {
    const f = fitImage(0.5, {}, slide169, 55); // 1:2
    expect(f.h).toBeCloseTo(100);
    expect(f.w).toBeCloseTo(((720 * 0.5) / 1280) * 100); // 28%
    expect(f.canToggle).toBe(false); // it is already as tall as the slide
    const squat = fitImage(0.9, {}, slide169, 55);
    expect(squat.h).toBeCloseTo(100); // 704 ÷ 0.9 = 782 px is taller than the slide, so the height comes first
    expect(squat.w).toBeCloseTo((720 * 0.9 / 1280) * 100);
  });
  it('lets width and height of its own win', () => {
    const f = fitImage(2, { width: { v: 50, unit: '%' } }, slide169, 55);
    expect(f.w).toBeCloseTo(50);
    expect(f.mode).toBe('set');
    expect(f.canToggle).toBe(false);
  });
});

describe('pictures in a slide', () => {
  const md = '---\npresentationTheme: Clean\n---\n# Heading\n\nConsumerism and comfort![pexels.jpg](<pexels.jpg>)\n';

  it('puts a picture at the end of a line of text on the right of it', () => {
    const [s] = buildSlides(md, { imageSize: size(1500, 1000) });
    expect(s!.blocks.map((b) => `${b.kind}${b.side ? ':' + b.side : ''}`)).toEqual(['title', 'text', 'landscape:right']);
    const placed = placeSlide(s!, theme);
    expect(placed.layoutName).toBe('image-right');
    expect(placed.imageFit?.box.w).toBeCloseTo(55);
    expect(placed.imageFit?.box.x).toBeCloseTo(45);
    // text and title stop before the picture
    for (const r of placed.regions.filter((r) => r.name === 'body' || r.name === 'title')) expect(r.region.at[0] + r.region.at[2]).toBeLessThanOrEqual(45);
  });

  it('puts a picture at the start on the left, and leaves one in the middle of a sentence alone', () => {
    const [a] = buildSlides('# T\n\n![x](a.jpg) Some words here\n', { imageSize: size(1500, 1000) });
    expect(a!.blocks.map((b) => b.kind + (b.side ? ':' + b.side : ''))).toEqual(['title', 'landscape:left', 'text']);
    const [b] = buildSlides('# T\n\nBefore ![x](a.jpg) after\n');
    expect(b!.blocks.map((x) => x.kind)).toEqual(['title', 'text']);
  });

  it('does not split a picture in a list item', () => {
    const [s] = buildSlides('# T\n\n- item ![x](a.jpg)\n');
    expect(s!.blocks.map((x) => x.kind)).toEqual(['title', 'text']);
  });

  it('crops and sizes from what is written after the picture', () => {
    const html = renderSlidesHtml('# T\n\nText![p](p.jpg){crop="[10%, 0, 10%, 0]"}\n', theme, { imageSrc: (u) => u, imageSize: size(1000, 1000) }).html;
    expect(html).toContain('width:125%'); // 100 ÷ 0.8
    expect(html).toContain('left:-12.5%');
  });

  it('uses the theme\'s picture width', () => {
    const t = cleanTheme('Narrow', { imageWidth: 40 }, theme);
    const [s] = buildSlides(md, { imageSize: size(1500, 1000) });
    expect(placeSlide(s!, t).imageFit?.box.w).toBeCloseTo(40);
  });

  it('makes a background picture of one marked `.background`, and no block of it', () => {
    const [s] = buildSlides('# T\n\n![sky](sky.jpg){.background dim=40%}\n\nText\n', { imageSize: size(1500, 1000) });
    expect(s!.background?.url).toBe('sky.jpg');
    expect(s!.blocks.map((b) => b.kind)).toEqual(['title', 'text']);
    const html = renderSlidesHtml('# T\n\n![sky](sky.jpg){.background dim=40%}\n\nText\n', theme, { imageSrc: (u) => u }).html;
    expect(html).toContain('class="bgimg"');
    expect(html).toContain('rgba(0,0,0,0.4)');
  });
});

describe('rewriting a picture\'s settings', () => {
  const md = 'one\n\n```\n![no](code.png)\n```\n\nText![a](<my pic.jpg>){.left foo=bar}\n![b](b.png)\n';
  it('finds the pictures, but not those in code', () => {
    const refs = imagesInLines(md, 1, 20);
    expect(refs.map((r) => r.url)).toEqual(['my pic.jpg', 'b.png']);
  });
  it('changes one and keeps the rest', () => {
    const refs = imagesInLines(md, 1, 20);
    const out = withImageAttrs(md, refs[0]!, { fit: 'tall', crop: [{ v: 5, unit: '%' }, { v: 0, unit: '%' }, { v: 0, unit: '%' }, { v: 0, unit: '%' }] });
    expect(out).toContain('![a](<my pic.jpg>){.left crop="[5%, 0, 0, 0]" fit=tall foo=bar}');
    const back = withImageAttrs(out, imagesInLines(out, 1, 20)[0]!, { fit: null, crop: null });
    expect(back).toContain('![a](<my pic.jpg>){.left foo=bar}');
    expect(withImageAttrs(md, refs[1]!, { background: true })).toContain('![b](b.png){.background}');
  });
});
