import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** Does the document start with a YAML frontmatter block (`---` ... `---`)? */
export function hasFrontmatter(state: EditorState): boolean {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return false;
  const last = Math.min(doc.lines, 4000);
  for (let n = 2; n <= last; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === '---' || t === '...') return true;
  }
  return false;
}

/** Add an empty frontmatter block at the top and put the cursor on its empty line. */
export function addFrontmatter(view: EditorView): boolean {
  if (hasFrontmatter(view.state)) return false;
  view.dispatch({ changes: { from: 0, insert: '---\n\n---\n' }, selection: { anchor: 4 }, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** Open or close the syntax help under the attributes bar. */
export const setAttributeHelp = StateEffect.define<boolean>();

const helpOpen = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAttributeHelp)) return e.value;
    return value;
  },
});

const EXAMPLE = `---
status: draft            # words, numbers, true/false and dates
due: 2026-12-01
tags: [alpha, beta]      # a list
author:                  # nested values become author.name
  name: Lynn
---`;

const SPECIAL: Array<[string, string]> = [
  ['aliases', 'other names that [[wikilinks]] may use for this page'],
  ['order', 'a number: pages with one come first in the page tree, lowest first'],
  ['hidden: all', 'keep the page out of the page tree, the sub-page bar, search and queries (templates count as hidden: all unless they have a hidden of their own). Name places instead: tree (or files), children, search, queries'],
  ['icon: book', 'an icon for this page, from the bundled icon set; it shows in the page tree and in galleries (set it from the page\u2019s right-click menu)'],
  ['children:', 'attributes that every sub-page, at any depth, gets unless it sets its own. Write defaults: inherit (hand down this page\u2019s own values too), defaults: none (a blank slate) or inheritance: children (reach only the next level) inside it'],
  ['status: inherit', 'take the parent page\u2019s value for this attribute; default takes the workspace\u2019s value, none leaves it blank'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function helpPanel(): HTMLElement {
  const box = el('div', 'cm-attr-help');
  box.append(el('strong', undefined, 'Page attributes are YAML frontmatter'));
  box.append(el('p', undefined, 'A block of key: value lines between two --- lines, at the very top of the page. Indent with spaces, not tabs. A # starts a comment.'));
  box.append(el('pre', undefined, EXAMPLE));
  const list = el('dl');
  for (const [k, v] of SPECIAL) {
    list.append(el('dt', undefined, k), el('dd', undefined, v));
  }
  box.append(list);
  return box;
}

class AttributeBarWidget extends WidgetType {
  constructor(
    readonly has: boolean,
    readonly help: boolean,
  ) {
    super();
  }
  override eq(o: AttributeBarWidget): boolean {
    return o.has === this.has && o.help === this.help;
  }
  override get estimatedHeight(): number {
    return this.help ? 330 : 26;
  }
  override toDOM(view: EditorView): HTMLElement {
    // with attributes the bar takes no height of its own: its buttons float at the right end of the first attribute line
    const wrap = el('div', `cm-attrbar${this.help ? ' cm-attrbar-open' : ''}${this.has ? ' cm-attrbar-float' : ''}`);
    const row = el('div', 'cm-attrbar-row');
    if (!this.has) {
      const add = el('button', 'cm-attr-add', '+ Add attributes');
      add.type = 'button';
      add.title = 'Add a YAML frontmatter block to this page';
      add.addEventListener('mousedown', (e) => e.preventDefault());
      add.addEventListener('click', () => addFrontmatter(view));
      row.append(add);
    }
    const info = el('button', 'cm-attr-info', 'i');
    info.type = 'button';
    info.title = 'How attributes are written';
    info.setAttribute('aria-label', 'Show how attributes are written');
    info.setAttribute('aria-expanded', String(this.help));
    info.addEventListener('mousedown', (e) => e.preventDefault());
    info.addEventListener('click', () => view.dispatch({ effects: setAttributeHelp.of(!this.help) }));
    row.append(info);
    wrap.append(row);
    if (this.help) wrap.append(helpPanel());
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function bar(state: EditorState): DecorationSet {
  const out: Array<Range<Decoration>> = [
    Decoration.widget({ widget: new AttributeBarWidget(hasFrontmatter(state), state.field(helpOpen)), block: true, side: -1 }).range(0),
  ];
  return Decoration.set(out);
}

/** A slim bar above the text: "Add attributes" (when there is no frontmatter) and an info button. Shown on hover. */
export function attributeBar(): Extension {
  return [
    helpOpen,
    StateField.define<DecorationSet>({
      create: bar,
      update: (value, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setAttributeHelp)) ? bar(tr.state) : value),
      provide: (f) => EditorView.decorations.from(f),
    }),
  ];
}
