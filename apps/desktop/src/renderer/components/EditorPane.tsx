import { NoteEditor } from '@cave-notes/editor';
import { frameObserver } from '@cave-notes/editor';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AttributeSource } from '../../shared/api';
import type { Controller } from '../controller';
import { createViewHost } from '../views/ViewBlock';
import { createEmbedHost } from '../views/embedHost';
import { ChildrenBar } from './ChildrenBar';
import { FloatingMenu, MenuItem, StatusPage } from './Overlays';
import { stripExt } from '../paths';
import { Icon, WorkspaceIcon } from './icons';

/** Where an attribute comes from, in words. */
function originLabel(o: AttributeSource['source']): string {
  switch (o.kind) {
    case 'page':
      return 'set on this page';
    case 'children':
      return `from the children: block of ${stripExt(o.page)}`;
    case 'inherited':
      return `handed down by ${stripExt(o.page)}`;
    case 'workspace':
      return 'a workspace-wide attribute';
    default:
      return 'a default (schema or template)';
  }
}

/** The corner mark that lists every attribute of the page and where each one is set. Sits right of the automations mark. */
function AttributeIndicator({ ctl }: { ctl: Controller }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AttributeSource[] | null>(null);
  const cur = ctl.current.value;
  useEffect(() => {
    setOpen(false);
    setList(null);
  }, [cur?.path]);
  useEffect(() => {
    if (!open || !cur?.exists) return;
    let live = true;
    void ctl.ws.attributeSources(cur.path).then((l) => live && setList(l), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [open, cur?.path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest?.('.attribute-indicator')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  if (!cur?.exists) return null;
  return (
    <div class="attribute-indicator">
      <button class={`automation-button ${open ? 'open' : ''}`} title="Attributes of this page" aria-label="Attributes of this page" aria-expanded={open} onClick={() => setOpen(!open)}>
        <WorkspaceIcon name="list" size={15} />
      </button>
      {open && (
        <div class="automation-popover attribute-popover" role="dialog" aria-label="Attributes of this page">
          {list === null ? (
            <p class="attribute-none">Loading…</p>
          ) : list.length === 0 ? (
            <p class="attribute-none">This page has no attributes.</p>
          ) : (
            <table class="attribute-table">
              <tbody>
                {list.map((a) => (
                  <tr key={a.key}>
                    <th scope="row">{a.key}</th>
                    <td class="attribute-value">{a.value === '' ? <em>blank</em> : a.value}</td>
                    <td class="attribute-origin">{originLabel(a.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** The corner mark of a page that meets the criteria of automation rules; a click shows the rules as they are written. */
function AutomationIndicator({ ctl }: { ctl: Controller }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const cur = ctl.current.value;
  const { path, hits } = ctl.automationHits.value;
  useEffect(() => {
    setOpen(false);
    setShown(null);
  }, [cur?.path]);
  useEffect(() => {
    if (!open) setShown(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest?.('.automation-indicator')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  if (!cur?.exists || path !== cur.path || hits.length === 0) return null;
  const label = hits.length === 1 ? `Automation rule “${hits[0]!.name}” applies to this page` : `${hits.length} automation rules apply to this page`;
  return (
    <div class="automation-indicator">
      <button class={`automation-button ${open ? 'open' : ''}`} title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <WorkspaceIcon name="zap" size={15} />
        {hits.length > 1 && <span class="automation-count">{hits.length}</span>}
      </button>
      {open && (
        <div class="automation-popover" role="dialog" aria-label="Automation rules for this page">
          <ul class="automation-list">
            {hits.map((h) => {
              const isOpen = hits.length === 1 || shown === h.id;
              return (
                <li key={h.id} class={isOpen ? 'open' : ''}>
                  <button class="automation-row" aria-expanded={isOpen} onClick={() => setShown(isOpen && hits.length > 1 ? null : h.id)}>
                    <span class="automation-name">{h.name === h.id ? h.id : `${h.name} (${h.id})`}</span>
                    <span class="automation-triggers"> · runs on {h.triggers.join(', ')}</span>
                  </button>
                  {isOpen && <pre>{h.definition}</pre>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EditorPane({ ctl }: { ctl: Controller }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ed = new NoteEditor({
      parent: el,
      onChange: () => ctl.onEditorChange(),
      onOutline: (items) => ctl.setOutline(items),
      onOpenLink: (link, e) => void ctl.followLink(link, e.shiftKey),
      onRunAutomation: (ruleId) => void ctl.runAutomationButton(ruleId),
      ...(ctl.caps.shell ? { codeRun: { run: (req: Parameters<typeof ctl.runCodeBlock>[0]) => ctl.runCodeBlock(req), stop: () => ctl.stopCodeBlock() } } : {}),
      onLinkMenu: (link, e) => ctl.openLinkMenu(link, e),
      onDropFiles: (files, pos) => void ctl.dropFiles(files, pos),
      onDropPage: (path, pos, root) => void ctl.dropPageInEditor(path, pos, root),
      onDropFile: (path, pos, root) => void ctl.dropWorkspaceFileInEditor(path, pos, root),
      onSave: () => void ctl.flush(),
      onLineChange: () => ctl.onEditorLineChange(),
      onBlur: () => ctl.onEditorBlur(),
      spell: ctl.spellHost,
      thesaurus: ctl.thesaurusHost,
      wikilinkCompletions: async (q) => (await ctl.suggest(q)).map((s) => ({ label: s.label, detail: stripExt(s.path) })),
      linkStatus: ctl.wikiStatus,
      resolveAsset: ctl.assetUrl,
      viewBlock: createViewHost(ctl),
      embed: createEmbedHost(ctl),
    });
    ctl.attachEditor(ed);
    const scroller = ed.view.scrollDOM;
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => ctl.updateActiveHeading());
    };
    // "at the bottom" drives the sub-page bar: true when there is nothing further to scroll to
    const measure = (): void => {
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
      if (ctl.atBottom.value !== atEnd) ctl.atBottom.value = atEnd;
      markIndicatorRoom();
    };
    // The automation mark sits at the far right of the editor, beside the scrollbar, whatever the text margins are. Only
    // when the text itself runs close to that edge (a narrow window) does the attributes' info button make room for it.
    const markIndicatorRoom = (): void => {
      const holder = el.parentElement;
      if (!holder) return;
      const bar = scroller.offsetWidth - scroller.clientWidth;
      holder.style.setProperty('--scrollbar-w', `${Math.max(0, bar)}px`);
      const gap = scroller.getBoundingClientRect().right - bar - ed.view.contentDOM.getBoundingClientRect().right;
      holder.classList.toggle('text-near-edge', gap < 40);
    };
    // the children bar lies over the bottom of the editor: tell the editor, so typing scrolls the text above the bar
    const pane = el.parentElement;
    const insetNow = (): void => {
      const bar = pane?.querySelector<HTMLElement>('.children-bar:not(.docked)');
      const inset = pane && bar ? Math.max(0, pane.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) : 0;
      ed.setBottomInset(inset);
    };
    const onScrollAll = (): void => {
      measure();
      onScroll();
      const down = scroller.scrollTop > Math.max(300, scroller.clientHeight * 0.6);
      if (ctl.scrolledDown.value !== down) ctl.scrolledDown.value = down;
    };
    const barWatch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(insetNow);
    const mo = typeof MutationObserver === 'undefined' || !pane ? null : new MutationObserver(() => {
      barWatch?.disconnect();
      const bar = pane.querySelector('.children-bar');
      if (bar) barWatch?.observe(bar);
      barWatch?.observe(pane);
      insetNow();
    });
    mo?.observe(pane!, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (pane) barWatch?.observe(pane);
    insetNow();
    scroller.addEventListener('scroll', onScrollAll, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : frameObserver(measure);
    ro?.observe(scroller);
    ro?.observe(ed.view.contentDOM);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      mo?.disconnect();
      barWatch?.disconnect();
      ro?.disconnect();
      scroller.removeEventListener('scroll', onScrollAll);
      ed.destroy();
    };
  }, [ctl]);

  const cur = ctl.current.value;
  const conflict = ctl.conflict.value;
  const showEditor = !!cur?.exists;
  const menu = ctl.linkMenu.value;
  const closeMenu = (): void => {
    ctl.linkMenu.value = null;
  };

  return (
    <div class={`editor-pane ${showEditor && cur?.exists ? 'has-attributes' : ''} ${showEditor && ctl.automationHits.value.hits.length > 0 && ctl.automationHits.value.path === cur?.path ? 'has-automation' : ''} ${showEditor && ctl.children.value.length > 0 ? 'has-children' : ''} ${ctl.settings.value.childrenDocked ? 'bar-docked' : ''} ${cur && !cur.exists ? 'no-page' : ''}`}>
      {conflict && (
        <div class="banner" role="alert">
          <span>{conflict.diskHash === null ? 'This page was removed from disk, but you have unsaved changes.' : 'This page changed on disk while you were editing it.'}</span>
          <div class="banner-actions">
            {conflict.diskHash !== null && (
              <button class="pill-button" onClick={() => void ctl.resolveConflict('reload')}>
                Load Their Version
              </button>
            )}
            <button class="pill-button" onClick={() => void ctl.resolveConflict('overwrite')}>
              {conflict.diskHash === null ? 'Save Again' : 'Keep Mine'}
            </button>
          </div>
        </div>
      )}

      <div class={`editor-host ${showEditor ? '' : 'hidden'}`} ref={host} />
      <div class="page-indicators">
        <AutomationIndicator ctl={ctl} />
        <AttributeIndicator ctl={ctl} />
      </div>
      {showEditor && ctl.scrolledDown.value && (
        <button class="to-top" title="Back to the top of the page" aria-label="Back to the top of the page" onClick={() => ctl.editor?.scrollToTop()}>
          <Icon name="chevron-up" />
        </button>
      )}

      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {menu.target.kind === 'broken' ? (
            <MenuItem icon="warning" label="Edit Link" onClick={() => { closeMenu(); ctl.editor?.cursorIntoLink(menu.link); }} />
          ) : (
            (() => {
              const t = menu.target;
              return (
                <>
                  <MenuItem icon="page" label="Open" onClick={() => { closeMenu(); void ctl.followLink(menu.link); }} />
                  {t.kind === 'page' && <MenuItem icon="page" label="Open in New Tab" onClick={() => { closeMenu(); void ctl.followLink(menu.link, true); }} />}
                  {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={() => { closeMenu(); void ctl.revealLinkTarget(t); }} />}
                </>
              );
            })()
          )}
        </FloatingMenu>
      )}

      {cur && !ctl.activeSingle.value && <ChildrenBar ctl={ctl} />}

      {!cur && (
        <StatusPage icon="cave" title="Select a Page" description="Choose a page from the sidebar, or create a new one.">
          <button class="pill-button suggested" onClick={() => void ctl.newPageIn(null)}>
            New Page
          </button>
        </StatusPage>
      )}
      {cur && !cur.exists && (
        <StatusPage icon="folder" title={stripExt(cur.path).split('/').pop() ?? ''} description="This is a folder of pages. It does not have a page of its own yet.">
          <button class="pill-button suggested" onClick={() => void ctl.createVirtualPage()}>
            Create Page
          </button>
        </StatusPage>
      )}
    </div>
  );
}
