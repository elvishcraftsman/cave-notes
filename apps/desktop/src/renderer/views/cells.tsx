import type { AttributeKey, AttrValue, RelationDef, RelationPage } from '../../shared/api';
import { attrsOf, clipTitle, dayOf, formatAttr, type Row } from '@cave-notes/ui-views';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Controller, RelationMemory } from '../controller';
import { Icon } from '../components/icons';

/**
 * Editable cells of a database view. What a cell offers depends on the attribute's type:
 *   boolean  → a checkbox             one value from `values` → a dropdown
 *   a list with `values` → a multi-select dropdown            date → a date picker
 *   anything else → text (numbers are checked), click to edit
 * Edits go straight to the page's own frontmatter; an inherited value is overridden there.
 */
export function EditableCell({ ctl, row, k, keys }: { ctl: Controller; row: Row; k: string; keys: AttributeKey[] }): JSX.Element {
  const info = keyInfo(keys, k);
  const a = attrsOf(row, k);
  // show the new value at once; the view catches up when the index does
  const sig = JSON.stringify(a.map((x) => x.text));
  const [shown, setShown] = useState<AttrValue | null | undefined>(undefined);
  useEffect(() => setShown(undefined), [sig]);
  const save = (value: AttrValue | null): void => {
    setShown(value);
    void ctl.setPageAttribute(row.path, k, value).then((ok) => {
      if (!ok) setShown(undefined);
    });
  };
  const texts: string[] = shown === undefined ? a.map((x) => x.text) : shown === null ? [] : Array.isArray(shown) ? shown : [String(shown)];
  const type = info?.type ?? a[0]?.type ?? 'string';
  const readOnly = row.isVirtual; // a folder without a page file has nowhere to keep attributes

  if (readOnly) return <span class="vb-val">{a.map((x) => formatAttr(x)).join(', ')}</span>;

  if (type === 'bool' && !info?.list) {
    const on = shown === undefined ? a[0]?.text === 'true' : shown === true;
    return <input type="checkbox" class="vb-checkbox" checked={on} aria-label={k} onChange={(e) => save((e.currentTarget as HTMLInputElement).checked)} />;
  }
  if (info?.values?.length && !info.list) {
    const cur = texts[0] ?? '';
    const options = cur && !info.values.includes(cur) ? [cur, ...info.values] : info.values;
    return (
      <select class="vb-input" aria-label={k} value={cur} onChange={(e) => save((e.currentTarget as HTMLSelectElement).value || null)}>
        <option value="">—</option>
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  if (info?.values?.length && info.list) return <MultiSelect label={k} values={info.values} chosen={texts} onChange={(v) => save(v.length ? v : null)} />;
  if (type === 'date' && !info?.list) return <DateEdit value={shown === undefined ? (dayOf(row, k) ?? '') : String(shown ?? '')} onChange={(v) => save(v || null)} />;
  return <TextEdit value={texts.join(', ')} number={type === 'number' && !info?.list} list={!!info?.list} onCommit={(v) => ctl.toast(v)} save={save} />;
}

function TextEdit({ value, number, list, save, onCommit }: { value: string; number: boolean; list: boolean; save: (v: AttrValue | null) => void; onCommit: (problem: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const commit = (raw: string): void => {
    setEditing(false);
    const v = raw.trim();
    if (v === value.trim()) return;
    if (v === '') return save(null);
    if (number) {
      const n = Number(v);
      if (!Number.isFinite(n)) return onCommit(`“${v}” is not a number.`);
      return save(n);
    }
    if (list) return save(v.split(',').map((x) => x.trim()).filter(Boolean));
    save(v);
  };
  if (!editing) {
    return (
      <button class={number ? 'vb-cell-text vb-number' : 'vb-cell-text'} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
        {value}
      </button>
    );
  }
  return (
    <input
      ref={input}
      class={number ? 'vb-input vb-number' : 'vb-input'}
      type={number ? 'number' : 'text'}
      step={number ? 'any' : undefined}
      defaultValue={value}
      aria-label="Edit value"
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.currentTarget as HTMLInputElement).value);
        else if (e.key === 'Escape') setEditing(false);
        e.stopPropagation();
      }}
      onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
    />
  );
}

function DateEdit({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      try {
        input.current?.showPicker?.();
      } catch {
        /* needs a user gesture in some builds: the field is focused anyway */
      }
    }
  }, [editing]);
  if (!editing) {
    return (
      <button class="vb-cell-text" onClick={() => setEditing(true)} aria-label="Pick a date">
        {value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
      </button>
    );
  }
  return (
    <input
      ref={input}
      class="vb-input"
      type="date"
      value={value}
      onChange={(e) => {
        onChange((e.currentTarget as HTMLInputElement).value);
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false);
        e.stopPropagation();
      }}
    />
  );
}

function MultiSelect({ label, values, chosen, onChange }: { label: string; values: string[]; chosen: string[]; onChange: (v: string[]) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const options = [...values, ...chosen.filter((c) => !values.includes(c))];
  const toggle = (v: string): void => onChange(chosen.includes(v) ? chosen.filter((c) => c !== v) : options.filter((o) => o === v || chosen.includes(o)));
  return (
    <span class="vb-multi">
      <button
        ref={btn}
        class="vb-multi-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos({ x: r.left, y: Math.min(r.bottom + 4, window.innerHeight - 260) });
          setOpen(!open);
        }}
      >
        {chosen.length === 0 ? <span class="vb-dim">—</span> : chosen.map((c) => <span key={c} class="vb-chip" data-v={c}>{c}</span>)}
      </button>
      {open && pos && (
        <div ref={pop} class="vb-multi-pop" role="listbox" aria-multiselectable="true" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
          {options.map((o) => (
            <label key={o} class="vb-multi-opt">
              <input type="checkbox" class="vb-checkbox" checked={chosen.includes(o)} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * A relation in a view: the pages it names, each a link. Click the cell (or press Enter on it) to edit: a field opens
 * with the pages as chips and a list of the pages the relation can name, narrowing as you type. Nothing is saved while
 * you are choosing; leaving the field (Enter on an empty field, Tab, a click elsewhere) saves, Escape throws the change away.
 * Questions about conflicts are asked only then, never in the middle of typing.
 */
/** What tells pages apart: the same path can be a page of this workspace and of another. */
const pageKey = (p: RelationPage): string => (p.workspace ? `${p.workspace.toLowerCase()}\u0000${p.path}` : p.path);

export function RelationCell({ ctl, row, k, rel, side, memory }: { ctl: Controller; row: Row; k: string; rel: RelationDef; side: 'forward' | 'back'; /** what the table remembers about links that cannot be made on both sides */ memory?: RelationMemory }): JSX.Element {
  const pages: RelationPage[] = row.related?.[k] ?? [];
  const sig = JSON.stringify(pages.map(pageKey));
  const multiple = side === 'forward' ? rel.multiple !== false : rel.backmultiple !== false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState<RelationPage[]>(pages);
  // the list as it is right now: picks that follow each other quickly, and leaving the field, must not work from a list that is one pick behind
  const draftNow = useRef<RelationPage[]>(pages);
  const setDraft = (next: RelationPage[]): void => {
    draftNow.current = next;
    setDraftState(next);
  };
  const [text, setText] = useState('');
  const [options, setOptions] = useState<RelationPage[]>([]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; max: number } | null>(null);
  // what the cell shows until the view catches up with a save
  const [pending, setPending] = useState<RelationPage[] | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const open = useRef(false);
  useEffect(() => setPending(null), [sig]);

  const shown = pending ?? pages;

  const start = (): void => {
    if (editing) return;
    open.current = true;
    setDraft(shown);
    setText('');
    setActive(0);
    setEditing(true);
  };
  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus({ preventScroll: true });
  }, [editing]);

  // the list of pages to pick from, for what has been typed
  useEffect(() => {
    if (!editing) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void ctl.relationCandidates(k, side, text, [row.path, ...draft.map(pageKey)]).then((r) => {
        if (mine !== seq.current) return;
        setOptions(r);
        setActive(0);
      });
    }, text ? 90 : 0);
    return () => clearTimeout(t);
  }, [editing, text, draft.length]);
  useLayoutEffect(() => {
    if (!editing) return;
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    // at most 30em wide, never past the edge of the window (it moves left before it shrinks below 16em)
    const room = window.innerWidth - 16;
    const maxW = Math.min(480, room);
    const x = Math.max(8, Math.min(r.left, window.innerWidth - Math.min(maxW, 256) - 8));
    setPos({ x, y: Math.min(r.bottom + 2, window.innerHeight - 250), w: Math.min(Math.max(r.width, 220), maxW), max: Math.min(maxW, window.innerWidth - x - 8) });
  }, [editing, draft.length, text]);

  const finish = (commit: boolean, final: RelationPage[] = draftNow.current): void => {
    if (!open.current) return; // leaving the field after it was already closed (a pick closes it, then focus moves)
    open.current = false;
    setEditing(false);
    setText('');
    if (!commit) return;
    const same = final.length === shown.length && final.every((p, i) => pageKey(p) === (shown[i] ? pageKey(shown[i]!) : null));
    if (same) return;
    setPending(final);
    void ctl.editRelation(row.path, row.title, rel.name, side, final, memory).then((ok) => {
      if (!ok) setPending(null);
    });
  };
  const pick = (p: RelationPage): void => {
    if (!multiple) return finish(true, [p]);
    setDraft([...draftNow.current.filter((d) => pageKey(d) !== pageKey(p)), p]);
    setText('');
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) setActive((active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (text.trim() && o) pick(o);
      else if (!text.trim()) finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Backspace' && text === '' && draftNow.current.length > 0) {
      setDraft(draftNow.current.slice(0, -1));
    }
  };

  // The cell always keeps its normal look in the table, so the column keeps its width. Editing happens in a box laid over
  // the cell (it takes no room of its own), and the dropdown button at the end of the cell opens it.
  return (
    <span class={`vb-relation-wrap ${editing ? 'is-editing' : ''}`}>
      <span
        class="vb-relation-cell"
        role="button"
        tabIndex={editing ? -1 : 0}
        aria-hidden={editing}
        title="Click to change"
        onClick={(e) => {
          e.stopPropagation();
          if (!(e.target as HTMLElement).closest('a, button')) start();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('a, button')) {
            e.preventDefault();
            start();
          }
        }}
      >
        <span class="vb-relations vb-relation-chips">
          {shown.map((p) => <a key={pageKey(p)} class={`vb-relation ${p.workspace ? 'vb-ext' : ''}`} href="#" title={p.workspace ? `${p.title} (in ${p.workspace})` : p.title} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (p.workspace) void ctl.openWorkspaceLink(p.workspace, p.path, null); else void ctl.openPage(p.path, { reveal: true }); }}>{clipTitle(p.title)}</a>)}
          {shown.length === 0 && <span class="vb-dim vb-relation-empty">—</span>}
        </span>
        <button
          type="button"
          class="vb-relation-drop"
          aria-label={multiple ? `${k}: add or change pages` : `${k}: change the page`}
          title={multiple ? 'Add or change pages' : 'Change the page'}
          aria-haspopup="listbox"
          aria-expanded={editing}
          tabIndex={editing ? -1 : 0}
          onClick={(e) => {
            e.stopPropagation();
            start();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Icon name="chevron-down" size={11} />
        </button>
      </span>
      {editing && (
        <span
          ref={box}
          class="vb-relations vb-relation-edit"
          onClick={(e) => e.stopPropagation()}
          onFocusOut={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && box.current?.contains(to)) return;
            finish(true);
          }}
        >
          {draft.map((p) => (
            <span key={pageKey(p)} class={`vb-relation vb-relation-chip ${p.workspace ? 'vb-ext' : ''}`} title={p.workspace ? `${p.title} (in ${p.workspace})` : p.title}>
              <span class="vb-relation-title">{clipTitle(p.title)}</span>
              <button type="button" class="vb-relation-x" aria-label={`Remove ${p.title}`} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(draftNow.current.filter((d) => pageKey(d) !== pageKey(p)))}>×</button>
            </span>
          ))}
          <input
            ref={input}
            class="vb-relation-input"
            value={text}
            placeholder={draft.length === 0 || !multiple ? 'Type to find a page' : ''}
            aria-label={`${k}: find a page`}
            aria-autocomplete="list"
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKey}
          />
          {pos && (
            <div class="vb-multi-pop vb-suggest" role="listbox" style={{ left: `${pos.x}px`, top: `${pos.y}px`, minWidth: `${Math.min(pos.w, pos.max)}px`, maxWidth: `${pos.max}px` }}>
              {options.length === 0 && <div class="vb-suggest-none">{text ? 'No page matches' : 'No pages to choose from'}</div>}
              {options.map((o, i) => (
                <div
                  key={pageKey(o)}
                  role="option"
                  aria-selected={i === active}
                  class={`vb-suggest-item ${i === active ? 'on' : ''}`}
                  title={o.workspace ? `${o.title} (in ${o.workspace})` : o.title}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {o.title}
                  {o.workspace && <span class="vb-suggest-ws"> · {o.workspace}</span>}
                </div>
              ))}
            </div>
          )}
        </span>
      )}
    </span>
  );
}

/** A page's title in a view: click opens the page; double-click (or the pencil, or F2) edits it, which renames the page. */
export function EditableTitle({ ctl, row }: { ctl: Controller; row: Row }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const commit = (raw: string): void => {
    setEditing(false);
    const v = raw.trim();
    if (v && v !== row.title) void ctl.setPageTitle(row.path, v);
  };
  if (editing) {
    return (
      <input
        ref={input}
        class="vb-input"
        type="text"
        defaultValue={row.title}
        aria-label="Page title"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.currentTarget as HTMLInputElement).value);
          else if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
      />
    );
  }
  return (
    <button
      class={`vb-open ${row.isVirtual ? 'virtual' : ''}`}
      title={row.workspace ? `${row.workspace}: ${row.path.replace(/\.md$/, '')}` : `${row.path.replace(/\.md$/, '')}${row.isVirtual ? '' : ' (double-click to rename)'}`}
      onClick={() => void (row.workspace ? ctl.openWorkspaceLink(row.workspace, row.path, null) : ctl.openPage(row.path, { reveal: true }))}
      onDblClick={() => !row.isVirtual && !row.workspace && setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'F2' && !row.isVirtual) {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {row.title}
      {row.workspace && <span class="vb-ext-mark" aria-label={`in the workspace ${row.workspace}`}> ⧉</span>}
    </button>
  );
}

/** The type information of an attribute by name. Names are not case-sensitive (`Type` and `type` are the same attribute). */
export function keyInfo(keys: AttributeKey[], k: string | undefined): AttributeKey | undefined {
  if (k === undefined) return undefined;
  return keys.find((x) => x.key === k) ?? keys.find((x) => x.key.toLowerCase() === k.toLowerCase());
}
