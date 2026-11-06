// Where there are no worker threads (the Android WebView): the indexer parses inline, in slices that yield to the app.
// Open the index with workers: 0.
export class ParsePool {
  constructor() {
    throw new Error('parse threads are not available on this platform: open the index with workers: 0');
  }
}
