import type { AttributeKey, RelationDef } from '../../shared/api';
import {
  attrsOf, calendarMonth, colorValue, dayOf, formatAttr, clipTitle, groupRows, initialMonth, pickColumns, relationAliases, shiftMonth, sortRows, valuesOf,
  type Row, type ViewConfig,
} from '@cave-notes/ui-views';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Controller } from '../controller';
import { Icon, WorkspaceIcon, isIconName } from '../components/icons';
import { stripExt } from '../paths';
import { EditableCell, EditableTitle, RelationCell, keyInfo } from './cells';

export interface BodyProps {
  ctl: Controller;
  config: ViewConfig;
  rows: Row[];
  keys: AttributeKey[];
  /** change the block's settings */
  update: (patch: Partial<Record<keyof ViewConfig, string | number | boolean | string[] | null>>) => void;
  /** the query the view runs (`$this` already worked out): what a page dropped on the view has to satisfy */
  query: string;
  /** the rows ticked for a bulk action (tables and lists) */
  selection?: { selected: Set<string>; toggle: (path: string) => void; setMany: (paths: string[], on: boolean) => void };
}

/** The relation a column belongs to, and which of its two columns it is. */
function relationOf(ctl: Controller, k: string): { def: RelationDef; side: 'forward' | 'back' } | null {
  for (const r of ctl.saved.value.relations) {
    if (r.name === k) return { def: r, side: 'forward' };
    if ((r.backname ?? r.reverse) === k) return { def: r, side: 'back' };
  }
  return null;
}

/** Right-click on a row: the same page menu as in the page tree (text fields keep their own menu). */
const rowMenu = (ctl: Controller, path: string) => (e: MouseEvent): void => {
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  ctl.openPageMenu(e, path);
};

/** The path of a page dragged in from outside the view (tree, search results, sub-page bar), or null. */
const outsidePage = (e: DragEvent): string | null => (e.dataTransfer?.types.includes('application/x-cave-page') ? e.dataTransfer.getData('application/x-cave-page') || '\u0000' : null);
const hasOutsidePage = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('application/x-cave-page');

/** Pages of this workspace only: the ones that can be selected, dragged and changed (a row of another workspace is shown, not edited). */
const own = (rows: Row[]): Row[] => rows.filter((r) => !r.workspace);
/** React key of a row: the same path can come from two workspaces. */
const rowKey = (r: Row): string => (r.workspace ? `${r.workspace}\u0000${r.path}` : r.path);
const open = (ctl: Controller, row: Row): void => void (row.workspace ? ctl.openWorkspaceLink(row.workspace, row.path, null) : ctl.openPage(row.path, { reveal: true }));

function Cell({ ctl, row, k, keys, config, update }: { ctl: Controller; row: Row; k: string; keys: AttributeKey[]; config: ViewConfig; update: BodyProps['update'] }): JSX.Element {
  if (k === 'title') return <EditableTitle ctl={ctl} row={row} />;
  if (k === 'path' || k === 'modified' || k === 'filename' || k === 'filetype') return <span class="vb-dim">{valuesOf(row, k)[0]}</span>;
  // a relation: the pages it names, each one a link; click to change them
  const rel = relationOf(ctl, k);
  if (rel) {
    if (!(row.related && k in row.related)) return <span class="vb-dim">—</span>; // this page is not one the relation applies to
    const editable = rel.side === 'forward' || !!rel.def.backattribute;
    if (editable && !row.isVirtual && !row.workspace) return <RelationCell ctl={ctl} row={row} k={k} rel={rel.def} side={rel.side} memory={{ mode: config.relationFiles ?? null, remember: (m) => update({ relationFiles: m }) }} />;
    return (
      <span class="vb-relations" onClick={(e) => e.stopPropagation()}>
        {row.related[k]!.map((p) => {
          // a page of another workspace named by the relation (its own workspace), or any page of a row that is itself from another one
          const ws = p.workspace ?? row.workspace;
          return <a key={`${ws ?? ''}\u0000${p.path}`} class={`vb-relation ${ws ? 'vb-ext' : ''}`} href="#" title={ws ? `${p.title} (in ${ws})` : p.title} onClick={(e) => { e.preventDefault(); if (ws) void ctl.openWorkspaceLink(ws, p.path, null); else void ctl.openPage(p.path, { reveal: true }); }}>{clipTitle(p.title)}</a>;
        })}
        {row.related[k]!.length === 0 && <span class="vb-dim">—</span>}
      </span>
    );
  }
  if (row.workspace) return <span class="vb-dim">{(row.attrs[k] ?? []).map((a) => a.text).join(', ') || '—'}</span>; // a page of another workspace: shown, not edited here
  return (
    <span class="vb-edit" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <EditableCell ctl={ctl} row={row} k={k} keys={keys} />
    </span>
  );
}

/** The inline style that tints a row with the colour of the rule that matched it. */
const tint = (r: Row): JSX.CSSProperties | undefined => {
  const c = r.color ? colorValue(r.color) : null;
  return c ? ({ '--row-color': c } as JSX.CSSProperties) : undefined;
};

const label = (k: string): string => (k === 'modified' ? 'Modified' : k.charAt(0).toUpperCase() + k.slice(1));

// ---------------------------------------------------------------- table

/** Columns whose content is short (a date, a tick, one of a few choices, the pages of a relation) take only the room they need; text takes the rest. */
const isFit = (ctl: Controller, k: string, keys: AttributeKey[]): boolean => {
  if (k === 'modified' || k === 'filetype') return true;
  if (relationOf(ctl, k)) return true; // a relation is sized like a dropdown
  const info = keyInfo(keys, k);
  if (!info || info.list) return false;
  return info.type === 'date' || info.type === 'bool' || (info.values?.length ?? 0) > 0;
};

// ---------------------------------------------------------------- dragging rows between groups

/**
 * A page dragged over a row of a table or list: held there for a second, the row becomes a place to drop it, and the
 * page goes inside that row's page. Dropped sooner, the drop is left to the group or view it is over (it only means
 * "into this view"). Rows dragged inside the view count the same.
 */
function useHoverDropInto(ctl: Controller) {
  const [armed, setArmed] = useState<string | null>(null);
  const pending = useRef<{ path: string; timer: number } | null>(null);
  const clear = (): void => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    setArmed(null);
  };
  useEffect(() => clear, []);
  const props = (path: string): Record<string, unknown> => ({
    onDragOver: (e: DragEvent) => {
      const t = e.dataTransfer?.types;
      if (!t || !(t.includes('application/x-cave-page') || t.includes('application/x-cave-rows'))) return;
      if (armed === path) {
        e.preventDefault();
        e.stopPropagation(); // the row is the place to drop: the group does not light up as well
        return;
      }
      if (pending.current?.path === path) return;
      clear();
      pending.current = { path, timer: window.setTimeout(() => { pending.current = null; setArmed(path); }, 1000) };
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) clear();
    },
    onDrop: (e: DragEvent) => {
      const was = armed === path;
      clear();
      if (!was) return;
      let paths: string[] = [];
      const outside = outsidePage(e);
      if (outside && outside !== '\u0000') paths = [outside];
      else {
        try { paths = JSON.parse(e.dataTransfer?.getData('application/x-cave-rows') || '[]') as string[]; } catch { paths = []; }
      }
      // never into itself or something below it
      paths = paths.filter((p) => p && p !== path && !stripExt(path).startsWith(`${stripExt(p)}/`));
      if (paths.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        for (const p of paths) await ctl.movePage(p, path);
        ctl.viewTick.value++;
      })();
    },
  });
  return { armed, props };
}

/**
 * In a grouped table or list, rows can be dragged from one group to another: the ticked rows when the dragged row is one
 * of them, else just that row. Each takes the value of the group it lands in (an empty group value removes the attribute).
 */
function useGroupDrop({ ctl, config, keys, selection, query }: Pick<BodyProps, 'ctl' | 'config' | 'keys' | 'selection' | 'query'>) {
  const key = config.group;
  const info = keyInfo(keys, key);
  const enabled = !!key && !!info && !info.list;
  const [over, setOver] = useState<string | null>(null);
  const rowProps = (r: { path: string }): Record<string, unknown> => enabled ? {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const paths = selection?.selected.has(r.path) ? [...selection.selected] : [r.path];
      e.dataTransfer?.setData('application/x-cave-rows', JSON.stringify(paths));
      e.dataTransfer?.setData('text/plain', paths.join('\n'));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'all';
    },
    onDragEnd: () => setOver(null),
  } : {};
  const zoneProps = (value: string | null): Record<string, unknown> => {
    const id = value ?? '\u0000none';
    return enabled ? {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes('application/x-cave-rows') && !hasOutsidePage(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (over !== id) setOver(id);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && over === id) setOver(null);
      },
      onDrop: (e: DragEvent) => {
        const outside = outsidePage(e);
        if (outside) {
          // a page from the tree: it gets what the view needs plus the value of this group
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          void ctl.dropPagesOnView([outside], query, { key: key!, value });
          return;
        }
        const raw = e.dataTransfer?.getData('application/x-cave-rows');
        if (!raw) return;
        e.preventDefault();
        setOver(null);
        let paths: string[] = [];
        try { paths = JSON.parse(raw) as string[]; } catch { return; }
        void (async () => {
          for (const p of paths) await ctl.setPageAttribute(p, key!, coerce(value, info?.type ?? 'string'));
        })();
      },
    } : {};
  };
  return { rowProps, zoneProps, isOver: (value: string | null): boolean => over === (value ?? '\u0000none') };
}

/** Selects or clears every page of one group; half-ticked while only some of them are chosen. */
function GroupCheck({ paths, selection, name, class: cls }: { paths: string[]; selection: NonNullable<BodyProps['selection']>; name: string; class?: string }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const count = paths.filter((p) => selection.selected.has(p)).length;
  const all = paths.length > 0 && count === paths.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return <input ref={ref} type="checkbox" class={cls} aria-label={`Select all in ${name}`} title={`Select all in ${name}`} checked={all} onChange={(e) => selection.setMany(paths, (e.currentTarget as HTMLInputElement).checked)} />;
}

export function TableBody({ ctl, config, rows, keys, update, selection, query }: BodyProps): JSX.Element {
  const cols = pickColumns(config.columns, rows, 4, relationAliases(ctl.saved.value.relations));
  const [dragCol, setDragCol] = useState<string | null>(null);
  const dropCol = (target: string): void => {
    if (!dragCol || dragCol === target) return setDragCol(null);
    const list = cols.filter((c) => c !== dragCol);
    list.splice(cols.indexOf(target), 0, dragCol);
    setDragCol(null);
    update({ columns: list });
  };
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const shown = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const dnd = useGroupDrop({ ctl, config, keys, selection, query });
  const into = useHoverDropInto(ctl);
  const info = keyInfo(keys, config.group);
  const groups = useMemo(() => (config.group ? groupRows(shown, config.group, info?.values ?? [], config.groupDir ?? 'asc').filter((g) => g.rows.length > 0) : [{ value: '', rows: shown }]), [shown, config.group, config.groupDir, info]);
  return (
    <div class="vb-scroll">
      <table class="vb-table">
        <thead>
          <tr>
            {selection && (
              <th class="vb-select">
                <input type="checkbox" aria-label="Select all shown" checked={own(rows).length > 0 && own(rows).every((r) => selection.selected.has(r.path))} onChange={(e) => selection.setMany(own(rows).map((r) => r.path), (e.currentTarget as HTMLInputElement).checked)} />
              </th>
            )}
            {cols.map((c) => (
              <th key={c} class={`${isFit(ctl, c, keys) ? 'fit' : ''} ${dragCol && dragCol !== c ? 'drop' : ''}`} draggable onDragStart={() => setDragCol(c)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropCol(c); }} onDragEnd={() => setDragCol(null)} aria-sort={sort?.key === c ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button class="vb-th" onClick={() => setSort(sort?.key === c ? (sort.dir === 'asc' ? { key: c, dir: 'desc' } : null) : { key: c, dir: 'asc' })}>
                  {label(c)}
                  {sort?.key === c && <span class="vb-sort">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.value ?? '\u0000none'} class={dnd.isOver(g.value) ? 'drop-over' : ''} {...(dnd.zoneProps(g.value) as object)}>
            {config.group && (
              <tr class="vb-group-row" data-group={g.value ?? ''}>
                {selection && (
                  <th class="vb-select">
                    <GroupCheck paths={own(g.rows).map((r) => r.path)} selection={selection} name={g.value ?? `No ${config.group}`} />
                  </th>
                )}
                <th colSpan={cols.length}>{g.value ?? `No ${config.group}`} <span class="vb-group-count">{g.rows.length}</span></th>
              </tr>
            )}
            {g.rows.map((r) => (
              <tr key={rowKey(r)} class={`${r.color ? 'has-color' : ''} ${selection?.selected.has(r.path) ? 'selected' : ''} ${into.armed === r.path ? 'drop-into' : ''}`} style={tint(r)} data-color={r.color} onContextMenu={r.workspace ? undefined : rowMenu(ctl, r.path)} {...((r.workspace ? {} : dnd.rowProps(r)) as object)} {...((r.workspace ? {} : into.props(r.path)) as object)}>
                {selection && <td class="vb-select">{!r.workspace && <input type="checkbox" aria-label={`Select ${r.title}`} checked={selection.selected.has(r.path)} onChange={() => selection.toggle(r.path)} />}</td>}
                {cols.map((c) => <td key={c} class={isFit(ctl, c, keys) ? 'fit' : ''}><div class="vb-cellbox"><Cell ctl={ctl} row={r} k={c} keys={keys} config={config} update={update} /></div></td>)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- list

export function ListBody({ ctl, config, rows, keys, update, selection, query }: BodyProps): JSX.Element {
  const cols = pickColumns(config.columns, rows, 3, relationAliases(ctl.saved.value.relations)).filter((c) => c !== 'title');
  const info = keyInfo(keys, config.group);
  const groups = config.group ? groupRows(rows, config.group, info?.values ?? [], config.groupDir ?? 'asc').filter((g) => g.rows.length > 0) : [{ value: '', rows }];
  const dnd = useGroupDrop({ ctl, config, keys, selection, query });
  const into = useHoverDropInto(ctl);
  return (
    <div class="vb-list-groups">
      {groups.map((g) => (
        <section key={g.value ?? '\u0000none'} class={`vb-group ${dnd.isOver(g.value) ? 'drop-over' : ''}`} data-group={g.value ?? ''} {...(dnd.zoneProps(g.value) as object)}>
          {config.group && (
            <h4 class="vb-group-head">
              {selection && <GroupCheck class="vb-select" paths={own(g.rows).map((r) => r.path)} selection={selection} name={g.value ?? `No ${config.group}`} />}
              {g.value ?? `No ${config.group}`} <span class="vb-group-count">{g.rows.length}</span>
            </h4>
          )}
          <ul class="vb-list">
            {g.rows.map((r) => (
              <li key={rowKey(r)} class={`${r.color ? 'has-color' : ''} ${selection?.selected.has(r.path) ? 'selected' : ''} ${into.armed === r.path ? 'drop-into' : ''}`} style={tint(r)} data-color={r.color} onContextMenu={r.workspace ? undefined : rowMenu(ctl, r.path)} {...((r.workspace ? {} : dnd.rowProps(r)) as object)} {...((r.workspace ? {} : into.props(r.path)) as object)}>
                {selection && !r.workspace && <input type="checkbox" class="vb-select" aria-label={`Select ${r.title}`} checked={selection.selected.has(r.path)} onChange={() => selection.toggle(r.path)} />}
                <Icon name={r.isVirtual ? 'folder' : 'page'} size={14} class="vb-icon" />
                <EditableTitle ctl={ctl} row={r} />
                <span class="vb-inline">
                  {cols.filter((c) => (c === 'path' || c === 'modified' || c === 'filename' || c === 'filetype' ? true : attrsOf(r, c).length > 0)).map((c) => <Cell key={c} ctl={ctl} row={r} k={c} keys={keys} config={config} update={update} />)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- gallery

const hue = (s: string): number => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

export function GalleryBody({ ctl, config, rows, keys, update }: BodyProps): JSX.Element {
  const cols = pickColumns(config.columns, rows, 3, relationAliases(ctl.saved.value.relations)).filter((c) => c !== 'title' && c !== config.cover);
  return (
    <div class="vb-gallery">
      {rows.map((r) => {
        const href = config.cover ? attrsOf(r, config.cover)[0]?.text : undefined;
        const src = href ? ctl.assetUrlFor(r.path, href) : null;
        return (
          <div key={rowKey(r)} class={`vb-card ${r.color ? 'has-color' : ''}`} style={tint(r)} role="button" tabIndex={0} onContextMenu={r.workspace ? undefined : rowMenu(ctl, r.path)} onClick={() => open(ctl, r)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(ctl, r))}>
            <div class="vb-cover" style={src ? undefined : { background: `hsl(${hue(r.title)} 35% 32%)` }}>
              {src ? <img src={src} alt="" loading="lazy" /> : (() => {
                // a page's own icon stands in for the initial
                const ic = attrsOf(r, 'icon')[0]?.text;
                return isIconName(ic) ? <WorkspaceIcon name={ic} size={34} /> : <span>{r.title.slice(0, 1).toUpperCase()}</span>;
              })()}
            </div>
            <div class="vb-card-body">
              <div class="vb-card-title">{r.title}</div>
              {cols.filter((c) => (c === 'path' || c === 'modified' ? true : attrsOf(r, c).length > 0)).map((c) => (
                <div key={c} class="vb-card-prop"><Cell ctl={ctl} row={r} k={c} keys={keys} config={config} update={update} /></div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- shared: ask for a property

function Choose({ text, options, onPick }: { text: string; options: string[]; onPick: (key: string) => void }): JSX.Element {
  return (
    <div class="vb-choose">
      <span>{text}</span>
      {options.length === 0 ? (
        <span class="vb-dim">No suitable property yet. Add one to a page's frontmatter first.</span>
      ) : (
        <select aria-label={text} value="" onChange={(e) => onPick((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );
}

function coerce(value: string | null, type: string): string | number | boolean | null {
  if (value === null) return null;
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (type === 'bool') return value === 'true';
  return value;
}

// ---------------------------------------------------------------- kanban

export function KanbanBody({ ctl, config, rows, keys, update, query }: BodyProps): JSX.Element {
  const key = config.group;
  const info = keyInfo(keys, key);
  const [moved, setMoved] = useState<Record<string, string | null>>({});
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => setMoved({}), [rows]);
  if (!key) return <Choose text="Group the board by" options={keys.filter((k) => !k.list && k.type !== 'date').map((k) => k.key)} onPick={(k) => k && update({ group: k })} />;

  const draggable = !info?.list;
  const shown = rows.map((r) => (!r.workspace && r.path in moved ? { ...r, attrs: { ...r.attrs, [key]: moved[r.path] === null ? [] : [{ type: info?.type ?? 'string', text: moved[r.path]!, num: null }] } } : r));
  const groups = groupRows(shown, key, info?.values ?? []);
  const cols = pickColumns(config.columns, rows, 3, relationAliases(ctl.saved.value.relations)).filter((c) => c !== 'title' && c !== key);

  const drop = async (path: string, value: string | null): Promise<void> => {
    setHover(null);
    const row = shown.find((r) => r.path === path);
    if (!row || !draggable) return;
    if ((valuesOf(row, key)[0] ?? null) === value) return;
    setMoved((m) => ({ ...m, [path]: value }));
    const ok = await ctl.setPageAttribute(path, key, coerce(value, info?.type ?? 'string'));
    if (!ok) setMoved((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)));
  };

  return (
    <div class="vb-board">
      {groups.map((g) => {
        const id = g.value ?? '\u0000none';
        return (
          <div
            key={id}
            class={`vb-col ${hover === id ? 'over' : ''}`}
            data-column={g.value ?? ''}
            onDragOver={(e) => {
              if (!draggable) return;
              e.preventDefault();
              e.stopPropagation();
              if (hover !== id) setHover(id);
            }}
            onDragLeave={() => hover === id && setHover(null)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const outside = outsidePage(e as unknown as DragEvent);
              if (outside) {
                setHover(null);
                void ctl.dropPagesOnView([outside], query, { key, value: g.value });
                return;
              }
              void drop(e.dataTransfer?.getData('text/plain') ?? '', g.value);
            }}
          >
            <div class="vb-col-head">
              <span class="vb-col-name">{g.value ?? `No ${key}`}</span>
              <span class="count">{g.rows.length}</span>
            </div>
            <div class="vb-col-cards">
              {g.rows.map((r) => (
                <div
                  key={rowKey(r)}
                  class={`vb-kcard ${r.color ? "has-color" : ""}`} style={tint(r)}
                  draggable={draggable && !r.workspace}
                  data-path={r.path}
                  onContextMenu={r.workspace ? undefined : rowMenu(ctl, r.path)}
                  onDragStart={(e) => {
                    e.dataTransfer?.setData('text/plain', r.path);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'all';
                  }}
                >
                  <EditableTitle ctl={ctl} row={r} />
                  {cols.filter((c) => (c === 'path' || c === 'modified' ? true : attrsOf(r, c).length > 0)).map((c) => (
                    <div key={c} class="vb-card-prop"><Cell ctl={ctl} row={r} k={c} keys={keys} config={config} update={update} /></div>
                  ))}
                </div>
              ))}
              {g.rows.length === 0 && <div class="vb-col-empty">{draggable ? 'Drop a card here' : 'Empty'}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- calendar

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarBody({ ctl, config, rows, keys, update, query }: BodyProps): JSX.Element {
  const dateKey = config.date;
  const [ym, setYm] = useState<{ year: number; month: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  useEffect(() => setMoved({}), [rows]);
  useEffect(() => {
    if (dateKey && ym === null && rows.length > 0) setYm(initialMonth(rows, dateKey));
  }, [dateKey, rows, ym]);
  if (!dateKey) return <Choose text="Show dates from" options={keys.filter((k) => k.type === 'date').map((k) => k.key)} onPick={(k) => k && update({ date: k })} />;

  const now = new Date();
  const cur = ym ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  const shown = rows.map((r) => (!r.workspace && r.path in moved ? { ...r, attrs: { ...r.attrs, [dateKey]: [{ type: 'date', text: moved[r.path]!, num: Date.parse(`${moved[r.path]}T00:00:00Z`) }] } } : r));
  const weekStart = ctl.settings.value.firstDayOfWeek;
  const month = calendarMonth(cur.year, cur.month, shown, dateKey, undefined, weekStart);

  const drop = async (path: string, day: string): Promise<void> => {
    setHover(null);
    const row = shown.find((r) => r.path === path);
    if (!row || dayOf(row, dateKey) === day) return;
    setMoved((m) => ({ ...m, [path]: day }));
    const ok = await ctl.setPageAttribute(path, dateKey, day);
    if (!ok) setMoved((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)));
  };
  const chip = (r: Row): JSX.Element => (
    <button
      key={rowKey(r)}
      class="vb-event"
      draggable={!r.workspace}
      title={r.title}
      data-path={r.path}
      onDragStart={(e) => e.dataTransfer?.setData('text/plain', r.path)}
      onContextMenu={r.workspace ? undefined : rowMenu(ctl, r.path)}
      onClick={() => open(ctl, r)}
    >
      {r.title}
    </button>
  );

  return (
    <div class="vb-calendar">
      <div class="vb-cal-nav">
        <button class="icon-button small" aria-label="Previous month" onClick={() => setYm(shiftMonth(cur.year, cur.month, -1))}><Icon name="chevron" size={12} class="flip" /></button>
        <strong class="vb-cal-label" aria-live="polite">{month.label}</strong>
        <button class="icon-button small" aria-label="Next month" onClick={() => setYm(shiftMonth(cur.year, cur.month, 1))}><Icon name="chevron" size={12} /></button>
        <button class="pill-button small" onClick={() => setYm({ year: now.getUTCFullYear(), month: now.getUTCMonth() })}>Today</button>
      </div>
      <div class="vb-cal-grid" role="grid">
        {[...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)].map((d) => <div key={d} class="vb-cal-dow" role="columnheader">{d}</div>)}
        {month.weeks.flat().map((day) => (
          <div
            key={day.date}
            role="gridcell"
            data-date={day.date}
            class={`vb-day ${day.inMonth ? '' : 'out'} ${day.isToday ? 'today' : ''} ${hover === day.date ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (hover !== day.date) setHover(day.date);
            }}
            onDragLeave={() => hover === day.date && setHover(null)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const outside = outsidePage(e as unknown as DragEvent);
              if (outside) {
                setHover(null);
                void ctl.dropPagesOnView([outside], query, { key: dateKey, value: day.date });
                return;
              }
              void drop(e.dataTransfer?.getData('text/plain') ?? '', day.date);
            }}
          >
            <span class="vb-daynum">{Number(day.date.slice(8))}</span>
            {day.rows.slice(0, 3).map(chip)}
            {day.rows.length > 3 && <span class="vb-more">+{day.rows.length - 3} more</span>}
          </div>
        ))}
      </div>
      {month.unscheduled.length > 0 && (
        <div class="vb-unscheduled">
          <span class="vb-dim">No {dateKey}:</span>
          {month.unscheduled.map(chip)}
        </div>
      )}
    </div>
  );
}
