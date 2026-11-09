/**
 * JSON Canvas 1.0 (https://jsoncanvas.org), the format of Obsidian's `.canvas` files: a list of nodes (text, file, link,
 * group) on an infinite plane and a list of edges between them.
 *
 * The file is the document. Nothing is kept that is not in it, and anything this code does not know (an extra field on a
 * node, an extra top-level key written by another program) is carried through untouched, so opening and saving a canvas
 * never loses what someone else's app put there.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';
export type NodeType = 'text' | 'file' | 'link' | 'group';
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

interface NodeBase {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `"1"`..`"6"` (red, orange, yellow, green, cyan, purple) or `#rrggbb` */
  color?: string;
  [extra: string]: unknown;
}
export interface TextNode extends NodeBase { type: 'text'; text: string }
export interface FileNode extends NodeBase { type: 'file'; file: string; subpath?: string }
export interface LinkNode extends NodeBase { type: 'link'; url: string }
export interface GroupNode extends NodeBase { type: 'group'; label?: string; background?: string; backgroundStyle?: BackgroundStyle }
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: Side;
  toEnd?: EdgeEnd;
  color?: string;
  label?: string;
  [extra: string]: unknown;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

export const NODE_TYPES: readonly NodeType[] = ['text', 'file', 'link', 'group'];
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export const emptyCanvas = (): Canvas => ({ nodes: [], edges: [] });

export type ParseResult = { ok: true; canvas: Canvas; problems: string[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Read a canvas. An empty file is an empty canvas (a new `.canvas` starts as nothing). Text that is not JSON, or JSON that is
 * not an object, is an error: the app then shows it as plain text rather than risk overwriting it. Entries that cannot be
 * drawn (a node with no position, an edge to a node that does not exist) are kept in the file and listed in `problems`.
 */
export function parseCanvas(text: string): ParseResult {
  if (text.trim() === '') return { ok: true, canvas: emptyCanvas(), problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `This is not valid JSON: ${(e as Error).message}` };
  }
  if (!isObj(raw)) return { ok: false, error: 'A canvas is a JSON object with "nodes" and "edges".' };
  const problems: string[] = [];
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const ids = new Set<string>();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!isObj(n) || typeof n.id !== 'string' || !NODE_TYPES.includes(n.type as NodeType)) {
      problems.push('A node without an id or with an unknown type was left as it is.');
      continue;
    }
    if (ids.has(n.id)) problems.push(`Two nodes have the id ${n.id}.`);
    ids.add(n.id);
    if (!isNum(n.x) || !isNum(n.y) || !isNum(n.width) || !isNum(n.height)) {
      problems.push(`Node ${n.id} has no usable position or size.`);
      continue;
    }
    nodes.push(n as CanvasNode);
  }
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.fromNode !== 'string' || typeof e.toNode !== 'string') {
      problems.push('An edge without an id or its two ends was left as it is.');
      continue;
    }
    if (!ids.has(e.fromNode) || !ids.has(e.toNode)) problems.push(`Edge ${e.id} joins a node that is not there.`);
    edges.push(e as CanvasEdge);
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (k !== 'nodes' && k !== 'edges') extra[k] = v;
  return { ok: true, canvas: { nodes, edges, ...extra }, problems };
}

/**
 * The text of a canvas, laid out the way Obsidian writes it: tabs, one node and one edge per line. A change to one node
 * then changes one line, which keeps the file readable in a diff and lets a sync merge two edits to different nodes.
 */
export function serializeCanvas(canvas: Canvas): string {
  const { nodes, edges, ...extra } = canvas;
  const lines = (list: unknown[]): string => (list.length === 0 ? '[]' : `[\n${list.map((x) => `\t\t${JSON.stringify(x)}`).join(',\n')}\n\t]`);
  const parts = [`\t"nodes":${lines(nodes)}`, `\t"edges":${lines(edges)}`];
  for (const [k, v] of Object.entries(extra)) parts.push(`\t${JSON.stringify(k)}:${JSON.stringify(v)}`);
  return `{\n${parts.join(',\n')}\n}`;
}

/** A fresh 16-digit hex id, as Obsidian makes them, that no node or edge of the canvas has. */
export function newId(canvas: Canvas, random: () => number = Math.random): string {
  const used = new Set<string>([...canvas.nodes.map((n) => n.id), ...canvas.edges.map((e) => e.id)]);
  for (;;) {
    let id = '';
    for (let i = 0; i < 16; i++) id += Math.floor(random() * 16).toString(16);
    if (!used.has(id)) return id;
  }
}
