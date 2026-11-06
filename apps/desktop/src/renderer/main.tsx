import '@fontsource/libertinus-serif/400.css';
import '@fontsource/libertinus-serif/400-italic.css';
import '@fontsource/libertinus-serif/600.css';
import '@fontsource/libertinus-serif/600-italic.css';
import '@fontsource/libertinus-serif/700.css';
import '@fontsource/libertinus-serif/700-italic.css';
import './styles/adwaita.css';
import { render } from 'preact';
import type { RawBridge } from '../shared/api';
import { createDeps } from './bridge';
import { App } from './components/App';
import { Controller } from './controller';
import { lookupSynonyms } from './thesaurus';

// Anything that escapes is written to the console, which the main process copies into the log file.
window.addEventListener('error', (e) => console.error(`[uncaught] ${e.message} at ${e.filename?.split('/').pop()}:${e.lineno}:${e.colno}${e.error?.stack ? `\n${String(e.error.stack).split('\n').slice(0, 6).join('\n')}` : ''}`));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string; stack?: string } | undefined;
  console.error(`[unhandled rejection] ${r?.message ?? String(e.reason)}${r?.stack ? `\n${r.stack.split('\n').slice(0, 6).join('\n')}` : ''}`);
});

const raw = (window as unknown as { cave?: RawBridge }).cave;
const root = document.getElementById('app');
if (!raw || !root) {
  document.body.textContent = 'Cave Notes must be started through Electron.';
} else {
  const ctl = new Controller({ ...createDeps(raw), thesaurus: lookupSynonyms });
  (window as unknown as { __cave: Controller }).__cave = ctl; // for debugging and the e2e harness
  render(<App ctl={ctl} />, root);
  void ctl.init();
}
