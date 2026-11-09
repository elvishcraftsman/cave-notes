/**
 * `.canvas` files (JSON Canvas, as Obsidian writes them) for the index: what a canvas points at and the words it holds,
 * in the same shape `parse` gives for a Markdown page, so links, backlinks and search treat a canvas like any page.
 *
 * File cards are links to pages or files, and they carry the exact place of the path inside the JSON text, so that
 * moving or renaming the page can rewrite them (the new name is escaped as JSON). Wikilinks written in text cards are
 * links too, but without a place in the text: they are listed and found as backlinks, and a rename leaves them as written.
 */
import { classifyDestination } from './links.js';
import { wikiLinksOf } from './parse.js';

function emptyResult(error = null) {
  return { frontmatter: { present: false, data: {}, error: null, endLine: 0, endOffset: 0 }, title: null, headings: [], links: [], error };
}

const lineOf = (text, offset) => {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
};

function makeLink(fields) {
  return { kind: 'page', syntax: 'md', embed: false, via: 'inline', raw: '', target: '', fragment: null, url: null, workspace: null, text: null, line: 1, column: 1, start: 0, end: 0, pathStart: null, pathEnd: null, ...fields };
}

/** The words of a canvas: text cards, group labels, arrow labels, and the names of files and addresses it shows. */
export function canvasPlain(raw) {
  const out = [];
  for (const n of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
    else if (n.type === 'group' && typeof n.label === 'string') out.push(n.label);
    else if (n.type === 'file' && typeof n.file === 'string') out.push(n.file.replace(/^.*\//, '').replace(/\.[^.]+$/, ''));
    else if (n.type === 'link' && typeof n.url === 'string') out.push(n.url);
  }
  for (const e of Array.isArray(raw?.edges) ? raw.edges : []) if (e && typeof e.label === 'string') out.push(e.label);
  return out.filter((s) => s.trim() !== '').join('\n');
}

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Read JSON text that is known to be valid, keeping where everything is: each object's members with the place of their
 * values, and for each string the place in the file of every character of its decoded text (an escape such as `\u00e9`
 * is one character that takes six in the file). That is what lets a link written in a card be rewritten in the file.
 */
function scanJson(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  function string() {
    const start = i;
    i++; // the opening quote
    let value = '';
    const rawAt = [];
    while (text[i] !== '"') {
      rawAt.push(i);
      if (text[i] === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          value += ESCAPES[e] ?? e;
          i += 2;
        }
      } else {
        value += text[i];
        i++;
      }
    }
    rawAt.push(i); // the closing quote: where the text ends
    i++;
    return { kind: 'string', start, end: i, value, rawAt };
  }
  function value() {
    ws();
    const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      const start = i++;
      const members = [];
      ws();
      if (text[i] === '}') i++;
      else {
        for (;;) {
          ws();
          const key = string();
          ws();
          i++; // the colon
          members.push({ key: key.value, value: value() });
          ws();
          if (text[i++] === '}') break;
        }
      }
      return { kind: 'object', start, end: i, members };
    }
    if (c === '[') {
      const start = i++;
      const items = [];
      ws();
      if (text[i] === ']') i++;
      else {
        for (;;) {
          items.push(value());
          ws();
          if (text[i++] === ']') break;
        }
      }
      return { kind: 'array', start, end: i, items };
    }
    const start = i;
    while (i < text.length && !',}] \t\r\n'.includes(text[i])) i++;
    return { kind: 'scalar', start, end: i };
  }
  return value();
}

const member = (obj, key) => obj.members.find((m) => m.key === key)?.value;
const lineStartsOf = (text) => {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
};

/** Read a canvas file as the index sees a page. `plain` is the text for search. */
export function parseCanvasFile(source) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const result = emptyResult();
  result.plain = '';
  if (text.trim() === '') return result;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    result.error = `Not valid JSON: ${e.message}`;
    return result;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    result.error = 'A canvas is a JSON object with "nodes" and "edges".';
    return result;
  }
  result.plain = canvasPlain(raw);
  const starts = lineStartsOf(text);
  const lineAt = (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
  const tree = scanJson(text);
  const nodes = member(tree, 'nodes');
  for (const n of nodes?.kind === 'array' ? nodes.items : []) {
    if (n.kind !== 'object') continue;
    const type = member(n, 'type')?.value;
    const here = lineAt(n.start);
    if (type === 'file') {
      const f = member(n, 'file');
      if (f?.kind !== 'string' || f.value === '') continue;
      const c = classifyDestination(`/${f.value}`);
      const sp = member(n, 'subpath');
      const sub = sp?.kind === 'string' && sp.value.startsWith('#') ? sp.value.slice(1) : null;
      const at = lineAt(f.start);
      result.links.push(makeLink({ kind: c.kind, syntax: 'md', via: 'inline', raw: f.value, target: c.target, fragment: sub || c.fragment, line: at.line, column: at.column, start: f.start, end: f.end, pathStart: f.start + 1, pathEnd: f.end - 1 }));
    } else if (type === 'link') {
      const u = member(n, 'url');
      if (u?.kind !== 'string') continue;
      const c = classifyDestination(u.value);
      if (c.kind === 'web') result.links.push(makeLink({ kind: 'web', raw: u.value, url: c.url, text: u.value, line: here.line, column: here.column, start: u.start, end: u.end }));
    } else if (type === 'text') {
      const t = member(n, 'text');
      if (t?.kind !== 'string') continue;
      // a link in the text of a card is found in the text as written, and put back where it is in the file
      for (const l of wikiLinksOf(t.value)) {
        const at = lineAt(t.rawAt[l.start]);
        result.links.push({
          ...l,
          line: at.line,
          column: at.column,
          start: t.rawAt[l.start],
          end: t.rawAt[l.end],
          pathStart: l.pathStart === null ? null : t.rawAt[l.pathStart],
          pathEnd: l.pathEnd === null ? null : t.rawAt[l.pathEnd],
        });
      }
    }
  }
  return result;
}

/** The text of a path as it is written inside a JSON string. */
export const jsonEscape = (s) => JSON.stringify(s).slice(1, -1);
