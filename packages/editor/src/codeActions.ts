import { Facet, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { fenceInner } from './blocks';

/** What happened when a shell block was run. */
export interface CodeRunResult {
  /** The script ran (even if it failed): its exit code and everything it printed. */
  ran: boolean;
  code?: number | null;
  output?: string;
  timedOut?: boolean;
  stopped?: boolean;
  /** It was opened in a terminal window, so there is no output to show here. */
  terminal?: boolean;
  /** When it did not run: why (the person said no, scripts are off here, ...). */
  reason?: string;
}

/** The app's side of the Run button. Without it, code blocks only get a Copy button. */
export interface CodeRunHost {
  run(req: { code: string; lang: string; terminal?: boolean }): Promise<CodeRunResult>;
  /** Stop the script that is running. */
  stop?(): void;
}

export const codeRunHost = Facet.define<CodeRunHost, CodeRunHost | null>({ combine: (v) => v[0] ?? null });

export interface CodeBlockInfo {
  /** Start of the whole block (the opening fence, or the first indented line). */
  from: number;
  to: number;
  /** The code itself, without the fences. */
  innerFrom: number;
  innerTo: number;
  lang: string;
  /** A shell script: gets a Run button when the app offers one. */
  shell: boolean;
  /** Wants a terminal window: marked `terminal` after the language, or it uses sudo (it needs somewhere to ask for a password). */
  terminal: boolean;
  fenced: boolean;
}

/** Whether a shell script certainly needs a terminal: it asks for a password (sudo, su, pkexec, doas). Every shell block gets one anyway unless it says `no-terminal`; this tells the app when `no-terminal` cannot work. */
export function scriptNeedsTerminal(code: string): boolean {
  return /(^|[\s;&|(`])(sudo|su|pkexec|doas)(\s|$)/m.test(code);
}

export const SHELL_LANGS = new Set(['sh', 'bash', 'zsh', 'shell']);

/** Every code block in the document (or in the range), except `view` blocks, which are drawn as database views. */
export function codeBlocks(state: EditorState, range?: { from: number; to: number }): CodeBlockInfo[] {
  const out: CodeBlockInfo[] = [];
  syntaxTree(state).iterate({
    from: range?.from,
    to: range?.to,
    enter: (n) => {
      if (n.name === 'FencedCode') {
        const info = /^\s*(?:```|~~~)\s*([^\s`]*)(.*)$/.exec(state.doc.lineAt(n.from).text);
        const lang = (info?.[1] ?? '').toLowerCase();
        // a shell block opens a terminal unless it says `no-terminal` after the language (then it runs quietly, output in a panel)
        const quiet = /(^|\s)no-?terminal(\s|$)/i.test(info?.[2] ?? '');
        if (lang === 'view' && n.to > n.from) return false;
        const inner = fenceInner(state, n.from, n.to);
        const shell = SHELL_LANGS.has(lang);
        out.push({ from: n.from, to: n.to, innerFrom: inner.from, innerTo: inner.to, lang, shell, terminal: shell && !quiet, fenced: true });
        return false;
      }
      if (n.name === 'CodeBlock') {
        out.push({ from: n.from, to: n.to, innerFrom: n.from, innerTo: n.to, lang: '', shell: false, terminal: false, fenced: false });
        return false;
      }
      return undefined;
    },
  });
  return out;
}

/** The text of a block as it should be copied or run: no fences, and an indented block without its four spaces. */
export function codeText(state: EditorState, b: CodeBlockInfo): string {
  const text = state.doc.sliceString(b.innerFrom, b.innerTo).replace(/\n$/, '');
  return b.fenced ? text : text.replace(/^(?: {1,4}|\t)/gm, '');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

interface Entry {
  box: HTMLElement;
  copy: HTMLButtonElement;
  run: HTMLButtonElement | null;
  result: HTMLElement | null;
  running: boolean;
  /** Where the toolbar goes (set by measuring). */
  x: number;
  y: number;
  shown: boolean;
}

/**
 * A Copy button on every code block, and a Run button on shell scripts when the app provides `codeRunHost`.
 * The buttons are not part of the text: each line of a code block scrolls sideways by itself, so a button inside the line
 * would scroll away. They live in a layer over the editor and are placed at the top right of each block.
 */
export function codeActions(): Extension {
  return ViewPlugin.fromClass(
    class {
      layer: HTMLElement;
      entries = new Map<number, Entry>();
      constructor(readonly view: EditorView) {
        this.layer = document.createElement('div');
        this.layer.className = 'cm-codeactions';
        this.layer.setAttribute('aria-hidden', 'false');
        view.scrollDOM.append(this.layer);
        this.schedule();
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged) this.schedule();
      }
      destroy(): void {
        this.layer.remove();
      }
      schedule(): void {
        this.view.requestMeasure({
          key: this,
          read: (view) => this.measure(view),
          write: (m) => this.place(m),
        });
      }
      measure(view: EditorView): { blocks: Array<{ info: CodeBlockInfo; x: number; y: number }> } {
        const { state } = view;
        const base = view.scrollDOM.getBoundingClientRect();
        const blocks: Array<{ info: CodeBlockInfo; x: number; y: number }> = [];
        for (const r of view.visibleRanges) {
          for (const info of codeBlocks(state, r)) {
            if (blocks.some((b) => b.info.from === info.from)) continue;
            // the first line with a visible height: the opening fence line is hidden in fully rendered pages
            let line = state.doc.lineAt(info.from);
            if (view.lineBlockAt(line.from).height < 2 && line.number < state.doc.lines) line = state.doc.line(line.number + 1);
            const top = view.lineBlockAt(line.from);
            let right = base.right - base.left - 24;
            const dom = view.domAtPos(line.from).node;
            const el = (dom.nodeType === 1 ? (dom as HTMLElement) : dom.parentElement)?.closest?.('.cm-line');
            if (el) {
              const rr = el.getBoundingClientRect();
              if (rr.width > 0) right = rr.right - base.left + view.scrollDOM.scrollLeft - 8;
            }
            blocks.push({ info, x: right, y: top.top + view.documentTop - base.top + view.scrollDOM.scrollTop + 4 });
          }
        }
        return { blocks };
      }
      place(m: { blocks: Array<{ info: CodeBlockInfo; x: number; y: number }> }): void {
        const host = this.view.state.facet(codeRunHost);
        const seen = new Set<number>();
        for (const { info, x, y } of m.blocks) {
          seen.add(info.from);
          let e = this.entries.get(info.from);
          if (!e) {
            e = this.create(info.from);
            this.entries.set(info.from, e);
          }
          const wantRun = !!host && info.shell;
          if (wantRun && !e.run) this.addRun(e, info.from);
          if (e.run) {
            const label = info.terminal ? 'Run in terminal' : 'Run';
            e.run.dataset.label = label;
            if (!e.running) e.run.textContent = label;
            e.run.title = info.terminal ? 'Open a terminal window and run this script there (it can ask for a password)' : 'Run this script on your computer';
          }
          if (!wantRun && e.run) {
            e.run.remove();
            e.run = null;
          }
          e.x = x;
          e.y = y;
          e.box.style.left = `${x}px`;
          e.box.style.top = `${y}px`;
          if (e.result) {
            e.result.style.left = `${x}px`;
            e.result.style.top = `${y + 30}px`;
          }
        }
        for (const [from, e] of this.entries) {
          if (seen.has(from)) continue;
          if (e.running) continue; // keep a running script's button until it is done, even if scrolled away
          e.box.remove();
          e.result?.remove();
          this.entries.delete(from);
        }
      }
      block(from: number): CodeBlockInfo | undefined {
        return codeBlocks(this.view.state, { from, to: from + 1 }).find((b) => b.from === from);
      }
      create(from: number): Entry {
        const box = document.createElement('div');
        box.className = 'cm-codeactions-box';
        const copy = button('Copy', 'Copy the code');
        box.append(copy);
        const e: Entry = { box, copy, run: null, result: null, running: false, x: 0, y: 0, shown: true };
        const swallow = (ev: Event): void => ev.preventDefault(); // keep the editor's focus and selection
        box.addEventListener('mousedown', swallow);
        copy.addEventListener('click', () => {
          const b = this.block(from);
          if (!b) return;
          void copyText(codeText(this.view.state, b)).then((ok) => {
            copy.textContent = ok ? 'Copied' : 'Could not copy';
            setTimeout(() => (copy.textContent = 'Copy'), 1500);
          });
        });
        this.layer.append(box);
        return e;
      }
      addRun(e: Entry, from: number): void {
        const run = button('Run', 'Run this script on your computer');
        run.classList.add('cm-codeactions-run');
        e.box.prepend(run);
        e.run = run;
        run.addEventListener('click', () => void this.runBlock(e, from));
      }
      async runBlock(e: Entry, from: number): Promise<void> {
        const host = this.view.state.facet(codeRunHost);
        const b = this.block(from);
        if (!host || !b || !e.run) return;
        if (e.running) {
          host.stop?.();
          return;
        }
        e.running = true;
        e.run.textContent = host.stop ? 'Stop' : 'Running…';
        this.showResult(e, 'Running…', '');
        let res: CodeRunResult;
        try {
          res = await host.run({ code: codeText(this.view.state, b), lang: b.lang, terminal: b.terminal });
        } catch (err) {
          res = { ran: false, reason: (err as Error).message };
        }
        e.running = false;
        if (e.run) e.run.textContent = e.run.dataset.label ?? 'Run';
        if (!res.ran) {
          if (res.reason) this.showResult(e, res.reason, '');
          else this.closeResult(e);
          return;
        }
        if (res.terminal) {
          this.showResult(e, 'Opened in a terminal window.', '');
          return;
        }
        const status = res.timedOut ? 'It ran too long and was stopped.' : res.stopped ? 'Stopped.' : res.code === 0 ? 'Finished.' : `Finished with exit code ${res.code}.`;
        this.showResult(e, status, res.output ?? '', res.code !== 0 || !!res.timedOut);
      }
      closeResult(e: Entry): void {
        e.result?.remove();
        e.result = null;
      }
      showResult(e: Entry, status: string, output: string, failed = false): void {
        if (!e.result) {
          const r = document.createElement('div');
          r.className = 'cm-codeactions-result';
          r.addEventListener('mousedown', (ev) => {
            if (!(ev.target as HTMLElement).closest('pre')) ev.preventDefault();
          });
          this.layer.append(r);
          e.result = r;
        }
        e.result.classList.toggle('cm-codeactions-failed', failed);
        e.result.style.left = `${e.x}px`;
        e.result.style.top = `${e.y + 30}px`;
        e.result.textContent = '';
        const head = document.createElement('div');
        head.className = 'cm-codeactions-status';
        head.textContent = status;
        const close = button('×', 'Close');
        close.addEventListener('click', () => this.closeResult(e));
        head.append(close);
        e.result.append(head);
        if (output.trim()) {
          const pre = document.createElement('pre');
          pre.textContent = output;
          e.result.append(pre);
        }
      }
    },
  );
}

function button(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.tabIndex = -1;
  b.textContent = label;
  b.title = title;
  b.className = 'cm-codeactions-btn';
  return b;
}

export const codeActionsTheme = EditorView.baseTheme({
  '.cm-codeactions': { position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: 150, pointerEvents: 'none' },
  '.cm-codeactions-box': {
    position: 'absolute',
    transform: 'translateX(-100%)',
    display: 'flex',
    gap: '4px',
    pointerEvents: 'auto',
    opacity: 0.55,
    transition: 'opacity 0.12s',
  },
  '.cm-codeactions-box:hover, .cm-codeactions-box:focus-within': { opacity: 1 },
  '.cm-codeactions-btn': {
    font: 'inherit',
    fontSize: '0.75rem',
    lineHeight: 1.2,
    padding: '2px 8px',
    border: '1px solid rgba(128,128,128,0.45)',
    borderRadius: '5px',
    background: 'rgba(128,128,128,0.18)',
    color: 'inherit',
    cursor: 'pointer',
  },
  '.cm-codeactions-btn:hover': { background: 'rgba(128,128,128,0.35)' },
  '.cm-codeactions-result': {
    position: 'absolute',
    transform: 'translateX(-100%)',
    pointerEvents: 'auto',
    maxWidth: 'min(36rem, 90%)',
    minWidth: '14rem',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.5)',
    background: 'var(--cn-surface, Canvas)',
    color: 'var(--cn-text, CanvasText)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    fontSize: '0.8rem',
  },
  '.cm-codeactions-failed': { borderColor: '#c0392b' },
  '.cm-codeactions-status': { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  '.cm-codeactions-result pre': {
    margin: '6px 0 0',
    maxHeight: '14rem',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'var(--cn-mono, monospace)',
    userSelect: 'text',
  },
});
