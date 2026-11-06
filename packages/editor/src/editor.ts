import { autocompletion, type CompletionContext, type CompletionResult, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { Compartment, type Extension, EditorState, Facet, Prec, type StateEffect, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { createSearchPanel } from './searchPanel';
import { yamlDocument, yamlHints } from './yamlHints';
import { addFrontmatter, attributeBar, hasFrontmatter } from './attributes';
import { viewBlockHost, type ViewBlockHost } from './blocks';
import { conflicts } from './conflicts';
import { divs } from './divs';
import { codeActions, codeActionsTheme, codeRunHost, type CodeRunHost } from './codeActions';
import { embedHost, embeds, type EmbedHost } from './embeds';
import { queryLinks } from './queryLinks';
import { expressions } from './expressions';
import { dashes } from './dashes';
import { footnotes, openingFixes } from './footnotes';
import { formatMenu, type SpellHost, type ThesaurusHost } from './formatMenu';
import { fenceAutoClose, insertLink, insertViewBlock, listEnterKeepsSpace, pairOnlyBesideSpace, toggleWrap } from './commands';
import { type ListConfig, listConfig, listSupport } from './lists';
import { listPaste } from './listPaste';
import { type FollowableLink, linkAt } from './links';
import { type LinkStatus, fullRender, livePreview, refreshPreview } from './livePreview';
import { markdownSupport } from './markdown';
import { extractOutline, findHeading, isHeading, type OutlineItem } from './outline';
import { LEFT_DOUBLE, LEFT_SINGLE, smartQuotes } from './smartQuotes';
import { noteTheme } from './theme';
import { codeScroll } from './codeScroll';
import { selectAll, type HtmlRenderer } from './selectAll';

/** The first `# Heading` of a page: its text and the 1-based line it is on. Frontmatter and fenced code are skipped. */
export function findFirstH1(lines: Iterable<string>, limit = 400): { text: string; line: number } | null {
  let n = 0;
  let inFront = false;
  let fence: string | null = null;
  for (const raw of lines) {
    n++;
    if (n > limit) return null;
    const line = raw.replace(/\r$/, '');
    if (n === 1 && /^---[ \t]*$/.test(line)) {
      inFront = true;
      continue;
    }
    if (inFront) {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) inFront = false;
      continue;
    }
    const f = /^ {0,3}(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1]!.startsWith(fence[0]!) && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (h) return { text: h[1]!.trim(), line: n };
  }
  return null;
}

/** the drag data type that carries the path of a page dragged out of a list of pages */
export const PAGE_DRAG = 'application/x-cave-page';
/** the drag data type that carries the path of a file that is not a note, dragged out of the sub-page bar */
export const FILE_DRAG = 'application/x-cave-file';

export interface WikilinkSuggestion {
  label: string;
  /** shown dimmed beside the label, e.g. the page path */
  detail?: string;
}

export interface EditorOptions {
  parent: HTMLElement;
  /** The document changed (called for every edit). */
  onChange?: (text: string) => void;
  /** The outline changed (after load and after edits). */
  onOutline?: (items: OutlineItem[]) => void;
  /** Ctrl/Cmd+click on a link. */
  onOpenLink?: (link: FollowableLink, event: MouseEvent) => void;
  /** Offers a Run button on shell code blocks (every code block has a Copy button regardless). */
  codeRun?: CodeRunHost;
  /** A button written as `[=Label](automation:rule-id)` was clicked: run that automation rule for this page. */
  onRunAutomation?: (ruleId: string, event: MouseEvent) => void;
  /** Right-click on a link to a page or file. Return true when a menu of your own is shown (the formatting menu is then not). */
  onLinkMenu?: (link: FollowableLink, event: MouseEvent) => boolean;
  /** Files dropped on the text (`pos`: the document offset under the pointer, or null). */
  onDropFiles?: (files: File[], pos: number | null) => void;
  /** a page dragged in from the page tree, the search results or the sub-page bar (its path): make a link to it at `pos` */
  onDropPage?: (path: string, pos: number | null, workspace?: string) => void;
  /** a file that is not a note, dragged in from the sub-page bar (its path in the workspace): make a link to it at `pos` */
  onDropFile?: (path: string, pos: number | null, workspace?: string) => void;
  /** Ctrl+S. */
  onSave?: () => void;
  /** The cursor moved to another line, or the document changed so that it is on another line (not for every keystroke). */
  onLineChange?: () => void;
  /** The editor lost focus. */
  onBlur?: () => void;
  /** Suggestions for text typed after "[[". */
  wikilinkCompletions?: (query: string) => Promise<WikilinkSuggestion[]>;
  /** Status of a wikilink by its written target, to colour broken links. */
  linkStatus?: (raw: string) => LinkStatus;
  /** Map an image path from the note to a loadable URL (or null to show alt text). */
  resolveAsset?: (href: string) => string | null;
  /** Show the hover bar above the text with "Add attributes" and the syntax help (default true). */
  attributeBar?: boolean;
  /** Draws ```view blocks (database views). Without it they stay plain code blocks. */
  viewBlock?: ViewBlockHost;
  /** draws `![[…]]` embeds; without it they stay plain text */
  embed?: EmbedHost;
  /** Typing " or ' writes curly quotes (undo turns one back into the straight character). Default true. */
  smartQuotes?: boolean;
  /** Typing -- writes an en dash and --- an em dash (undo gives the hyphens back). Default true. */
  dashes?: boolean;
  /** Right-click opens the formatting menu (default true). */
  formatMenu?: boolean;
  /** The menu also opens when text is selected with the mouse (default true). */
  selectionMenu?: boolean;
  /** Turns the page into HTML for "Select all as HTML" then copy; without it the page as drawn is copied. */
  renderHtml?: HtmlRenderer;
  /** Spell checker for the right-click menu: suggestions for a misspelt word and "Add to Dictionary". */
  spell?: SpellHost;
  /** Thesaurus for the right-click menu: synonyms to replace a single word with. */
  thesaurus?: ThesaurusHost;
  /** Hierarchical list styles (see ListConfig); can be changed later with setListOptions. */
  lists?: Partial<ListConfig>;
}

/** True in the state of a document shown as plain text (a YAML settings file): no Markdown preview, outline or title. */
export const plainMode = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

const plainTheme = EditorView.theme({
  '.cm-content': { fontFamily: 'var(--mono-font, monospace)', fontSize: 'var(--mono-font-size, 0.9em)' },
});

function wikilinkSource(fetch: NonNullable<EditorOptions['wikilinkCompletions']>) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const m = ctx.matchBefore(/!?\[\[[^\]\n|#]*/);
    if (!m) return null;
    const query = m.text.replace(/^!?\[\[/, '');
    const items = await fetch(query);
    if (!items.length) return null;
    const start = m.from + m.text.indexOf('[[') + 2;
    return {
      from: start,
      // The pages are matched by the query itself; no validFor, so every keystroke asks again and the list narrows as you type.
      filter: false,
      options: items.map((it) => ({
        label: it.label,
        ...(it.detail ? { detail: it.detail } : {}),
        type: 'text',
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          const hasClose = view.state.doc.sliceString(to, to + 2) === ']]';
          const insert = hasClose ? it.label : `${it.label}]]`;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + it.label.length + 2 } });
        },
      })),
    };
  };
}

const safeDecode = (t: string): string => {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
};

/** A Markdown note editor with live preview. One instance edits one page at a time. */
/**
 * Undo and Redo on every platform: Ctrl+Z undoes, and both Ctrl+Shift+Z and Ctrl+Y redo (CodeMirror's own history keymap
 * binds only one of the two redo keys on each system, so a person used to the other found no Redo).
 */
export const undoRedoKeymap = [
  { key: 'Mod-z', run: undo, preventDefault: true },
  { key: 'Mod-Shift-z', run: redo, preventDefault: true },
  { key: 'Mod-y', run: redo, preventDefault: true },
];

const wrapAttributes = (on: boolean): Extension => (on ? EditorView.editorAttributes.of({ class: 'cm-wrapcode' }) : []);

export class NoteEditor {
  readonly view: EditorView;
  private readonly opts: EditorOptions;
  private readonly extensions: Extension;
  private readonly plainExtensions: Extension;
  private outlineLists = false;
  private readonly listCompartment = new Compartment();
  /** `cm-wrapcode` on the editor's element. Set through CodeMirror (not with classList): it rewrites that element's class on every focus change, which used to switch wrapping off again. */
  private readonly wrapCompartment = new Compartment();
  private wrapCode = false;
  private listOptions: Partial<ListConfig>;
  /** Space at the bottom of the editor that something lies over (the children bar): typing near it scrolls the text above it. */
  private bottomInset = 0;
  private lastLine = 1;

  constructor(opts: EditorOptions) {
    this.opts = opts;
    this.listOptions = opts.lists ?? {};
    this.extensions = this.buildExtensions();
    this.plainExtensions = this.buildPlainExtensions();
    this.view = new EditorView({ state: this.createState(''), parent: opts.parent });
    // a drag over the empty part of the pane (below a short page, beside the text) is a drop target too: the handlers on the
    // text itself only see what is over the text
    const outside = (e: Event): boolean => !this.view.contentDOM.contains(e.target as Node | null);
    this.hostDrag = (e: DragEvent): void => {
      if (outside(e)) this.dragOver(e, this.view);
    };
    this.hostDrop = (e: DragEvent): void => {
      if (outside(e)) this.dropped(e, this.view);
    };
    opts.parent.addEventListener('dragover', this.hostDrag);
    opts.parent.addEventListener('dragleave', this.hostLeave);
    document.addEventListener('dragend', this.clearDropReady, true);
    document.addEventListener('drop', this.clearDropReady, true);
    opts.parent.addEventListener('drop', this.hostDrop);
  }

  private hostLeave = (e: DragEvent): void => {
    if (!(e.relatedTarget instanceof Node) || !this.opts.parent.contains(e.relatedTarget)) this.clearDropReady();
  };
  private hostDrag: (e: DragEvent) => void = () => {};
  private hostDrop: (e: DragEvent) => void = () => {};

  /** Where a dragged thing would go: a page or a file becomes a link, files from outside the app are added. True when handled. */
  private dragOver(e: DragEvent, view: EditorView): boolean {
    const o = this.opts;
    void view;
    const types = e.dataTransfer?.types;
    // a database view inside the page has its own idea of what a dropped page means
    const inView = (e.target as HTMLElement | null)?.closest?.('.view-block');
    if (!inView && types && ((o.onDropPage && types.includes(PAGE_DRAG)) || (o.onDropFile && types.includes(FILE_DRAG)))) {
      e.preventDefault();
      // 'copy', not 'link': it is the one the system's drag always accepts, and the page is only being given a link to the source
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      this.showDropReady();
      return true;
    }
    if (!o.onDropFiles || !types?.includes('Files')) return false;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    return true;
  }

  /** Outline the page while a page or file is dragged over it, so it is clear that it takes the drop; it stays until the drag leaves, ends or drops. */
  private showDropReady(): void {
    this.opts.parent.classList.add('drop-ready');
  }

  private clearDropReady = (): void => {
    this.opts.parent.classList.remove('drop-ready');
  };

  private dropped(e: DragEvent, view: EditorView): boolean {
    this.opts.parent.classList.remove('drop-ready');
    const o = this.opts;
    const inView = (e.target as HTMLElement | null)?.closest?.('.view-block');
    // the nearest place in the text, also for a drop on empty space beside or below it
    const at = (): number | null => view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const workspace = e.dataTransfer?.getData('application/x-cave-workspace') || undefined;
    const page = !inView && o.onDropPage ? e.dataTransfer?.getData(PAGE_DRAG) : '';
    if (page) {
      e.preventDefault();
      o.onDropPage!(page, at(), workspace);
      return true;
    }
    const file = !inView && o.onDropFile ? e.dataTransfer?.getData(FILE_DRAG) : '';
    if (file) {
      e.preventDefault();
      o.onDropFile!(file, at(), workspace);
      return true;
    }
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (!o.onDropFiles || files.length === 0) return false;
    e.preventDefault();
    o.onDropFiles(files, at());
    return true;
  }

  private buildExtensions(): Extension {
    const o = this.opts;
    const ctrlClass = (on: boolean, view: EditorView): void => {
      view.dom.classList.toggle('cm-ctrl-held', on);
    };
    return [
      history(),
      drawSelection(),
      closeBrackets(),
      // curly pairs are brackets too, so Backspace between them removes both; the rest is the Markdown default
      Prec.high(EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`', LEFT_DOUBLE, LEFT_SINGLE] } }])),
      o.smartQuotes === false ? [] : smartQuotes(),
      pairOnlyBesideSpace(), // after the smart quotes, which write their own pairs
      o.dashes === false ? [] : dashes(),
      listPaste(),
      // right-click on a link: the host's own menu first; a drag of files over the text is a drop target
      Prec.highest(
        EditorView.domEventHandlers({
          contextmenu: (e, view) => {
            if (!o.onLinkMenu) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos === null) return false;
            const link = linkAt(view.state, pos);
            if (!link || /^[a-z][a-z0-9+.-]+:/i.test(link.target) || link.target.startsWith('//')) return false;
            if (!o.onLinkMenu(link, e)) return false;
            e.preventDefault();
            return true;
          },
          dragover: (e, view) => this.dragOver(e, view),
          drop: (e, view) => this.dropped(e, view),
        }),
      ),
      o.formatMenu === false ? [] : formatMenu({ onSelection: o.selectionMenu !== false, ...(o.spell ? { spell: o.spell } : {}), ...(o.thesaurus ? { thesaurus: o.thesaurus } : {}) }),
      selectAll(o.renderHtml),
      fenceAutoClose(),
      footnotes(),
      listEnterKeepsSpace(),
      this.listCompartment.of(listConfig.of(this.listOptions)),
      this.wrapCompartment.of(wrapAttributes(this.wrapCode)),
      EditorView.scrollMargins.of(() => ({ bottom: this.bottomInset })),
      listSupport(),
      o.attributeBar === false ? [] : attributeBar(),
      yamlHints(),
      // Ctrl+F finds, Ctrl+H finds and replaces (the panel has both fields); F3 / Ctrl+G step through the matches
      search({ top: true, createPanel: createSearchPanel }),
      EditorView.lineWrapping,
      markdownSupport(),
      livePreview({
        ...(o.linkStatus ? { linkStatus: o.linkStatus } : {}),
        ...(o.resolveAsset ? { resolveAsset: o.resolveAsset } : {}),
      }),
      noteTheme,
      codeScroll,
      codeActions(),
      codeActionsTheme,
      divs(),
      conflicts(),
      o.codeRun ? codeRunHost.of(o.codeRun) : [],
      o.viewBlock ? viewBlockHost.of(o.viewBlock) : [],
      o.embed ? [embedHost.of(o.embed), embeds(), queryLinks(), expressions()] : [],
      o.wikilinkCompletions ? autocompletion({ override: [wikilinkSource(o.wikilinkCompletions)], icons: false, defaultKeymap: false }) : [],
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (o.onSave?.(), true) },
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-e', run: toggleWrap('`') },
        { key: 'Mod-Shift-x', run: toggleWrap('~~') },
        { key: 'Mod-k', run: insertLink },
        { key: 'Mod-Alt-v', run: insertViewBlock },
        {
          key: 'Mod-h',
          preventDefault: true,
          run: (view) => {
            openSearchPanel(view);
            requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>('.cm-findbar input[name=replace]')?.focus());
            return true;
          },
        },
        ...searchKeymap,
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...undoRedoKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) {
          const line = u.state.doc.lineAt(u.state.selection.main.head).number;
          if (line !== this.lastLine) {
            this.lastLine = line;
            o.onLineChange?.();
          }
        }
        if (u.docChanged) {
          o.onChange?.(u.state.doc.toString());
          o.onOutline?.(extractOutline(u.state, { orderedLists: this.outlineLists }));
        }
      }),
      EditorView.domEventHandlers({
        mousedown: (e, view) => {
          // a button that runs an automation rule: a plain click runs it (nothing is opened)
          const auto = e.button === 0 ? (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-automation]') : null;
          if (auto?.dataset.automation) {
            e.preventDefault();
            o.onRunAutomation?.(auto.dataset.automation, e);
            return true;
          }
          // a link written as a button goes to its page on a plain click
          if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.target as HTMLElement | null)?.closest?.('[data-wikilink-button]')) {
            const at = view.posAtCoords({ x: e.clientX, y: e.clientY });
            const btn = at === null ? null : linkAt(view.state, at);
            if (btn) {
              e.preventDefault();
              o.onOpenLink?.(btn, e);
              return true;
            }
          }
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          const link = linkAt(view.state, pos);
          if (!link) return false;
          e.preventDefault();
          o.onOpenLink?.(link, e);
          return true;
        },
        keydown: (e, view) => {
          if (e.key === 'Control' || e.key === 'Meta') ctrlClass(true, view);
          return false;
        },
        keyup: (e, view) => {
          if (e.key === 'Control' || e.key === 'Meta') ctrlClass(false, view);
          return false;
        },
        blur: (_e, view) => {
          ctrlClass(false, view);
          o.onBlur?.();
          return false;
        },
      }),
      EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Note text' }),
    ];
  }

  /** What a settings file gets instead of the Markdown editor: text with find and replace, undo and indenting, nothing else. */
  private buildPlainExtensions(): Extension {
    const o = this.opts;
    return [
      plainMode.of(true),
      yamlDocument(),
      EditorView.contentAttributes.of({ class: 'cm-plain' }),
      history(),
      drawSelection(),
      pairOnlyBesideSpace(),
      closeBrackets(),
      this.listCompartment.of(listConfig.of(this.listOptions)),
      this.wrapCompartment.of(wrapAttributes(this.wrapCode)),
      EditorView.scrollMargins.of(() => ({ bottom: this.bottomInset })),
      search({ top: true, createPanel: createSearchPanel }),
      EditorView.lineWrapping,
      noteTheme,
      plainTheme,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (o.onSave?.(), true) },
        {
          key: 'Mod-h',
          preventDefault: true,
          run: (view) => {
            openSearchPanel(view);
            requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>('.cm-findbar input[name=replace]')?.focus());
            return true;
          },
        },
        ...searchKeymap,
        ...closeBracketsKeymap,
        ...undoRedoKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) {
          const line = u.state.doc.lineAt(u.state.selection.main.head).number;
          if (line !== this.lastLine) {
            this.lastLine = line;
            o.onLineChange?.();
          }
        }
        if (u.docChanged) {
          o.onChange?.(u.state.doc.toString());
          o.onOutline?.([]);
        }
      }),
      EditorView.domEventHandlers({ blur: () => (o.onBlur?.(), false) }),
      EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'File text' }),
    ];
  }

  /** A fresh editor state (own undo history) for a document. Keep it to restore the page later. `plain`: show it as plain text. */
  createState(doc: string, plain = false, readOnly = false): EditorState {
    const base = plain ? this.plainExtensions : this.extensions;
    return EditorState.create({ doc, extensions: readOnly ? [base, this.readOnlyExtensions()] : base });
  }

  /**
   * A page that can be read and followed but not changed, shown fully rendered (the built-in documentation). Every change is
   * refused, including the ones a widget makes (a task checkbox), and a plain click follows a link.
   */
  private readOnlyExtensions(): Extension {
    const o = this.opts;
    return [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // not editable, so not focusable by default: it must be, or Ctrl+F (find in page) and F3 never reach the page
      EditorView.contentAttributes.of({ tabindex: '0' }),
      fullRender.of(true),
      EditorState.transactionFilter.of((tr) => (tr.docChanged ? [] : tr)),
      EditorView.domEventHandlers({
        click: (e, view) => {
          if (e.button !== 0 || !view.state.selection.main.empty) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const link = pos === null ? null : linkAt(view.state, pos);
          if (!link) return false;
          e.preventDefault();
          o.onOpenLink?.(link, e);
          return true;
        },
      }),
    ];
  }

  /** Change the hierarchical list styles; takes effect at once in the page on screen. */
  /** Wrap long lines in code blocks and plain-text documents (off: they scroll sideways). */
  setWrapCode(on: boolean): void {
    this.wrapCode = on;
    this.view.dispatch({ effects: this.wrapCompartment.reconfigure(wrapAttributes(on)), annotations: Transaction.addToHistory.of(false) }); // and the code blocks measure again
  }

  setListOptions(options: Partial<ListConfig>): void {
    this.listOptions = options;
    this.view.dispatch({ effects: this.listCompartment.reconfigure(listConfig.of(options)), annotations: Transaction.addToHistory.of(false) });
  }

  /** Show a document in a fresh state; `plain` shows it as plain text, as a settings file is shown. */
  load(text: string, opts: { plain?: boolean; readOnly?: boolean } = {}): void {
    this.setState(this.createState(text, opts.plain === true, opts.readOnly === true));
    // footnotes that are out of order are put in order when a page is opened
    const fixes = opts.plain || opts.readOnly ? [] : openingFixes(text);
    if (fixes.length > 0) this.applyChanges(fixes);
  }

  /** Is the document on screen shown as plain text? */
  get isPlain(): boolean {
    return this.view.state.facet(plainMode);
  }

  /** Swap in a previously saved state (keeps its undo history and cursor). */
  setState(state: EditorState): void {
    this.view.setState(state);
    this.view.dispatch({ effects: [this.listCompartment.reconfigure(listConfig.of(this.listOptions)), this.wrapCompartment.reconfigure(wrapAttributes(this.wrapCode))], annotations: Transaction.addToHistory.of(false) });
    this.opts.onOutline?.(state.facet(plainMode) ? [] : extractOutline(state, { orderedLists: this.outlineLists }));
  }

  get state(): EditorState {
    return this.view.state;
  }

  text(): string {
    return this.view.state.doc.toString();
  }

  /** The first level-1 heading (text, line) as it is now in the editor. */
  firstH1(): { text: string; line: number } | null {
    if (this.isPlain) return null;
    const doc = this.view.state.doc;
    return findFirstH1({ *[Symbol.iterator]() { for (let i = 1; i <= Math.min(doc.lines, 400); i++) yield doc.line(i).text; } });
  }

  /** Line (1-based) the cursor is on. */
  cursorLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  hasFocus(): boolean {
    return this.view.hasFocus;
  }

  /**
   * Replace the text by editing it in place with these changes (as `textChanges` of core-sync gives them), so the
   * cursor, scroll position and undo history stay where they were. Not undoable as a separate step by default.
   */
  applyChanges(changes: Array<{ from: number; to: number; insert: string }>, opts: { undoable?: boolean } = {}): void {
    if (changes.length === 0) return;
    this.view.dispatch({ changes, ...(opts.undoable ? {} : { annotations: Transaction.addToHistory.of(false) }) });
  }

  /** Move the cursor to a character offset and scroll to it, centred. */
  scrollToCentered(pos: number): void {
    const p = Math.max(0, Math.min(pos, this.view.state.doc.length));
    this.view.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: 'center' }) });
  }

  /** Insert a database view block at the cursor (an empty table by default, or with the given settings). */
  insertViewBlock(template?: string): void {
    insertViewBlock(this.view, template);
    this.view.focus();
  }

  focus(): void {
    this.view.focus();
  }

  /** Tell the editor how much of its bottom edge is covered, so the cursor is scrolled into the part that can be seen. */
  setBottomInset(px: number): void {
    const v = Math.max(0, Math.round(Math.min(px, this.view.dom.clientHeight * 0.6)));
    if (v === this.bottomInset) return;
    this.bottomInset = v;
    if (this.view.hasFocus) this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'nearest', yMargin: 8 }) });
  }

  /** Undo / redo from outside the keyboard (a menu button). The page's own history; focus goes back to the text. */
  undo(): boolean {
    const done = undo(this.view);
    this.view.focus();
    return done;
  }

  redo(): boolean {
    const done = redo(this.view);
    this.view.focus();
    return done;
  }

  /** Is there something to undo / redo? */
  canUndo(): boolean {
    return undoDepth(this.view.state) > 0;
  }

  canRedo(): boolean {
    return redoDepth(this.view.state) > 0;
  }

  /** Scroll to the top of the page (the return-to-top button). */
  scrollToTop(): void {
    this.view.scrollDOM.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Be told whenever the page is scrolled (for the return-to-top button); returns a function that stops it. */
  onScrolled(fn: (top: number) => void): () => void {
    const el = this.view.scrollDOM;
    const h = (): void => fn(el.scrollTop);
    el.addEventListener('scroll', h, { passive: true });
    return () => el.removeEventListener('scroll', h);
  }

  /** Open the find panel (as Ctrl+F does inside the editor), selecting what is typed in it. */
  openFind(): void {
    openSearchPanel(this.view);
    requestAnimationFrame(() => this.view.dom.querySelector<HTMLInputElement>('.cm-findbar input[name=search]')?.select());
  }

  /** Put the cursor at the very end of the document (e.g. under the title of a new page) and focus. */
  focusEnd(): void {
    const end = this.view.state.doc.length;
    this.view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
    this.view.focus();
  }

  /** Insert text at `pos` (default: the cursor), leave the cursor after it and focus the editor. */
  insertText(text: string, pos?: number): void {
    const at = Math.max(0, Math.min(pos ?? this.view.state.selection.main.head, this.view.state.doc.length));
    this.view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true, userEvent: 'input.drop' });
    this.view.focus();
  }

  /** Put the cursor at the end of a link's target (the page name in `[[…]]`, the path in `[text](…)`) so it can be corrected. */
  cursorIntoLink(link: FollowableLink): void {
    const raw = this.view.state.doc.sliceString(link.from, link.to);
    let at = link.to;
    if (link.syntax === 'wiki') {
      const start = raw.startsWith('!') ? 3 : 2;
      const inner = raw.slice(start, raw.length - 2);
      const head = inner.split('|')[0]!.split('#')[0]!;
      at = link.from + start + head.trimEnd().length;
    } else {
      const open = raw.indexOf('](');
      if (open >= 0) {
        const dest = raw.slice(open + 2, raw.length - 1);
        const hash = dest.indexOf('#');
        const path = hash < 0 ? dest : dest.slice(0, hash);
        at = link.from + open + 2 + path.replace(/>$/, '').length;
      }
    }
    this.view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    this.view.focus();
  }

  /** The same for a link found on a line (1-based) by what its target says. False if it is not there any more. */
  cursorIntoLinkOnLine(lineNumber: number, target: string, syntax: 'md' | 'wiki'): boolean {
    const doc = this.view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return false;
    const line = doc.line(lineNumber);
    for (let p = line.from; p <= line.to; p++) {
      const l = linkAt(this.view.state, p);
      if (l && l.syntax === syntax && [l.target, safeDecode(l.target)].some((t) => t.trim() === target.trim())) {
        this.cursorIntoLink(l);
        return true;
      }
    }
    return false;
  }

  /** Add an empty frontmatter block at the top, with the cursor in it. No effect if there is one. */
  addAttributes(): boolean {
    return addFrontmatter(this.view);
  }

  hasAttributes(): boolean {
    return hasFrontmatter(this.view.state);
  }

  /** Scroll position, to bring a page back where the reader left it. */
  get scrollTop(): number {
    return this.view.scrollDOM.scrollTop;
  }

  set scrollTop(v: number) {
    this.view.scrollDOM.scrollTop = v;
  }

  /**
   * Where the page is scrolled to, as "this line at the top", not as a number of pixels: the heights of tables, views,
   * embeds and images are only estimated until they have been drawn, so pixels do not mean the same thing when the page
   * is shown again. Give it back to `restoreScroll`.
   */
  scrollSnapshot(): StateEffect<unknown> {
    return this.view.scrollSnapshot();
  }

  /** The line (1-based) at the top of the screen. */
  topLine(): number {
    const v = this.view;
    return v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop + 12).from).number;
  }

  /** Scroll so that this line is at the top, leaving the cursor where it is (a line past the end counts as the last). */
  scrollToLine(n: number): void {
    const doc = this.view.state.doc;
    const line = doc.line(Math.max(1, Math.min(n, doc.lines)));
    this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 12 }) });
  }

  /** Scroll back to a `scrollSnapshot`. The editor keeps the place while the heights of what is above it settle. */
  restoreScroll(snapshot: StateEffect<unknown>): void {
    this.view.dispatch({ effects: snapshot });
  }

  /** List the items of numbered lists in outline() too (off by default). Call outline() again afterwards. */
  setOutlineLists(on: boolean): void {
    this.outlineLists = on;
  }

  outline(): OutlineItem[] {
    if (this.isPlain) return [];
    return extractOutline(this.view.state, { orderedLists: this.outlineLists });
  }

  /** Move the cursor to `pos` and scroll it near the top. */
  scrollToPos(pos: number): void {
    const p = Math.max(0, Math.min(pos, this.view.state.doc.length));
    this.view.dispatch({
      selection: { anchor: p },
      effects: EditorView.scrollIntoView(p, { y: 'start', yMargin: 24 }),
    });
    // The jump is first made with estimated line heights; once the lines near the target are measured the heading may sit
    // elsewhere, and a later click would then make the page spring to the corrected place. Settle it now, before any click.
    const settle = (left: number): void => {
      requestAnimationFrame(() => {
        if (!this.view.dom.isConnected) return;
        this.view.requestMeasure();
        const at = Math.min(p, this.view.state.doc.length);
        this.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 24 }) });
        if (left > 1) settle(left - 1);
      });
    };
    settle(3);
  }

  /** Scroll to the heading named by a link fragment. Returns false if there is none. */
  scrollToHeading(fragment: string): boolean {
    const h = findHeading(this.outline(), fragment);
    if (!h) return false;
    this.scrollToPos(h.from);
    return true;
  }

  /** Index (into outline()) of the heading the reader is currently in, by scroll position. */
  activeHeadingIndex(): number {
    const items = this.outline();
    if (!items.length) return -1;
    const scroller = this.view.scrollDOM;
    // the heading the cursor is under, when the cursor is in view; otherwise the one at the top of the view
    const head = this.view.state.selection.main.head;
    const block = this.view.lineBlockAt(head);
    const y = block.top + this.view.documentTop - scroller.getBoundingClientRect().top;
    let at = this.view.lineBlockAtHeight(scroller.scrollTop + 12).from;
    if (y >= -block.height && y <= scroller.clientHeight) at = head;
    let idx = -1;
    for (let i = 0; i < items.length; i++) if (isHeading(items[i] as OutlineItem) && (items[i] as OutlineItem).from <= at) idx = i;
    return idx;
  }

  /** Re-style links after their statuses changed. */
  refreshLinks(): void {
    this.view.dispatch({ effects: refreshPreview.of(null) });
  }

  destroy(): void {
    this.opts.parent.removeEventListener('dragover', this.hostDrag);
    this.opts.parent.removeEventListener('dragleave', this.hostLeave);
    document.removeEventListener('dragend', this.clearDropReady, true);
    document.removeEventListener('drop', this.clearDropReady, true);
    this.opts.parent.removeEventListener('drop', this.hostDrop);
    this.view.destroy();
  }
}
