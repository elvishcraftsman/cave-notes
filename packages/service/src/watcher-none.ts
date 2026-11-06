// Where there is no file watcher (the Android WebView): the service gets no change events from outside, and the app
// looks for edits another way (when it comes back to the front, and on a pull to refresh).
import type { WatchBatch } from './watcher';

export type { WatchBatch };

/** Same shape as the real watcher: returns the function that stops it, which here has nothing to stop. */
export function watchWorkspace(_root: string, _onBatch: (batch: WatchBatch) => void, _debounceMs = 150, _only?: string): () => Promise<void> {
  return async () => undefined;
}
