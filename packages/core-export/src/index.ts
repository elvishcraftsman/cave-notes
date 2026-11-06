export { parseDoc, plainText, type Block, type Inline, type ListItem, type ListKind } from './doc';
export { renderHtml, styleCss } from './html';
export { renderDocx } from './docx';
export { renderOdt } from './odt';
export { BUILTIN_NAMED, BUILTIN_STYLES, PAGE_CM, cleanNamedStyles, cleanStyleSet, resolveNamed, hasHeaderFooter, headerFooterDiffers, hfText, hfTokens, type HeaderFooter, type HeaderFooterText, type HfToken, type NamedStyle, type StyleSet, type TextStyle, type Units } from './styles';
export { lengthToCm, lengthToPt, namedStylesFromYaml, parseStyleSetsYaml, stringifyStyleSets, styleSetFromYaml, styleSetToYaml, type ParsedStyles } from './styleYaml';
import { parseDoc } from './doc';
import { renderDocx } from './docx';
import { renderHtml } from './html';
import { renderOdt } from './odt';
import type { StyleSet } from './styles';

export type ExportFormat = 'docx' | 'odt' | 'pdf' | 'html';

/** A page's Markdown as a document in `format` (pdf is made by the app from the html). */
export async function exportPage(markdown: string, format: 'docx' | 'odt' | 'html', style: StyleSet, title = ''): Promise<Uint8Array | string> {
  const blocks = parseDoc(markdown);
  if (format === 'html') return renderHtml(blocks, style, { title });
  return format === 'docx' ? renderDocx(blocks, style, { title }) : renderOdt(blocks, style, { title });
}
export { editorCss, namedDecls, namedList } from './named';
export { SLIDE_KINDS, DEFAULT_RULES, buildSlides, chooseLayout, cleanRules, ruleMatches, setSlideLayout, splitSlides, type LayoutRule, type Slide, type SlideBackground, type SlideBlock, type SlideKind } from './slides';
export * from './slideImages';
export { BUILTIN_THEMES, SLIDE_PT, cleanTheme, themeToYaml, themeWarnings, themesFromConfig, type Layout, type Region, type SlideTheme } from './slideThemes';
export { gridCells, fitSize, placeSlide, renderSlidesHtml, slideCss, type PlacedSlide, type RenderOptions } from './slidesHtml';
export { paginate, pageMetrics, pagedCss, countWords, cmToPx } from './paginate';
