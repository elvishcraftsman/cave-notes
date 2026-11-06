import type { JSX } from 'preact';
import type { Controller } from '../controller';
import { FloatingMenu, MenuItem } from './Overlays';

/**
 * The right-click menu of a page. One menu serves every place a page is listed: the page tree, the sub-page bar,
 * the search results and the rows of a database view. It is opened with `ctl.openPageMenu` and drawn once, by the App.
 */
export function PageMenuHost({ ctl }: { ctl: Controller }): JSX.Element | null {
  const menu = ctl.pageMenu.value;
  if (!menu) return null;
  const close = (): void => {
    ctl.pageMenu.value = null;
  };
  // run an action on the page after the menu has gone
  const on = (run: (p: string) => void) => (): void => {
    const p = menu.path;
    close();
    run(p);
  };
  if (menu.paths && menu.paths.length > 1) {
    const ps = menu.paths;
    const run = (f: () => void) => (): void => { close(); f(); };
    return (
      <FloatingMenu x={menu.x} y={menu.y} onClose={close}>
        <MenuItem icon="page" label={`${ps.length} pages selected`} onClick={close} />
        <div class="menu-separator" />
        <MenuItem icon="rename" label="Rename…" onClick={run(() => ctl.renamePages(ps))} />
        <MenuItem icon="page" label="Apply Template…" onClick={run(() => void ctl.applyTemplateToPages(ps))} />
        <MenuItem icon="copy" label="Duplicate" onClick={run(() => void ctl.duplicatePages(ps))} />
        <MenuItem icon="back" label="Move to…" onClick={run(() => ctl.openTransfer(ps, 'move'))} />
        <MenuItem icon="copy" label="Copy to…" onClick={run(() => ctl.openTransfer(ps, 'copy'))} />
        <div class="menu-separator" />
        <MenuItem icon="page" label="Clear Selection" onClick={run(() => { ctl.multi.value = []; })} />
        <MenuItem icon="trash" label="Move to Trash…" destructive onClick={run(() => void ctl.deletePages(ps))} />
      </FloatingMenu>
    );
  }
  if (menu.workspace) {
    const w = menu.workspace;
    return (
      <FloatingMenu x={menu.x} y={menu.y} onClose={close}>
        <MenuItem icon="cave" label="Open Workspace" onClick={() => { close(); void ctl.openNestedWorkspace(w); }} />
        <MenuItem icon="page" label="Open in New Tab" onClick={() => { close(); void ctl.openWorkspace(w); }} />
        <div class="menu-separator" />
        <MenuItem icon="trash" label="Stop Using as Workspace…" destructive onClick={() => { close(); void ctl.removeWorkspace(w); }} />
      </FloatingMenu>
    );
  }
  return (
    <FloatingMenu x={menu.x} y={menu.y} onClose={close}>
      <MenuItem icon="plus" label="New Page Inside" onClick={on((p) => void ctl.newPageIn(p))} />
      <MenuItem icon="page" label="Open in New Tab" onClick={on((p) => void ctl.openInNewTab(p))} />
      <MenuItem icon="rename" label="Rename…" shortcut="F2" onClick={on((p) => void ctl.renamePage(p))} />
      <MenuItem icon="gallery" label="Set Icon…" onClick={on((p) => ctl.openPageIcon(p))} />
      <MenuItem icon="page" label="Apply Template…" onClick={on((p) => void ctl.applyTemplate(p))} />
      <MenuItem icon="copy" label="Duplicate" onClick={on((p) => void ctl.duplicatePages([p]))} />
      <MenuItem icon="back" label="Move to…" onClick={on((p) => ctl.openTransfer([p], 'move'))} />
      <MenuItem icon="copy" label="Copy to…" onClick={on((p) => ctl.openTransfer([p], 'copy'))} />
      {menu.path.includes('/') && <MenuItem icon="back" label="Move to Top Level" onClick={on((p) => void ctl.movePage(p, null))} />}
      <div class="menu-separator" />
      {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={on((p) => void ctl.revealPage(p))} />}
      <MenuItem icon="cave" label="Make Workspace…" onClick={on((p) => void ctl.promotePage(p))} />
      <div class="menu-separator" />
      <MenuItem icon="trash" label="Move to Trash" shortcut="Del" destructive onClick={on((p) => void ctl.deletePage(p))} />
    </FloatingMenu>
  );
}

/** The right-click menu of a file that is not a note, in the sub-page bar. */
export function FileMenuHost({ ctl }: { ctl: Controller }): JSX.Element | null {
  const menu = ctl.fileMenu.value;
  if (!menu) return null;
  const close = (): void => {
    ctl.fileMenu.value = null;
  };
  const on = (run: () => void) => (): void => {
    close();
    run();
  };
  return (
    <FloatingMenu x={menu.x} y={menu.y} onClose={close}>
      <MenuItem icon="page" label="Open" onClick={on(() => void ctl.openFolderFile(menu.file))} />
      {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={on(() => void ctl.revealFile(menu.file))} />}
      <div class="menu-separator" />
      <MenuItem icon="rename" label="Set Attributes…" onClick={on(() => ctl.assignFileAttributes(menu.page, menu.file))} />
      <MenuItem icon="page" label="Attributes from Template…" onClick={on(() => void ctl.assignFileFromTemplate(menu.page, menu.file))} />
      <div class="menu-separator" />
      <MenuItem icon="back" label="Move to Top Level" onClick={on(() => void ctl.moveFileInto(menu.file.path, null))} />
    </FloatingMenu>
  );
}
