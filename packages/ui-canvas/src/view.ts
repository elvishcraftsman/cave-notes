import { SIDES, type Canvas, type CanvasEdge, type CanvasNode, type FileNode, type LinkNode, type Side, type TextNode } from './model';
import {
  MAX_ZOOM, MIN_ZOOM, PRESET_COLORS, PRESET_NAMES, type Point, type Rect, type Viewport,
  DEFAULT_FILE_SIZE, EXPANDED_FILE_SIZE, addEdge, addGroup, addLinkNode, addFileNode, addTextNode, alignNodes, anchor, boundsOf, bringToFront, cssColor, duplicateNodes, edgeGeometry, fitViewport, intersects, isExpanded,
  moveNodes, nodeById, reconnectEdge, removeEdges, removeNodes, resizeNode, sendToBack, toCanvasPoint, updateEdge, updateNode, zoomAt,
  SHAPES, SHAPE_NAMES, arrowEnds, borderStyleOf, cycleArrows, distributeNodes, shapeOf,
} from './ops';
import { CANVAS_CSS } from './style';

/**
 * The canvas on the screen. It draws a `Canvas`, lets the person change it, and reports each finished change through
 * `host.onChange` as a whole new `Canvas` (a drag is one change, made when the pointer is let go), so the text editor
 * that holds the file can make it one undoable step. How the inside of a node is drawn is the host's business: the app
 * draws Markdown with the same editor it uses for pages.
 */

/** Something the host mounted inside a node, which the view can update, focus and remove. */
export interface Mounted {
  update(text: string): void;
  focus(): void;
  destroy(): void;
}

export interface CanvasHost {
  /** Draw the Markdown of a text node into `el`. With `edit`, it is an editor and calls `onText` as the text changes. */
  mountText(el: HTMLElement, node: TextNode, opts: { edit: boolean; onText: (text: string) => void; onDone: () => void; view?: () => boolean }): Mounted;
  /** In view mode a click lands on something inside a card (a link of its text): follow it. True when it did. */
  followIn?(target: HTMLElement): boolean;
  /** Remembered choices of the person (`snap`: snapping to the grid; `view`: the view mode), kept by the app. */
  pref?: { get(key: 'snap' | 'view'): boolean; set(key: 'snap' | 'view', value: boolean): void };
  /** Fill a file node: its name and place when it is small, a preview of a page or the picture when `expanded`. */
  fillFile(el: HTMLElement, node: FileNode, expanded: boolean): void;
  /** Fill a link node. */
  fillLink(el: HTMLElement, node: LinkNode): void;
  openFile(node: FileNode): void;
  openUrl(url: string): void;
  /** Ask for a file of the workspace to put on the canvas; null when cancelled. */
  chooseFile(): Promise<string | null>;
  /** Where a picture of the workspace (a path from its top) can be loaded from, or null when there is none. */
  imageUrl?(path: string): string | null;
  /** Ask for a picture of the workspace: its path, or null when none was chosen. */
  chooseImage?(): Promise<string | null>;
  /** Ask for a web address; null when cancelled. */
  askUrl(): Promise<string | null>;
  /** Could what is being dragged over the canvas be dropped on it (by the kinds of data it carries)? */
  canDrop?(types: readonly string[]): boolean;
  /** The workspace paths of the files and pages dropped on the canvas. */
  dropPaths?(data: DataTransfer): string[];
  /** A finished change: the whole canvas as it is now. */
  onChange(canvas: Canvas): void;
}

/** A host that needs no app: text in a `<textarea>` or a `<div>`, files and links as plain cards. */
export function plainHost(onChange: (c: Canvas) => void = () => {}): CanvasHost {
  return {
    mountText(el, node, opts) {
      if (!opts.edit) {
        el.textContent = node.text;
        return { update: (t) => void (el.textContent = t), focus() {}, destroy: () => void (el.textContent = '') };
      }
      const ta = document.createElement('textarea');
      ta.className = 'cv-plain-edit';
      ta.value = node.text;
      ta.addEventListener('input', () => opts.onText(ta.value));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') opts.onDone();
      });
      el.replaceChildren(ta);
      return { update: (t) => void (ta.value = t), focus: () => ta.focus(), destroy: () => ta.remove() };
    },
    fillFile: (el, node) => void (el.textContent = node.file),
    fillLink: (el, node) => void (el.textContent = node.url),
    openFile() {},
    openUrl() {},
    chooseFile: async () => null,
    askUrl: async () => null,
    onChange,
  };
}

interface Rec { el: HTMLElement; shape: HTMLElement; body: HTMLElement; sig: string; mounted: Mounted | null; editing: boolean }

/** Files a card can show as a picture. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** One step of the grid: the distance between the dots of the background. */
export const GRID = 24;

type Mode =
  | { kind: 'idle' }
  | { kind: 'pan'; from: Point; vp: Viewport; click?: string }
  | { kind: 'move'; ids: string[]; start: Point; base: Canvas; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; start: Point; rect: Rect; base: Canvas }
  | { kind: 'connect'; from: string; side: Side; at: Point; target: Target | null }
  | { kind: 'reconnect'; edge: string; end: 'from' | 'to'; at: Point; target: Target | null }
  | { kind: 'rubber'; from: Point; to: Point; add: boolean; base: Set<string> };

/** A node and the side of it an arrow would join. */
interface Target { id: string; side: Side }

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const MARGIN = 200; // how far outside the window nodes keep their content

export class CanvasView {
  readonly root: HTMLElement;
  private readonly world: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly overlay: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly rubberEl: HTMLElement;
  private canvas: Canvas;
  private vp: Viewport = { x: 0, y: 0, zoom: 1 };
  private selection = new Set<string>(); // node and edge ids
  private mode: Mode = { kind: 'idle' };
  private editing: string | null = null;
  private readonly els = new Map<string, Rec>();
  /** snapping to the grid while moving and resizing (the dots of the background are one grid step apart) */
  private snapOn = false;
  private step = 24;
  private fitted = false;
  /** what is true now: no changes can be made (either the app says so, or the person chose view mode) */
  private readOnly = false;
  private locked = false;
  private viewMode = false;
  private embedded = false;
  private listeners = new Set<() => void>();
  private notifyQueued = false;
  private menu: HTMLElement | null = null;
  private btnSnap: HTMLButtonElement | null = null;
  private btnMode: HTMLButtonElement | null = null;
  private destroyed = false;
  private pointers = new Map<number, Point>();
  private pinch: { dist: number; vp: Viewport; center: Point } | null = null;
  private toolbarSig = '';
  private sizeObserver: ResizeObserver | null = null;

  constructor(parent: HTMLElement, private host: CanvasHost, canvas: Canvas, opts: { readOnly?: boolean; grid?: number; embedded?: boolean } = {}) {
    this.canvas = canvas;
    this.locked = opts.readOnly === true;
    this.embedded = opts.embedded === true;
    this.viewMode = this.embedded || (host.pref?.get('view') ?? false);
    if ((opts.grid ?? 0) > 0) this.step = opts.grid as number;
    this.snapOn = (opts.grid ?? 0) > 0 || (host.pref?.get('snap') ?? false);
    this.readOnly = this.locked || this.viewMode;
    ensureStyle(parent.ownerDocument);
    const d = parent.ownerDocument;
    this.root = d.createElement('div');
    this.root.className = 'cv-root';
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Canvas');
    this.world = d.createElement('div');
    this.world.className = 'cv-world';
    this.svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'cv-edges');
    this.svg.innerHTML = '<defs><marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>';
    this.edgeLayer = d.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.append(this.edgeLayer);
    this.overlay = d.createElement('div');
    this.overlay.className = 'cv-overlay';
    this.toolbar = d.createElement('div');
    this.toolbar.className = 'cv-toolbar';
    this.toolbar.hidden = true;
    this.rubberEl = d.createElement('div');
    this.rubberEl.className = 'cv-rubber';
    this.rubberEl.hidden = true;
    this.world.append(this.svg);
    this.root.append(this.world, this.rubberEl, this.toolbar, this.overlay, this.palette(), this.zoomControls());
    parent.append(this.root);
    this.bind();
    this.render();
    const r = this.size();
    if (r.width > 0) this.fit();
    // a canvas made while its window has no size yet (a page opening) shows everything as soon as it has one
    if (typeof ResizeObserver !== 'undefined') {
      this.sizeObserver = new ResizeObserver(() => {
        if (!this.fitted && this.size().width > 0) this.fit();
        else this.render();
      });
      this.sizeObserver.observe(this.root);
    }
  }

  // ---------------------------------------------------------------- the outside

  get current(): Canvas {
    return this.canvas;
  }
  get viewport(): Viewport {
    return { ...this.vp };
  }
  get selected(): string[] {
    return [...this.selection];
  }

  /** The text editor changed the file (undo, a sync): show the new canvas, keeping the view and what is still there selected. */
  setCanvas(canvas: Canvas): void {
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    const ids = new Set([...canvas.nodes.map((n) => n.id), ...canvas.edges.map((e) => e.id)]);
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    if (this.editing && !ids.has(this.editing)) this.editing = null;
    this.render();
  }

  /** The app forbids changes (a read-only page): the person cannot switch to editing. */
  setReadOnly(on: boolean): void {
    this.locked = on;
    this.readOnly = this.locked || this.viewMode;
    this.render();
  }

  get isViewMode(): boolean {
    return this.readOnly;
  }
  get isLocked(): boolean {
    return this.locked;
  }
  get snapping(): boolean {
    return this.snapOn;
  }
  /** The grid step while moving or resizing: nothing when snapping is off. */
  private get grid(): number {
    return this.snapOn ? this.step : 0;
  }

  /** View mode: nothing can be changed, and a click on a card goes straight to what it shows. */
  setViewMode(on: boolean): void {
    if (this.locked && !on) return;
    this.viewMode = on;
    this.readOnly = this.locked || on;
    if (this.readOnly) {
      this.closeMenu();
      this.stopEdit();
      this.mode = { kind: 'idle' };
    }
    this.host.pref?.set('view', on);
    this.render();
  }

  setSnap(on: boolean): void {
    this.snapOn = on;
    this.host.pref?.set('snap', on);
    this.render();
  }

  /** Be told when what the canvas shows changes (the canvas, the selection, view mode): for panes beside it. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify(): void {
    if (this.notifyQueued || this.listeners.size === 0) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      if (!this.destroyed) for (const f of [...this.listeners]) f();
    });
  }

  /** The box that holds every node: for sizing a canvas shown small. */
  get contentBounds(): Rect | null {
    return boundsOf(this.canvas.nodes);
  }

  /** Scroll the view just enough to bring a node (or the middle of an arrow) into sight. */
  reveal(id: string): void {
    const n = nodeById(this.canvas, id);
    const e = n ? null : this.canvas.edges.find((x) => x.id === id);
    const ends = e ? this.edgeEnds(e) : null;
    const r: Rect | null = n ?? (ends ? { x: ends.geo.mid.x - 1, y: ends.geo.mid.y - 1, width: 2, height: 2 } : null);
    if (!r) return;
    const s = this.size();
    const pad = 40;
    const x0 = r.x * this.vp.zoom + this.vp.x, y0 = r.y * this.vp.zoom + this.vp.y;
    const x1 = x0 + r.width * this.vp.zoom, y1 = y0 + r.height * this.vp.zoom;
    let { x, y } = this.vp;
    if (x0 < pad) x += pad - x0; else if (x1 > s.width - pad) x -= Math.min(x1 - (s.width - pad), x0 - pad);
    if (y0 < pad) y += pad - y0; else if (y1 > s.height - pad) y -= Math.min(y1 - (s.height - pad), y0 - pad);
    if (x !== this.vp.x || y !== this.vp.y) {
      this.vp = { ...this.vp, x, y };
      this.fitted = true;
      this.render();
    }
  }

  // ---- what the properties pane does to the selection

  /** Change fields of the selected nodes (colour, shape, border, a group's label ...). A field set to `undefined` is taken out. */
  patchSelectedNodes(patch: Record<string, unknown>): void {
    if (this.readOnly) return;
    let next = this.canvas;
    for (const n of this.canvas.nodes) if (this.selection.has(n.id)) next = updateNode(next, n.id, patch);
    this.commit(next);
  }

  patchSelectedEdges(patch: Record<string, unknown>): void {
    if (this.readOnly) return;
    let next = this.canvas;
    for (const e of this.canvas.edges) if (this.selection.has(e.id)) next = updateEdge(next, e.id, patch);
    this.commit(next);
  }

  /** Put the selected node at a place and size (a group takes what is inside it along when it moves). */
  setBox(id: string, box: Partial<Rect>): void {
    const n = nodeById(this.canvas, id);
    if (this.readOnly || !n) return;
    let next = this.canvas;
    const x = box.x ?? n.x, y = box.y ?? n.y;
    if (x !== n.x || y !== n.y) next = moveNodes(next, [id], x - n.x, y - n.y);
    const cur = nodeById(next, id) as CanvasNode;
    if (box.width !== undefined || box.height !== undefined) next = resizeNode(next, id, { x: cur.x, y: cur.y, width: box.width ?? cur.width, height: box.height ?? cur.height });
    this.commit(next);
  }

  /** Put a picture of the workspace behind the selected cards (null takes it away). `how`: cover (fills the card), ratio (all of it shows), repeat (tiled). */
  setBackgroundImage(path: string | null, how?: 'cover' | 'ratio' | 'repeat'): void {
    this.patchSelectedNodes({ background: path ?? undefined, backgroundStyle: path === null || how === undefined || how === 'cover' ? undefined : how });
  }

  /** Ask for a picture, and make sure it can be shown. */
  private async pickImage(): Promise<string | null> {
    const raw = await (this.host.chooseImage ?? this.host.chooseFile)();
    if (!raw) return null;
    const path = raw.replace(/^\/+/, '');
    if (!IMAGE_FILE.test(path)) return null;
    return path;
  }

  /** Ask for a picture and put it behind the selected cards. */
  async chooseBackgroundImage(): Promise<void> {
    if (this.readOnly) return;
    const path = await this.pickImage();
    if (path !== null) this.setBackgroundImage(path, this.selectedStyle());
  }

  private selectedStyle(): 'cover' | 'ratio' | 'repeat' | undefined {
    const n = this.canvas.nodes.find((x) => this.selection.has(x.id));
    return n?.backgroundStyle === 'ratio' || n?.backgroundStyle === 'repeat' ? n.backgroundStyle : undefined;
  }

  /** Ask for a picture and write it into a note card, at the end of its text, as a picture in the page's own way. */
  async insertImage(id: string): Promise<void> {
    const n = nodeById(this.canvas, id);
    if (this.readOnly || !n || n.type !== 'text') return;
    const path = await this.pickImage();
    if (path === null) return;
    const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
    const dest = /[\s()]/.test(path) ? `</${path}>` : `/${path}`;
    const cur = nodeById(this.canvas, id);
    if (!cur || cur.type !== 'text') return;
    const text = cur.text === '' ? '' : cur.text.endsWith('\n\n') ? cur.text : `${cur.text}${cur.text.endsWith('\n') ? '\n' : '\n\n'}`;
    this.stopEdit();
    this.commit(updateNode(this.canvas, id, { text: `${text}![${name}](${dest})` }));
  }

  cycleArrowheads(): void {
    if (this.readOnly) return;
    this.commit(cycleArrows(this.canvas, [...this.selection]));
  }

  align(how: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'): void {
    if (this.readOnly) return;
    this.commit(alignNodes(this.canvas, [...this.selection].filter((id) => nodeById(this.canvas, id)), how));
  }

  distribute(axis: 'horizontal' | 'vertical'): void {
    if (this.readOnly) return;
    this.commit(distributeNodes(this.canvas, [...this.selection].filter((id) => nodeById(this.canvas, id)), axis));
  }

  /** Show everything. */
  fit(): void {
    const s = this.size();
    this.vp = fitViewport(boundsOf(this.canvas.nodes), s.width > 0 ? s : { width: 800, height: 600 });
    this.fitted = true;
    this.render();
  }

  setViewport(v: Viewport): void {
    this.vp = { ...v };
    this.fitted = true;
    this.render();
  }

  select(ids: readonly string[]): void {
    this.selection = new Set(ids);
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.sizeObserver?.disconnect();
    this.closeMenu();
    this.listeners.clear();
    for (const e of this.els.values()) e.mounted?.destroy();
    this.els.clear();
    this.root.remove();
  }

  private size(): { width: number; height: number } {
    const r = this.root.getBoundingClientRect();
    return { width: r.width || this.root.clientWidth, height: r.height || this.root.clientHeight };
  }

  private commit(next: Canvas): void {
    if (next === this.canvas) return;
    this.canvas = next;
    this.render();
    this.host.onChange(next);
  }

  // ---------------------------------------------------------------- drawing

  private nodeSig(n: CanvasNode): string {
    return JSON.stringify([n.type, n.type === 'text' ? '' : n.type === 'file' ? [n.file, n.subpath] : n.type === 'link' ? n.url : [n.label, n.background, n.backgroundStyle]]);
  }

  private visible(n: Rect): boolean {
    const s = this.size();
    if (s.width === 0) return true;
    const a = { x: (-this.vp.x - MARGIN) / this.vp.zoom, y: (-this.vp.y - MARGIN) / this.vp.zoom, width: (s.width + 2 * MARGIN) / this.vp.zoom, height: (s.height + 2 * MARGIN) / this.vp.zoom };
    return intersects(a, n);
  }

  /** Bring the screen up to date with the canvas, the selection and the viewport. Only what changed is touched. */
  render(): void {
    if (this.destroyed) return;
    this.world.style.transform = `translate(${this.vp.x}px, ${this.vp.y}px) scale(${this.vp.zoom})`;
    // the dots of the background move and scale with the canvas
    this.root.style.setProperty('--cv-zoom', String(this.vp.zoom));
    this.root.style.setProperty('--cv-x', `${this.vp.x}px`);
    this.root.style.setProperty('--cv-y', `${this.vp.y}px`);
    this.root.classList.toggle('cv-readonly', this.readOnly);
    const seen = new Set<string>();
    let order = 0;
    for (const n of this.canvas.nodes) {
      seen.add(n.id);
      let rec = this.els.get(n.id);
      if (!rec) {
        const el = this.world.ownerDocument.createElement('div');
        el.dataset.node = n.id;
        const shape = this.world.ownerDocument.createElement('div');
        const body = this.world.ownerDocument.createElement('div');
        body.className = 'cv-body';
        el.append(shape, body);
        this.world.append(el);
        rec = { el, shape, body, sig: '', mounted: null, editing: false };
        this.els.set(n.id, rec);
      }
      const { el } = rec;
      el.className = `cv-node cv-${n.type}${this.selection.has(n.id) ? ' cv-selected' : ''}${this.editing === n.id ? ' cv-editing' : ''}`;
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
      el.style.width = `${n.width}px`;
      el.style.height = `${n.height}px`;
      el.style.zIndex = String(++order);
      const color = cssColor(n.color);
      if (color) el.style.setProperty('--cv-color', color);
      else el.style.removeProperty('--cv-color');
      // the fill: a preset colour tints the card, any other colour fills it (with text that can be read on it)
      const fillCss = typeof n.fill === 'string' ? cssColor(n.fill) : null;
      if (fillCss) {
        const preset = /^[1-6]$/.test(String(n.fill));
        el.style.setProperty('--cv-bg', preset ? `color-mix(in srgb, ${fillCss} 24%, var(--cv-card, var(--card-bg, var(--editor-bg, #fff))))` : fillCss);
        const ink = preset ? null : inkOn(fillCss);
        if (ink) el.style.setProperty('--cv-ink', ink);
        else el.style.removeProperty('--cv-ink');
      } else {
        el.style.removeProperty('--cv-bg');
        el.style.removeProperty('--cv-ink');
      }
      // a picture behind the card's content (`background`, and `backgroundStyle`: cover, ratio or repeat, as JSON Canvas names them)
      const bgUrl = typeof n.background === 'string' && n.background !== '' ? (this.host.imageUrl?.(n.background) ?? null) : null;
      if (bgUrl) {
        const how = n.backgroundStyle === 'ratio' ? ['contain', 'no-repeat'] : n.backgroundStyle === 'repeat' ? ['auto', 'repeat'] : ['cover', 'no-repeat'];
        el.style.setProperty('--cv-img', `url(${JSON.stringify(bgUrl)})`);
        el.style.setProperty('--cv-img-size', how[0]!);
        el.style.setProperty('--cv-img-repeat', how[1]!);
        el.dataset.image = '1';
      } else {
        el.style.removeProperty('--cv-img');
        el.style.removeProperty('--cv-img-size');
        el.style.removeProperty('--cv-img-repeat');
        delete el.dataset.image;
      }
      // the look of the card: its shape, and the style and width of its border (fields other programs leave alone)
      const shape = n.type === 'group' && !['rounded', 'rectangle'].includes(shapeOf(n)) ? 'rounded' : shapeOf(n);
      el.dataset.shape = shape;
      rec.shape.className = `cv-shape cv-shape-${shape}`;
      const bs = borderStyleOf(n);
      if (bs) el.style.setProperty('--cv-bs', bs);
      else el.style.removeProperty('--cv-bs');
      const bw = typeof n.borderWidth === 'number' && n.borderWidth >= 0 && n.borderWidth <= 12 ? n.borderWidth : null;
      if (bw !== null) el.style.setProperty('--cv-bw', `${bw}px`);
      else el.style.removeProperty('--cv-bw');
      this.fill(n, rec);
      this.handles(n, rec.el);
      this.expander(n, rec.el);
    }
    for (const [id, rec] of [...this.els]) {
      if (seen.has(id)) continue;
      rec.mounted?.destroy();
      rec.el.remove();
      this.els.delete(id);
    }
    this.drawEdges();
    this.drawToolbar();
    this.syncButtons();
    this.notify();
  }

  private fill(n: CanvasNode, rec: Rec): void {
    const live = this.visible(n);
    const editing = this.editing === n.id && n.type === 'text';
    if (n.type === 'text') {
      if (!live && !editing) {
        if (rec.mounted) { rec.mounted.destroy(); rec.mounted = null; rec.body.replaceChildren(); }
        return;
      }
      if (rec.mounted && rec.editing === editing) {
        rec.mounted.update(n.text);
        return;
      }
      rec.mounted?.destroy();
      rec.body.replaceChildren();
      rec.editing = editing;
      rec.mounted = this.host.mountText(rec.body, n, {
        edit: editing,
        onText: (text) => this.commitText(n.id, text),
        onDone: () => this.stopEdit(),
        view: () => this.readOnly,
      });
      if (editing) rec.mounted.focus();
      return;
    }
    const sig = this.nodeSig(n) + (n.type === 'file' ? `/${isExpanded(n)}` : '');
    if (sig === rec.sig) {
      if (n.type === 'group') this.groupLabel(n, rec.body);
      return;
    }
    rec.sig = sig;
    rec.body.replaceChildren();
    if (n.type === 'file') this.host.fillFile(rec.body, n, isExpanded(n));
    else if (n.type === 'link') this.host.fillLink(rec.body, n);
    else this.groupLabel(n, rec.body);
  }

  private groupLabel(n: CanvasNode, body: HTMLElement): void {
    if (n.type !== 'group') return;
    const label = typeof n.label === 'string' ? n.label : '';
    let el = body.querySelector<HTMLElement>('.cv-group-label');
    if (!el) {
      el = body.ownerDocument.createElement('div');
      el.className = 'cv-group-label';
      body.replaceChildren(el);
    }
    if (el.textContent !== label) el.textContent = label;
  }

  /** A page card has a button to open it out (to show the page) and to fold it up again (to show only its name). */
  private expander(n: CanvasNode, el: HTMLElement): void {
    const have = el.querySelector<HTMLElement>(':scope > .cv-expand');
    if (n.type !== 'file' || this.readOnly) {
      have?.remove();
      return;
    }
    const open = isExpanded(n);
    if (have) {
      have.textContent = open ? '▾' : '▸';
      have.title = open ? 'Fold up' : 'Show more';
      have.setAttribute('aria-label', have.title);
      have.setAttribute('aria-expanded', String(open));
      return;
    }
    const b = el.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'cv-expand';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = nodeById(this.canvas, n.id);
      if (!cur) return;
      const size = isExpanded(cur) ? DEFAULT_FILE_SIZE : EXPANDED_FILE_SIZE;
      this.commit(resizeNode(this.canvas, cur.id, { x: cur.x, y: cur.y, width: size.width, height: size.height }));
    });
    el.append(b);
    this.expander(n, el);
  }

  private handles(n: CanvasNode, el: HTMLElement): void {
    const wanted = this.selection.has(n.id) && this.selection.size === 1 && !this.readOnly && this.editing !== n.id;
    const have = el.querySelectorAll('[data-handle]').length > 0;
    if (wanted === have) return;
    if (!wanted) {
      el.querySelectorAll('[data-handle], [data-port]').forEach((x) => x.remove());
      return;
    }
    for (const h of HANDLES) {
      const x = el.ownerDocument.createElement('div');
      x.className = `cv-handle cv-h-${h}`;
      x.dataset.handle = h;
      el.append(x);
    }
    for (const s of SIDES) {
      const x = el.ownerDocument.createElement('div');
      x.className = `cv-port cv-p-${s}`;
      x.dataset.port = s;
      el.append(x);
    }
  }

  private edgeEnds(e: CanvasEdge): { a: CanvasNode; b: CanvasNode; geo: ReturnType<typeof edgeGeometry> } | null {
    const a = nodeById(this.canvas, e.fromNode);
    const b = nodeById(this.canvas, e.toNode);
    if (!a || !b) return null;
    const auto = sideChoice(a, b);
    return { a, b, geo: edgeGeometry(a, e.fromSide ?? auto.from, b, e.toSide ?? auto.to) };
  }

  /** The node under a point (a little beyond its edge counts, so the dots on its sides can be hit) and its side nearest the point. */
  private targetAt(p: Point, exclude: readonly string[]): Target | null {
    const slack = 28 / this.vp.zoom;
    const hit = (n: CanvasNode): boolean => p.x >= n.x - slack && p.x <= n.x + n.width + slack && p.y >= n.y - slack && p.y <= n.y + n.height + slack;
    const nodes = this.canvas.nodes.filter((n) => !exclude.includes(n.id) && hit(n));
    const n = [...nodes].reverse().find((x) => x.type !== 'group') ?? nodes[nodes.length - 1];
    if (!n) return null;
    let side: Side = 'left';
    let best = Infinity;
    for (const sd of SIDES) {
      const a = anchor(n, sd);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < best) { best = d; side = sd; }
    }
    return { id: n.id, side };
  }

  private drawEdges(): void {
    const d = this.svg.ownerDocument;
    const ns = 'http://www.w3.org/2000/svg';
    const r = 7 / this.vp.zoom;
    const frag: SVGElement[] = [];
    const moving = this.mode.kind === 'reconnect' ? this.mode.edge : null;
    for (const e of this.canvas.edges) {
      const ends = this.edgeEnds(e);
      if (!ends) continue;
      const color = cssColor(e.color) ?? 'var(--cv-edge, #8a8a8a)';
      const selected = this.selection.has(e.id);
      const g = d.createElementNS(ns, 'g');
      g.setAttribute('class', `cv-edge${selected ? ' cv-selected' : ''}${moving === e.id ? ' cv-edge-moving' : ''}`);
      g.dataset.edge = e.id;
      const hit = d.createElementNS(ns, 'path');
      hit.setAttribute('d', ends.geo.d);
      hit.setAttribute('class', 'cv-edge-hit');
      const path = d.createElementNS(ns, 'path');
      path.setAttribute('d', ends.geo.d);
      path.setAttribute('class', 'cv-edge-line');
      path.setAttribute('stroke', color);
      const heads = arrowEnds(e);
      if (heads.to) path.setAttribute('marker-end', 'url(#cv-arrow)');
      if (heads.from) path.setAttribute('marker-start', 'url(#cv-arrow)');
      g.append(hit, path);
      if (typeof e.label === 'string' && e.label !== '') {
        const t = d.createElementNS(ns, 'text');
        t.setAttribute('class', 'cv-edge-label');
        t.setAttribute('x', String(ends.geo.mid.x));
        t.setAttribute('y', String(ends.geo.mid.y));
        t.textContent = e.label;
        g.append(t);
      }
      // the ends of a selected arrow can be picked up and put on another card or another side
      if (selected && this.selection.size === 1 && !this.readOnly) {
        for (const end of ['from', 'to'] as const) {
          const at = end === 'from' ? ends.geo.from : ends.geo.to;
          const c = d.createElementNS(ns, 'circle');
          c.setAttribute('class', 'cv-edge-end');
          c.setAttribute('cx', String(at.x));
          c.setAttribute('cy', String(at.y));
          c.setAttribute('r', String(r));
          c.dataset.end = end;
          g.append(c);
        }
      }
      frag.push(g);
    }
    // while an arrow is being drawn or moved: where it would join, and the sides to choose from
    const m = this.mode;
    if (m.kind === 'connect' || m.kind === 'reconnect') {
      let fixed: Point | null = null;
      if (m.kind === 'connect') {
        const from = nodeById(this.canvas, m.from);
        if (from) fixed = anchor(from, m.side);
      } else {
        const e = this.canvas.edges.find((x) => x.id === m.edge);
        const ends = e ? this.edgeEnds(e) : null;
        if (ends) fixed = m.end === 'from' ? ends.geo.to : ends.geo.from;
      }
      const tgt = m.target ? nodeById(this.canvas, m.target.id) : undefined;
      if (tgt && m.target) {
        for (const sd of SIDES) {
          const a = anchor(tgt, sd);
          const c = d.createElementNS(ns, 'circle');
          c.setAttribute('class', `cv-hint${sd === m.target.side ? ' cv-hint-on' : ''}`);
          c.setAttribute('cx', String(a.x));
          c.setAttribute('cy', String(a.y));
          c.setAttribute('r', String(sd === m.target.side ? r * 1.3 : r));
          frag.push(c);
        }
      }
      if (fixed) {
        const end = tgt && m.target ? anchor(tgt, m.target.side) : m.at;
        const line = d.createElementNS(ns, 'path');
        line.setAttribute('class', 'cv-edge-line cv-edge-draft');
        line.setAttribute('d', `M ${fixed.x} ${fixed.y} L ${end.x} ${end.y}`);
        frag.push(line);
      }
    }
    this.edgeLayer.replaceChildren(...frag);
  }

  private selectionRect(): Rect | null {
    const nodes = this.canvas.nodes.filter((n) => this.selection.has(n.id));
    return boundsOf(nodes);
  }

  private drawToolbar(): void {
    const tb = this.toolbar;
    const nodes = this.canvas.nodes.filter((n) => this.selection.has(n.id));
    const edges = this.canvas.edges.filter((e) => this.selection.has(e.id));
    const idle = this.mode.kind === 'idle';
    if (this.readOnly || this.editing || !idle || (nodes.length === 0 && edges.length === 0)) {
      tb.hidden = true;
      this.toolbarSig = '';
      return;
    }
    tb.hidden = false;
    // The buttons are only made again when what they offer changes. A page that rebuilds a button between the press and the
    // release of a click never receives the click.
    const heads = edges[0] ? arrowEnds(edges[0]) : null;
    const sig = `${nodes.length > 0}/${nodes.length > 1}/${edges.length > 0}/${edges.length > 0 && nodes.length === 0 ? edges[0]?.id : ''}/${heads ? `${heads.from}${heads.to}` : ''}`;
    if (sig === this.toolbarSig) {
      this.placeToolbar(nodes, edges);
      return;
    }
    this.toolbarSig = sig;
    tb.replaceChildren();
    const d = tb.ownerDocument;
    const btn = (label: string, title: string, run: () => void, cls = ''): HTMLButtonElement => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = `cv-btn ${cls}`.trim();
      b.title = title;
      b.setAttribute('aria-label', title);
      b.textContent = label;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        run();
      });
      b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      return b;
    };
    const setColor = (c: string | undefined): void => {
      let next = this.canvas;
      for (const n of nodes) next = updateNode(next, n.id, { color: c });
      for (const e of edges) next = updateEdge(next, e.id, { color: c });
      this.commit(next);
    };
    for (const [k, css] of Object.entries(PRESET_COLORS)) {
      const b = btn('', `${PRESET_NAMES[k]}`, () => setColor(k), 'cv-swatch');
      b.style.background = css;
      tb.append(b);
    }
    tb.append(btn('∅', 'No colour', () => setColor(undefined)));
    tb.append(btn('⧉', 'Duplicate (Ctrl+D)', () => this.duplicate()));
    if (nodes.length > 0) tb.append(btn('▣', 'Group the selection (Ctrl+G)', () => this.groupSelection()));
    if (edges.length > 0 && nodes.length === 0) {
      tb.append(btn('Aa', 'Label', () => this.editEdgeLabel(edges[0] as CanvasEdge)));
      tb.append(btn(arrowGlyph(edges[0] as CanvasEdge), 'Arrowheads: click to change (one end, the other, both, none)', () => this.cycleArrowheads()));
    }
    tb.append(btn('🗑', 'Delete', () => this.deleteSelection(), 'cv-danger'));
    this.placeToolbar(nodes, edges);
  }

  /** Put the toolbar above the selection, or above the middle of the selected arrow. */
  private placeToolbar(nodes: CanvasNode[], edges: CanvasEdge[]): void {
    const tb = this.toolbar;
    const r = boundsOf(nodes);
    const at = r ? { x: r.x + r.width / 2, y: r.y } : (() => { const e = edges[0]; const ends = e ? this.edgeEnds(e) : null; return ends ? ends.geo.mid : { x: 0, y: 0 }; })();
    tb.style.left = `${at.x * this.vp.zoom + this.vp.x}px`;
    tb.style.top = `${Math.max(8, at.y * this.vp.zoom + this.vp.y - 44)}px`;
  }

  // ---------------------------------------------------------------- the pieces around the canvas

  private palette(): HTMLElement {
    const d = this.root.ownerDocument;
    const bar = d.createElement('div');
    bar.className = 'cv-palette';
    const add = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'cv-btn cv-add';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', run);
      bar.append(b);
      return b;
    };
    add('📝', 'Add a note card', () => this.addText(this.centre()));
    add('📄', 'Add a page or file', () => void this.addFile(this.centre()));
    add('🔗', 'Add a web link', () => void this.addLink(this.centre()));
    add('▣', 'Add a group', () => this.addEmptyGroup(this.centre()));
    const snap = add('⊞', 'Snap to the grid while moving and resizing', () => this.setSnap(!this.snapOn));
    this.btnSnap = snap;
    return bar;
  }

  private zoomControls(): HTMLElement {
    const d = this.root.ownerDocument;
    const bar = d.createElement('div');
    bar.className = 'cv-zoom';
    const add = (label: string, title: string, run: () => void): void => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'cv-btn';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', run);
      bar.append(b);
    };
    add('+', 'Zoom in', () => this.zoomBy(1.25));
    add('−', 'Zoom out', () => this.zoomBy(0.8));
    add('⤢', 'Show everything', () => this.fit());
    if (!this.embedded) {
      const mode = d.createElement('button');
      mode.type = 'button';
      mode.className = 'cv-btn cv-mode';
      mode.addEventListener('pointerdown', (e) => e.stopPropagation());
      mode.addEventListener('click', () => this.setViewMode(!this.readOnly));
      bar.append(mode);
      this.btnMode = mode;
    }
    return bar;
  }

  /** The buttons that are switches show whether they are on. */
  private syncButtons(): void {
    const sn = this.btnSnap;
    if (sn) {
      sn.setAttribute('aria-pressed', String(this.snapOn));
      sn.classList.toggle('cv-on', this.snapOn);
      sn.title = this.snapOn ? 'Snapping to the grid: on (click to turn off)' : 'Snapping to the grid: off (click to turn on)';
      sn.setAttribute('aria-label', sn.title);
    }
    const m = this.btnMode;
    if (m) {
      m.textContent = this.readOnly ? '✎' : '👁';
      m.disabled = this.locked;
      m.title = this.locked ? 'This page cannot be changed' : this.readOnly ? 'View mode is on: click to edit the canvas' : 'Switch to view mode: no changes, and a click on a card goes there';
      m.setAttribute('aria-label', m.title);
    }
  }

  private centre(): Point {
    const s = this.size();
    return toCanvasPoint(this.vp, { x: s.width / 2 || 400, y: s.height / 2 || 300 });
  }

  private zoomBy(f: number): void {
    const s = this.size();
    this.vp = zoomAt(this.vp, f, { x: s.width / 2, y: s.height / 2 });
    this.render();
  }

  // ---------------------------------------------------------------- doing things

  addText(at: Point, text = ''): string | null {
    if (this.readOnly) return null;
    const r = addTextNode(this.canvas, at, text, { grid: this.grid });
    this.selection = new Set([r.id]);
    this.commit(r.canvas);
    this.startEdit(r.id);
    return r.id;
  }

  async addFile(at: Point): Promise<void> {
    if (this.readOnly) return;
    const file = await this.host.chooseFile();
    if (!file) return;
    const r = addFileNode(this.canvas, at, file, { grid: this.grid });
    this.selection = new Set([r.id]);
    this.commit(r.canvas);
  }

  async addLink(at: Point): Promise<void> {
    if (this.readOnly) return;
    const url = await this.host.askUrl();
    if (!url) return;
    const r = addLinkNode(this.canvas, at, url, { grid: this.grid });
    this.selection = new Set([r.id]);
    this.commit(r.canvas);
  }

  /** Put page cards for several files on the canvas, side by side, starting at a point. */
  addFiles(paths: readonly string[], at: Point): void {
    if (this.readOnly || paths.length === 0) return;
    let next = this.canvas;
    const ids: string[] = [];
    paths.forEach((file, i) => {
      const r = addFileNode(next, { x: at.x + (i % 3) * (DEFAULT_FILE_SIZE.width + 20), y: at.y + Math.floor(i / 3) * (DEFAULT_FILE_SIZE.height + 20) }, file, { grid: this.grid });
      next = r.canvas;
      ids.push(r.id);
    });
    this.selection = new Set(ids);
    this.commit(next);
  }

  addEmptyGroup(at: Point): void {
    if (this.readOnly) return;
    const r = addGroup(this.canvas, at, { grid: this.grid });
    this.selection = new Set([r.id]);
    this.commit(r.canvas);
  }

  groupSelection(): void {
    const ids = this.canvas.nodes.filter((n) => this.selection.has(n.id)).map((n) => n.id);
    if (this.readOnly || ids.length === 0) return;
    const r = addGroup(this.canvas, { x: 0, y: 0 }, { around: ids });
    this.selection = new Set([r.id]);
    this.commit(r.canvas);
  }

  duplicate(): void {
    const ids = this.canvas.nodes.filter((n) => this.selection.has(n.id)).map((n) => n.id);
    if (this.readOnly || ids.length === 0) return;
    const r = duplicateNodes(this.canvas, ids);
    this.selection = new Set(r.ids);
    this.commit(r.canvas);
  }

  deleteSelection(): void {
    if (this.readOnly) return;
    let next = removeNodes(this.canvas, [...this.selection]);
    next = removeEdges(next, [...this.selection]);
    this.selection.clear();
    this.commit(next);
  }

  startEdit(id: string): void {
    const n = nodeById(this.canvas, id);
    if (this.readOnly || !n || n.type !== 'text') return;
    this.editing = id;
    this.render();
  }

  stopEdit(): void {
    if (this.editing === null) return;
    this.editing = null;
    this.render();
    this.root.focus({ preventScroll: true });
  }

  /** Text typed into a node: kept on the canvas at once, so that an undo of the file takes it back a step at a time. */
  private commitText(id: string, text: string): void {
    const n = nodeById(this.canvas, id);
    if (!n || n.type !== 'text' || n.text === text) return;
    this.canvas = updateNode(this.canvas, id, { text });
    this.host.onChange(this.canvas);
    this.drawToolbar();
  }

  private editEdgeLabel(e: CanvasEdge): void {
    const ends = this.edgeEnds(e);
    if (!ends || this.readOnly) return;
    const d = this.root.ownerDocument;
    const input = d.createElement('input');
    input.className = 'cv-edge-input';
    input.value = typeof e.label === 'string' ? e.label : '';
    input.setAttribute('aria-label', 'Label of the arrow');
    const at = { x: ends.geo.mid.x * this.vp.zoom + this.vp.x, y: ends.geo.mid.y * this.vp.zoom + this.vp.y };
    input.style.left = `${at.x}px`;
    input.style.top = `${at.y}px`;
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      if (save) this.commit(updateEdge(this.canvas, e.id, { label: v === '' ? undefined : v }));
      this.root.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.overlay.append(input);
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------- the pointer and the keyboard

  private pointOf(ev: { clientX: number; clientY: number }): Point {
    const r = this.root.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private bind(): void {
    const r = this.root;
    r.addEventListener('pointerdown', (e) => this.down(e));
    r.addEventListener('pointermove', (e) => this.move(e));
    r.addEventListener('pointerup', (e) => this.up(e));
    r.addEventListener('pointercancel', (e) => this.up(e));
    r.addEventListener('dblclick', (e) => this.dbl(e));
    r.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // pressing a button of the canvas must not move the focus or start a text selection
    r.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.cv-toolbar, .cv-palette, .cv-zoom, .cv-expand, .cv-menu') && !t.closest('input, textarea')) e.preventDefault();
    });
    // pages dragged from the tree (or files from the folder bar) become page cards where they are dropped
    r.addEventListener('dragover', (e) => {
      if (this.readOnly || !e.dataTransfer || !this.host.canDrop?.([...e.dataTransfer.types])) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
    });
    r.addEventListener('drop', (e) => {
      if (this.readOnly || !e.dataTransfer) return;
      const paths = this.host.dropPaths?.(e.dataTransfer) ?? [];
      if (paths.length === 0) return;
      e.preventDefault();
      this.addFiles(paths, toCanvasPoint(this.vp, this.pointOf(e)));
    });
    r.addEventListener('keydown', (e) => this.key(e));
    r.addEventListener('contextmenu', (e) => {
      if (this.inControl(e.target)) return;
      e.preventDefault();
      this.contextMenu(e);
    });
    r.addEventListener('pointerdown', (e) => {
      if (this.menu && !(e.target as HTMLElement).closest?.('.cv-menu')) this.closeMenu();
    }, true);
  }

  /** Is the target a text field or an editor *inside* the canvas (the canvas itself may sit inside the page editor)? */
  private inField(target: EventTarget | null): boolean {
    const x = (target as HTMLElement | null)?.closest?.('input, textarea, .cm-editor');
    return !!x && x !== this.root && this.root.contains(x);
  }

  /** Is the target one of the canvas's own controls, or a field? Those handle their own events. */
  private inControl(target: EventTarget | null): boolean {
    const x = (target as HTMLElement | null)?.closest?.('.cv-toolbar, .cv-palette, .cv-zoom, .cv-menu');
    return (!!x && this.root.contains(x)) || this.inField(target);
  }

  private hit(ev: Event): { node?: string; edge?: string; handle?: string; port?: Side; end?: 'from' | 'to' } {
    const t = ev.target as HTMLElement | null;
    if (!t || !t.closest) return {};
    const handle = t.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const port = t.closest<HTMLElement>('[data-port]')?.dataset.port as Side | undefined;
    const node = t.closest<HTMLElement>('[data-node]')?.dataset.node;
    const edge = t.closest<SVGElement>('[data-edge]')?.dataset.edge;
    const end = t.closest<SVGElement>('[data-end]')?.dataset.end as 'from' | 'to' | undefined;
    return { node, edge, handle, port, end };
  }

  private down(ev: PointerEvent): void {
    if (this.inControl(ev.target)) return;
    this.pointers.set(ev.pointerId, this.pointOf(ev));
    if (this.pointers.size === 2) {
      // two fingers: pinch to zoom, drag to pan
      const [a, b] = [...this.pointers.values()] as [Point, Point];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), vp: { ...this.vp }, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      this.mode = { kind: 'idle' };
      return;
    }
    if (this.editing) {
      const h = this.hit(ev);
      if (h.node !== this.editing) this.stopEdit();
      else return;
    }
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture?.(ev.pointerId);
    const p = this.pointOf(ev);
    const cp = toCanvasPoint(this.vp, p);
    const h = this.hit(ev);
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (ev.button === 1 || (ev.button === 0 && ev.altKey && !h.node)) {
      this.mode = { kind: 'pan', from: p, vp: { ...this.vp } };
      return;
    }
    if (ev.button !== 0) return;
    if (this.readOnly) {
      // a click on a card goes there; dragging, even from a card, moves the view
      if (!h.node && this.selection.size > 0) this.selection.clear();
      this.mode = { kind: 'pan', from: p, vp: { ...this.vp }, ...(h.node ? { click: h.node } : {}) };
      this.render();
      return;
    }
    if (h.port && h.node) {
      this.mode = { kind: 'connect', from: h.node, side: h.port, at: cp, target: null };
      return;
    }
    if (h.end && h.edge) {
      this.selection = new Set([h.edge]);
      this.mode = { kind: 'reconnect', edge: h.edge, end: h.end, at: cp, target: null };
      this.render();
      return;
    }
    if (h.handle && h.node) {
      const n = nodeById(this.canvas, h.node) as CanvasNode;
      this.mode = { kind: 'resize', id: n.id, handle: h.handle, start: cp, rect: { x: n.x, y: n.y, width: n.width, height: n.height }, base: this.canvas };
      return;
    }
    if (h.node) {
      const n = nodeById(this.canvas, h.node);
      if (additive) {
        if (this.selection.has(h.node)) this.selection.delete(h.node);
        else this.selection.add(h.node);
      } else if (!this.selection.has(h.node)) this.selection = new Set([h.node]);
      // a group can only be picked up by its label strip, so what is inside it can still be clicked
      if (n && n.type === 'group' && !(ev.target as HTMLElement).closest('.cv-group-label, .cv-selected') && !additive) {
        const inside = this.canvas.nodes.some((m) => m.id !== n.id && m.x < cp.x && cp.x < m.x + m.width && m.y < cp.y && cp.y < m.y + m.height);
        if (inside) { this.mode = { kind: 'pan', from: p, vp: { ...this.vp } }; this.selection.clear(); this.render(); return; }
      }
      this.mode = { kind: 'move', ids: [...this.selection], start: cp, base: this.canvas, moved: false };
      this.render();
      return;
    }
    if (h.edge) {
      this.selection = additive ? new Set([...this.selection, h.edge]) : new Set([h.edge]);
      this.render();
      return;
    }
    // empty canvas
    if (ev.shiftKey) {
      this.mode = { kind: 'rubber', from: p, to: p, add: ev.ctrlKey || ev.metaKey, base: new Set(this.selection) };
      return;
    }
    if (this.selection.size > 0) {
      this.selection.clear();
      this.render();
    }
    this.mode = { kind: 'pan', from: p, vp: { ...this.vp } };
  }

  private move(ev: PointerEvent): void {
    const p = this.pointOf(ev);
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [Point, Point];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let v = zoomAt(this.pinch.vp, dist / Math.max(1, this.pinch.dist), this.pinch.center);
      v = { ...v, x: v.x + center.x - this.pinch.center.x, y: v.y + center.y - this.pinch.center.y };
      this.vp = v;
      this.render();
      return;
    }
    const m = this.mode;
    const cp = toCanvasPoint(this.vp, p);
    if (m.kind === 'pan') {
      this.vp = { ...m.vp, x: m.vp.x + p.x - m.from.x, y: m.vp.y + p.y - m.from.y };
      this.fitted = true;
      this.render();
    } else if (m.kind === 'move') {
      const dx = cp.x - m.start.x;
      const dy = cp.y - m.start.y;
      if (!m.moved && Math.hypot(dx, dy) * this.vp.zoom < 3) return;
      m.moved = true;
      const ids = m.ids.filter((id) => nodeById(m.base, id));
      let sdx = dx, sdy = dy;
      const first = nodeById(m.base, ids[0] ?? '');
      if (this.grid > 0 && first) {
        sdx = Math.round((first.x + dx) / this.grid) * this.grid - first.x;
        sdy = Math.round((first.y + dy) / this.grid) * this.grid - first.y;
      }
      this.canvas = moveNodes(m.base, ids, sdx, sdy);
      this.render();
    } else if (m.kind === 'resize') {
      this.canvas = resizeNode(m.base, m.id, resized(m.rect, m.handle, cp.x - m.start.x, cp.y - m.start.y, this.grid));
      this.render();
    } else if (m.kind === 'connect') {
      m.at = cp;
      m.target = this.targetAt(cp, [m.from]);
      this.drawEdges();
    } else if (m.kind === 'reconnect') {
      m.at = cp;
      const e = this.canvas.edges.find((x) => x.id === m.edge);
      m.target = this.targetAt(cp, e ? [m.end === 'from' ? e.toNode : e.fromNode] : []);
      this.drawEdges();
    } else if (m.kind === 'rubber') {
      m.to = p;
      const box = { x: Math.min(m.from.x, p.x), y: Math.min(m.from.y, p.y), width: Math.abs(p.x - m.from.x), height: Math.abs(p.y - m.from.y) };
      this.rubberEl.hidden = false;
      Object.assign(this.rubberEl.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
      const a = toCanvasPoint(this.vp, { x: box.x, y: box.y });
      const world = { x: a.x, y: a.y, width: box.width / this.vp.zoom, height: box.height / this.vp.zoom };
      const hits = this.canvas.nodes.filter((n) => intersects(world, n)).map((n) => n.id);
      this.selection = new Set([...(m.add ? m.base : []), ...hits]);
      this.render();
    }
  }

  private up(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    // letting go on a button of the canvas is the end of a click on it: nothing here may redraw the page before the click arrives
    if (this.mode.kind === 'idle' && this.inControl(ev.target)) return;
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const m = this.mode;
    this.mode = { kind: 'idle' };
    this.rubberEl.hidden = true;
    if (m.kind === 'pan' && m.click) {
      const q = this.pointOf(ev);
      if (Math.hypot(q.x - m.from.x, q.y - m.from.y) < 4) this.activate(m.click, ev);
    } else if (m.kind === 'move' && m.moved) {
      // the drag changed the canvas as it went; now it is one change
      const done = this.canvas;
      this.canvas = m.base;
      this.commit(done);
    } else if (m.kind === 'resize') {
      const done = this.canvas;
      this.canvas = m.base;
      this.commit(done);
    } else if (m.kind === 'connect') {
      const target = m.target ?? this.targetAt(toCanvasPoint(this.vp, this.pointOf(ev)), [m.from]);
      if (target) {
        const r = addEdge(this.canvas, m.from, target.id, { fromSide: m.side, toSide: target.side });
        if (r.id) {
          this.selection = new Set([r.id]);
          this.commit(r.canvas);
          return;
        }
      }
      this.render();
    } else if (m.kind === 'reconnect') {
      const target = m.target ?? this.targetAt(toCanvasPoint(this.vp, this.pointOf(ev)), []);
      if (target) {
        const next = reconnectEdge(this.canvas, m.edge, m.end, target.id, target.side);
        if (next !== this.canvas) {
          this.commit(next);
          return;
        }
      }
      this.render();
    } else {
      this.render();
    }
    this.root.releasePointerCapture?.(ev.pointerId);
  }

  /** View mode: a click on a card. A page opens, an address opens, a link inside the text of a card is followed. */
  private activate(id: string, ev: PointerEvent): void {
    const n = nodeById(this.canvas, id);
    if (!n) return;
    this.selection = new Set([id]);
    this.render();
    if (n.type === 'file') this.host.openFile(n);
    else if (n.type === 'link') this.host.openUrl(n.url);
    else if (n.type === 'text') {
      const under = this.root.ownerDocument.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (under) this.host.followIn?.(under);
    }
  }

  private dbl(ev: MouseEvent): void {
    if (this.readOnly) return;
    if (this.inControl(ev.target)) return;
    const h = this.hit(ev);
    if (h.node) {
      const n = nodeById(this.canvas, h.node);
      if (n?.type === 'text') this.startEdit(n.id);
      else if (n?.type === 'file') this.host.openFile(n);
      else if (n?.type === 'link') this.host.openUrl(n.url);
      else if (n?.type === 'group') this.editGroupLabel(n.id);
      return;
    }
    if (h.edge) {
      const e = this.canvas.edges.find((x) => x.id === h.edge);
      if (e) this.editEdgeLabel(e);
      return;
    }
    this.addText(toCanvasPoint(this.vp, this.pointOf(ev)));
  }

  private editGroupLabel(id: string): void {
    const n = nodeById(this.canvas, id);
    if (!n || n.type !== 'group') return;
    const d = this.root.ownerDocument;
    const input = d.createElement('input');
    input.className = 'cv-edge-input';
    input.value = typeof n.label === 'string' ? n.label : '';
    input.setAttribute('aria-label', 'Name of the group');
    input.style.left = `${n.x * this.vp.zoom + this.vp.x + 8}px`;
    input.style.top = `${n.y * this.vp.zoom + this.vp.y - 4}px`;
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      if (save) this.commit(updateNode(this.canvas, id, { label: v === '' ? undefined : v }));
      this.root.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.overlay.append(input);
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------- the right-click menu

  closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private contextMenu(ev: MouseEvent): void {
    this.closeMenu();
    if (this.readOnly) return;
    const h = this.hit(ev);
    const at = toCanvasPoint(this.vp, this.pointOf(ev));
    if (h.node && !this.selection.has(h.node)) this.selection = new Set([h.node]);
    else if (h.edge && !h.node && !this.selection.has(h.edge)) this.selection = new Set([h.edge]);
    else if (!h.node && !h.edge) this.selection.clear();
    this.render();
    const nodes = this.canvas.nodes.filter((n) => this.selection.has(n.id));
    const edges = this.canvas.edges.filter((e) => this.selection.has(e.id));
    type Item = { label: string; run?: () => void; danger?: boolean; head?: boolean; sep?: boolean };
    const items: Item[] = [];
    const sep = (): void => void (items.length > 0 && !items[items.length - 1]?.sep && items.push({ label: '', sep: true }));
    if (nodes.length === 1) {
      const n = nodes[0] as CanvasNode;
      if (n.type === 'text') items.push({ label: 'Edit', run: () => this.startEdit(n.id) });
      else if (n.type === 'file') items.push({ label: 'Open Page', run: () => this.host.openFile(n) });
      else if (n.type === 'link') items.push({ label: 'Open Link', run: () => this.host.openUrl(n.url) });
      else if (n.type === 'group') items.push({ label: 'Rename Group', run: () => this.editGroupLabel(n.id) });
    }
    if (nodes.length > 1) {
      items.push({ label: 'Align', head: true });
      for (const [label, how] of [['Align Left', 'left'], ['Align Horizontal Center', 'hcenter'], ['Align Right', 'right'], ['Align Top', 'top'], ['Align Vertical Center', 'vcenter'], ['Align Bottom', 'bottom']] as const) items.push({ label, run: () => this.align(how) });
      if (nodes.length > 2) {
        items.push({ label: 'Space Evenly Across', run: () => this.distribute('horizontal') });
        items.push({ label: 'Space Evenly Down', run: () => this.distribute('vertical') });
      }
    }
    if (nodes.length > 0) {
      sep();
      items.push({ label: 'Duplicate', run: () => this.duplicate() }, { label: 'Group', run: () => this.groupSelection() });
      if (nodes.length === 1 && nodes[0]!.type === 'text') items.push({ label: 'Insert Image…', run: () => void this.insertImage(nodes[0]!.id) });
      items.push({ label: 'Set Background Image…', run: () => void this.chooseBackgroundImage() });
      if (nodes.some((n) => typeof n.background === 'string' && n.background !== '')) items.push({ label: 'Remove Background Image', run: () => this.setBackgroundImage(null) });
      items.push({ label: 'Bring to Front', run: () => this.commit(bringToFront(this.canvas, nodes.map((n) => n.id))) }, { label: 'Send to Back', run: () => this.commit(sendToBack(this.canvas, nodes.map((n) => n.id))) });
    }
    if (edges.length > 0 && nodes.length === 0) {
      const e = edges[0] as CanvasEdge;
      items.push({ label: 'Edit Label', run: () => this.editEdgeLabel(e) }, { label: `Arrowheads (${arrowGlyph(e)}): Next`, run: () => this.cycleArrowheads() });
    }
    if (nodes.length > 0 || edges.length > 0) {
      sep();
      items.push({ label: 'Delete', danger: true, run: () => this.deleteSelection() });
    }
    if (!h.node && !h.edge) {
      items.push({ label: 'Add Note Card Here', run: () => this.addText(at) }, { label: 'Add Page…', run: () => void this.addFile(at) }, { label: 'Add Web Link…', run: () => void this.addLink(at) }, { label: 'Add Group Here', run: () => this.addEmptyGroup(at) });
      sep();
      items.push({ label: 'Select All', run: () => this.select(this.canvas.nodes.map((n) => n.id)) }, { label: 'Show Everything', run: () => this.fit() });
    }
    const d = this.root.ownerDocument;
    const menu = d.createElement('div');
    menu.className = 'cv-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      if (it.sep) {
        const l = d.createElement('div');
        l.className = 'cv-menu-sep';
        menu.append(l);
      } else if (it.head) {
        const l = d.createElement('div');
        l.className = 'cv-menu-head';
        l.textContent = it.label;
        menu.append(l);
      } else {
        const b = d.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = `cv-menu-item${it.danger ? ' cv-danger' : ''}`;
        b.textContent = it.label;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeMenu();
          it.run?.();
        });
        menu.append(b);
      }
    }
    const p = this.pointOf(ev);
    menu.style.left = `${p.x}px`;
    menu.style.top = `${p.y}px`;
    this.root.append(menu);
    this.menu = menu;
    const box = this.root.getBoundingClientRect();
    const mb = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(p.x, box.width - mb.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(p.y, box.height - mb.height - 4))}px`;
    (menu.querySelector('.cv-menu-item') as HTMLElement | null)?.focus();
    menu.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.closeMenu();
        this.root.focus({ preventScroll: true });
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = [...menu.querySelectorAll<HTMLElement>('.cv-menu-item')];
        const i = all.indexOf(d.activeElement as HTMLElement);
        all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
      }
    });
  }

  private wheel(ev: WheelEvent): void {
    // a canvas inside a page lets the wheel scroll the page; Ctrl+wheel zooms it
    if (this.embedded && !(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const p = this.pointOf(ev);
    if (ev.ctrlKey || ev.metaKey) {
      this.vp = zoomAt(this.vp, Math.exp(-ev.deltaY * 0.01), p);
    } else {
      this.vp = { ...this.vp, x: this.vp.x - ev.deltaX, y: this.vp.y - ev.deltaY };
    }
    this.fitted = true;
    this.render();
  }

  private key(ev: KeyboardEvent): void {
    if (this.editing || this.inField(ev.target)) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const sel = this.canvas.nodes.filter((n) => this.selection.has(n.id));
    const handled = (): void => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    if (mod && ev.key.toLowerCase() === 'a') {
      this.selection = new Set(this.canvas.nodes.map((n) => n.id));
      this.render();
      return handled();
    }
    if (ev.key === 'Escape') {
      if (this.selection.size > 0) { this.selection.clear(); this.render(); handled(); }
      return;
    }
    if (ev.key === '+' || ev.key === '=') { this.zoomBy(1.25); return handled(); }
    if (ev.key === '-' || ev.key === '_') { this.zoomBy(0.8); return handled(); }
    if (ev.key === 'Home' || (ev.key === '0' && !mod)) { this.fit(); return handled(); }
    if (this.readOnly) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (this.selection.size > 0) { this.deleteSelection(); handled(); }
      return;
    }
    if (mod && ev.key.toLowerCase() === 'd') { this.duplicate(); return handled(); }
    if (mod && ev.key.toLowerCase() === 'g') { this.groupSelection(); return handled(); }
    if (mod && ev.key === ']') { this.commit(bringToFront(this.canvas, sel.map((n) => n.id))); return handled(); }
    if (mod && ev.key === '[') { this.commit(sendToBack(this.canvas, sel.map((n) => n.id))); return handled(); }
    if (ev.key === 'Enter' && sel.length === 1 && sel[0]?.type === 'text') { this.startEdit(sel[0].id); return handled(); }
    if (ev.key === 'Enter' && sel.length === 1 && sel[0]?.type === 'file') { this.host.openFile(sel[0]); return handled(); }
    const step = ev.shiftKey ? 50 : this.grid > 0 ? this.grid : 10;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = dir[ev.key];
    if (d && sel.length > 0) {
      this.commit(moveNodes(this.canvas, sel.map((n) => n.id), d[0], d[1]));
      return handled();
    }
  }
}

// ---------------------------------------------------------------- helpers

function sideChoice(a: Rect, b: Rect): { from: Side; to: Side } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

/** The side of a node nearest a point. */
export function nearestSide(n: Rect, p: Point): Side {
  const d: Record<Side, number> = { left: Math.abs(p.x - n.x), right: Math.abs(p.x - (n.x + n.width)), top: Math.abs(p.y - n.y), bottom: Math.abs(p.y - (n.y + n.height)) };
  return (Object.keys(d) as Side[]).reduce((best, s) => (d[s] < d[best] ? s : best), 'left' as Side);
}

/** The box a node has after one of its handles is dragged by (dx, dy). */
export function resized(r: Rect, handle: string, dx: number, dy: number, grid = 0): Rect {
  let { x, y, width, height } = r;
  if (handle.includes('e')) width += dx;
  if (handle.includes('s')) height += dy;
  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('n')) { y += dy; height -= dy; }
  if (grid > 0) {
    const sx = Math.round(x / grid) * grid, sy = Math.round(y / grid) * grid;
    width += x - sx; height += y - sy; x = sx; y = sy;
    width = Math.round(width / grid) * grid; height = Math.round(height / grid) * grid;
  }
  return { x, y, width, height };
}

/** Black or white, whichever reads better on a `#rrggbb` colour (null when it is not one). */
export function inkOn(css: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return null;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? '#1e1e1e' : '#ffffff';
}

/** The look of an arrow's ends as a glyph: → ← ↔ or a bare line. */
export function arrowGlyph(e: CanvasEdge): string {
  const a = arrowEnds(e);
  return a.from && a.to ? '↔' : a.to ? '→' : a.from ? '←' : '—';
}

let styled = new WeakSet<Document>();
function ensureStyle(doc: Document): void {
  if (styled.has(doc)) return;
  styled.add(doc);
  const s = doc.createElement('style');
  s.dataset.canvas = '';
  s.textContent = CANVAS_CSS;
  doc.head.append(s);
}

export { MAX_ZOOM, MIN_ZOOM };
