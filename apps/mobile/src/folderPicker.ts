// A plain folder chooser: the system's own picker hands out content:// addresses, but the app works on real paths (the folder is
// the same one Syncthing syncs), so it lists real folders itself.
import { CaveFs, pluginBusy } from './caveFs';
import { withTimeout } from './timeout';

const START = '/storage/emulated/0';

export function chooseFolder(startAt?: string | null, title = 'Choose a folder'): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cave-picker';
    root.innerHTML = `
      <div class="cave-picker-card" role="dialog" aria-label="${title}">
        <div class="cave-picker-title">${title}</div>
        <div class="cave-picker-path" id="cp-path"></div>
        <div class="cave-picker-list" id="cp-list"></div>
        <div class="cave-picker-actions">
          <button id="cp-cancel">Cancel</button>
          <button id="cp-up">Up</button>
          <button id="cp-use" class="cave-picker-primary">Use this folder</button>
        </div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      .cave-picker { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.5);
        padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); box-sizing: border-box; }
      .cave-picker-card { width: 100%; max-width: 560px; max-height: 88%; display: flex; flex-direction: column; background: var(--view-bg, #242424); color: var(--fg, #eee);
        border-radius: 14px 14px 0 0; overflow: hidden; }
      .cave-picker-title { padding: 14px 16px 4px; font-weight: 600; font-size: 16px; }
      .cave-picker-path { padding: 0 16px 8px; font-size: 12px; opacity: .7; word-break: break-all; }
      .cave-picker-list { flex: 1; overflow-y: auto; border-block: 1px solid rgba(128,128,128,.3); min-height: 120px; }
      .cave-picker-list div { padding: 13px 16px; font-size: 15px; border-bottom: 1px solid rgba(128,128,128,.15); }
      .cave-picker-list .empty { opacity: .6; }
      .cave-picker-actions { display: flex; gap: 8px; padding: 10px 12px; }
      .cave-picker-actions button { flex: 1; padding: 12px; font-size: 14px; border-radius: 10px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
      .cave-picker-actions .cave-picker-primary { background: var(--accent, #3584e4); color: #fff; border-color: transparent; }
    `;
    root.prepend(style);
    document.body.append(root);

    const pathEl = root.querySelector('#cp-path') as HTMLElement;
    const listEl = root.querySelector('#cp-list') as HTMLElement;
    let current = startAt && startAt.startsWith('/') ? startAt : START;
    const finish = (value: string | null): void => {
      root.remove();
      resolve(value);
    };
    const show = async (path: string): Promise<void> => {
      try {
        pathEl.textContent = `${path} …`;
        const { entries } = await withTimeout(CaveFs.list({ path }), 6000, 'Listing the folder').catch((e: Error) => {
          const busy = pluginBusy();
          throw new Error(`${e.message}${busy ? `. The phone's file layer is busy with: ${busy}` : ''}`);
        });
        current = path;
        pathEl.textContent = path;
        listEl.replaceChildren();
        const dirs = entries.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name));
        for (const d of dirs) {
          const row = document.createElement('div');
          row.textContent = `📁 ${d.name}`;
          row.onclick = () => void show(`${path.replace(/\/+$/, '')}/${d.name}`);
          listEl.append(row);
        }
        if (dirs.length === 0) {
          const none = document.createElement('div');
          none.className = 'empty';
          none.textContent = 'No folders here';
          listEl.append(none);
        }
      } catch (e) {
        pathEl.textContent = `${path}: ${String((e as Error).message ?? e)}`;
      }
    };
    (root.querySelector('#cp-cancel') as HTMLElement).onclick = () => finish(null);
    (root.querySelector('#cp-up') as HTMLElement).onclick = () => void show(current.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/');
    (root.querySelector('#cp-use') as HTMLElement).onclick = () => finish(current);
    void show(current);
  });
}
