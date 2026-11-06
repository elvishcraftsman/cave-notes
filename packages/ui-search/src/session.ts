export interface SearchHit {
  id: number;
  path: string;
  title: string;
  isVirtual: boolean;
  snippet: string | null;
}

export interface SearchOutcome<R extends SearchHit = SearchHit> {
  results: R[];
  total: number | null;
  errors: string[];
}

export interface SessionState<R extends SearchHit = SearchHit> {
  query: string;
  loading: boolean;
  results: R[];
  total: number | null;
  errors: string[];
  /** true once at least one search for a non-empty query has completed */
  searched: boolean;
  failure: string | null;
}

export interface SessionOptions<R extends SearchHit = SearchHit> {
  run: (query: string, opts: { limit: number }) => Promise<SearchOutcome<R>>;
  onChange: (state: SessionState<R>) => void;
  /** wait after the last keystroke before searching (ms) */
  delay?: number;
  limit?: number;
}

/**
 * Search as you type: debounced, and a newer query always wins. Responses to older queries are
 * dropped, so slow results never overwrite fresh ones and typing is never blocked.
 */
export class SearchSession<R extends SearchHit = SearchHit> {
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  state: SessionState<R> = { query: '', loading: false, results: [], total: null, errors: [], searched: false, failure: null };

  constructor(private readonly o: SessionOptions<R>) {}

  setQuery(query: string, immediate = false): void {
    if (this.disposed) return;
    const seq = ++this.seq;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (query.trim() === '') {
      this.set({ query, loading: false, results: [], total: null, errors: [], searched: false, failure: null });
      return;
    }
    this.set({ query, loading: true });
    const go = (): void => {
      this.timer = null;
      this.o.run(query, { limit: this.o.limit ?? 50 }).then(
        (r) => {
          if (seq === this.seq && !this.disposed) this.set({ loading: false, results: r.results, total: r.total, errors: r.errors, searched: true, failure: null });
        },
        (e: unknown) => {
          if (seq === this.seq && !this.disposed) this.set({ loading: false, searched: true, failure: e instanceof Error ? e.message : String(e) });
        },
      );
    };
    if (immediate) go();
    else this.timer = setTimeout(go, this.o.delay ?? 40);
  }

  /** Re-run the current query (after the index changed). */
  refresh(): void {
    if (this.state.query.trim() !== '') this.setQuery(this.state.query, true);
  }

  dispose(): void {
    this.disposed = true;
    this.seq++;
    if (this.timer) clearTimeout(this.timer);
  }

  private set(patch: Partial<SessionState<R>>): void {
    this.state = { ...this.state, ...patch };
    this.o.onChange(this.state);
  }
}
