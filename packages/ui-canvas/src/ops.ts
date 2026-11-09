import { type Canvas, type CanvasEdge, type CanvasNode, type FileNode, type GroupNode, type LinkNode, type Side, type TextNode, newId } from './model';

/**
 * Editing a canvas: every function takes a canvas and returns a new one (the old one is never changed), so the editor can
 * hand each result to the text editor as one undoable change. Nothing here knows about the screen.
 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 40;
export const DEFAULT_TEXT_SIZE = { width: 250, height: 60 } as const;
/** A page card starts small: its name and where it is. Expanded it shows the page itself. */
export const DEFAULT_FILE_SIZE = { width: 260, height: 72 } as const;
export const EXPANDED_FILE_SIZE = { width: 420, height: 380 } as const;
export const IMAGE_FILE_SIZE = { width: 320, height: 220 } as const;
/** A file card at least this tall shows more than its name. */
export const EXPANDED_FROM = 140;
export const isExpanded = (n: { height: number }): boolean => n.height >= EXPANDED_FROM;
export const DEFAULT_LINK_SIZE = { width: 250, height: 100 } as const;
export const DEFAULT_GROUP_SIZE = { width: 400, height: 300 } as const;

// ---------------------------------------------------------------- looks

/** Shapes of a card (a field `shape` that other programs ignore): the default is `rounded`. */
export const SHAPES = ['rounded', 'rectangle', 'pill', 'ellipse', 'diamond'] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_NAMES: Readonly<Record<Shape, string>> = { rounded: 'Rounded', rectangle: 'Square corners', pill: 'Pill', ellipse: 'Ellipse', diamond: 'Diamond' };
export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'none'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export const shapeOf = (n: Record<string, unknown>): Shape => ((SHAPES as readonly string[]).includes(n.shape as string) ? (n.shape as Shape) : 'rounded');
export const borderStyleOf = (n: Record<string, unknown>): BorderStyle | null => ((BORDER_STYLES as readonly string[]).includes(n.borderStyle as string) ? (n.borderStyle as BorderStyle) : null);

/** What an arrow shows at its two ends. A missing `toEnd` is an arrow and a missing `fromEnd` is none (JSON Canvas's defaults). */
export function arrowEnds(e: { fromEnd?: unknown; toEnd?: unknown }): { from: boolean; to: boolean } {
  return { from: e.fromEnd === 'arrow', to: (e.toEnd ?? 'arrow') === 'arrow' };
}

/** The four looks an arrow cycles through: at the far end, at the near end, at both, at neither. */
const ARROW_CYCLE: ReadonlyArray<{ from: boolean; to: boolean }> = [{ from: false, to: true }, { from: true, to: false }, { from: true, to: true }, { from: false, to: false }];

/** Give the arrows the next arrowhead choice after the one the first of them has; all end up alike. */
export function cycleArrows(canvas: Canvas, ids: readonly string[]): Canvas {
  const first = canvas.edges.find((e) => ids.includes(e.id));
  if (!first) return canvas;
  const cur = arrowEnds(first);
  const at = ARROW_CYCLE.findIndex((a) => a.from === cur.from && a.to === cur.to);
  const next = ARROW_CYCLE[(at + 1) % ARROW_CYCLE.length] as { from: boolean; to: boolean };
  let out = canvas;
  for (const e of canvas.edges) if (ids.includes(e.id)) out = updateEdge(out, e.id, { fromEnd: next.from ? 'arrow' : undefined, toEnd: next.to ? undefined : 'none' });
  return out;
}

// ---------------------------------------------------------------- colours

/** The six preset colours (`"1"` to `"6"`), the ones Obsidian uses. */
export const PRESET_COLORS: Readonly<Record<string, string>> = { '1': '#fb464c', '2': '#e9973f', '3': '#e0de71', '4': '#44cf6e', '5': '#53dfdd', '6': '#a882ff' };
export const PRESET_NAMES: Readonly<Record<string, string>> = { '1': 'Red', '2': 'Orange', '3': 'Yellow', '4': 'Green', '5': 'Cyan', '6': 'Purple' };

/** A colour value of a node or edge as CSS, or null when there is none or it is not a colour. */
export function cssColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  if (color in PRESET_COLORS) return PRESET_COLORS[color] ?? null;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null;
}

// ---------------------------------------------------------------- geometry

const rectOf = (n: Rect): Rect => ({ x: n.x, y: n.y, width: n.width, height: n.height });

/** The box that holds all of the nodes, or null when there are none. */
export function boundsOf(nodes: readonly Rect[]): Rect | null {
  if (nodes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.width);
    y1 = Math.max(y1, n.y + n.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The middle of one side of a node: where an edge joins it. */
export function anchor(n: Rect, side: Side): Point {
  switch (side) {
    case 'top': return { x: n.x + n.width / 2, y: n.y };
    case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left': return { x: n.x, y: n.y + n.height / 2 };
    default: return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

const OUT: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** The sides two nodes are best joined at: facing each other along the longer way between their centres. */
export function sidesBetween(a: Rect, b: Rect): { from: Side; to: Side } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

export interface EdgeGeometry {
  from: Point & { side: Side };
  to: Point & { side: Side };
  /** the SVG path of the curve */
  d: string;
  /** where the label sits: the middle of the curve */
  mid: Point;
}

/** Where an edge runs: the two anchor points and a smooth curve leaving each side at right angles. */
export function edgeGeometry(a: Rect, fromSide: Side, b: Rect, toSide: Side): EdgeGeometry {
  const p = anchor(a, fromSide);
  const q = anchor(b, toSide);
  const dist = Math.hypot(q.x - p.x, q.y - p.y);
  const reach = Math.min(200, Math.max(40, dist / 2));
  const c1 = { x: p.x + OUT[fromSide].x * reach, y: p.y + OUT[fromSide].y * reach };
  const c2 = { x: q.x + OUT[toSide].x * reach, y: q.y + OUT[toSide].y * reach };
  const mid = { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 };
  return { from: { ...p, side: fromSide }, to: { ...q, side: toSide }, d: `M ${p.x} ${p.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${q.x} ${q.y}`, mid };
}

/** Does the point lie inside the rectangle? */
export const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Do two rectangles overlap? */
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The nodes that sit wholly inside a group (a group holds nothing but what is drawn within its box). */
export function membersOf(canvas: Canvas, groupId: string): CanvasNode[] {
  const g = canvas.nodes.find((n) => n.id === groupId && n.type === 'group');
  if (!g) return [];
  return canvas.nodes.filter((n) => n.id !== groupId && inside(g, n));
}

export const nodeById = (canvas: Canvas, id: string): CanvasNode | undefined => canvas.nodes.find((n) => n.id === id);

/** Round to a grid (a grid of 0 or less leaves the number alone). */
export const snap = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);

// ---------------------------------------------------------------- adding

const place = (at: Point, size: { width: number; height: number }, grid: number): Rect => ({ x: snap(at.x - size.width / 2, grid), y: snap(at.y - size.height / 2, grid), ...size });

/** Add a text node centred on a point. */
export function addTextNode(canvas: Canvas, at: Point, text = '', opts: { grid?: number; random?: () => number } = {}): { canvas: Canvas; id: string } {
  const id = newId(canvas, opts.random);
  const node: TextNode = { id, type: 'text', ...place(at, DEFAULT_TEXT_SIZE, opts.grid ?? 0), text };
  return { canvas: { ...canvas, nodes: [...canvas.nodes, node] }, id };
}

/** Add a node that shows a file of the workspace (a page, an image, a PDF), by its workspace path. A picture starts bigger, since there is little else to see. */
export function addFileNode(canvas: Canvas, at: Point, file: string, opts: { subpath?: string; grid?: number; random?: () => number } = {}): { canvas: Canvas; id: string } {
  const id = newId(canvas, opts.random);
  const size = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file) ? IMAGE_FILE_SIZE : DEFAULT_FILE_SIZE;
  const node: FileNode = { id, type: 'file', ...place(at, size, opts.grid ?? 0), file, ...(opts.subpath ? { subpath: opts.subpath } : {}) };
  return { canvas: { ...canvas, nodes: [...canvas.nodes, node] }, id };
}

/** Add a node that links to a web address. */
export function addLinkNode(canvas: Canvas, at: Point, url: string, opts: { grid?: number; random?: () => number } = {}): { canvas: Canvas; id: string } {
  const id = newId(canvas, opts.random);
  const node: LinkNode = { id, type: 'link', ...place(at, DEFAULT_LINK_SIZE, opts.grid ?? 0), url };
  return { canvas: { ...canvas, nodes: [...canvas.nodes, node] }, id };
}

/**
 * Add a group. With `around`, the group is made to fit those nodes (with a margin) and is put *before* them, so it is drawn
 * underneath; without, it is an empty box centred on the point.
 */
export function addGroup(canvas: Canvas, at: Point, opts: { around?: readonly string[]; label?: string; margin?: number; grid?: number; random?: () => number } = {}): { canvas: Canvas; id: string } {
  const id = newId(canvas, opts.random);
  const around = canvas.nodes.filter((n) => opts.around?.includes(n.id));
  const box = boundsOf(around);
  const m = opts.margin ?? 20;
  const rect = box ? { x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m } : place(at, DEFAULT_GROUP_SIZE, opts.grid ?? 0);
  const group: GroupNode = { id, type: 'group', ...rect, ...(opts.label ? { label: opts.label } : {}) };
  // a group goes beneath what it holds: in front of nothing but the nodes that come before the first one it surrounds
  const first = canvas.nodes.findIndex((n) => around.includes(n));
  const nodes = [...canvas.nodes];
  nodes.splice(first >= 0 ? first : nodes.length, 0, group);
  return { canvas: { ...canvas, nodes }, id };
}

/**
 * Join two nodes. Without sides they are chosen to face each other. Joining a node to itself, or twice at the same two
 * sides in the same direction, adds nothing.
 */
export function addEdge(canvas: Canvas, fromNode: string, toNode: string, opts: { fromSide?: Side; toSide?: Side; random?: () => number } = {}): { canvas: Canvas; id: string | null } {
  const a = nodeById(canvas, fromNode);
  const b = nodeById(canvas, toNode);
  if (!a || !b || fromNode === toNode) return { canvas, id: null };
  const auto = sidesBetween(a, b);
  const fromSide = opts.fromSide ?? auto.from;
  const toSide = opts.toSide ?? auto.to;
  if (canvas.edges.some((e) => e.fromNode === fromNode && e.toNode === toNode && (e.fromSide ?? auto.from) === fromSide && (e.toSide ?? auto.to) === toSide)) return { canvas, id: null };
  const id = newId(canvas, opts.random);
  const edge: CanvasEdge = { id, fromNode, fromSide, toNode, toSide, toEnd: 'arrow' };
  return { canvas: { ...canvas, edges: [...canvas.edges, edge] }, id };
}

// ---------------------------------------------------------------- changing

const mapNodes = (canvas: Canvas, f: (n: CanvasNode) => CanvasNode): Canvas => ({ ...canvas, nodes: canvas.nodes.map(f) });

/** Move nodes by an offset. Moving a group moves what is inside it too. */
export function moveNodes(canvas: Canvas, ids: readonly string[], dx: number, dy: number): Canvas {
  if (dx === 0 && dy === 0) return canvas;
  const moving = new Set(ids);
  for (const id of ids) for (const m of membersOf(canvas, id)) moving.add(m.id);
  return mapNodes(canvas, (n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
}

/** Give a node a new box, no smaller than the minimum. */
export function resizeNode(canvas: Canvas, id: string, rect: Rect): Canvas {
  const r = { ...rect, width: Math.max(MIN_WIDTH, rect.width), height: Math.max(MIN_HEIGHT, rect.height) };
  return mapNodes(canvas, (n) => (n.id === id ? { ...n, ...r } : n));
}

/** Change fields of a node (its text, colour, label ...). A field set to `undefined` is taken out. */
export function updateNode(canvas: Canvas, id: string, patch: Record<string, unknown>): Canvas {
  return mapNodes(canvas, (n) => {
    if (n.id !== id) return n;
    const next: Record<string, unknown> = { ...n, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
    return next as CanvasNode;
  });
}

/** Change fields of an edge. A field set to `undefined` is taken out. */
export function updateEdge(canvas: Canvas, id: string, patch: Record<string, unknown>): Canvas {
  return {
    ...canvas,
    edges: canvas.edges.map((e) => {
      if (e.id !== id) return e;
      const next: Record<string, unknown> = { ...e, ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
      return next as CanvasEdge;
    }),
  };
}

/** Take nodes away, and every edge that joined one of them. */
export function removeNodes(canvas: Canvas, ids: readonly string[]): Canvas {
  const gone = new Set(ids);
  return { ...canvas, nodes: canvas.nodes.filter((n) => !gone.has(n.id)), edges: canvas.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)) };
}

/**
 * Join one end of an edge to another node and side. The other end stays. An edge cannot be joined to itself, and an end that
 * is already there changes nothing.
 */
export function reconnectEdge(canvas: Canvas, id: string, end: 'from' | 'to', node: string, side: Side): Canvas {
  const e = canvas.edges.find((x) => x.id === id);
  if (!e || !nodeById(canvas, node)) return canvas;
  const other = end === 'from' ? e.toNode : e.fromNode;
  if (node === other) return canvas;
  const same = end === 'from' ? e.fromNode === node && e.fromSide === side : e.toNode === node && e.toSide === side;
  if (same) return canvas;
  return updateEdge(canvas, id, end === 'from' ? { fromNode: node, fromSide: side } : { toNode: node, toSide: side });
}

export function removeEdges(canvas: Canvas, ids: readonly string[]): Canvas {
  const gone = new Set(ids);
  return { ...canvas, edges: canvas.edges.filter((e) => !gone.has(e.id)) };
}

/** Draw nodes on top of the others (later in the file is higher). Groups stay beneath: a group is never moved above a non-group. */
export function bringToFront(canvas: Canvas, ids: readonly string[]): Canvas {
  const set = new Set(ids);
  const moved = canvas.nodes.filter((n) => set.has(n.id));
  if (moved.length === 0) return canvas;
  return { ...canvas, nodes: [...canvas.nodes.filter((n) => !set.has(n.id)), ...moved] };
}

export function sendToBack(canvas: Canvas, ids: readonly string[]): Canvas {
  const set = new Set(ids);
  const moved = canvas.nodes.filter((n) => set.has(n.id));
  if (moved.length === 0) return canvas;
  return { ...canvas, nodes: [...moved, ...canvas.nodes.filter((n) => !set.has(n.id))] };
}

/**
 * Copy nodes (and the edges between them) to a new place, with new ids. Returns the new canvas and the ids of the copies, so
 * they can be selected.
 */
export function duplicateNodes(canvas: Canvas, ids: readonly string[], dx = 30, dy = 30, random?: () => number): { canvas: Canvas; ids: string[] } {
  const source = canvas.nodes.filter((n) => ids.includes(n.id));
  const map = new Map<string, string>();
  let work: Canvas = canvas;
  const nodes: CanvasNode[] = [];
  for (const n of source) {
    const id = newId(work, random);
    map.set(n.id, id);
    const copy = { ...n, id, x: n.x + dx, y: n.y + dy } as CanvasNode;
    nodes.push(copy);
    work = { ...work, nodes: [...work.nodes, copy] };
  }
  const edges: CanvasEdge[] = [];
  for (const e of canvas.edges) {
    if (!map.has(e.fromNode) || !map.has(e.toNode)) continue;
    const id = newId({ ...work, edges: [...work.edges, ...edges] }, random);
    edges.push({ ...e, id, fromNode: map.get(e.fromNode) as string, toNode: map.get(e.toNode) as string });
  }
  return { canvas: { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] }, ids: nodes.map((n) => n.id) };
}

/** Make the nodes line up: `left`, `right`, `top`, `bottom` edges, or `hcenter` / `vcenter` centres. */
export function alignNodes(canvas: Canvas, ids: readonly string[], how: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'): Canvas {
  const picked = canvas.nodes.filter((n) => ids.includes(n.id));
  const box = boundsOf(picked.map(rectOf));
  if (!box || picked.length < 2) return canvas;
  return mapNodes(canvas, (n) => {
    if (!ids.includes(n.id)) return n;
    switch (how) {
      case 'left': return { ...n, x: box.x };
      case 'right': return { ...n, x: box.x + box.width - n.width };
      case 'top': return { ...n, y: box.y };
      case 'bottom': return { ...n, y: box.y + box.height - n.height };
      case 'hcenter': return { ...n, x: box.x + (box.width - n.width) / 2 };
      default: return { ...n, y: box.y + (box.height - n.height) / 2 };
    }
  });
}

// ---------------------------------------------------------------- the view

export interface Viewport { x: number; y: number; zoom: number }
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** The viewport that shows a box in a window of a given size, with a margin. */
export function fitViewport(box: Rect | null, size: { width: number; height: number }, margin = 40): Viewport {
  if (!box || size.width <= 0 || size.height <= 0) return { x: size.width / 2, y: size.height / 2, zoom: 1 };
  const zoom = clampZoom(Math.min((size.width - 2 * margin) / Math.max(1, box.width), (size.height - 2 * margin) / Math.max(1, box.height), 1));
  return { zoom, x: size.width / 2 - (box.x + box.width / 2) * zoom, y: size.height / 2 - (box.y + box.height / 2) * zoom };
}

/** Zoom by a factor around a point of the window (the point stays where it is on the screen). */
export function zoomAt(v: Viewport, factor: number, screen: Point): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: screen.x - (screen.x - v.x) * k, y: screen.y - (screen.y - v.y) * k };
}

export const toCanvasPoint = (v: Viewport, screen: Point): Point => ({ x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom });
export const toScreenPoint = (v: Viewport, p: Point): Point => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });

/** Spread three or more nodes so the gaps between them are equal, along one direction (the outer two stay). */
export function distributeNodes(canvas: Canvas, ids: readonly string[], axis: 'horizontal' | 'vertical'): Canvas {
  const picked = canvas.nodes.filter((n) => ids.includes(n.id));
  if (picked.length < 3) return canvas;
  const h = axis === 'horizontal';
  const sorted = [...picked].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
  const first = sorted[0] as CanvasNode;
  const last = sorted[sorted.length - 1] as CanvasNode;
  const span = h ? last.x + last.width - first.x : last.y + last.height - first.y;
  const total = sorted.reduce((t, n) => t + (h ? n.width : n.height), 0);
  const gap = (span - total) / (sorted.length - 1);
  let at = h ? first.x : first.y;
  const pos = new Map<string, number>();
  for (const n of sorted) {
    pos.set(n.id, at);
    at += (h ? n.width : n.height) + gap;
  }
  return mapNodes(canvas, (n) => (pos.has(n.id) ? (h ? { ...n, x: pos.get(n.id) as number } : { ...n, y: pos.get(n.id) as number }) : n));
}

// ---------------------------------------------------------------- the list of objects

/** A short name for a node: the first line of a note, the name of a page, the host of a link, the label of a group. */
export function describeNode(n: CanvasNode): string {
  if (n.type === 'text') {
    const first = (typeof n.text === 'string' ? n.text : '').split('\n').map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '').replace(/[*_`]/g, '').trim()).find((l) => l !== '');
    return first ? (first.length > 48 ? `${first.slice(0, 47)}…` : first) : '(empty note)';
  }
  if (n.type === 'file') return (typeof n.file === 'string' ? n.file : '').replace(/^.*\//, '').replace(/\.[^.]+$/, '') || '(page)';
  if (n.type === 'link') {
    try {
      return new URL(String(n.url)).hostname || String(n.url);
    } catch {
      return String(n.url) || '(link)';
    }
  }
  return typeof n.label === 'string' && n.label !== '' ? n.label : 'Group';
}

/** The kind of a node as a word. */
export const NODE_KIND: Readonly<Record<string, string>> = { text: 'Note', file: 'Page', link: 'Link', group: 'Group' };

/**
 * Every node in a list that shows what holds what: a group is followed by the nodes inside it (and groups inside it), each
 * with how deep it is. A node lying inside several groups belongs to the smallest. Within a level, reading order.
 */
export function objectTree(canvas: Canvas): Array<{ node: CanvasNode; depth: number }> {
  const groups = canvas.nodes.filter((n) => n.type === 'group');
  const area = (n: Rect): number => n.width * n.height;
  const parentOf = new Map<string, string>();
  for (const n of canvas.nodes) {
    let best: CanvasNode | null = null;
    for (const g of groups) {
      const outer = area(g) > area(n) || (area(g) === area(n) && canvas.nodes.indexOf(g) < canvas.nodes.indexOf(n));
      if (g.id !== n.id && outer && inside(g, n) && (!best || area(g) < area(best))) best = g;
    }
    if (best) parentOf.set(n.id, best.id);
  }
  const order = (a: CanvasNode, b: CanvasNode): number => a.y - b.y || a.x - b.x;
  const kids = new Map<string | null, CanvasNode[]>();
  for (const n of canvas.nodes) {
    const k = parentOf.get(n.id) ?? null;
    kids.set(k, [...(kids.get(k) ?? []), n]);
  }
  const out: Array<{ node: CanvasNode; depth: number }> = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const n of [...(kids.get(parent) ?? [])].sort(order)) {
      out.push({ node: n, depth });
      if (n.type === 'group') walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
