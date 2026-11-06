import type { JSX } from 'preact';
import { frameObserver } from '@cave-notes/editor';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Controller } from '../controller';
import { Icon } from './icons';
import { stripExt } from '../paths';

/**
 * The sub-pages of the open page, as a bar along the bottom of the editor. It stays a slim strip
 * while there is more page to read, grows into cards once you reach the end, and can be pinned open.
 */
export function ChildrenBar({ ctl }: { ctl: Controller }): JSX.Element | null {
  const [over, setOver] = useState(false); // files from outside are being dragged over the bar
  const bar = useRef<HTMLElement>(null);
  const kids = ctl.children.value;
  const filter = ctl.settings.value.childrenFilter;
  const files = filter === 'all' ? ctl.folderFiles.value : [];
  const hasFiles = ctl.folderFiles.value.length > 0;
  const docked = ctl.settings.value.childrenDocked;
  // a folder without a page of its own has nothing to scroll: its sub-pages are the content, so the bar is open
  const noPage = ctl.current.value?.exists === false;
  const expanded = docked || noPage || ctl.atBottom.value;
  // The slim bar is as tall as its chips (one to three rows): tell the editor, which keeps that much room below it.
  useLayoutEffect(() => {
    const el = bar.current;
    const pane = el?.parentElement;
    if (!el || !pane || expanded) return;
    const apply = (): void => void pane.style.setProperty('--bar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = frameObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, kids.length, files.length, filter]);
  // the system's own icon for each kind of file in the bar
  useEffect(() => {
    for (const f of files) void ctl.ensureFileIcon(f);
  }, [files]);
  const icons = ctl.fileIcons.value;
  // with "Notes" chosen and only other files in the folder the bar stays, or the switch back to "All" would vanish
  if (kids.length === 0 && !hasFiles) return null;
  return (
    <nav
      ref={bar}
      class={`children-bar ${expanded ? 'expanded' : ''} ${docked || noPage ? 'docked' : ''} ${over ? 'drop-over' : ''}`}
      aria-label="Sub-pages"
      data-expanded={expanded}
      onDragOver={(e) => { const t = e.dataTransfer?.types; if (!t || !(t.includes('Files') || t.includes('application/x-cave-file') || t.includes('application/x-cave-page'))) return; e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        const here = ctl.current.value?.path ?? null;
        const file = e.dataTransfer?.getData('application/x-cave-file');
        const page = e.dataTransfer?.getData('application/x-cave-page');
        if (file) { e.preventDefault(); void ctl.moveFileInto(file, here); return; }
        const from = e.dataTransfer?.getData('application/x-cave-workspace');
        if (page && from && from !== ctl.activeRoot()) { e.preventDefault(); ctl.toast('That page is in another workspace. Drop it into the text of a page to link to it.'); return; }
        if (page && here && page !== here) { e.preventDefault(); if (ctl.dragPaths.length > 1) { const ps = ctl.dragPaths; ctl.dragPaths = []; void ctl.movePagesTo(ps, here); } else void ctl.movePage(page, here); return; }
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        void ctl.dropExternal([...e.dataTransfer.files], ctl.current.value?.path ?? null);
      }}
    >
      <div class="children-head">
        <span class="children-label">
          {filter === 'all' ? 'Files' : 'Sub-pages'} <span class="count">{kids.length + files.length}</span>
        </span>
        {hasFiles && (
          <span class="segmented children-filter" role="group" aria-label="Show in this bar">
            <button class={filter === 'notes' ? 'on' : ''} aria-pressed={filter === 'notes'} title="Only notes" onClick={() => ctl.setChildrenFilter('notes')}>Notes</button>
            <button class={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} title="Every file in the folder" onClick={() => ctl.setChildrenFilter('all')}>All</button>
          </span>
        )}
        <button
          class={`icon-button small ${docked ? 'active' : ''}`}
          aria-pressed={docked}
          title={docked ? 'Unpin the sub-page bar' : 'Keep the sub-page bar open'}
          aria-label={docked ? 'Unpin the sub-page bar' : 'Keep the sub-page bar open'}
          onClick={() => ctl.toggleChildrenDock()}
        >
          <Icon name="pin" size={13} />
        </button>
      </div>
      <div class="children-list">
        {kids.map((k) => (
          <button key={k.path} class={`child ${k.exists ? '' : 'virtual'} ${ctl.multi.value.includes(k.path) ? 'multi' : ''}`} draggable onDragStart={(e) => { e.dataTransfer?.setData('application/x-cave-page', k.path); e.dataTransfer?.setData('application/x-cave-workspace', ctl.activeRoot() ?? ''); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'all'; ctl.dragPaths = ctl.multi.value.length > 1 && ctl.multi.value.includes(k.path) ? ctl.multi.value : []; }} onDragEnd={() => { ctl.dragPaths = []; }} title={stripExt(k.path)} onClick={(e) => { if (ctl.selectWith(k.path, kids.map((x) => x.path), { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) return; void ctl.openPage(k.path, { reveal: true }); }} onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); void ctl.openInNewTab(k.path); }} onContextMenu={(e) => { if (ctl.multi.value.length > 1 && ctl.multi.value.includes(k.path)) ctl.openPagesMenu(e, ctl.multi.value); else ctl.openPageMenu(e, k.path); }}>
            <Icon name={k.exists ? 'page' : 'folder'} size={14} class="child-icon" />
            <span class="child-name">{k.name}</span>
            {k.hasChildren && <Icon name="chevron" size={11} class="child-more" />}
          </button>
        ))}
        {files.map((f) => (
          <button key={f.path} class="child file" title={`${f.path} — opens in another program`} onClick={() => void ctl.openFolderFile(f)} draggable onDragStart={(e) => { e.dataTransfer?.setData('application/x-cave-file', f.path); e.dataTransfer?.setData('application/x-cave-workspace', ctl.activeRoot() ?? ''); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'all'; }} onContextMenu={(e) => ctl.openFileMenu(e, f)}>
            {icons[(/\.([^./]+)$/.exec(f.name)?.[1] ?? '').toLowerCase()] ? <img class="child-icon os-icon" src={icons[(/\.([^./]+)$/.exec(f.name)?.[1] ?? '').toLowerCase()]} width={16} height={16} alt="" draggable={false} /> : <Icon name="file" size={14} class="child-icon" />}
            <span class="child-name">{f.name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
