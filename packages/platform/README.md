# @cave-notes/platform

The few things the core packages need from the operating system: a file system, path handling, hashing, UTF-8 helpers.
On desktop they are Node's own, so nothing behaves differently. In the Android WebView there is no Node, so the same
code asks this package instead, and the app decides what answers.

```js
import { fs, path, sha1 } from '@cave-notes/platform';

await fs.writeFile(path.join(root, 'Note.md'), '# Hello');   // exactly like node:fs/promises
```

- `fs` – Node's promise-style file API (the methods listed in `src/fs-holder.js`, with Node's error codes such as `ENOENT`).
  Swap the implementation with `setFs(impl)` (and `resetFs()`); on Android the implementation is the CaveFs plugin.
- `path` / `posix` – Node's `path` on desktop, a small POSIX copy in the WebView.
- `sha1`, `randomHex`, `utf8Bytes`, `utf8Text`, `utf8Length`, `bytesEqual`, `fileURLToPath` – the same answers on both.
- `createMemFs()` (from `@cave-notes/platform/memfs`) – an in-memory file system for tests.
- `defineFsConformance(...)` (from `@cave-notes/platform/conformance`) – the tests any file system implementation must pass.
  It runs today against Node's fs and the in-memory fs, and will run against the Android plugin.

The `browser` export condition selects the WebView build, so bundling for the WebView needs no aliases.

`test/guard.test.js` fails if a core package imports a Node module directly (the short allowlist in that file says why each
remaining file does, and may only get shorter).

The database has the same kind of seam: see `packages/core-index/src/driver-better-sqlite3.js` and
`driver-sqlite-wasm.js`, and the Db conformance suite in `packages/core-index/src/db-conformance.js`.
