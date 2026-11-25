import type { EditorState, Text } from '@codemirror/state';
import { type EditorView, WidgetType } from '@codemirror/view';
import YAML from 'yaml';

/**
 * `${=this.name}`: a box in the text of a page that shows the page's own attribute `name` and writes what is typed into the
 * attributes at the top of the page. Enter or Tab saves (Tab and Shift+Tab go on to the next or previous box), Esc puts the
 * value back. The page is the only thing it can change: `${=[[Other]].x}` is not an input.
 */

/** The attribute an input expression names (`=this.cash`, `=this["opening cash"]`), or null if it is not an input. */
export function inputKey(expr: string): string | null {
  const m = /^=\s*this\s*(?:\.\s*([A-Za-z_][\w-]*)|\[\s*(["'])(.+?)\2\s*\])\s*$/.exec(expr.trim());
  return m ? (m[1] ?? m[3] ?? null) : null;
}

/** Is this expression meant to be an input (it starts with `=`), whether or not it is a valid one? */
export const isInputExpr = (expr: string): boolean => expr.trim().startsWith('=');

/** The lines of the frontmatter: `open` is line 1 (`---`), `close` the number of the closing line. Null when there is none. */
function frontmatterLines(doc: Text): { close: number } | null {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return null;
  const last = Math.min(doc.lines, 4000);
  for (let n = 2; n <= last; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === '---' || t === '...') return { close: n };
  }
  return null;
}

const keyLine = (text: string): { key: string; rest: string } | null => {
  const m = /^([^\s#:][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(text);
  if (!m) return null;
  return { key: m[1]!.replace(/^(["'])(.*)\1$/, '$2'), rest: (m[2] ?? '').trimEnd() };
};

/** Where an attribute is in the frontmatter: its line, and the last line of its value (a block list or text runs on). */
function findKey(doc: Text, key: string): { line: number; end: number; key: string; rest: string } | null {
  const fm = frontmatterLines(doc);
  if (!fm) return null;
  const want = key.toLowerCase();
  for (let n = 2; n < fm.close; n++) {
    const k = keyLine(doc.line(n).text);
    if (!k || k.key.toLowerCase() !== want) continue;
    let end = n;
    // the value goes on over indented lines, and over `- item` lines of a list written under the key
    while (end + 1 < fm.close && /^(?:\s+\S|-\s|-$)/.test(doc.line(end + 1).text)) end++;
    return { line: n, end, key: k.key, rest: k.rest };
  }
  return null;
}

const shown = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(shown).join(' ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** The text an input box shows for the attribute: the value as written (so `12.50` stays `12.50`), a list as its items. */
export function frontmatterValue(doc: Text, key: string): string {
  const v = rawFrontmatterValue(doc, key);
  // `${=…}` is a field, never a value: one saved by mistake (an older version could do that from a table cell) shows as empty
  return /^\$\{\s*=[\s\S]*\}$/.test(v.trim()) ? '' : v;
}

function rawFrontmatterValue(doc: Text, key: string): string {
  const f = findKey(doc, key);
  if (!f) return '';
  const rest = f.rest.replace(/\s+#.*$/, '');
  if (f.end === f.line && rest !== '' && !/^["'[{|>&*!]/.test(rest)) return rest;
  const text = doc.sliceString(doc.line(f.line).from, doc.line(f.end).to);
  try {
    const parsed = YAML.parse(text) as Record<string, unknown> | null;
    return shown(parsed && typeof parsed === 'object' ? Object.values(parsed)[0] : null);
  } catch {
    return rest;
  }
}

/** How a typed value is written in YAML: a number as it was typed, empty as nothing, anything else quoted only if it must be. */
export function yamlScalar(text: string): string {
  const t = text.trim();
  if (t === '') return '';
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return t;
  return YAML.stringify(t, { lineWidth: 0 }).replace(/\n$/, '');
}

/** The change that sets attribute `key` of the page to `text` (adding the attribute, or the whole frontmatter, if missing). */
export function setFrontmatterValue(state: EditorState, key: string, text: string): { from: number; to: number; insert: string } {
  const doc = state.doc;
  const value = yamlScalar(text.replace(/[\r\n\t]+/g, ' '));
  const f = findKey(doc, key);
  if (f) {
    const line = doc.line(f.line);
    const colon = line.text.indexOf(':', line.text.indexOf(f.key) + f.key.length);
    return { from: line.from + colon + 1, to: doc.line(f.end).to, insert: value === '' ? '' : ` ${value}` };
  }
  const written = /^[A-Za-z_][\w-]*$/.test(key) ? key : JSON.stringify(key);
  const entry = `${written}:${value === '' ? '' : ` ${value}`}\n`;
  const fm = frontmatterLines(doc);
  if (fm) return { from: doc.line(fm.close).from, to: doc.line(fm.close).from, insert: entry };
  return { from: 0, to: 0, insert: `---\n${entry}---\n` };
}

/** Write a value into the page's attributes. Returns false when nothing changed (or the editor cannot be changed). */
export function writeAttribute(view: EditorView, key: string, text: string): boolean {
  if (view.state.readOnly) return false;
  if (rawFrontmatterValue(view.state.doc, key) === text.replace(/[\r\n\t]+/g, ' ').trim()) return false; // (a mistaken `${=…}` is replaced)
  view.dispatch({ changes: setFrontmatterValue(view.state, key, text), userEvent: 'input.attribute' });
  return true;
}

/** Focus the input box `step` places after (or before) `from` among the boxes of the editor and the grid cells that are inputs. */
export function focusNextInput(root: HTMLElement, from: HTMLElement, step: 1 | -1): void {
  const all = [...root.querySelectorAll<HTMLElement>('input.cm-attr-input')];
  const i = all.indexOf(from);
  const next = i < 0 ? null : all[i + step];
  if (next) {
    next.focus();
    (next as HTMLInputElement).select?.();
  }
}

/** A paste into a one-line box: line breaks and tabs become spaces, so a pasted column of amounts stays a list of amounts. */
export function pasteAsOneLine(e: ClipboardEvent, input: HTMLInputElement): void {
  const text = e.clipboardData?.getData('text/plain');
  if (text === undefined || !/[\r\n\t]/.test(text)) return;
  e.preventDefault();
  const one = text.replace(/[\r\n\t]+/g, ' ').trim();
  const from = input.selectionStart ?? input.value.length;
  const to = input.selectionEnd ?? from;
  input.setRangeText(one, from, to, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const fit = (input: HTMLInputElement): void => {
  input.size = Math.max(4, Math.min(40, input.value.length + 1));
};

/** The box drawn for `${=this.name}`. */
export class InputWidget extends WidgetType {
  constructor(
    readonly key: string | null,
    readonly expr: string,
    readonly value: string,
  ) {
    super();
  }
  override eq(o: InputWidget): boolean {
    return o.key === this.key && o.value === this.value && o.expr === this.expr;
  }
  override toDOM(view: EditorView): HTMLElement {
    if (this.key === null) {
      const bad = document.createElement('span');
      bad.className = 'cm-expression cm-expression-bad';
      bad.textContent = 'An input box names one attribute of this page: ${=this.name}';
      bad.title = `\${${this.expr}}`;
      return bad;
    }
    const key = this.key;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cm-attr-input';
    input.value = this.value;
    input.placeholder = key;
    input.spellcheck = false;
    input.title = `${key}: Enter or Tab saves it in the page's attributes, Esc puts it back`;
    input.setAttribute('aria-label', key);
    input.disabled = view.state.readOnly;
    if (/^-?[\d.,$() ]*$/.test(this.value)) input.inputMode = 'decimal';
    fit(input);
    const original = this.value;
    let done = false;
    const save = (): void => {
      if (done) return;
      done = true;
      writeAttribute(view, key, input.value);
    };
    input.addEventListener('input', () => fit(input));
    input.addEventListener('paste', (e) => pasteAsOneLine(e, input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
        input.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const root = view.dom;
        const all = [...root.querySelectorAll<HTMLElement>('input.cm-attr-input')];
        const at = all.indexOf(input);
        save();
        // the saved box may be drawn again; the others keep their place, so the next one is found by where this one was
        const step = e.shiftKey ? -1 : 1;
        requestAnimationFrame(() => {
          const now = [...root.querySelectorAll<HTMLInputElement>('input.cm-attr-input')];
          const next = now[at + step];
          if (next) {
            next.focus();
            next.select();
          }
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.value = original;
        done = true;
        input.blur();
        view.focus();
      }
    });
    input.addEventListener('blur', save);
    input.addEventListener('focus', () => {
      done = false;
    });
    const wrap = document.createElement('span');
    wrap.className = 'cm-attr-input-wrap';
    wrap.append(input);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true; // the box handles its own keys and clicks
  }
}
