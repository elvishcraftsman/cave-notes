import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NoteEditor, applyMark, frontmatterValue, inputKey, setFrontmatterValue, yamlScalar, type EmbedHost, type ExpressionResult } from '../src/index';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const host = (answer: (expr: string) => ExpressionResult = (e) => ({ ok: true, values: [{ text: `<${e}>` }] })): EmbedHost => ({
  mount: () => ({ destroy: () => {} }) as never,
  expression: async (e) => answer(e),
  watch: (cb) => (cb(), () => {}),
});

function make(doc: string, h: EmbedHost = host()): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el, embed: h });
  ed.load(doc);
  ed.view.dispatch({ selection: { anchor: doc.length } });
  return ed;
}

describe('the attributes an input box names', () => {
  it('reads this.name and this["two words"], and nothing else', () => {
    expect(inputKey('=this.cash')).toBe('cash');
    expect(inputKey(' = this.shop_20 ')).toBe('shop_20');
    expect(inputKey('=this["opening cash"]')).toBe('opening cash');
    expect(inputKey('=[[Other]].cash')).toBeNull();
    expect(inputKey('=this.a + 1')).toBeNull();
    expect(inputKey('this.cash')).toBeNull();
  });

  it('shows a value as it is written, and a list as its items', () => {
    const doc = EditorState.create({ doc: '---\ncash: 12.50\nname: "Jo: Smith"\nlist: [1, 2]\nblock:\n  - 3\n  - 4\nempty:\n---\n# P\n' }).doc;
    expect(frontmatterValue(doc, 'cash')).toBe('12.50');
    expect(frontmatterValue(doc, 'CASH')).toBe('12.50');
    expect(frontmatterValue(doc, 'name')).toBe('Jo: Smith');
    expect(frontmatterValue(doc, 'list')).toBe('1 2');
    expect(frontmatterValue(doc, 'block')).toBe('3 4');
    expect(frontmatterValue(doc, 'empty')).toBe('');
    expect(frontmatterValue(doc, 'missing')).toBe('');
  });

  it('writes numbers as typed, quotes text only when it must, and adds what is missing', () => {
    expect(yamlScalar('12.50')).toBe('12.50');
    expect(yamlScalar('12.50 30 7')).toBe('12.50 30 7');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(yamlScalar('  ')).toBe('');
    const apply = (doc: string, key: string, text: string): string => {
      const s = EditorState.create({ doc });
      return s.update({ changes: setFrontmatterValue(s, key, text) }).state.doc.toString();
    };
    expect(apply('---\ncash: 1\nb: 2\n---\n', 'cash', '40')).toBe('---\ncash: 40\nb: 2\n---\n');
    expect(apply('---\nlist:\n  - 1\n  - 2\nb: 2\n---\n', 'list', '5 6')).toBe('---\nlist: 5 6\nb: 2\n---\n');
    expect(apply('---\nb: 2\n---\n', 'cash', '7')).toBe('---\nb: 2\ncash: 7\n---\n');
    expect(apply('# P\n', 'cash', '7')).toBe('---\ncash: 7\n---\n# P\n');
    expect(apply('---\ncash: 4\n---\n', 'cash', '')).toBe('---\ncash:\n---\n');
  });
});

describe('${=this.name} in the text', () => {
  it('is a box that shows the attribute and writes it back when Enter is pressed', async () => {
    const ed = make('---\ncash: 12.50\n---\nCash: ${=this.cash} counted\n\nend');
    await settle();
    const input = ed.view.dom.querySelector<HTMLInputElement>('input.cm-attr-input')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('12.50');
    input.focus();
    input.value = '99';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ed.view.state.doc.toString()).toContain('cash: 99\n');
    // drawn again with the new value
    expect(ed.view.dom.querySelector<HTMLInputElement>('input.cm-attr-input')!.value).toBe('99');
  });

  it('saves when it loses the focus, and Esc puts the value back', async () => {
    const ed = make('---\na: 1\n---\n${=this.a} and ${=this.b}\n\nend');
    await settle();
    const [a, b] = [...ed.view.dom.querySelectorAll<HTMLInputElement>('input.cm-attr-input')];
    b!.focus();
    b!.value = 'x y';
    b!.dispatchEvent(new FocusEvent('blur'));
    expect(ed.view.state.doc.toString()).toContain('b: x y\n');
    const a2 = ed.view.dom.querySelector<HTMLInputElement>('input.cm-attr-input')!;
    expect(a2).toBe(a); // the other box was not drawn again
    a2.focus();
    a2.value = '5';
    a2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ed.view.state.doc.toString()).toContain('a: 1\n');
  });

  it('says what is wrong with a box that names something else', async () => {
    const ed = make('${=[[Other]].x}\n\nend');
    await settle();
    expect(ed.view.dom.querySelector('.cm-expression-bad')?.textContent).toContain('${=this.name}');
  });
});

describe('expressions and input cells in a table', () => {
  const DOC = '---\nshop: 50\n---\n| Till | Collected | Income |\n| --- | --- | --- |\n| Shop | ${=this.shop} | ${this.shop - 3} |\n\nend';

  it('draws an expression cell as its value and an input cell as the attribute', async () => {
    const ed = make(DOC);
    await settle();
    const cells = [...ed.view.dom.querySelectorAll<HTMLElement>('td.cm-table-cell')];
    const input = cells.find((c) => c.dataset.attr === 'shop')!;
    expect(input.textContent).toBe('50');
    expect(input.classList.contains('cm-attr-cell')).toBe(true);
    expect(cells.find((c) => c.textContent === '<this.shop - 3>')).toBeDefined();
  });

  it('writes what is typed in an input cell into the attributes, and leaves the table as it was', async () => {
    const ed = make(DOC);
    await settle();
    const input = ed.view.dom.querySelector<HTMLElement>('td[data-attr="shop"]')!;
    input.dispatchEvent(new FocusEvent('focus'));
    expect(input.textContent).toBe('50');
    input.textContent = '75';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new FocusEvent('blur'));
    const text = ed.view.state.doc.toString();
    expect(text).toContain('shop: 75\n');
    expect(text).toContain('| Shop | ${=this.shop} | ${this.shop - 3} |');
    expect(ed.view.dom.querySelector<HTMLElement>('td[data-attr="shop"]')!.textContent).toBe('75');
  });

  it('shows the new value when the attribute is changed elsewhere', async () => {
    const ed = make(DOC);
    await settle();
    const from = ed.view.state.doc.toString().indexOf('50');
    ed.view.dispatch({ changes: { from, to: from + 2, insert: '61' } });
    expect(ed.view.dom.querySelector<HTMLElement>('td[data-attr="shop"]')!.textContent).toBe('61');
  });
});

describe('highlight()', () => {
  it('colours an expression whose test is true', async () => {
    const ed = make('Diff: ${highlight(this.d, abs(this.d) > 5)}\n\nend', host(() => ({ ok: true, values: [{ text: '-8' }], mark: 'orange' })));
    await settle();
    const el = ed.view.dom.querySelector<HTMLElement>('.cm-expression')!;
    expect(el.textContent).toBe('-8');
    expect(el.classList.contains('cm-expression-mark')).toBe(true);
    expect(el.style.getPropertyValue('--cm-mark')).toBe('#ff7800');
  });

  it('takes named colours and #rrggbb, and nothing else', () => {
    const el = document.createElement('span');
    applyMark(el, '#123456');
    expect(el.style.getPropertyValue('--cm-mark')).toBe('#123456');
    applyMark(el, 'url(x)');
    expect(el.classList.contains('cm-expression-mark')).toBe(false);
    applyMark(el, undefined);
    expect(el.style.getPropertyValue('--cm-mark')).toBe('');
  });
});
