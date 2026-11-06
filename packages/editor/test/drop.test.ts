import { describe, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';

function make(handlers: Partial<ConstructorParameters<typeof NoteEditor>[0]>) {
  const parent = document.createElement('div');
  document.body.append(parent);
  return { parent, ed: new NoteEditor({ parent, ...handlers }) };
}
const drag = (type: string, store: Record<string, string>): Event & { dataTransfer: unknown } => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  e.dataTransfer = { types: Object.keys(store), getData: (t: string) => store[t] ?? '', files: [], dropEffect: 'none' };
  return e;
};

describe('dropping pages and files on the editor', () => {
  it('a page dropped on the text is reported with its workspace', () => {
    const got: unknown[] = [];
    const { ed } = make({ onDropPage: (p, pos, w) => got.push([p, pos, w]) });
    ed.view.contentDOM.dispatchEvent(drag('drop', { 'application/x-cave-page': 'A/B.md', 'application/x-cave-workspace': '/w' }));
    expect(got).toEqual([['A/B.md', 0, '/w']]);
  });

  it('a page dropped beside the text (on the empty pane) is accepted too', () => {
    const got: unknown[] = [];
    const { parent, ed } = make({ onDropPage: (p) => got.push(p) });
    const over = drag('dragover', { 'application/x-cave-page': 'A.md' });
    parent.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    parent.dispatchEvent(drag('drop', { 'application/x-cave-page': 'A.md' }));
    expect(got).toEqual(['A.md']);
    ed.destroy();
  });

  it('a file from the sub-page bar is reported on its own', () => {
    const got: unknown[] = [];
    const pages: unknown[] = [];
    const { parent } = make({ onDropFile: (p) => got.push(p), onDropPage: (p) => pages.push(p) });
    const over = drag('dragover', { 'application/x-cave-file': 'A/pic.png' });
    parent.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    parent.dispatchEvent(drag('drop', { 'application/x-cave-file': 'A/pic.png' }));
    expect(got).toEqual(['A/pic.png']);
    expect(pages).toEqual([]);
  });

  it('a drop is handled once, not by both the text and the pane', () => {
    const got: unknown[] = [];
    const { ed } = make({ onDropPage: (p) => got.push(p) });
    ed.view.contentDOM.dispatchEvent(drag('drop', { 'application/x-cave-page': 'X.md' }));
    expect(got).toEqual(['X.md']);
  });
});
