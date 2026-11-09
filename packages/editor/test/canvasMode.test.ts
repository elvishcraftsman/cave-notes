import { plainHost } from '@cave-notes/ui-canvas';
import { describe as suite, expect, it } from 'vitest';
import { NoteEditor, canvasViewOf, textDiff } from '../src/index';

const FILE = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"one","x":0,"y":0,"width":200,"height":100},\n\t\t{"id":"b","type":"text","text":"two","x":400,"y":0,"width":200,"height":100}\n\t],\n\t"edges":[]\n}';

function make(text = FILE, readOnly = false): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const { onChange: _unused, ...host } = plainHost();
  const ed = new NoteEditor({ parent: el, canvas: host });
  ed.load(text, { canvas: true, readOnly });
  return ed;
}

suite('textDiff', () => {
  it('keeps what both texts share at the start and the end', () => {
    expect(textDiff('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
    expect(textDiff('abc', 'abc')).toBeNull();
    expect(textDiff('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' });
    expect(textDiff('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
    expect(textDiff('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
  });
});

suite('a canvas file in the editor', () => {
  it('is drawn as a canvas, not as text', () => {
    const ed = make();
    expect(ed.isCanvas()).toBe(true);
    expect(ed.view.dom.querySelectorAll('.cv-node')).toHaveLength(2);
    expect(ed.view.dom.classList.contains('cm-canvas')).toBe(true);
    expect(ed.text()).toBe(FILE);
  });

  it('a change on the canvas is one change to the text, touching only that node', () => {
    const ed = make();
    const cv = canvasViewOf(ed.view)!;
    cv.select(['a']);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const lines = ed.text().split('\n');
    expect(lines[2]).toContain('"x":10');
    expect(lines[3]).toBe(FILE.split('\n')[3]); // the other node's line is untouched
    expect(JSON.parse(ed.text()).nodes[0].x).toBe(10);
  });

  it('undo through the editor takes the change back and the canvas follows', () => {
    const ed = make();
    const cv = canvasViewOf(ed.view)!;
    cv.select(['a']);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(ed.view.dom.querySelectorAll('.cv-node')).toHaveLength(1);
    expect(JSON.parse(ed.text()).nodes).toHaveLength(1);
    ed.undo();
    expect(ed.text()).toBe(FILE);
    expect(ed.view.dom.querySelectorAll('.cv-node')).toHaveLength(2);
    ed.redo();
    expect(ed.view.dom.querySelectorAll('.cv-node')).toHaveLength(1);
  });

  it('Ctrl+Z on the canvas undoes, and keys never reach the text', () => {
    const ed = make();
    const cv = canvasViewOf(ed.view)!;
    cv.select(['b']);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(JSON.parse(ed.text()).nodes).toHaveLength(1);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(ed.text()).toBe(FILE);
    // Backspace with nothing selected must not eat the JSON
    cv.select([]);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(ed.text()).toBe(FILE);
  });

  it('a new document text (a sync, a restore) is drawn, and the pan and zoom stay', () => {
    const ed = make();
    const cv = canvasViewOf(ed.view)!;
    cv.setViewport({ x: 5, y: 6, zoom: 1.5 });
    const next = FILE.replace('"text":"one"', '"text":"uno"');
    ed.view.dispatch({ changes: { from: 0, to: ed.text().length, insert: next } });
    expect(ed.view.dom.querySelector('[data-node="a"]')!.textContent).toBe('uno');
    expect(cv.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });

  it('typing in a text node is saved as it goes and undone as one burst', () => {
    const ed = make();
    const cv = canvasViewOf(ed.view)!;
    cv.startEdit('a');
    const ta = ed.view.dom.querySelector('textarea')!;
    for (const t of ['one!', 'one!!', 'one!!!']) {
      ta.value = t;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(JSON.parse(ed.text()).nodes[0].text).toBe('one!!!');
    ed.undo();
    expect(JSON.parse(ed.text()).nodes[0].text).toBe('one');
  });

  it('an empty file is an empty canvas that can be drawn on', () => {
    const ed = make('');
    expect(ed.isCanvas()).toBe(true);
    const cv = canvasViewOf(ed.view)!;
    cv.addText({ x: 0, y: 0 }, 'first');
    expect(JSON.parse(ed.text()).nodes[0]).toMatchObject({ type: 'text', text: 'first' });
  });

  it('a read-only canvas does not change the file', () => {
    const ed = make(FILE, true);
    const cv = canvasViewOf(ed.view)!;
    cv.select(['a']);
    cv.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(ed.text()).toBe(FILE);
  });

  it('a file that is not valid JSON is shown as text, so it can be repaired and is never overwritten', () => {
    const bad = '{"nodes": [ {"id": "a", ';
    const ed = make(bad);
    expect(ed.isCanvas()).toBe(false);
    expect(ed.view.dom.querySelectorAll('.cv-node')).toHaveLength(0);
    expect(ed.text()).toBe(bad);
    for (const text of ['# notes, not a canvas', '[1, 2]', '"text"']) expect(make(text).isCanvas()).toBe(false);
  });

  it('without a canvas host the file is plain text', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el });
    ed.load(FILE, { canvas: true });
    expect(ed.isCanvas()).toBe(false);
  });
});

suite('typing in a card that holds a real editor, as the app does', () => {
  function makeWithEditors(): { ed: NoteEditor; inner: () => NoteEditor | null; loads: () => number } {
    let current: NoteEditor | null = null;
    let loads = 0;
    const base = plainHost();
    const host = {
      ...base,
      mountText(el: HTMLElement, node: { text: string }, opts: { edit: boolean; onText: (t: string) => void; onDone: () => void }) {
        if (!opts.edit) {
          el.textContent = node.text;
          return { update: (t: string) => void (el.textContent = t), focus() {}, destroy: () => void (el.textContent = '') };
        }
        const e = new NoteEditor({ parent: el, onChange: () => opts.onText(e.text()) });
        e.load(node.text);
        current = e;
        return {
          update(t: string) {
            if (e.text() !== t) {
              loads++;
              e.load(t);
            }
          },
          focus() {
            e.view.dispatch({ selection: { anchor: e.text().length } });
          },
          destroy: () => e.destroy(),
        };
      },
    };
    const { onChange: _o, ...h } = host;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = new NoteEditor({ parent: el, canvas: h });
    ed.load(FILE, { canvas: true });
    return { ed, inner: () => current, loads: () => loads };
  }

  it('each typed letter lands after the last one, and the editor in the card is never reloaded under the caret', () => {
    const { ed, inner, loads } = makeWithEditors();
    const cv = canvasViewOf(ed.view)!;
    cv.startEdit('b');
    const e = inner()!;
    expect(e.text()).toBe('two');
    for (const ch of ['a', 'b', 'c']) {
      const at = e.view.state.selection.main.head;
      e.view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    }
    expect(e.text()).toBe('twoabc');
    expect(e.view.state.selection.main.head).toBe(6);
    expect(JSON.parse(ed.text()).nodes[1].text).toBe('twoabc');
    expect(loads()).toBe(0);
    // and what the card shows is what the file says
    cv.stopEdit();
    expect(ed.view.dom.querySelector('[data-node="b"]')!.textContent).toBe('twoabc');
  });

  it('the canvas is beside the text area of the editor, not inside it', () => {
    const { ed } = makeWithEditors();
    expect(ed.view.dom.querySelector('.cm-content .cm-canvas-wrap')).toBeNull();
    expect(ed.view.dom.querySelector(':scope > .cm-canvas-wrap')).not.toBeNull();
  });
});
