import type { ComponentChildren, JSX } from 'preact';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Controller } from '../controller';
import { Icon } from './icons';

/**
 * Draws its children directly under <body>, outside whatever contains the component. (preact/compat's createPortal
 * would do, but importing compat changes how every input's onChange behaves, so this does it with plain preact.)
 */
function Portal({ children }: { children: ComponentChildren }): null {
  const host = useRef<HTMLDivElement | null>(null);
  if (!host.current) host.current = document.createElement('div');
  useLayoutEffect(() => {
    const el = host.current!;
    document.body.appendChild(el);
    return () => {
      render(null, el);
      el.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(<>{children}</>, host.current!);
  });
  return null;
}

/**
 * A menu at a screen position (a context menu, or one hanging under a button). It is drawn on the page itself rather
 * than inside whatever opened it, so a scrolling or clipping parent (the tab strip) cannot cut it off or scroll when
 * it opens, and it is clear of the header's window-drag area so it can be clicked. It stays inside the window.
 * Clicks on `ignore` (the button that opened it) do not count as clicks outside, so that button can close it again.
 */
export function FloatingMenu({ x, y, onClose, children, ignore }: { x: number; y: number; onClose: () => void; children: ComponentChildren; ignore?: HTMLElement | null }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, ignore]);
  return (
    <Portal>
      <div class="popover floating" role="menu" ref={ref} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
        {children}
      </div>
    </Portal>
  );
}

/** A small popover menu anchored to a button (its parent holds both). Closes on outside click or Escape, and the button toggles it. */
export function Popover({ open, onClose, children, align = 'right' }: { open: boolean; onClose: () => void; children: ComponentChildren; align?: 'left' | 'right' }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!ref.current || ref.current.contains(t)) return;
      // The button that opened the menu sits beside it in the same anchor. Its own click toggles the menu, so a press on it
      // must not count as a click outside: closing here as well would let that click open the menu again at once.
      if (ref.current.parentElement?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div class={`popover ${align}`} role="menu" ref={ref}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, label, shortcut, onClick, disabled, destructive }: { icon?: Parameters<typeof Icon>[0]['name']; label: string; shortcut?: string; onClick: () => void; disabled?: boolean; destructive?: boolean }): JSX.Element {
  return (
    <button class={`menu-item ${destructive ? 'destructive' : ''}`} role="menuitem" disabled={disabled} onClick={onClick}>
      <span class="menu-icon">{icon && <Icon name={icon} />}</span>
      <span class="menu-label">{label}</span>
      {shortcut && <span class="menu-shortcut">{shortcut}</span>}
    </button>
  );
}

export function Toasts({ ctl }: { ctl: Controller }): JSX.Element {
  return (
    <div class="toasts" aria-live="polite">
      {ctl.toasts.value.map((t) => (
        <div class="toast" key={t.id} role="status">
          <span>{t.text}</span>
          {t.action && (
            <button
              class="toast-action"
              onClick={() => {
                t.action?.run();
                ctl.dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button class="toast-close" aria-label="Dismiss" onClick={() => ctl.dismissToast(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Adwaita-style status page: a big symbolic icon, a title, a description and actions. */
export function StatusPage({ icon, title, description, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; description?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <div class="status-page">
      <Icon name={icon} size={96} class="status-icon" />
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
