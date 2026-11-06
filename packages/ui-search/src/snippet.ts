/** core-index marks matches in snippets with these control characters (never HTML). */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

export interface Segment {
  text: string;
  match: boolean;
}

export function segments(snippet: string | null | undefined): Segment[] {
  if (!snippet) return [];
  const out: Segment[] = [];
  let match = false;
  let cur = '';
  const flush = (): void => {
    if (cur) out.push({ text: cur, match });
    cur = '';
  };
  for (const ch of snippet) {
    if (ch === HIGHLIGHT_START) {
      flush();
      match = true;
    } else if (ch === HIGHLIGHT_END) {
      flush();
      match = false;
    } else cur += ch;
  }
  flush();
  return out;
}

/** "Theology/Soteriology/Grace.md" → ["Theology", "Soteriology"] (the ancestors). */
export function breadcrumb(path: string): string[] {
  const parts = path.replace(/\.md$/, '').split('/');
  return parts.slice(0, -1);
}
