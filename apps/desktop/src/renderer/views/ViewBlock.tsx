import type { ViewBlockApi, ViewBlockHost, ViewFileEditorHost } from '@cave-notes/editor';
import { BUILTIN, BUILTIN_COLUMNS, VIEW_TYPES, addViewToSource, clausesOf, csvRecords, duplicateViewInSource, newPageContent, newPageDefaults, fieldsFor, ownQueryOf, parseViewSet, pickColumns, viewColumns, withComputed, relationAliases, removeViewFromSource, resolveQuery, shortcodeOf, toCsv, updateViewSource, viewFileConfig, withViewFileConfig, type Row, type ViewConfig, type ViewType } from '@cave-notes/ui-views';
import { type JSX, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AttributeKey } from '../../shared/api';
import type { Controller } from '../controller';
import { Icon, type IconName } from '../components/icons';
import { FloatingMenu, MenuItem } from '../components/Overlays';
import { CalendarBody, GalleryBody, KanbanBody, ListBody, TableBody, type BodyProps } from './bodies';
import { FilterBuilder } from './FilterBuilder';
import { ColorRules, NewRow, Pager, PropsPanel, SelectionBar, SortEditor } from './ViewExtras';

const TYPE_INFO: Record<ViewType, { label: string; icon: IconName }> = {
  table: { label: 'Table', icon: 'table' },
  list: { label: 'List', icon: 'list' },
  gallery: { label: 'Gallery', icon: 'gallery' },
  kanban: { label: 'Board', icon: 'board' },
  calendar: { label: 'Calendar', icon: 'calendar' },
};

const BODIES: Record<ViewType, (p: BodyProps) => JSX.Element> = { table: TableBody, list: ListBody, gallery: GalleryBody, kanban: KanbanBody, calendar: CalendarBody };

/** Sensible starting properties when switching to a view that needs one. */
function defaultsFor(type: ViewType, config: ViewConfig, keys: AttributeKey[]): Partial<Record<keyof ViewConfig, string>> {
  if (type === 'kanban' && !config.group) {
    const k = keys.find((x) => x.values?.length && !x.list) ?? keys.find((x) => !x.list && x.type === 'string');
    return k ? { group: k.key } : {};
  }
  if (type === 'calendar' && !config.date) {
    const k = keys.find((x) => x.type === 'date');
    return k ? { date: k.key } : {};
  }
  return {};
}

/** A settings pane under the toolbar, with a close button in its corner. (Defined here, not inside the view, so typing in it never remounts it.) */
function PanelBox({ id, label, children, onClose }: { id: string; label: string; children: JSX.Element | JSX.Element[]; onClose: () => void }): JSX.Element {
  return (
    <div class="vb-panel" data-panel-body={id}>
      <button class="icon-button small vb-panel-close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={onClose}><Icon name="close" size={12} /></button>
      {children}
    </div>
  );
}

/** The editor unmounts blocks that scroll far out of sight; keep their last results so they come back instantly. */
const lastData = new Map<string, Data>();

/**
 * Which tab of a block of several views was open is remembered on this computer, not in the page text. A view tagged
 * `open: true` is the exception: the tag decides, every time the page opens, and choosing another tab lasts only until the page closes.
 */
function rememberedKey(page: string | null, views: { title?: string }[]): string {
  // names and count only: changing a view's filter or type must not forget which tab it was
  return `cave-notes.view-tab.${page ?? ''}::${views.map((v) => v.title ?? '').join('|')}`;
}
function readRemembered(key: string, count: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
  } catch {
    return 0;
  }
}

interface Data {
  rows: Row[];
  total: number | null;
  errors: string[];
  loading: boolean;
  failure: string | null;
}

/** `self`: the page the view is written in, when that is not the page showing it (an embedded view file or template). */
export function ViewBlock({ ctl, source, api, self }: { ctl: Controller; source: string; api: ViewBlockApi; self?: string | null }): JSX.Element {
  const parsed = useMemo(() => parseViewSet(source), [source]);
  const set = parsed.ok ? parsed.set : null;
  // a block can hold several views (see `view:` in docs/organizing/queries.md); one is shown at a time
  const tagged = set ? set.views.some((v) => v.open === true) : false;
  const tabKey = set ? rememberedKey(ctl.current.value?.path ?? null, set.views) : '';
  const [activeIdx, setActiveIdx] = useState(set ? (tagged ? set.openIndex : readRemembered(tabKey, set.views.length)) : 0);
  const idx = set ? Math.min(activeIdx, set.views.length - 1) : 0;
  const config = set ? set.views[idx]! : null;
  const [expanded, setExpanded] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const page = ctl.current.value?.path ?? null;
  const tick = ctl.viewTick.value;
  const keys = ctl.facetKeys.value;
  const [panel, setPanel] = useState<'filter' | 'props' | 'sort' | 'colors' | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const newButton = useRef<HTMLButtonElement>(null);
  // after a page was made with the New button the text this view is in may be drawn again, which makes a new view with a new
  // button: the new one gives it the focus back (the old one would be gone). Whoever was asked is told by ctl.newFocus.
  useEffect(() => {
    const want = ctl.newFocus;
    if (want && want.query === query && Date.now() - want.at < 8000) {
      ctl.newFocus = null;
      setTimeout(() => newButton.current?.focus(), 0);
    }
  }, []);
  const saved = ctl.saved.value;
  const savedMap = useMemo(() => new Map(saved.queries.map((x) => [x.name.toLowerCase(), x.query])), [saved]);
  // tables, lists and galleries come in pages; boards and calendars need everything at once
  const paged = !!config && (config.type === 'table' || config.type === 'list' || config.type === 'gallery');
  const pageSize = !config ? 0 : paged ? config.pageSize ?? 25 : 0;
  // grouped rows must arrive grouped, so the group is the first sort key
  const groupSort = config && config.group && (config.type === 'table' || config.type === 'list') ? [`${config.groupDir === 'desc' ? '-' : ''}${config.group}`, config.sort].filter(Boolean).join(',') : config?.sort;
  const query = config ? resolveQuery({ query: config.query, ...(groupSort ? { sort: groupSort } : {}) }, { page, saved: savedMap, ...(self !== undefined ? { self } : {}) }) : '';
  const colorRules = useMemo(() => (config?.colors ?? []).map((r) => ({ color: r.color, when: resolveQuery({ query: r.when }, { page, saved: savedMap, ...(self !== undefined ? { self } : {}) }) })), [config?.colors, page, savedMap]);
  const colorKey = JSON.stringify(colorRules);
  const limit = pageSize > 0 ? pageSize : config?.limit ?? 200;
  const offset = pageSize > 0 ? (pageNo - 1) * pageSize : 0;
  const cacheKey = `${query}\u0000${limit}\u0000${offset}\u0000${colorKey}`;
  const [data, setData] = useState<Data>(() => lastData.get(cacheKey) ?? { rows: [], total: null, errors: [], loading: true, failure: null });
  // a new filter starts at the first page again
  useEffect(() => setPageNo(1), [query, pageSize]);

  useEffect(() => {
    void ctl.ensureFacetKeys();
  }, []);
  useEffect(() => {
    if (tick > 0) void ctl.refreshFacetKeys();
  }, [tick]);

  useEffect(() => {
    if (!config || query.trim() === '') {
      setData({ rows: [], total: null, errors: [], loading: false, failure: null });
      return;
    }
    let live = true;
    setData((d) => ({ ...(lastData.get(cacheKey) ?? d), loading: true }));
    ctl.queryView(query, null, limit, offset, colorRules).then(
      (r) => {
        const next: Data = { rows: r.rows as Row[], total: r.total, errors: r.errors, loading: false, failure: null };
        lastData.set(cacheKey, next);
        if (lastData.size > 40) lastData.delete(lastData.keys().next().value as string);
        if (live) setData(next);
      },
      (e: unknown) => live && setData((d) => ({ ...d, loading: false, failure: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      live = false;
    };
  }, [query, limit, offset, colorKey, tick, page]);

  // computed columns (rollups, lookups, formulas): each is worked out per row by the workspace and joins the rows as an attribute
  const computedKey = JSON.stringify(config?.computed ?? []);
  const [computedRes, setComputedRes] = useState<Map<string, Map<string, { text: string; list: string[]; kind: string }>>>(new Map());
  useEffect(() => {
    const defs = config?.computed ?? [];
    const paths = data.rows.filter((r) => !r.workspace && !r.isVirtual).map((r) => r.path);
    if (defs.length === 0 || paths.length === 0) { setComputedRes(new Map()); return; }
    let live = true;
    void Promise.all(defs.map(async (c) => {
      const res = await ctl.ws.evaluateColumn(paths, c.expr).catch((e: unknown) => paths.map(() => ({ ok: false as const, error: String(e) })));
      return [c.name, new Map(paths.map((p, i) => { const r = res[i]!; return [p, r.ok ? r : { text: `⚠ ${r.error}`, list: [`⚠ ${r.error}`], kind: 'text' }] as const; }))] as const;
    })).then((entries) => { if (live) setComputedRes(new Map(entries)); });
    return () => { live = false; };
  }, [computedKey, data.rows, tick]);
  // the quick filter narrows the rows already loaded, without changing the view's own filter
  const [quick, setQuick] = useState('');
  const allRows = useMemo(() => (config?.computed ?? []).reduce((rs, c) => withComputed(rs, c.name, computedRes.get(c.name) ?? new Map()), data.rows), [data.rows, computedRes, computedKey]);
  const rowsShown = useMemo(() => {
    const q = quick.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.title.toLowerCase().includes(q) || Object.values(r.attrs).some((a) => a.some((x) => x.text.toLowerCase().includes(q))));
  }, [allRows, quick]);

  if (!config) {
    return (
      <div class="view-block error" data-view-error>
        <Icon name="warning" size={14} />
        <span>{parsed.ok ? '' : parsed.error}</span>
        <button class="pill-button small" onClick={() => api.edit()}>Edit settings</button>
      </div>
    );
  }

  const update: BodyProps['update'] = (patch) => api.updateSource(updateViewSource(source, idx, patch));
  // the filter builder works on the view's own filters; a `!Name` shortcode in front is kept as it is
  const ownQuery = ownQueryOf(source, idx);
  const shortcode = shortcodeOf(ownQuery);
  const builderQuery = shortcode ? shortcode.rest : ownQuery;
  const setBuilderQuery = (q: string): void => update({ query: shortcode ? `!${/^[\w-]+$/.test(shortcode.name) ? shortcode.name : `"${shortcode.name}"`} ${q}`.trim() : q });
  const BodyView = BODIES[config.type];
  const filters = clausesOf(builderQuery).length;
  // only rows that are still shown stay ticked
  useEffect(() => {
    setSelected((cur) => {
      if (cur.size === 0) return cur;
      const here = new Set(data.rows.map((r) => r.path));
      const next = new Set([...cur].filter((p) => here.has(p)));
      return next.size === cur.size ? cur : next;
    });
  }, [data.rows]);
  const selection = config.type === 'table' || config.type === 'list'
    ? {
        selected,
        toggle: (p: string) => setSelected((c) => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; }),
        setMany: (ps: string[], on: boolean) => setSelected((c) => { const n = new Set(c); for (const p of ps) { if (on) n.add(p); else n.delete(p); } return n; }),
      }
    : undefined;
  const picked = [...selected];
  const cols = viewColumns(config, data.rows, 4, relationAliases(saved.relations));
  const sortCount = (config.sort ?? '').split(',').filter((x) => x.trim()).length;
  const sortable = [...BUILTIN.filter((b) => b !== 'path'), 'filename', 'filetype', ...keys.map((k) => k.key).filter((k) => k !== 'filename' && k !== 'filetype')];
  const total = data.total ?? data.rows.length;
  const canGroup = config.type === 'table' || config.type === 'list';
  // every property can be grouped by: the built-in ones, every attribute (dates too) and the relations
  const groupable = [...new Set([...BUILTIN_COLUMNS, ...keys.map((k) => k.key), ...saved.relations.flatMap((r) => { const back = r.backname ?? r.reverse; return back ? [r.name, back] : [r.name]; })])];

  /** Every row of the view (not just this page) as a CSV file. */
  const exportCsv = async (): Promise<void> => {
    const all: Row[] = [];
    const base = resolveQuery({ query: config.query, ...(groupSort ? { sort: groupSort } : {}) }, { page, saved: savedMap, ...(self !== undefined ? { self } : {}) });
    for (let off = 0; off < 50000; off += 1000) {
      const r = await ctl.queryView(base, null, 1000, off);
      all.push(...(r.rows as Row[]));
      if (r.rows.length < 1000 || (r.total !== null && all.length >= r.total)) break;
    }
    const columns = pickColumns(config.columns, all, 4, relationAliases(saved.relations));
    await ctl.saveDataFile({ data: toCsv(all, columns), base: (config.title ?? 'view').replace(/[\\/:*?"<>|]+/g, '-'), extension: 'csv' });
  };

  /** Each record of a CSV becomes a page in this view: the `title` column (or the first) is the title, the other columns become attributes. */
  const fileInput = useRef<HTMLInputElement>(null);
  const importCsv = async (file: File): Promise<void> => {
    const { columns, records } = csvRecords(await file.text());
    if (records.length === 0) { ctl.toast('That file has no records.'); return; }
    const batch = records.slice(0, 500);
    const titleCol = columns.find((c) => c.toLowerCase() === 'title') ?? (config.hideTitle ? undefined : columns[0]);
    const ok = await ctl.confirm({
      title: `Import ${batch.length} ${batch.length === 1 ? 'record' : 'records'}?`,
      body: `${file.name}: each row becomes a page here${titleCol ? `, titled by “${titleCol}”` : ' (named with a number)'}; the other columns (${columns.filter((c) => c !== titleCol).join(', ') || 'none'}) become attributes.${records.length > batch.length ? ` Only the first ${batch.length} are imported.` : ''}`,
      confirm: 'Import',
    });
    if (!ok) return;
    const defaults = newPageDefaults(query);
    const types = Object.fromEntries(keys.map((k) => [k.key, { type: k.type, list: !!k.list }]));
    let made = 0;
    for (const rec of batch) {
      const title = titleCol ? (rec[titleCol] ?? '') : '';
      if (!title && !config.hideTitle) continue;
      const values: Record<string, string> = { ...defaults.attrs };
      for (const [c, v] of Object.entries(rec)) if (c !== titleCol) values[c] = types[c]?.list ? v.split(/;|,/).map((x) => x.trim()).filter(Boolean).join(', ') : v;
      const created = await ctl.createViewPage(title, newPageContent(title, values, types, {}, !config.hideTitle), defaults.under, { numbered: config.hideTitle === true, startAt: total + 1 + made, quiet: true });
      if (created) made++;
    }
    ctl.toast(`Imported ${made} ${made === 1 ? 'record' : 'records'}.`);
  };

  const panelButton = (id: 'filter' | 'props' | 'sort' | 'colors', content: JSX.Element): JSX.Element => (
    <button class={`pill-button small vb-panel-button ${panel === id ? 'on' : ''}`} data-panel={id} aria-expanded={panel === id} onClick={() => setPanel(panel === id ? null : id)}>
      {content}
    </button>
  );
  const views = set!.views;
  const controlsOpen = expanded || panel !== null; // the controls row shows while it is expanded or a settings pane is open
  // the chosen tab is remembered on this computer (never written into the page); a view tagged `open: true` always wins when the page opens
  const chooseView = (i: number): void => {
    setActiveIdx(i);
    if (!tagged) {
      try { localStorage.setItem(tabKey, String(i)); } catch { /* storage unavailable: the choice lasts until the page closes */ }
    }
  };
  const addView = (): void => {
    const named = views[idx]!.title;
    api.updateSource(addViewToSource(source, { type: 'table', query: named ? `!${/^[\w-]+$/.test(named) ? named : `"${named}"`}` : builderQuery || ownQuery }));
    setActiveIdx(views.length);
  };

  return (
    <div
      class={`view-block t-${config.type} ${dropOver ? 'drop-over' : ''}`}
      data-view-type={config.type}
      onKeyDown={(e) => {
        // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) in a view take back and redo what was changed in it, unless a text box is being typed in (it has its own)
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('textarea, [contenteditable="true"], input:not([type=checkbox])')) return;
        const k = e.key.toLowerCase();
        const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey);
        if (!redo && !(k === 'z' && !e.shiftKey)) return;
        if (redo ? !ctl.canRedoAttribute() : !ctl.canUndoAttribute()) return;
        e.preventDefault();
        e.stopPropagation();
        void ctl.undoAttribute(redo);
      }}
      onContextMenu={(e) => {
        // rows have their own menu (and text boxes the usual one); anywhere else on the view offers to delete it
        if (e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, a, [contenteditable="true"]')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ '--vb-cols': Math.max(1, cols.length) } as JSX.CSSProperties}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('application/x-cave-page')) return;
        e.preventDefault();
        e.stopPropagation();
        setDropOver(true);
      }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropOver(false); }}
      onDrop={(e) => {
        const dropped = e.dataTransfer?.getData('application/x-cave-page');
        setDropOver(false);
        if (!dropped) return;
        e.preventDefault();
        e.stopPropagation();
        void ctl.dropPagesOnView([dropped], query);
      }}
    >
      <div class="vb-toolbar">
        {config.type !== 'calendar' && (
          <button ref={newButton} class="pill-button suggested vb-new" data-new-page data-view-query={query} aria-label="New page" onClick={() => setAdding(true)}>+ New</button>
        )}
        {views.length > 1 ? (
          <div class="vb-tabs" role="tablist" aria-label="Views">
            {views.map((v, i) => (
              <button key={i} role="tab" aria-selected={i === idx} class={`vb-tab ${i === idx ? 'on' : ''}`} data-view-tab={i} title={v.title ?? TYPE_INFO[v.type].label} aria-label={v.title ?? TYPE_INFO[v.type].label} onClick={() => chooseView(i)}>
                <Icon name={TYPE_INFO[v.type].icon} size={14} />
                {v.title && <span class="vb-tab-name">{v.title}</span>}
              </button>
            ))}
          </div>
        ) : (
          config.title && <strong class="vb-heading">{config.title}</strong>
        )}
        {savedNames(config.query).map((n) => (
          <button key={n} class="pill-button small vb-saved-chip" data-saved-chip={n} title="Saved query. Ctrl+Click to edit its definition" onClick={(e) => { if (e.ctrlKey || e.metaKey) void ctl.editSavedQuery(n); }}>
            <Icon name="filter" size={11} /> {n}
          </button>
        ))}
        <span class="vb-spacer" />
        {data.rows.length > 0 && config.type !== 'calendar' && (
          <input class="vb-input vb-quick" type="search" aria-label="Filter the rows shown" placeholder="Filter rows" value={quick} onKeyDown={(e) => e.stopPropagation()} onInput={(e) => setQuick((e.currentTarget as HTMLInputElement).value)} />
        )}
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden data-import-csv onChange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; (e.currentTarget as HTMLInputElement).value = ''; if (f) void importCsv(f); }} />
        {!api.readOnly && <button class="icon-button small vb-csv" title="Import records from a CSV file" aria-label="Import from CSV" onClick={() => fileInput.current?.click()}><Icon name="upload" size={13} /></button>}
        <button class="icon-button small vb-csv" title="Export all rows as CSV" aria-label="Export as CSV" data-export-csv onClick={() => void exportCsv()}><Icon name="download" size={13} /></button>
        <button class="icon-button small" title="Edit settings as text" aria-label="Edit view settings" onClick={() => api.edit()}>
          <Icon name="code" size={13} />
        </button>
        <button class={`icon-button small vb-expand ${controlsOpen ? 'active' : ''}`} aria-expanded={controlsOpen} title={controlsOpen ? 'Hide the view controls' : 'Show the view controls'} aria-label="View controls" data-vb-expand onClick={() => { if (controlsOpen) { setExpanded(false); setPanel(null); } else setExpanded(true); }}>
          <Icon name="chevron-down" size={13} style={{ transform: controlsOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>

      {controlsOpen && (
        <div class="vb-controls">
          <div class="vb-row" role="group" aria-label="How the view looks">
            <label class="vb-field"><span>Type</span><select aria-label="View type" data-view-type-select value={config.type} onChange={(e) => { const t = (e.currentTarget as HTMLSelectElement).value as ViewType; if (t !== config.type) update({ type: t, ...defaultsFor(t, config, keys) }); }}>
              {VIEW_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
            </select></label>
            <label class="vb-field"><span>Name</span><input class="vb-input vb-name-input" aria-label="View name" placeholder="none" value={config.title ?? ''} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => update({ title: (e.currentTarget as HTMLInputElement).value.trim() || null })} /></label>
            {canGroup && (
              <label class="vb-field"><span>Group by</span>
                <span class="vb-group">
                  <select aria-label="Group by" value={config.group ?? ''} onChange={(e) => update({ group: (e.currentTarget as HTMLSelectElement).value || null, ...(((e.currentTarget as HTMLSelectElement).value) ? {} : { groupDir: null }) })}>
                    <option value="">None</option>
                    {groupable.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {config.group && (
                    <button class="icon-button small" aria-label={config.groupDir === 'desc' ? 'Groups descending' : 'Groups ascending'} title={config.groupDir === 'desc' ? 'Groups in descending order' : 'Groups in ascending order'} onClick={() => update({ groupDir: config.groupDir === 'desc' ? null : 'desc' })}>{config.groupDir === 'desc' ? '↓' : '↑'}</button>
                  )}
                </span>
              </label>
            )}
            {config.type === 'kanban' && (
              <label class="vb-field"><span>Group by</span><select aria-label="Group by" value={config.group ?? ''} onChange={(e) => update({ group: (e.currentTarget as HTMLSelectElement).value || null })}>
                <option value="">Choose…</option>
                {keys.filter((k) => !k.list && k.type !== 'date').map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
              </select></label>
            )}
            {config.type === 'calendar' && (
              <label class="vb-field"><span>Date</span><select aria-label="Date property" value={config.date ?? ''} onChange={(e) => update({ date: (e.currentTarget as HTMLSelectElement).value || null })}>
                <option value="">Choose…</option>
                {keys.filter((k) => k.type === 'date').map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
              </select></label>
            )}
            {config.type === 'gallery' && (
              <label class="vb-field"><span>Cover image</span><select aria-label="Cover image property" value={config.cover ?? ''} onChange={(e) => update({ cover: (e.currentTarget as HTMLSelectElement).value || null })}>
                <option value="">None</option>
                {keys.filter((k) => k.type === 'string' && !k.list).map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
              </select></label>
            )}
          </div>
          <div class="vb-row vb-row-data">
            <div class="vb-seg" role="group" aria-label="Which pages, in what order, and how they are shown">
              {panelButton('filter', <><Icon name="filter" size={12} /> Filter{filters > 0 ? ` · ${filters}` : ''}</>)}
              {panelButton('sort', <><Icon name="sort" size={12} /> Sort{sortCount > 0 ? ` · ${sortCount}` : ''}</>)}
              {panelButton('props', <>Properties</>)}
              {panelButton('colors', <>Colors{config.colors?.length ? ` · ${config.colors.length}` : ''}</>)}
            </div>
            <span class="vb-spacer" />
            <button class="pill-button small" data-add-view title="Add another view of these pages as a tab" onClick={addView}>+ View</button>
            <button class="pill-button small" data-duplicate-view title="Copy this view, with all its settings, as a new tab" onClick={() => { api.updateSource(duplicateViewInSource(source, idx)); setActiveIdx(idx + 1); }}>Duplicate view</button>
            {views.length > 1 && (
              <button class="pill-button small" data-remove-view title="Remove this view" onClick={() => { api.updateSource(removeViewFromSource(source, idx)); setActiveIdx(Math.max(0, idx - 1)); }}>Remove view</button>
            )}
          </div>
        </div>
      )}
      {set!.warnings.length > 0 && <p class="vb-note warn">{set!.warnings.join(' ')}</p>}

      {panel === 'filter' && (
        <PanelBox onClose={() => setPanel(null)} id="filter" label="filters">
          <FilterBuilder query={builderQuery} fields={fieldsFor(keys)} onChange={setBuilderQuery} loadValues={async (k) => (await ctl.facetValues(k, '')).map((v) => v.value)} />
          <div class="vb-saved">
            {saved.queries.length > 0 && (
              <label>Saved query <select aria-label="Add a saved query" value="" onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) setBuilderQuery(`${builderQuery} saved:${/^[\w-]+$/.test(v) ? v : `"${v}"`}`.trim()); }}>
                <option value="">Add…</option>
                {saved.queries.map((x) => <option key={x.name} value={x.name}>{x.title ?? x.name}</option>)}
              </select></label>
            )}
            <button class="pill-button small" disabled={builderQuery.trim() === ''} onClick={() => void ctl.saveQueryAs(builderQuery).then((n) => n && setBuilderQuery(`saved:${/^[\w-]+$/.test(n) ? n : `"${n}"`}`))}>Save as query…</button>
          </div>
          <p class="vb-hint">Use <code>$this</code> for this page, as in <code>under:$this</code>. A saved query is used as <code>saved:name</code>.{shortcode ? <> This view also takes the query of the view called “{shortcode.name}”.</> : null}</p>
        </PanelBox>
      )}
      {panel === 'sort' && (
        <PanelBox onClose={() => setPanel(null)} id="sort" label="sorting">
          <SortEditor sort={config.sort} options={sortable} onChange={(v) => update({ sort: v })} />
          <p class="vb-hint">The first criterion decides the order; each next one breaks ties.</p>
        </PanelBox>
      )}
      {panel === 'colors' && (
        <PanelBox onClose={() => setPanel(null)} id="colors" label="colour rules">
          <ColorRules rules={config.colors ?? []} onChange={(r) => update({ colors: r.length ? r : null } as never)} />
        </PanelBox>
      )}
      {adding && (
        <NewRow
          ctl={ctl}
          query={query}
          columns={config.newFields && config.newFields.length ? config.newFields : cols}
          onlyListed={!!(config.newFields && config.newFields.length)}
          hideTitle={config.hideTitle === true}
          keys={keys}
          onCreate={(title, content, under) => (ctl.newFocus = { query, at: Date.now() }, ctl.createViewPage(title, content, under, { numbered: config.hideTitle === true, startAt: total + 1, quiet: config.noDuplicateWarning === true, rememberQuiet: () => update({ noDuplicateWarning: true }) }))}
          onClose={() => {
            setAdding(false);
            // inside dynamic content the whole text is drawn again after a save, which replaces this button:
            // say which button should take focus once it is drawn
            ctl.newFocus = { query, at: Date.now() };
            // the New button takes focus, so Enter starts the next page (when this one is gone, the one drawn in its place does)
            setTimeout(() => {
              if (newButton.current?.isConnected) {
                newButton.current.focus();
                ctl.newFocus = null;
              }
            }, 0);
          }}
        />
      )}
      {panel === 'props' && (
        <PanelBox onClose={() => setPanel(null)} id="props" label="properties">
          <PropsPanel
            shown={cols}
            available={[...new Set([...BUILTIN_COLUMNS, ...keys.map((k) => k.key), ...saved.relations.flatMap((r) => { const back = r.backname ?? r.reverse; return back ? [r.name, back] : [r.name]; })])]}
            onChange={(columns) => update({ columns })}
          />
          <p class="vb-props-title">Fields when making a new page</p>
          <PropsPanel
            shown={config.newFields && config.newFields.length ? config.newFields : cols}
            available={[...new Set(['title', ...keys.map((k) => k.key), ...saved.relations.map((r) => r.name)])]}
            onChange={(newFields) => update({ newFields: JSON.stringify(newFields) === JSON.stringify(cols) ? null : newFields })}
          />
        </PanelBox>
      )}

      {data.failure && <p class="vb-note warn">Could not run this view: {data.failure}</p>}
      {data.errors.length > 0 && <p class="vb-note warn">{data.errors.join(' ')}</p>}
      {!ctl.indexFresh.value && query.trim() !== '' && (
        <p class="vb-note vb-stale" role="status" data-stale>
          The index is still being brought up to date, so these rows may be out of date. Moving and changing many pages at once wait until it is done.
        </p>
      )}
      {query.trim() === '' ? (
        <p class="vb-note">Add a filter to choose which pages appear here.</p>
      ) : data.rows.length === 0 && !data.loading && !data.failure ? (
        <p class="vb-note" data-empty>No pages match.</p>
      ) : (
        <div class={`vb-body ${data.loading ? 'loading' : ''}`}>
          {selection && selected.size > 0 && (
            <SelectionBar
              count={selected.size}
              keys={keys}
              onDuplicate={() => void ctl.duplicatePages(picked).then(() => setSelected(new Set()))}
              blocked={!ctl.indexFresh.value}
              onMove={() => ctl.movePagesDialog(picked)}
              onDelete={() => void ctl.deletePages(picked).then((ok) => ok && setSelected(new Set()))}
              onSet={(k, v) => void ctl.setAttributeOnPages(picked, k, v)}
              onClear={() => setSelected(new Set())}
            />
          )}
          <BodyView ctl={ctl} config={config} rows={rowsShown} keys={keys} update={update} selection={selection} query={query} />
        </div>
      )}
      {paged && <Pager page={pageNo} size={pageSize} total={total} onPage={setPageNo} onSize={(n) => update({ pageSize: n })} />}
      <div class="vb-foot">
        <span>{quick.trim() ? `${rowsShown.length} of ${data.rows.length} shown · ` : ''}{total.toLocaleString()} {total === 1 ? 'page' : 'pages'}{total > data.rows.length ? ` (showing ${offset + 1}–${offset + data.rows.length})` : ''}</span>
      </div>
      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem icon="settings" label="Edit Settings as Text" onClick={() => { setMenu(null); api.edit(); }} />
          <MenuItem icon="trash" label="Delete Query View…" destructive onClick={() => {
            setMenu(null);
            void ctl.confirm({ title: 'Delete this query view?', body: 'The view is removed from this page. The pages it shows are not touched. Undo (Ctrl+Z) brings the view back.', confirm: 'Delete View', destructive: true }).then((ok) => { if (ok) api.remove(); });
          }} />
        </FloatingMenu>
      )}
    </div>
  );
}

/** Lets the editor draw ```view blocks with Preact. */
export function createViewHost(ctl: Controller): ViewBlockHost {
  return {
    mount(el, source, api) {
      render(<ViewBlock ctl={ctl} source={source} api={api} />, el);
      return {
        // new settings arrive as new text; re-render the same component so its panels and position are kept
        update: (next) => render(<ViewBlock ctl={ctl} source={next} api={api} />, el),
        destroy: () => render(null, el),
      };
    },
  };
}

/** Draws a view file (a `.view` page) as a view that fills the editor: its settings are the file's front matter. */
export function createViewFileHost(ctl: Controller): ViewFileEditorHost {
  return {
    mount(el, text, api) {
      el.classList.add('vb-file');
      let current = text;
      const paint = (): void => {
        const blockApi: ViewBlockApi = {
          updateSource: (next) => { if (!api.readOnly) api.setText(withViewFileConfig(current, next)); },
          edit: () => api.edit(),
          remove: () => ctl.toast('Delete a view file from the page tree.'),
          readOnly: api.readOnly,
        };
        render(<ViewBlock ctl={ctl} source={viewFileConfig(current).config} api={blockApi} />, el);
      };
      paint();
      return {
        update: (next) => { current = next; paint(); },
        destroy: () => render(null, el),
      };
    },
  };
}

/** The names of the saved queries a query text uses (`saved:name` or `saved:"two words"`). */
function savedNames(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(/(?:^|\s)-?saved:(?:"([^"]+)"|([^\s"]+))/gi)) out.push((m[1] ?? m[2])!);
  return [...new Set(out)];
}
