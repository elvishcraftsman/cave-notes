import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { embedHost } from './embeds';

/**
 * `[[?query]]` shows the pages a query finds, in the text, as links separated by commas.
 * `[[?query|{title} ({status})]]` says how each is written: `{title}`, `{path}`, or any attribute in braces.
 * It is drawn only while the cursor is elsewhere; put the cursor in it to see and change it as written.
 */

export interface QueryLinkItem {
  path: string;
  title: string;
  /** set for a page of another workspace (the folder name of that workspace) */
  workspace?: string;
  /** the first value of each attribute, as text */
  attrs: Record<string, string>;
}

const CALL = /\[\[\?([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'Frontmatter']);

/** `{title}`, `{path}`, `{name}` or any attribute in braces, filled in for one page. */
export function formatQueryLink(item: QueryLinkItem, template: string | null): string {
  const t = template && template.trim() ? template : '{title}';
  return t.replace(/\{([^{}]+)\}/g, (_m, key: string) => {
    const k = key.trim();
    if (k === 'title') return item.title;
    if (k === 'workspace') return item.workspace ?? '';
    if (k === 'path') return item.path.replace(/\.[^./]+$/, '');
    if (k === 'name') return item.path.replace(/\.[^./]+$/, '').split('/').pop() ?? item.title;
    return item.attrs[k] ?? item.attrs[k.toLowerCase()] ?? '';
  });
}

/** A template that starts with `=` draws each page as a button (one click opens it), as `[[Page|=Label]]` does. */
export function queryLinkStyle(template: string | null): { button: boolean; template: string | null } {
  if (template !== null && /^\s*=/.test(template)) return { button: true, template: template.replace(/^\s*=\s?/, '') };
  return { button: false, template };
}

/** Write the pages a query found into `el`: links separated by commas, or buttons when the template starts with `=`. */
export function fillQueryLinks(el: HTMLElement, items: QueryLinkItem[], template: string | null, open?: (path: string, e: MouseEvent, workspace?: string) => void): void {
  el.textContent = '';
  const style = queryLinkStyle(template);
  el.classList.toggle('cm-querylinks-buttons', style.button);
  if (items.length === 0) {
    const none = document.createElement('span');
    none.className = 'cm-querylinks-empty';
    none.textContent = '(no pages)';
    el.append(none);
    return;
  }
  items.forEach((it, i) => {
    if (i > 0) el.append(style.button ? ' ' : ', ');
    const a = document.createElement('span');
    a.className = style.button ? 'cm-wikilink cm-querylink cm-wikilink-button' : 'cm-wikilink cm-querylink';
    a.dataset.wikilink = it.path;
    if (it.workspace) a.dataset.workspace = it.workspace;
    a.textContent = formatQueryLink(it, style.template) + (it.workspace ? '\u00a0\u29c9' : '');
    a.title = it.workspace ? `${style.button ? 'Open' : 'Ctrl+Click to open'} (in the workspace ${it.workspace})` : style.button ? 'Open' : 'Ctrl+Click to open';
    a.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!style.button && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      open?.(it.path, e, it.workspace);
    });
    el.append(a);
  });
}

class QueryLinksWidget extends WidgetType {
  constructor(
    readonly query: string,
    readonly template: string | null,
    readonly tick: number,
  ) {
    super();
  }
  override eq(o: QueryLinksWidget): boolean {
    return o.query === this.query && o.template === this.template && o.tick === this.tick;
  }
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-querylinks';
    el.textContent = '…';
    const host = view.state.facet(embedHost);
    if (!host?.queryLinks) return el;
    let seq = 0;
    const run = (): void => {
      const mine = ++seq;
      host.queryLinks!(this.query).then(
        (items) => {
          if (mine === seq) fillQueryLinks(el, items, this.template, host.openPage?.bind(host));
        },
        (e: unknown) => {
          if (mine !== seq) return;
          el.textContent = '';
          el.classList.add('cm-querylinks-bad');
          el.textContent = e instanceof Error ? e.message : 'The query could not be run.';
        },
      );
    };
    // the host says when pages changed (a file edited elsewhere, say), so the list never goes stale
    const stop = host.watch ? host.watch(run) : (run(), () => {});
    (el as HTMLElement & { __cleanup?: () => void }).__cleanup = () => {
      seq++;
      stop();
    };
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
  if (!host?.queryLinks) return Decoration.none;
  const out: Array<Range<Decoration>> = [];
  const sel = state.selection.ranges;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes('[[?')) continue;
    CALL.lastIndex = 0;
    for (let m = CALL.exec(line.text); m; m = CALL.exec(line.text)) {
      const query = m[1]!.trim();
      if (!query) continue;
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (inCode(state, from) || sel.some((r) => r.from <= to && r.to >= from)) continue;
      out.push(Decoration.replace({ widget: new QueryLinksWidget(query, m[2] ?? null, tick) }).range(from, to));
    }
  }
  return Decoration.set(out, true);
}

/** `[[?query]]`: the pages a query finds, written in the text like links. */
export function queryLinks(getTick: () => number = () => 0): Extension {
  return StateField.define<DecorationSet>({
    create: (s) => compute(s, getTick()),
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length || tr.startState.facet(embedHost) !== tr.state.facet(embedHost) ? compute(tr.state, getTick()) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
