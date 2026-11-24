/**
 * One request at a time, and only the newest one that waited. While a request is on its way, newer inputs replace each
 * other; when it comes back, the newest one (if any) is sent next and the answer that just came back is not shown, since a
 * newer one follows. So a busy worker gets at most two requests from a dialog however fast the person types: the one it is
 * working on and the latest.
 */
export interface LatestOnly<A> {
  /** a new input: sent now if nothing is on its way, else kept as the next one to send */
  push(input: A): void;
  /** stop: nothing more is sent and no answer is applied */
  stop(): void;
}

export function latestOnly<A, R>(run: (input: A) => Promise<R>, apply: (result: R) => void): LatestOnly<A> {
  let busy = false;
  let stopped = false;
  let next: { input: A } | null = null;
  const send = (input: A): void => {
    busy = true;
    const done = (): void => {
      busy = false;
      if (stopped || next === null) return;
      const n = next.input;
      next = null;
      send(n);
    };
    let p: Promise<R>;
    try {
      p = run(input);
    } catch {
      done();
      return;
    }
    p.then(
      (r) => {
        if (!stopped && next === null) apply(r); // a newer input is waiting: its answer will be shown instead
        done();
      },
      () => done(), // keep what is shown
    );
  };
  return {
    push(input) {
      if (stopped) return;
      if (busy) next = { input };
      else send(input);
    },
    stop() {
      stopped = true;
      next = null;
    },
  };
}
