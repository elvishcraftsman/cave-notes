import type { JSX } from 'preact';
import type { Controller } from '../controller';

/** A small dialog with a progress circle, while something keeps the window busy (see `Controller.withBusy`). */
export function BusyHost({ ctl }: { ctl: Controller }): JSX.Element | null {
  const b = ctl.busy.value;
  if (!b) return null;
  const R = 22;
  const C = 2 * Math.PI * R;
  const known = b.fraction !== null;
  const pct = known ? Math.round(Math.max(0, Math.min(1, b.fraction!)) * 100) : null;
  return (
    <div class="busy-overlay" role="alertdialog" aria-modal="true" aria-label={b.label} aria-live="polite">
      <div class="busy-card">
        <svg class={`busy-ring ${known ? '' : 'indeterminate'}`} width="56" height="56" viewBox="0 0 56 56" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <circle class="busy-track" cx="28" cy="28" r={R} fill="none" stroke-width="5" />
          <circle class="busy-arc" cx="28" cy="28" r={R} fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray={`${known ? C * (pct! / 100) : C * 0.28} ${C}`} transform="rotate(-90 28 28)" />
        </svg>
        <div class="busy-text">
          <div class="busy-label">{b.label}</div>
          {pct !== null && <div class="busy-pct">{pct}%</div>}
        </div>
      </div>
    </div>
  );
}
