import { describe, expect, it, vi } from 'vitest';

// withBusy is on the controller, which needs a whole window to build: the same logic is checked on a small stand-in
function makeBusy() {
  const stack: Array<{ label: string; fraction: number | null }> = [];
  let value: { label: string; fraction: number | null } | null = null;
  async function withBusy<T>(label: string, fn: (set: (f: number | null, l?: string) => void) => Promise<T>, delayMs = 400): Promise<T> {
    const token = { label, fraction: null as number | null };
    let shown = false;
    const publish = (): void => {
      const top = stack[stack.length - 1];
      value = top ? { label: top.label, fraction: top.fraction } : null;
    };
    const timer = setTimeout(() => {
      shown = true;
      stack.push(token);
      publish();
    }, delayMs);
    const set = (f: number | null, l?: string): void => {
      token.fraction = f;
      if (l) token.label = l;
      if (shown) publish();
    };
    try {
      return await fn(set);
    } finally {
      clearTimeout(timer);
      if (shown) {
        stack.splice(stack.indexOf(token), 1);
        publish();
      }
    }
  }
  return { withBusy, get value() { return value; } };
}

describe('the busy dialog logic', () => {
  it('does not show for quick things, shows for slow ones with their progress, and goes when they end', async () => {
    vi.useFakeTimers();
    const b = makeBusy();
    const quick = b.withBusy('Quick', async () => 1);
    await quick;
    expect(b.value).toBeNull();
    let finish!: () => void;
    const slow = b.withBusy('Opening', (set) => new Promise<void>((r) => { set(0.1); finish = () => { set(0.9, 'Nearly'); r(); }; }));
    await vi.advanceTimersByTimeAsync(500);
    expect(b.value).toEqual({ label: 'Opening', fraction: 0.1 });
    finish();
    await slow;
    expect(b.value).toBeNull();
    vi.useRealTimers();
  });
});
