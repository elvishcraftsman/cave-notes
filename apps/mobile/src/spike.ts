import { App } from '@capacitor/app';
import { NoteEditor } from '@cave-notes/editor';
import '../../desktop/src/renderer/styles/adwaita.css';
import { CaveFs, type FsEntry } from './caveFs';
import { startM2 } from './m2';

/** The Milestone 0/2 check page (editor on a real folder, plus the service panel). Open the app with #dev to see it. */
export function startSpike(): void {
// Milestone 0 spike: list a real folder, open a note in the shared editor, save it back, show mtime/size.
// Nothing here is the final app; it exists to answer "does the editor work on this phone, and does real-path storage work".

const DEFAULT_ROOT = '/storage/emulated/0/Syncthing/BBT';
const PATH_KEY = 'cave-m0-path';

  const app = document.getElementById('app') as HTMLElement;
app.innerHTML = `
  <div class="m0">
    <div class="m0-bar">
      <input id="m0-path" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" />
      <button id="m0-grant">Grant access</button>
      <button id="m0-list">List</button>
    </div>
    <div id="m0-status" class="m0-status"></div>
    <div id="m0-files" class="m0-files"></div>
    <div class="m0-bar">
      <span id="m0-open" class="m0-open">(no note open)</span>
      <button id="m0-save" disabled>Save</button>
      <button id="m0-close" disabled>Close</button>
    </div>
    <div id="m0-editor" class="m0-editor"></div>
  </div>`;

const style = document.createElement('style');
style.textContent = `
  html, body { height: 100%; margin: 0; }
  #app { height: 100%; }
  .m0 { display: flex; flex-direction: column; height: 100%; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); box-sizing: border-box; }
  .m0-bar { display: flex; gap: 6px; padding: 6px 8px; align-items: center; }
  .m0-bar input { flex: 1; min-width: 0; font-size: 14px; padding: 8px; }
  .m0-bar button { padding: 8px 12px; font-size: 14px; }
  .m0-status { padding: 0 8px 4px; font-size: 12px; opacity: 0.8; min-height: 1.2em; white-space: pre-wrap; }
  .m0-files { flex: 0 0 auto; max-height: 28%; overflow-y: auto; border-block: 1px solid rgba(128,128,128,.3); }
  .m0-files div { padding: 10px 12px; font-size: 15px; border-bottom: 1px solid rgba(128,128,128,.15); }
  .m0-open { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m0-editor { flex: 1; min-height: 0; overflow: hidden; }
  .m0-editor .cm-editor { height: 100%; }
`;
document.head.append(style);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const pathInput = $<HTMLInputElement>('m0-path');
const statusEl = $('m0-status');
const filesEl = $('m0-files');
const openEl = $('m0-open');
const saveBtn = $<HTMLButtonElement>('m0-save');
const closeBtn = $<HTMLButtonElement>('m0-close');

pathInput.value = localStorage.getItem(PATH_KEY) ?? DEFAULT_ROOT;

let current: { path: string; mtime: number; dirty: boolean } | null = null;
let dir = pathInput.value;

const editor = new NoteEditor({
  parent: $('m0-editor'),
  onChange: () => {
    if (current) {
      current.dirty = true;
      saveBtn.disabled = false;
    }
  },
  onSave: () => void save(),
  resolveAsset: () => null,
});

const say = (msg: string): void => {
  statusEl.textContent = msg;
};
const when = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
const join = (a: string, b: string): string => `${a.replace(/\/+$/, '')}/${b}`;
const parent = (p: string): string => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';

async function list(path: string): Promise<void> {
  try {
    const { entries } = await CaveFs.list({ path });
    dir = path;
    pathInput.value = path;
    localStorage.setItem(PATH_KEY, path);
    entries.sort((a: FsEntry, b: FsEntry) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    filesEl.replaceChildren();
    const up = document.createElement('div');
    up.textContent = '↑ ..';
    up.onclick = () => void list(parent(path));
    filesEl.append(up);
    for (const e of entries) {
      const row = document.createElement('div');
      row.textContent = `${e.isDir ? '📁' : e.name.endsWith('.md') ? '📝' : '·'} ${e.name}`;
      row.onclick = () => (e.isDir ? void list(join(path, e.name)) : e.name.endsWith('.md') ? void open(join(path, e.name)) : say(`${e.name}: ${e.size} bytes, not a note`));
      filesEl.append(row);
    }
    say(`${entries.length} entries in ${path}`);
  } catch (err) {
    say(`list failed: ${String((err as Error).message ?? err)}`);
  }
}

async function open(path: string): Promise<void> {
  try {
    const f = await CaveFs.read({ path });
    editor.load(f.text);
    current = { path, mtime: f.mtime, dirty: false };
    openEl.textContent = path.slice(dir.length + 1) || path;
    saveBtn.disabled = true;
    closeBtn.disabled = false;
    say(`opened ${path}\n${f.size} bytes, modified ${when(f.mtime)}`);
  } catch (err) {
    say(`open failed: ${String((err as Error).message ?? err)}`);
  }
}

async function save(): Promise<void> {
  if (!current) return;
  try {
    const before = await CaveFs.stat({ path: current.path });
    if (before.exists && before.mtime !== current.mtime) say(`note: file changed on disk since opened (${when(before.mtime)}); saving over it`);
    const r = await CaveFs.write({ path: current.path, text: editor.text() });
    current.mtime = r.mtime;
    current.dirty = false;
    saveBtn.disabled = true;
    say(`saved ${current.path}\n${r.size} bytes, modified ${when(r.mtime)}`);
  } catch (err) {
    say(`save failed: ${String((err as Error).message ?? err)}`);
  }
}

$('m0-grant').onclick = () => void CaveFs.requestAccess();
$('m0-list').onclick = () => void list(pathInput.value.trim());
saveBtn.onclick = () => void save();
closeBtn.onclick = () => {
  current = null;
  editor.load('');
  openEl.textContent = '(no note open)';
  saveBtn.disabled = true;
  closeBtn.disabled = true;
};

// "All files access" is granted on a system screen outside the app: look again when the app comes back to the front.
void App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) void CaveFs.hasAccess().then(({ granted }) => say(granted ? 'All files access: granted' : 'All files access: not granted (tap Grant access)'));
});
void CaveFs.hasAccess().then(({ granted }) => say(granted ? 'All files access: granted' : 'All files access: not granted (tap Grant access)'));

  startM2();
}
