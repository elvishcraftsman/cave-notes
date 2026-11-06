import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import type { Envelope, RawBridge } from '../shared/api';

type Listener = (payload: unknown, root?: string) => void;
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on('cave:event', (_e, name: string, payload: unknown, root?: string) => {
  for (const cb of listeners.get(name) ?? []) cb(payload, root);
});

const bridge: RawBridge = {
  invoke: (kind, method, args, root) => ipcRenderer.invoke(`cave:${kind}`, method, args, root) as Promise<Envelope<unknown>>,
  on(event, cb) {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => void set.delete(cb);
  },
  platform: process.platform,
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  spell: {
    // Chromium's own checker, which already knows the dictionary the main process gave the session
    suggestions: (word) => {
      try {
        return webFrame.isWordMisspelled(word) ? webFrame.getWordSuggestions(word) : null;
      } catch {
        return null;
      }
    },
  },
};

contextBridge.exposeInMainWorld('cave', bridge);
