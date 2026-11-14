/**
 * CriticMarkup highlights and comments inside the text of a page:
 *
 *   {==highlighted text==}            a highlight
 *   {==highlighted text==}{>>why<<}   a highlight with a comment about it (the comment must follow the highlight directly)
 *   {>>a comment<<}                   a comment on a point in the text
 *
 * `criticize` turns the markers in a paragraph's runs into this: a run inside a highlight has `hl` (the number of the
 * annotation), and a comment is an empty run with `cmt` ({ id, text }) where its anchor ends. The comment's id is the `hl` of
 * the highlight it belongs to, or a new one when it stands alone. The writers draw highlights as highlights, and comments as
 * the comments of their format (Word and OpenDocument comments); the PDF/HTML form numbers them and lists them at the end.
 */
import type { Block, Inline } from './doc';

const TOKEN = /\{==|==\}|\{>>|<<\}/g;
const QUICK = /\{==|\{>>/;

export function criticize(runs: Inline[], next: () => number): Inline[] {
  if (!runs.some((r) => !r.code && QUICK.test(r.text))) return runs;
  const out: Inline[] = [];
  let hl: number | null = null; // the highlight being read
  let closed: number | null = null; // the highlight that has just ended, if nothing has come since
  let buf: string | null = null; // the text of the comment being read
  let target: number | null = null; // the highlight a comment being read belongs to
  const emit = (run: Inline, text: string): void => {
    if (text === '') return;
    if (buf !== null) {
      buf += text;
      return;
    }
    closed = null;
    out.push({ ...run, text, ...(hl !== null ? { hl } : {}) });
  };
  for (const run of runs) {
    if (run.code || run.br || run.note !== undefined) {
      if (buf !== null && !run.br && run.note === undefined) buf += run.text;
      else {
        closed = null;
        out.push(hl !== null && !run.br ? { ...run, hl } : run);
      }
      continue;
    }
    let pos = 0;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(run.text); m; m = TOKEN.exec(run.text)) {
      emit(run, run.text.slice(pos, m.index));
      pos = m.index + m[0].length;
      const tok = m[0];
      if (tok === '{==' && hl === null && buf === null) {
        hl = next();
        closed = null;
      } else if (tok === '==}' && hl !== null && buf === null) {
        closed = hl;
        hl = null;
        // a highlight with nothing in it is not kept
      } else if (tok === '{>>' && buf === null) {
        target = hl ?? closed;
        buf = '';
        closed = null;
      } else if (tok === '<<}' && buf !== null) {
        const text = buf.replace(/\s+/g, ' ').trim();
        buf = null;
        out.push({ text: '', cmt: { id: target ?? next(), text } });
        target = null;
      } else emit(run, tok); // not in the right place: it is just text
    }
    emit(run, run.text.slice(pos));
  }
  if (buf !== null) out.push({ text: `{>>${buf}` }); // a comment that never ends is shown as it was written
  return out;
}

/** Every comment of a document, in the order they come, with the number each is shown by (1, 2, 3 …). */
export function collectComments(blocks: Block[]): Array<{ id: number; n: number; text: string }> {
  const found: Array<{ id: number; n: number; text: string }> = [];
  const items = (list: Inline[]): void => {
    for (const i of list) if (i.cmt) found.push({ id: i.cmt.id, n: found.length + 1, text: i.cmt.text });
  };
  const walk = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.t === 'heading' || b.t === 'para') items(b.inlines);
      else if (b.t === 'quote' || b.t === 'div') walk(b.blocks);
      else if (b.t === 'list') for (const it of b.items) walk(it.blocks);
      else if (b.t === 'table') {
        for (const c of b.head) items(c);
        for (const r of b.rows) for (const c of r) items(c);
      }
    }
  };
  walk(blocks);
  return found;
}
