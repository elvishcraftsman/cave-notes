// Where JavaScript rules cannot run (the Android WebView has no worker threads to sandbox them in): same interface,
// and every attempt reports that plainly instead of failing obscurely.
export const SANDBOX_DEFAULTS = { timeoutMs: 2000, maxTimeoutMs: 10_000, memoryMb: 64 };

export function runSandbox() {
  return Promise.resolve({ ok: false, error: 'JavaScript rules are not available on this device' });
}
