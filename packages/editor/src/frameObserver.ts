/**
 * A ResizeObserver whose callback runs on the next animation frame, once however many resizes came before it.
 * Changing the size of something inside the callback then no longer ends in the browser's
 * "ResizeObserver loop completed with undelivered notifications" error.
 */
export function frameObserver(callback: () => void): ResizeObserver {
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(callback);
  });
  const disconnect = ro.disconnect.bind(ro);
  ro.disconnect = () => {
    cancelAnimationFrame(raf);
    disconnect();
  };
  return ro;
}
