import { syntaxTree } from '@codemirror/language';
import { frameObserver } from './frameObserver';
import { type EditorState, type Extension, type Range, Facet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { TableWidget, tableEnd } from './tables';
import { RESERVED_VALUES, frontmatterBody, reservedFrontmatter, yamlProblem } from './yamlHints';

/**
 * Block widgets: tables render as real tables and the frontmatter collapses into a compact
 * properties card. Both show their raw text again while the cursor is inside them; clicking a
 * widget moves the cursor in. (Block decorations must come from a state field.)
 */

export { parseTable, splitRow, type Align } from './tables';

function enterBlock(view: EditorView, dom: HTMLElement): void {
  const from = view.posAtDOM(dom);
  const to = Math.min(view.state.doc.lineAt(from).to + 1, view.state.doc.length);
  view.dispatch({ selection: { anchor: Math.max(from + 1, to) }, scrollIntoView: true });
  view.focus();
}

/** `key: value` pairs from a frontmatter block, without a YAML dependency (display only). */
export function frontmatterPairs(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const l of text.split('\n')) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (m) out.push([m[1]!, m[2]!.replace(/^\[(?!\[[^\]]*\]\]$)(.*)\]$/, '$1').replace(/^["'](.*)["']$/, '$1')]);
  }
  return out;
}

class FrontmatterWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(o: FrontmatterWidget): boolean {
    return o.text === this.text;
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-properties-wrap';
    const box = document.createElement('div');
    box.className = 'cm-properties';
    wrap.append(box);
    const pairs = frontmatterPairs(this.text);
    const problem = yamlProblem(frontmatterBody(this.text));
    if (problem) {
      // outline and tag are drawn over the card, so it keeps its size
      wrap.classList.add('cm-properties-invalid');
      wrap.title = `Invalid YAML: ${problem}`;
      const tag = document.createElement('span');
      tag.className = 'cm-yaml-tag';
      tag.textContent = 'Invalid YAML';
      wrap.append(tag);
    }
    if (!pairs.length) box.classList.add('cm-properties-empty');
    for (const [k, v] of pairs) {
      const item = document.createElement('span');
      item.className = 'cm-property';
      const key = document.createElement('span');
      key.className = 'cm-property-key';
      key.textContent = k;
      const tip = reservedFrontmatter(k);
      if (tip) {
        key.classList.add('cm-yaml-reserved');
        key.title = tip;
      }
      const val = document.createElement('span');
      val.className = 'cm-property-value';
      val.textContent = v;
      if (RESERVED_VALUES[v]) {
        val.classList.add('cm-yaml-reserved');
        val.title = RESERVED_VALUES[v]!;
      }
      item.append(key, val);
      box.append(item);
    }
    if (!pairs.length) box.textContent = 'Properties';
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault();
      enterBlock(view, wrap);
    });
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------- database view blocks

export interface ViewBlockApi {
  /** Replace the text inside the block's fences (the view's settings). */
  updateSource(next: string): void;
  /** Show the block's raw text for editing. */
  edit(): void;
  /** True in a page that cannot change: settings that only remember what was last shown (the open tab) are not written. */
  readonly readOnly?: boolean;
  /** Delete the whole block from the page (Undo brings it back). */
  remove(): void;
}

/** The app supplies this to draw the contents of a ```view block; the editor only gives it a place to draw. */
/** What `mount` returns: a function that tears the drawing down, or an object that can also be told the settings changed. */
export type ViewBlockHandle = (() => void) | { destroy(): void; update?(source: string): void };

export interface ViewBlockHost {
  /** Draw into `el`. */
  mount(el: HTMLElement, source: string, api: ViewBlockApi): ViewBlockHandle;
}

export const viewBlockHost = Facet.define<ViewBlockHost, ViewBlockHost | null>({ combine: (v) => v[0] ?? null });

/** The text between the opening and closing fence of a fenced block that starts at `from` and ends at `to`. */
export function fenceInner(state: EditorState, from: number, to: number): { from: number; to: number } {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const innerFrom = Math.min(first.to + 1, to);
  const closed = last.number > first.number && /^\s*(```|~~~)\s*$/.test(last.text) && last.from >= innerFrom;
  return { from: innerFrom, to: closed ? last.from : to };
}

const isViewFence = (state: EditorState, from: number, to: number): boolean => {
  const info = /^\s*(?:```|~~~)\s*([^\s`]*)/.exec(state.doc.lineAt(from).text);
  return !!info && info[1]!.toLowerCase() === 'view' && to > from;
};

type BlockEl = HTMLElement & { __cleanup?: () => void; __host?: ViewBlockHost; __update?: (source: string) => void };

class ViewBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly host: ViewBlockHost,
  ) {
    super();
  }
  override eq(o: ViewBlockWidget): boolean {
    return o.source === this.source && o.host === this.host;
  }
  override get estimatedHeight(): number {
    return 160;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-view-block';
    const api: ViewBlockApi = {
      updateSource: (next) => {
        const pos = view.posAtDOM(el);
        let node = syntaxTree(view.state).resolveInner(pos, 1);
        while (node.name !== 'FencedCode' && node.parent) node = node.parent;
        if (node.name !== 'FencedCode') return;
        const inner = fenceInner(view.state, node.from, node.to);
        view.dispatch({ changes: { from: inner.from, to: inner.to, insert: next.replace(/\n*$/, '\n') } });
      },
      edit: () => enterBlock(view, el),
      get readOnly() {
        return view.state.readOnly;
      },
      remove: () => {
        const pos = view.posAtDOM(el);
        let node = syntaxTree(view.state).resolveInner(pos, 1);
        while (node.name !== 'FencedCode' && node.parent) node = node.parent;
        if (node.name !== 'FencedCode') return;
        const to = Math.min(view.state.doc.length, node.to + (view.state.doc.sliceString(node.to, node.to + 1) === '\n' ? 1 : 0));
        view.dispatch({ changes: { from: node.from, to }, selection: { anchor: node.from }, userEvent: 'delete' });
      },
    };
    const handle = this.host.mount(el, this.source, api);
    const ro = typeof ResizeObserver === 'undefined' ? null : frameObserver(() => view.requestMeasure());
    ro?.observe(el);
    const slot = el as BlockEl;
    slot.__host = this.host;
    slot.__update = typeof handle === 'object' ? handle.update?.bind(handle) : undefined;
    slot.__cleanup = () => {
      ro?.disconnect();
      if (typeof handle === 'function') handle();
      else handle.destroy();
    };
    return el;
  }
  /** Settings changed: let the drawing update itself in place, so its open panels and position survive. */
  override updateDOM(dom: HTMLElement): boolean {
    const slot = dom as BlockEl;
    if (slot.__host !== this.host || !slot.__update) return false;
    slot.__update(this.source);
    return true;
  }
  override destroy(dom: HTMLElement): void {
    (dom as BlockEl).__cleanup?.();
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The corner button of a query view shown as code: it deletes the whole block (Undo brings it back). */
class DeleteViewWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(view: EditorView): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-view-delete';
    b.title = 'Delete this query view';
    b.setAttribute('aria-label', 'Delete this query view');
    b.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8M6.5 7v4M9.5 7v4"/></svg>';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(b);
      let node = syntaxTree(view.state).resolveInner(pos, -1);
      while (node.name !== 'FencedCode' && node.parent) node = node.parent;
      if (node.name !== 'FencedCode') return;
      const to = Math.min(view.state.doc.length, node.to + (view.state.doc.sliceString(node.to, node.to + 1) === '\n' ? 1 : 0));
      view.dispatch({ changes: { from: node.from, to }, selection: { anchor: node.from }, userEvent: 'delete' });
      view.focus();
    });
    return b;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Whether the editor has the focus. A table turns into its Markdown code only while the cursor is in it and the editor is
 * focused: find and replace selects matches from its own panel (the focus is there), and that must not rewrite the page's look.
 * Unknown (true) until the editor says otherwise, so a page opened with the cursor in a table still shows its code.
 */
const setEditorFocus = StateEffect.define<boolean>();
const editorFocus = StateField.define<boolean>({
  create: () => true,
  update: (v, tr) => {
    for (const e of tr.effects) if (e.is(setEditorFocus)) return e.value;
    return v;
  },
});
const focusTracker = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      // after the state is set up: say whether the editor really has the focus
      queueMicrotask(() => {
        try {
          if (view.state.field(editorFocus) !== view.hasFocus) view.dispatch({ effects: setEditorFocus.of(view.hasFocus) });
        } catch {
          /* the view is gone */
        }
      });
    }
  },
);

function compute(state: EditorState): DecorationSet {
  const out: Array<Range<Decoration>> = [];
  const sel = state.selection.ranges;
  // The cursor counts as "inside" only strictly after the block's first character and up to its end.
  const inside = (from: number, to: number): boolean => sel.some((r) => r.to > from && r.from <= to && !(r.empty && r.from === from));
  const host = state.facet(viewBlockHost);
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (host && ref.name === 'FencedCode' && isViewFence(state, ref.from, ref.to)) {
        if (inside(ref.from, ref.to)) {
          out.push(Decoration.widget({ widget: new DeleteViewWidget(), side: 1 }).range(state.doc.lineAt(ref.from).to));
          return false;
        }
        const inner = fenceInner(state, ref.from, ref.to);
        out.push(Decoration.replace({ widget: new ViewBlockWidget(state.doc.sliceString(inner.from, inner.to), host), block: true }).range(ref.from, ref.to));
        return false;
      }
      if (ref.name !== 'Table' && ref.name !== 'Frontmatter') return;
      // a table takes the line of sizes right under it (see tables.ts) with it
      const end = ref.name === 'Table' ? tableEnd(state, ref.to) : ref.to;
      // a table stays a table in a page that cannot change, and while the focus is elsewhere (the search panel)
      if (inside(ref.from, end) && !(ref.name === 'Table' && (state.readOnly || state.field(editorFocus, false) === false))) return false;
      const text = state.doc.sliceString(ref.from, end);
      const widget = ref.name === 'Table' ? new TableWidget(text) : new FrontmatterWidget(text);
      out.push(Decoration.replace({ widget, block: true }).range(ref.from, end));
      return false;
    },
  });
  return Decoration.set(out, true);
}

export function blockWidgets(): Extension {
  return [
    editorFocus,
    focusTracker,
    EditorView.focusChangeEffect.of((_state, focusing) => setEditorFocus.of(focusing)),
    StateField.define<DecorationSet>({
      create: compute,
      update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length ? compute(tr.state) : value),
      provide: (f) => EditorView.decorations.from(f),
    }),
  ];
}
