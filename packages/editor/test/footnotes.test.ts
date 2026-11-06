import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NoteEditor, footnoteFixes, scanFootnotes } from '../src/index';

function apply(text: string): string {
  const fix = footnoteFixes(text);
  if (!fix) return text;
  const st = EditorState.create({ doc: text });
  return st.update({ changes: fix.changes }).state.doc.toString();
}
function make(text: string): NoteEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = new NoteEditor({ parent: el });
  ed.load(text);
  return ed;
}

describe('footnote scanning', () => {
  it('ignores code and front matter', () => {
    const s = scanFootnotes('---\na: [^1]\n---\ntext[^1] `[^2]`\n\n```\n[^3]\n```\n\n[^1]: note\n');
    expect(s.refs.map((r) => r.label)).toEqual(['1']);
    expect(s.defs.map((d) => d.label)).toEqual(['1']);
  });
  it('takes indented lines as part of the footnote', () => {
    const s = scanFootnotes('a[^1]\n\n[^1]: one\n    more\n\n    para\n\nend');
    expect(s.defs[0]!.to).toBe('a[^1]\n\n[^1]: one\n    more\n\n    para'.length);
  });
});

describe('footnote order', () => {
  it('leaves a document in order alone', () => {
    const t = 'a[^1] b[^2]\n\n[^1]: x\n\n[^2]: y';
    expect(footnoteFixes(t)).toBeNull();
  });
  it('renumbers by first reference and reorders the definitions', () => {
    const t = 'a[^2] b[^1]\n\n[^1]: second\n\n[^2]: first';
    expect(apply(t)).toBe('a[^1] b[^2]\n\n[^1]: first\n\n[^2]: second');
  });
  it('is idempotent, so nothing is fixed twice', () => {
    const t = 'x[^3] y[^1] z[^2] again[^3]\n\n[^1]: b\n[^2]: c\n[^3]: a\n    more';
    const once = apply(t);
    expect(once).toBe('x[^1] y[^2] z[^3] again[^1]\n\n[^1]: a\n    more\n[^2]: b\n[^3]: c');
    expect(footnoteFixes(once)).toBeNull();
  });
  it('keeps named labels and leaves half-typed ones alone', () => {
    const t = 'a[^n] b[^1] c[^9]\n\n[^1]: one\n[^n]: named';
    expect(apply(t)).toBe('a[^n] b[^2] c[^9]\n\n[^n]: named\n[^2]: one');
  });
  it('fixes a page when it is opened, and when a marker moves', () => {
    const ed = make('a[^2] b[^1]\n\n[^1]: second\n[^2]: first');
    expect(ed.text()).toBe('a[^1] b[^2]\n\n[^1]: first\n[^2]: second');
    const t = ed.text();
    ed.view.dispatch({ changes: [{ from: t.indexOf(' b[^2]'), to: t.indexOf(' b[^2]') + 6 }, { from: 0, insert: 'b[^2] ' }] });
    expect(ed.text()).toBe('b[^1] a[^2]\n\n[^1]: second\n[^2]: first');
  });
});

describe('presenter notes in a presentation', () => {
  const deck = [
    '---',
    'presentationTheme: Clean',
    '---',
    '# One',
    '',
    'A point[^note] and a source[^1].',
    '',
    'More[^note2].',
    '',
    '---',
    '',
    '# Two',
    '',
    'Again[^note3] and[^2].',
    '',
    '[^note]: Pause here.',
    '[^note2]: Ask a question.',
    '[^note3]: Look up.',
    '[^1]: First source.',
    '[^2]: Second source.',
  ].join('\n');

  it('leaves them out of the numbering and letters them afresh on each slide', async () => {
    const { footnoteDisplay } = await import('../src/footnotes');
    const doc = EditorState.create({ doc: deck }).doc;
    const d = footnoteDisplay(doc);
    expect(d.presentation).toBe(true);
    expect([...d.order]).toEqual([['1', 1], ['2', 2]]); // the ordinary footnotes are 1 and 2, whatever notes come between
    const shown = (label: string): string[] => scanFootnotes(deck).refs.filter((r) => r.label === label).map((r) => d.ref.get(r.from)!);
    expect(shown('note')).toEqual(['a']);
    expect(shown('note2')).toEqual(['b']);
    expect(shown('note3')).toEqual(['a']); // slide two starts again
    expect(shown('1')).toEqual(['1']);
    expect(shown('2')).toEqual(['2']);
  });

  it('keeps ordinary numbering on a page that is not a presentation', async () => {
    const { footnoteDisplay } = await import('../src/footnotes');
    const text = 'A[^note] B[^1].\n\n[^note]: n\n[^1]: one\n';
    const d = footnoteDisplay(EditorState.create({ doc: text }).doc);
    expect(d.presentation).toBe(false);
    expect([...d.order]).toEqual([['note', 1], ['1', 2]]);
  });

  it('does not move the notes when the others are put in order', () => {
    const text = ['---', 'presentationTheme: Clean', '---', '# T', '', 'x[^note] y[^2] z[^1]', '', '[^note]: n', '[^1]: one', '[^2]: two'].join('\n');
    const out = apply(text);
    expect(out).toContain('x[^note] y[^1] z[^2]');
    expect(out.indexOf('[^note]: n')).toBeLessThan(out.indexOf('[^1]: two'));
  });

  it('finds the slides the way the exports do', async () => {
    const { slideStarts } = await import('../src/footnotes');
    const text = ['---', 'presentationTheme: Clean', '---', '# A', '## sub', 'text', '# B', 'text', '', '```', '---', '# not', '```', '', '---', 'last'].join('\n');
    const starts = slideStarts(text);
    const lineOf = (off: number): number => text.slice(0, off).split('\n').length;
    expect(starts.map(lineOf)).toEqual([4, 7, 16]);
  });
});
