import { parentPort } from 'node:worker_threads';
import { parse, setPageExtensions } from '@cave-notes/core-md';

parentPort.on('message', ({ id, text, config }) => {
  if (config) {
    setPageExtensions(config.exts);
    return;
  }
  parentPort.postMessage({ id, result: parse(text) });
});
