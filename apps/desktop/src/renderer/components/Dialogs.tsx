import type { ComponentChildren, JSX } from 'preact';
import { frameObserver } from '@cave-notes/editor';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import YAML from 'yaml';
import { PAGE_CM, SLIDE_PT, paginate, cropFractions, formatLen, parseDoc, pxToLen, type Fractions, type ImageRef, type Unit, parseStyleSetsYaml, renderHtml, stringifyStyleSets, type StyleSet } from '@cave-notes/core-export';
import type { ConflictMerge, ExternalOpen, FontKind, FontSizes, FontStyle, HistoryEntry, LogSource, TreeItem, YamlSection } from '../../shared/api';
import { AUTO_FONT_SIZE, type Controller, type DialogSpec, type HelpPage, type NewPageMode } from '../controller';
import { HELP_TOPICS } from '../helpTopics';
import { ACCENT_FAMILIES, familyColor, familyOf } from '../color';
import { tabVars } from '../color';
import { ALL_WORKSPACE_ICONS, Icon, WorkspaceIcon, isIconName, searchIcons } from './icons';

const ALL_COUNT = ALL_WORKSPACE_ICONS.length;
import { stripExt } from '../paths';
import { SHORTCUTS } from '../../shared/shortcuts';
import { OTHER_CREDITS, THESAURUS_CREDITS, WORDNET_NOTICE, type Credit } from '../credits';

function Modal({ title, onClose, children, wide, full, fixed }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; /** takes the whole window, for things that are seen better large */ full?: boolean; /** keeps one size whatever it holds (Preferences, whose pages differ in length) */ fixed?: boolean }): JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`dialog ${wide ? 'wide' : ''} ${full ? 'full' : ''} ${fixed ? 'fixed' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PluginAskDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'plugin-ask' }> }): JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(d.fields.map((f) => [f.name, f.default ?? (f.type === 'select' ? f.options?.[0] ?? '' : f.type === 'boolean' ? false : '')])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onlyInfo = d.fields.every((f) => f.type === 'info'); // a message with an OK button
  const first = useRef<HTMLInputElement & HTMLSelectElement>(null);
  // the first thing that can be filled in (a message above it does not count)
  const firstField = d.fields.findIndex((f) => f.type !== 'info');
  useEffect(() => {
    first.current?.focus();
    first.current?.select?.();
  }, []);
  const set = (name: string, v: unknown): void => {
    setValues({ ...values, [name]: v });
    setError(null);
  };
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const err = await d.submit(values);
    setBusy(false);
    if (err) setError(err);
    else if (ctl.dialog.value === d) ctl.dialog.value = null;
  };
  return (
    <Modal title={d.title} onClose={() => ctl.closeDialog()}>
      {d.fields.map((f, i) => f.type === 'info' ? (
        <p key={f.name} class="dialog-body">{f.label}</p>
      ) : (
        <label key={f.name} class={f.type === 'boolean' ? 'field check' : 'field'}>
          <span>{f.label}</span>
          {f.type === 'select' ? (
            <select ref={i === firstField ? first : undefined} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, (e.currentTarget as HTMLSelectElement).value)}>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'boolean' ? (
            <input ref={i === firstField ? first : undefined} type="checkbox" checked={values[f.name] === true} onChange={(e) => set(f.name, (e.currentTarget as HTMLInputElement).checked)} />
          ) : (
            <input
              ref={i === firstField ? first : undefined}
              type={f.type === 'number' ? 'number' : 'text'}
              step={f.type === 'number' ? 'any' : undefined}
              min={f.min ?? undefined}
              max={f.max ?? undefined}
              value={String(values[f.name] ?? '')}
              spellcheck={false}
              onInput={(e) => set(f.name, (e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          )}
        </label>
      ))}
      {error && <p class="field-error" role="alert">{error}</p>}
      <div class="dialog-actions">
        {d.plugin && <button class="pill-button" title="Stops this plugin from showing dialogs. It stays in the Plugins menu, dimmed, until you turn it on again." onClick={() => { ctl.setPluginOff(d.plugin!, true); ctl.closeDialog(); }}>Turn off this plugin</button>}
        {!onlyInfo && <button class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>}
        <button class="pill-button suggested" disabled={busy} autoFocus={onlyInfo} onClick={() => void submit()}>{d.confirm}</button>
      </div>
    </Modal>
  );
}

function PromptDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'prompt' }> }): JSX.Element {
  const [value, setValue] = useState(d.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(d.select?.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const err = await d.submit(value, d.select ? choice : undefined);
    setBusy(false);
    if (err) setError(err);
    else if (ctl.dialog.value === d) ctl.dialog.value = null;
  };
  return (
    <Modal title={d.title} onClose={() => ctl.closeDialog()}>
      {d.body && <p class="dialog-body">{d.body}</p>}
      <label class="field">
        <span>{d.label}</span>
        <input
          ref={input}
          type="text"
          value={value}
          class={error ? 'invalid' : ''}
          spellcheck={false}
          onInput={(e) => {
            setValue((e.currentTarget as HTMLInputElement).value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      {d.select && (
        <label class="field">
          <span>{d.select.label}</span>
          <select value={choice} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v === '__import__') ctl.openImport('template'); else setChoice(v); }}>
            {d.select.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {error && <p class="field-error" role="alert">{error}</p>}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>
        <button class="pill-button suggested" disabled={busy || !value.trim()} onClick={() => void submit()}>{d.confirm}</button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'confirm' }> }): JSX.Element {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const [ticked, setTicked] = useState(false);
  const done = (v: boolean): void => {
    ctl.dialog.value = null;
    if (v && ticked) d.check?.apply();
    d.resolve(v);
  };
  return (
    <Modal title={d.title} onClose={() => done(false)}>
      <p class="dialog-body">{d.body}</p>
      {d.details && d.details.length > 0 && (
        <ul class="dialog-details">
          {d.details.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {d.check && (
        <label class="dialog-check"><input type="checkbox" checked={ticked} onChange={(e) => setTicked((e.currentTarget as HTMLInputElement).checked)} /> {d.check.label}</label>
      )}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => done(false)}>Cancel</button>
        <button ref={ok} class={`pill-button ${d.destructive ? 'destructive' : 'suggested'}`} onClick={() => done(true)}>{d.confirm}</button>
      </div>
    </Modal>
  );
}

/** Move to / Copy to: a small page browser. Pick a workspace, then a page to put the pages under (or the top level). */
function TransferDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'transfer' }> }): JSX.Element {
  const workspaces = useMemo(() => ctl.transferWorkspaces(), [ctl]);
  const [root, setRoot] = useState(workspaces[0]?.root ?? '');
  const [kids, setKids] = useState<Map<string, TreeItem[]>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = (parent: string | null): string => `${root}|${parent ?? ''}`;
  const load = async (parent: string | null): Promise<void> => {
    try {
      const items = await ctl.transferChildren(root, parent);
      setKids((m) => new Map(m).set(key(parent), items));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    setPicked(null);
    setOpen(new Set());
    setError(null);
    void load(null);
  }, [root]);
  const sameWs = root === ctl.workspace.value?.root;
  const blocked = (p: string): boolean => sameWs && d.paths.some((s) => p === s || p.startsWith(`${stripExt(s)}/`));
  const rows: Array<{ item: TreeItem; depth: number }> = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const item of kids.get(key(parent)) ?? []) {
      rows.push({ item, depth });
      if (open.has(item.path)) walk(item.path, depth + 1);
    }
  };
  walk(null, 0);
  const move = d.mode === 'move';
  const title = d.paths.length === 1 ? `${move ? 'Move' : 'Copy'} “${stripExt(d.paths[0]!).split('/').pop()}”` : `${move ? 'Move' : 'Copy'} ${d.paths.length} Pages`;
  const go = async (): Promise<void> => {
    setBusy(true);
    const err = await ctl.transferTo(d.paths, d.mode, root, picked);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal title={title} wide onClose={() => ctl.closeDialog()}>
      <p class="dialog-body">Choose where it goes: {sameWs ? 'a page in this workspace (it becomes a sub-page of it), or the top level.' : 'a page of that workspace, or its top level.'}{move && !sameWs ? ' The originals go to the trash, and links to them from other pages stop working.' : ''}</p>
      {workspaces.length > 1 && (
        <label class="field">
          <span>Workspace</span>
          <select value={root} onChange={(e) => setRoot((e.currentTarget as HTMLSelectElement).value)}>
            {workspaces.map((w) => <option key={w.root} value={w.root}>{w.name}</option>)}
          </select>
        </label>
      )}
      <div class="transfer-tree" role="tree" aria-label="Destination">
        <div class={`transfer-row ${picked === null ? 'picked' : ''}`} role="treeitem" aria-selected={picked === null} onClick={() => setPicked(null)}>
          <Icon name="cave" size={15} /> <span>Top level</span>
        </div>
        {rows.map(({ item, depth }) => {
          const off = blocked(item.path);
          return (
            <div key={item.path} class={`transfer-row ${picked === item.path ? 'picked' : ''} ${off ? 'off' : ''}`} role="treeitem" aria-selected={picked === item.path} aria-disabled={off} style={{ paddingLeft: `${8 + depth * 18}px` }} onClick={() => !off && setPicked(item.path)}>
              <button
                class={`chevron ${item.hasChildren ? '' : 'hidden'}`}
                tabIndex={-1}
                aria-label={open.has(item.path) ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(open);
                  if (next.delete(item.path)) setOpen(next);
                  else {
                    next.add(item.path);
                    setOpen(next);
                    if (!kids.has(key(item.path))) void load(item.path);
                  }
                }}
              >
                <Icon name="chevron" size={13} style={{ transform: open.has(item.path) ? 'rotate(90deg)' : 'none' }} />
              </button>
              <Icon name={item.exists ? 'page' : 'folder'} size={15} />
              <span>{item.name}</span>
            </div>
          );
        })}
      </div>
      {error && <p class="field-error" role="alert">{error}</p>}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>
        <button class="pill-button suggested" disabled={busy || !root} onClick={() => void go()}>{move ? 'Move Here' : 'Copy Here'}</button>
      </div>
    </Modal>
  );
}

function ChooseDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'choose' }> }): JSX.Element {
  const [ticked, setTicked] = useState(false);
  const done = (v: string | null): void => {
    ctl.dialog.value = null;
    if (v !== null && ticked && d.remember?.values.includes(v)) d.remember.apply(v);
    d.resolve(v);
  };
  return (
    <Modal title={d.title} onClose={() => done(null)}>
      <p class="dialog-body">{d.body}</p>
      <div class="choices">
        {d.options.map((o) => (
          <button key={o.value} class="choice" onClick={() => done(o.value)}>
            <span>{o.label}</span>
            {o.detail && <small>{o.detail}</small>}
          </button>
        ))}
      </div>
      {d.remember && (
        <label class="dialog-check"><input type="checkbox" checked={ticked} onChange={(e) => setTicked((e.currentTarget as HTMLInputElement).checked)} /> {d.remember.label}</label>
      )}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => done(null)}>Cancel</button>
      </div>
    </Modal>
  );
}

function PlanDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'plan' }> }): JSX.Element {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const done = (v: boolean): void => {
    ctl.dialog.value = null;
    d.resolve(v);
  };
  const { plan } = d;
  const n = plan.summary.linksRewritten;
  const pages = plan.summary.pagesMoved;
  return (
    <Modal title={d.title} onClose={() => done(false)} wide>
      <p class="dialog-body">
        <strong>{stripExt(plan.move.from)}</strong> → <strong>{stripExt(plan.move.to)}</strong>
        {pages > 1 ? ` (with ${pages - 1} sub-page${pages === 2 ? '' : 's'})` : ''}
      </p>
      {n > 0 && (
        <>
          <p class="dialog-body">
            {n} link{n === 1 ? '' : 's'} in {plan.summary.filesEdited} page{plan.summary.filesEdited === 1 ? '' : 's'} will be updated so nothing breaks:
          </p>
          <div class="plan-list" tabIndex={0}>
            {plan.files.map((f) => (
              <div class="plan-file" key={f.path}>
                <div class="plan-path">{stripExt(f.path)}</div>
                {f.edits.map((e, i) => (
                  <div class="plan-edit" key={i}>
                    <span class="line-no">{e.line}</span>
                    <code class="old">{e.oldText}</code>
                    <span class="arrow">→</span>
                    <code class="new">{e.newText}</code>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {plan.warnings.length > 0 && (
        <div class="plan-warnings">
          {plan.warnings.map((w, i) => (
            <p key={i}>
              <strong>{stripExt(w.file)}{w.line ? `:${w.line}` : ''}</strong> {w.message}
            </p>
          ))}
        </div>
      )}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => done(false)}>Cancel</button>
        <button ref={ok} class="pill-button suggested" onClick={() => done(true)}>{d.confirm}</button>
      </div>
    </Modal>
  );
}

function ListStyleField({ label, hint, value, onCommit }: { label: string; hint: string; value: string; onCommit: (text: string) => void }): JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label class="pref-field">
      <span class="pref-label">{label}</span>
      <input type="text" value={text} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} onBlur={() => onCommit(text)} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(text); }} />
      <span class="pref-hint">{hint}</span>
    </label>
  );
}

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }): JSX.Element {
  return (
    <label class={`pref-row ${disabled ? 'disabled' : ''}`}>
      <span class="pref-text">
        <span class="pref-label">{label}</span>
        {hint && <span class="pref-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" class="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
    </label>
  );
}

const UPDATE_CHOICES: Array<{ value: 'install' | 'notify' | 'off'; label: string; hint: string }> = [
  { value: 'install', label: 'Install updates by itself', hint: 'A newer version is downloaded and put in place of this one; you are asked to restart to use it.' },
  { value: 'notify', label: 'Only tell me', hint: 'Look for updates, say when there is one, and wait for you to press Install.' },
  { value: 'off', label: 'Never look', hint: 'Cave Notes does not contact anything. You can still press “Check for updates”.' },
];

const CONFLICT_CHOICES: Array<{ value: ConflictMerge; label: string; hint: string }> = [
  { value: 'auto', label: 'Merge them in and delete them', hint: 'the copy is merged into the page, kept in the page history, then removed' },
  { value: 'ask', label: 'Ask me the first time', hint: 'then remember the answer here' },
  { value: 'never', label: 'Leave them alone', hint: 'they stay in the folder for you to deal with' },
];

const NEW_PAGE_CHOICES: Array<{ value: NewPageMode; label: string; hint: string }> = [
  { value: 'nested', label: 'Inside the open page', hint: 'a sub-page of the page you are on' },
  { value: 'sibling', label: 'Beside the open page', hint: 'next to it, in the same parent' },
  { value: 'top', label: 'At the top level', hint: 'always starts a new branch' },
];

const EXTERNAL_CHOICES: Array<{ value: ExternalOpen; label: string; hint: string }> = [
  { value: 'tab', label: 'In a new tab', hint: 'of the window you used last' },
  { value: 'window', label: 'In a new window', hint: 'one window for each time' },
];

function FolderList({ title, empty, folders, onAdd, onRemove }: { title: string; empty: string; folders: string[]; onAdd: () => void; onRemove: (dir: string) => void }): JSX.Element {
  return (
    <div class="folder-list">
      <span class="pref-label">{title}</span>
      {folders.length === 0 ? <span class="pref-hint">{empty}</span> : null}
      {folders.map((d) => (
        <div key={d} class="folder-row">
          <span class="folder-path" title={d}>{d}</span>
          <button class="icon-button small" aria-label={`Remove ${d}`} title="Remove" onClick={() => onRemove(d)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <button class="pill-button small" onClick={onAdd}>Add Folder…</button>
    </div>
  );
}

interface PrefsPage {
  id: string;
  title: string;
  body: JSX.Element;
}

/** Preferences in categories: a list of them on the left, the chosen one on the right (above the page on a narrow window). */
function PrefsLayout({ pages, initial }: { pages: PrefsPage[]; initial?: string }): JSX.Element {
  const [cur, setCur] = useState(pages.some((p) => p.id === initial) ? initial! : pages[0]!.id);
  const page = pages.find((p) => p.id === cur) ?? pages[0]!;
  const nav = useRef<HTMLElement>(null);
  const onKey = (e: KeyboardEvent): void => {
    const i = pages.findIndex((p) => p.id === page.id);
    const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = pages[(to + pages.length) % pages.length]!;
    setCur(next.id);
    nav.current?.querySelector<HTMLElement>(`[data-page="${next.id}"]`)?.focus();
  };
  return (
    <div class="prefs-layout">
      <nav class="prefs-nav" ref={nav} role="tablist" aria-orientation="vertical" aria-label="Preference categories" onKeyDown={onKey}>
        {pages.map((p) => (
          <button key={p.id} role="tab" data-page={p.id} class={p.id === page.id ? 'on' : ''} aria-selected={p.id === page.id} tabIndex={p.id === page.id ? 0 : -1} onClick={() => setCur(p.id)}>{p.title}</button>
        ))}
      </nav>
      <div class="prefs" role="tabpanel" aria-label={page.title}>{page.body}</div>
    </div>
  );
}

/** The user's own words for the spell checker: add several at once, remove one, search the list. */
function DictionaryEditor({ ctl }: { ctl: Controller }): JSX.Element {
  const words = ctl.settings.value.dictionary;
  const [text, setText] = useState('');
  const [find, setFind] = useState('');
  const add = (): void => {
    if (ctl.addToDictionary(text) > 0 || text.trim() === '') setText('');
  };
  const shown = find.trim() === '' ? words : words.filter((w) => w.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div class="dictionary">
      <span class="pref-label">Your dictionary</span>
      <span class="pref-hint">Words the spell checker should accept, such as names and terms of your field. They are saved with your preferences, so an exported settings file carries them to another computer.</span>
      <div class="dict-add">
        <input type="text" value={text} placeholder="Add words (separate several with spaces)" aria-label="Add words to the dictionary" spellcheck={false} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button class="pill-button small" disabled={text.trim() === ''} onClick={add}>Add</button>
      </div>
      {words.length > 8 && <input type="search" class="dict-find" value={find} placeholder="Search the dictionary" aria-label="Search the dictionary" spellcheck={false} onInput={(e) => setFind((e.currentTarget as HTMLInputElement).value)} />}
      {words.length === 0 ? (
        <span class="pref-hint">No words yet. Right-click a misspelt word in a page and choose Add to Dictionary, or add words here.</span>
      ) : (
        <>
          <ul class="dict-list" aria-label="Dictionary words">
            {shown.map((w) => (
              <li key={w}>
                <span class="dict-word" spellcheck={false}>{w}</span>
                <button class="icon-button small" aria-label={`Remove ${w}`} title="Remove" onClick={() => ctl.removeFromDictionary(w)}><Icon name="close" size={12} /></button>
              </li>
            ))}
            {shown.length === 0 && <li class="pref-hint">No word matches.</li>}
          </ul>
          <span class="pref-hint">{words.length} {words.length === 1 ? 'word' : 'words'}</span>
        </>
      )}
    </div>
  );
}

function PreferencesDialog({ ctl, first, page }: { ctl: Controller; first: 'app' | 'workspace'; page?: string }): JSX.Element {
  const s = ctl.settings.value;
  const ws = ctl.workspace.value;
  const [tab, setTab] = useState<'app' | 'workspace'>(first === 'workspace' && ws ? 'workspace' : 'app');
  const [secs, setSecs] = useState(String(s.autoCollapseSeconds));
  const [types, setTypes] = useState(s.noteExts.join(', '));
  const [create, setCreate] = useState(s.noteCreate.slice(1));
  const [displays, setDisplays] = useState<Array<{ id: string; label: string; primary: boolean; width: number; height: number; hasApp: boolean }>>([]);
  useEffect(() => {
    void ctl.listDisplays().then(setDisplays).catch(() => undefined);
  }, []);
  const nt = ctl.noteTypes.value;
  const [ownTypes, setOwnTypes] = useState('');
  const [ownCreate, setOwnCreate] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  useEffect(() => {
    void ctl.loadNoteTypes();
  }, []);
  useEffect(() => {
    const t = ctl.noteTypes.value;
    if (t) {
      setOwnTypes((t.own ?? t.effective).exts.join(', '));
      setOwnCreate((t.own ?? t.effective).create.slice(1));
    }
  }, [nt?.own?.exts.join(','), nt?.effective.exts.join(',')]);
  const appPages: PrefsPage[] = [
    {
      id: 'appearance',
      title: 'Appearance',
      body: (
        <>
        <section>
          <h3>Colours</h3>
          <Switch label="Dark theme" checked={s.theme === 'dark'} onChange={(v) => void ctl.setTheme(v ? 'dark' : 'light')} />
          <div class="pref-row">
            <span class="pref-text">
              <span class="pref-label">Accent colour for other files</span>
              <span class="pref-hint">Used on the tab and title bar of a workspace that has no colour of its own. A colour set in Workspace Preferences wins.</span>
            </span>
          </div>
          <div class="swatches">
            <button class={`swatch none ${s.defaultAccent === null ? 'on' : ''}`} title="No colour" aria-label="No colour" onClick={() => ctl.setPreferences({ defaultAccent: null })}>
              <Icon name="close" size={12} />
            </button>
            <Families value={s.defaultAccent} onPick={(c) => ctl.setPreferences({ defaultAccent: c })} />
            <label class="swatch custom" title="Other colour">
              <input type="color" value={s.defaultAccent ?? '#3584e4'} onChange={(e) => ctl.setPreferences({ defaultAccent: (e.currentTarget as HTMLInputElement).value })} />
            </label>
          </div>
        </section>
        <section>
          <h3>Page text</h3>
          <div class="pref-row">
            <span class="pref-text">
              <span class="pref-label">Page text</span>
              <span class="pref-hint">The default for every workspace. Headings stay sans-serif. Leave the size empty to get one that suits the typeface.</span>
            </span>
          </div>
          <FontControls style={s.fontStyle} sizes={s.fontSizes} hints={AUTO_FONT_SIZE_HINTS} inherit={false} onStyle={(v) => ctl.setPreferences({ fontStyle: v ?? 'sans' })} onSize={(k, v) => ctl.setPreferences({ fontSizes: { ...s.fontSizes, [k]: v } })} />
        </section>
        </>
      ),
    },
    {
      id: 'editing',
      title: 'Editing',
      body: (
        <>
        <section>
          <h3>Spelling</h3>
          <Switch label="Fix accidental double capitals" hint="A word typed as THis becomes This when you end it. A word like HIs is left alone, because it may be an abbreviation with an s (PCs, IDs). Undo straight afterwards brings back what you typed." checked={s.fixCapitals} onChange={(v) => ctl.setPreferences({ fixCapitals: v })} />
          <Switch label="Check spelling" hint="Misspelt words are underlined in the editor. Right-click one for corrections, or to add it to your dictionary." checked={s.spellcheck} onChange={(v) => ctl.setPreferences({ spellcheck: v })} />
          <Switch label="Suggest synonyms" hint="Right-click a single word for other words to put in its place. Articles, prepositions and the like are skipped, and so are words in code and links." checked={s.synonyms} onChange={(v) => ctl.setPreferences({ synonyms: v })} />
          <DictionaryEditor ctl={ctl} />
        </section>
        <section>
          <h3>Lists</h3>
          <p class="pref-hint">A hierarchical list uses a different marker at each level. Right-click in a list to make it hierarchical.</p>
          <Switch label="Nested items take the style of their level" hint="When you indent or outdent an item (Tab, Shift+Tab) its marker changes to the one for its new level. Otherwise only lists you made hierarchical do." checked={s.hierarchicalLists} onChange={(v) => ctl.setPreferences({ hierarchicalLists: v })} />
          <ListStyleField label="Numbered list levels" hint="Separate with commas. Choose from 1. a. A. i. I. (or 1) a) …). Levels past the last repeat the list." value={s.orderedListStyles.join(', ')} onCommit={(t) => ctl.setPreferences({ orderedListStyles: t.split(/[,\s]+/).filter(Boolean) })} />
          <ListStyleField label="Bullet levels" hint="One symbol per level, separated by commas or spaces, for example • ◦ ▪" value={s.bulletGlyphs.join(', ')} onCommit={(t) => ctl.setPreferences({ bulletGlyphs: t.split(/[,\s]+/).filter(Boolean) })} />
        </section>
        <section>
          <h3>Code and plain text</h3>
          <Switch label="Wrap long lines" hint="In code blocks and plain-text files. Off, long lines scroll sideways. Alt+Z switches it." checked={s.wrapCode} onChange={(v) => ctl.setPreferences({ wrapCode: v })} />
        </section>
        </>
      ),
    },
    {
      id: 'pages',
      title: 'Pages and files',
      body: (
        <>
        <section>
          <h3>File types</h3>
          <p class="pref-hint">Files with these extensions are the notes of a workspace; other files are ignored by the page tree. Notes can use Markdown in any of them.</p>
          <label class="pref-field">
            <span class="pref-label">Notes are files ending in</span>
            <input type="text" value={types} placeholder="md, txt" onInput={(e) => setTypes((e.currentTarget as HTMLInputElement).value)} onBlur={() => ctl.setAppNoteTypes(types, create)} onKeyDown={(e) => { if (e.key === 'Enter') ctl.setAppNoteTypes(types, create); }} />
          </label>
          <label class="pref-field">
            <span class="pref-label">New notes are created as</span>
            <input type="text" value={create} placeholder="md" onInput={(e) => setCreate((e.currentTarget as HTMLInputElement).value)} onBlur={() => ctl.setAppNoteTypes(types, create)} onKeyDown={(e) => { if (e.key === 'Enter') ctl.setAppNoteTypes(types, create); }} />
          </label>
          <p class="pref-hint">To keep .md files out of Cave Notes entirely, list only the type you want (say txt) and create notes as that.</p>
        </section>
        <section>
          <h3>New pages</h3>
          <p class="pref-hint">The “+” button and Ctrl+N put a new page…</p>
          <div class="pref-choices" role="radiogroup" aria-label="Where new pages go">
            {NEW_PAGE_CHOICES.map((c) => (
              <label key={c.value} class={`pref-choice ${s.newPageDefault === c.value ? 'on' : ''}`}>
                <input type="radio" name="newpage" checked={s.newPageDefault === c.value} onChange={() => ctl.setPreferences({ newPageDefault: c.value })} />
                <span class="pref-label">{c.label}</span>
                <span class="pref-hint">{c.hint}</span>
              </label>
            ))}
          </div>
          <p class="pref-hint">The arrow next to “+” offers all three whenever you want a different one.</p>
        </section>
        <section>
          <h3>Page tree</h3>
          <Switch
            label="Collapse branches you have left"
            hint="A branch with nothing open in it closes by itself. Only its outermost level closes, so reopening it shows the way back to where you were."
            checked={s.autoCollapse}
            onChange={(v) => ctl.setPreferences({ autoCollapse: v })}
          />
          <label class={`pref-row ${s.autoCollapse ? '' : 'disabled'}`}>
            <span class="pref-text">
              <span class="pref-label">…after</span>
            </span>
            <span class="pref-number">
              <input
                type="number"
                min={1}
                max={3600}
                value={secs}
                disabled={!s.autoCollapse}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setSecs(v);
                  if (Number(v) >= 1) ctl.setPreferences({ autoCollapseSeconds: Number(v) });
                }}
                onBlur={() => setSecs(String(ctl.settings.value.autoCollapseSeconds))}
              />
              <span>seconds</span>
            </span>
          </label>
        </section>
        <section>
          <h3>Outline</h3>
          <Switch label="Show numbered lists" hint="List the items of numbered lists in the outline sidebar, under their heading, in a lighter colour." checked={s.outlineOrderedLists} onChange={(v) => ctl.setPreferences({ outlineOrderedLists: v })} />
        </section>
        <section>
          <h3>Files dragged in from outside</h3>
          <p class="pref-hint">Dropping files from your file manager onto the page tree or the sub-page bar…</p>
          <label class="pref-row"><span class="pref-label">Files on the same drive</span>
            <select value={s.dropAction} onChange={(e) => ctl.setPreferences({ dropAction: (e.currentTarget as HTMLSelectElement).value as 'move' | 'copy' })}><option value="move">Move them</option><option value="copy">Copy them</option></select></label>
          <label class="pref-row"><span class="pref-label">Files from another drive</span>
            <select value={s.dropActionOtherDrive} onChange={(e) => ctl.setPreferences({ dropActionOtherDrive: (e.currentTarget as HTMLSelectElement).value as 'same' | 'move' | 'copy' })}><option value="same">Same as above</option><option value="move">Move them</option><option value="copy">Copy them</option></select></label>
        </section>
        </>
      ),
    },
    {
      id: 'views',
      title: 'Views',
      body: (
        <>
        <section>
          <h3>Calendars and dates</h3>
          <label class="pref-field">
            <span class="pref-label">Week starts on</span>
            <select value={String(s.firstDayOfWeek)} onChange={(e) => ctl.setPreferences({ firstDayOfWeek: Number((e.currentTarget as HTMLSelectElement).value) })}>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
            </select>
          </label>
          <p class="pref-hint">Used by calendars and by <code>$now.week</code> in queries. The date picker of a date field follows your system’s own setting.</p>
        </section>
        <section>
          <h3>Tables</h3>
          <label class="pref-field">
            <span class="pref-label">Longest word a table column makes room for</span>
            <input type="number" min={4} max={200} value={s.tableWordLimit} aria-label="Table word limit" onChange={(e) => ctl.setPreferences({ tableWordLimit: Number((e.currentTarget as HTMLInputElement).value) })} />
          </label>
          <p class="pref-hint">Table columns grow until no word is broken, up to this many letters. A longer word is broken at that width.</p>
        </section>
        </>
      ),
    },
    {
      id: 'workspaces',
      title: 'Workspaces',
      body: (
        <>
        <section>
          <h3>Finding workspaces</h3>
          <p class="pref-hint">Any folder can be a workspace: it is one once it has a .cave-notes folder. A workspace inside another one is kept separate from it.</p>
          <Switch label="Show workspaces inside a workspace in its page tree" hint="They appear as folders marked with the Cave Notes icon; their notes are not part of the outer workspace." checked={s.showNestedWorkspaces} onChange={(v) => ctl.setPreferences({ showNestedWorkspaces: v })} />
          <Switch label="Open them in a new tab" hint="Otherwise the workspace you choose replaces the one in the current tab." checked={s.nestedInNewTab} disabled={!s.showNestedWorkspaces} onChange={(v) => ctl.setPreferences({ nestedInNewTab: v })} />
          <Switch label="Hide folders that have no notes from the page tree" hint="A folder of images or other files is a page of its own, shown in the tree and in the sub-page bar. Turn this on to keep such folders out of the tree; the sub-page bar still shows them." checked={s.hideBareFolders} onChange={(v) => ctl.setPreferences({ hideBareFolders: v })} />
          <Switch label="Look for workspaces now and then" hint="Cave Notes searches your folders in the background and adds the workspaces it finds to the lists you open workspaces from." checked={s.scanAuto} onChange={(v) => ctl.setPreferences({ scanAuto: v })} />
          <Switch label="Keep all workspaces indexed" hint="Every workspace on this computer is opened quietly in the background, the one you are in first, and kept up to date. Views and relations that reach into another workspace then show what is there now. Each one uses some memory; switch this off if you have many." checked={s.indexAllWorkspaces} onChange={(v) => ctl.setPreferences({ indexAllWorkspaces: v })} />
          <FolderList title="Folders to search" empty="Your home folder" folders={s.scanFolders} onAdd={() => void ctl.addScanFolder('scanFolders')} onRemove={(d) => ctl.removeScanFolder('scanFolders', d)} />
          <FolderList title="Folders to leave out" empty="None" folders={s.scanIgnore} onAdd={() => void ctl.addScanFolder('scanIgnore')} onRemove={(d) => ctl.removeScanFolder('scanIgnore', d)} />
          <div class="dialog-actions start">
            <button class="pill-button" onClick={() => { setScanned('Searching…'); void ctl.scanNow().then((n) => setScanned(`${n} workspace${n === 1 ? '' : 's'} found.`)); }}>Search Now</button>
            {scanned && <span class="pref-hint">{scanned}</span>}
          </div>
        </section>
        <section>
          <h3>Opening from outside</h3>
          <p class="pref-hint">A folder or Markdown file opened from your file manager or the command line while Cave Notes is already running opens…</p>
          <div class="pref-choices" role="radiogroup" aria-label="Where outside files and folders open">
            {EXTERNAL_CHOICES.map((c) => (
              <label key={c.value} class={`pref-choice ${s.openExternal === c.value ? 'on' : ''}`}>
                <input type="radio" name="external" checked={s.openExternal === c.value} onChange={() => ctl.setPreferences({ openExternal: c.value })} />
                <span class="pref-label">{c.label}</span>
                <span class="pref-hint">{c.hint}</span>
              </label>
            ))}
          </div>
        </section>
        <section>
          <h3>Settings shared between workspaces</h3>
          <label class="pref-field">
            <input type="checkbox" checked={s.globalsEnabled} aria-label="Use settings offered to all workspaces" onChange={(e) => ctl.setPreferences({ globalsEnabled: (e.currentTarget as HTMLInputElement).checked })} />
            <span class="pref-label">Use settings that other workspaces offer to all workspaces</span>
          </label>
          <p class="pref-hint">A workspace can tag a section of its attributes, schema, saved queries or relations with <code>!global</code>. With this on, you are asked before any other workspace takes them. Off switches the feature off completely: nothing is offered or applied.</p>
        </section>
        </>
      ),
    },
    {
      id: 'presentations',
      title: 'Presentations',
      body: (
        <>
        <section>
          <h3>Screens</h3>
          <p class="pref-hint">A page with <code>presentationTheme:</code> can be presented full screen. See the documentation page “Presentations”.</p>
          <label class="pref-field">
            <span class="pref-label">Show the slides on</span>
            <select value={s.presentScreen} onChange={(e) => ctl.setPreferences({ presentScreen: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="auto">Automatic (another screen if there is one)</option>
              {displays.map((d, i) => <option key={d.id} value={d.id}>{`Screen ${i + 1}: ${d.width}×${d.height}${d.hasApp ? ' (this window)' : ''}${d.primary ? ', main' : ''}`}</option>)}
            </select>
          </label>
          <Switch label="Show a presenter window" checked={s.presenterWindow} onChange={(v) => ctl.setPreferences({ presenterWindow: v })} hint="A window for you with the slide being shown, the next one, your notes (footnotes labelled [^note]) and a clock. The two follow each other." />
          <label class="pref-field">
            <span class="pref-label">Presenter window on</span>
            <select value={s.presenterScreen} disabled={!s.presenterWindow} onChange={(e) => ctl.setPreferences({ presenterScreen: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="auto">Automatic (the screen with this window)</option>
              {displays.map((d, i) => <option key={d.id} value={d.id}>{`Screen ${i + 1}: ${d.width}×${d.height}${d.hasApp ? ' (this window)' : ''}`}</option>)}
            </select>
          </label>
          <p class="pref-hint">With only one screen, the slides fill it and the presenter window is behind them: use <code>Alt+Tab</code> to reach it, or connect a second screen.</p>
        </section>
        </>
      ),
    },
    {
      id: 'sync',
      title: 'Sync and automation',
      body: (
        <>
        <section>
          <h3>Syncing</h3>
          <p class="pref-hint">Changes made on disk (by a sync tool, git, another program) are loaded and merged with what you are typing, so neither side is lost. When Syncthing leaves a conflict copy of a page (<code>Name.sync-conflict-…md</code>):</p>
          <div class="pref-choices" role="radiogroup" aria-label="Sync conflict copies">
            {CONFLICT_CHOICES.map((c) => (
              <label key={c.value} class={`pref-choice ${s.conflictMerge === c.value ? 'on' : ''}`}>
                <input type="radio" name="conflict" checked={s.conflictMerge === c.value} onChange={() => ctl.setConflictMerge(c.value)} />
                <span class="pref-label">{c.label}</span>
                <span class="pref-hint">{c.hint}</span>
              </label>
            ))}
          </div>
        </section>
        <section>
          <h3>Automations</h3>
          <p class="pref-hint">Rules (a <code>rules:</code> section in a settings file of a workspace's <code>.cave-notes</code> folder) react to changes in your notes and to dates and times. See docs/automation.md.</p>
          {ctl.caps.shell && <Switch label="Let automations run shell commands" hint="Off by default. Each new command still asks you first, and a command that is edited asks again. Turning this on asks for confirmation." checked={s.automationShell} onChange={(v) => ctl.setPreferences({ automationShell: v })} />}
          {ctl.caps.scriptRules && <Switch label="Let automations run JavaScript" hint="Off by default. Rules can then run short scripts that read and change the page they work on, in a sandbox with no access to files, the network or programs. Turning this on asks for confirmation." checked={s.automationJs} onChange={(v) => ctl.setPreferences({ automationJs: v })} />}
          {ctl.caps.scriptRules && <Switch label="Ask before running a rule's JavaScript" hint="On by default. Each new script is shown to you first, and a script that is edited asks again. Turning this off (this computer only) asks for confirmation; scripts still need the switch above." checked={s.automationJsAsk} onChange={(v) => ctl.setPreferences({ automationJsAsk: v })} />}
          {ctl.caps.windows && <Switch label="Keep running in the background" hint="When the last window is closed, workspaces whose automations depend on dates or times stay active. Start Cave Notes again to show a window; quit from the tray icon (some desktops need an extension to show it) or after opening a window." checked={s.automationBackground} onChange={(v) => ctl.setPreferences({ automationBackground: v })} />}
          <div class="pref-row">
            <span class="pref-label">Approved and refused commands and scripts</span>
            <button type="button" class="pill-button" onClick={() => void ctl.forgetScriptApprovals()} title="Forgets every command and script you allowed and every one you refused. Automations ask again before running a shell command or a script, and the Run button of a code block asks again in each workspace.">Forget all approvals and refusals</button>
          </div>
          <label class="pref-row">
            <span class="pref-label">Name of this computer in rules</span>
            <input type="text" value={s.deviceName} placeholder="the computer's own name" onChange={(e) => ctl.setPreferences({ deviceName: (e.currentTarget as HTMLInputElement).value })} />
          </label>
        </section>
        </>
      ),
    },
    ...(ctl.caps.windows
      ? [
          {
            id: 'updates',
            title: 'Updates',
            body: (
              <>
                <section>
                  <h3>Updating the app</h3>
                  <p class="pref-hint">A newer AppImage is looked for about once a day. When there is one, it can be put in the old one’s place under the same file name, so launchers and shortcuts keep working. A copy of the old file is kept in the app’s data folder.</p>
                  <div class="pref-choices" role="radiogroup" aria-label="Updates">
                    {UPDATE_CHOICES.map((c) => (
                      <label key={c.value} class={`pref-choice ${s.updateMode === c.value ? 'on' : ''}`}>
                        <input type="radio" name="update-mode" checked={s.updateMode === c.value} onChange={() => ctl.setPreferences({ updateMode: c.value })} />
                        <span class="pref-label">{c.label}</span>
                        <span class="pref-hint">{c.hint}</span>
                      </label>
                    ))}
                  </div>
                  <label class="pref-row pref-col">
                    <span class="pref-text">
                      <span class="pref-label">Update address</span>
                      <span class="pref-hint">Leave empty to use the project’s releases on GitHub. Or give the address of another GitHub repository, or of a small JSON file with <code>version</code> and <code>url</code>. See the page “Updating the app” in the documentation.</span>
                    </span>
                    <input type="text" value={s.updateUrl} placeholder="https://github.com/owner/repository" spellcheck={false} onChange={(e) => ctl.setPreferences({ updateUrl: (e.currentTarget as HTMLInputElement).value.trim() })} />
                  </label>
                  <UpdateRow ctl={ctl} />
                </section>
              </>
            ),
          },
        ]
      : []),
    {
      id: 'transfer',
      title: 'Import and export',
      body: (
        <>
        {ctl.caps.exportDocuments && <section>
          <h3>Export styles</h3>
          <p class="pref-hint">Export a page to Word, OpenDocument or PDF from the page menu. How it looks is set by a style set, written in YAML; they can be kept for one workspace or for all of them.</p>
          <div class="dialog-actions start">
            <button class="pill-button" onClick={() => ctl.openExportStyles()}>Export Styles…</button>
          </div>
        </section>}
        <section>
          <h3>Settings file</h3>
          <p class="pref-hint">Save these preferences to a file, or load them from one (to carry them to another computer). Open tabs, windows and recent folders are not included.</p>
          <div class="dialog-actions start">
            <button class="pill-button" onClick={() => void ctl.exportSettings()}>Export…</button>
            <button class="pill-button" onClick={() => void ctl.importSettings()}>Import…</button>
          </div>
        </section>
        </>
      ),
    },
  ];
  return (
    <Modal title="Preferences" onClose={() => ctl.closeDialog()} wide fixed>
      <div class="segmented pref-tabs" role="tablist" aria-label="Preferences">
        <button role="tab" class={tab === 'app' ? 'on' : ''} aria-selected={tab === 'app'} onClick={() => setTab('app')}>App Preferences</button>
        <button role="tab" class={tab === 'workspace' ? 'on' : ''} aria-selected={tab === 'workspace'} disabled={!ws} title={ws ? `Preferences of “${ws.name}”` : 'Open a workspace first'} onClick={() => setTab('workspace')}>Workspace Preferences</button>
      </div>
      {tab === 'workspace' && ws ? <WorkspacePrefs ctl={ctl} root={ws.root} appTypes={{ types, create }} /> : <PrefsLayout key="app" initial={page} pages={appPages.filter((p) => p.id !== 'presentations' || ctl.caps.windows)} />}
      <div class="dialog-actions">
        <button class="pill-button suggested" onClick={() => ctl.closeDialog()}>Done</button>
      </div>
    </Modal>
  );
}

/** One round swatch per colour family, showing its five shades. */
const AUTO_FONT_SIZE_HINTS: FontSizes = { sans: AUTO_FONT_SIZE.sans, serif: AUTO_FONT_SIZE.serif, mono: AUTO_FONT_SIZE.mono };

/**
 * Typeface of page text, and a size for each of the three typefaces the editor uses (sans-serif, serif, monospace for code),
 * for the app (`inherit` off) or for one workspace, which can also follow the app for each of them.
 */
function FontControls({ style, sizes, hints, inherit, onStyle, onSize }: { style: FontStyle | null; sizes: FontSizes; hints: FontSizes; inherit: boolean; onStyle: (v: FontStyle | null) => void; onSize: (kind: FontKind, v: number | null) => void }): JSX.Element {
  const options: Array<{ value: FontStyle | null; label: string }> = [
    ...(inherit ? [{ value: null, label: 'App default' }] : []),
    { value: 'sans', label: 'Sans-serif' },
    { value: 'serif', label: 'Serif (Libertinus Serif)' },
  ];
  const kinds: Array<{ kind: FontKind; label: string }> = [
    { kind: 'sans', label: 'Sans-serif size' },
    { kind: 'serif', label: 'Serif size' },
    { kind: 'mono', label: 'Monospace size' },
  ];
  return (
    <div class="font-controls">
      <div class="segmented" role="radiogroup" aria-label="Font style">
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={style === o.value} class={style === o.value ? 'on' : ''} onClick={() => onStyle(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {kinds.map(({ kind, label }) => {
        const size = sizes[kind];
        return (
          <label key={kind} class="font-size">
            <span class="pref-label">{label}</span>
            <input
              type="number"
              min={10}
              max={40}
              step={0.5}
              value={size ?? ''}
              placeholder={String(hints[kind])}
              aria-label={`${label} in pixels`}
              onChange={(e) => {
                const raw = (e.currentTarget as HTMLInputElement).value.trim();
                const n = Number(raw);
                onSize(kind, raw === '' || !Number.isFinite(n) ? null : n);
              }}
            />
            <span class="pref-hint">px</span>
            {size !== null && (
              <button class="pill-button small" onClick={() => onSize(kind, null)}>
                {inherit ? 'Use app default' : 'Automatic'}
              </button>
            )}
          </label>
        );
      })}
      <p class="pref-hint">Sans-serif and serif are the two typefaces of page text (the one chosen above is used); monospace is for code, and follows the page text until a size is set.</p>
    </div>
  );
}

function Families({ value, onPick }: { value: string | null; onPick: (color: string) => void }): JSX.Element {
  const mine = familyOf(value);
  return (
    <>
      {ACCENT_FAMILIES.map((f) => (
        <button key={f.name} class={`swatch family ${mine === f ? 'on' : ''}`} title={f.name} aria-label={f.name} onClick={() => onPick(familyColor(f))}>
          {f.shades.map((c) => <span key={c} style={{ background: c }} />)}
        </button>
      ))}
    </>
  );
}

const YAML_PARTS: Array<{ id: YamlSection; title: string; hint: string; placeholder: string }> = [
  { id: 'attributes', title: 'Attributes', hint: 'Attributes every page of this workspace has. A blank value (due:) gives every page the property with nothing in it.', placeholder: 'status: idea\ndue:' },
  { id: 'files', title: 'Attributes of other files', hint: 'What files that are not notes (images, documents) have, like a children: block does for pages.', placeholder: 'kind: attachment' },
  { id: 'queries', title: 'Saved queries', hint: 'Named queries, used anywhere as saved:name. Each is a name with a query, or with a query and a title.', placeholder: 'open-tasks: status:todo,doing\nprojects:\n  query: kind:project\n  title: All projects' },
  { id: 'relations', title: 'Relations between saved queries', hint: 'A list of relations, each connecting two saved queries through an attribute (like a Notion relation). from and to name the queries, attribute is what the from pages write, name is the column, multiple says whether it holds one page or several. Add backattribute to make it mutual: the attribute the to pages write back, kept in step with the first (backname is its column, backmultiple whether it holds several). The queries it names live in the box above. Every field is explained in docs/queries.md, under Relations.', placeholder: '- name: Project\n  from: open-tasks\n  attribute: project\n  multiple: false\n  to: projects\n  backattribute: tasks\n  backname: Tasks' },
  { id: 'schema', title: 'Schema', hint: 'Types and allowed values of attributes, e.g. due: { type: date }. Kept as the schema: section of a settings file.', placeholder: 'due:\n  type: date' },
  { id: 'automations', title: 'Automations', hint: 'Rules that run when something happens or at a time: a rules: list, and optionally settings:. See docs/automation.md.', placeholder: 'rules:\n  - name: …' },
];

/** The first problem in a piece of YAML, or null when it reads fine (an empty box is fine). */
function yamlProblem(text: string): string | null {
  if (text.trim() === '') return null;
  const e = YAML.parseDocument(text).errors[0];
  if (!e) return null;
  const line = e.linePos?.[0]?.line;
  return `${e.message.split('\n')[0]}${line ? ` (line ${line})` : ''}`;
}

/** Two texts that differ only in trailing white space count as the same when a saved file is read back. */
const sameYaml = (a: string, b: string): boolean => a.replace(/[ \t]+$/gm, '').trimEnd() === b.replace(/[ \t]+$/gm, '').trimEnd();

/** How long the box waits after the last keystroke before it saves. */
const YAML_SAVE_DELAY = 1500;

/** Indent or outdent the lines a textarea selection touches (or insert the indent at a caret); returns the new text and selection. */
export function indentSelection(value: string, start: number, end: number, outdent: boolean, unit = '  '): { value: string; start: number; end: number } {
  if (!outdent && start === end) return { value: value.slice(0, start) + unit + value.slice(end), start: start + unit.length, end: start + unit.length };
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const lines = value.slice(from, end).split('\n');
  let first = 0;
  let total = 0;
  const out = lines.map((l, i) => {
    let n = 0;
    let next = l;
    // a selection that ends at the very start of a line does not touch that line
    if (i === lines.length - 1 && i > 0 && l === '') return l;
    if (outdent) {
      const m = /^( {1,2}|\t)/.exec(l);
      if (m) { n = -m[0].length; next = l.slice(m[0].length); }
    } else { n = unit.length; next = unit + l; }
    if (i === 0) first = n;
    total += n;
    return next;
  });
  return { value: value.slice(0, from) + out.join('\n') + value.slice(end), start: Math.max(from, start + first), end: end + total };
}

/**
 * A text box for one YAML file (or part of one). It saves a moment after you stop typing, not when you click away, and
 * never rewrites what you typed (trailing spaces included). Wrong YAML is outlined in red with a tag in the corner; it is
 * not saved until it reads fine. Tab and Shift+Tab indent and outdent.
 */
function YamlBox({ ctl, part, text, onSaved }: { ctl: Controller; part: (typeof YAML_PARTS)[number]; text: string; onSaved: () => void }): JSX.Element {
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(text); // exactly what was last written (or loaded)
  const latest = useRef(value);
  const timer = useRef<number | null>(null);
  const escaped = useRef(false); // after Escape the next Tab leaves the box
  latest.current = value;
  const problem = yamlProblem(value);

  // a change that came from outside (another window, a sync) replaces the text, unless it is only our own save read back
  useEffect(() => {
    if (latest.current !== savedRef.current) return; // unsaved typing wins
    if (sameYaml(text, savedRef.current) && text.trim() !== '') return;
    if (document.activeElement === area.current && text === savedRef.current) return;
    savedRef.current = text;
    setValue(text);
  }, [text]);

  const save = async (): Promise<void> => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const v = latest.current;
    if (v === savedRef.current) return;
    if (yamlProblem(v) !== null) return;
    const r = await ctl.saveWorkspaceYaml(part.id, v);
    if (r.ok) {
      savedRef.current = v;
      setError(r.warning ? `Saved, but: ${r.warning}` : null);
      onSaved();
    } else setError(r.error);
  };
  const later = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), YAML_SAVE_DELAY);
  };
  // leaving the dialog saves what is pending
  useEffect(() => () => { if (timer.current !== null) void save(); }, []);

  const shown = problem ?? error;
  return (
    <div class="yaml-part">
      <h3 class="look-h">{part.title}</h3>
      <p class="pref-hint">{part.hint}</p>
      <div class={`yaml-wrap ${shown ? 'bad' : ''}`}>
        <textarea
          ref={area}
          class={`yaml-box ${shown ? 'bad' : ''}`}
          spellcheck={false}
          rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
          value={value}
          placeholder={part.placeholder}
          aria-label={part.title}
          aria-invalid={shown !== null}
          onInput={(e) => { setValue((e.currentTarget as HTMLTextAreaElement).value); setError(null); later(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { escaped.current = true; return; }
            if (e.key !== 'Tab') { escaped.current = false; return; }
            if (escaped.current) { escaped.current = false; return; }
            e.preventDefault();
            const t = e.currentTarget as HTMLTextAreaElement;
            const r = indentSelection(t.value, t.selectionStart, t.selectionEnd, e.shiftKey);
            setValue(r.value);
            latest.current = r.value;
            requestAnimationFrame(() => { t.setSelectionRange(r.start, r.end); });
            later();
          }}
        />
        {shown && <span class="yaml-tag" aria-hidden="true">Invalid YAML</span>}
      </div>
      {shown && <p class="pref-error" role="alert">{shown}{problem ? ' It is not saved until this is fixed.' : ' Not saved.'}</p>}
    </div>
  );
}

const ICON_PAGE = 120;

/** Choose a workspace icon: a few suggestions, or search the whole Lucide set by name or topic. */
function IconPicker({ value, onPick }: { value: string | null; onPick: (name: string | null) => void }): JSX.Element {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(ICON_PAGE);
  const found = useMemo(() => searchIcons(query), [query]);
  const list = found.slice(0, shown);
  return (
    <div class="icon-picker">
      <input
        type="search"
        class="icon-search"
        placeholder={`Search ${query ? '' : 'all '}icons (try “book”, “tree”, “music”)`}
        aria-label="Search icons"
        value={query}
        onInput={(e) => { setQuery((e.currentTarget as HTMLInputElement).value); setShown(ICON_PAGE); }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div class="icon-grid scroll" role="listbox" aria-label="Icons">
        <button class={`icon-choice ${value === null ? 'on' : ''}`} role="option" aria-selected={value === null} title="No icon" aria-label="No icon" onClick={() => onPick(null)}>
          <Icon name="close" size={14} />
        </button>
        {list.map((n) => (
          <button key={n} class={`icon-choice ${value === n ? 'on' : ''}`} role="option" aria-selected={value === n} title={n.replace(/-/g, ' ')} aria-label={n.replace(/-/g, ' ')} onClick={() => onPick(n)}>
            <WorkspaceIcon name={n} size={16} />
          </button>
        ))}
        {found.length === 0 && <p class="pref-hint">No icon matches “{query}”.</p>}
      </div>
      {found.length > shown && (
        <button class="pill-button" onClick={() => setShown(shown + 300)}>
          Show more ({(found.length - shown).toLocaleString()} left)
        </button>
      )}
      {query === '' && <p class="pref-hint">Suggestions are shown first; search to browse all {ALL_COUNT.toLocaleString()} icons. Icons by Lucide.</p>}
    </div>
  );
}

/** Everything that belongs to the open workspace: how it looks, which files are notes, and its YAML. */
function WorkspacePrefs({ ctl, root, appTypes }: { ctl: Controller; root: string; appTypes: { types: string; create: string } }): JSX.Element {
  const look = ctl.looks.value[root] ?? { color: null, icon: null, fontStyle: null, fontSizes: { sans: null, serif: null, mono: null } };
  const app = ctl.settings.value;
  const name = ctl.nameOf(root) ?? 'Workspace';
  const icon = look.icon && isIconName(look.icon) ? look.icon : null;
  const nt = ctl.noteTypes.value;
  const [ownTypes, setOwnTypes] = useState('');
  const [ownCreate, setOwnCreate] = useState('');
  const [yaml, setYaml] = useState<Record<YamlSection, string> | null>(null);
  const { types, create } = appTypes;
  useEffect(() => {
    void ctl.loadNoteTypes();
    void ctl.loadWorkspaceYaml().then(setYaml);
  }, [root]);
  useEffect(() => {
    const t = ctl.noteTypes.value;
    if (t) {
      setOwnTypes((t.own ?? t.effective).exts.join(', '));
      setOwnCreate((t.own ?? t.effective).create.slice(1));
    }
  }, [nt?.own?.exts.join(','), nt?.effective.exts.join(',')]);
  return (
    <PrefsLayout
      pages={[
        {
          id: 'look',
          title: 'Appearance',
          body: (
            <section>
      <p class="pref-hint">How “{name}” looks: its tab (shown, and not shown) and the text of its pages. The title bar takes the darkest shade (the lightest in light mode), the shown tab the fourth. It is saved in the workspace’s .cave-notes folder, so it follows the notes to other computers.</p>
      <div class="look-preview">
        {[true, false].map((active) => (
          <div key={String(active)} class={`tab ${active ? 'active' : ''}`} style={tabVars(ctl.theme.value, look.color ?? ctl.settings.value.defaultAccent, active)}>
            {icon && <WorkspaceIcon name={icon} size={15} class="tab-icon" />}
            <span class="tab-title">{name}</span>
          </div>
        ))}
      </div>
      <h4 class="look-h">Accent colour</h4>
      <div class="swatches">
        <button class={`swatch none ${look.color === null ? 'on' : ''}`} title="No colour" aria-label="No colour" onClick={() => void ctl.setWorkspaceLook(root, { color: null })}>
          <Icon name="close" size={12} />
        </button>
        <Families value={look.color} onPick={(c) => void ctl.setWorkspaceLook(root, { color: c })} />
        <label class="swatch custom" title="Other colour">
          <input type="color" value={look.color ?? '#3584e4'} onChange={(e) => void ctl.setWorkspaceLook(root, { color: (e.currentTarget as HTMLInputElement).value })} />
        </label>
      </div>
      <h4 class="look-h">Page text</h4>
      <FontControls
        style={look.fontStyle}
        sizes={look.fontSizes}
        hints={{ sans: app.fontSizes.sans ?? AUTO_FONT_SIZE.sans, serif: app.fontSizes.serif ?? AUTO_FONT_SIZE.serif, mono: app.fontSizes.mono ?? AUTO_FONT_SIZE.mono }}
        inherit
        onStyle={(v) => void ctl.setWorkspaceLook(root, { fontStyle: v })}
        onSize={(k, v) => void ctl.setWorkspaceLook(root, { fontSizes: { [k]: v } as Partial<FontSizes> as FontSizes })}
      />
      <h4 class="look-h">Icon</h4>
      <IconPicker value={icon} onPick={(n) => void ctl.setWorkspaceLook(root, { icon: n })} />
            </section>
          ),
        },
        {
          id: 'types',
          title: 'File types',
          body: (
            <section>
          {nt && (
            <div class="pref-sub">
              <Switch
                label="This workspace has its own file types"
                hint="Otherwise it follows the choice above. Saved in the workspace’s .cave-notes folder."
                checked={nt.own !== null}
                onChange={(v) => void ctl.setWorkspaceNoteTypes(v ? ownTypes || types : null, ownCreate || create)}
              />
              {nt.own !== null && (
                <>
                  <label class="pref-field">
                    <span class="pref-label">Notes here end in</span>
                    <input type="text" value={ownTypes} onInput={(e) => setOwnTypes((e.currentTarget as HTMLInputElement).value)} onBlur={() => void ctl.setWorkspaceNoteTypes(ownTypes, ownCreate)} onKeyDown={(e) => { if (e.key === 'Enter') void ctl.setWorkspaceNoteTypes(ownTypes, ownCreate); }} />
                  </label>
                  <label class="pref-field">
                    <span class="pref-label">New notes here are created as</span>
                    <input type="text" value={ownCreate} onInput={(e) => setOwnCreate((e.currentTarget as HTMLInputElement).value)} onBlur={() => void ctl.setWorkspaceNoteTypes(ownTypes, ownCreate)} onKeyDown={(e) => { if (e.key === 'Enter') void ctl.setWorkspaceNoteTypes(ownTypes, ownCreate); }} />
                  </label>
                </>
              )}
            </div>
          )}
            </section>
          ),
        },
        {
          id: 'yaml',
          title: 'YAML',
          body: (
            <section>
        <p class="pref-hint">The settings of this workspace, here as text. They are kept in the YAML files of its .cave-notes folder, and it does not matter which file holds which section: they can be in separate files or all in one (a section that is in several files is gathered into one when you save its box). Each box saves when you click away; text that is not valid is not saved.</p>
        {yaml ? YAML_PARTS.map((part) => <YamlBox key={part.id} ctl={ctl} part={part} text={yaml[part.id]} onSaved={() => void ctl.loadWorkspaceYaml().then(setYaml)} />) : <p class="pref-hint">Loading…</p>}
            </section>
          ),
        },
      ]}
    />
  );
}

function HistoryDialog({ ctl, path }: { ctl: Controller; path: string }): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void ctl.pageHistory(path).then((l) => {
      setEntries(l);
      if (l[0]) setSel(l[0].id);
    });
  }, [path]);
  useEffect(() => {
    setText(null);
    if (sel) void ctl.pageHistoryText(path, sel).then(setText);
  }, [sel]);
  const WHY: Record<string, string> = { saved: 'Saved here', disk: 'Changed on disk', merged: 'Merged', 'conflict-copy': 'Conflict copy', discarded: 'Set aside', 'before-restore': 'Before a restore' };
  return (
    <Modal title="Page History" onClose={() => ctl.closeDialog()} wide>
      <p class="dialog-body">Earlier versions of “{stripExt(path).split('/').pop()}” kept on this computer, outside the workspace. Restoring one is an ordinary edit you can undo.</p>
      {entries === null ? null : entries.length === 0 ? (
        <p class="dialog-body">Nothing is remembered for this page yet.</p>
      ) : (
        <div class="history-list" role="listbox" aria-label="Versions">
          {entries.map((e) => (
            <button key={e.id} role="option" aria-selected={sel === e.id} class={`history-row ${sel === e.id ? 'on' : ''}`} onClick={() => setSel(e.id)}>
              <span>{new Date(e.t).toLocaleString()}</span>
              <span class="pref-hint">{WHY[e.source] ?? e.source}</span>
              <small>{e.size.toLocaleString()} bytes</small>
            </button>
          ))}
        </div>
      )}
      {text !== null && <pre class="history-preview" tabIndex={0}>{text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text}</pre>}
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Close</button>
        <button class="pill-button suggested" disabled={text === null} onClick={() => text !== null && void ctl.restoreVersion(text)}>Restore This Version</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- export

const FONTS = ['Libertinus Serif', 'Linux Libertine', 'Crimson Pro', 'Libre Baskerville', 'Open Sans', 'Roboto', 'Inconsolata', 'Calibri', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Cambria', 'Verdana', 'Consolas', 'Courier New', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono'];

const SAMPLE_MD = `# A sample page

This is how body text looks, with **bold**, *italic*, ~~struck out~~ and \`inline code\`, a [link](https://example.com) and a footnote.[^1] A longer paragraph shows the line spacing and, when the style justifies it, how the lines are filled out to both edges of the page, so a few more words help.

## A second-level heading

> A blockquote: someone else's words, set apart from the rest of the text.

### Lists

- A bullet
- Another, with a task below
- [x] A finished task
- [ ] An open task

1. First step
2. Second step

#### Code and a table

\`\`\`
let answer = 42;
\`\`\`

| Name | Value |
|------|------:|
| One  |     1 |
| Two  |     2 |

##### A fifth-level heading

###### A sixth-level heading

Last, a second note.[^2]

[^1]: The first footnote: where it goes depends on the style (at the foot of the page, or at the end).
[^2]: The second footnote.
`;

/**
 * The page as sheets of paper at their real size, scaled to fit the room there is, so margins and type keep their
 * proportions. The text is cut into pages the way printing cuts it, so page breaks and the number of pages show, with
 * each page's running header and footer. `onPages` hears how many pages there are.
 */
function PagePreview({ html, style, title, onPages }: { html: string; style: StyleSet; title: string; onPages?: (n: number) => void }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 600, h: 700 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = frameObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const cut = async (): Promise<void> => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    try {
      await doc.fonts.ready;
    } catch {
      /* measure with what there is */
    }
    if (frame.current?.contentDocument !== doc) return;
    onPages?.(paginate(doc, style, title));
  };
  const pageW = Math.round((PAGE_CM[style.page.size][0] * 96) / 2.54) + 24;
  const k = Math.max(0.2, Math.min(2, (size.w - 8) / pageW));
  return (
    <div class="export-preview" ref={box}>
      <iframe ref={frame} title="Preview" sandbox="allow-same-origin" srcDoc={html} onLoad={() => void cut()} style={{ width: `${pageW}px`, height: `${size.h / k}px`, transform: `scale(${k})`, transformOrigin: 'top left', marginLeft: `${Math.max(0, (size.w - pageW * k) / 2)}px` }} />
    </div>
  );
}

const ORIGIN_NOTE: Record<string, string> = { 'built in': '', 'all workspaces': ' · all workspaces', 'this workspace': ' · this workspace' };

/** The preview of a presentation: one slide at a time, with the layout of each changeable, and the way to present or export it. */

/** What the picture bar and the crop window change in a picture's `{…}`. */
type PicturePatch = Parameters<Controller['setPictureSettings']>[3];

/** Buttons for the pictures of the slide that is shown: expand to the slide's height or shrink, crop and size, background. */
function PicturesBar({ ctl, slide, onChanged }: { ctl: Controller; slide: NonNullable<Awaited<ReturnType<Controller['buildPresentation']>>['placed'][number]>; onChanged: () => void }): JSX.Element | null {
  const { from, to } = slide.slide;
  const refs = ctl.slidePictures(from, to);
  const [which, setWhich] = useState(0);
  const [cropping, setCropping] = useState(false);
  useEffect(() => setWhich(0), [slide.slide.index]);
  if (!refs.length) return null;
  const ref = refs[Math.min(which, refs.length - 1)]!;
  const ordinary = refs.filter((r) => !r.attrs.background);
  const fit = slide.imageFit;
  const toggles = !!fit && ordinary.length === 1 && ordinary[0]!.index === ref.index && !ref.attrs.background;
  const tall = fit?.mode === 'tall';
  const change = (patch: PicturePatch): void => {
    ctl.setPictureSettings(from, to, ref.index, patch);
    onChanged();
  };
  return (
    <div class="present-bar present-pics">
      <label>
        Picture{' '}
        <select value={ref.index} onChange={(e) => setWhich(Number((e.target as HTMLSelectElement).value))}>
          {refs.map((r) => <option key={r.index} value={r.index}>{(r.alt || r.url).slice(0, 40)}{r.attrs.background ? ' (background)' : ''}</option>)}
        </select>
      </label>
      <button
        class="pill-button"
        disabled={!toggles || !fit?.canToggle}
        title={toggles && !fit?.canToggle ? (fit?.mode === 'set' ? 'This picture has a width or height of its own' : 'This picture is already as tall as the slide') : tall ? `Make the picture no wider than ${fit?.maxWidth ?? 55}% of the slide` : 'Make the picture as tall as the slide'}
        onClick={() => change({ fit: tall ? null : 'tall' })}
      >
        {tall ? `Shrink to ${fit?.maxWidth ?? 55}% width` : 'Expand to slide height'}
      </button>
      <button class="pill-button" disabled={ref.attrs.background} title="Cut the picture and give it a size, seeing how it fits in the slide" onClick={() => setCropping(true)}>Crop and size…</button>
      <button class="pill-button" title="A background picture fills the whole slide behind the text" onClick={() => change({ background: ref.attrs.background ? null : true, ...(ref.attrs.background ? { dim: null } : {}) })}>
        {ref.attrs.background ? 'Not the background' : 'Use as background'}
      </button>
      {ref.attrs.background && (
        <label title="Darken the picture so that the text can be read">
          Darken{' '}
          <input type="number" min={0} max={100} step={5} style={{ width: '4.5em' }} value={Math.round(ref.attrs.dim ?? 0)} onChange={(e) => change({ dim: Math.max(0, Math.min(100, Number((e.target as HTMLInputElement).value) || 0)) || null })} /> %
        </label>
      )}
      {cropping && <CropPanel ctl={ctl} slide={slide} picture={ref} onClose={(changed) => { setCropping(false); if (changed) onChanged(); }} />}
    </div>
  );
}

const UNITS: Unit[] = ['%', 'px', 'in', 'mm'];

/** Crop a picture on the picture itself, and see on the right how the slide shows it. */
function CropPanel({ ctl, slide, picture, onClose }: { ctl: Controller; slide: Parameters<typeof PicturesBar>[0]['slide']; picture: ImageRef; onClose: (changed: boolean) => void }): JSX.Element {
  const { from, to } = slide.slide;
  const [pic, setPic] = useState<{ w: number; h: number; src: string } | null>(null);
  const [unit, setUnit] = useState<Unit>(picture.attrs.crop?.[0]?.unit ?? '%');
  const [size, setSize] = useState<Unit>(picture.attrs.width?.unit ?? picture.attrs.height?.unit ?? '%');
  const [width, setWidth] = useState(picture.attrs.width ? String(Math.round(picture.attrs.width.v * 100) / 100) : '');
  const [height, setHeight] = useState(picture.attrs.height ? String(Math.round(picture.attrs.height.v * 100) / 100) : '');
  const [f, setF] = useState<Fractions>({ l: 0, t: 0, r: 0, b: 0 });
  const [html, setHtml] = useState<{ slide: string; css: string; w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    void ctl.measurePicture(picture.url).then((p) => {
      setPic(p);
      setF(cropFractions(picture.attrs.crop, p));
    });
  }, []);
  // what would be written: crop in the chosen unit, size in its unit
  const patch = (): PicturePatch => {
    const dims = pic ? { w: pic.w, h: pic.h } : null;
    const cv = (frac: number, whole: number | undefined) => pxToLen(frac * (whole ?? 0), unit, unit === '%' ? 1 : null);
    const crop: PicturePatch['crop'] =
      f.l + f.t + f.r + f.b < 0.0005
        ? null
        : unit === '%'
          ? [f.l, f.t, f.r, f.b].map((v) => ({ v: Math.round(v * 10000) / 100, unit: '%' as Unit })) as NonNullable<PicturePatch['crop']>
          : ([cv(f.l, dims?.w), cv(f.t, dims?.h), cv(f.r, dims?.w), cv(f.b, dims?.h)] as NonNullable<PicturePatch['crop']>);
    const num = (t: string) => (t.trim() !== '' && Number(t) > 0 ? { v: Number(t), unit: size } : null);
    return { crop, width: num(width), height: num(height) };
  };
  // the slide as it will look, drawn again shortly after each change
  useEffect(() => {
    if (!pic) return;
    const t = setTimeout(() => {
      const md = ctl.withPictureSettings(from, to, picture.index, patch());
      if (md === null) return;
      void ctl.buildPresentation(0, false, md).then((b) => {
        const d = SLIDE_PT[b.theme.size];
        setHtml({ slide: b.slides[slide.slide.index] ?? '', css: b.css, w: d.w, h: d.h });
      });
    }, 150);
    return () => clearTimeout(t);
  }, [pic, f, unit, size, width, height]);
  useEffect(() => {
    const el = view.current;
    if (!el || !html) return;
    const fit = (): void => setScale(Math.max(0.05, el.clientWidth / (html.w * (4 / 3))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);
  // dragging an edge or the whole frame
  const drag = (mode: string) => (e: PointerEvent): void => {
    const el = box.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, f: { ...f } };
    const move = (m: PointerEvent): void => {
      const dx = (m.clientX - start.x) / r.width;
      const dy = (m.clientY - start.y) / r.height;
      const n = { ...start.f };
      const lim = 0.95;
      if (mode.includes('l')) n.l = Math.max(0, Math.min(lim - n.r, start.f.l + dx));
      if (mode.includes('r')) n.r = Math.max(0, Math.min(lim - n.l, start.f.r - dx));
      if (mode.includes('t')) n.t = Math.max(0, Math.min(lim - n.b, start.f.t + dy));
      if (mode.includes('b')) n.b = Math.max(0, Math.min(lim - n.t, start.f.b - dy));
      if (mode === 'move') {
        const w = 1 - start.f.l - start.f.r;
        const h = 1 - start.f.t - start.f.b;
        n.l = Math.max(0, Math.min(1 - w, start.f.l + dx));
        n.r = 1 - w - n.l;
        n.t = Math.max(0, Math.min(1 - h, start.f.t + dy));
        n.b = 1 - h - n.t;
      }
      setF(n);
    };
    const up = (): void => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const shown = (side: keyof Fractions): string => {
    const whole = side === 'l' || side === 'r' ? pic?.w : pic?.h;
    const px = f[side] * (whole ?? 0);
    const len = unit === '%' ? { v: f[side] * 100, unit } : pxToLen(px, unit, null);
    return String(Math.round(len.v * 100) / 100);
  };
  const typed = (side: keyof Fractions) => (e: Event): void => {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 0 || !pic) return;
    const whole = side === 'l' || side === 'r' ? pic.w : pic.h;
    const frac = unit === '%' ? v / 100 : unit === 'px' ? v / whole : unit === 'in' ? (v * 96) / whole : ((v / 25.4) * 96) / whole;
    setF({ ...f, [side]: Math.max(0, Math.min(0.95, frac)) });
  };
  const handles = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
  const apply = (): void => {
    ctl.setPictureSettings(from, to, picture.index, patch());
    onClose(true);
  };
  return (
    <div class="crop-panel" onClick={(e) => e.stopPropagation()}>
      <div class="crop-head">
        <strong>Crop and size</strong>
        <span class="crop-note">{picture.alt || picture.url}</span>
        <span class="present-actions">
          <button class="pill-button" onClick={() => { setF({ l: 0, t: 0, r: 0, b: 0 }); setWidth(''); setHeight(''); }}>Reset</button>
          <button class="pill-button" onClick={() => onClose(false)}>Cancel</button>
          <button class="pill-button suggested" onClick={apply}>Apply</button>
        </span>
      </div>
      <div class="crop-body">
        <div class="crop-left">
          {pic ? (
            <div class="crop-source" ref={box} style={{ aspectRatio: `${pic.w} / ${pic.h}` }}>
              <img src={pic.src} alt="" draggable={false} />
              <div class="crop-shade" style={{ left: 0, top: 0, width: '100%', height: `${f.t * 100}%` }} />
              <div class="crop-shade" style={{ left: 0, bottom: 0, width: '100%', height: `${f.b * 100}%` }} />
              <div class="crop-shade" style={{ left: 0, top: `${f.t * 100}%`, width: `${f.l * 100}%`, height: `${(1 - f.t - f.b) * 100}%` }} />
              <div class="crop-shade" style={{ right: 0, top: `${f.t * 100}%`, width: `${f.r * 100}%`, height: `${(1 - f.t - f.b) * 100}%` }} />
              <div class="crop-frame" style={{ left: `${f.l * 100}%`, top: `${f.t * 100}%`, right: `${f.r * 100}%`, bottom: `${f.b * 100}%` }} onPointerDown={drag('move')}>
                {handles.map((h) => <span key={h} class={`crop-handle h-${h}`} onPointerDown={drag(h)} />)}
              </div>
            </div>
          ) : (
            <p class="pref-hint">Loading the picture…</p>
          )}
          <div class="crop-fields">
            <label>Cut off in{' '}<select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value as Unit)}>{UNITS.map((u) => <option key={u} value={u}>{u === '%' ? 'percent' : u === 'px' ? 'pixels' : u === 'in' ? 'inches' : 'mm'}</option>)}</select></label>
            {(['l', 't', 'r', 'b'] as const).map((k) => (
              <label key={k}>{{ l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }[k]}{' '}<input type="number" min={0} step="any" style={{ width: '5.5em' }} value={shown(k)} onChange={typed(k)} /></label>
            ))}
          </div>
          <div class="crop-fields" title="A width or height of its own replaces the size the layout would give. Leave both empty for the automatic size.">
            <label>Size on the slide{' '}<select value={size} onChange={(e) => setSize((e.target as HTMLSelectElement).value as Unit)}>{UNITS.map((u) => <option key={u} value={u}>{u === '%' ? '% of the slide' : u}</option>)}</select></label>
            <label>Width{' '}<input type="number" min={0} step="any" style={{ width: '5.5em' }} value={width} placeholder="auto" onChange={(e) => setWidth((e.target as HTMLInputElement).value)} /></label>
            <label>Height{' '}<input type="number" min={0} step="any" style={{ width: '5.5em' }} value={height} placeholder="auto" onChange={(e) => setHeight((e.target as HTMLInputElement).value)} /></label>
          </div>
        </div>
        <div class="crop-right deck-scope" ref={view}>
          {html ? (
            <div class="crop-slide-box" style={{ height: `${html.h * (4 / 3) * scale}px` }}>
              <style>{html.css}</style>
              <div class="present-slide-static" style={{ width: `${html.w}pt`, height: `${html.h}pt`, transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html.slide }} />
            </div>
          ) : (
            <p class="pref-hint">Drawing the slide…</p>
          )}
          <p class="pref-hint">How the slide will look. Inches and millimetres of a cut are measured on the picture at 96 to the inch; those of a size on the slide itself.</p>
        </div>
      </div>
    </div>
  );
}

function PresentationDialog({ ctl }: { ctl: Controller; present?: boolean }): JSX.Element {
  const [built, setBuilt] = useState<Awaited<ReturnType<Controller['buildPresentation']>> | null>(null);
  const [index, setIndex] = useState(0);
  const [version, setVersion] = useState(0);
  const [scale, setScale] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const keepAt = useRef(0);
  ctl.presentationTheme.value; // re-draw when the theme changes
  useEffect(() => {
    let live = true;
    void ctl.buildPresentation().then((b) => {
      if (!live) return;
      setBuilt(b);
      setIndex(Math.min(keepAt.current, Math.max(0, b.placed.length - 1)));
    });
    return () => {
      live = false;
    };
  }, [version]);
  const size = built ? SLIDE_PT[built.theme.size] : { w: 960, h: 540 };
  // the slide is drawn at its own size and scaled to the room there is
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = (): void => setScale(Math.max(0.05, Math.min(el.clientWidth / (size.w * (4 / 3)), el.clientHeight / (size.h * (4 / 3)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [built, size.w, size.h]);
  const count = built?.placed.length ?? 0;
  const go = (i: number): void => {
    const n = Math.max(0, Math.min(count - 1, i));
    keepAt.current = n;
    setIndex(n);
  };
  const rebuild = (): void => setVersion((v) => v + 1);
  // Right and Down go on, Left and Up go back, wherever the keyboard is in the preview (but not while a menu or a field is being used)
  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('select, input, textarea, [contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') go(index + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') go(index - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(count - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  useEffect(() => {
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  const slide = built?.placed[index];
  const layoutNames = built ? Object.keys(built.theme.layouts) : [];
  const themes = ctl.presentationThemes();
  return (
    <Modal title="Presentation" onClose={() => ctl.closeDialog()} full>
      <div class="present-bar">
        <label>
          Theme{' '}
          <select value={built?.theme.name ?? ''} onChange={(e) => { keepAt.current = index; ctl.setPresentationTheme((e.target as HTMLSelectElement).value); rebuild(); }}>
            {themes.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
        <span class="present-nav">
          <button class="pill-button" disabled={index <= 0} onClick={() => go(index - 1)} aria-label="Previous slide">‹</button>
          <span>{built ? `${index + 1} / ${count}` : ''}</span>
          <button class="pill-button" disabled={!built || index >= count - 1} onClick={() => go(index + 1)} aria-label="Next slide">›</button>
        </span>
        <label title="Which layout this slide uses. “Automatic” lets the rules decide from what the slide holds.">
          Layout of this slide{' '}
          <select
            value={slide?.slide.manual ?? ''}
            disabled={!slide}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              keepAt.current = index;
              ctl.setSlideLayout(index, v === '' ? null : v);
              rebuild();
            }}
          >
            <option value="">Automatic{slide && !slide.slide.manual ? ` (${slide.layoutName})` : ''}</option>
            {layoutNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span class="present-actions">
          {ctl.caps.windows && <button class="pill-button suggested" title="Show the slides full screen in their own window (see Preferences, Presentations, for the screens)" onClick={() => void ctl.startPresenting(index)}>Present</button>}
          {ctl.caps.exportDocuments && <button class="pill-button" onClick={() => void ctl.exportPresentation('pdf')}>PDF…</button>}
          {ctl.caps.exportDocuments && <button class="pill-button" onClick={() => void ctl.exportPresentation('html')}>HTML…</button>}
        </span>
      </div>
      {slide && <PicturesBar ctl={ctl} slide={slide} onChanged={() => { keepAt.current = index; rebuild(); }} />}
      {built && (slide?.dropped.length || slide?.missing || built.warnings.length > 0) ? (
        <ul class="present-warnings">
          {slide?.missing && <li>This layout is not in the theme “{built.theme.name}”, so “content” is used.</li>}
          {slide?.dropped.length ? <li>{slide.dropped.map((b) => b.kind).join(', ')} {slide.dropped.length > 1 ? 'have' : 'has'} no place in the “{slide.layoutName}” layout and {slide.dropped.length > 1 ? 'are' : 'is'} not shown.</li> : null}
          {built.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      <div class="present-stage deck-scope" ref={stage} onClick={(e) => go(index + ((e as MouseEvent).clientX > window.innerWidth / 3 ? 1 : -1))}>
        {built ? (
          <>
            <style>{built.css}</style>
            <div class="present-slide" style={{ width: `${size.w}pt`, height: `${size.h}pt`, transform: `translate(-50%, -50%) scale(${scale})` }} dangerouslySetInnerHTML={{ __html: built.slides[index] ?? '' }} />
          </>
        ) : (
          <p class="pref-hint">Preparing the slides…</p>
        )}
      </div>
    </Modal>
  );
}

function ExportDialog({ ctl, markdown, title, path }: { ctl: Controller; markdown: string; title: string; path: string }): JSX.Element {
  const s = ctl.settings.value;
  useEffect(() => void ctl.loadExportStyles(), []);
  ctl.exportYaml.value; // re-draw when the style files change
  const all = ctl.exportStyleSets();
  // a page that names its style (`exportStyle:`) starts with it
  const [name, setName] = useState(() => (ctl.docStats.value.style && ctl.exportStyleNamed(ctl.docStats.value.style) ? ctl.docStats.value.style : s.exportStyle));
  const [format, setFormat] = useState<'docx' | 'odt' | 'pdf'>(s.exportFormat);
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const chosen = ctl.withWorkspaceStyles((all.find((x) => x.set.name === name) ?? all[0]!).set);
  const blocks = useMemo(() => parseDoc(markdown), [markdown]);
  const html = useMemo(() => renderHtml(blocks, chosen, { title, paged: true, css: ctl.fontCss.value }), [blocks, chosen, title, ctl.fontCss.value]);
  const go = async (): Promise<void> => {
    setBusy(true);
    ctl.setPreferences({ exportStyle: chosen.name, exportFormat: format });
    const ok = await ctl.exportPage({ format, markdown, title, style: chosen as unknown as Record<string, unknown> });
    // the page remembers the style it was exported in: the next export, and the page count, start with it
    if (ok) await saveTheme();
    setBusy(false);
    if (ok) ctl.closeDialog();
  };
  const pageStyle = ctl.docStats.value.style;
  const themeChanged = chosen.name !== pageStyle;
  const saveTheme = async (): Promise<void> => {
    if (themeChanged) await ctl.setPageAttribute(path, 'exportStyle', chosen.name);
  };
  return (
    <Modal title="Export Page" onClose={() => ctl.closeDialog()} full>
      <div class="export-body">
        <div class="export-controls">
          <label class="pref-field">
            <span class="pref-label">Format</span>
            <select aria-label="Format" value={format} onChange={(e) => setFormat((e.currentTarget as HTMLSelectElement).value as 'docx' | 'odt' | 'pdf')}>
              <option value="docx">Word document (.docx)</option>
              <option value="odt">OpenDocument text (.odt)</option>
              <option value="pdf">PDF (.pdf)</option>
            </select>
          </label>
          <label class="pref-field">
            <span class="pref-label">Style set</span>
            <select aria-label="Style set" value={chosen.name} onChange={(e) => setName((e.currentTarget as HTMLSelectElement).value)}>
              {all.map((x) => <option key={x.set.name} value={x.set.name}>{x.set.name}{ORIGIN_NOTE[x.origin]}</option>)}
            </select>
          </label>
          <div class="dialog-actions start">
            <button class="pill-button" onClick={() => ctl.openExportStyles()}>Edit Styles…</button>
          </div>
          {pages !== null && <p class="pref-hint export-pages">{pages === 1 ? '1 page' : `${pages} pages`}{format === 'pdf' ? '' : ' (Word and LibreOffice may break a page or two differently)'}</p>}
          {chosen.footnotes.endnotes || format === 'pdf' ? <p class="pref-hint">{format === 'pdf' ? 'In a PDF the notes are collected after the text.' : 'This style puts the notes at the end of the document.'}</p> : null}
        </div>
        <PagePreview html={html} style={chosen} title={title} onPages={setPages} />
      </div>
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>
        <button class="pill-button" disabled={busy || !themeChanged} title={themeChanged ? `Does not export, but writes exportStyle: ${chosen.name} in the attributes of this page` : 'The page already has this style'} onClick={() => void saveTheme().then(() => ctl.closeDialog())}>Cancel, but save theme</button>
        <button class="pill-button suggested" disabled={busy} onClick={() => void go()}>{busy ? 'Exporting…' : 'Export…'}</button>
      </div>
    </Modal>
  );
}

/** The export style files as text, with a sample page that follows every change, and a form for one set at a time. */
function ExportStylesDialog({ ctl }: { ctl: Controller }): JSX.Element {
  const [scope, setScope] = useState<'workspace' | 'global'>('global'); // new styles are kept in the app's folder unless the workspace is chosen
  const [texts, setTexts] = useState(ctl.exportYaml.value);
  const [saved, setSaved] = useState(ctl.exportYaml.value);
  const [form, setForm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = texts[scope];
  const parsed = useMemo(() => parseStyleSetsYaml(text), [text]);
  const all = useMemo(() => ctl.exportStyleSets(texts), [texts, ctl.settings.value.exportStyles]);
  const [name, setName] = useState(ctl.settings.value.exportStyle);
  const chosen = (all.find((x) => x.set.name === name) ?? all[0]!).set;
  const html = useMemo(() => renderHtml(parseDoc(SAMPLE_MD), chosen, { title: 'A sample page', paged: true, css: ctl.fontCss.value }), [chosen, ctl.fontCss.value]);
  const dirty = texts.global !== saved.global || texts.workspace !== saved.workspace;
  const setText = (v: string): void => {
    setTexts({ ...texts, [scope]: v });
    setError(null);
  };
  const save = async (): Promise<void> => {
    for (const sc of ['global', 'workspace'] as const) {
      if (texts[sc] === saved[sc]) continue;
      const err = await ctl.saveExportStyles(sc, texts[sc]);
      if (err) {
        setError(`${sc === 'global' ? 'All workspaces' : 'This workspace'}: ${err}`);
        return;
      }
    }
    setSaved(texts);
    ctl.closeDialog();
  };
  const addFrom = (): void => {
    const copy = { ...structuredClone(chosen), name: `${chosen.name} copy` };
    const own = parsed.sets.filter((x) => x.name !== copy.name);
    setText(stringifyStyleSets([...own, copy]));
    setName(copy.name);
    setForm(copy.name);
  };
  const editing = form !== null ? parsed.sets.find((x) => x.name === form) : undefined;
  const onForm = (next: StyleSet): void => {
    setText(stringifyStyleSets(parsed.sets.map((x) => (x.name === form ? next : x))));
    setForm(next.name);
    setName(next.name);
  };
  return (
    <Modal title="Export Styles" onClose={() => ctl.closeDialog()} full>
      <div class="export-body">
        <div class="export-controls wide">
          <label class="pref-field">
            <span class="pref-label">Keep these styles for</span>
            <select aria-label="Where the styles are kept" value={scope} onChange={(e) => { setScope((e.currentTarget as HTMLSelectElement).value as 'workspace' | 'global'); setForm(null); }}>
              {ctl.workspace.value && !ctl.activeSingle.value && <option value="workspace">This workspace ({ctl.workspace.value.name})</option>}
              <option value="global">All workspaces</option>
            </select>
          </label>
          <p class="pref-hint">Written as YAML, one entry per style set. {scope === 'workspace' ? 'Saved as the export-style: section of a settings file in this workspace’s .cave-notes folder, so it travels with the notes.' : 'Saved in styles/export-styles.yaml of the app’s settings folder, for every workspace (the styles that come with the app are written there the first time, so you can edit them); a workspace’s own set of the same name wins.'} See docs/export-styles.md.</p>
          <textarea class="yaml-box tall" spellcheck={false} aria-label="Export styles (YAML)" value={text} placeholder={'My Report:\n  base: Report\n  units: in\n  page: { size: Letter, margin: 1in }\n  body: { font: Libre Baskerville, size: 11pt }\n  footnotes: { placement: endnotes }'} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
          {(parsed.errors[0] ?? error) && <p class="pref-error" role="alert">{parsed.errors[0] ?? error}</p>}
          <label class="pref-field">
            <span class="pref-label">Show the sample in</span>
            <select aria-label="Style for the sample" value={chosen.name} onChange={(e) => setName((e.currentTarget as HTMLSelectElement).value)}>
              {all.map((x) => <option key={x.set.name} value={x.set.name}>{x.set.name}{ORIGIN_NOTE[x.origin]}</option>)}
            </select>
          </label>
          <div class="dialog-actions start">
            <button class="pill-button" onClick={addFrom}>New From “{chosen.name}”</button>
            {ctl.caps.windows && <button class="pill-button" title="Add the export styles of a YAML file or a zip" onClick={() => ctl.openImport('style')}>Add From a File…</button>}
            {parsed.sets.some((x) => x.name === chosen.name) && <button class="pill-button" onClick={() => setForm(form === chosen.name ? null : chosen.name)}>{form === chosen.name ? 'Hide the Form' : 'Edit With a Form'}</button>}
          </div>
          {editing && <StyleEditor set={editing} onChange={onForm} />}
          <details class="fonts-box">
            <summary>Fonts that come with Cave Notes</summary>
            <p class="pref-hint">{FONTS.slice(0, 6).join(', ')}. They are used in previews and PDFs without installing anything. Word and LibreOffice use the fonts installed on the computer, so install these to see the same in a Word or ODT file.</p>
            <div class="dialog-actions start">
              <button class="pill-button" onClick={() => void ctl.installFonts()}>Install for Me</button>
              <button class="pill-button" onClick={() => void ctl.saveFonts()}>Save the Font Files…</button>
            </div>
          </details>
        </div>
        <PagePreview html={html} style={chosen} title="A sample page" />
      </div>
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>
        <button class="pill-button suggested" disabled={!dirty || parsed.errors.length > 0} onClick={() => void save()}>Save</button>
      </div>
    </Modal>
  );
}

/** Form for one style set: paper, text, headings, code, blockquotes, notes, links. Lengths are shown in the set's own unit. */
function StyleEditor({ set, onChange }: { set: StyleSet; onChange: (s: StyleSet) => void }): JSX.Element {
  const upd = (patch: Partial<StyleSet>): void => onChange({ ...set, ...patch });
  const u = set.units;
  const toUnit = (cm: number): number => Math.round((u === 'in' ? cm / 2.54 : cm) * 100) / 100;
  const fromUnit = (n: number): number => (u === 'in' ? n * 2.54 : n);
  const num = (v: string, d: number): number => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : d);
  const Num = ({ label, value, on, step = 1 }: { label: string; value: number; on: (n: number) => void; step?: number }): JSX.Element => (
    <label class="se-field"><span>{label}</span><input type="number" step={step} value={value} onInput={(e) => on(num((e.currentTarget as HTMLInputElement).value, value))} /></label>
  );
  const Len = ({ label, cm, on }: { label: string; cm: number; on: (cm: number) => void }): JSX.Element => (
    <Num label={`${label} (${u === 'in' ? 'in' : 'cm'})`} step={u === 'in' ? 0.05 : 0.1} value={toUnit(cm)} on={(n) => on(fromUnit(n))} />
  );
  const Font = ({ label, value, on }: { label: string; value: string; on: (f: string) => void }): JSX.Element => (
    <label class="se-field"><span>{label}</span>
      <input type="text" list="export-fonts" value={value} onInput={(e) => on((e.currentTarget as HTMLInputElement).value)} />
    </label>
  );
  const Color = ({ label, value, on }: { label: string; value: string; on: (c: string) => void }): JSX.Element => (
    <label class="se-field"><span>{label}</span><input type="color" value={value} onInput={(e) => on((e.currentTarget as HTMLInputElement).value)} /></label>
  );
  const Check = ({ label, value, on }: { label: string; value: boolean; on: (b: boolean) => void }): JSX.Element => (
    <label class="se-field se-check"><input type="checkbox" checked={value} onChange={(e) => on((e.currentTarget as HTMLInputElement).checked)} /><span>{label}</span></label>
  );
  const [lvl, setLvl] = useState(0);
  const h = set.headings[lvl]!;
  const setH = (patch: Partial<typeof h>): void => upd({ headings: set.headings.map((x, i) => (i === lvl ? { ...x, ...patch } : x)) as StyleSet['headings'] });
  return (
    <div class="style-editor" data-style-editor>
      <datalist id="export-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
      <h4>Paper</h4>
      <label class="se-field"><span>Units</span>
        <select value={u} aria-label="Units" onChange={(e) => upd({ units: (e.currentTarget as HTMLSelectElement).value as StyleSet['units'] })}>
          <option value="cm">Centimetres</option><option value="in">Inches</option>
        </select>
      </label>
      <label class="se-field"><span>Size</span>
        <select value={set.page.size} onChange={(e) => upd({ page: { ...set.page, size: (e.currentTarget as HTMLSelectElement).value as StyleSet['page']['size'] } })}>
          <option>A4</option><option>Letter</option><option>A5</option>
        </select>
      </label>
      <Len label="Margins" cm={set.page.marginCm} on={(cm) => upd({ page: { ...set.page, marginCm: cm } })} />
      <h4>Text</h4>
      <Font label="Font" value={set.body.font} on={(f) => upd({ body: { ...set.body, font: f } })} />
      <Num label="Size (pt)" step={0.5} value={set.body.sizePt} on={(n) => upd({ body: { ...set.body, sizePt: n } })} />
      <Num label="Line spacing" step={0.1} value={set.body.lineHeight} on={(n) => upd({ body: { ...set.body, lineHeight: n } })} />
      <Num label="Space after paragraph (pt)" value={set.body.paragraphAfter} on={(n) => upd({ body: { ...set.body, paragraphAfter: n } })} />
      <Len label="First-line indent" cm={set.body.firstLineIndentCm} on={(cm) => upd({ body: { ...set.body, firstLineIndentCm: Math.max(0, cm) } })} />
      {set.body.firstLineIndentCm > 0 && <Check label="Indent the paragraph after a heading too" value={set.body.indentAfterHeading} on={(b) => upd({ body: { ...set.body, indentAfterHeading: b } })} />}
      <Color label="Colour" value={set.body.color} on={(c) => upd({ body: { ...set.body, color: c } })} />
      <Check label="Justify" value={set.body.justify} on={(b) => upd({ body: { ...set.body, justify: b } })} />
      <Check label="Put the page’s title at the top when it has no heading" value={set.titleFromPage} on={(b) => upd({ titleFromPage: b })} />
      <h4>Headings</h4>
      <div class="se-tabs" role="tablist" aria-label="Heading level">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} role="tab" aria-selected={lvl === n - 1} class={`pill-button small ${lvl === n - 1 ? 'on' : ''}`} onClick={() => setLvl(n - 1)}>H{n}</button>)}</div>
      <Font label="Font" value={h.font} on={(f) => setH({ font: f })} />
      <Num label="Size (pt)" step={0.5} value={h.sizePt} on={(n) => setH({ sizePt: n })} />
      <Color label="Colour" value={h.color} on={(c) => setH({ color: c })} />
      <Num label="Space before (pt)" value={h.before} on={(n) => setH({ before: n })} />
      <Num label="Space after (pt)" value={h.after} on={(n) => setH({ after: n })} />
      <Num label="Line height" step={0.05} value={h.lineHeight} on={(n) => setH({ lineHeight: Math.max(0.8, Math.min(3, n)) })} />
      <Check label="Bold" value={h.bold} on={(b) => setH({ bold: b })} />
      <Check label="Italic" value={h.italic} on={(b) => setH({ italic: b })} />
      <h4>Code</h4>
      <Font label="Font" value={set.code.font} on={(f) => upd({ code: { ...set.code, font: f } })} />
      <Num label="Size (pt)" step={0.5} value={set.code.sizePt} on={(n) => upd({ code: { ...set.code, sizePt: n } })} />
      <Color label="Background" value={set.code.background} on={(c) => upd({ code: { ...set.code, background: c } })} />
      <h4>Blockquotes</h4>
      <Color label="Colour" value={set.blockquote.color} on={(c) => upd({ blockquote: { ...set.blockquote, color: c } })} />
      <Color label="Bar" value={set.blockquote.bar} on={(c) => upd({ blockquote: { ...set.blockquote, bar: c } })} />
      <Len label="Indent" cm={set.blockquote.indentCm} on={(cm) => upd({ blockquote: { ...set.blockquote, indentCm: cm } })} />
      <Check label="Italic" value={set.blockquote.italic} on={(b) => upd({ blockquote: { ...set.blockquote, italic: b } })} />
      <h4>Footnotes</h4>
      <label class="se-field"><span>Place notes</span>
        <select value={set.footnotes.endnotes ? 'end' : 'foot'} aria-label="Where notes go" onChange={(e) => upd({ footnotes: { ...set.footnotes, endnotes: (e.currentTarget as HTMLSelectElement).value === 'end' } })}>
          <option value="foot">At the foot of the page</option><option value="end">At the end (endnotes)</option>
        </select>
      </label>
      <Num label="Size (pt)" step={0.5} value={set.footnotes.sizePt} on={(n) => upd({ footnotes: { ...set.footnotes, sizePt: n } })} />
      <Color label="Colour" value={set.footnotes.color} on={(c) => upd({ footnotes: { ...set.footnotes, color: c } })} />
      <Check label="Italic" value={set.footnotes.italic} on={(b) => upd({ footnotes: { ...set.footnotes, italic: b } })} />
      <h4>Tables, links, lists</h4>
      <Color label="Table header" value={set.table.headerBackground} on={(c) => upd({ table: { ...set.table, headerBackground: c } })} />
      <Color label="Table lines" value={set.table.border} on={(c) => upd({ table: { ...set.table, border: c } })} />
      <Color label="Link colour" value={set.link.color} on={(c) => upd({ link: { ...set.link, color: c } })} />
      <Check label="Underline links" value={set.link.underline} on={(b) => upd({ link: { ...set.link, underline: b } })} />
      <Len label="List indent" cm={set.listIndentCm} on={(cm) => upd({ listIndentCm: cm })} />
    </div>
  );
}

export function DialogHost({ ctl }: { ctl: Controller }): JSX.Element | null {
  const d = ctl.dialog.value;
  if (!d) return null;
  switch (d.kind) {
    case 'plugin-ask':
      return <PluginAskDialog key={d.title} ctl={ctl} d={d} />;
    case 'prompt':
      return <PromptDialog key={d.title + d.value} ctl={ctl} d={d} />;
    case 'confirm':
      return <ConfirmDialog ctl={ctl} d={d} />;
    case 'choose':
      return <ChooseDialog ctl={ctl} d={d} />;
    case 'plan':
      return <PlanDialog ctl={ctl} d={d} />;
    case 'help':
      return <HelpDialog key={d.page ?? 'docs'} ctl={ctl} page={d.page ?? 'docs'} />;
    case 'plugins':
      return <PluginsDialog ctl={ctl} />;
    case 'import':
      return <ImportDialog ctl={ctl} what={d.what} />;
    case 'exported':
      return <ExportedDialog ctl={ctl} file={d.path} />;
    case 'globals':
      return <GlobalsDialog ctl={ctl} d={d} />;
    case 'preferences':
      return <PreferencesDialog ctl={ctl} first={d.tab ?? 'app'} page={d.page} />;
    case 'history':
      return <HistoryDialog ctl={ctl} path={d.path} />;
    case 'presentation':
      return <PresentationDialog ctl={ctl} />;
    case 'export':
      return <ExportDialog ctl={ctl} markdown={d.markdown} title={d.title} path={d.path} />;
    case 'transfer':
      return <TransferDialog ctl={ctl} d={d} />;
    case 'export-styles':
      return <ExportStylesDialog ctl={ctl} />;
    case 'page-icon':
      return <PageIconDialog ctl={ctl} path={d.path} />;
  }
}

/** Choose the icon of one page: it shows in the page tree, and in the gallery in place of the initial. */
function PageIconDialog({ ctl, path }: { ctl: Controller; path: string }): JSX.Element {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    // the icon is a frontmatter line, `icon: book`
    void ctl.ws.readPage(path).then((p) => {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(p.text)?.[1] ?? '';
      const v = /^icon:\s*["']?([\w-]+)["']?\s*$/im.exec(fm)?.[1] ?? null;
      setCurrent(isIconName(v) ? v : null);
    }).catch(() => undefined);
  }, [path]);
  const name = stripExt(path).split('/').pop() ?? path;
  return (
    <Modal title={`Icon for “${name}”`} onClose={() => { ctl.dialog.value = null; }}>
      <IconPicker value={current} onPick={(n) => { ctl.dialog.value = null; void ctl.setPageIcon(path, n); }} />
    </Modal>
  );
}

/** Copy text to the clipboard: the clipboard API where the window may use it, else the old way through a hidden text box. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}

/** All the logs as plain text, one at a time (or all of them), opened at the end where the newest lines are. */
/** The logs, as a page of the Help window. */
function LogsBody({ ctl }: { ctl: Controller }): JSX.Element {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [dir, setDir] = useState('');
  const [id, setId] = useState('app');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const box = useRef<HTMLPreElement>(null);
  const load = async (which: string): Promise<void> => {
    setBusy(true);
    try {
      const list = await ctl.logSources();
      setSources(list.sources);
      setDir(list.dir);
      const known = list.sources.some((s) => s.id === which) ? which : (list.sources[0]?.id ?? '');
      if (known !== which) setId(known);
      setText(known === '' ? 'There are no logs yet.\n' : (await ctl.readLog(known)).text);
    } catch (e) {
      setText(`The log could not be read: ${(e as Error).message}\n`);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load(id);
  }, [id]);
  // once the text is on screen, show its end
  useEffect(() => {
    const toEnd = (): void => {
      const el = box.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return (
    <div class="help-logs">
      <div class="log-bar">
        <select aria-label="Which log" value={id} onChange={(e) => setId((e.currentTarget as HTMLSelectElement).value)}>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button class="pill-button" disabled={busy} onClick={() => void load(id)}>Refresh</button>
        <button class="pill-button" disabled={busy || text === ''} onClick={() => void copyToClipboard(text).then((ok) => ctl.toast(ok ? 'Log copied.' : 'The log could not be copied.'))}>Copy all</button>
        <button class="pill-button" disabled={dir === ''} onClick={() => void ctl.showFolder(dir)}>Open log folder</button>
      </div>
      <pre class="log-text" ref={box} tabIndex={0} aria-label="Log text">{text}</pre>
    </div>
  );
}

/** The keys, as a page of the Help window. */
function ShortcutsBody(): JSX.Element {
  return (
    <div class="shortcuts help-shortcuts">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3 class="look-h">{g.title}</h3>
            <dl>
              {g.items.map((i) => (
                <div key={i.keys + i.does} class="shortcut-row"><dt><kbd>{i.keys}</kbd></dt><dd>{i.does}</dd></div>
              ))}
            </dl>
          </section>
        ))}
    </div>
  );
}

/** A line of credit: what it is, who made it, under what licence; the name opens its home page. */
function CreditRow({ ctl, c }: { ctl: Controller; c: Credit }): JSX.Element {
  return (
    <li class="about-credit">
      <button type="button" class="about-link" onClick={() => ctl.openUrl(c.url)}>{c.name}</button>
      <span class="about-by"> by {c.by}</span>
      <span class="about-what"> {c.what} <em>{c.licence}.</em></span>
    </li>
  );
}

/** After an export: where the file went, with ways to get to it. */
function ExportedDialog({ ctl, file }: { ctl: Controller; file: string }): JSX.Element {
  const name = file.split('/').pop() ?? file;
  const folder = file.slice(0, Math.max(0, file.length - name.length - 1)) || '/';
  return (
    <Modal title="Exported" onClose={() => ctl.closeDialog()}>
      <p class="dialog-body"><strong>{name}</strong> was saved in <span class="export-folder">{folder}</span>.</p>
      <div class="dialog-actions">
        <button class="pill-button" onClick={() => ctl.closeDialog()}>Close</button>
        <button class="pill-button" onClick={() => { void ctl.showExported(file); ctl.closeDialog(); }}>Reveal in File Explorer</button>
        <button class="pill-button suggested" autoFocus onClick={() => { void ctl.openExported(file); ctl.closeDialog(); }}>Open</button>
      </div>
    </Modal>
  );
}

/** Every plugin in one place: switch each on or off (on this computer), uninstall, restore the ones that come with the app. */
const IMPORT_TEXT: Record<'plugin' | 'style' | 'template', { title: string; what: string; hint: string }> = {
  plugin: { title: 'Add a Plugin from a File', what: 'plugin', hint: 'A YAML file with rules (and schema, attributes, queries or relations), a folder with a plugin page and its files, or a zip of either.' },
  style: { title: 'Add Export Styles from a File', what: 'export styles', hint: 'A YAML file of export styles (either the styles themselves, or an export-style: section), or a zip of them.' },
  template: { title: 'Add a Template from a File', what: 'template', hint: 'A note file (.md), a folder with a template page and the pages of its set, or a zip of either.' },
};

/** Browse for, or drop, files to add as a plugin, export style or template; then say where they go. */
function ImportDialog({ ctl, what }: { ctl: Controller; what: 'plugin' | 'style' | 'template' }): JSX.Element {
  const t = IMPORT_TEXT[what];
  const hasWs = !!ctl.workspace.value && !ctl.activeSingle.value;
  const [sources, setSources] = useState<string[]>([]);
  const [where, setWhere] = useState<'app' | 'workspace' | 'global'>('app');
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = (paths: string[]): void => {
    setSources([...new Set([...sources, ...paths])]);
    setError(null);
  };
  const browse = async (mode: 'file' | 'folder'): Promise<void> => add(await ctl.pickImportFiles(mode));
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const r = await ctl.runImport({ kind: what, where, sources });
    setBusy(false);
    if (r.ok) ctl.closeDialog();
    else setError(r.message);
  };
  const place = (value: 'app' | 'workspace' | 'global', title: string, detail: string, disabled = false): JSX.Element => (
    <label class={`import-place ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name="import-where" value={value} checked={where === value} disabled={disabled} onChange={() => setWhere(value)} />
      <span class="import-place-text">
        <span class="pref-label">{title}</span>
        <span class="pref-hint">{detail}</span>
      </span>
    </label>
  );
  return (
    <Modal title={t.title} wide onClose={() => ctl.closeDialog()}>
      <p class="pref-hint">{t.hint}</p>
      <div
        class={`import-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(ctl.pathsOfDropped(e.dataTransfer?.files ?? []));
        }}
      >
        <p>Drag a file, a folder or a zip here</p>
        <p>
          <button type="button" class="pill-button" onClick={() => void browse('file')}>Browse for files…</button>{' '}
          <button type="button" class="pill-button" onClick={() => void browse('folder')}>Browse for a folder…</button>
        </p>
      </div>
      {sources.length > 0 && (
        <ul class="import-list" aria-label="What will be added">
          {sources.map((p) => (
            <li key={p}>
              <span class="import-path" title={p}>{p.split('/').pop()}</span>
              <button type="button" class="pill-button" aria-label={`Leave out ${p.split('/').pop()}`} onClick={() => setSources(sources.filter((x) => x !== p))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <fieldset class="import-where">
        <legend class="look-h">Put the {t.what} in</legend>
        {place('app', 'The app folder', 'All workspaces, on this computer only.')}
        {place('workspace', 'This workspace’s folder', hasWs ? `Only ${ctl.workspace.value!.name}, on every computer that has it (it syncs with the notes).` : 'Open a workspace to use this.', !hasWs)}
        {what !== 'template' && place('global', 'This workspace’s folder, shared (!global)', hasWs ? 'Every workspace, on every computer that has this workspace: the other workspaces ask before they take it.' : 'Open a workspace to use this.', !hasWs)}
      </fieldset>
      {error && <p class="pref-error" role="alert">{error}</p>}
      <div class="dialog-actions">
        <button type="button" class="pill-button" onClick={() => ctl.closeDialog()}>Cancel</button>
        <button type="button" class="pill-button suggested" disabled={busy || sources.length === 0} onClick={() => void submit()}>Add</button>
      </div>
    </Modal>
  );
}

/** A plugin's own text: the first lines, and Read more for the rest. */
function PluginDescription({ text }: { text: string }): JSX.Element {
  const [more, setMore] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > 3 || text.length > 240;
  const short = lines.slice(0, 3).join('\n').slice(0, 240);
  return (
    <span class="plugin-desc">
      <span class="plugin-desc-text">{more || !long ? text : `${short}${short.length < text.length ? '…' : ''}`}</span>
      {long && (
        <button type="button" class="about-link plugin-desc-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Show less' : 'Read more'}
        </button>
      )}
    </span>
  );
}

function PluginsDialog({ ctl }: { ctl: Controller }): JSX.Element {
  const [q, setQ] = useState('');
  const all = ctl.plugins.value;
  const hit = (p: { label: string; id: string }): boolean => q.trim() === '' || `${p.label} ${p.id}`.toLowerCase().includes(q.trim().toLowerCase());
  const own = all.filter((p) => p.origin !== 'default' && !p.pending && hit(p));
  const offered = all.filter((p) => p.pending && hit(p));
  const shipped = all.filter((p) => p.origin === 'default' && hit(p));
  const row = (p: (typeof all)[number]): JSX.Element => (
    <li key={p.id} class="plugin-row">
      {p.pending ? (
        <span class="pref-text">
          <span class="pref-label">{p.label}</span>
          <span class="pref-hint">Offered by “{p.pending.name}”. Running it asks first.</span>
        </span>
      ) : (
        <span class="plugin-main">
          {isIconName(p.icon) && <WorkspaceIcon name={p.icon} size={20} class="plugin-icon" />}
          <span class="plugin-body">
            <Switch label={p.label} hint={p.origin === 'default' ? `${p.file ?? ''}` : p.id} checked={!ctl.isPluginOff(p)} onChange={(on) => ctl.setPluginOff(p, !on)} />
            {p.description && <PluginDescription text={p.description} />}
          </span>
        </span>
      )}
      {!p.pending && <button type="button" class="pill-button" onClick={() => void ctl.uninstallPlugin(p)}>Uninstall</button>}
    </li>
  );
  const group = (title: string, list: typeof all, note?: string): JSX.Element | null =>
    list.length === 0 ? null : (
      <section class="plugin-group">
        <h3 class="look-h">{title}</h3>
        {note && <p class="pref-hint">{note}</p>}
        <ul class="plugin-list">{list.map(row)}</ul>
      </section>
    );
  return (
    <Modal title="All plugins" wide onClose={() => { ctl.dialog.value = null; }}>
      <p class="pref-hint">A plugin works on the selected text, or the whole page. Turning one off is for this computer and this workspace; the plugin itself stays where it is. Uninstalling removes it.</p>
      <input class="plugin-search" type="search" placeholder="Search plugins" aria-label="Search plugins" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} autoFocus />
      <div class="plugin-groups">
        {group('Yours', own, 'Written in this workspace’s settings (a rules: list in .cave-notes).')}
        {group('Offered by other workspaces', offered)}
        {group('Come with the app', shipped, 'Kept in the app config folder, where you can edit them.')}
        {own.length + offered.length + shipped.length === 0 && <p class="pref-hint">{all.length === 0 ? 'There are no plugins.' : 'No plugin matches.'}</p>}
      </div>
      <div class="dialog-actions">
        {ctl.caps.windows && <button type="button" class="pill-button" onClick={() => ctl.openImport('plugin')}>Add from file…</button>}
        <button type="button" class="pill-button" onClick={() => void ctl.restoreDefaultPlugins()}>Restore default plugins</button>
        {ctl.caps.windows && <button type="button" class="pill-button" onClick={() => { ctl.dialog.value = null; void ctl.openAppConfigFolder(); }}>Open app config folder</button>}
        <button type="button" class="pill-button suggested" onClick={() => { ctl.dialog.value = null; }}>Close</button>
      </div>
    </Modal>
  );
}

/** The state of the updater, with the buttons that go with it: look now, install what was found, restart into it. */
function UpdateRow({ ctl }: { ctl: Controller }): JSX.Element | null {
  const st = ctl.update.value;
  if (!st) return null;
  const busy = st.phase === 'checking' || st.phase === 'downloading';
  const text = st.phase === 'checking' ? 'Looking for updates…' : st.phase === 'downloading' ? `Downloading ${st.latest ?? ''}… ${Math.round((st.progress ?? 0) * 100)}%` : st.message || (st.lastCheck ? `Last checked ${new Date(st.lastCheck).toLocaleString()}.` : 'Not checked yet.');
  return (
    <div class={`update-row ${st.phase === 'error' ? 'bad' : ''}`} role="status">
      <span class="update-msg">{text}</span>
      <span class="update-buttons">
        {st.phase === 'ready' ? (
          <button type="button" class="pill-button suggested" onClick={() => ctl.restartApp()}>Restart now</button>
        ) : (
          <>
            {st.phase === 'available' && st.canInstall && <button type="button" class="pill-button suggested" onClick={() => void ctl.installUpdate()}>Install {st.latest}</button>}
            {st.phase === 'available' && !st.canInstall && st.notes && <button type="button" class="pill-button" onClick={() => ctl.openUrl(st.notes!)}>Open the release</button>}
            <button type="button" class="pill-button" disabled={busy} onClick={() => void ctl.checkForUpdate()}>Check for updates</button>
          </>
        )}
      </span>
    </div>
  );
}

/** What the app is, which version this is, and who the synonyms and the other open-source parts come from. */
function AboutBody({ ctl }: { ctl: Controller }): JSX.Element {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
  return (
    <div class="about">
      <img class="about-icon" src="../icons/128.png" alt="" width="72" height="72" />
      <p class="about-name">About Cave Notes</p>
      <p class="about-version-line">Version <strong class="about-version-number">{version || 'unknown'}</strong></p>
      {ctl.caps.appUpdates && <UpdateRow ctl={ctl} />}
      <p class="dialog-body">Hierarchical notes in Markdown: every page is a plain file, pages nest inside pages, and the outline, links and search follow the structure you build. Your notes stay on your computer, in folders you can open with any other program.</p>
      <h3 class="look-h">Synonyms</h3>
      <p class="pref-hint">Right-click a single word in the editor for other words to put in its place. The suggestions come from these two word lists, with WordNet’s most common meanings first.</p>
      <ul class="about-credits">{THESAURUS_CREDITS.map((c) => <CreditRow key={c.name} ctl={ctl} c={c} />)}</ul>
      <details class="about-notice">
        <summary>WordNet licence</summary>
        <pre>{WORDNET_NOTICE}</pre>
      </details>
      <h3 class="look-h">Also built with</h3>
      <ul class="about-credits">{OTHER_CREDITS.map((c) => <CreditRow key={c.name} ctl={ctl} c={c} />)}</ul>
    </div>
  );
}

/** The documentation: what it is, and a way into each page of it. */
function DocsBody({ ctl }: { ctl: Controller }): JSX.Element {
  return (
    <div class="help-docs">
      <p class="dialog-body">The documentation is a set of pages in a workspace of its own, read-only, that opens in a tab. Search it, follow its links, copy examples from it.</p>
      <p><button type="button" class="pill-button suggested" onClick={() => { ctl.dialog.value = null; void ctl.openDocumentation(); }}>Open the documentation</button> <button type="button" class="pill-button" title="Save every page of the documentation in one .zip, to upload to an AI chat when you want help" onClick={() => void ctl.saveDocsZip()}>Download as .zip…</button></p>
      <p class="pref-hint">The .zip holds the same pages as plain Markdown files, in order. Upload it to an AI chat and ask your question about Cave Notes.</p>
      <h3 class="look-h">Pages</h3>
      <ul class="help-topics">
        {HELP_TOPICS.map(([file, title, what]) => (
          <li key={file}>
            <button type="button" class="about-link" onClick={() => { ctl.dialog.value = null; void ctl.openDocumentation(file); }}>{title}</button>
            <span class="pref-hint"> {what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Help, laid out like Preferences: the documentation, the keyboard shortcuts, the logs, and about the app (with its version). */
function HelpDialog({ ctl, page }: { ctl: Controller; page: HelpPage }): JSX.Element {
  const pages: PrefsPage[] = [
    { id: 'docs', title: 'Documentation', body: <DocsBody ctl={ctl} /> },
    { id: 'shortcuts', title: 'Keyboard shortcuts', body: <ShortcutsBody /> },
    { id: 'logs', title: 'Logs', body: <LogsBody ctl={ctl} /> },
    { id: 'about', title: 'About', body: <AboutBody ctl={ctl} /> },
  ];
  return (
    <Modal title="Help" wide fixed onClose={() => { ctl.dialog.value = null; }}>
      <PrefsLayout pages={pages} initial={page} />
      <div class="dialog-actions">
        <button type="button" class="pill-button suggested" onClick={() => { ctl.dialog.value = null; }}>Close</button>
      </div>
    </Modal>
  );
}

/** "Another workspace wants these settings in every workspace": which workspaces should take them. */
function GlobalsDialog({ ctl, d }: { ctl: Controller; d: Extract<DialogSpec, { kind: 'globals' }> }): JSX.Element {
  // nothing is ticked but the workspace that is open now
  const [picked, setPicked] = useState<Record<string, Set<string>>>(() => Object.fromEntries(d.offers.map((o) => [o.source, new Set([d.current])])));
  const toggle = (source: string, root: string): void =>
    setPicked((cur) => {
      const next = new Set(cur[source]);
      next.has(root) ? next.delete(root) : next.add(root);
      return { ...cur, [source]: next };
    });
  const finish = async (apply: boolean): Promise<void> => {
    ctl.dialog.value = null;
    for (const o of d.offers) {
      const asked = d.workspaces.filter((w) => w !== o.source);
      await ctl.ws.globalsDecide(o.source, o.hash, apply ? [...(picked[o.source] ?? [])].filter((w) => w !== o.source) : [], asked).catch(() => undefined);
    }
    await ctl.afterGlobalsAnswered();
  };
  const label = (root: string): string => root.split('/').filter(Boolean).pop() ?? root;
  return (
    <Modal title="Settings for all workspaces" wide onClose={() => void finish(false)}>
      <p class="dialog-body">These workspaces offer settings to every workspace on this computer. Nothing applies until you choose where.</p>
      {d.offers.map((o) => (
        <section key={o.source} class="globals-offer">
          <h3 class="look-h">{o.name}</h3>
          <p class="pref-hint">{o.source}</p>
          <ul class="dialog-details">{o.summary.map((t) => <li key={t}>{t}</li>)}</ul>
          <p class="pref-label">Apply to</p>
          {d.workspaces.filter((w) => w !== o.source).map((w) => (
            <label key={w} class="dialog-check" title={w}>
              <input type="checkbox" checked={picked[o.source]?.has(w) ?? false} onChange={() => toggle(o.source, w)} /> {label(w)}{w === d.current ? ' (this one)' : ''}
            </label>
          ))}
        </section>
      ))}
      <p class="pref-hint">A workspace keeps its own settings over these, and a workspace whose own attributes or schema section is empty ignores them. You can switch this feature off in Preferences.</p>
      <div class="dialog-buttons">
        <button class="pill-button" onClick={() => void finish(false)}>Don’t apply</button>
        <button class="pill-button suggested" onClick={() => void finish(true)}>Apply</button>
      </div>
    </Modal>
  );
}
