import { type Extension, type Range, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

/**
 * Styled blocks, written as fenced divs (the notation Pandoc, Quarto and MyST use):
 *
 *   ::: hanging
 *   A paragraph with a hanging indent.
 *   :::
 *
 * `::: {.poem .wide}` and `::: {custom-style="Name"}` also work. The lines in between get the CSS classes `cm-div`
 * and `cm-div-<name>` (and `cm-div-cont` on the lines that continue a paragraph), so a style is just CSS.
 */
export interface DivLine {
  line: number;
  kind: 'open' | 'close' | 'body';
  classes: string[];
  /** the line goes on with the paragraph of the line above */
  cont: boolean;
}

const FENCE = /^ {0,3}(:{3,})[ \t]*(.*?)[ \t]*:*[ \t]*$/;
const CODE = /^ {0,3}(`{3,}|~{3,})/;
const NAME = /^[A-Za-z][\w-]*$/;

/** The class names a div's opening line asks for. */
export function divClasses(spec: string): string[] {
  const t = spec.trim();
  if (t === '') return [];
  const out: string[] = [];
  if (t.startsWith('{')) {
    for (const m of t.matchAll(/\.([A-Za-z][\w-]*)|custom-style\s*=\s*"([^"]+)"/g)) {
      const n = (m[1] ?? m[2] ?? '').trim().replace(/\s+/g, '-');
      if (NAME.test(n)) out.push(n);
    }
  } else {
    for (const w of t.split(/\s+/)) if (NAME.test(w)) out.push(w);
  }
  return out;
}

/** Every line that belongs to a div, outside fenced code. */
export function divLines(state: EditorState): DivLine[] {
  const out: DivLine[] = [];
  const stack: Array<{ len: number; classes: string[] }> = [];
  let code: string | null = null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    const c = CODE.exec(text);
    if (c) {
      code = code === null ? c[1]![0]! : code === c[1]![0] ? null : code;
      if (stack.length) out.push({ line: n, kind: 'body', classes: stack.flatMap((s) => s.classes), cont: false });
      continue;
    }
    if (code !== null) {
      if (stack.length) out.push({ line: n, kind: 'body', classes: stack.flatMap((s) => s.classes), cont: false });
      continue;
    }
    // `::: :::` closes two blocks on one line (the inner one, then the one around it)
    const many = /^ {0,3}(:{3,}(?:[ \t]+:{3,})+)[ \t]*$/.exec(text);
    if (many && stack.length) {
      out.push({ line: n, kind: 'close', classes: [], cont: false });
      stack.length = Math.max(0, stack.length - many[1]!.split(/[ \t]+/).length);
      continue;
    }
    const f = FENCE.exec(text);
    if (f) {
      const len = f[1]!.length;
      const spec = f[2]!;
      if (spec === '') {
        // a closing fence ends the innermost div it can
        const at = stack.map((s) => s.len).lastIndexOf(len);
        if (at >= 0) {
          out.push({ line: n, kind: 'close', classes: [], cont: false });
          stack.length = at;
          continue;
        }
      } else {
        stack.push({ len, classes: divClasses(spec) });
        out.push({ line: n, kind: 'open', classes: [], cont: false });
        continue;
      }
    }
    if (stack.length) {
      const prev = out[out.length - 1];
      const above = n > 1 ? state.doc.line(n - 1).text : '';
      out.push({ line: n, kind: 'body', classes: stack.flatMap((s) => s.classes), cont: text.trim() !== '' && !!prev && prev.line === n - 1 && prev.kind === 'body' && above.trim() !== '' });
    }
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const d of divLines(state)) {
    const from = state.doc.line(d.line).from;
    if (d.kind !== 'body') ranges.push(Decoration.line({ class: 'cm-div-fence' }).range(from));
    else ranges.push(Decoration.line({ class: `cm-div ${d.cont ? 'cm-div-cont ' : ''}${d.classes.map((c) => `cm-div-${c}`).join(' ')}`.trim() }).range(from));
  }
  return Decoration.set(ranges, true);
}

export const divsTheme = EditorView.baseTheme({
  '.cm-div-fence': { opacity: 0.45, fontSize: '0.85em' },
  '.cm-line.cm-div-hanging': { paddingLeft: '2.5em !important', textIndent: '-2.5em' },
  '.cm-line.cm-div-hanging.cm-div-cont': { textIndent: '0' },
  '.cm-line.cm-div-center': { textAlign: 'center' },
  '.cm-line.cm-div-right': { textAlign: 'right' },
});

export function divs(): Extension {
  return [
    StateField.define<DecorationSet>({
      create: (s) => build(s),
      update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
      provide: (f) => EditorView.decorations.from(f),
    }),
    divsTheme,
  ];
}
