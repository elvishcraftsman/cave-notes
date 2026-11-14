/**
 * Running a rule's JavaScript. `runSandbox(code, input, options)` starts a worker thread (sandbox-worker.js), waits for its
 * answer and always resolves, never rejects:
 *
 *   { ok: true,  value, logs }     `value` is what the script returned (a string becomes { text })
 *   { ok: false, error }           the script threw, ran too long, used too much memory or returned something unusable
 *
 * `input` is plain data: text, cursor, page, props and so on (see docs/04-automation/06-javascript.md). A script cannot reach
 * the workspace, the network or the rest of the app; see sandbox-worker.js for how that is kept true.
 */
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./sandbox-worker.js', import.meta.url);

export const SANDBOX_DEFAULTS = { timeoutMs: 2000, maxTimeoutMs: 10_000, memoryMb: 64 };

export function runSandbox(code, input, { timeoutMs = SANDBOX_DEFAULTS.timeoutMs, memoryMb = SANDBOX_DEFAULTS.memoryMb } = {}) {
  const limit = Math.max(100, Math.min(timeoutMs, SANDBOX_DEFAULTS.maxTimeoutMs));
  return new Promise((resolve) => {
    let done = false;
    let worker;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker?.terminate().catch(() => undefined);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `the script took longer than ${limit / 1000} s and was stopped` }), limit + 1000);
    timer.unref?.();
    try {
      worker = new Worker(WORKER_URL, {
        workerData: { code: String(code), inputJson: JSON.stringify(input ?? {}), timeoutMs: limit },
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch (e) {
      finish({ ok: false, error: `could not start the script: ${e.message}` });
      return;
    }
    worker.on('message', (m) => {
      if (!m.ok) return finish({ ok: false, error: m.timedOut ? `the script took longer than ${limit / 1000} s and was stopped` : m.error });
      try {
        const { value, logs } = JSON.parse(m.json);
        finish({ ok: true, value, logs: logs ?? [] });
      } catch {
        finish({ ok: false, error: 'the script returned something that is not plain data (text, numbers, true/false, lists and objects)' });
      }
    });
    worker.on('error', (e) => finish({ ok: false, error: e && e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `the script used more than ${memoryMb} MB of memory and was stopped` : `the script failed: ${e && e.message}` }));
    worker.on('exit', () => finish({ ok: false, error: 'the script stopped without an answer' }));
  });
}
