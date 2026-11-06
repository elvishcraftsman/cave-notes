// The service runs in a Web Worker, but the Capacitor plugin can only be reached from the page, so every file operation the
// worker makes goes through the page's main thread. Indexing a big workspace is thousands of them in a burst, and the page
// (typing, scrolling, Android's "not responding" check) has to share that thread. This keeps the burst to a few operations at
// a time and gives the page a turn every so often.

/** Wrap every function of `fs` so that at most `max` run at once, and the page gets a turn after every `breathe` of them. */
export interface FsTiming {
  (op: string, target: string, waitMs: number, runMs: number, bytes: number, state: { running: number; queued: number }): void;
}

export function limitFs<T extends object>(fs: T, { max = 3, breathe = 12, onDone }: { max?: number; breathe?: number; onDone?: FsTiming } = {}): T {
  let running = 0;
  let sinceTurn = 0;
  const waiting: Array<() => void> = [];
  const next = (): void => {
    while (running < max && waiting.length) {
      running++;
      waiting.shift()!();
    }
  };
  const run = async <R>(job: () => Promise<R>, label?: { op: string; target: string }): Promise<R> => {
    const asked = Date.now();
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    const started = Date.now();
    let bytes = 0;
    try {
      if (++sinceTurn >= breathe) {
        sinceTurn = 0;
        await new Promise<void>((r) => setTimeout(r, 0)); // a macrotask: input and drawing go first
      }
      const out = await job();
      const o = out as unknown;
      if (typeof o === 'string') bytes = o.length;
      else if (o && typeof (o as { byteLength?: unknown }).byteLength === 'number') bytes = (o as { byteLength: number }).byteLength;
      else if (Array.isArray(o)) bytes = o.length * 40;
      return out;
    } finally {
      running--;
      onDone?.(label?.op ?? '?', label?.target ?? '', started - asked, Date.now() - started, bytes, { running, queued: waiting.length });
      next();
    }
  };
  return new Proxy(fs, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver) as unknown;
      if (typeof v === 'function') return (...args: unknown[]) => run(async () => (v as (...a: unknown[]) => unknown).apply(target, args) as Promise<unknown>, { op: String(key), target: typeof args[0] === 'string' ? args[0].replace(/^\/storage\/emulated\/0\//, '') : '' });
      return v;
    },
  });
}
