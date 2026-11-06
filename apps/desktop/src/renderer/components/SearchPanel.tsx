import { breadcrumb, chips, removeChip, segments } from '@cave-notes/ui-search';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fieldsFor } from '@cave-notes/ui-views';
import { FilterBuilder } from '../views/FilterBuilder';
import type { Controller } from '../controller';
import { Icon } from './icons';
import { coarse } from '../layout';
import { FloatingMenu, MenuItem } from './Overlays';

const QUICK: Array<{ token: string; label: string }> = [
  { token: 'is:orphan', label: 'Orphans' },
  { token: 'is:broken', label: 'Broken links' },
  { token: 'is:ambiguous', label: 'Ambiguous links' },
  { token: 'is:virtual', label: 'Virtual pages' },
  { token: 'is:leaf', label: 'Leaf pages' },
];

const SORTS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Relevance' },
  { value: 'title', label: 'Title' },
  { value: 'path', label: 'Path' },
  { value: '-mtime', label: 'Recently changed' },
  { value: 'order', label: 'Page order' },
];

function Facets({ ctl }: { ctl: Controller }): JSX.Element {
  const keys = ctl.facetKeys.value;
  const query = ctl.searchQuery.value;
  const active = new Set(chips(query).map((c) => c.raw));
  return (
    <div class="facets">
      <div class="facet-group">
        <h4>Quick filters</h4>
        <div class="facet-chips">
          {QUICK.map((q) => (
            <button key={q.token} class={`facet-chip ${active.has(q.token) ? 'on' : ''}`} aria-pressed={active.has(q.token)} onClick={() => ctl.toggleSearchToken(q.token)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div class="facet-group">
        <h4>Filters</h4>
        <FilterBuilder query={query} fields={fieldsFor(keys)} onChange={(q) => ctl.setSearchQuery(q, true)} loadValues={async (k) => (await ctl.facetValues(k, '')).map((v) => v.value)} />
      </div>
    </div>
  );
}

const KIND_LABELS: Array<{ key: 'text' | 'headings' | 'attributes' | 'code'; label: string; title: string }> = [
  { key: 'text', label: 'Text', title: 'Paragraphs, lists, quotations and tables' },
  { key: 'headings', label: 'Headings', title: 'Heading lines' },
  { key: 'attributes', label: 'Attributes', title: 'The attributes at the top of a page' },
  { key: 'code', label: 'Code', title: 'Fenced code blocks' },
];

/** The shown line of a match: the part before, the match (what it is now and what it becomes), the part after. */
function MatchLine({ m }: { m: { before: string; start: number; end: number; replacement: string } }): JSX.Element {
  const from = Math.max(0, m.start - 30);
  const to = Math.min(m.before.length, m.end + 40);
  return (
    <span class="replace-line">
      {from > 0 && '…'}
      {m.before.slice(from, m.start)}
      <del>{m.before.slice(m.start, m.end)}</del>
      <ins>{m.replacement}</ins>
      {m.before.slice(m.end, to)}
      {to < m.before.length && '…'}
    </span>
  );
}

/** Search and replace over the pages the search picks (all pages when it is empty). */
function ReplaceBox({ ctl }: { ctl: Controller }): JSX.Element {
  const r = ctl.replaceState.value;
  const found = r.found;
  const pickedCount = r.picked.size;
  const set = ctl.setReplace.bind(ctl);
  const field = (name: 'find' | 'replace', label: string, hint: string): JSX.Element => (
    <label class="replace-field">
      <span>{label}</span>
      <input
        type="text"
        value={r[name]}
        placeholder={hint}
        spellcheck={false}
        aria-label={label}
        onInput={(e) => set({ [name]: (e.currentTarget as HTMLInputElement).value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ctl.runReplaceFind(); } }}
      />
    </label>
  );
  const toggle = (key: 'regex' | 'matchCase' | 'wholeWord', text: string, title: string): JSX.Element => (
    <button class={`pill-button small ${r[key] ? 'on' : ''}`} aria-pressed={r[key]} title={title} disabled={key === 'wholeWord' && r.regex} onClick={() => set({ [key]: !r[key] })}>
      {text}
    </button>
  );
  return (
    <div class="replace-box">
      {field('find', 'Find', r.regex ? 'Regular expression' : 'Text to find')}
      {field('replace', 'Replace with', r.regex ? 'Text ($1, $& and $<name> work)' : 'Text to put instead')}
      <div class="replace-options">
        {toggle('regex', '.*', 'Regular expression')}
        {toggle('matchCase', 'Aa', 'Match case')}
        {toggle('wholeWord', 'ab', 'Whole words only (write \\b in a regular expression)')}
      </div>
      <fieldset class="replace-kinds">
        <legend>Look in</legend>
        {KIND_LABELS.map((k) => (
          <label key={k.key} title={k.title}>
            <input type="checkbox" checked={r.kinds[k.key]} onChange={(e) => set({ kinds: { ...r.kinds, [k.key]: (e.currentTarget as HTMLInputElement).checked } })} /> {k.label}
          </label>
        ))}
        <label title="Match the names of pages, and rename them (links to them are updated)">
          <input type="checkbox" checked={r.names} onChange={(e) => set({ names: (e.currentTarget as HTMLInputElement).checked })} /> File names
        </label>
      </fieldset>
      <p class="pref-hint">{ctl.searchQuery.value.trim() ? 'Only in the pages the search above finds.' : 'In every page. Type in the search above, or add filters, to choose pages.'} A match stays within one line.</p>
      <div class="replace-actions">
        <span class="result-count" aria-live="polite">
          {r.loading ? 'Looking…' : found ? `${found.total.toLocaleString()}${found.truncated ? '+' : ''} ${found.total === 1 ? 'match' : 'matches'} in ${found.pages.length} ${found.pages.length === 1 ? 'page' : 'pages'}` : ''}
        </span>
        <button class="pill-button small suggested" disabled={pickedCount === 0 || r.loading} onClick={() => void ctl.applyReplace()}>
          Replace{pickedCount ? ` ${pickedCount.toLocaleString()}` : ''}
        </button>
      </div>
      {r.failure && <p class="search-note warn">{r.failure}</p>}
      {found?.truncated && <p class="search-note warn">Only the first matches are listed. Replace them, then look again for the rest.</p>}
      <ul class="replace-results" aria-label="What would change">
        {found?.pages.map((p) => {
          const keys = [...p.matches.map((m) => `${p.path}\0${m.id}`), ...(p.rename !== null ? [`${p.path}\0name`] : [])];
          const all = keys.every((k) => r.picked.has(k));
          const some = keys.some((k) => r.picked.has(k));
          return (
            <li key={p.path} class="replace-page">
              <div class="replace-page-head">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} aria-label={`Change ${p.title}`} onChange={() => ctl.toggleReplacePick(p.path, null)} />
                <button class="replace-open" title={p.path} onClick={() => void ctl.openReplaceMatch(p.path)}>{p.title}</button>
                <span class="replace-count">{p.matches.length + (p.rename !== null ? 1 : 0)}</span>
              </div>
              {p.rename !== null && (
                <label class="replace-match">
                  <input type="checkbox" checked={r.picked.has(`${p.path}\0name`)} onChange={() => ctl.toggleReplacePick(p.path, 'name')} />
                  <span class="replace-line"><em>name</em> <del>{p.title}</del> <ins>{p.rename}</ins></span>
                </label>
              )}
              {p.matches.map((m) => (
                <label key={m.id} class="replace-match" title={`line ${m.line}, ${m.kind}`}>
                  <input type="checkbox" checked={r.picked.has(`${p.path}\0${m.id}`)} onChange={() => ctl.toggleReplacePick(p.path, m.id)} />
                  <button class="replace-goto" onClick={(e) => { e.preventDefault(); void ctl.openReplaceMatch(p.path, m.line); }}>{m.line}</button>
                  <MatchLine m={m} />
                </label>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SearchPanel({ ctl }: { ctl: Controller }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [facets, setFacets] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const query = ctl.searchQuery.value;
  const st = ctl.searchState.value;
  const sel = ctl.searchSel.value;
  const cs = chips(query);
  const sortChip = cs.find((c) => c.kind === 'sort');
  const sortValue = sortChip ? sortChip.raw.slice(5) : '';
  const sortOptions = SORTS.some((s) => s.value === sortValue) || !sortValue ? SORTS : [...SORTS, { value: sortValue, label: sortValue }];

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ctl.searchFocusTick.value]);

  useEffect(() => {
    list.current?.querySelector('.result.selected')?.scrollIntoView({ block: 'nearest' });
  }, [sel, st.results]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ctl.moveSearchSelection(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void ctl.openSearchResult(sel, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) ctl.setSearchQuery('', true);
      else ctl.closeSearch();
    }
  };

  const shown = st.results.length;
  const total = st.total ?? shown;

  return (
    <div class="search-panel">
      <div class="search-bar">
        <Icon name="search" class="search-icon" />
        <input
          ref={input}
          class="search-input"
          type="text"
          role="searchbox"
          aria-label="Search pages"
          placeholder="Search pages…"
          spellcheck={false}
          value={query}
          onInput={(e) => ctl.setSearchQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button class="icon-button small" title="Clear (Esc)" aria-label="Clear search" onClick={() => { ctl.setSearchQuery('', true); ctl.searchFocusTick.value++; }}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {cs.length > 0 && (
        <div class="chip-row" aria-label="Active filters">
          {cs.map((c) => (
            <span key={c.start} class={`chip ${c.kind} ${c.negated ? 'negated' : ''}`}>
              <span class="chip-label">{c.label}</span>
              <button class="chip-x" aria-label={`Remove filter ${c.label}`} onClick={() => ctl.setSearchQuery(removeChip(query, c), true)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div class="search-tools">
        <button class={`pill-button small ${facets ? 'on' : ''}`} aria-expanded={facets} onClick={() => setFacets(!facets)}>
          Filters
        </button>
        <label class="sort-select">
          <span>Sort</span>
          <select value={sortValue} onChange={(e) => ctl.setSearchSort((e.currentTarget as HTMLSelectElement).value || null)}>
            {sortOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            {ctl.facetKeys.value.filter((k) => !sortOptions.some((s) => s.value === k.key)).map((k) => <option key={`k-${k.key}`} value={k.key}>{k.key}</option>)}
          </select>
        </label>
        <button
          class={`pill-button small ${ctl.replaceState.value.on ? 'on' : ''}`}
          aria-pressed={ctl.replaceState.value.on}
          title="Search and replace over the pages"
          onClick={() => ctl.setReplace({ on: !ctl.replaceState.value.on })}
        >
          Replace
        </button>
        <span class="result-count" aria-live="polite">
          {st.loading && shown === 0 ? 'Searching…' : st.searched ? `${total.toLocaleString()} ${total === 1 ? 'page' : 'pages'}${total > shown ? ` (first ${shown})` : ''}` : ''}
        </span>
      </div>

      {facets && <Facets ctl={ctl} />}

      {ctl.replaceState.value.on && <ReplaceBox ctl={ctl} />}

      {st.errors.length > 0 && <p class="search-note warn">{st.errors.join(' ')}</p>}
      {st.failure && <p class="search-note warn">Search failed: {st.failure}</p>}

      <ul class="results" role="listbox" aria-label="Search results" ref={list} hidden={ctl.replaceState.value.on}>
        {st.results.map((r, i) => {
          const crumbs = breadcrumb(r.path);
          const parts = segments(r.snippet);
          return (
            <li key={r.path} role="option" aria-selected={i === sel} class={`result ${i === sel ? 'selected' : ''} ${r.isVirtual ? 'virtual' : ''}`} draggable={!coarse} onDragStart={(e) => { e.dataTransfer?.setData('application/x-cave-page', r.path); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyLink'; }} onClick={() => void ctl.openSearchResult(i, false)} onDblClick={() => void ctl.openSearchResult(i, true)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: r.path }); }}>
              <div class="result-title">
                <Icon name={r.isVirtual ? 'folder' : 'page'} class="row-icon" />
                <span class="result-name">{r.title}</span>
                <button class="icon-button small result-reveal" title="Show in the file tree" aria-label="Show in the file tree" onClick={(e) => { e.stopPropagation(); void ctl.revealResultInTree(r.path); }}>
                  <Icon name="folder" size={13} />
                </button>
              </div>
              {crumbs.length > 0 && <div class="result-path">{crumbs.join(' › ')}</div>}
              {parts.length > 0 && (
                <div class="result-snippet">
                  {parts.map((p, j) => (p.match ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!query.trim() && !ctl.replaceState.value.on && (
        <div class="search-help">
          <p>Type to search titles and text. Narrow with filters:</p>
          <div class="facet-chips">
            {['status:draft', 'under:"Theology"', 'has:due', '-tags:done'].map((ex) => (
              <button key={ex} class="facet-chip" onClick={() => ctl.toggleSearchToken(ex)}>{ex}</button>
            ))}
          </div>
          <p class="small">Phrases use quotes. <code>sort:-title</code> reverses a sort; <code>links-to:Grace</code> finds backlinks.</p>
        </div>
      )}
      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem icon="page" label="Open in New Tab" onClick={() => { const p = menu.path; setMenu(null); void ctl.openInNewTab(p); }} />
          <MenuItem icon="folder" label="Show in the File Tree" onClick={() => { const p = menu.path; setMenu(null); void ctl.revealResultInTree(p); }} />
          <div class="menu-separator" />
          {ctl.caps.systemFileActions && <MenuItem icon="folder" label="Reveal in File Explorer" onClick={() => { const p = menu.path; setMenu(null); void ctl.revealPage(p); }} />}
        </FloatingMenu>
      )}
      {st.searched && !st.loading && shown === 0 && st.errors.length === 0 && !st.failure && <p class="empty-note">No pages match.</p>}
    </div>
  );
}
