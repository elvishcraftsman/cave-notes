import { PluginsMenu } from './PluginsMenu';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Controller } from '../controller';
import { Icon } from './icons';
import { narrow, drawerPane } from '../layout';
import { MenuItem, Popover } from './Overlays';
import { TabBar } from './TabBar';

const ws0 = (ctl: Controller): string => ctl.workspace.value?.root ?? '';

export function HeaderBar({ ctl }: { ctl: Controller }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const [plug, setPlug] = useState(false);
  const [pres, setPres] = useState(false);
  const plugins = ctl.plugins.value;
  const root = ws0(ctl);
  useEffect(() => {
    void ctl.refreshPlugins();
  }, [root]);
  const s = ctl.settings.value;
  const ws = ctl.workspace.value;
  const single = ctl.activeSingle.value;
  const close = (): void => setMenu(false);
  // a narrow window has one drawer for the pages, the outline, the links and the menu (a single page has no drawer)
  const drawer = narrow.value && !!ws && !single;
  const run = (fn: () => void) => (): void => {
    close();
    fn();
  };

  return (
    <header class={`headerbar ${ctl.headerColor.value ? 'tinted' : ''}`} style={ctl.headerColor.value ? { '--headerbar-bg': ctl.headerColor.value } : undefined}>
      <div class="headerbar-inner">
        <div class="hb-group">
          {ctl.caps.keyboardAndMouse && (
            <div class="nav-buttons">
            <button class="icon-button" title="Back in this tab (Alt+Left)" aria-label="Back" disabled={!ctl.canGoBack.value} onClick={() => void ctl.stepHistory(-1)}>
              <Icon name="chevron" class="flip" />
            </button>
            <button class="icon-button" title="Forward in this tab (Alt+Right)" aria-label="Forward" disabled={!ctl.canGoForward.value} onClick={() => void ctl.stepHistory(1)}>
              <Icon name="chevron" />
            </button>
          </div>
          )}
          {ws && !single && (
            <>
              <button class={`icon-button ${s.showLeft ? 'active' : ''}`} title={drawer ? 'Pages, outline, links and menu' : 'Pages (F9)'} aria-label={drawer ? 'Open the menu' : 'Toggle page sidebar'} aria-pressed={s.showLeft} onClick={() => { if (drawer && !s.showLeft) drawerPane.value = 'pages'; ctl.toggleLeft(); }}>
                <Icon name={drawer ? 'menu' : 'sidebar-left'} />
              </button>
            </>
          )}
        </div>

        <TabBar ctl={ctl} />

        <div class="hb-group right">
          {ws && !drawer && (
            <button class={`icon-button ${s.showRight ? 'active' : ''}`} title="Outline and links (Shift+F9)" aria-label="Toggle outline sidebar" aria-pressed={s.showRight} onClick={() => ctl.toggleRight()}>
              <Icon name="sidebar-right" />
            </button>
          )}
          {ws && ctl.presentationTheme.value && <div class="menu-anchor">
            <button class={`icon-button ${pres ? 'active' : ''}`} title="Present this page as slides" aria-label="Present" aria-haspopup="menu" aria-expanded={pres} onClick={() => setPres(!pres)}>
              <Icon name="presentation" />
            </button>
            <Popover open={pres} onClose={() => setPres(false)}>
              <MenuItem icon="presentation" label="Preview slides…" onClick={() => { setPres(false); ctl.openPresentation(false); }} />
              {ctl.caps.windows && <MenuItem icon="maximize" label="Present full screen" onClick={() => { setPres(false); ctl.openPresentation(true); }} />}
              {ctl.caps.exportDocuments && <MenuItem icon="file-down" label="Export as PDF…" onClick={() => { setPres(false); void ctl.exportPresentation('pdf'); }} />}
              {ctl.caps.exportDocuments && <MenuItem icon="file-code" label="Export as HTML…" onClick={() => { setPres(false); void ctl.exportPresentation('html'); }} />}
            </Popover>
          </div>}
          {ws && !ctl.activeSingle.value && (plugins.length > 0 || ctl.workspace.value) && <div class="menu-anchor">
            <button class={`icon-button ${plug ? 'active' : ''}`} title="Plugins: rules that change the selected text" aria-label="Plugins" aria-haspopup="menu" aria-expanded={plug} onClick={() => { if (!plug) void ctl.refreshPlugins(); setPlug(!plug); }}>
              <Icon name="zap" />
            </button>
            <Popover open={plug} onClose={() => setPlug(false)}>
              <PluginsMenu ctl={ctl} close={() => setPlug(false)} />
            </Popover>
          </div>}
          {!drawer && <div class="menu-anchor">
            <button class={`icon-button ${menu ? 'active' : ''}`} title="Main menu" aria-label="Main menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Icon name="menu" />
            </button>
            <Popover open={menu} onClose={close}>
              <MainMenuItems ctl={ctl} run={run} />
            </Popover>
          </div>}
        </div>
      </div>
    </header>
  );
}

/** The entries of the main menu: in the pop-up of the header bar, and as a pane of the drawer in a narrow window. */
export function MainMenuItems({ ctl, run }: { ctl: Controller; run: (fn: () => void) => () => void }): JSX.Element {
  const ws = ctl.workspace.value;
  const single = ctl.activeSingle.value;
  return (
    <>
      <MenuToolbar ctl={ctl} run={run} />
      <MenuItem icon="folder" label="Open Folder…" shortcut="Ctrl+O" onClick={run(() => void ctl.chooseWorkspace())} />
      {ctl.workspaceChoices().filter((r) => r !== ws?.root).slice(0, 8).map((r) => (
        <MenuItem key={r} icon="cave" label={r.split('/').pop() || r} onClick={run(() => void ctl.openWorkspace(r))} />
      ))}
      <div class="menu-separator" />
      <MenuItem icon="menu" label="Preferences…" shortcut="Ctrl+," onClick={run(() => ctl.openPreferences())} />
      {ws && ctl.caps.exportDocuments && ctl.current.value?.exists && <MenuItem icon="page" label="Export Page…" shortcut="Ctrl+Shift+E" onClick={run(() => ctl.openExport())} />}
      {ws && ctl.current.value?.exists && ctl.saved.value.queries.slice(0, 8).map((x) => (
        <MenuItem key={`saved-${x.name}`} icon="table" label={`Insert “${x.title ?? x.name}”`} onClick={run(() => ctl.insertSavedQuery(x.name))} />
      ))}
      {ws && !single && <MenuItem icon="undo" label="Undo Last Move or Rename" disabled={!ctl.lastMoveAvailable.value} onClick={run(() => void ctl.undoMove())} />}
      <div class="menu-separator" />
      <MenuItem icon="help" label="Help" shortcut="F1" onClick={run(() => ctl.openHelp('docs'))} />
    </>
  );
}

/** A row of icon buttons at the top of the main menu: undo and redo in the text, and the page's history. */
function MenuToolbar({ ctl, run }: { ctl: Controller; run: (fn: () => void) => () => void }): JSX.Element | null {
  const ws = ctl.workspace.value;
  const ed = ctl.editor;
  const page = !!ws && !!ctl.current.value?.exists;
  if (!page) return null;
  return (
    <>
      <div class="menu-toolbar" role="group" aria-label="Edit">
        <button type="button" class="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!ed || !ed.canUndo()} onClick={run(() => void ed?.undo())}>
          <Icon name="undo" />
        </button>
        <button type="button" class="icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!ed || !ed.canRedo()} onClick={run(() => void ed?.redo())}>
          <Icon name="redo" />
        </button>
        <button type="button" class="icon-button" title="Page History…" aria-label="Page History" onClick={run(() => ctl.openHistory())}>
          <Icon name="history" />
        </button>
      </div>
      <div class="menu-separator" />
    </>
  );
}
