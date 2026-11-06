/**
 * One small logger for every Node-side process (main, workspace workers). Lines are appended to a single file so a
 * whole session can be pasted in one piece:
 *
 *   2026-10-12T21:04:11.532Z INFO  [main      ] window created id=1 tabs=2
 *   2026-10-12T21:04:12.001Z WARN  [ws:Bible  ] readPage: file missing page=Genesis.md abs=/home/…/Genesis.md
 *
 * Levels: error < warn < info < debug < trace. The default is `info`; `CAVE_LOG=debug` (or the Help menu's
 * "Verbose Logging") turns on more. Note text is never logged, only paths, counts, durations and error messages.
 */
import { fsSync as fs, path } from '@cave-notes/platform';

export type Level = 'error' | 'warn' | 'info' | 'debug' | 'trace';
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const MAX_BYTES = 3 * 1024 * 1024;

export const isLevel = (x: unknown): x is Level => typeof x === 'string' && x in ORDER;

let file: string | null = null;
let level: Level = 'info';
let tag = 'proc';
let mirror = true;
let sink: ((line: string) => void) | null = null;

/** Where this process writes. `proc` names it in every line (padded). */
export function configureLog(opts: { file?: string | null; level?: Level; tag?: string; mirror?: boolean; sink?: ((line: string) => void) | null }): void {
  if (opts.sink !== undefined) sink = opts.sink;
  if (opts.tag !== undefined) tag = opts.tag;
  if (opts.level !== undefined) level = opts.level;
  if (opts.mirror !== undefined) mirror = opts.mirror;
  if (opts.file !== undefined) {
    file = opts.file;
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      } catch {
        file = null;
      }
    }
  }
}

/** Start a fresh file when the old one is large (keeps one previous generation: `<file>.1`). Call once at startup, in main only. */
export function rotateLog(): void {
  if (!file) return;
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    /* no log yet */
  }
}

export const logFile = (): string | null => file;
export const logLevel = (): Level => level;
export const setLogLevel = (l: Level): void => void (level = l);
export const logEnabled = (l: Level): boolean => ORDER[l] <= ORDER[level];

const fmt = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split('\n').slice(1, 6).join('\n')}` : ''}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function write(l: Level, who: string | undefined, parts: unknown[]): void {
  if (ORDER[l] > ORDER[level]) return;
  const line = `${new Date().toISOString()} ${l.toUpperCase().padEnd(5)} [${(who ?? tag).padEnd(10)}] ${parts.map(fmt).join(' ')}\n`;
  if (file) {
    try {
      fs.appendFileSync(file, line);
    } catch {
      /* a log must never take the app down */
    }
  }
  if (sink) {
    try {
      sink(line);
    } catch {
      /* a log must never take the app down */
    }
  }
  if (mirror) {
    // no process streams in a WebView: the console takes the line instead
    if (typeof process !== 'undefined' && process.stdout) (l === 'error' || l === 'warn' ? process.stderr : process.stdout).write(line);
    else (l === 'error' ? console.error : l === 'warn' ? console.warn : console.log)(line.trimEnd());
  }
}

export const log = {
  error: (...p: unknown[]): void => write('error', undefined, p),
  warn: (...p: unknown[]): void => write('warn', undefined, p),
  info: (...p: unknown[]): void => write('info', undefined, p),
  debug: (...p: unknown[]): void => write('debug', undefined, p),
  trace: (...p: unknown[]): void => write('trace', undefined, p),
  /** A logger that names a different source (for example one per renderer window). */
  as(who: string) {
    return {
      error: (...p: unknown[]): void => write('error', who, p),
      warn: (...p: unknown[]): void => write('warn', who, p),
      info: (...p: unknown[]): void => write('info', who, p),
      debug: (...p: unknown[]): void => write('debug', who, p),
      trace: (...p: unknown[]): void => write('trace', who, p),
    };
  },
};

/**
 * Report when this process's event loop is blocked for a while: a timer that should fire every second and is late
 * by `thresholdMs` means something ran synchronously for that long. Returns a stop function.
 */
export function watchEventLoop(thresholdMs = 250): () => void {
  let last = performance.now();
  const t = setInterval(() => {
    const now = performance.now();
    const late = now - last - 1000;
    last = now;
    if (late > thresholdMs) log.warn(`event loop was blocked for about ${Math.round(late)} ms`);
  }, 1000);
  t.unref();
  return () => clearInterval(t);
}

/** Log how long an async step took, at `slowMs` or more as a warning, otherwise at debug. */
export async function timed<T>(what: string, fn: () => Promise<T>, slowMs = 500): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    if (ms >= slowMs) log.warn(`${what} took ${ms} ms`);
    else log.debug(`${what} took ${ms} ms`);
  }
}
