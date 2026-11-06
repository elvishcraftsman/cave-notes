import { type EditorView, type ViewUpdate, ViewPlugin } from '@codemirror/view';

/**
 * Code blocks with long lines (wrapping off). Each line of a block clips its overflow (see theme.ts), and the block
 * scrolls sideways as one, however it is moved: horizontal wheel / trackpad / shift+wheel, a finger dragged across any
 * line, a selection dragged past the edge, the keyboard (the caret is kept in view). A block is never wider than the
 * text column, however long its lines are.
 *
 * Every line is a scroll container of its own, so two things keep them together. All lines of a block are given the same
 * scrollable width (the longest line's, as `--cn-code-w`, which a hidden marker at the far end of each line reaches),
 * so a short line can be scrolled as far as a long one. And whenever any line scrolls, the others are set to its position.
 */
const CARET_GAP = 24;

type Block = HTMLElement[];

function blocks(view: EditorView): Block[] {
  const out: Block[] = [];
  let cur: Block = [];
  for (const child of Array.from(view.contentDOM.children)) {
    if (child instanceof HTMLElement && child.classList.contains('cm-codeblock')) cur.push(child);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const maxScroll = (b: Block): number => b.reduce((m, el) => Math.max(m, el.scrollWidth - el.clientWidth), 0);

function scrollBlock(b: Block, left: number): void {
  const to = Math.max(0, Math.min(left, maxScroll(b)));
  for (const el of b) el.scrollLeft = to;
}

const wrapping = (view: EditorView): boolean => view.dom.classList.contains('cm-wrapcode');

/** Make every line of the block as wide (to scroll) as its longest one; no lines overflow: nothing to scroll. */
function equalise(b: Block): void {
  for (const el of b) el.style.removeProperty('--cn-code-w');
  const widest = b.reduce((m, el) => Math.max(m, el.scrollWidth), 0);
  const room = b.reduce((m, el) => Math.min(m, el.clientWidth), Infinity);
  if (widest > room + 1) for (const el of b) el.style.setProperty('--cn-code-w', `${widest}px`);
}

/** One line of a block was scrolled (by touch, a drag, anything): bring the others to the same place. */
export function followLine(view: EditorView, el: HTMLElement): void {
  if (wrapping(view)) return;
  const b = blocks(view).find((x) => x.includes(el));
  if (!b) return;
  const to = el.scrollLeft;
  if (b.every((x) => Math.abs(x.scrollLeft - to) < 1)) return;
  for (const x of b) if (x !== el) x.scrollLeft = to;
}

export const codeScroll = ViewPlugin.fromClass(
  class {
    /** `scroll` does not bubble, but it can be caught on the way down to the line that scrolls */
    private readonly onScroll = (e: Event): void => {
      const el = e.target;
      if (el instanceof HTMLElement && el.classList.contains('cm-codeblock')) followLine(this.view, el);
    };

    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener('scroll', this.onScroll, true);
      this.schedule();
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener('scroll', this.onScroll, true);
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet || u.transactions.length) this.schedule(u.selectionSet || u.docChanged);
    }

    schedule(follow = false): void {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          if (wrapping(view)) return { wrap: true as const, plan: [] as { b: Block; left: number }[] };
          const plan: { b: Block; left: number }[] = [];
          for (const b of blocks(view)) {
            const left = b.reduce((m, el) => Math.max(m, el.scrollLeft), 0);
            plan.push({ b, left });
          }
          return { wrap: false as const, plan };
        },
        write: (m, view) => {
          if (m.wrap) {
            for (const b of blocks(view)) {
              for (const el of b) {
                el.style.marginLeft = '';
                el.style.marginRight = '';
                el.style.removeProperty('--cn-code-w');
                el.scrollLeft = 0;
              }
            }
            return;
          }
          for (const { b, left } of m.plan) {
            for (const el of b) {
              el.style.marginLeft = '';
              el.style.marginRight = '';
            }
            equalise(b);
            scrollBlock(b, left); // lines CM drew anew start at 0: bring the whole block to one position
          }
          if (follow) this.followCaret();
        },
      });
    }

    /** Keep the caret inside the clipped part of its block (a separate measure: CodeMirror's layout can only be read in a read step). */
    followCaret(): void {
      this.view.requestMeasure({
        key: this.follow,
        read: (view) => {
          const head = view.state.selection.main.head;
          const dom = view.domAtPos(head).node;
          const el = (dom instanceof HTMLElement ? dom : dom.parentElement)?.closest<HTMLElement>('.cm-codeblock');
          const at = el ? view.coordsAtPos(head) : null;
          if (!el || !at) return null;
          const r = el.getBoundingClientRect();
          let by = 0;
          if (at.left > r.right - CARET_GAP) by = at.left - (r.right - CARET_GAP);
          else if (at.left < r.left + CARET_GAP) by = at.left - (r.left + CARET_GAP);
          return by ? { el, by } : null;
        },
        write: (m, view) => {
          if (!m) return;
          const b = blocks(view).find((x) => x.includes(m.el));
          if (b) scrollBlock(b, m.el.scrollLeft + m.by);
        },
      });
    }

    readonly follow = {};
  },
  {
    eventHandlers: {
      wheel(e: WheelEvent, view: EditorView) {
        if (wrapping(view)) return false;
        const el = (e.target instanceof HTMLElement ? e.target : null)?.closest<HTMLElement>('.cm-codeblock');
        if (!el) return false;
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        if (dx === 0 || (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY))) return false;
        const b = blocks(view).find((x) => x.includes(el));
        if (!b) return false;
        const before = el.scrollLeft;
        scrollBlock(b, before + dx);
        if (el.scrollLeft === before) return false; // at an end: let the page have it
        e.preventDefault();
        return true;
      },
    },
  },
);
