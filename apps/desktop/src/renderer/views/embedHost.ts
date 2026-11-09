import { AUTOMATION_LINK, drawExpression, fillQueryLinks, findExpressions, type EmbedHost, type EmbedSpec } from '@cave-notes/editor';
import { effect } from '@preact/signals';
import { resolveQuery } from '@cave-notes/ui-views';
import { CanvasView, boundsOf, parseCanvas } from '@cave-notes/ui-canvas';
import { createCanvasHost } from '../canvas/host';
import { h, render } from 'preact';
import type { Controller } from '../controller';
import { ViewBlock } from './ViewBlock';

/** Inline formatting, as text nodes and a few safe elements (nothing from the source is ever parsed as HTML). */
/** Fills a `[[?query|template]]` placeholder with the pages the query finds. */
type QueryFill = (el: HTMLElement, query: string, template: string | null) => void;
/** Draws a ```view block of embedded text into `el`. */
type ViewFill = (el: HTMLElement, source: string) => void;
/** Fills a `${…}` (or `[[${…}|label]]`) with its value. */
type ExprFill = (el: HTMLElement, expr: string, link: boolean, label: string | null) => void;
/** Runs the automation rule a `[=Label](automation:rule-id)` button names. */
type RunRule = (ruleId: string) => void;

/** Where a picture written in the text (`![alt](path)`) can be loaded from, or null when it cannot. */
export type ImageSrc = (href: string) => string | null;

function inline(parent: HTMLElement, text: string, fill?: QueryFill, exprFill?: ExprFill, run?: RunRule, images?: ImageSrc): void {
  const re = /(!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]+)\)|\[\[\$\{[^}\n]+\}[^\]\n]*\]\]|\$\{[^}\n]+\}|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|!?\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const t = m[0];
    let el: HTMLElement;
    if (t.startsWith('![') && !t.startsWith('![[')) {
      // a picture: drawn when the app can find the file, else its description
      const im = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))/.exec(t);
      const href = im ? (im[2] ?? im[3] ?? '') : '';
      const src = images && href ? images(href) : null;
      if (src) {
        const img = document.createElement('img');
        img.className = 'cv-md-img';
        img.alt = im?.[1] ?? '';
        img.src = src;
        img.draggable = false;
        el = img;
      } else {
        el = document.createElement('span');
        el.textContent = im?.[1] || t;
      }
    }
    else if (t.startsWith('${') || t.startsWith('[[${')) {
      const f = findExpressions(t)[0];
      el = document.createElement('span');
      if (exprFill && f && f.length === t.length) exprFill(el, f.expr, f.link, f.label);
      else el.textContent = t;
    }
    else if (t.startsWith('**')) { el = document.createElement('strong'); el.textContent = t.slice(2, -2); }
    else if (t.startsWith('`')) { el = document.createElement('code'); el.textContent = t.slice(1, -1); }
    else if (t.startsWith('*')) { el = document.createElement('em'); el.textContent = t.slice(1, -1); }
    else if (t.startsWith('[[?') && fill) {
      const m = /^\[\[\?([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(t);
      el = document.createElement('span');
      el.className = 'cm-querylinks';
      if (m) fill(el, m[1]!.trim(), m[2] ?? null);
      else el.textContent = t;
    }
    else if (t.includes('[[')) {
      el = document.createElement('span'); el.className = 'embed-link'; el.textContent = t.replace(/^!?\[\[(?:[^\]|]*\|)?|\]\]$/g, '');
      // where it points, so that a canvas in view mode can follow it
      const w = /^!?\[\[([^\]|#]+)/.exec(t);
      if (w) el.dataset.wiki = w[1]!.trim();
    }
    else {
      // `[=Label](automation:rule-id)` is a button that runs the rule, as it is in the page itself
      const b = run ? /^\[([^\]]*)\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(t) : null;
      const rule = b ? AUTOMATION_LINK.exec(b[2]!) : null;
      if (b && rule) {
        const id = rule[1]!;
        el = document.createElement('span');
        el.className = 'cm-link cm-wikilink-button cm-automation-button';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.title = `Run the automation “${id}”`;
        el.textContent = b[1]!.replace(/^\s*=\s?/, '');
        el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); run!(id); };
        el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); run!(id); } };
      } else {
        el = document.createElement('span'); el.className = 'embed-link'; el.textContent = /^\[([^\]]*)\]/.exec(t)?.[1] ?? t;
        const dest = /\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(t)?.[1];
        if (dest) { if (/^https?:\/\//i.test(dest)) el.dataset.url = dest; else el.dataset.md = dest; }
      }
    }
    parent.append(el);
    last = m.index + t.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

/** A small, read-only picture of Markdown: headings, paragraphs, lists, task items, quotes and code blocks. */
export function renderMini(text: string, fill?: QueryFill, viewFill?: ViewFill, exprFill?: ExprFill, run?: RunRule, images?: ImageSrc): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = text.split('\n');
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = (): void => {
    if (para.length) { const p = document.createElement('p'); inline(p, para.join(' '), fill, exprFill, run, images); out.append(p); para = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      flush(); list = null;
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*(```+|~~~+)\s*$/.test(lines[i]!); i++) code.push(lines[i]!);
      // a ```view block is a query view, drawn as one (as in the page itself), not shown as code
      if (viewFill && /^\s*(?:```+|~~~+)\s*view\s*$/i.test(line)) {
        const box = document.createElement('div');
        box.className = 'cm-view-block';
        viewFill(box, code.join('\n'));
        out.append(box);
        continue;
      }
      const pre = document.createElement('pre'); pre.textContent = code.join('\n'); out.append(pre);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const li = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (h) { flush(); list = null; const e = document.createElement(`h${h[1]!.length}`); inline(e, h[2]!, fill, exprFill, run, images); out.append(e); }
    else if (li) {
      flush();
      if (!list) { list = document.createElement('ul'); out.append(list); }
      const item = document.createElement('li');
      if (li[2] !== undefined) item.textContent = li[2] === ' ' ? '☐ ' : '☑ ';
      inline(item, li[3]!, fill, exprFill, run, images);
      list.append(item);
    } else if (q) { flush(); list = null; const b = document.createElement('blockquote'); inline(b, q[1]!, fill, exprFill, run, images); out.append(b); }
    else if (line.trim() === '') { flush(); list = null; }
    else para.push(line.trim());
  }
  flush();
  return out;
}

/** The first line of the text with its markup taken off, for an embed inside a sentence. */
const plainFirstLine = (text: string): string =>
  (text.split('\n').find((l) => l.trim() !== '') ?? '').replace(/^#+\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();

/**
 * Draws `![[…]]`: the content it points at, read-only. A button switches it to a text box on the source; Save writes the
 * source (so everything that shows it changes), Cancel leaves it alone.
 */
export function createEmbedHost(ctl: Controller): EmbedHost {
  const host: EmbedHost = {
    async queryLinks(query) {
      const page = ctl.current.value?.path ?? null;
      const saved = new Map(ctl.saved.value.queries.map((x) => [x.name.toLowerCase(), x.query]));
      const rows = (await ctl.queryView(resolveQuery({ query }, { page, saved }), null, 50)).rows; // pages of other workspaces too (saved:Workspace::name)
      return rows.map((r) => ({ path: r.path, title: r.title, ...(r.workspace ? { workspace: r.workspace } : {}), attrs: Object.fromEntries(Object.entries(r.attrs).map(([k, v]) => [k, v[0]?.text ?? ''])) }));
    },
    async expression(expr) {
      const m = /^(this|\[\[([^\]\n]+)\])\.([^\s.{}[\]]+)$/.exec(expr.trim());
      if (!m) {
        // anything beyond reading one attribute is worked out by the workspace: sums and counts over a query, arithmetic, text and date functions
        const r = await ctl.ws.evaluateExpression(ctl.current.value?.path ?? null, expr.trim());
        return r.ok ? { ok: true, values: r.list.map((text) => ({ text })) } : { ok: false, error: r.error };
      }
      const from = ctl.current.value?.path ?? '';
      let path = from;
      if (m[2] !== undefined) {
        const r = await ctl.ws.resolveLink({ syntax: 'wiki', target: m[2].split('|')[0]!.trim() }, from);
        if (r.kind !== 'page' || r.status !== 'ok') return { ok: false, error: r.kind === 'page' && r.status === 'ambiguous' ? `More than one page is called “${m[2]}”.` : `No page called “${m[2]}”.` };
        path = r.path;
      }
      const info = await ctl.ws.pageInfo(path);
      if (!info) return { ok: false, error: 'This page is not saved yet.' };
      const key = m[3]!;
      if (key === 'title') return { ok: true, values: [{ text: info.title }] };
      const found = Object.keys(info.attributes).find((k) => k === key) ?? Object.keys(info.attributes).find((k) => k.toLowerCase() === key.toLowerCase());
      const values: Array<{ text: string; path?: string; title?: string; workspace?: string }> = [];
      for (const v of found ? info.attributes[found]! : []) {
        // a value that is a link to a page, a file or a page of another workspace is drawn as that; anything else is its text
        const t = v.text.trim();
        const w = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(t) ?? /^\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*\)$/.exec(t);
        if (w) {
          const link = /^\[\[/.test(t) ? ({ syntax: 'wiki', target: w[1]!.trim() } as const) : ({ syntax: 'md', target: w[1]! } as const);
          const r = await ctl.ws.resolveLink(link, path).catch(() => null);
          if (r && r.kind === 'page' && r.status === 'ok') {
            const target = await ctl.ws.pageInfo(r.path);
            values.push({ text: target?.title ?? w[1]!, path: r.path, title: target?.title ?? w[1]! });
            continue;
          }
          if (r && r.kind === 'workspace') {
            const there = await ctl.describeForeign(r.workspace, r.target);
            if (there) {
              values.push({ text: there.title, path: there.path, title: there.title, workspace: r.workspace });
              continue;
            }
          }
          if (r && r.kind === 'file') {
            // a file of this workspace that is not a note: shown by its name
            values.push({ text: w[1]!.split('/').pop() ?? w[1]! });
            continue;
          }
        }
        values.push({ text: v.text });
      }
      return { ok: true, values };
    },
    watch(cb) {
      // pages changed here or on disk (viewTick) or an embed's source was saved (embedTick)
      return effect(() => {
        void ctl.viewTick.value;
        void ctl.embedTick.value;
        cb();
      });
    },
    openPage(path, _e, workspace) {
      if (workspace) void ctl.openWorkspaceLink(workspace, path, null);
      else void ctl.openPage(path, { nav: 'push', reveal: true });
    },
    mount(el: HTMLElement, spec: EmbedSpec) {
      let editing = false;
      let state: { ok: true; text: string; source: string } | { ok: false; error: string } | null = null;
      let seq = 0;
      // the query views drawn in the text; they are taken down whenever the text is drawn again
      let views: Array<() => void> = [];
      const dropViews = (): void => {
        for (const stop of views) stop();
        views = [];
      };
      // `${this.name}` in the text is an attribute of the page the text is inserted in, as `$this` is for views and queries
      const exprFill: ExprFill = (box, expr, link, label) => {
        views.push(drawExpression(box, host, expr, link, label));
      };
      // `$this` in such a view is the page the text is inserted in (the page on show), never the page the text comes from
      const viewFill: ViewFill = (box, source) => {
        let current = source;
        const paint = (): void => {
          render(h(ViewBlock, {
            ctl,
            source: current,
            api: {
              // changes to the settings of a view inside embedded text last only while it is shown: the source is not touched
              updateSource: (next: string) => { current = next; paint(); },
              edit: () => ctl.toast(`This view is part of ${spec.raw}. Change it in its own page.`),
              remove: () => ctl.toast(`This view is part of ${spec.raw}. Delete it in its own page.`),
            },
          }), box);
        };
        paint();
        views.push(() => render(null, box));
      };
      const from = (): string => ctl.current.value?.path ?? '';
      // a button in embedded text runs its rule for the page the text is inserted in (the page on show), as `$this` and `${this.…}` do
      const run: RunRule = (ruleId) => void ctl.runAutomationButton(ruleId);
      // `[[?query|template]]` inside embedded text: the pages the query finds, as in the page itself (`$this` is the page showing it)
      const fill: QueryFill = (box, query, template) => {
        box.textContent = '…';
        const page = ctl.current.value?.path ?? null;
        const saved = new Map(ctl.saved.value.queries.map((x) => [x.name.toLowerCase(), x.query]));
        void ctl.queryView(resolveQuery({ query }, { page, saved }), null, 50).then(
          (r) => fillQueryLinks(box, r.rows.map((x) => ({ path: x.path, title: x.title, ...(x.workspace ? { workspace: x.workspace } : {}), attrs: Object.fromEntries(Object.entries(x.attrs).map(([k, v]) => [k, v[0]?.text ?? ''])) })), template, (p, _e, w) => void (w ? ctl.openWorkspaceLink(w, p, null) : ctl.openPage(p, { nav: 'push', reveal: true }))),
          (e: unknown) => { box.textContent = e instanceof Error ? e.message : 'The query could not be run.'; box.classList.add('cm-querylinks-bad'); },
        );
      };

      // a canvas named by an embed is shown as a canvas (view mode), not as its text
      let shownCanvas: CanvasView | null = null;
      const dropCanvas = (): void => {
        shownCanvas?.destroy();
        shownCanvas = null;
        el.classList.remove('cv-embed');
      };
      const drawCanvas = (ok: { text: string; source: string }): void => {
        const parsed = parseCanvas(ok.text);
        if (!parsed.ok) {
          dropCanvas();
          el.textContent = '';
          const w = document.createElement('span');
          w.className = 'embed-error';
          w.textContent = `⚠ ${parsed.error}`;
          el.append(w);
          return;
        }
        // a canvas already on show keeps its zoom and place when the canvas changes
        if (shownCanvas && el.contains(shownCanvas.root)) {
          shownCanvas.setCanvas(parsed.canvas);
          return;
        }
        dropCanvas();
        el.textContent = '';
        el.classList.add('cv-embed');
        el.title = `${spec.raw} — from ${ok.source}`;
        const stage = document.createElement('div');
        const box = boundsOf(parsed.canvas.nodes);
        const width = el.clientWidth || 700;
        // tall enough for everything to show at the width it has (never more than most of a screen)
        const height = box ? Math.round(Math.min(640, Math.max(180, Math.min(1, (width - 80) / Math.max(1, box.width)) * box.height + 80))) : 140;
        stage.style.height = `${height}px`;
        el.append(stage);
        shownCanvas = new CanvasView(stage, { ...createCanvasHost(ctl), onChange: () => {} }, parsed.canvas, { readOnly: true, embedded: true });
        shownCanvas.root.classList.add('cv-embedded');
        const bar = document.createElement('div');
        bar.className = 'cv-embed-bar';
        const name = document.createElement('span');
        name.className = 'cv-embed-title';
        name.textContent = (ok.source.split('/').pop() ?? ok.source).replace(/\.canvas$/i, '');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'pill-button small';
        edit.textContent = 'Edit';
        edit.title = `Open ${ok.source} in a new tab to edit it`;
        edit.setAttribute('aria-label', `Edit the canvas ${name.textContent} in a new tab`);
        edit.onclick = () => void ctl.openInNewTab(ok.source);
        bar.append(name, edit);
        el.append(bar);
      };

      const draw = (): void => {
        dropViews();
        if (spec.block && state && state.ok && /\.canvas$/i.test(state.source)) {
          el.classList.remove('cm-embed-bad');
          drawCanvas(state);
          return;
        }
        dropCanvas();
        el.textContent = '';
        el.classList.toggle('cm-embed-bad', state !== null && !state.ok);
        if (!state) { el.append(spec.block ? 'Loading…' : '…'); return; }
        if (!state.ok) {
          const w = document.createElement('span');
          w.className = 'embed-error';
          w.textContent = `⚠ ${state.error}`;
          w.title = spec.raw;
          el.append(w);
          return;
        }
        const ok = state;
        el.title = `${spec.raw} — from ${ok.source}`;
        const body = document.createElement(spec.block ? 'div' : 'span');
        body.className = 'embed-body';
        if (spec.block) body.append(renderMini(ok.text, fill, viewFill, exprFill, run));
        else inline(body, plainFirstLine(ok.text), fill, exprFill, run);
        el.append(body);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'embed-edit';
        btn.textContent = spec.block ? 'Edit' : '✎';
        btn.setAttribute('aria-label', `Edit the source of ${spec.raw}`);
        btn.title = `Edit the source (${ok.source})`;
        btn.onclick = () => { editing = true; edit(ok.text, ok.source); };
        el.append(btn);
      };

      const edit = (text: string, source: string): void => {
        dropViews();
        el.textContent = '';
        el.classList.add('cm-embed-editing');
        const note = document.createElement('div');
        note.className = 'embed-note';
        note.textContent = `Editing the source: ${source}. Every place that shows it changes.`;
        const area = document.createElement('textarea');
        area.className = 'embed-text';
        area.value = text;
        area.rows = Math.min(16, Math.max(3, text.split('\n').length + 1));
        area.spellcheck = true;
        const err = document.createElement('div');
        err.className = 'embed-error';
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'pill-button small suggested'; save.textContent = 'Save';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'pill-button small'; cancel.textContent = 'Cancel';
        const done = (): void => { editing = false; el.classList.remove('cm-embed-editing'); void load(); };
        save.onclick = async () => {
          save.disabled = true;
          const r = await ctl.ws.saveEmbed(from(), spec.target, spec.heading, spec.named, area.value).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
          if (r.ok) { ctl.embedTick.value++; done(); } else { err.textContent = r.error; save.disabled = false; }
        };
        cancel.onclick = done;
        area.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); done(); }
          else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save.click(); }
        };
        const row = document.createElement('div');
        row.className = 'embed-actions';
        row.append(save, cancel);
        el.append(note, area, err, row);
        area.focus();
      };

      const load = async (): Promise<void> => {
        const mine = ++seq;
        const r = await ctl.ws.resolveEmbed(from(), spec.target, spec.heading, spec.named).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
        if (mine !== seq || editing) return;
        state = r;
        draw();
        // a view in this text was redrawn after a page was made with its New button: give that button the focus back
        const want = ctl.newFocus;
        if (want && Date.now() - want.at < 5000) {
          const btn = [...el.querySelectorAll<HTMLElement>('[data-new-page]')].find((b) => b.dataset.viewQuery === want.query);
          if (btn) {
            ctl.newFocus = null;
            setTimeout(() => btn.focus(), 0);
          }
        }
      };

      draw();
      // a change to any page or to an embed's source (here or elsewhere) shows at once
      const stop = effect(() => {
        void ctl.embedTick.value;
        void ctl.viewTick.value;
        if (!editing) void load();
      });
      return { destroy: () => { seq++; stop(); dropViews(); dropCanvas(); } };
    },
  };
  return host;
}
