import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PluginInfo } from '../../shared/api';
import type { Controller } from '../controller';
import { MenuItem } from './Overlays';

/** The words on a plugin's menu line. */
function pluginLabel(ctl: Controller, p: PluginInfo): string {
  return p.pending ? `${p.label} (from ${p.pending.name}: asks first)` : ctl.isPluginOff(p) ? `${p.label} (off: click to turn on)` : p.label;
}

/** Does the text of the search box match a plugin? Every word of it must be in the name. */
export function pluginMatches(p: PluginInfo, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.label} ${p.id}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * The inside of the Plugins menu: a search box, the plugins you wrote (and those other workspaces offer), a line, then the
 * ones that come with the app by name, and a button for the window that lists them all.
 */
export function PluginsMenu({ ctl, close }: { ctl: Controller; close: () => void }): JSX.Element {
  const [q, setQ] = useState('');
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const all = ctl.plugins.value;
  const shown = all.filter((p) => pluginMatches(p, q));
  const mine = shown.filter((p) => p.origin !== 'default');
  const shipped = shown.filter((p) => p.origin === 'default');
  const run = (p: PluginInfo): void => {
    close();
    void ctl.runPlugin(p);
  };
  const item = (p: PluginInfo): JSX.Element => <MenuItem key={p.id} icon={ctl.isPluginOff(p) ? 'zap-off' : 'zap'} label={pluginLabel(ctl, p)} onClick={() => run(p)} />;
  return (
    <div class="plugins-menu">
      <input
        ref={box}
        class="plugin-search"
        type="search"
        placeholder="Search plugins"
        aria-label="Search plugins"
        value={q}
        onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown[0]) {
            e.preventDefault();
            run(shown[0]);
          } else if (e.key === 'Escape') {
            close();
          }
        }}
      />
      <div class="plugin-items" role="group" aria-label="Plugins">
        {mine.map(item)}
        {mine.length > 0 && shipped.length > 0 && <div class="menu-separator" />}
        {shipped.map(item)}
        {shown.length === 0 && <div class="plugin-none">{all.length === 0 ? 'No plugins yet.' : 'No plugin matches.'}</div>}
      </div>
      <div class="menu-separator" />
      <MenuItem icon="list" label="All plugins…" onClick={() => { close(); void ctl.openPluginsDialog(); }} />
    </div>
  );
}
