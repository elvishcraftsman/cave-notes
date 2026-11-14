import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Controller } from '../controller';
import { DialogHost } from './Dialogs';
import { EditorPane } from './EditorPane';
import { narrow, sidebarFit, viewportWidth } from '../layout';
import { HeaderBar } from './HeaderBar';
import { MobileDrawer } from './MobileDrawer';
import { IndexBars } from './IndexBars';
import { Icon } from './icons';
import { BusyHost } from './BusyHost';
import { FileMenuHost, PageMenuHost } from './PageMenu';
import { StatusPage, Toasts } from './Overlays';
import { RightSidebar } from './RightSidebar';
import { SearchPanel } from './SearchPanel';
import { watchScrollShadows } from '../scrollShadows';
import { SidebarToolbar } from './SidebarToolbar';
import { TreeView } from './TreeView';

function Resizer({ ctl, side }: { ctl: Controller; side: 'left' | 'right' }): JSX.Element {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (v: number): number => Math.max(200, Math.min(520, v));
  return (
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize page sidebar' : 'Resize outline sidebar'}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const s = ctl.settings.value;
        drag.current = { x: e.clientX, w: side === 'left' ? s.leftWidth : s.rightWidth };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = side === 'left' ? e.clientX - d.x : d.x - e.clientX;
        const s = ctl.settings.value;
        ctl.settings.value = { ...s, ...(side === 'left' ? { leftWidth: clamp(d.w + delta) } : { rightWidth: clamp(d.w + delta) }) };
      }}
      onPointerUp={() => {
        drag.current = null;
        const s = ctl.settings.value;
        ctl.setWidths(s.leftWidth, s.rightWidth);
      }}
      onKeyDown={(e) => {
        const s = ctl.settings.value;
        const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
        if (!step) return;
        e.preventDefault();
        const d = side === 'left' ? step : -step;
        ctl.setWidths(side === 'left' ? clamp(s.leftWidth + d) : s.leftWidth, side === 'right' ? clamp(s.rightWidth + d) : s.rightWidth);
      }}
    />
  );
}

function Welcome({ ctl }: { ctl: Controller }): JSX.Element {
  const recent = ctl.workspaceChoices();
  return (
    <div class="welcome">
      <StatusPage icon="cave" title="Cave Notes" description="Notes as pages in folders. Open a folder to use as your workspace; every page is a Markdown file and every sub-page lives in a folder of the same name.">
        <button class="pill-button suggested large" onClick={() => void ctl.chooseWorkspace()}>
          Open Folder…
        </button>
        {recent.length > 0 && (
          <div class="recent">
            <h3>Workspaces</h3>
            <div class="recent-list">
              {recent.map((r) => (
                <div key={r} class="recent-item">
                  <button class="recent-row" onClick={() => void ctl.openWorkspace(r)}>
                    <Icon name="cave" />
                    <span class="recent-name">{r.split('/').pop() || r}</span>
                    <span class="recent-path">{r}</span>
                  </button>
                  <button class="icon-button small recent-remove" title="Stop using this folder as a workspace…" aria-label={`Stop using ${r.split('/').pop() || r} as a workspace`} onClick={() => void ctl.removeWorkspace(r)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </StatusPage>
    </div>
  );
}

export function App({ ctl }: { ctl: Controller }): JSX.Element {
  const ws = ctl.workspace.value;
  const s = ctl.settings.value;
  const isNarrow = narrow.value;
  // as columns, only the sidebars that leave the page room; as drawers (a phone) they all stay
  const fit = sidebarFit(viewportWidth.value, s.showLeft, s.showRight, s.leftWidth, s.rightWidth);
  const showLeft = isNarrow ? s.showLeft : fit.left;
  // (a narrow window has no right sidebar: its outline and links are panes of the one drawer)
  const showRight = isNarrow ? false : fit.right;

  useEffect(() => watchScrollShadows(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void ctl.flush();
      }
      // Ctrl+F finds in the page wherever the keyboard is; inside the editor itself its own key does it
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !(e.target as HTMLElement)?.closest?.('.cm-editor, .modal, [role=dialog]') && ctl.findInPage()) {
        e.preventDefault();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        ctl.openSearch();
      }
      if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        ctl.toggleWrapCode();
      }
      if (e.altKey && !mod && e.code === 'KeyW') {
        e.preventDefault();
        ctl.altSwitchStep(e.shiftKey ? -1 : 1);
      }
      if (e.key === 'F6' && !e.altKey && !mod) {
        e.preventDefault();
        ctl.toggleTreeEditorFocus();
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        ctl.cycleTab(e.shiftKey ? -1 : 1);
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement)?.closest?.('input, textarea')) {
        e.preventDefault();
        void ctl.stepHistory(e.key === 'ArrowLeft' ? -1 : 1);
      }
      if (e.key === 'F2' && !(e.target as HTMLElement)?.closest?.('.tree') && ctl.tree.selected) {
        e.preventDefault();
        void ctl.renamePage(ctl.tree.selected);
      }
    };
    // Alt+W keeps cycling while Alt is held; letting go of Alt settles on the tab it reached
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') ctl.altSwitchEnd();
    };
    const onBlur = (): void => ctl.altSwitchEnd();
    // the extra mouse buttons: back and forward, as in a browser
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        void ctl.stepHistory(e.button === 3 ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [ctl]);

  return (
    <div class="window">
      <HeaderBar ctl={ctl} />
      {!ws ? (
        <Welcome ctl={ctl} />
      ) : (
        <div class="panes">
          {isNarrow && s.showLeft && !ctl.activeSingle.value && <div class="scrim" onClick={() => ctl.toggleLeft()} />}
          {showLeft && !ctl.activeSingle.value && (
            <>
              <aside
                class={`sidebar left ${isNarrow ? 'drawer' : ''}`}
                tabIndex={-1}
                onKeyDown={(e) => {
                  // typing anywhere in the pages pane (not only in the tree itself) opens the tree's find box
                  const t = e.target as HTMLElement;
                  if (e.defaultPrevented || ctl.searchOpen.value || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
                  if (t.closest('input, textarea, select, [contenteditable=true], button')) return;
                  e.preventDefault();
                  ctl.openTreeFind(e.key);
                }}
                style={isNarrow ? undefined : { width: `${s.leftWidth}px` }} aria-label={isNarrow ? 'Pages, outline, links and menu' : 'Pages'}>
                {isNarrow ? (
                  <MobileDrawer ctl={ctl} rootKey={ws.root} />
                ) : (
                  <>
                    <SidebarToolbar ctl={ctl} />
                    {ctl.searchOpen.value ? <SearchPanel ctl={ctl} /> : <TreeView key={ws.root} ctl={ctl} />}
                    <IndexBars ctl={ctl} />
                  </>
                )}
              </aside>
              {!isNarrow && <Resizer ctl={ctl} side="left" />}
            </>
          )}
          <main class="content">
            <EditorPane ctl={ctl} />
          </main>
          {showRight && (
            <>
              {!isNarrow && <Resizer ctl={ctl} side="right" />}
              <aside class={`sidebar right ${isNarrow ? 'drawer' : ''}`} style={isNarrow ? undefined : { width: `${s.rightWidth}px` }} aria-label="Outline and links">
                <RightSidebar ctl={ctl} />
              </aside>
            </>
          )}
        </div>
      )}
      <PageMenuHost ctl={ctl} />
      <BusyHost ctl={ctl} />
      <FileMenuHost ctl={ctl} />
      <Toasts ctl={ctl} />
      <DialogHost ctl={ctl} />
    </div>
  );
}
