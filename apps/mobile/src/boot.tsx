import { App as CapApp } from '@capacitor/app';
import { render } from 'preact';
// The shared window, as it is built for desktop: today it is imported from there; it moves to its own package when the Android
// layout work needs to change it (see apps/mobile/PLAN.md).
import '../../desktop/src/renderer/styles/adwaita.css';
import { App } from '../../desktop/src/renderer/components/App';
import { Controller } from '../../desktop/src/renderer/controller';
import { narrow } from '../../desktop/src/renderer/layout';
import { lookupSynonyms } from '../../desktop/src/renderer/thesaurus';
import './mobile.css';
import { createAndroidDeps } from './androidApp';
import { CaveFs } from './caveFs';
import { startSpike } from './spike';

window.addEventListener('error', (e) => console.error(`[uncaught] ${e.message} at ${e.filename?.split('/').pop()}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string; stack?: string } | undefined;
  console.error(`[unhandled rejection] ${r?.message ?? String(e.reason)}${r?.stack ? `\n${r.stack.split('\n').slice(0, 6).join('\n')}` : ''}`);
});

const root = document.getElementById('app') as HTMLElement;

/** The first screen when the app has no access to the phone's files yet: it explains why, and goes on by itself once it is granted. */
function showGate(): Promise<void> {
  return new Promise((resolve) => {
    root.innerHTML = `
      <div class="cave-gate">
        <h1>Cave Notes</h1>
        <p>Your notes are ordinary files in a folder on this phone (the same folder Syncthing keeps in step with your other computers).
        To read and save them, Cave Notes needs the “All files access” permission.</p>
        <button id="gate-grant">Allow access to files</button>
        <button id="gate-dev" class="quiet">Developer check page</button>
      </div>`;
    (document.getElementById('gate-grant') as HTMLElement).onclick = () => void CaveFs.requestAccess();
    (document.getElementById('gate-dev') as HTMLElement).onclick = () => {
      location.hash = '#dev';
      location.reload();
    };
    const check = async (): Promise<void> => {
      if ((await CaveFs.hasAccess()).granted) {
        void handle.then((h) => h.remove());
        resolve();
      }
    };
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void check();
    });
  });
}

async function start(): Promise<void> {
  if (location.hash === '#dev') {
    startSpike();
    return;
  }
  if (!(await CaveFs.hasAccess()).granted) await showGate();
  root.innerHTML = '';
  const { deps, plog } = await createAndroidDeps();
  document.documentElement.dataset.theme = (await deps.main.getSettings()).theme;
  const ctl = new Controller({ ...deps, thesaurus: lookupSynonyms });
  (window as unknown as { __cave: Controller }).__cave = ctl;
  render(<App ctl={ctl} />, root);
  // a field in a dialog is brought into view once the keyboard has taken its room
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.closest?.('.dialog') || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
  });
  // how long opening things takes, down to the moment the page is on the screen (the numbers are what a freeze report needs)
  const timed = <K extends 'openPage' | 'activateTab' | 'openWorkspace' | 'openFolder'>(name: K): void => {
    const original = (ctl[name] as (...a: unknown[]) => Promise<unknown>).bind(ctl);
    (ctl as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      const end = plog.begin(`${name} ${typeof args[0] === 'string' ? args[0] : ''}`, 0);
      try {
        return await original(...args);
      } finally {
        requestAnimationFrame(() => requestAnimationFrame(() => end('(until it was drawn)')));
      }
    };
  };
  for (const n of ['openPage', 'activateTab', 'openWorkspace', 'openFolder'] as const) timed(n);
  void ctl.init();
  // the Back button: close what is open first, then step back through the pages, and only then leave the app
  void CapApp.addListener('backButton', () => {
    if (ctl.dialog.value) ctl.closeDialog();
    else if (narrow.value && ctl.settings.value.showLeft) ctl.toggleLeft();
    else if (ctl.canGoBack.value) void ctl.stepHistory(-1);
    else void CapApp.minimizeApp();
  });
}

void start().catch((e: Error) => {
  root.textContent = `Cave Notes could not start: ${e.message}`;
  console.error(e);
});
