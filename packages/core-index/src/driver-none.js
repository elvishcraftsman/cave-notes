// The default driver where better-sqlite3 cannot load (the Android WebView): the app must say which driver to use.
export default {
  name: 'none',
  open() {
    throw new Error('no database driver installed: pass options.driver to openIndex (for example the sqlite-wasm driver)');
  },
  destroy() {},
};
