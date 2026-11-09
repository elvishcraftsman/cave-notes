import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Controller, NewPageMode } from '../controller';
import { Icon } from './icons';
import { FloatingMenu, MenuItem, Popover } from './Overlays';

const MODE_LABEL: Record<NewPageMode, string> = { nested: 'inside the open page', sibling: 'beside the open page', top: 'at the top level' };

/**
 * The top of the page sidebar: a switch between the Files and Search panes (as in the right sidebar), then a bar with
 * New Page, the workspace name and the number of pages. Right-click on the bar for the workspace's own actions.
 */
export function SidebarToolbar({ ctl }: { ctl: Controller }): JSX.Element {
  const [newMenu, setNewMenu] = useState(false);
  const [tplMenu, setTplMenu] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const def = ctl.newPageMode;
  const ref = ctl.current.value?.path ?? ctl.tree.selected;
  const beside = ctl.canAddBeside;
  const ws = ctl.workspace.value;
  const searching = ctl.searchOpen.value;
  const config = ctl.activeConfig.value;
  const docs = ctl.activeDocs.value;
  const showTpl = ctl.showTemplates.value;
  const find = ctl.treeFind.value;
  const findInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find) findInput.current?.focus();
  }, [!!find]);
  const add = (mode: NewPageMode): (() => void) => () => {
    setNewMenu(false);
    void ctl.newPage(mode);
  };
  return (
    <>
      {(!config || docs) && <div class="segmented sidebar-switch" role="tablist" aria-label="Sidebar pane">
        <button role="tab" aria-selected={!searching} class={!searching ? 'on' : ''} onClick={() => ctl.showFiles()}>
          <Icon name="folder" size={14} /> Files
        </button>
        <button role="tab" aria-selected={searching} class={searching ? 'on' : ''} title="Search (Ctrl+Shift+F)" onClick={() => ctl.openSearch()}>
          <Icon name="search" size={14} /> Search
        </button>
      </div>}
      <div
        class={`sidebar-toolbar ${find ? 'finding' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {!config && <button class={`icon-button ${find ? 'active' : ''}`} title="Find a page in the tree (or just type while the tree has focus)" aria-label="Find a page in the tree" aria-pressed={!!find} onClick={() => (find ? ctl.closeTreeFind(false) : ctl.openTreeFind())}>
          <Icon name="search" />
        </button>}
        {find && (
          <input
            ref={findInput}
            class="tree-find-input"
            type="text"
            placeholder="Find a page…"
            aria-label="Find a page in the tree"
            value={find.query}
            onInput={(e) => void ctl.setTreeFind((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); ctl.moveTreeFind(1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); ctl.moveTreeFind(-1); }
              else if (e.key === 'Enter') { e.preventDefault(); ctl.closeTreeFind(true); }
              else if (e.key === 'Escape') { e.preventDefault(); ctl.closeTreeFind(false); }
            }}
          />
        )}
        {find && <span class="tree-find-count">{find.hits.length ? `${find.index + 1}/${find.hits.length}` : find.query.trim() ? '0' : ''}</span>}
        <div class="menu-anchor split">
          <button class="icon-button split-main" title={`New page ${MODE_LABEL[def === 'sibling' && !beside ? 'top' : def]} (Ctrl+N)`} aria-label="New page" onClick={() => void ctl.newPage()}>
            <Icon name="plus" />
          </button>
          <button class={`icon-button split-caret ${newMenu ? 'active' : ''}`} title="Where to put the new page" aria-label="New page options" aria-haspopup="menu" aria-expanded={newMenu} onClick={() => setNewMenu(!newMenu)}>
            <Icon name="chevron-down" size={12} />
          </button>
          <Popover open={newMenu} onClose={() => setNewMenu(false)} align="left">
            <MenuItem icon="plus" label="New Nested Page" shortcut={def === 'nested' ? 'Default' : undefined} disabled={!ref} onClick={add('nested')} />
            {beside && <MenuItem icon="plus" label="New Page Beside This One" shortcut={def === 'sibling' ? 'Default' : undefined} onClick={add('sibling')} />}
            <MenuItem icon="plus" label="New Top-Level Page" shortcut={def === 'top' ? 'Default' : undefined} onClick={add('top')} />
            <div class="menu-separator" />
            <MenuItem icon="canvas" label="New Canvas…" onClick={() => { setNewMenu(false); void ctl.newCanvas(); }} />
            <div class="menu-separator" />
            <MenuItem icon="menu" label="Change the Default…" onClick={() => { setNewMenu(false); ctl.openPreferences(); }} />
          </Popover>
        </div>
        {!config && (
          <div class="menu-anchor split">
            <button
              class={`icon-button split-main ${showTpl ? 'active' : ''}`}
              title={showTpl ? 'Hide unlisted files and templates in the page tree' : 'Show unlisted files and templates in the page tree'}
              aria-label="Show unlisted files and templates"
              aria-pressed={showTpl}
              onClick={() => ctl.toggleTemplates()}
            >
              <Icon name="templates" />
            </button>
            <button class={`icon-button split-caret ${tplMenu ? 'active' : ''}`} title="Templates and workspace settings" aria-label="Templates options" aria-haspopup="menu" aria-expanded={tplMenu} onClick={() => setTplMenu(!tplMenu)}>
              <Icon name="chevron-down" size={12} />
            </button>
            <Popover open={tplMenu} onClose={() => setTplMenu(false)} align="left">
              <MenuItem icon="templates" label={showTpl ? 'Hide Unlisted Files/Templates' : 'Show Unlisted Files/Templates'} onClick={() => { setTplMenu(false); ctl.toggleTemplates(); }} />
              <div class="menu-separator" />
              <MenuItem icon="folder" label="Open Workspace Config Folder" onClick={() => { setTplMenu(false); void ctl.openConfigFolder(); }} />
              {ctl.caps.windows && <MenuItem icon="folder" label="Open App Config Folder (default plugins and templates)" onClick={() => { setTplMenu(false); void ctl.openAppConfigFolder(); }} />}
            </Popover>
          </div>
        )}
        {ws && <span class="ws-name" title={ws.root}>{ws.name}</span>}
        {menu && (
          <FloatingMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
            {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={() => { setMenu(null); void ctl.revealWorkspace(); }} />}
            {!config && <MenuItem icon="star" label="Workspace Preferences…" onClick={() => { setMenu(null); ctl.openWorkspacePreferences(); }} />}
          </FloatingMenu>
        )}
      </div>
    </>
  );
}
