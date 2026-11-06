/**
 * A framework-free tree model for hierarchical pages.
 *
 * Paths are page paths like "Theology/Soteriology.md"; the children of a page live under the
 * page's path minus ".md". Children are loaded lazily and cached. The model exposes a flat list of
 * visible rows (for virtualized rendering) and implements the keyboard behaviour:
 *
 *   Up / Down   move the selection (and ask the UI to open that page)
 *   Right       expand the selected node; if already expanded, go to its first child
 *   Left        collapse the selected node; if already collapsed (or a leaf), go to its parent
 *   Home / End  first / last visible row
 */

export interface TreeNodeData {
  path: string;
  name: string;
  /** false for a "virtual" page: a folder with no page file of its own */
  exists: boolean;
  hasChildren: boolean;
  /** a template page (`template: true`), shown only when templates are asked for */
  template?: boolean;
  /** hidden from the tree (or a template), shown only when those pages are asked for */
  unlisted?: boolean;
  /** an icon name the page asks for (`icon:` attribute) */
  icon?: string;
}

export interface TreeRow extends TreeNodeData {
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export type TreeAction =
  | { type: 'open'; path: string }
  | { type: 'focus-editor'; path: string }
  | { type: 'rename'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'new-child'; path: string | null };

export interface TreeOptions {
  /** Load the children of a page (null = workspace root). */
  load(parent: string | null): Promise<TreeNodeData[]>;
}

const ROOT = '';

export type DropZone = 'before' | 'after' | 'into';

/** Where a dragged page lands: under `parent` (null = top level), in front of `before` (null = at the end). */
export interface DropPlan {
  parent: string | null;
  before: string | null;
}

/** `A/B.md` -> `A/B`, `A/B.txt` -> `A/B` (the folder that holds the page's sub-pages). */
const folderOf = (path: string): string => path.replace(/\.[^./]+$/, '');
const extensionOf = (path: string): string => /\.[^./]+$/.exec(path)?.[0] ?? '.md';

const isInside = (candidate: string, ancestor: string): boolean => candidate === ancestor || candidate.startsWith(`${folderOf(ancestor)}/`);

/**
 * `A/B/C.md` -> `A/B.md`; top-level pages have no parent. The parent is given the page's own extension: when it
 * has another one (a .txt page under a .md page) the model looks the real one up (see TreeModel).
 */
export function parentOf(path: string): string | null {
  const i = path.lastIndexOf('/');
  return i < 0 ? null : `${path.slice(0, i)}${extensionOf(path)}`;
}

export class TreeModel {
  private readonly load: TreeOptions['load'];

  /** The page above `path`: the node that is loaded under any extension, else the one the extension of `path` suggests. */
  parentPath(path: string): string | null {
    const guess = parentOf(path);
    if (guess === null || this.nodes.has(guess)) return guess;
    const stem = guess.replace(/\.[^./]+$/, '');
    for (const key of this.nodes.keys()) if (key.length > stem.length && key.startsWith(`${stem}.`) && folderOf(key) === stem) return key;
    return guess;
  }
  private children = new Map<string, TreeNodeData[]>();
  private nodes = new Map<string, TreeNodeData>();
  private loading = new Set<string>();
  private listeners = new Set<() => void>();

  readonly expanded = new Set<string>();
  /** when each branch without anything open in it was first seen that way */
  private idleSince = new Map<string, number>();
  selected: string | null = null;
  rows: TreeRow[] = [];

  constructor(options: TreeOptions) {
    this.load = options.load;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.rebuild();
    for (const fn of this.listeners) fn();
  }

  private key(parent: string | null): string {
    return parent ?? ROOT;
  }

  /** Load the root (and any previously expanded nodes) and build rows. */
  async init(expanded: Iterable<string> = []): Promise<void> {
    this.children.clear();
    this.nodes.clear();
    await this.ensureLoaded(null);
    // Restore expansion top-down so every ancestor is loaded before its children.
    const wanted = [...expanded].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const p of wanted) {
      const parent = this.parentPath(p);
      if (parent !== null && !this.expanded.has(parent)) continue;
      if (this.nodes.get(p)?.hasChildren) {
        this.expanded.add(p);
        await this.ensureLoaded(p);
      }
    }
    this.emit();
  }

  /** The branches that are open now, to give back later with setExpanded (each tab keeps its own). */
  expandedPaths(): string[] {
    return [...this.expanded];
  }

  /** Open exactly these branches (paths that no longer lead anywhere are skipped), keeping what is loaded. */
  async setExpanded(paths: Iterable<string>): Promise<void> {
    this.expanded.clear();
    this.idleSince.clear();
    const wanted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const p of wanted) {
      const parent = this.parentPath(p);
      if (parent !== null && !this.expanded.has(parent)) continue;
      if (!this.nodes.has(p)) continue;
      try {
        if (this.nodes.get(p)?.hasChildren) {
          this.expanded.add(p);
          await this.ensureLoaded(p);
        }
      } catch {
        this.expanded.delete(p);
      }
    }
    this.emit();
  }

  private async ensureLoaded(parent: string | null, notify = false): Promise<void> {
    const k = this.key(parent);
    if (this.children.has(k) || this.loading.has(k)) return;
    this.loading.add(k);
    if (notify) this.emit();
    try {
      const items = await this.load(parent);
      this.children.set(k, items);
      for (const it of items) this.nodes.set(it.path, it);
    } finally {
      this.loading.delete(k);
    }
  }

  private rebuild(): void {
    const rows: TreeRow[] = [];
    const walk = (parent: string | null, depth: number): void => {
      for (const n of this.children.get(this.key(parent)) ?? []) {
        const expanded = this.expanded.has(n.path) && n.hasChildren;
        rows.push({ ...n, depth, expanded, loading: this.loading.has(n.path) });
        if (expanded) walk(n.path, depth + 1);
      }
    };
    walk(null, 0);
    this.rows = rows;
  }

  /** The loaded children of a page (null = root), in display order. */
  siblings(parent: string | null): TreeNodeData[] {
    return this.children.get(this.key(parent)) ?? [];
  }

  /**
   * Turn "dropped on the top edge / bottom edge / middle of this row" into a destination, or null
   * when it makes no sense (inside itself) or would change nothing.
   */
  resolveDrop(src: string, over: string, zone: DropZone): DropPlan | null {
    if (isInside(over, src)) return null;
    let plan: DropPlan;
    if (zone === 'into') plan = { parent: over, before: null };
    else if (zone === 'before') plan = { parent: this.parentPath(over), before: over };
    else {
      const node = this.nodes.get(over);
      if (node?.hasChildren && this.expanded.has(over) && this.siblings(over).length > 0) {
        plan = { parent: over, before: this.siblings(over)[0]?.path ?? null };
      } else {
        const sibs = this.siblings(this.parentPath(over));
        const i = sibs.findIndex((n) => n.path === over);
        plan = { parent: this.parentPath(over), before: sibs[i + 1]?.path ?? null };
      }
    }
    if (plan.parent !== null && isInside(plan.parent, src)) return null;
    if (plan.before === src) return null;
    if (plan.parent === this.parentPath(src)) {
      const sibs = this.siblings(plan.parent);
      const i = sibs.findIndex((n) => n.path === src);
      const next = i >= 0 ? (sibs[i + 1]?.path ?? null) : undefined;
      if (zone !== 'into' && next === plan.before) return null;
      if (zone === 'into') return null;
    }
    return plan;
  }

  /** Dropped below the last row: to the end of the top level. Null when it is already there. */
  resolveDropEnd(src: string): DropPlan | null {
    const top = this.siblings(null);
    if (this.parentPath(src) === null && top[top.length - 1]?.path === src) return null;
    return { parent: null, before: null };
  }

  /** Parents whose children are currently loaded (null = the root). */
  loadedParents(): Array<string | null> {
    return [...this.children.keys()].map((k) => (k === ROOT ? null : k));
  }

  get(path: string): TreeNodeData | undefined {
    return this.nodes.get(path);
  }

  indexOf(path: string | null): number {
    return path === null ? -1 : this.rows.findIndex((r) => r.path === path);
  }

  async expand(path: string): Promise<void> {
    const n = this.nodes.get(path);
    if (!n?.hasChildren) return;
    this.expanded.add(path);
    try {
      await this.ensureLoaded(path, true); // shows the node as loading while its children arrive
    } catch (e) {
      // loading failed: do not leave the node looking expanded and empty; the next click tries again
      this.expanded.delete(path);
      this.emit();
      throw e;
    }
    this.emit();
  }

  collapse(path: string): void {
    if (this.expanded.delete(path)) this.emit();
  }

  async toggle(path: string): Promise<void> {
    if (this.expanded.has(path)) this.collapse(path);
    else await this.expand(path);
  }

  select(path: string | null): void {
    if (this.selected === path) return;
    this.selected = path;
    this.emit();
  }

  /** Expand every ancestor of `path`, then select it. Used when opening a page from a link. */
  async reveal(path: string): Promise<void> {
    const chain: string[] = [];
    for (let p = this.parentPath(path); p !== null; p = this.parentPath(p)) chain.unshift(p);
    for (const a of chain) {
      await this.ensureLoaded(this.parentPath(a));
      this.expanded.add(a);
      await this.ensureLoaded(a);
    }
    this.selected = path;
    this.emit();
  }

  /**
   * Reload the children of the given pages (null = root) after something changed on disk.
   * Parents that were never loaded are ignored. Expanded nodes that disappeared are dropped.
   */
  async refresh(parents: Array<string | null>): Promise<void> {
    const unique = [...new Set(parents.map((p) => this.key(p)))];
    for (const k of unique) {
      if (!this.children.has(k)) continue;
      const parent = k === ROOT ? null : k;
      const items = await this.load(parent);
      const before = this.children.get(k) ?? [];
      for (const gone of before) if (!items.some((i) => i.path === gone.path)) this.forget(gone.path);
      this.children.set(k, items);
      for (const it of items) this.nodes.set(it.path, it);
    }
    // A node that lost all its children can no longer be expanded.
    for (const p of [...this.expanded]) if (!this.nodes.get(p)?.hasChildren) this.expanded.delete(p);
    // Keep expanded nodes loaded.
    for (const p of this.expanded) await this.ensureLoaded(p);
    if (this.selected && !this.nodes.has(this.selected)) this.selected = null;
    this.emit();
  }

  /**
   * Collapse branches that have had nothing open in them for `delayMs`. `keep` are the pages that are
   * open (or selected). Only the outermost idle branch of a chain is collapsed, and its descendants
   * keep their own expanded state, so opening it again shows the way back to where you were.
   * Returns the paths collapsed. Call it periodically.
   */
  sweepIdle(keep: Iterable<string>, now: number, delayMs: number): string[] {
    const open = [...keep];
    // a branch is held when an open page is inside it, or is the page whose branch it is: the open page keeps its own
    // sub-pages showing. The sub-branches below it are not held by that, so they collapse like any other idle branch.
    const holdsOpen = (path: string): boolean => open.some((p) => isInside(p, path));
    const idle: string[] = [];
    const visit = (parent: string | null): void => {
      for (const n of this.children.get(this.key(parent)) ?? []) {
        if (!this.expanded.has(n.path) || !n.hasChildren) continue;
        if (holdsOpen(n.path)) visit(n.path);
        else idle.push(n.path); // everything below it is idle too: not visited, so only this one counts
      }
    };
    visit(null);
    const idleSet = new Set(idle);
    for (const p of [...this.idleSince.keys()]) if (!idleSet.has(p)) this.idleSince.delete(p);
    const due: string[] = [];
    for (const p of idle) {
      const since = this.idleSince.get(p) ?? now;
      this.idleSince.set(p, since);
      if (now - since >= delayMs) due.push(p);
    }
    for (const p of due) {
      this.expanded.delete(p);
      this.idleSince.delete(p);
    }
    if (due.length) this.emit();
    return due;
  }

  /** Drop everything cached for a page that no longer exists, and for its descendants. */
  private forget(path: string): void {
    const prefix = `${folderOf(path)}/`;
    const under = (k: string): boolean => k === path || k.startsWith(prefix);
    for (const k of [...this.nodes.keys()]) if (under(k)) this.nodes.delete(k);
    for (const k of [...this.children.keys()]) if (under(k)) this.children.delete(k);
    for (const k of [...this.expanded]) if (under(k)) this.expanded.delete(k);
    for (const k of [...this.idleSince.keys()]) if (under(k)) this.idleSince.delete(k);
  }

  /**
   * Handle a navigation key. Returns an action for the UI to carry out (open a page, focus the
   * editor, ...) or null when the key changed nothing / is not handled.
   */
  async handleKey(key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): Promise<TreeAction | null> {
    const i = this.indexOf(this.selected);
    const row = i >= 0 ? this.rows[i] : undefined;
    const open = (path: string): TreeAction => ({ type: 'open', path });
    const go = (j: number): TreeAction | null => {
      const target = this.rows[Math.max(0, Math.min(this.rows.length - 1, j))];
      if (!target || target.path === this.selected) return null;
      this.select(target.path);
      return open(target.path);
    };

    switch (key) {
      case 'ArrowDown':
        return go(i < 0 ? 0 : i + 1);
      case 'ArrowUp':
        return go(i < 0 ? 0 : i - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(this.rows.length - 1);
      case 'ArrowRight':
        if (!row) return go(0);
        if (row.hasChildren && !row.expanded) {
          await this.expand(row.path);
          return null;
        }
        if (row.expanded) {
          const child = this.rows[i + 1];
          if (child && child.depth > row.depth) {
            this.select(child.path);
            return open(child.path);
          }
        }
        return null;
      case 'ArrowLeft': {
        if (!row) return null;
        if (row.expanded) {
          this.collapse(row.path);
          return null;
        }
        const parent = this.parentPath(row.path);
        if (parent !== null && this.nodes.has(parent)) {
          this.select(parent);
          return open(parent);
        }
        return null;
      }
      case 'Enter':
        return row ? { type: 'focus-editor', path: row.path } : null;
      case 'F2':
        return row ? { type: 'rename', path: row.path } : null;
      case 'Delete':
        return row ? { type: 'delete', path: row.path } : null;
      case 'n':
      case 'N':
        if (mods.ctrl) return { type: 'new-child', path: mods.shift ? null : (row?.path ?? null) };
        return null;
      default:
        return null;
    }
  }
}
