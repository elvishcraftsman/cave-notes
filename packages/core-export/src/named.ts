import { BUILTIN_NAMED, type NamedStyle, type StyleSet } from './styles';

const q = (f: string): string => `"${f.replace(/["\\]/g, '')}", serif`;

/** CSS declarations for a paragraph style. `editor`: the lines of the editor (the left margin is padding there). */
export function namedDecls(st: NamedStyle, mode: 'html' | 'editor' = 'html'): string {
  const d: string[] = [];
  const left = mode === 'editor' ? 'padding-left' : 'margin-left';
  if (st.indentCm !== undefined || st.hangingCm !== undefined) d.push(`${left}:${st.indentCm ?? st.hangingCm ?? 0}cm${mode === 'editor' ? ' !important' : ''}`);
  if (st.hangingCm) d.push(`text-indent:-${st.hangingCm}cm`);
  else if (st.firstLineIndentCm !== undefined) d.push(`text-indent:${st.firstLineIndentCm}cm`);
  if (st.align) d.push(`text-align:${st.align}`);
  if (st.font) d.push(`font-family:${q(st.font)}`);
  if (st.sizePt !== undefined) d.push(`font-size:${st.sizePt}pt`);
  if (st.color) d.push(`color:${st.color}`);
  if (st.background) d.push(`background:${st.background}`);
  if (st.bold !== undefined) d.push(`font-weight:${st.bold ? 700 : 400}`);
  if (st.italic !== undefined) d.push(`font-style:${st.italic ? 'italic' : 'normal'}`);
  if (st.lineHeight !== undefined) d.push(`line-height:${st.lineHeight}`);
  if (mode === 'html') {
    if (st.before !== undefined) d.push(`margin-top:${st.before}pt`);
    if (st.after !== undefined) d.push(`margin-bottom:${st.after}pt`);
  }
  return d.join(';');
}

/** The names of all paragraph styles of a set: the built-in ones and its own. */
export const namedList = (s: Pick<StyleSet, 'styles'>): Record<string, NamedStyle> => {
  const out: Record<string, NamedStyle> = {};
  for (const [k, v] of Object.entries(BUILTIN_NAMED)) out[k] = { ...v, ...(s.styles?.[k] ?? {}) };
  for (const [k, v] of Object.entries(s.styles ?? {})) if (!(k in out)) out[k] = v;
  return out;
};

/** CSS for the editor: one rule per style, for the lines inside `::: name` blocks (`.cm-div-name`). A line that continues a paragraph keeps its margin but not the hanging first line. */
export function editorCss(styles: Record<string, NamedStyle>): string {
  return Object.entries(styles)
    .map(([k, v]) => `.cm-line.cm-div-${k}{${namedDecls(v, 'editor')}}${v.hangingCm ? `\n.cm-line.cm-div-${k}.cm-div-cont{text-indent:0}` : ''}`)
    .join('\n');
}
