/**
 * Adwaita-style scroll hints for the panes: where there is more above or below what is shown, a soft shadow falls on the
 * edge, and the bar above a pane that is scrolled gets a line under it.
 */
const PANES = '.tree, .right-body, .results, .drawer-body';

function mark(el: HTMLElement): void {
  const above = el.scrollTop > 1;
  const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  el.classList.toggle('scrolled-top', above);
  el.classList.toggle('scrolled-bottom', below);
  const bar = el.previousElementSibling as HTMLElement | null;
  if (bar) bar.classList.toggle('over-scrolled', above);
}

/** Start watching; returns a function that stops. */
export function watchScrollShadows(root: HTMLElement = document.body): () => void {
  let raf = 0;
  const all = (): void => {
    raf = 0;
    root.querySelectorAll<HTMLElement>(PANES).forEach(mark);
  };
  const soon = (): void => {
    if (!raf) raf = requestAnimationFrame(all);
  };
  const onScroll = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLElement && t.matches(PANES)) mark(t);
  };
  document.addEventListener('scroll', onScroll, true);
  addEventListener('resize', soon);
  const mo = new MutationObserver(soon);
  mo.observe(root, { childList: true, subtree: true });
  soon();
  return () => {
    document.removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', soon);
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}
