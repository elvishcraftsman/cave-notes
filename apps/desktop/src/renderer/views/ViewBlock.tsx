import type { ViewBlockApi, ViewBlockHost } from '@cave-notes/editor';
import { BUILTIN, BUILTIN_COLUMNS, VIEW_TYPES, addViewToSource, clausesOf, fieldsFor, ownQueryOf, parseViewSet, pickColumns, relationAliases, removeViewFromSource, resolveQuery, shortcodeOf, toCsv, updateViewSource, type Row, type ViewConfig, type ViewType } from '@cave-notes/ui-views';
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

interface Data {
  rows: Row[];
  total: number | null;
  errors: string[];
  loading: boolean;
  failure: string | null;
}

export function ViewBlock({ ctl, source, api }: { ctl: Controller; source: string; api: ViewBlockApi }): JSX.Element {
  const parsed = useMemo(() => parseViewSet(source), [source]);
  const set = parsed.ok ? parsed.set : null;
  // a block can hold several views (see `view:` in docs/queries.md); one is shown at a time
  const [activeIdx, setActiveIdx] = useState(0);
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
  const saved = ctl.saved.value;
  const savedMap = useMemo(() => new Map(saved.queries.map((x) => [x.name.toLowerCase(), x.query])), [saved]);
  // tables, lists and galleries come in pages; boards and calendars need everything at once
  const paged = !!config && (config.type === 'table' || config.type === 'list' || config.type === 'gallery');
  const pageSize = !config ? 0 : paged ? config.pageSize ?? 25 : 0;
  // grouped rows must arrive grouped, so the group is the first sort key
  const groupSort = config && config.group && (config.type === 'table' || config.type === 'list') ? [`${config.groupDir === 'desc' ? '-' : ''}${config.group}`, config.sort].filter(Boolean).join(',') : config?.sort;
  const query = config ? resolveQuery({ query: config.query, ...(groupSort ? { sort: groupSort } : {}) }, { page, saved: savedMap }) : '';
  const colorRules = useMemo(() => (config?.colors ?? []).map((r) => ({ color: r.color, when: resolveQuery({ query: r.when }, { page, saved: savedMap }) })), [config?.colors, page, savedMap]);
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
  const cols = pickColumns(config.columns, data.rows, 4, relationAliases(saved.relations));
  const sortCount = (config.sort ?? '').split(',').filter((x) => x.trim()).length;
  const sortable = [...BUILTIN.filter((b) => b !== 'path'), 'filename', 'filetype', ...keys.map((k) => k.key).filter((k) => k !== 'filename' && k !== 'filetype')];
  const total = data.total ?? data.rows.length;
  const canGroup = config.type === 'table' || config.type === 'list';
  // every property can be grouped by: the built-in ones, every attribute (dates too) and the relations
  const groupable = [...new Set([...BUILTIN_COLUMNS, ...keys.map((k) => k.key), ...saved.relations.flatMap((r) => { const back = r.backname ?? r.reverse; return back ? [r.name, back] : [r.name]; })])];

  /** Every row of the view (not just this page) as a CSV file. */
  const exportCsv = async (): Promise<void> => {
    const all: Row[] = [];
    const base = resolveQuery({ query: config.query, ...(groupSort ? { sort: groupSort } : {}) }, { page, saved: savedMap });
    for (let off = 0; off < 50000; off += 1000) {
      const r = await ctl.queryView(base, null, 1000, off);
      all.push(...(r.rows as Row[]));
      if (r.rows.length < 1000 || (r.total !== null && all.length >= r.total)) break;
    }
    const columns = pickColumns(config.columns, all, 4, relationAliases(saved.relations));
    const blob = new Blob(['\ufeff', toCsv(all, columns)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(config.title ?? 'view').replace(/[\\/:*?"<>|]+/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const panelButton = (id: 'filter' | 'props' | 'sort' | 'colors', content: JSX.Element): JSX.Element => (
    <button class={`pill-button small vb-panel-button ${panel === id ? 'on' : ''}`} data-panel={id} aria-expanded={panel === id} onClick={() => setPanel(panel === id ? null : id)}>
      {content}
    </button>
  );
  const views = set!.views;
  const controlsOpen = expanded || panel !== null; // the controls row shows while it is expanded or a settings pane is open
  const addView = (): void => {
    const named = views[idx]!.title;
    api.updateSource(addViewToSource(source, { type: 'table', query: named ? `!${/^[\w-]+$/.test(named) ? named : `"${named}"`}` : builderQuery || ownQuery }));
    setActiveIdx(views.length);
  };

  return (
    <div
      class={`view-block t-${config.type} ${dropOver ? 'drop-over' : ''}`}
      data-view-type={config.type}
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
              <button key={i} role="tab" aria-selected={i === idx} class={`vb-tab ${i === idx ? 'on' : ''}`} data-view-tab={i} title={v.title ?? TYPE_INFO[v.type].label} aria-label={v.title ?? TYPE_INFO[v.type].label} onClick={() => setActiveIdx(i)}>
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
          keys={keys}
          onCreate={(title, content, under) => ctl.createViewPage(title, content, under, { quiet: config.noDuplicateWarning === true, rememberQuiet: () => update({ noDuplicateWarning: true }) })}
          onClose={() => {
            setAdding(false);
            // inside dynamic content the whole text is drawn again after a save, which replaces this button:
            // say which button should take focus once it is drawn
            ctl.newFocus = { query, at: Date.now() };
            // the New button takes focus, so Enter starts the next page
            setTimeout(() => newButton.current?.focus(), 0);
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
              onMove={() => ctl.movePagesDialog(picked)}
              onDelete={() => void ctl.deletePages(picked).then((ok) => ok && setSelected(new Set()))}
              onSet={(k, v) => void ctl.setAttributeOnPages(picked, k, v)}
              onClear={() => setSelected(new Set())}
            />
          )}
          <BodyView ctl={ctl} config={config} rows={data.rows} keys={keys} update={update} selection={selection} query={query} />
        </div>
      )}
      {paged && <Pager page={pageNo} size={pageSize} total={total} onPage={setPageNo} onSize={(n) => update({ pageSize: n })} />}
      <div class="vb-foot">
        <span>{total.toLocaleString()} {total === 1 ? 'page' : 'pages'}{total > data.rows.length ? ` (showing ${offset + 1}–${offset + data.rows.length})` : ''}</span>
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

/** The names of the saved queries a query text uses (`saved:name` or `saved:"two words"`). */
function savedNames(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(/(?:^|\s)-?saved:(?:"([^"]+)"|([^\s"]+))/gi)) out.push((m[1] ?? m[2])!);
  return [...new Set(out)];
}
