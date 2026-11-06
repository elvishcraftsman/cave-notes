// The file-system seam. Code imports `fs` from @cave-notes/platform and calls it exactly as it would call node:fs/promises;
// what answers is whatever was installed with setFs (Node's own by default). Only the methods listed here are part of the
// contract: an implementation that lacks one makes the call fail with a clear message instead of an obscure TypeError.

/** The promise-style methods the app uses, with Node's names, arguments and error codes (err.code === 'ENOENT', ...). */
export const FS_METHODS = [
  'readFile',
  'writeFile',
  'appendFile',
  'readdir',
  'stat',
  'lstat',
  'mkdir',
  'rename',
  'rm',
  'rmdir',
  'unlink',
  'copyFile',
  'cp',
  'realpath',
  'access',
];

/**
 * @param {object} defaultImpl the implementation used until setFs is called
 * @returns {{ fs: object, setFs: (impl: object) => void, resetFs: () => void, getFs: () => object }}
 */
export function createFsHolder(defaultImpl) {
  let current = defaultImpl;
  const fs = {
    get constants() {
      return current.constants ?? { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
    },
  };
  for (const name of FS_METHODS) {
    fs[name] = (...args) => {
      const f = current[name];
      if (typeof f !== 'function') return Promise.reject(new Error(`fs.${name} is not available on this platform`));
      return f.apply(current, args);
    };
  }
  return {
    fs,
    setFs(impl) {
      current = impl;
    },
    resetFs() {
      current = defaultImpl;
    },
    getFs: () => current,
  };
}
