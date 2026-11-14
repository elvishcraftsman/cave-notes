import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import YAML from 'yaml';
import { Slugger, lineStarts, positionAt, protectSpacedDestinations, unprotectDestination } from './util.js';
import {
  classifyDestination,
  splitWorkspaceTarget,
  locateInlineDestination,
  locateDefinitionDestination,
} from './links.js';

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).freeze();

const WIKILINK = /(!?)\[\[([^[\]\n]+)\]\]/g;
const SKIP_FOR_WIKILINKS = new Set([
  'code', 'inlineCode', 'html', 'yaml', 'link', 'image', 'linkReference', 'imageReference', 'definition',
]);

function emptyResult(error = null) {
  return {
    frontmatter: { present: false, data: {}, error: null, endLine: 0, endOffset: 0 },
    title: null,
    headings: [],
    links: [],
    error,
  };
}

/** Plain text of an mdast node (images contribute their alt text). */
function plainText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  if (!node.children) return '';
  let out = '';
  for (const child of node.children) out += plainText(child);
  return out;
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * `doctrine: [[Scripture]]` is, to YAML, a list inside a list, which reads back as the plain word Scripture. In
 * frontmatter a `[[...]]` outside quotes is a page link, so it is quoted before YAML sees it. Block scalars and
 * comments are left alone.
 */
export function quoteWikilinks(yaml) {
  if (!yaml.includes('[[')) return yaml;
  const lines = yaml.split('\n');
  let blockIndent = -1;
  return lines
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (blockIndent >= 0) {
        if (line.trim() === '' || indent > blockIndent) return line;
        blockIndent = -1;
      }
      if (/(^|\s)[|>][+-]?\d*\s*(#.*)?$/.test(line) && /:\s+[|>]|^\s*-\s+[|>]/.test(line)) blockIndent = indent;
      if (!line.includes('[[')) return line;
      let out = '';
      let q = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          out += c;
          if (q === '\"' && c === '\\') out += line[++i] ?? '';
          else if (c === q) q = null;
          continue;
        }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return out + line.slice(i);
        if ((c === '\"' || c === "'") && (i === 0 || /[\s[{,:]/.test(line[i - 1]))) {
          q = c;
          out += c;
          continue;
        }
        if (c === '[' && line[i + 1] === '[') {
          const m = /^\[\[([^[\]]+)\]\]/.exec(line.slice(i));
          if (m) {
            out += `"[[${m[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}]]"`;
            i += m[0].length - 1;
            continue;
          }
        }
        out += c;
      }
      return out;
    })
    .join('\n');
}

function parseFrontmatter(node) {
  const fm = {
    present: true,
    data: {},
    error: null,
    endLine: node.position.end.line,
    endOffset: node.position.end.offset,
  };
  try {
    const value = YAML.parse(quoteWikilinks(node.value), { uniqueKeys: false });
    if (value === null || value === undefined) {
      // empty frontmatter block
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      fm.data = value;
    } else {
      fm.error = 'Frontmatter must be a YAML mapping (key: value pairs)';
    }
  } catch (e) {
    fm.error = String(e?.message ?? e).split('\n')[0];
  }
  return fm;
}

/** True if `offset` falls inside any of the sorted, non-overlapping-or-nested ranges. */
function inAnyRange(ranges, offset) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (offset < r[0]) hi = mid - 1;
    else if (offset >= r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Sort ranges and merge overlaps so binary search is valid. */
function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function makeLink(fields) {
  return {
    kind: 'page',
    syntax: 'md',
    embed: false,
    via: 'inline',
    raw: '',
    target: '',
    fragment: null,
    url: null,
    workspace: null,
    text: null,
    line: 1,
    column: 1,
    start: 0,
    end: 0,
    pathStart: null,
    pathEnd: null,
    ...fields,
  };
}

/** Build a link entry from a markdown destination. Returns null for empty destinations. */
function mdLink(text, node, { dest, via, embed, linkText, defNode }) {
  const rawUrl = node.url ?? defNode?.url ?? '';
  if (rawUrl === '') return null;
  const raw = dest ? text.slice(dest.start, dest.end) : rawUrl;
  const url = unprotectDestination(rawUrl, raw);
  const c = classifyDestination(url);
  let pathStart = null;
  let pathEnd = null;
  if (dest && c.hasPath) {
    const hash = raw.indexOf('#');
    pathStart = dest.start;
    pathEnd = hash < 0 ? dest.end : dest.start + hash;
  }
  return makeLink({
    kind: c.kind,
    workspace: c.workspace ?? null,
    syntax: 'md',
    embed,
    via,
    raw,
    target: c.target,
    fragment: c.fragment,
    url: c.url,
    text: linkText,
    line: node.position.start.line,
    column: node.position.start.column,
    start: node.position.start.offset,
    end: node.position.end.offset,
    pathStart,
    pathEnd,
  });
}

/** The wikilinks of a piece of text (no code or other syntax to skip), with places in that text. */
export function wikiLinksOf(text) {
  return wikiLinks(text, []);
}

function wikiLinks(text, skipRanges) {
  const out = [];
  if (!text.includes('[[')) return out;
  const starts = lineStarts(text);
  WIKILINK.lastIndex = 0;
  let m;
  while ((m = WIKILINK.exec(text)) !== null) {
    const start = m.index;
    if (start > 0 && text[start - 1] === '\\') continue; // escaped
    if (inAnyRange(skipRanges, start)) continue;
    const embed = m[1] === '!';
    const contentStart = start + (embed ? 3 : 2);
    const content = m[2];

    const pipe = content.indexOf('|');
    const targetPart = pipe < 0 ? content : content.slice(0, pipe);
    const alias = pipe < 0 ? null : content.slice(pipe + 1).trim().replace(/^=\s*/, '') || null;
    const hash = targetPart.indexOf('#');
    const pathRaw = hash < 0 ? targetPart : targetPart.slice(0, hash);
    const fragment = hash < 0 ? null : targetPart.slice(hash + 1).trim() || null;
    const path = pathRaw.trim();
    if (path === '' && fragment === null) continue; // [[]], [[|x]], [[#]]
    if (!embed && path.startsWith('?')) continue; // [[?query]]: pages a query finds, not a link to a page
    // `[[Page|=Label]]` is a link drawn as a button; the alias is the label after the =

    const lead = pathRaw.length - pathRaw.trimStart().length;
    const pos = positionAt(starts, start);
    // [[Workspace::Page]]: a page of another workspace is not a page here (nothing to rename, nothing to break)
    const other = embed ? null : splitWorkspaceTarget(path);
    out.push(
      makeLink({
        kind: other ? 'workspace' : 'page',
        workspace: other ? other.workspace : null,
        url: other ? `cave://${encodeURIComponent(other.workspace)}/${other.target}` : null,
        syntax: 'wiki',
        embed,
        via: 'wikilink',
        raw: content,
        target: other ? other.target : path,
        fragment,
        text: alias,
        line: pos.line,
        column: pos.column,
        start,
        end: start + m[0].length,
        pathStart: path === '' ? null : contentStart + lead,
        pathEnd: path === '' ? null : contentStart + lead + path.length,
      }),
    );
  }
  return out;
}

/** Trim punctuation that GFM does not treat as part of a bare URL. */
function trimUrl(url) {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last && '?!.,:*_~\'";'.includes(last)) u = u.slice(0, -1);
    else if (last === ')') {
      const open = (u.match(/\(/g) || []).length;
      const close = (u.match(/\)/g) || []).length;
      if (close > open) u = u.slice(0, -1);
      else break;
    } else break;
  }
  return u;
}

/**
 * Bare URLs in prose (https://..., http://..., www....). We find these ourselves instead of using
 * the GFM autolink-literal nodes, which can come back without source positions.
 */
function bareUrls(text, skipRanges) {
  const out = [];
  if (!/https?:\/\/|www\./i.test(text)) return out;
  const starts = lineStarts(text);
  const re = /(?<![\w@/.])(?:https?:\/\/|www\.)[^\s<>]+/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = trimUrl(m[0]);
    if (url.length <= (/^www\./i.test(url) ? 4 : 8)) continue;
    const start = m.index;
    if (inAnyRange(skipRanges, start)) continue;
    const full = /^www\./i.test(url) ? `http://${url}` : url;
    const c = classifyDestination(full);
    const pos = positionAt(starts, start);
    out.push(
      makeLink({
        kind: c.kind,
        syntax: 'md',
        via: 'autolink',
        raw: url,
        url: c.url,
        text: url,
        line: pos.line,
        column: pos.column,
        start,
        end: start + url.length,
      }),
    );
  }
  return out;
}

/**
 * Parse one Markdown page.
 *
 * Never throws. On a catastrophic failure the result is empty with `error` set.
 *
 * @returns {{
 *   frontmatter: { present: boolean, data: object, error: string|null, endLine: number, endOffset: number },
 *   title: string|null,          // first level-1 heading, else frontmatter `title`, else null
 *   headings: Array<{ level: number, text: string, slug: string, line: number, ord: number }>,
 *   links: Array<object>,        // see README for fields
 *   error: string|null,
 * }}
 */
export function parse(source) {
  if (typeof source !== 'string') return emptyResult('Input must be a string');
  try {
    // Offsets are reported against the original string; drop a BOM for parsing and shift back.
    const shift = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    const text = shift ? source.slice(1) : source;
    // paths with spaces in a destination are parsed as one (same offsets); `text` stays the original
    const ptext = protectSpacedDestinations(text);
    const tree = processor.parse(ptext);

    const result = emptyResult();
    const slugger = new Slugger();
    const definitions = new Map();
    const refNodes = [];
    const linkNodes = [];
    const skip = [];
    let yamlNode = null;

    // Iterative preorder walk (deeply nested input must not overflow the stack).
    const stack = [tree];
    while (stack.length) {
      const node = stack.pop();
      const pos = node.position;
      if (pos && SKIP_FOR_WIKILINKS.has(node.type)) {
        const lit = node.type === 'link' && text[pos.start.offset] !== '[' && text[pos.start.offset] !== '<';
        if (!lit) skip.push([pos.start.offset, pos.end.offset]);
      }

      switch (node.type) {
        case 'yaml':
          if (!yamlNode) yamlNode = node;
          break;
        case 'heading': {
          const t = collapse(plainText(node));
          result.headings.push({
            level: node.depth,
            text: t,
            slug: slugger.slug(t),
            line: pos?.start.line ?? 0,
            ord: result.headings.length,
          });
          break;
        }
        case 'definition':
          if (pos && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
          break;
        case 'link':
        case 'image':
          if (pos) linkNodes.push(node);
          break;
        case 'linkReference':
        case 'imageReference':
          if (pos) refNodes.push(node);
          break;
        default:
      }
      if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    // The stack walk visits children in document order, so headings are already ordered.

    if (yamlNode) result.frontmatter = parseFrontmatter(yamlNode);

    const links = [];
    for (const node of linkNodes) {
      const isImage = node.type === 'image';
      let dest = null;
      const first = text[node.position.start.offset];
      if (isImage) {
        dest = locateInlineDestination(ptext, node, true);
      } else if (first === '<') {
        dest = { start: node.position.start.offset + 1, end: node.position.end.offset - 1 };
      } else if (first === '[') {
        dest = locateInlineDestination(ptext, node, false);
      } else {
        continue; // GFM literal autolink: handled by bareUrls() for reliable offsets
      }
      const l = mdLink(text, node, {
        dest,
        via: first === '<' && !isImage ? 'autolink' : 'inline',
        embed: isImage,
        linkText: isImage ? node.alt || null : collapse(plainText(node)) || null,
      });
      if (l) links.push(l);
    }
    for (const node of refNodes) {
      const def = definitions.get(node.identifier);
      if (!def) continue;
      const isImage = node.type === 'imageReference';
      const l = mdLink(text, def, {
        dest: locateDefinitionDestination(text, def),
        via: 'reference',
        embed: isImage,
        linkText: isImage ? node.alt || null : collapse(plainText(node)) || null,
      });
      if (!l) continue;
      // Position the entry at the usage, not the definition.
      l.line = node.position.start.line;
      l.column = node.position.start.column;
      l.start = node.position.start.offset;
      l.end = node.position.end.offset;
      l.label = node.label ?? node.identifier;
      links.push(l);
    }

    const skipRanges = mergeRanges(skip);
    const wiki = wikiLinks(text, skipRanges);
    links.push(...wiki);
    links.push(...bareUrls(text, mergeRanges([...skipRanges, ...wiki.map((l) => [l.start, l.end])])));
    links.sort((a, b) => a.start - b.start || a.end - b.end);

    if (shift) {
      for (const l of links) {
        l.start += 1;
        l.end += 1;
        if (l.pathStart !== null) {
          l.pathStart += 1;
          l.pathEnd += 1;
        }
      }
      if (result.frontmatter.present) result.frontmatter.endOffset += 1;
    }
    result.links = links;

    // The title is the page's first heading, but only when it is the first thing on the page (after any frontmatter). A
    // level-1 heading partway through the text is a section, not the title.
    const firstBlock = tree.children?.find((n) => n.type !== 'yaml');
    const topLine = firstBlock && firstBlock.type === 'heading' && firstBlock.depth === 1 ? (firstBlock.position?.start.line ?? -1) : -1;
    const h1 = topLine < 0 ? undefined : result.headings.find((h) => h.level === 1 && h.line === topLine);
    const fmTitle = result.frontmatter.data?.title;
    result.title = h1 ? h1.text || null : typeof fmTitle === 'string' && fmTitle.trim() ? fmTitle.trim() : null;
    return result;
  } catch (e) {
    return emptyResult(String(e?.message ?? e));
  }
}
