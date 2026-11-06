import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSandbox } from '../src/sandbox.js';

const run = (code, input = {}, o) => runSandbox(code, { text: '', selection: false, cursor: null, page: {}, props: {}, ask: {}, vars: {}, today: '2026-10-28', now: '2026-10-28T08:00:00', ...input }, o);

test('a script gets the text and returns new text', async () => {
  const r = await run('return text.toUpperCase();', { text: 'hello' });
  assert.deepEqual(r, { ok: true, value: { text: 'HELLO' }, logs: [] });
});

test('it can return an object, log, and call the functions of the expression language', async () => {
  const r = await run('log("hi", 3); return { text: fn.upper(text), props: { due: fn.add(today, "7d") } };', { text: 'a' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { text: 'A', props: { due: '2026-11-04' } });
  assert.deepEqual(r.logs, ['hi 3']);
});

test('errors say what went wrong and where', async () => {
  const r = await run('const x = 1;\nthrow new Error("nope");');
  assert.equal(r.ok, false);
  assert.match(r.error, /nope/);
  assert.match(r.error, /line 2/);
  const s = await run('return (;');
  assert.equal(s.ok, false);
});

test('a function of the language that fails throws inside the script, where it can be caught', async () => {
  const r = await run('try { fn.add("nonsense", "1d"); } catch (e) { return "caught: " + e.message; }');
  assert.match(r.value.text, /caught: add\(\)/);
});

test('the script has no way out: no process, no require, no eval, no Function', async () => {
  const tries = [
    'return typeof process + typeof require + typeof globalThis.process + typeof fetch + typeof setTimeout;',
    'return String(typeof this);',
    'try { return fn.add.constructor("return process")() } catch (e) { return "blocked: " + e.name }',
    'try { return (0, eval)("1+1") } catch (e) { return "blocked: " + e.name }',
    'try { return new Function("return process")() } catch (e) { return "blocked: " + e.name }',
    'try { return ({}).constructor.constructor("return process")() } catch (e) { return "blocked: " + e.name }',
    'try { return log.constructor("return process")() } catch (e) { return "blocked: " + e.name }',
    'try { const f = fn.add; return f.caller } catch (e) { return "blocked: " + e.name }',
    'try { return Object.getPrototypeOf(async function(){}).constructor("return process")() } catch (e) { return "blocked: " + e.name }',
  ];
  for (const code of tries) {
    const r = await run(code);
    const out = r.ok ? String(r.value?.text ?? r.value) : r.error;
    assert.ok(/blocked|undefinedundefined|undefined|object|not allowed|Code generation/i.test(out) && !/\[object process\]|pid/.test(out), `${code} -> ${out}`);
  }
});

test('an endless loop is stopped', async () => {
  const t = Date.now();
  const r = await run('while (true) {}', {}, { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.error, /took longer/);
  assert.ok(Date.now() - t < 4000);
});

test('too much memory is stopped', async () => {
  const r = await run('const a = []; while (true) a.push(new Array(1e6).fill(1));', {}, { timeoutMs: 5000, memoryMb: 32 });
  assert.equal(r.ok, false);
  assert.match(r.error, /memory|longer|failed/);
});

test('a promise is refused with a clear message', async () => {
  const r = await run('return Promise.resolve(1);');
  assert.equal(r.ok, false);
  assert.match(r.error, /await is not available/);
});
