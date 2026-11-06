import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { type EmbedHost, embedHost } from './embeds';
import { fillQueryLinks, queryLinkStyle } from './queryLinks';

/**
 * `${this.writing}` shows an attribute of the page itself, `${[[Page]].writing}` one of another page. A value that names a
 * page is drawn as a link. `[[${this.writing}|={title}]]` takes the page the expression names as the target of a link, and
 * `=` in front of the label draws it as a button. Drawn only while the cursor is elsewhere, like `[[?query]]`.
 */

/** One value an expression has: plain text, or a page (with the title to show). */
export interface ExpressionValue {
  text: string;
  path?: string;
  title?: string;
  /** set for a page of another workspace */
  workspace?: string;
}

/** The result of an expression: its values, or why it has none. */
export type ExpressionResult = { ok: true; values: ExpressionValue[] } | { ok: false; error: string };

const CALL = /\[\[\$\{([^}\n]+)\}(?:\|([^\]\n]*))?\]\]|\$\{([^}\n]+)\}/g;
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'Frontmatter']);

/** Find the expressions in a line: where each is, the expression itself, and the label of a `[[${…}|label]]` link. */
export function findExpressions(text: string): Array<{ index: number; length: number; expr: string; link: boolean; label: string | null }> {
  const out: Array<{ index: number; length: number; expr: string; link: boolean; label: string | null }> = [];
  CALL.lastIndex = 0;
  for (let m = CALL.exec(text); m; m = CALL.exec(text)) {
    const link = m[1] !== undefined;
    out.push({ index: m.index, length: m[0].length, expr: (link ? m[1]! : m[3]!).trim(), link, label: link ? (m[2] ?? null) : null });
  }
  return out;
}

/** What it takes to work out and draw an expression: the editor's embed host, or the host of embedded text. */
export type ExpressionHost = Pick<EmbedHost, 'expression' | 'watch' | 'openPage'>;

/**
 * Draw the value of an expression into `el` and keep it current as pages change. `link` is true for `[[${…}|label]]` (the value
 * names a page to link to; `label` says how it is written). Returns the way to stop.
 */
export function drawExpression(el: HTMLElement, host: ExpressionHost, expr: string, link: boolean, label: string | null): () => void {
  el.classList.add('cm-expression');
  el.textContent = '…';
  if (!host.expression) return () => {};
  let seq = 0;
  const title = `\${${expr}}`;
  const fail = (message: string): void => {
    el.textContent = message;
    el.classList.add('cm-expression-bad');
    el.title = title;
  };
  const fill = (r: ExpressionResult): void => {
    el.textContent = '';
    el.classList.remove('cm-expression-bad', 'cm-expression-empty');
    el.title = title;
    if (!r.ok) return fail(r.error);
    if (r.values.length === 0) {
      el.classList.add('cm-expression-empty');
      el.textContent = '(empty)';
      return;
    }
    // inside `[[${…}|label]]` the label says how the page is written; a plain expression writes the page's title
    const template = link ? label : null;
    const open = host.openPage?.bind(host);
    r.values.forEach((v, i) => {
      if (i > 0) el.append(link && queryLinkStyle(template).button ? ' ' : ', ');
      if (v.path) {
        const one = document.createElement('span');
        fillQueryLinks(one, [{ path: v.path, title: v.title ?? v.text, ...(v.workspace ? { workspace: v.workspace } : {}), attrs: {} }], template, open);
        while (one.firstChild) el.append(one.firstChild);
      } else if (link) {
        const bad = document.createElement('span');
        bad.className = 'cm-expression-bad';
        bad.textContent = v.text;
        bad.title = 'No page of this name';
        el.append(bad);
      } else {
        el.append(document.createTextNode(v.text));
      }
    });
  };
  const run = (): void => {
    const mine = ++seq;
    host.expression!(expr).then(
      (r) => {
        if (mine === seq) fill(r);
      },
      (e: unknown) => {
        if (mine === seq) fail(e instanceof Error ? e.message : 'The expression could not be worked out.');
      },
    );
  };
  // the host says when pages changed, so the value is worked out again as the page (or the page it reads) changes
  const stop = host.watch ? host.watch(run) : (run(), () => {});
  return () => {
    seq++;
    stop();
  };
}

class ExpressionWidget extends WidgetType {
  constructor(
    readonly expr: string,
    readonly link: boolean,
    readonly label: string | null,
    readonly tick: number,
  ) {
    super();
  }
  override eq(o: ExpressionWidget): boolean {
    return o.expr === this.expr && o.link === this.link && o.label === this.label && o.tick === this.tick;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    const host = view.state.facet(embedHost);
    (el as HTMLElement & { __cleanup?: () => void }).__cleanup = host ? drawExpression(el, host, this.expr, this.link, this.label) : undefined;
    return el;
  }
  override destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { __cleanup?: () => void }).__cleanup?.();
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent as typeof n) if (CODE.has(n.name)) return true;
  return false;
}

function compute(state: EditorState, tick: number): DecorationSet {
  const host = state.facet(embedHost);
  if (!host?.expression) return Decoration.none;
  const out: Array<Range<Decoration>> = [];
  const sel = state.selection.ranges;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes('${')) continue;
    for (const f of findExpressions(line.text)) {
      const from = line.from + f.index;
      const to = from + f.length;
      if (inCode(state, from) || sel.some((r) => r.from <= to && r.to >= from)) continue;
      out.push(Decoration.replace({ widget: new ExpressionWidget(f.expr, f.link, f.label, tick) }).range(from, to));
    }
  }
  return Decoration.set(out, true);
}

/** `${…}`: a value worked out from the attributes of this page or another, kept up to date while the page is edited. */
export function expressions(getTick: () => number = () => 0): Extension {
  return StateField.define<DecorationSet>({
    create: (s) => compute(s, getTick()),
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length || tr.startState.facet(embedHost) !== tr.state.facet(embedHost) ? compute(tr.state, getTick()) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
