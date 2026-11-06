/**
 * Keeps every workspace on this computer indexed, not only the ones in tabs, so that what one workspace asks of another
 * (a saved query of another workspace in a view, a relation that reaches into it) is answered from an index that is
 * current. The workspace the person is working in always comes first: nothing else is opened until its own index is ready.
 *
 * A workspace that is open has a process that watches its folder, so once opened it stays current by itself. Now and then
 * (`refreshMs`) every one is also asked to look for changes the watcher may have missed: a sync tool replacing files,
 * a network folder. A workspace that cannot be opened (a drive that is not there) is tried again after `retryMs`.
 */
export interface BackgroundDeps {
  /** the workspaces on this computer, the most recently used first */
  list(): Promise<string[]>;
  /** open a workspace (once) and resolve when its index is ready; reject when it cannot be opened */
  open(root: string): Promise<void>;
  /** look for changes made outside the app */
  refresh(root: string): Promise<void>;
  /** resolves when the workspace in front has its index ready (at once when there is none) */
  frontReady(): Promise<void>;
  enabled(): boolean;
  log?(message: string): void;
}

export interface BackgroundOptions {
  /** how often the open ones are asked to look for changes */
  refreshMs?: number;
  /** how long to wait before trying a workspace that could not be opened */
  retryMs?: number;
  /** a rest between one workspace and the next, so the window stays quick */
  pauseMs?: number;
  /** at most this many workspaces are kept open */
  max?: number;
}

export class BackgroundIndexer {
  private readonly opts: Required<BackgroundOptions>;
  private opened = new Set<string>();
  private failed = new Map<string, number>();
  private stopped = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  /** a workspace has just been indexed when it is opened, so the first look for changes is one interval away */
  private lastRefresh: number;
  private wake: (() => void) | null = null;

  constructor(
    private readonly deps: BackgroundDeps,
    options: BackgroundOptions = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastRefresh = now();
    this.opts = { refreshMs: options.refreshMs ?? 10 * 60_000, retryMs: options.retryMs ?? 5 * 60_000, pauseMs: options.pauseMs ?? 300, max: options.max ?? 30 };
  }

  /** The workspaces opened for this (the window keeps them open even without a tab). */
  get keeping(): ReadonlySet<string> {
    return this.opened;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wake?.();
  }

  /** Forget the workspaces opened for this (the caller closes the ones it does not need) and return them. */
  release(): string[] {
    const roots = [...this.opened];
    this.opened.clear();
    this.failed.clear();
    return roots;
  }

  /** Something changed (the setting, a workspace was added): look again soon. */
  poke(): void {
    if (this.stopped || !this.started) return;
    this.schedule(0);
  }

  /** For tests and for "now": run one pass and wait for it. */
  async pass(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pass().finally(() => {
        if (!this.stopped) this.schedule(Math.min(this.opts.refreshMs, 60_000));
      });
    }, ms);
  }

  private async rest(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      setTimeout(resolve, this.opts.pauseMs);
    });
    this.wake = null;
  }

  private async run(): Promise<void> {
    if (!this.deps.enabled()) return;
    await this.deps.frontReady();
    const roots = (await this.deps.list()).slice(0, this.opts.max);
    for (const root of roots) {
      if (this.stopped || !this.deps.enabled()) return;
      if (this.opened.has(root)) continue;
      const failedAt = this.failed.get(root);
      if (failedAt !== undefined && this.now() - failedAt < this.opts.retryMs) continue;
      // the workspace in front always goes first: if the person moved to one that is still indexing, wait for it
      await this.deps.frontReady();
      try {
        await this.deps.open(root);
        this.opened.add(root);
        this.failed.delete(root);
      } catch (e) {
        this.failed.set(root, this.now());
        this.deps.log?.(`${root} could not be indexed in the background: ${e instanceof Error ? e.message : String(e)}`);
      }
      await this.rest();
    }
    if (this.now() - this.lastRefresh >= this.opts.refreshMs) {
      this.lastRefresh = this.now();
      for (const root of [...this.opened]) {
        if (this.stopped || !this.deps.enabled()) return;
        await this.deps.frontReady();
        await this.deps.refresh(root).catch((e: unknown) => this.deps.log?.(`${root}: ${e instanceof Error ? e.message : String(e)}`));
        await this.rest();
      }
    }
  }
}
