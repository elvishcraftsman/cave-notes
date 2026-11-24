import { CompletionContext } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';
import { NoteEditor, slashCompletionSource } from '../src/index';

const source = slashCompletionSource();
function at(text: string): { ed: NoteEditor; res: ReturnType<typeof source> } {
  const pos = text.indexOf('|');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text.replace('|', ''));
  return { ed, res: source(new CompletionContext(ed.state, pos, false)) };
}

describe('the slash menu', () => {
  it('lists the selection menu\u2019s items for a slash at the start of a line', () => {
    const { res } = at('/|');
    const labels = res!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['Bold', 'Heading 1', 'Quote', 'Code block', 'Task list', 'Table', 'Database view', 'Bulleted list']));
  });
  it('is there after indentation and while typing, and nowhere else', () => {
    expect(at('  /hea|').res).not.toBeNull();
    expect(at('text /|').res).toBeNull();
    expect(at('1/2|').res).toBeNull();
    expect(at('```js\n/|\n```').res).toBeNull();
    expect(at('---\n/|\n---\n').res).toBeNull();
  });
  it('takes the slash away and does the thing', () => {
    const { ed, res } = at('/h2|');
    const opt = res!.options.find((o) => o.label === 'Heading 2')!;
    (opt.apply as (v: unknown, c: unknown, f: number, t: number) => void)(ed.view, opt, 1, 3);
    expect(ed.text()).toBe('## ');
  });
});
