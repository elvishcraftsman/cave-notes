import type { JSX } from 'preact';
import { frameObserver } from '@cave-notes/editor';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DropPlan, DropZone } from '@cave-notes/ui-tree';
import type { Controller } from '../controller';
import type { TreeRow } from '@cave-notes/ui-tree';
import { coarse, narrow } from '../layout';
import { Icon, WorkspaceIcon, isIconName } from './icons';

/** row height in px: taller for a finger (the virtual list and the drop zones both measure with it) */
const ROW_H = coarse ? 44 : 34;
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'F2', 'Delete']);


export function TreeView({ ctl }: { ctl: Controller }): JSX.Element {
  void ctl.treeTick.value; // re-render when the tree changes
  const find = ctl.treeFind.value;
  const hitSet = new Set(find?.hits ?? []);
  const currentHit = find?.hits[find.index];
  const tree = ctl.tree;
  const rows = tree.rows;
  const selected = tree.selected;
  const ref = useRef<HTMLDivElement>(null);
  const dragSrc = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  /** where the dragged page would land, once the pointer is over a place it may go */
  const [drop, setDrop] = useState<{ index: number; zone: DropZone | 'end'; depth: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = frameObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // A drag that ends anywhere (or never really starts) must not leave the tree "busy".
  useEffect(() => {
    const clear = (): void => {
      dragSrc.current = null;
      ctl.dragging = false;
      setDrop(null);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('mouseup', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('mouseup', clear);
    };
  }, [ctl]);

  // Keep the selected row in view (keyboard navigation).
  useEffect(() => {
    const el = ref.current;
    const i = tree.indexOf(selected);
    if (!el || i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selected, rows.length]);

  const onKeyDown = async (e: KeyboardEvent): Promise<void> => {
    if (e.altKey || e.metaKey) return;
    // typing while the tree has focus opens the find box with what was typed
    if (e.key.length === 1 && !e.ctrlKey && e.key !== ' ') {
      e.preventDefault();
      ctl.openTreeFind(e.key);
      return;
    }
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const action = await tree.handleKey(e.key, { ctrl: e.ctrlKey, shift: e.shiftKey });
    if (!action) return;
    if (action.type === 'open') ctl.openSoon(action.path, 90, false);
    else void ctl.onTreeAction(action);
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 6);
  const visible = rows.slice(start, end);

  /**
   * What a drag over the tree means. The pointer's height decides: the top and bottom quarter of a row
   * are the gaps between rows (the page goes before / after it), the middle is "inside it", and the
   * empty area below the rows means the end of the top level.
   */
  const locate = (e: DragEvent): { plan: DropPlan; zone: DropZone; index: number; end: boolean } | null => {
    const src = dragSrc.current;
    const el = ref.current;
    if (!src || !el) return null;
    const y = e.clientY - el.getBoundingClientRect().top + el.scrollTop;
    const i = Math.floor(y / ROW_H);
    const row = rows[i];
    if (!row) {
      const plan = tree.resolveDropEnd(src);
      return plan ? { plan, zone: 'after', index: rows.length, end: true } : null;
    }
    const f = (y - i * ROW_H) / ROW_H;
    const zone: DropZone = f < 0.27 ? 'before' : f > 0.73 ? 'after' : 'into';
    const plan = tree.resolveDrop(src, row.path, zone);
    return plan ? { plan, zone, index: i, end: false } : null;
  };

  // files from outside the app: dropped on a row they go inside that page, below the rows at the top level
  const [extRow, setExtRow] = useState<number | null>(null);
  const isExternal = (e: DragEvent): boolean => !dragSrc.current && !!e.dataTransfer?.types.includes('Files');
  const extTarget = (e: DragEvent): { index: number; parent: string | null } => {
    const el = ref.current!;
    const i = Math.floor((e.clientY - el.getBoundingClientRect().top + el.scrollTop) / ROW_H);
    const row = rows[i];
    return row ? { index: i, parent: row.path } : { index: -1, parent: null };
  };

  const isFileDrag = (e: DragEvent): boolean => !dragSrc.current && !!(e.dataTransfer?.types.includes('application/x-cave-file') || e.dataTransfer?.types.includes('application/x-cave-page'));
  const onDragOver = (e: DragEvent): void => {
    if (isExternal(e) || isFileDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const t = extTarget(e);
      setExtRow((v) => (v === t.index ? v : t.index));
      return;
    }
    const hit = locate(e);
    if (!hit) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    const row = rows[hit.index];
    const depth = hit.end ? 0 : hit.zone === 'after' && hit.plan.parent === row?.path ? (row?.depth ?? 0) + 1 : (row?.depth ?? 0);
    setDrop((d) => (d && d.index === hit.index && d.zone === (hit.end ? 'end' : hit.zone) && d.depth === depth ? d : { index: hit.index, zone: hit.end ? 'end' : hit.zone, depth }));
  };

  const onDrop = (e: DragEvent): void => {
    if (isFileDrag(e)) {
      e.preventDefault();
      const t = extTarget(e);
      setExtRow(null);
      const f = e.dataTransfer?.getData('application/x-cave-file');
      if (f) void ctl.moveFileInto(f, t.parent);
      else {
        // a page dragged in from the sub-page bar (or the pages of a view): it goes inside the row it is dropped on
        const pg = e.dataTransfer?.getData('application/x-cave-page');
        const from = e.dataTransfer?.getData('application/x-cave-workspace');
        if (pg && from && from !== ctl.activeRoot()) {
          ctl.toast('That page is in another workspace. Drop it into the text of a page to link to it.');
          return;
        }
        const ps = ctl.dragPaths.length > 1 ? ctl.dragPaths : pg ? [pg] : [];
        ctl.dragPaths = [];
        if (ps.length) void ctl.movePagesTo(ps, t.parent);
      }
      return;
    }
    if (isExternal(e)) {
      e.preventDefault();
      const t = extTarget(e);
      setExtRow(null);
      void ctl.dropExternal([...(e.dataTransfer?.files ?? [])], t.parent);
      return;
    }
    const hit = locate(e);
    const src = dragSrc.current;
    setDrop(null);
    if (!hit || !src) return;
    e.preventDefault();
    dragSrc.current = null;
    ctl.dragging = false;
    if (ctl.dragPaths.length > 1) {
      const paths = ctl.dragPaths;
      ctl.dragPaths = [];
      void ctl.movePagesTo(paths, hit.plan.parent);
      return;
    }
    void ctl.dropPage(src, hit.plan, hit.zone);
  };

  return (
    <div
      class="tree"
      role="tree"
      aria-label="Pages"
      tabIndex={0}
      ref={ref}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLElement).scrollTop)}
      onKeyDown={(e) => void onKeyDown(e as unknown as KeyboardEvent)}
      onDragOver={(e) => onDragOver(e as unknown as DragEvent)}
      onDrop={(e) => onDrop(e as unknown as DragEvent)}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) { setDrop(null); setExtRow(null); }
      }}
    >
      {rows.length === 0 && (
        <div class="tree-empty">
          <p>No pages yet.</p>
          <button class="pill-button suggested" onClick={() => void ctl.newPageIn(null)}>
            New Page
          </button>
        </div>
      )}
      <div class="tree-spacer" style={{ height: `${rows.length * ROW_H}px` }}>
        {visible.map((row, k) => {
          const i = start + k;
          const nested = (row as TreeRow & { workspaceRoot?: string }).workspaceRoot;
          return (
            <div
              key={row.path}
              class={`tree-row ${row.path === selected && ctl.multi.value.length < 2 ? 'selected' : ''} ${ctl.multi.value.includes(row.path) ? 'selected multi' : ''} ${row.exists ? '' : 'virtual'} ${nested ? 'workspace' : ''} ${row.template ? 'template' : ''} ${row.unlisted ? 'unlisted' : ''} ${hitSet.has(row.path) ? 'find-hit' : ''} ${currentHit === row.path ? 'find-current' : ''} ${(drop?.index === i && drop.zone === 'into') || extRow === i ? 'drop-target' : ''}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={row.path === selected}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              style={{ top: `${i * ROW_H}px`, height: `${ROW_H}px`, paddingLeft: `${8 + row.depth * 18}px` }}
              draggable={!nested && !coarse}
              title={nested ? `${row.name}: a workspace of its own` : row.template ? `${row.name}: a template (unlisted)` : row.unlisted ? `${row.name}: unlisted` : undefined}
              onClick={(e) => {
                if (find && !nested && hitSet.has(row.path)) {
                  ctl.closeTreeFind(true, row.path);
                  return;
                }
                if (find) ctl.closeTreeFind(false);
                // Ctrl/Cmd or Shift: pick several pages without opening any
                if (!nested && ctl.selectWith(row.path, rows.map((r) => r.path), { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) return;
                tree.select(row.path);
                if (nested) void ctl.openNestedWorkspace(nested);
                else {
                  void ctl.openPage(row.path, { reveal: false });
                  if (narrow.value && ctl.settings.value.showLeft) ctl.toggleLeft(); // narrow: the tree is a drawer, so go to the page
                }
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                void ctl.openInNewTab(row.path);
              }}
              onDblClick={() => {
                if (row.hasChildren) void tree.toggle(row.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!nested && ctl.multi.value.length > 1 && ctl.multi.value.includes(row.path)) {
                  ctl.openPagesMenu(e, ctl.multi.value);
                  return;
                }
                if (ctl.multi.value.length) ctl.multi.value = [];
                tree.select(row.path);
                ctl.openPageMenu(e, row.path, nested);
              }}
              onDragStart={(e) => {
                dragSrc.current = row.path;
                ctl.dragging = true;
                ctl.dragPaths = ctl.multi.value.length > 1 && ctl.multi.value.includes(row.path) ? ctl.multi.value : [];
                e.dataTransfer?.setData('application/x-cave-page', row.path);
                // which workspace the page is in, so a drop into the text of another workspace makes a workspace link
                if (!nested) e.dataTransfer?.setData('application/x-cave-workspace', ctl.activeRoot() ?? '');
                // 'all': dropped in the text it becomes a link, in the tree it moves (a drop effect the drag does not allow is refused)
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'all';
              }}
              onDragEnd={() => {
                dragSrc.current = null;
                ctl.dragging = false;
                ctl.dragPaths = [];
                setDrop(null);
              }}
            >
              <button
                class={`chevron ${row.hasChildren ? '' : 'hidden'}`}
                tabIndex={-1}
                aria-label={row.expanded ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  void tree.toggle(row.path);
                }}
              >
                <Icon name="chevron" size={14} style={{ transform: row.expanded ? 'rotate(90deg)' : 'none' }} />
              </button>
              {isIconName(row.icon) ? <WorkspaceIcon name={row.icon} size={16} class="row-icon" /> : <Icon name={nested ? 'cave' : row.exists ? 'page' : 'folder'} size={16} class="row-icon" />}
              <span class="row-label">{row.name}</span>
              {row.indicator && (
                <button
                  type="button"
                  class="row-indicator"
                  title={row.indicator}
                  aria-label={`Indicator: ${row.indicator}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    ctl.openIndicator(e, row.path, row.indicator!);
                  }}
                >
                  <span class="row-indicator-dot" />
                </button>
              )}
            </div>
          );
        })}
        {drop && (
          <div
            class="drop-line"
            style={{ top: `${(drop.zone === 'before' ? drop.index : drop.index + 1) * ROW_H - 1}px`, left: `${8 + drop.depth * 18}px` }}
          />
        )}
      </div>
    </div>
  );
}
