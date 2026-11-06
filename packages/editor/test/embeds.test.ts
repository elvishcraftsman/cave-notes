// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { embedHost, embeds, markdownSupport, type EmbedHost, type EmbedSpec } from '../src';

function make(doc: string, anchor = 0): { view: EditorView; specs: EmbedSpec[] } {
  const specs: EmbedSpec[] = [];
  const host: EmbedHost = {
    mount(el, spec) {
      specs.push(spec);
      el.textContent = `[${spec.target}|${spec.heading ?? ''}]`;
      return { destroy() {} };
    },
  };
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor }, extensions: [markdownSupport(), embedHost.of(host), embeds()] }), parent: document.body });
  return { view, specs };
}

describe('embeds', () => {
  it('draws a call on its own line as a block and one in a sentence inline', () => {
    const { view, specs } = make('Intro\n\n![[Facts#Address]]\n\nSee ![[@footer]] here.\n');
    expect(specs.map((s) => [s.target, s.heading, s.named, s.block])).toEqual([['Facts', 'Address', false, true], ['footer', null, true, false]]);
    expect(view.dom.querySelectorAll('.cm-embed-block').length).toBe(1);
    expect(view.dom.querySelectorAll('.cm-embed-inline').length).toBe(1);
    view.destroy();
  });

  it('shows the call as written while the cursor is in it', () => {
    const { view, specs } = make('![[Facts]]\n', 3);
    expect(specs.length).toBe(0);
    expect(view.dom.textContent).toContain('![[Facts]]');
    view.destroy();
  });

  it('leaves calls in code alone', () => {
    const { view, specs } = make('A `![[Nope]]` b\n\n```\n![[Nope2]]\n```\n');
    expect(specs.length).toBe(0);
    view.destroy();
  });
});
