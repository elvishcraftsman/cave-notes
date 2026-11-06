import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Controller, IndexBar } from '../controller';

const PHASES: Record<string, string> = { scan: 'Scanning folders', parse: 'Reading notes', finish: 'Linking and listing files', ready: 'Up to date' };

const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const weight = (b: IndexBar): number => Math.max(1, b.index.pages + (b.index.files ?? 0));

/**
 * At the bottom of the page pane: one thin bar for each workspace that is being indexed (the one in front first), side by
 * side in a single row that always fits the pane: the bars share its width (by the size of their workspaces) and shrink
 * with it, never wrapping onto a second line. Each bar fills as its index progresses and is as long as its workspace is big
 * compared with the biggest one. A click on a bar says which workspace it is and how much it holds.
 */
export function IndexBars({ ctl }: { ctl: Controller }): JSX.Element | null {
  const [picked, setPicked] = useState<string | null>(null);
  const bars = ctl.indexBars();
  if (bars.length === 0) return null;
  const biggest = Math.max(...bars.map(weight));
  const shown = bars.find((b) => b.root === picked) ?? null;
  return (
    <div class="index-bars" aria-label="Indexing">
      {shown && <BarDetail bar={shown} onClose={() => setPicked(null)} />}
      <div class="index-bar-row">
        {bars.map((b) => {
          const busy = b.index.state === 'indexing';
          const pct = busy ? Math.max(0, Math.min(99, b.index.percent ?? 0)) : 100;
          const share = Math.max(14, Math.round((weight(b) / biggest) * 100));
          return (
            <button
              key={b.root}
              class={`index-bar-item ${busy ? 'busy' : 'ready'} ${b.front ? 'front' : ''} ${picked === b.root ? 'picked' : ''}`}
              style={{ flex: `${share} 1 0`, ...(b.color ? { '--bar-color': b.color } : {}) }}
              title={`${b.name}: ${busy ? `${pct}%` : 'up to date'}`}
              aria-label={`${b.name}, ${busy ? `indexing ${pct}%` : 'up to date'}`}
              aria-pressed={picked === b.root}
              onClick={() => setPicked(picked === b.root ? null : b.root)}
            >
              <span class="index-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <span class="index-bar-fill" style={{ width: `${pct}%` }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BarDetail({ bar, onClose }: { bar: IndexBar; onClose: () => void }): JSX.Element {
  const busy = bar.index.state === 'indexing';
  const pct = busy ? Math.max(0, Math.min(99, bar.index.percent ?? 0)) : 100;
  return (
    <div class="index-bar-detail" role="status">
      <div class="index-bar-detail-head">
        <strong title={bar.root}>{bar.name}</strong>
        <button class="icon-button small" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div class="index-bar-detail-line">{busy ? `Indexing: ${PHASES[bar.index.phase ?? 'parse'] ?? 'working'}, ${pct}%` : 'Index is up to date'}</div>
      <div class="index-bar-detail-line">
        {plural(bar.index.pages, 'page')}
        {bar.index.files !== undefined ? `, ${plural(bar.index.files, 'file')}` : ''}
        {busy ? ' so far' : ''}
      </div>
      <div class="index-bar-detail-path">{bar.root}</div>
    </div>
  );
}
