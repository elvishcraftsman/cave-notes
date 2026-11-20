import { CompletionContext } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';
import { NoteEditor, type SchemaHint, yamlCompletionSource } from '../src/index';

const attrs: SchemaHint[] = [
  { key: 'status', type: 'string', declared: true, schemaType: 'enum', values: ['open', 'done'], pages: 2 },
  { key: 'due', type: 'date', declared: true, schemaType: 'date', pages: 1 },
  { key: 'mood', type: 'string', pages: 4 },
];
const source = yamlCompletionSource({ attributes: () => attrs, savedQueries: () => ['Open tasks', 'Reading'] });

/** The completion at the `|` in some text. */
function at(text: string): string[] | null {
  const pos = text.indexOf('|');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text.replace('|', ''));
  const r = source(new CompletionContext(ed.state, pos, true)) as { options: Array<{ label: string }> } | null;
  return r ? r.options.map((o) => o.label) : null;
}

describe('completion in frontmatter and view blocks', () => {
  it('offers reserved and attribute names at the start of a line', () => {
    const names = at('---\nst|\n---\n\nBody')!;
    expect(names).toContain('status');
    expect(names).toContain('hidden');
    expect(names).toContain('mood');
    expect(names).not.toContain('defaults');
  });
  it('offers the choices of a select and of the reserved names', () => {
    expect(at('---\nstatus: |\n---\n')).toEqual(['open', 'done']);
    expect(at('---\nhidden: tr|\n---\n')).toContain('tree');
  });
  it('does nothing in plain text', () => {
    expect(at('Some text status|')).toBeNull();
  });
  it('completes the settings and values of a view block', () => {
    const fence = (inner: string): string => `\`\`\`view\n${inner}\n\`\`\`\n`;
    expect(at(fence('ty|'))).toContain('type');
    expect(at(fence('type: |'))).toContain('kanban');
    expect(at(fence('sort: |'))).toEqual(expect.arrayContaining(['status', 'due']));
    expect(at(fence('query: !|'))).toEqual(['Open tasks', 'Reading']);
    expect(at(fence('query: status:|'))).toEqual(['open', 'done']);
    expect(at(fence('query: due:today st|'))).toContain('status');
  });
});
