/**
 * The thread a rule's JavaScript runs in (started by sandbox.js, one thread per run).
 *
 * Three walls stand between the script and this computer:
 *  1. it runs in a worker thread with its own small memory limit and an empty environment, and the thread is stopped when
 *     the time is up;
 *  2. inside the thread it runs in a separate V8 context that has no `require`, `process`, `fs`, timers or network, and
 *     cannot make code from text (no `eval`, no `new Function`);
 *  3. nothing from this side is handed to the script except one function that takes and gives *text* and never throws, so
 *     the script has no object from this side to climb out through. Everything else it uses is built inside its own context.
 */
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { DateValue } from './dates.js';
import { FUNCTION_NAMES, callFunction } from './expr.js';
import { createApi } from './sandbox-lib.js';

const { code, inputJson, timeoutMs } = workerData;

/** A value on its way into or out of the script: dates as text, everything plain. */
function plain(v) {
  if (v instanceof DateValue) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v === undefined ? null : v;
}

const call = (payload) => {
  try {
    const [name, args] = JSON.parse(payload);
    return JSON.stringify({ ok: true, value: plain(callFunction(name, args, {})) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};

/** What went wrong, with the script's own line number when the error carries one. */
function describe(e) {
  const msg = String(e && e.message ? e.message : e);
  const m = e && typeof e.stack === 'string' ? /rule\.js:(\d+)/.exec(e.stack) : null;
  return m ? `${msg} (line ${m[1]} of the script)` : msg;
}

try {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  // the library is compiled inside the context, so every function and object the script can touch was made there
  const lib = vm.runInContext(`(${createApi.toString()})`, ctx);
  ctx.__api = lib(call, JSON.stringify(FUNCTION_NAMES()), inputJson);
  const script = new vm.Script(`(function (${ctx.__api.names.join(', ')}) {\n"use strict";\n${code}\n})`, { filename: 'rule.js', lineOffset: -2 });
  ctx.__user = script.runInContext(ctx);
  const json = vm.runInContext('__api.finish(__user.apply(undefined, __api.values))', ctx, { timeout: timeoutMs });
  parentPort.postMessage({ ok: true, json: String(json) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: describe(e), timedOut: /timed out/i.test(String(e && e.message)) });
}
