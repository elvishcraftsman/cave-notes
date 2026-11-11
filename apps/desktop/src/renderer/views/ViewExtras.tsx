import { COLOR_NAMES, colorValue, newPageContent, newPageDefaults, type ColorRule } from '@cave-notes/ui-views';
import { keyInfo } from './cells';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AttributeKey, RelationDef, RelationPage } from '../../shared/api';
import type { Controller } from '../controller';
import { stripExt } from '../paths';

/** What tells pages apart: the same path can be a page of this workspace and of another. */
const pageKey = (p: { path: string; workspace?: string }): string => (p.workspace ? `${p.workspace.toLowerCase()}\u0000${p.path}` : p.path);
import type { AttrValue } from '../../shared/api';

// ---------------------------------------------------------------- pager

/** Page numbers to show: the first, the last and a few around the current one, with null for a gap. */
export function pageWindow(current: number, last: number): Array<number | null> {
  const want = new Set([1, 2, current - 2, current - 1, current, current + 1, current + 2, last - 1, last].filter((n) => n >= 1 && n <= last));
  const out: Array<number | null> = [];
  let prev = 0;
  for (const n of [...want].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

export const PAGE_SIZES = [10, 25, 50, 100, 0];

/** Previous, numbered pages and next, like the bottom of a page of search results. */
export function Pager({ page, size, total, onPage, onSize }: { page: number; size: number; total: number; onPage: (n: number) => void; onSize: (n: number) => void }): JSX.Element | null {
  const last = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  if (total <= 10) return null;
  return (
    <nav class="vb-pager" aria-label="Pages of results">
      {last > 1 && (
        <>
          <button class="pill-button small" data-pager="prev" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
          {pageWindow(page, last).map((n, i) =>
            n === null ? (
              <span key={`gap${i}`} class="vb-pager-gap" aria-hidden="true">…</span>
            ) : (
              <button key={n} class={`vb-page-num ${n === page ? 'on' : ''}`} data-page={n} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>
            ),
          )}
          <button class="pill-button small" data-pager="next" disabled={page >= last} onClick={() => onPage(page + 1)}>Next ›</button>
        </>
      )}
      <label class="vb-pager-size">
        Per page
        <select aria-label="Results per page" value={String(size)} onChange={(e) => onSize(Number((e.currentTarget as HTMLSelectElement).value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={String(n)}>{n === 0 ? 'All' : n}</option>)}
        </select>
      </label>
    </nav>
  );
}

// ---------------------------------------------------------------- sort criteria

/** Several sort criteria: "Sort by" a property, then "then by" others, each up or down. */
export function SortEditor({ sort, options, onChange }: { sort: string | undefined; options: string[]; onChange: (sort: string | null) => void }): JSX.Element {
  const items = (sort ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const write = (list: string[]): void => onChange(list.length ? list.join(',') : null);
  const used = new Set(items.map((i) => i.replace(/^-/, '')));
  return (
    <div class="vb-sorts" data-panel-body="sort">
      {items.map((it, i) => {
        const desc = it.startsWith('-');
        const key = it.replace(/^-/, '');
        return (
          <div key={`${i}-${key}`} class="vb-sort-row">
            <span class="vb-dim">{i === 0 ? 'Sort by' : 'then by'}</span>
            <select aria-label={i === 0 ? 'Sort by' : 'Then by'} value={key} onChange={(e) => write(items.map((x, j) => (j === i ? `${desc ? '-' : ''}${(e.currentTarget as HTMLSelectElement).value}` : x)))}>
              {options.filter((o) => o === key || !used.has(o)).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <button class="icon-button small" aria-label={desc ? 'Descending' : 'Ascending'} title={desc ? 'Descending' : 'Ascending'} onClick={() => write(items.map((x, j) => (j === i ? (desc ? key : `-${key}`) : x)))}>{desc ? '↓' : '↑'}</button>
            <button class="icon-button small" aria-label="Remove this sort" title="Remove" onClick={() => write(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        );
      })}
      {options.some((o) => !used.has(o)) && (
        <button class="pill-button small" data-add-sort onClick={() => write([...items, options.find((o) => !used.has(o))!])}>{items.length === 0 ? 'Sort by…' : 'Then by…'}</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- colour rules

/** "Colour pages red when …": each rule is a query and a colour; the first that matches a page wins. */
export function ColorRules({ rules, onChange }: { rules: ColorRule[]; onChange: (rules: ColorRule[]) => void }): JSX.Element {
  const [drafts, setDrafts] = useState(rules.map((r) => r.when));
  useEffect(() => setDrafts(rules.map((r) => r.when)), [rules.map((r) => r.when).join('\u0000')]);
  const set = (i: number, patch: Partial<ColorRule>): void => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div class="vb-colors" data-panel-body="colors">
      {rules.map((r, i) => (
        <div key={i} class="vb-color-row">
          <span class="vb-dim">Colour</span>
          <select aria-label="Colour" value={COLOR_NAMES.includes(r.color as never) ? r.color : 'custom'} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; set(i, { color: v === 'custom' ? '#3e63dd' : v }); }}>
            {COLOR_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="custom">custom…</option>
          </select>
          {!COLOR_NAMES.includes(r.color as never) && <input type="color" aria-label="Custom colour" value={colorValue(r.color) ?? '#3e63dd'} onInput={(e) => set(i, { color: (e.currentTarget as HTMLInputElement).value })} />}
          <span class="vb-swatch" style={{ background: colorValue(r.color) ?? 'transparent' }} />
          <span class="vb-dim">when</span>
          <input
            type="text"
            class="vb-color-when"
            aria-label="Query for this colour"
            placeholder="due:<$now.day -status:done"
            value={drafts[i] ?? ''}
            onInput={(e) => setDrafts((d) => d.map((x, j) => (j === i ? (e.currentTarget as HTMLInputElement).value : x)))}
            onBlur={() => (drafts[i] ?? '').trim() !== r.when && (drafts[i] ?? '').trim() !== '' && set(i, { when: (drafts[i] ?? '').trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          <button class="icon-button small" aria-label="Remove this colour rule" onClick={() => onChange(rules.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button class="pill-button small" data-add-color onClick={() => onChange([...rules, { when: 'has:title', color: COLOR_NAMES[rules.length % 7]! }])}>Add colour rule</button>
      <p class="vb-hint">Uses the query language of the filter, including <code>$now</code> (<code>due:&lt;$now.day</code> is overdue) and <code>NOT</code>/<code>OR</code>. The first rule that matches a page colours it.</p>
    </div>
  );
}

// ---------------------------------------------------------------- add a page

export interface NewRowProps {
  ctl: Controller;
  query: string;
  columns: string[];
  /** the view says which fields to ask for (newFields): no others are shown, though what its filters imply is still written */
  onlyListed?: boolean;
  keys: AttributeKey[];
  /** create the page; resolves true when it was made */
  onCreate: (title: string, content: string, under: string | null) => Promise<boolean>;
  /** called after the row closes, so the "New" button can take focus */
  onClose: () => void;
}

/**
 * One row of fields for a new page. Nothing is made until Enter or Save; Escape or Cancel drops the row. Fields start
 * with the values the view's own filters imply (status:todo gives status = todo), so the page shows up in the view.
 */
export function NewRow({ ctl, query, columns, onlyListed, keys, onCreate, onClose }: NewRowProps): JSX.Element {
  const defaults = newPageDefaults(query);
  // the fields come in the order of the view's columns; the title sits where the title column is; whatever the filters imply
  // but the view does not show follows at the end
  const shownFields = columns.filter((c) => c !== 'path' && c !== 'modified' && !c.startsWith('filename') && c !== 'filetype');
  const order = shownFields.includes('title') ? shownFields : ['title', ...shownFields];
  // a column of a relation: the forward side is chosen here, like in the view; the other side belongs to pages that do not exist yet
  const relOf = (k: string): { def: RelationDef; back: boolean } | null => {
    for (const r of ctl.saved.value.relations) {
      if (r.name === k) return { def: r, back: false };
      if ((r.backname ?? r.reverse) === k) return { def: r, back: true };
    }
    return null;
  };
  const names = [...new Set(onlyListed ? order : [...order, ...Object.keys(defaults.attrs)])].filter((n) => !relOf(n)?.back);
  const [linked, setLinked] = useState<Record<string, RelationPage[]>>({});
  const [title, setTitle] = useState('');
  // a date field starts on today (unless the view's own filters say otherwise); clear it to leave it empty
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(names.filter((n) => keyInfo(keys, n)?.type === 'date').map((n) => [n, today])),
    ...defaults.attrs,
  }));
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLElement>(null);
  useEffect(() => first.current?.focus(), []);

  const save = async (): Promise<void> => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const types = Object.fromEntries(keys.map((k) => [k.key, { type: k.type, list: !!k.list }]));
    const links: Record<string, string[]> = {};
    for (const [k, pages] of Object.entries(linked)) {
      const r = relOf(k);
      if (r && pages.length) links[r.def.attribute] = (r.def.multiple === false ? pages.slice(0, 1) : pages).map((p) => (p.workspace ? `${p.workspace}::${stripExt(p.path)}` : stripExt(p.path)));
    }
    const ok = await onCreate(t, newPageContent(t, values, types, links), defaults.under);
    setBusy(false);
    if (ok) onClose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else e.stopPropagation();
  };
  const set = (n: string, v: string): void => setValues((cur) => ({ ...cur, [n]: v }));
  const label = (n: string): string => (n === 'title' ? 'Title' : n);
  return (
    <div class="vb-newrow" data-new-row role="group" aria-label="New page" onKeyDown={onKey as never}>
      {names.map((n) => {
        if (n === 'title') {
          return <GrowText key={n} fieldRef={first} class="vb-new-title" label="Title" placeholder="Title" value={title} onValue={setTitle} />;
        }
        const rel = relOf(n);
        if (rel) {
          return <NewRelationField key={n} ctl={ctl} k={n} multiple={rel.def.multiple !== false} value={linked[n] ?? []} onChange={(v) => setLinked((cur) => ({ ...cur, [n]: v }))} />;
        }
        const info = keyInfo(keys, n);
        const type = info?.type ?? 'string';
        if (type === 'bool' && !info?.list) {
          const on = values[n] === 'true';
          return (
            <label key={n} class="vb-new-bool" title={n}>
              <input type="checkbox" class="vb-checkbox" aria-label={n} checked={on} onChange={(e) => set(n, (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')} />
              <span class="vb-dim">{n}</span>
            </label>
          );
        }
        if (info?.values?.length && !info.list) {
          return (
            <select key={n} class="vb-new-field" aria-label={n} value={values[n] ?? ''} onChange={(e) => set(n, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{n}</option>
              {info.values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          );
        }
        if (info?.values?.length && info.list) {
          // several of the declared values: one toggle for each
          const chosen = (values[n] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
          return (
            <span key={n} class="vb-new-multi" role="group" aria-label={n} title={n}>
              <span class="vb-dim">{n}</span>
              {info.values.map((v) => (
                <button key={v} type="button" class={`vb-chip ${chosen.includes(v) ? 'on' : ''}`} aria-pressed={chosen.includes(v)} onClick={() => set(n, (chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]).join(', '))}>{v}</button>
              ))}
            </span>
          );
        }
        if (type === 'date' || type === 'number') {
          return <input key={n} class="vb-new-field" type={type === 'date' ? 'date' : 'number'} aria-label={n} placeholder={n} value={values[n] ?? ''} onInput={(e) => set(n, (e.currentTarget as HTMLInputElement).value)} />;
        }
        return <GrowText key={n} class="vb-new-field" label={label(n)} placeholder={n} value={values[n] ?? ''} onValue={(v) => set(n, v)} />;
      })}
      <button class="pill-button small suggested" data-save-new disabled={busy || title.trim() === ''} onClick={() => void save()}>Save</button>
      <button class="pill-button small" aria-label="Cancel new page" onClick={onClose}>Cancel</button>
    </div>
  );
}

/** The pages of a relation for a page that is about to be made: chips and a field with the same suggestions as in the view. */
function NewRelationField({ ctl, k, multiple, value, onChange }: { ctl: Controller; k: string; multiple: boolean; value: RelationPage[]; onChange: (v: RelationPage[]) => void }): JSX.Element {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RelationPage[]>([]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number; w: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void ctl.relationCandidates(k, 'forward', text, value.map(pageKey)).then((r) => {
        if (mine !== seq.current) return;
        setOptions(r);
        setActive(0);
      });
    }, text ? 90 : 0);
    return () => clearTimeout(t);
  }, [open, text, value.length]);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!open || !r) return;
    const w = Math.max(r.width, 220);
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: Math.min(r.bottom + 2, window.innerHeight - 250), w });
  }, [open, value.length, text]);
  // a page for the text typed, made now and linked; the row it is for is not saved yet, so this does not leave it to open the page
  const createHere = async (name: string): Promise<void> => {
    const made = await ctl.createNamedPage(name, { name: k, side: 'forward' });
    if (!made) return;
    onChange(multiple ? [...value, made] : [made]);
    setText('');
    if (!multiple) setOpen(false);
  };
  const pick = (p: RelationPage): void => {
    onChange(multiple ? [...value.filter((d) => pageKey(d) !== pageKey(p)), p] : [p]);
    setText('');
    if (!multiple) setOpen(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (options.length) setActive((active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      // with text, Enter chooses the highlighted page; with none it reaches the row, which saves
      const o = options[active];
      if (text.trim() && o) { e.preventDefault(); e.stopPropagation(); pick(o); }
    } else if (e.key === 'Escape' && open) {
      // the first Escape closes the list; the next one reaches the row and drops it
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setText('');
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      e.stopPropagation();
      onChange(value.slice(0, -1));
    }
  };
  return (
    <span ref={box} class="vb-relations vb-relation-edit vb-new-relation" onFocusOut={(e) => { const to = e.relatedTarget as Node | null; if (!(to && box.current?.contains(to))) { setOpen(false); setText(''); } }}>
      {value.map((p) => (
        <span key={pageKey(p)} class="vb-relation vb-relation-chip" title={p.title}>
          <span class="vb-relation-title">{p.title}</span>
          <button type="button" class="vb-relation-x" aria-label={`Remove ${p.title}`} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(value.filter((d) => pageKey(d) !== pageKey(p)))}>×</button>
        </span>
      ))}
      <input
        class="vb-relation-input"
        value={text}
        placeholder={value.length === 0 || !multiple ? k : ''}
        aria-label={`${k}: find a page`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onInput={(e) => { setText((e.currentTarget as HTMLInputElement).value); setOpen(true); }}
        onKeyDown={onKey as never}
      />
      {open && pos && (
        <div class="vb-multi-pop vb-suggest" role="listbox" style={{ left: `${pos.x}px`, top: `${pos.y}px`, minWidth: `${pos.w}px` }}>
          {options.length === 0 && <div class="vb-suggest-none">{text ? 'No page matches' : 'No pages to choose from'}</div>}
          {options.map((o, i) => (
            <div key={o.path} role="option" aria-selected={i === active} class={`vb-suggest-item ${i === active ? 'on' : ''}`} title={o.title} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>{o.title}</div>
          ))}
          {text.trim() !== '' && !options.some((o) => o.title.toLowerCase() === text.trim().toLowerCase()) && (
            <div role="option" aria-selected={false} class="vb-suggest-item vb-suggest-create" title="Make this page and link it (it is not opened: this new page is not saved yet)" onMouseDown={(e) => { e.preventDefault(); void createHere(text.trim()); }}>Create page “{text.trim()}”</div>
          )}
        </div>
      )}
    </span>
  );
}

/** A text field that is one line high until its text needs more; then it grows downward and keeps its width. Enter is left to the row (it saves). */
function GrowText({ value, onValue, label, placeholder, class: cls, fieldRef }: { value: string; onValue: (v: string) => void; label: string; placeholder: string; class: string; fieldRef?: { current: HTMLElement | null } | undefined }): JSX.Element {
  const el = useRef<HTMLTextAreaElement>(null);
  const fit = (): void => {
    const t = el.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  return (
    <textarea
      ref={(t) => { el.current = t; if (fieldRef) fieldRef.current = t; }}
      class={`vb-grow ${cls}`}
      rows={1}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value.replace(/\n/g, ' '))}
    />
  );
}

// ---------------------------------------------------------------- properties

/**
 * Which properties a view shows, and in what order. The shown ones come first, in their order, and can be moved with
 * the arrows or by dragging; the others are listed below to be switched on. File name and file type are here too.
 */
export function PropsPanel({ shown, available, onChange }: { shown: string[]; available: string[]; onChange: (columns: string[]) => void }): JSX.Element {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const rest = available.filter((c) => !shown.includes(c));
  const move = (c: string, to: number): void => {
    const list = shown.filter((x) => x !== c);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, c);
    onChange(list);
  };
  const drop = (target: string): void => {
    if (drag && drag !== target) move(drag, shown.indexOf(target));
    setDrag(null);
    setOver(null);
  };
  return (
    <div class="vb-props">
      <ul class="vb-props-shown" aria-label="Shown properties">
        {shown.map((c, i) => (
          <li
            key={c}
            class={`vb-prop ${over === c ? 'over' : ''}`}
            draggable
            onDragStart={() => setDrag(c)}
            onDragOver={(e) => { e.preventDefault(); setOver(c); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={(e) => { e.preventDefault(); drop(c); }}
          >
            <span class="vb-grip" aria-hidden="true">⠿</span>
            <label class="vb-check">
              <input type="checkbox" checked disabled={c === 'title'} onChange={() => onChange(shown.filter((x) => x !== c))} />
              {c}
            </label>
            <button class="icon-button small" aria-label={`Move ${c} earlier`} disabled={i === 0} onClick={() => move(c, i - 1)}>↑</button>
            <button class="icon-button small" aria-label={`Move ${c} later`} disabled={i === shown.length - 1} onClick={() => move(c, i + 1)}>↓</button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <div class="vb-checks" aria-label="Other properties">
          {rest.map((c) => (
            <label key={c} class="vb-check">
              <input type="checkbox" checked={false} onChange={() => onChange([...shown, c])} />
              {c}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bulk actions

/** What can be done to the rows that are ticked: duplicate, move, delete, or set one attribute on all of them. */
export function SelectionBar({ count, keys, onDuplicate, onMove, onDelete, onSet, onClear }: {
  count: number;
  keys: AttributeKey[];
  onDuplicate: () => void;
  onMove: () => void;
  onDelete: () => void;
  onSet: (key: string, value: AttrValue | null) => void;
  onClear: () => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const info = keyInfo(keys, key);
  const apply = (clear: boolean): void => {
    if (!key) return;
    if (clear || value === '') return onSet(key, null);
    if (info?.list) return onSet(key, value.split(',').map((x) => x.trim()).filter(Boolean));
    if (info?.type === 'number' && !Number.isNaN(Number(value))) return onSet(key, Number(value));
    if (info?.type === 'bool') return onSet(key, value === 'true');
    onSet(key, value);
  };
  return (
    <div class="vb-selection" role="toolbar" aria-label="Selected pages">
      <strong>{count} selected</strong>
      <button class="pill-button small" onClick={onDuplicate}>Duplicate</button>
      <button class="pill-button small" onClick={onMove}>Move…</button>
      <button class="pill-button small destructive" onClick={onDelete}>Delete</button>
      <span class="vb-set">
        <select aria-label="Attribute to set" value={key} onChange={(e) => { setKey((e.currentTarget as HTMLSelectElement).value); setValue(''); }}>
          <option value="">Set attribute…</option>
          {keys.map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
        </select>
        {key && (info?.type === 'bool' ? (
          <select aria-label="Value" value={value} onChange={(e) => setValue((e.currentTarget as HTMLSelectElement).value)}><option value="">(empty)</option><option value="true">true</option><option value="false">false</option></select>
        ) : info?.values?.length && !info.list ? (
          <select aria-label="Value" value={value} onChange={(e) => setValue((e.currentTarget as HTMLSelectElement).value)}><option value="">(empty)</option>{info.values.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        ) : (
          <input aria-label="Value" type={info?.type === 'date' ? 'date' : info?.type === 'number' ? 'number' : 'text'} placeholder={info?.list ? 'a, b, c' : 'value'} value={value} onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') apply(false); }} />
        ))}
        {key && <button class="pill-button small" onClick={() => apply(false)}>Apply</button>}
        {key && <button class="pill-button small" title="Take the attribute away from every selected page" onClick={() => apply(true)}>Remove</button>}
      </span>
      <button class="pill-button small flat" onClick={onClear}>Clear selection</button>
    </div>
  );
}
