import type { JSX } from 'preact';
import type { Controller } from '../controller';
import { type DrawerPane, drawerPane } from '../layout';
import { MainMenuItems } from './HeaderBar';
import { Icon, type IconName } from './icons';
import { IndexBars } from './IndexBars';
import { Links, Outline } from './RightSidebar';
import { SearchPanel } from './SearchPanel';
import { SidebarToolbar } from './SidebarToolbar';
import { TreeView } from './TreeView';

const PANES: Array<{ id: DrawerPane; label: string; icon: IconName }> = [
  { id: 'pages', label: 'Pages', icon: 'folder' },
  { id: 'outline', label: 'Outline', icon: 'sidebar-right' },
  { id: 'links', label: 'Links', icon: 'globe' },
  { id: 'menu', label: 'Menu', icon: 'menu' },
];

/**
 * The one overlay a narrow window (a phone) has for everything that is a sidebar or a menu on a wide one: the pages (files
 * and search), the outline and links of the open page, and the main menu. Choosing something that leads to the page closes it.
 */
export function MobileDrawer({ ctl, rootKey }: { ctl: Controller; rootKey: string }): JSX.Element {
  const pane = drawerPane.value;
  const config = ctl.activeConfig.value;
  // a canvas has no headings: its tab lists the objects on it
  const onCanvas = !!ctl.canvasView.value && /\.canvas$/i.test(ctl.current.value?.path ?? '');
  const close = (): void => {
    if (ctl.settings.value.showLeft) ctl.toggleLeft();
  };
  /** after what was tapped has had its effect, the drawer goes (unless the tap only changed something inside it) */
  const closeAfter = (e: Event): void => {
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"]')) setTimeout(close, 0);
  };
  const pick = (id: DrawerPane): void => {
    drawerPane.value = id;
    if (id === 'outline' || id === 'links') ctl.setRightTab(id);
  };
  const run = (fn: () => void) => (): void => {
    close();
    fn();
  };
  return (
    <div class="mobile-drawer">
      <div class="drawer-tabs segmented" role="tablist" aria-label="Menu section">
        {PANES.filter((p) => !(config && p.id === 'links')).map((p) => (
          <button key={p.id} role="tab" aria-selected={pane === p.id} class={pane === p.id ? 'on' : ''} onClick={() => pick(p.id)}>
            <Icon name={p.icon} size={16} />
            <span class="drawer-tab-label">{p.id === 'outline' && onCanvas ? 'Objects' : p.label}</span>
          </button>
        ))}
        <button class="drawer-close" aria-label="Close" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {pane === 'pages' && (
        <>
          <SidebarToolbar ctl={ctl} />
          {ctl.searchOpen.value ? <SearchPanel ctl={ctl} /> : <TreeView key={rootKey} ctl={ctl} />}
          <IndexBars ctl={ctl} />
        </>
      )}
      {pane === 'outline' && (
        <div class="right-body drawer-body" onClick={closeAfter}>
          <Outline ctl={ctl} />
        </div>
      )}
      {pane === 'links' && (
        <div class="right-body drawer-body" onClick={closeAfter}>
          <Links ctl={ctl} />
        </div>
      )}
      {pane === 'menu' && (
        <div class="drawer-body drawer-menu" role="menu">
          <MainMenuItems ctl={ctl} run={run} />
        </div>
      )}
    </div>
  );
}
