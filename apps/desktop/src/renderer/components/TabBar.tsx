import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Controller, Tab } from '../controller';
import { tabVars } from '../color';
import { Icon, WorkspaceIcon, isIconName } from './icons';
import { FloatingMenu, MenuItem } from './Overlays';
import { stripExt } from '../paths';
import { narrow } from '../layout';

const base = (p: string): string => stripExt(p).split('/').pop() ?? p;

const STATUS: Record<string, string> = { saved: 'Saved', saving: 'Saving…', dirty: 'Unsaved changes', conflict: 'Conflict: changed on disk' };

/** Dropped this far below the header (or outside the window), a dragged tab leaves for a window of its own. */
const TEAR_OFF_BELOW = 70;

/** The tabs in the title bar, like a browser's: all the same width, the shown one lifted. */
export function TabBar({ ctl }: { ctl: Controller }): JSX.Element {
  const tabs = ctl.tabs.value;
  const activeId = ctl.activeTabId.value;
  const looks = ctl.looks.value;
  const cur = ctl.current.value;
  const status = ctl.saveState.value;
  const recent = ctl.workspaceChoices();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [plus, setPlus] = useState<{ x: number; y: number } | null>(null);
  const plusButton = useRef<HTMLButtonElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  if (tabs.length === 0) {
    return (
      <div class="tabbar empty">
        <span class="title">Cave Notes</span>
      </div>
    );
  }

  const title = (t: Tab): string => (t.path ? base(t.path) : (ctl.nameOf(t.root) ?? 'Workspace'));
  const tip = (t: Tab, active: boolean): string => {
    const where = t.path ? `${ctl.nameOf(t.root) ?? ''} · ${t.path}` : (ctl.nameOf(t.root) ?? '');
    return active && cur?.exists && status !== 'saved' ? `${where}\n${STATUS[status] ?? status}` : where;
  };

  if (narrow.value) return <PhoneTabs ctl={ctl} title={title} />;

  return (
    <div
      class={`tabbar ${dragId ? 'dragging' : ''}`}
      role="tablist"
      aria-label="Open pages"
      onWheel={(e) => {
        // the mouse wheel scrolls a strip that has more tabs than fit
        const el = e.currentTarget as HTMLElement;
        if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
      }}
      onDragOver={(e) => {
        if (dragId && e.target === e.currentTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!dragId || e.target !== e.currentTarget) return;
        e.preventDefault();
        ctl.moveTab(dragId, tabs.length);
        setDragId(null);
        setOverId(null);
      }}
    >
      {tabs.map((t) => {
        const look = looks[t.root];
        const accent = ctl.accentOf(t.root);
        const active = t.id === activeId;
        const icon = look?.icon && isIconName(look.icon) ? look.icon : null;
        const unsaved = active && cur?.exists && status !== 'saved';
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            class={`tab ${active ? 'active' : ''} ${accent ? 'has-accent' : ''} ${overId === t.id && dragId !== t.id ? 'drag-over' : ''}`}
            style={tabVars(ctl.theme.value, accent, active)}
            title={tip(t, active)}
            draggable
            onClick={() => void ctl.activateTab(t.id)}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              void ctl.closeTab(t.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setPlus(null);
              setMenu({ x: e.clientX, y: e.clientY, id: t.id });
            }}
            onDragStart={(e) => {
              setDragId(t.id);
              e.dataTransfer?.setData('application/x-cave-tab', t.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={(e) => {
              const out = e.dataTransfer?.dropEffect === 'none' && (e.clientY > TEAR_OFF_BELOW || e.clientY < -8 || e.clientX < 0 || e.clientX > window.innerWidth);
              setDragId(null);
              setOverId(null);
              if (out && ctl.caps.windows) void ctl.tearOffTab(t.id, e.screenX, e.screenY);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(t.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== t.id) ctl.moveTab(dragId, tabs.findIndex((x) => x.id === t.id));
              setDragId(null);
              setOverId(null);
            }}
          >
            {icon && <WorkspaceIcon name={icon} size={15} class="tab-icon" />}
            <span class="tab-title">{title(t)}</span>
            {unsaved && <span class={`tab-state ${status}`} aria-label={STATUS[status] ?? status} />}
            <button
              class="tab-close"
              tabIndex={-1}
              aria-label={`Close ${title(t)}`}
              title="Close tab (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                void ctl.closeTab(t.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
      <button
        ref={plusButton}
        class={`icon-button small tab-plus ${plus ? 'active' : ''}`}
        title="New tab (Ctrl+T)"
        aria-label="New tab"
        aria-haspopup="menu"
        aria-expanded={!!plus}
        onClick={(e) => {
          if (plus) {
            setPlus(null);
            return;
          }
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu(null);
          setPlus({ x: r.left, y: r.bottom + 6 });
        }}
      >
        <Icon name="plus" size={15} />
      </button>

      {plus && (
        <FloatingMenu x={plus.x} y={plus.y} onClose={() => setPlus(null)} ignore={plusButton.current}>
          <MenuItem icon="page" label="Duplicate This Tab" shortcut="Ctrl+T" onClick={() => { setPlus(null); void ctl.newTab(); }} />
          <MenuItem icon="folder" label="Open Folder in New Tab…" onClick={() => { setPlus(null); void ctl.chooseWorkspace(); }} />
          {recent.filter((r) => !tabs.some((t) => t.root === r)).slice(0, 8).map((r) => (
            <MenuItem key={r} icon="cave" workspaceIcon={ctl.iconOf(r)} label={r.split('/').pop() || r} onClick={() => { setPlus(null); void ctl.openWorkspace(r); }} />
          ))}
        </FloatingMenu>
      )}

      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem icon="close" label="Close Tab" shortcut="Ctrl+W" onClick={() => { const id = menu.id; setMenu(null); void ctl.closeTab(id); }} />
          <MenuItem icon="close" label="Close Other Tabs" disabled={tabs.length < 2} onClick={() => { const id = menu.id; setMenu(null); void ctl.closeOtherTabs(id); }} />
          {ctl.caps.windows && <MenuItem icon="page" label="Move to New Window" disabled={tabs.length < 2} onClick={() => { const id = menu.id; setMenu(null); void ctl.tearOffTab(id); }} />}
          {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={() => { const id = menu.id; setMenu(null); void ctl.revealTab(id); }} />}
          <div class="menu-separator" />
          <MenuItem icon="trash" label="Stop Using as Workspace…" destructive disabled={!!tabs.find((x) => x.id === menu.id)?.single || ctl.isConfigRoot(tabs.find((x) => x.id === menu.id)?.root ?? '')} onClick={() => { const t = tabs.find((x) => x.id === menu.id); setMenu(null); if (t) void ctl.removeWorkspace(t.root); }} />
        </FloatingMenu>
      )}
    </div>
  );
}

/**
 * Tabs on a narrow screen, as on Chrome for Android: the bar shows the page that is open and a button with the number of tabs,
 * and that button opens all the tabs as cards to choose from, close or add to.
 */
function PhoneTabs({ ctl, title }: { ctl: Controller; title: (t: Tab) => string }): JSX.Element {
  const tabs = ctl.tabs.value;
  const activeId = ctl.activeTabId.value;
  const [open, setOpen] = useState(false);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  return (
    <div class="tabbar phone-tabs">
      <span class="phone-tab-title">{active ? title(active) : 'Cave Notes'}</span>
      <button class="phone-tab-count" aria-label={`${tabs.length} open tabs. Show all`} title="All tabs" onClick={() => setOpen(true)}>
        <span>{tabs.length > 99 ? ':D' : tabs.length}</span>
      </button>
      {open && <TabSwitcher ctl={ctl} title={title} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TabSwitcher({ ctl, title, onClose }: { ctl: Controller; title: (t: Tab) => string; onClose: () => void }): JSX.Element {
  const tabs = ctl.tabs.value;
  const activeId = ctl.activeTabId.value;
  const looks = ctl.looks.value;
  const recent = ctl.workspaceChoices().filter((r) => !tabs.some((t) => t.root === r)).slice(0, 6);
  return (
    <div class="tab-switcher" role="dialog" aria-label="Open tabs">
      <div class="tab-switcher-head">
        <button class="icon-button" aria-label="Back to the page" onClick={onClose}><Icon name="close" size={18} /></button>
        <strong>{tabs.length === 1 ? '1 tab' : `${tabs.length} tabs`}</strong>
        <span class="tab-switcher-actions">
          <button class="pill-button suggested" onClick={() => { onClose(); void ctl.newTab(); }}>New tab</button>
        </span>
      </div>
      <div class="tab-cards">
        {tabs.map((t) => {
          const look = looks[t.root];
          const icon = look?.icon && isIconName(look.icon) ? look.icon : null;
          const accent = ctl.accentOf(t.root);
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              class={`tab-card ${isActive ? 'active' : ''} ${accent ? 'has-accent' : ''}`}
              style={tabVars(ctl.theme.value, accent, true)}
              role="button"
              tabIndex={0}
              onClick={() => { onClose(); void ctl.activateTab(t.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onClose(); void ctl.activateTab(t.id); } }}
            >
              <div class="tab-card-head">
                {icon && <WorkspaceIcon name={icon} size={15} class="tab-icon" />}
                <span class="tab-card-title">{title(t)}</span>
                <button class="tab-close" aria-label={`Close ${title(t)}`} onClick={(e) => { e.stopPropagation(); void ctl.closeTab(t.id); if (tabs.length <= 1) onClose(); }}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div class="tab-card-body">
                <span class="tab-card-ws">{ctl.nameOf(t.root) ?? ''}</span>
                <span class="tab-card-path">{t.path ? stripExt(t.path) : 'Workspace'}</span>
              </div>
            </div>
          );
        })}
      </div>
      {recent.length > 0 && (
        <div class="tab-switcher-more">
          <span class="pref-hint">Open another workspace</span>
          {recent.map((r) => <button key={r} class="pill-button" onClick={() => { onClose(); void ctl.openWorkspace(r); }}>{r.split('/').pop() || r}</button>)}
        </div>
      )}
    </div>
  );
}
