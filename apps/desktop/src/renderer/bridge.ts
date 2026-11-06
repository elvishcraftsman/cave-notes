import { DESKTOP_CAPABILITIES, type Capabilities, type EventMap, type MainApi, type RawBridge, type WorkerApi } from '../shared/api';

export class CaveError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'CaveError';
    this.code = code;
  }
}

/** Everything the controller needs from the outside world. Injectable so it can be tested. */
export interface Deps {
  main: MainApi;
  /** The workspace API of one open workspace (each has its own worker). */
  wsFor(root: string): WorkerApi;
  /** `root` is the workspace a worker event came from; menu events have none. */
  on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K], root?: string) => void): () => void;
  platform: string;
  /** What this platform can do; desktop (no entry) has everything. Read it with capabilitiesOf. */
  capabilities?: Capabilities;
  /** The address that shows a file of an open workspace (an image, say). Desktop has its own scheme; Android points at the file. */
  assetUrl?(root: string, encodedSegments: string[]): string;
  /** The path on disk of a dropped file ('' when unknown). */
  pathForFile?(file: File): string;
  /** Suggestions for a misspelt word; null when the word is spelled right or checking is off. */
  spell?(word: string): string[] | null;
  /** Synonyms for a word (in its own form and capitals); null when the word is not worth a menu. */
  thesaurus?(word: string): string[] | null;
}

/** Wrap the preload's raw, whitelisted pipe in typed proxies that unwrap results and throw CaveError. */
export function createDeps(raw: RawBridge): Deps {
  const proxy = <T extends object>(kind: 'main' | 'ws', root?: string): T =>
    new Proxy({} as T, {
      get:
        (_t, method: string) =>
        async (...args: unknown[]) => {
          const env = await raw.invoke(kind, method, args, root);
          if (env.ok) return env.value;
          throw new CaveError(env.error.message, env.error.code);
        },
    });
  return {
    main: proxy<MainApi>('main'),
    wsFor: (root) => proxy<WorkerApi>('ws', root),
    on: (event, cb) => raw.on(event, cb as (p: unknown, root?: string) => void),
    platform: raw.platform,
    capabilities: DESKTOP_CAPABILITIES,
    ...(raw.pathForFile ? { pathForFile: (f: File) => raw.pathForFile!(f) } : {}),
    ...(raw.spell ? { spell: (w: string) => raw.spell!.suggestions(w) } : {}),
  };
}

/** What the platform behind these deps can do (everything, unless the deps say otherwise). */
export const capabilitiesOf = (deps: Pick<Deps, 'capabilities'>): Capabilities => deps.capabilities ?? DESKTOP_CAPABILITIES;

/**
 * A MainApi for a platform that implements only some of it: the methods given work, any other fails with a CaveError whose
 * code is UNSUPPORTED (so the window can say so, and tests can tell it from a bug).
 */
export function partialMainApi(implemented: Partial<MainApi>): MainApi {
  return new Proxy(implemented as MainApi, {
    get: (target, method: string) =>
      method in target
        ? (target as unknown as Record<string, unknown>)[method]
        : async () => {
            throw new CaveError(`${method} is not available on this device`, 'UNSUPPORTED');
          },
  });
}

/** A friendlier message for the errors users can actually cause. */
export function explain(e: unknown): string {
  const err = e as { code?: string; message?: string };
  switch (err.code) {
    case 'COLLISION':
      return 'A page with that name already exists here.';
    case 'INVALID_NAME':
      return 'That name cannot be used. Avoid slashes and leading or trailing dots.';
    case 'MOVE_INTO_SELF':
      return 'A page cannot be moved inside itself.';
    case 'NOT_FOUND':
      return 'That page no longer exists.';
    case 'STALE':
      return 'Files changed while this was being prepared. Please try again.';
    default:
      return err.message ?? 'Something went wrong.';
  }
}
