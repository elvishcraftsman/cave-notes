import { describe as suite, expect, it } from 'vitest';
import { describe } from './helpers';
import { computeDecorations } from '../src/index';

suite('headings', () => {
  it('hide the # marks away from the cursor, and reveal them on the cursor line', () => {
    const away = describe('# Title\n\nbody‸');
    expect(away.hidden).toEqual(['# ']);
    expect(away.lines).toContain('1:cm-heading cm-h1');
    const on = describe('# Ti‸tle\n\nbody');
    expect(on.hidden).toEqual([]);
    expect(on.lines).toContain('1:cm-heading cm-h1');
  });

  it('style every level', () => {
    const d = describe('### Three\n###### Six\n\n‸');
    expect(d.lines).toEqual(expect.arrayContaining(['1:cm-heading cm-h3', '2:cm-heading cm-h6']));
  });

  it('setext headings are styled and #-less', () => {
    const d = describe('Title\n=====\n\n‸');
    expect(d.lines).toContain('1:cm-heading cm-h1');
  });
});

suite('inline formatting', () => {
  it('hides emphasis marks until the cursor touches the construct', () => {
    expect(describe('Some **bold** and *it* text‸').hidden).toEqual(['**', '**', '*', '*']);
    expect(describe('Some **bo‸ld** text').hidden).toEqual([]);
    expect(describe('Some **bold**‸ text').hidden).toEqual([]); // cursor at the edge still reveals
    const d = describe('**b** *i* ~~s~~ `c`‸');
    expect(d.marks).toEqual(expect.arrayContaining(['cm-strong:**b**', 'cm-em:*i*', 'cm-strike:~~s~~', 'cm-inline-code:`c`']));
  });

  it('only reveals the construct being edited, not others on the same line', () => {
    const d = describe('**one** and **tw‸o**');
    expect(d.hidden).toEqual(['**', '**']);
  });
});

suite('links', () => {
  it('hides the brackets and destination, leaving the text styled', () => {
    const d = describe('See [the docs](https://example.com "t") now‸');
    expect(d.hidden).toEqual(['[', '](https://example.com "t")']);
    expect(d.marks).toContain('cm-link cm-link-web:the docs');
  });

  it('shows the syntax while the cursor is in the link', () => {
    const d = describe('See [the d‸ocs](https://example.com) now');
    expect(d.hidden).toEqual([]);
    expect(d.marks.some((m) => m.startsWith('cm-link-syntax:'))).toBe(true);
  });

  it('marks links that leave the workspace', () => {
    expect(describe('See [x](cave://Theology/Writings/Grace.md) now‸').marks).toContain('cm-link cm-link-workspace:x');
    expect(describe('See [[Theology::Writings/Grace|favour]] now‸').marks.join('|')).toContain('cm-wikilink cm-wikilink-workspace');
    expect(describe('See [[Grace]] now‸').marks.join('|')).not.toContain('cm-wikilink-workspace');
  });

  it('styles autolinks and bare URLs', () => {
    expect(describe('<https://a.com> x‸').hidden).toEqual(['<', '>']);
    expect(describe('go to https://b.com now‸').marks).toContain('cm-link cm-url cm-link-web:https://b.com');
  });
});

suite('wikilinks', () => {
  it('hides the brackets', () => {
    const d = describe('See [[Grace]] now‸');
    expect(d.hidden).toEqual(['[[', ']]']);
    expect(d.marks).toContain('cm-wikilink:Grace');
  });

  it('shows only the alias for [[target#h|alias]], raw while editing', () => {
    const d = describe('See [[Grace#Sub|God\'s favour]] now‸');
    expect(d.hidden).toEqual(['[[Grace#Sub|', ']]']);
    expect(d.marks).toContain("cm-wikilink:God's favour");
    const raw = describe('See [[Gra‸ce#Sub|alias]] now');
    expect(raw.hidden).toEqual([]);
    expect(raw.marks[0]).toMatch(/cm-wikilink-raw/);
  });

  it('styles broken and ambiguous links using the supplied status', () => {
    const d = describe('[[Good]] [[Missing]] [[Dup]] x‸', {
      linkStatus: (raw) => (raw === 'Missing' ? 'broken' : raw === 'Dup' ? 'ambiguous' : 'ok'),
    });
    expect(d.marks).toEqual(expect.arrayContaining(['cm-wikilink:Good', 'cm-wikilink cm-wikilink-broken:Missing', 'cm-wikilink cm-wikilink-ambiguous:Dup']));
  });

  it('ignores wikilinks in code, escaped ones, and frontmatter', () => {
    const d = describe('`[[no]]` \\[[no]]\n\n```\n[[no]]\n```\n\n---\nx: [[no]]\n---\n\n[[yes]] x‸'.replace('---\nx: [[no]]\n---\n\n', ''));
    expect(d.marks.filter((m) => m.startsWith('cm-wikilink'))).toEqual(['cm-wikilink:yes']);
    const fm = describe('---\nx: "[[no]]"\n---\n\n[[yes]] x‸');
    expect(fm.marks.filter((m) => m.startsWith('cm-wikilink'))).toEqual(['cm-wikilink:yes']);
  });

  it('keeps embeds working: ![[x]] hides the bang and brackets', () => {
    expect(describe('![[Pic]] x‸').hidden).toEqual(['![[', ']]']);
  });
});

suite('blocks', () => {
  it('draws bullets, keeps ordered markers, reveals the marker on the cursor line', () => {
    expect(describe('- one\n- two‸').widgets).toEqual(['BulletWidget:-']); // cursor line keeps its raw marker
    expect(describe('- one‸\n- two').widgets).toEqual(['BulletWidget:-']);
    expect(describe('1. one\n2. two‸').widgets).toEqual([]);
    expect(describe('1. one\n2. two‸').marks).toContain('cm-list-prefix cm-list-mark:1. ');
  });

  it('shows checkboxes for tasks and dims completed ones', () => {
    const d = describe('- [ ] open\n- [x] done\n\n‸');
    expect(d.widgets).toEqual(expect.arrayContaining(['CheckboxWidget:[ ]', 'CheckboxWidget:[x]']));
    // a task item is a checkbox, not a bullet with a checkbox after it
    expect(d.widgets.filter((w) => w.startsWith('BulletWidget'))).toEqual([]);
    expect(d.lines).toContain('2:cm-task-done');
  });

  it('draws block quotes with the > hidden away from the cursor', () => {
    const d = describe('> quoted\n\n‸');
    expect(d.hidden).toEqual(['> ']);
    expect(d.lines).toContain('1:cm-quote');
  });

  it('styles fenced code blocks line by line and never decorates inside them', () => {
    const d = describe('```js\nconst **x** = [[y]];\n```\n\n‸');
    expect(d.lines).toEqual(expect.arrayContaining(['1:cm-codeblock', '2:cm-codeblock', '3:cm-codeblock', '1:cm-codeblock-first', '3:cm-codeblock-last']));
    expect(d.hidden).toEqual([]);
    expect(d.marks.some((m) => m.includes('cm-strong') || m.includes('cm-wikilink'))).toBe(false);
  });

  it('turns --- into a rule, hidden unless the cursor is on it', () => {
    const d = describe('above\n\n---\n\nbelow‸');
    expect(d.lines).toContain('3:cm-hr-line');
    expect(d.hidden).toEqual(['---']);
    expect(describe('above\n\n--‸-\n\nbelow').hidden).toEqual([]);
  });
});

suite('frontmatter', () => {
  it('is one styled block, not a rule plus a heading', () => {
    const d = describe('---\ntitle: Hello\ntags: [a]\n---\n\n# Body\n\n‸');
    expect(d.lines.filter((l) => l.endsWith('cm-frontmatter'))).toEqual(['1:cm-frontmatter', '2:cm-frontmatter', '3:cm-frontmatter', '4:cm-frontmatter']);
    expect(d.lines.filter((l) => l.includes('cm-h'))).toEqual(['6:cm-heading cm-h1']);
    expect(d.hidden).toEqual(['# ']);
  });

  it('an unclosed --- is just a rule', () => {
    const d = describe('---\ntitle: Hello\n\n# Body‸');
    expect(d.lines.some((l) => l.endsWith('cm-frontmatter'))).toBe(false);
  });
});

suite('images', () => {
  it('shows an image widget when a URL can be resolved, alt text otherwise', () => {
    const doc = 'before ![a cat](pics/cat.png) after‸';
    expect(describe(doc, { resolveAsset: (h) => `asset://${h}` }).widgets).toEqual(['ImageWidget:![a cat](pics/cat.png)']);
    const noUrl = describe(doc, { resolveAsset: () => null });
    expect(noUrl.widgets).toEqual([]);
    expect(noUrl.marks).toContain('cm-image-alt:a cat');
    // the cursor is on the same line but not on the image: it stays rendered
    expect(describe('before ![a cat](pics/cat.png) a‸fter', { resolveAsset: (h) => h }).widgets).toEqual(['ImageWidget:![a cat](pics/cat.png)']);
    expect(describe('before ![a ca‸t](pics/cat.png) after', { resolveAsset: (h) => h }).widgets).toEqual([]); // editing it shows the source
  });
});

suite('focus', () => {
  it('reveals nothing while the editor is not focused, even with a cursor on the line', async () => {
    const { EditorSelection, EditorState } = await import('@codemirror/state');
    const { computeDecorations, markdownSupport } = await import('../src/index');
    const doc = '# Title\n\nSome **bold** text';
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(3), extensions: [markdownSupport()] });
    const hiddenOf = (reveal: boolean): string[] => {
      const out: string[] = [];
      computeDecorations(state, [{ from: 0, to: doc.length }], {}, reveal).between(0, doc.length, (f, t, v) => {
        if (v.constructor.name === 'PointDecoration' && !(v.spec as { widget?: unknown }).widget) out.push(doc.slice(f, t));
      });
      return out;
    };
    expect(hiddenOf(true)).toEqual(['**', '**']); // the cursor is in the heading line, so "# " shows
    expect(hiddenOf(false)).toEqual(['# ', '**', '**']);
  });
});

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockWidgets, frontmatterPairs, parseTable, splitRow } from '../src/index';
import { markdownSupport } from '../src/index';

suite('block widgets', () => {
  it('splits rows with escaped pipes and optional outer pipes', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });

  it('parses a table with alignment and pads short rows', () => {
    const t = parseTable('| A | B |\n|:--|--:|\n| 1 |\n| 2 | 3 |');
    expect(t?.head).toEqual(['A', 'B']);
    expect(t?.align).toEqual(['left', 'right']);
    expect(t?.rows).toEqual([['1', ''], ['2', '3']]);
    expect(parseTable('not a table')).toBeNull();
  });

  it('reads frontmatter pairs for display', () => {
    expect(frontmatterPairs('---\ntitle: Grace\ntags: [a, b]\nstatus: "draft"\n---')).toEqual([
      ['title', 'Grace'],
      ['tags', 'a, b'],
      ['status', 'draft'],
    ]);
  });

  const replaced = (doc: string, anchor: number): number => {
    const state = EditorState.create({ doc, selection: { anchor }, extensions: [markdownSupport(), blockWidgets()] });
    const f = state.facet(EditorView.decorations).map((d) => (typeof d === 'function' ? null : d)).filter(Boolean);
    let n = 0;
    for (const set of f) (set as import('@codemirror/view').DecorationSet).between(0, doc.length, () => void n++);
    return n;
  };

  it('replaces a table and frontmatter with widgets until the cursor is inside', () => {
    const doc = '---\ntitle: X\n---\n\n# X\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend';
    expect(replaced(doc, doc.length)).toBe(2); // cursor in "end"
    expect(replaced(doc, 0)).toBe(2); // cursor at the very start still shows the card
    expect(replaced(doc, 6)).toBe(1); // inside frontmatter: raw
    expect(replaced(doc, doc.indexOf('| 1') + 2)).toBe(1); // inside the table: raw
  });
});

import { fenceInner, viewBlockHost } from '../src/index';

suite('view blocks', () => {
  const host = { mount: () => () => {} };
  const doc = 'Intro\n\n```view\ntype: table\nquery: under:$this\n```\n\nOutro';
  const count = (anchor: number, withHost = true): number => {
    const state = EditorState.create({ doc, selection: { anchor }, extensions: [markdownSupport(), blockWidgets(), withHost ? viewBlockHost.of(host) : []] });
    let n = 0;
    for (const d of state.facet(EditorView.decorations)) if (typeof d !== 'function') (d as import('@codemirror/view').DecorationSet).between(0, doc.length, () => void n++);
    return n;
  };
  it('finds the text between the fences', () => {
    const state = EditorState.create({ doc, extensions: [markdownSupport()] });
    const from = doc.indexOf('```view');
    const to = doc.indexOf('```\n\nOutro') + 3;
    expect(doc.slice(fenceInner(state, from, to).from, fenceInner(state, from, to).to)).toBe('type: table\nquery: under:$this\n');
  });
  it('becomes a widget when a host is supplied and the cursor is outside', () => {
    expect(count(0)).toBe(1);
    expect(count(doc.length)).toBe(1);
  });
  it('shows the raw settings while the cursor is inside', () => {
    // no drawn view, only the corner button that deletes the block
    expect(count(doc.indexOf('query'))).toBe(1);
  });
  it('stays an ordinary code block without a host, and other languages are not views', () => {
    expect(count(0, false)).toBe(0);
    const other = '```js\nview\n```';
    const state = EditorState.create({ doc: other, selection: { anchor: 0 }, extensions: [markdownSupport(), blockWidgets(), viewBlockHost.of(host)] });
    let n = 0;
    for (const d of state.facet(EditorView.decorations)) if (typeof d !== 'function') (d as import('@codemirror/view').DecorationSet).between(0, other.length, () => void n++);
    expect(n).toBe(0);
  });
});

suite('links written as buttons', () => {
  it('draws [=Label](page.md) as a button, like [[Page|=Label]], and shows the text under the cursor', () => {
    const d = describe('[=Open it](Page.md) and more‸');
    expect(d.hidden).toEqual(['[=', '](Page.md)']);
    expect(d.marks.some((m) => m.startsWith('cm-link cm-wikilink-button:Open it'))).toBe(true);
    const on = describe('[=Open ‸it](Page.md)');
    expect(on.marks.some((m) => m.includes('cm-wikilink-button'))).toBe(false);
  });

  it('leaves an ordinary link alone', () => {
    const d = describe('[Open it](Page.md) x‸');
    expect(d.marks.some((m) => m.includes('cm-wikilink-button'))).toBe(false);
  });
});

suite('an image that fails to load', () => {
  it('keeps the widget\'s root element, so the editor never reads the swap as typing', () => {
    const d = describe('![a](x.png)![b](y.png)', { resolveAsset: (h) => h });
    const set = computeDecorations(d.state, [{ from: 0, to: d.state.doc.length }], { resolveAsset: (h) => h });
    const widgets: any[] = [];
    set.between(0, d.state.doc.length, (_f, _t, v) => { const w = (v.spec as any).widget; if (w) widgets.push(w); });
    expect(widgets).toHaveLength(1); // the cursor at the end shows the second link as text
    const root = widgets[0].toDOM() as HTMLElement;
    const img = root.querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('🖼 a'); // the fallback lives inside the same root element
  });
});
