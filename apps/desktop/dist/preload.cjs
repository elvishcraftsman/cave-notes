"use strict";

// src/preload/preload.ts
var import_electron = require("electron");
var listeners = /* @__PURE__ */ new Map();
import_electron.ipcRenderer.on("cave:event", (_e, name, payload, root) => {
  for (const cb of listeners.get(name) ?? []) cb(payload, root);
});
var bridge = {
  invoke: (kind, method, args, root) => import_electron.ipcRenderer.invoke(`cave:${kind}`, method, args, root),
  on(event, cb) {
    let set = listeners.get(event);
    if (!set) listeners.set(event, set = /* @__PURE__ */ new Set());
    set.add(cb);
    return () => void set.delete(cb);
  },
  platform: process.platform,
  pathForFile: (file) => {
    try {
      return import_electron.webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  spell: {
    // Chromium's own checker, which already knows the dictionary the main process gave the session
    suggestions: (word) => {
      try {
        return import_electron.webFrame.isWordMisspelled(word) ? import_electron.webFrame.getWordSuggestions(word) : null;
      } catch {
        return null;
      }
    }
  }
};
import_electron.contextBridge.exposeInMainWorld("cave", bridge);
//# sourceMappingURL=preload.cjs.map
