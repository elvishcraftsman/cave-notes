/**
 * Cheap Markdown -> searchable text. Goal: good snippets and no syntax noise in matches,
 * not a faithful renderer. Keeps code content (people search for identifiers).
 */
export function toPlain(markdown) {
  return markdown
    .replace(/!?\[\[([^\]|#\n]*)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target, alias) => alias || target) // wikilinks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](dest) / ![alt](src)
    .replace(/^\s{0,3}\[[^\]]+\]:\s+\S+.*$/gm, '') // reference definitions
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s{0,3}(?:>\s?)+/gm, '') // blockquotes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '') // list markers
    .replace(/^(?:```|~~~).*$/gm, '') // fence lines
    .replace(/[*_~`]+/g, '') // emphasis and code marks
    .replace(/<[^>\n]+>/g, ' ') // html tags
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A short excerpt of `body` around the first match of any of `words`, with matches wrapped in
 * the given marker characters. Matching is by word prefix (a cheap stand-in for stemming).
 * Returns null when there is nothing to show.
 */
export function makeSnippet(body, words, startMark, endMark, width = 150) {
  if (!body) return null;
  const text = body.length > 20000 ? body.slice(0, 20000) : body;
  const prefixes = [...new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length >= 2))].map((w) =>
    escapeRe(w.length <= 3 ? w : w.slice(0, Math.max(3, w.length - 2))),
  );
  let re = null;
  if (prefixes.length) re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${prefixes.join('|')})[\\p{L}\\p{N}]*`, 'giu');
  const first = re ? re.exec(text) : null;

  let start = first ? Math.max(0, first.index - 40) : 0;
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < first.index) start = sp + 1;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > start + width / 2) end = sp;
  }
  let excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (re) {
    re.lastIndex = 0;
    excerpt = excerpt.replace(re, (m) => `${startMark}${m}${endMark}`);
  }
  return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`;
}
