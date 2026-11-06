import { Worker } from 'node:worker_threads';
import { noteExtensions } from '@cave-notes/core-tree';

const WORKER_URL = new URL('./parse-worker.js', import.meta.url);

/**
 * Minimal worker pool that parses Markdown off the main thread. Jobs wait in one queue and each thread takes the
 * next one as soon as it is free, so one huge document keeps one thread busy while the others work through the rest
 * (handing out documents in fixed slices would leave most threads idle behind the slowest one).
 */
export class ParsePool {
  constructor(size) {
    this.slots = [];
    this.queue = [];
    this.nextId = 1;
    for (let i = 0; i < size; i++) {
      const slot = { worker: new Worker(WORKER_URL), job: null, dead: false };
      slot.worker.on('message', ({ id, result }) => {
        const job = slot.job;
        if (!job || job.id !== id) return;
        slot.job = null;
        job.resolve(result);
        this.#pump();
      });
      slot.worker.on('error', (err) => {
        slot.dead = true;
        const job = slot.job;
        slot.job = null;
        job?.reject(err);
        if (this.slots.every((s) => s.dead)) {
          for (const j of this.queue.splice(0)) j.reject(err);
        }
        this.#pump();
      });
      slot.worker.unref(); // idle workers must not keep the process alive...
      slot.worker.postMessage({ config: { exts: noteExtensions() } });
      this.slots.push(slot);
    }
  }

  #pump() {
    for (const slot of this.slots) {
      if (slot.dead || slot.job || this.queue.length === 0) continue;
      const job = this.queue.shift();
      job.id = this.nextId++;
      slot.job = job;
      slot.worker.ref(); // ...but while a parse is in flight it must (otherwise Node may exit mid-await)
      slot.worker.postMessage({ id: job.id, text: job.text });
    }
    if (this.queue.length === 0) for (const slot of this.slots) if (!slot.job) slot.worker.unref();
  }

  parse(text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: 0, text, resolve, reject });
      this.#pump();
    });
  }

  async close() {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
