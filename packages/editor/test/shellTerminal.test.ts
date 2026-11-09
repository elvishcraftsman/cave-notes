import { describe as suite, expect, it } from 'vitest';
import { NoteEditor } from '../src/index';
import { codeBlocks } from '../src/codeActions';

const blocks = (text: string) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text);
  return codeBlocks(ed.view.state);
};

suite('shell blocks and terminals', () => {
  it('every shell block opens a terminal unless it says no-terminal', () => {
    const b = blocks('```bash\nls\n```\n\n```sh no-terminal\ndf -h\n```\n\n```zsh terminal\necho a\n```\n\n```js\nlet a = 1\n```\n');
    expect(b.map((x) => [x.lang, x.shell, x.terminal])).toEqual([
      ['bash', true, true],
      ['sh', true, false],
      ['zsh', true, true],
      ['js', false, false],
    ]);
  });
  it('accepts noterminal and any capitals', () => {
    expect(blocks('```bash NoTerminal\nls\n```\n')[0]?.terminal).toBe(false);
  });
});
