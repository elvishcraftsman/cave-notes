import { signal } from '@preact/signals';

/** Below this window width the sidebars become drawers over the page instead of columns beside it. Keep in step with styles/adwaita.css. */
export const NARROW_PX = 720;

const query = (q: string): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(q) : null);
const nq = query(`(max-width: ${NARROW_PX}px)`);

/** true while the window is narrow (a phone, or a desktop window dragged small) */
export const narrow = signal(!!nq?.matches);
nq?.addEventListener('change', (e) => {
  narrow.value = e.matches;
});

/** true when the main pointer is a finger: bigger rows, no drag and drop (touch scrolling would fight it) */
export const coarse = !!query('(pointer: coarse)')?.matches;

/** the window's inner width in px (follows resizing) */
export const viewportWidth = signal(typeof window === 'undefined' ? 1280 : window.innerWidth);
if (typeof window !== 'undefined') window.addEventListener('resize', () => { viewportWidth.value = window.innerWidth; });

/** the least width the page may have beside open sidebars */
export const MIN_EDITOR_PX = 320;
const RESIZER_PX = 6;

/**
 * Which sidebars fit as columns beside the page. When the window is too narrow the right one goes first, then the left
 * one, so the page is never narrower than a sidebar (nor than MIN_EDITOR_PX). Only what is drawn changes, not the
 * settings: widen the window and they come back.
 */
export function sidebarFit(width: number, wantLeft: boolean, wantRight: boolean, leftW: number, rightW: number): { left: boolean; right: boolean } {
  let left = wantLeft;
  let right = wantRight;
  const editor = (): number => width - (left ? leftW + RESIZER_PX : 0) - (right ? rightW + RESIZER_PX : 0);
  const least = (): number => Math.max(MIN_EDITOR_PX, left ? leftW : 0, right ? rightW : 0);
  if (right && editor() < least()) right = false;
  if (left && editor() < least()) left = false;
  return { left, right };
}

/** The panes of the one drawer a narrow window has: pages (files and search), the outline, the links, and the main menu. */
export type DrawerPane = 'pages' | 'outline' | 'links' | 'menu';
export const drawerPane = signal<DrawerPane>('pages');
