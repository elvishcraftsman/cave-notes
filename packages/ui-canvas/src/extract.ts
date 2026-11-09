import type { Canvas } from './model';

/** What a canvas holds that the rest of the app cares about: words to search for, and the things it points at. */

/** The words of a canvas for the search index: text nodes, group labels, edge labels, and the names of files and addresses it shows. */
export function canvasText(canvas: Canvas): string {
  const out: string[] = [];
  for (const n of canvas.nodes) {
    if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
    else if (n.type === 'group' && typeof n.label === 'string') out.push(n.label);
    else if (n.type === 'file' && typeof n.file === 'string') out.push(n.file.replace(/^.*\//, '').replace(/\.[^.]+$/, ''));
    else if (n.type === 'link' && typeof n.url === 'string') out.push(n.url);
  }
  for (const e of canvas.edges) if (typeof e.label === 'string') out.push(e.label);
  return out.filter((s) => s.trim() !== '').join('\n');
}

export interface CanvasLinks {
  /** workspace paths of the files shown by file nodes, each with its `#heading` when it has one */
  files: Array<{ file: string; subpath?: string }>;
  /** web addresses of link nodes */
  urls: string[];
  /** the targets of `[[wikilinks]]` written in text nodes (without the `|alias`) */
  wikilinks: string[];
}

const WIKILINK = /\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]/g;

/** The pages, files and addresses a canvas points at. */
export function canvasLinks(canvas: Canvas): CanvasLinks {
  const files: CanvasLinks['files'] = [];
  const urls: string[] = [];
  const wikilinks: string[] = [];
  for (const n of canvas.nodes) {
    if (n.type === 'file' && typeof n.file === 'string') files.push({ file: n.file, ...(typeof n.subpath === 'string' && n.subpath ? { subpath: n.subpath } : {}) });
    else if (n.type === 'link' && typeof n.url === 'string') urls.push(n.url);
    else if (n.type === 'text' && typeof n.text === 'string') for (const m of n.text.matchAll(WIKILINK)) wikilinks.push((m[1] as string).trim());
  }
  return { files, urls, wikilinks };
}

/**
 * Follow a rename or move: file nodes that show `from` show `to` instead. A folder (`from` ending in a slash, or any path
 * that is the start of another) moves everything under it. Returns the same canvas when nothing changed.
 */
export function renameFiles(canvas: Canvas, from: string, to: string): Canvas {
  let changed = false;
  const nodes = canvas.nodes.map((n) => {
    if (n.type !== 'file' || typeof n.file !== 'string') return n;
    let file: string | null = null;
    if (n.file === from) file = to;
    else if (n.file.startsWith(`${from.replace(/\/$/, '')}/`)) file = to.replace(/\/$/, '') + n.file.slice(from.replace(/\/$/, '').length);
    if (file === null) return n;
    changed = true;
    return { ...n, file };
  });
  return changed ? { ...canvas, nodes } : canvas;
}
