import { syntaxTree } from '@codemirror/language';
import { frameObserver } from './frameObserver';
import { type EditorState, type Extension, type Range, Facet, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** One `![[…]]` call as the host sees it. */
export interface EmbedSpec {
  /** the call as written */
  raw: string;
  /** the page (or, with `named`, the block) it points at */
  target: string;
  /** the heading whose section it shows, or null for the whole page */
  heading: string | null;
  /** `![[@name]]`: a template block */
  named: boolean;
  /** alone on its line (drawn as a block) rather than inside a sentence (drawn inline) */
  block: boolean;
}

export interface EmbedHandle {
  destroy(): void;
}

/** What draws an embed. The host fills `el` and keeps it up to date; it is read-only until the person asks to edit. */
export interface EmbedHost {
  mount(el: HTMLElement, spec: EmbedSpec): EmbedHandle;
  /** the pages a query finds (for `[[?query]]` in the text) */
  queryLinks?(query: string): Promise<Array<{ path: string; title: string; attrs: Record<string, string> }>>;
  /** the value of an expression (`this.writing`, `[[Page]].writing`) in the text, as `${…}` */
  expression?(expr: string): Promise<import('./expressions').ExpressionResult>;
  /** Call `cb` now and again whenever pages may have changed; returns the way to stop. Keeps query links and embeds current. */
  watch?(cb: () => void): () => void;
  /** open a page (Ctrl+Click on a link a query found) */
  openPage?(path: string, event: MouseEvent, workspace?: string): void;
}

export const embedHost = Facet.define<EmbedHost, EmbedHost | null>({ combine: (v) => v[0] ?? null });

const CALL = /!\[\[([^\]\n|#]+?)(?:#([^\]\n|]*))?\]\]/g;
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark']);

class EmbedWidget extends WidgetType {
  constructor(
    readonly spec: EmbedSpec,
    readonly host: EmbedHost,
  ) {
    super();
  }
  override eq(o: EmbedWidget): boolean {
    return o.host === this.host && o.spec.raw === this.spec.raw && o.spec.block === this.spec.block;
  }
  override get estimatedHeight(): number {
    return this.spec.block ? 60 : -1;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.spec.block ? 'div' : 'span');
    el.className = this.spec.block ? 'cm-embed cm-embed-block' : 'cm-embed cm-embed-inline';
    const handle = this.host.mount(el, this.spec);
    const ro = typeof ResizeObserver === 'undefined' ? null : frameObserver(() => view.requestMeasure());
    ro?.observe(el);
    (el as HTMLElement & { __cleanup?: () => void }).__cleanup = () => {
      ro?.disconnect();
      handle.destroy();
    };
    return el;
  }
  override destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { __cleanup?: () => void }).__cleanup?.();
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent as typeof n) if (CODE.has(n.name)) return true;
  return false;
}

function compute(state: EditorState): DecorationSet {
  const host = state.facet(embedHost);
  if (!host) return Decoration.none;
  const out: Array<Range<Decoration>> = [];
  const sel = state.selection.ranges;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes('![[')) continue;
    CALL.lastIndex = 0;
    for (let m = CALL.exec(line.text); m; m = CALL.exec(line.text)) {
      const target = m[1]!.trim();
      if (!target) continue;
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (inCode(state, from)) continue;
      const block = line.text.trim() === m[0];
      // while the cursor is in the call, show it as written so it can be changed
      const rFrom = block ? line.from : from;
      const rTo = block ? line.to : to;
      if (sel.some((r) => r.from <= rTo && r.to >= rFrom)) continue;
      const named = target.startsWith('@');
      const spec: EmbedSpec = { raw: m[0], target: named ? target.slice(1).trim() : target, heading: m[2] === undefined ? null : m[2].trim(), named, block };
      out.push(Decoration.replace({ widget: new EmbedWidget(spec, host), block }).range(rFrom, rTo));
    }
  }
  return Decoration.set(out, true);
}

/** `![[Page]]`, `![[Page#Heading]]` and `![[@block]]` show the content they point at, read-only until the person clicks Edit. */
export function embeds(): Extension {
  return StateField.define<DecorationSet>({
    create: compute,
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length || tr.startState.facet(embedHost) !== tr.state.facet(embedHost) ? compute(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
