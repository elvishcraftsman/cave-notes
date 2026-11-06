/**
 * Embeds ("dynamic blocks"): a one-line `![[…]]` that shows content kept somewhere else.
 *
 *   ![[Page]]               the whole page (without its frontmatter)
 *   ![[Page#Heading]]       the text under that heading, up to the next heading of the same or a higher level
 *   ![[@name]]              a template block called "name", looked up on the page's parents and then the workspace
 *   ![[@name#Heading]]      the same, only the part under a heading
 *
 * Everything here is plain text work, so the editor, the service and the tests share it.
 */
import { slugify } from './util.js';

/** @typedef {{ from: number, to: number, raw: string, target: string, heading: string | null, named: boolean }} Embed */

const EMBED = /!\[\[([^\]\n|#]+?)(?:#([^\]\n|]*))?\]\]/g;

/** Every embed in `text`, with its offsets. Code spans and fences are the caller's business (the editor skips them). @returns {Embed[]} */
export function parseEmbeds(text) {
  const out = [];
  EMBED.lastIndex = 0;
  for (let m = EMBED.exec(text); m; m = EMBED.exec(text)) {
    const target = m[1].trim();
    if (!target) continue;
    const named = target.startsWith('@');
    out.push({ from: m.index, to: m.index + m[0].length, raw: m[0], target: named ? target.slice(1).trim() : target, heading: m[2] === undefined ? null : m[2].trim(), named });
  }
  return out;
}

/** The text without a leading frontmatter block. */
export function stripFrontmatter(text) {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Heading lines of `text` as { level, text, slug, lineFrom, bodyFrom } (code fences skipped). */
function headings(text) {
  const out = [];
  let fence = null;
  let pos = 0;
  for (const line of text.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (!fence) {
      const h = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
      if (h) out.push({ level: h[1].length, text: h[2], slug: slugify(h[2]), lineFrom: pos, bodyFrom: pos + line.length + 1 });
    }
    pos += line.length + 1;
  }
  return out;
}

/**
 * The part of `text` under the heading called `heading` (matched by its text or its slug, ignoring case).
 * @returns {{ from: number, to: number, text: string } | null} offsets of the body in `text`
 */
export function findSection(text, heading) {
  const want = heading.trim().toLowerCase();
  const wantSlug = slugify(heading.trim());
  const hs = headings(text);
  const i = hs.findIndex((h) => h.text.trim().toLowerCase() === want || h.slug === wantSlug);
  if (i < 0) return null;
  const h = hs[i];
  const next = hs.slice(i + 1).find((x) => x.level <= h.level);
  const from = Math.min(h.bodyFrom, text.length);
  const to = next ? next.lineFrom : text.length;
  return { from, to, text: text.slice(from, to).replace(/^\s*\n/, '').replace(/\s+$/, '') };
}

/** What an embed shows, from the full text of the page it points at. @returns {{ ok: true, text: string } | { ok: false, error: string }} */
export function embeddedText(pageText, heading) {
  const body = stripFrontmatter(pageText);
  if (heading === null || heading === '') return { ok: true, text: body.replace(/^\s*\n/, '').replace(/\s+$/, '') };
  const s = findSection(body, heading);
  return s ? { ok: true, text: s.text } : { ok: false, error: `There is no heading “${heading}” there.` };
}

/** `pageText` with the text under `heading` (or, without one, the whole body after the frontmatter) replaced. @returns {string | null} null if the heading is missing */
export function replaceEmbedded(pageText, heading, newText) {
  const fmLen = pageText.length - stripFrontmatter(pageText).length;
  const clean = newText.replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (heading === null || heading === '') return `${pageText.slice(0, fmLen)}${clean}\n`;
  const body = pageText.slice(fmLen);
  const s = findSection(body, heading);
  if (!s) return null;
  const tail = s.to < body.length ? '\n\n' : '\n';
  return `${pageText.slice(0, fmLen)}${body.slice(0, s.from)}\n${clean}${tail}${body.slice(s.to)}`;
}
