import { NoteEditor } from '@cave-notes/editor';
import type { CanvasEditorHost } from '@cave-notes/editor';
import { effect } from '@preact/signals';
import type { Controller } from '../controller';
import { renderMini } from '../views/embedHost';

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const FIRST_LINES = 40;

const stem = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');

/**
 * What the canvas needs from the app to draw the inside of its cards: text cards are Markdown (drawn small and read-only,
 * or in the same editor as any page while being edited), file cards show the page, image or file they name, and link cards
 * the address. A change to the page the canvas shows is a change to its file, handled by the editor.
 */
export function createCanvasHost(ctl: Controller): CanvasEditorHost {
  return {
    pref: {
      get: (key) => localStorage.getItem(`cave-notes.canvas.${key}`) === '1',
      set: (key, value) => localStorage.setItem(`cave-notes.canvas.${key}`, value ? '1' : '0'),
    },

    // view mode: a click on a link inside the text of a card goes there
    followIn(target) {
      const t = target.closest<HTMLElement>('[data-wiki], [data-url], [data-md]');
      if (!t) return false;
      if (t.dataset.url) ctl.openUrl(t.dataset.url);
      else if (t.dataset.wiki) void ctl.followLink({ syntax: 'wiki', target: t.dataset.wiki, fragment: null, text: null, from: 0, to: 0 });
      else if (t.dataset.md) void ctl.followLink({ syntax: 'md', target: t.dataset.md, fragment: null, text: null, from: 0, to: 0 });
      return true;
    },

    mountText(el, node, opts) {
      if (!opts.edit) {
        const draw = (text: string): void => {
          el.replaceChildren(renderMini(text, undefined, undefined, undefined, undefined, ctl.assetUrl));
          el.classList.add('cv-md');
        };
        draw(node.text);
        return { update: draw, focus() {}, destroy: () => el.replaceChildren() };
      }
      // the page editor in a card: the same editing as anywhere (live preview, lists, links), without the page-only extras
      const ed = new NoteEditor({
        parent: el,
        attributeBar: false,
        onChange: () => opts.onText(ed.text()),
        onOpenLink: (link, e) => void ctl.followLink(link, e.shiftKey),
        onSave: () => void ctl.flush(),
        spell: ctl.spellHost,
        thesaurus: ctl.thesaurusHost,
        wikilinkCompletions: async (q) => (await ctl.suggest(q)).map((s) => ({ label: s.label, detail: s.path.replace(/\.[^.]+$/, '') })),
        linkStatus: ctl.wikiStatus,
        resolveAsset: ctl.assetUrl,
      });
      ed.load(node.text);
      el.classList.remove('cv-md');
      el.addEventListener('keydown', onKey);
      function onKey(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
          e.stopPropagation();
          opts.onDone();
        }
      }
      return {
        update(text) {
          if (ed.text() !== text) ed.load(text);
        },
        focus() {
          ed.focus();
          ed.view.dispatch({ selection: { anchor: ed.text().length } });
        },
        destroy() {
          el.removeEventListener('keydown', onKey);
          ed.destroy();
          el.replaceChildren();
        },
      };
    },

    fillFile(el, node, expanded) {
      el.classList.add('cv-card');
      const name = stem(node.file) + (node.subpath ? ` ${node.subpath}` : '');
      if (IMAGE.test(node.file)) {
        const src = ctl.assetUrlFor('', `/${node.file}`);
        if (src) {
          const img = document.createElement('img');
          img.alt = name;
          img.src = src;
          img.draggable = false;
          el.append(img);
          return;
        }
      }
      // small: only what the card is. Open out (the button, or a taller card): the page itself as well.
      const title = document.createElement('div');
      title.className = 'cv-card-title';
      title.textContent = name;
      const sub = document.createElement('div');
      sub.className = 'cv-card-sub cv-card-clamp';
      sub.textContent = node.file;
      el.append(title, sub);
      if (!expanded) return;
      void ctl.ws.readPage(node.file).then(
        (page) => {
          if (!page.exists) {
            sub.textContent = `${node.file} (not found)`;
            return;
          }
          if (!el.isConnected) return;
          const body = page.text.replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n').slice(0, FIRST_LINES).join('\n');
          const box = document.createElement('div');
          box.className = 'cv-page-preview cv-md';
          box.append(renderMini(body));
          el.append(box);
        },
        () => {},
      );
    },

    fillLink(el, node) {
      el.classList.add('cv-card');
      let host = node.url;
      try {
        host = new URL(node.url).hostname;
      } catch {
        /* shown as written */
      }
      const title = document.createElement('div');
      title.className = 'cv-card-title';
      title.textContent = host;
      const sub = document.createElement('div');
      sub.className = 'cv-card-sub';
      sub.textContent = node.url;
      el.append(title, sub);
    },

    // pages dragged from the tree, files from the folder bar
    canDrop: (types) => types.includes('application/x-cave-page') || types.includes('application/x-cave-file'),
    dropPaths(dt) {
      const from = dt.getData('application/x-cave-workspace');
      if (from && from !== ctl.activeRoot()) return []; // a page of another workspace is not a file of this one
      const page = dt.getData('application/x-cave-page');
      if (page) return ctl.dragPaths.length > 0 && ctl.dragPaths.includes(page) ? [...ctl.dragPaths] : [page];
      const file = dt.getData('application/x-cave-file');
      return file ? [file] : [];
    },

    // pictures behind a card, and chosen for one: a file of the workspace, by its path from the top
    imageUrl: (path) => ctl.assetUrlFor('', `/${path.replace(/^\/+/, '')}`),
    chooseImage: () =>
      new Promise<string | null>((resolve) => {
        const spec = {
          kind: 'prompt' as const,
          title: 'Choose a Picture',
          body: 'Type the path of a picture of this workspace, from its top folder, for example Pictures/map.png.',
          label: 'Picture',
          value: '',
          confirm: 'Choose',
          submit: async (name: string): Promise<string | null> => {
            const path = name.trim().replace(/^\/+/, '');
            if (!IMAGE.test(path)) return 'That is not a picture (png, jpg, gif, webp, svg, avif or bmp).';
            const src = ctl.assetUrlFor('', `/${path}`);
            const ok = src ? await new Promise<boolean>((done) => { const im = new Image(); im.onload = () => done(true); im.onerror = () => done(false); im.src = src; }) : false;
            if (!ok) return `There is no picture at “${path}”.`;
            resolve(path);
            return null;
          },
        };
        ctl.dialog.value = spec;
        const stop = effect(() => {
          if (ctl.dialog.value !== spec) {
            queueMicrotask(() => {
              stop();
              resolve(null);
            });
          }
        });
      }),

    openFile: (node) => void ctl.openCanvasFile(node.file),
    openUrl: (url) => ctl.openUrl(url),

    chooseFile: () =>
      new Promise<string | null>((resolve) => {
        const from = ctl.current.value?.path ?? '';
        const spec = {
          kind: 'prompt' as const,
          title: 'Add a Page',
          body: 'Type the name of a page of this workspace, or the path of a file.',
          label: 'Page or file',
          value: '',
          confirm: 'Add',
          submit: async (name: string): Promise<string | null> => {
            const target = name.trim();
            if (!target) return 'Enter a name.';
            const r = await ctl.ws.resolveLink({ syntax: 'wiki', target }, from).catch(() => null);
            if (r && r.kind === 'page' && r.status === 'ok') {
              resolve(r.path);
              return null;
            }
            if (r && r.kind === 'page' && r.status === 'ambiguous') return `More than one page is called “${target}”. Use its path.`;
            const asPath = await ctl.ws.pageInfo(target.replace(/^\//, '')).catch(() => null);
            if (asPath) {
              resolve(asPath.path);
              return null;
            }
            return `No page called “${target}”.`;
          },
        };
        ctl.dialog.value = spec;
        // closed without choosing
        const stop = effect(() => {
          if (ctl.dialog.value !== spec) {
            queueMicrotask(() => {
              stop();
              resolve(null);
            });
          }
        });
      }),

    askUrl: () =>
      new Promise<string | null>((resolve) => {
        const spec = {
          kind: 'prompt' as const,
          title: 'Add a Web Link',
          label: 'Web address',
          value: 'https://',
          confirm: 'Add',
          submit: async (value: string): Promise<string | null> => {
            const url = value.trim();
            if (!/^https?:\/\/[^\s/]+/i.test(url)) return 'Enter an address that starts with https:// or http://.';
            resolve(url);
            return null;
          },
        };
        ctl.dialog.value = spec;
        const stop = effect(() => {
          if (ctl.dialog.value !== spec) {
            queueMicrotask(() => {
              stop();
              resolve(null);
            });
          }
        });
      }),
  };
}
