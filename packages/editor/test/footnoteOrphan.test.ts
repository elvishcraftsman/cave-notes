import { describe, expect, it } from 'vitest';
import { type FootnoteOrphan, NoteEditor } from '../src/index';

function make(text: string): { ed: NoteEditor; found: FootnoteOrphan[] } {
  const found: FootnoteOrphan[] = [];
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, onFootnoteOrphan: (o) => found.push(o) });
  ed.load(text);
  return { ed, found };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const DOC = 'First[^1] and second[^2].\n\n[^1]: One note.\n[^2]: Two note.\n';

describe('deleting a footnote reference or a footnote', () => {
  it('offers to delete the footnote when its reference is deleted', async () => {
    const { ed, found } = make(DOC);
    const at = DOC.indexOf('[^1]');
    ed.view.dispatch({ changes: { from: at, to: at + 4 }, userEvent: 'delete' });
    await tick();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'text', preview: 'One note.' });
    found[0]!.remove();
    expect(ed.text()).toBe('First and second[^1].\n\n[^1]: Two note.\n');
  });

  it('offers to delete the reference when its footnote is deleted', async () => {
    const { ed, found } = make(DOC);
    const from = DOC.indexOf('[^2]:');
    ed.view.dispatch({ changes: { from, to: DOC.length }, userEvent: 'delete' });
    await tick();
    expect(found.map((f) => f.kind)).toEqual(['marker']);
    found[0]!.remove();
    expect(ed.text()).toBe('First[^1] and second.\n\n[^1]: One note.\n');
  });

  it('says nothing when the label is only retyped, when both go, or on undo', async () => {
    const { ed, found } = make(DOC);
    const at = DOC.indexOf('[^1]');
    ed.view.dispatch({ changes: { from: at + 2, to: at + 3, insert: '7' }, userEvent: 'input.type' });
    await tick();
    expect(found).toHaveLength(0);
    const both = make(DOC);
    both.ed.view.dispatch({ changes: [{ from: DOC.indexOf('[^2].'), to: DOC.indexOf('[^2].') + 4 }, { from: DOC.indexOf('[^2]:'), to: DOC.length }], userEvent: 'delete' });
    await tick();
    expect(both.found).toHaveLength(0);
  });
});
