import { appendClause, clauseToToken, clausesOf, controlFor, defaultClause, opsFor, replaceClause, type Clause, type FieldInfo, type Op } from '@cave-notes/ui-views';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons';

interface Props {
  query: string;
  fields: FieldInfo[];
  onChange: (query: string) => void;
  /** values seen for an attribute, for suggestions */
  loadValues: (field: string) => Promise<string[]>;
}

const fieldLabel = (f: FieldInfo): string => (f.builtin ? ({ title: 'Title', under: 'Under page', is: 'Page kind', 'links-to': 'Links to', 'linked-from': 'Linked from' } as Record<string, string>)[f.key] ?? f.key : f.key);

function ValueControl({ field, clause, onChange, loadValues }: { field: FieldInfo; clause: Clause; onChange: (values: string[]) => void; loadValues: Props['loadValues'] }): JSX.Element | null {
  const control = controlFor(field, clause.op);
  const [suggest, setSuggest] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (control === 'text' && !field.builtin) void loadValues(field.key).then((v) => live && setSuggest(v.slice(0, 50)));
    return () => {
      live = false;
    };
  }, [field.key, control]);

  const v = clause.values;
  const listId = `fb-${field.key}`;
  switch (control) {
    case 'none':
      return null;
    case 'choice': {
      const opts = field.type === 'bool' ? ['true', 'false'] : field.values ?? [];
      return (
        <select class="fb-value" aria-label="Value" value={v[0] ?? ''} onChange={(e) => onChange([(e.currentTarget as HTMLSelectElement).value].filter(Boolean))}>
          <option value="">Choose…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case 'multi':
      return (
        <div class="fb-multi" role="group" aria-label="Values">
          {(field.values ?? []).map((o) => {
            const on = v.includes(o);
            return (
              <button key={o} class={`facet-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? v.filter((x) => x !== o) : [...v, o])}>
                {o}
              </button>
            );
          })}
        </div>
      );
    case 'date':
    case 'number':
      return <input class="fb-value" type={control} aria-label="Value" value={v[0] ?? ''} onChange={(e) => onChange([(e.currentTarget as HTMLInputElement).value].filter(Boolean))} />;
    case 'date-range':
    case 'number-range': {
      const t = control === 'date-range' ? 'date' : 'number';
      return (
        <span class="fb-range">
          <input class="fb-value" type={t} aria-label="From" value={v[0] ?? ''} onChange={(e) => onChange([(e.currentTarget as HTMLInputElement).value, v[1] ?? ''])} />
          <span class="fb-and">and</span>
          <input class="fb-value" type={t} aria-label="To" value={v[1] ?? ''} onChange={(e) => onChange([v[0] ?? '', (e.currentTarget as HTMLInputElement).value])} />
        </span>
      );
    }
    default:
      return (
        <>
          <input
            class="fb-value"
            type="text"
            aria-label="Value"
            list={listId}
            placeholder={['under', 'over', 'parent', 'children'].includes(field.key) ? '$this or a page' : 'value'}
            value={v[0] ?? ''}
            spellcheck={false}
            onChange={(e) => onChange([(e.currentTarget as HTMLInputElement).value.trim()].filter(Boolean))}
          />
          <datalist id={listId}>{suggest.map((s) => <option key={s} value={s} />)}</datalist>
        </>
      );
  }
}

function Row({ fields, clause, onChange, onRemove, loadValues }: { fields: FieldInfo[]; clause: Clause; onChange: (c: Clause) => void; onRemove: () => void; loadValues: Props['loadValues'] }): JSX.Element {
  const field = fields.find((f) => f.key === clause.field) ?? { key: clause.field, type: 'string' };
  const ops = opsFor(field);
  return (
    <div class="fb-row">
      <select class="fb-field" aria-label="Property" value={clause.field} onChange={(e) => onChange(defaultClause(fields.find((f) => f.key === (e.currentTarget as HTMLSelectElement).value)!))}>
        {!fields.some((f) => f.key === clause.field) && <option value={clause.field}>{clause.field}</option>}
        {fields.map((f) => <option key={f.key} value={f.key}>{fieldLabel(f)}</option>)}
      </select>
      <select
        class="fb-op"
        aria-label="Condition"
        value={clause.op}
        onChange={(e) => {
          const op = (e.currentTarget as HTMLSelectElement).value as Op;
          const keep = controlFor(field, op) === controlFor(field, clause.op) ? clause.values : [];
          onChange({ ...clause, op, values: keep });
        }}
      >
        {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      <ValueControl field={field} clause={clause} onChange={(values) => onChange({ ...clause, values })} loadValues={loadValues} />
      <button class="icon-button small" aria-label="Remove filter" title="Remove filter" onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/**
 * Typed filter controls over a query string: each row is a property, a condition and a value
 * input that fits the property (dropdowns for enums, date pickers, number boxes, tag text).
 * The query text stays the single source of truth, so anything written by hand still shows up.
 */
export function FilterBuilder({ query, fields, onChange, loadValues }: Props): JSX.Element {
  const rows = clausesOf(query);
  const [drafts, setDrafts] = useState<Clause[]>([]);

  const edit = (i: number, next: Clause): void => {
    const row = rows[i]!;
    if (clauseToToken(next)) onChange(replaceClause(query, row.token, next));
    else {
      // an unfinished change (new property, value cleared): park it as a draft instead of losing the row
      onChange(replaceClause(query, row.token, null));
      setDrafts((d) => [...d, next]);
    }
  };
  const editDraft = (i: number, next: Clause): void => {
    if (clauseToToken(next)) {
      setDrafts((d) => d.filter((_, j) => j !== i));
      onChange(appendClause(query, next));
    } else setDrafts((d) => d.map((c, j) => (j === i ? next : c)));
  };

  return (
    <div class="filter-builder">
      {rows.length === 0 && drafts.length === 0 && <p class="empty-note small">No filters yet. Add one to narrow the pages.</p>}
      {rows.map((r, i) => (
        <Row key={`${i}-${r.clause.field}`} fields={fields} clause={r.clause} onChange={(c) => edit(i, c)} onRemove={() => onChange(replaceClause(query, r.token, null))} loadValues={loadValues} />
      ))}
      {drafts.map((c, i) => (
        <Row key={`d${i}-${c.field}`} fields={fields} clause={c} onChange={(n) => editDraft(i, n)} onRemove={() => setDrafts((d) => d.filter((_, j) => j !== i))} loadValues={loadValues} />
      ))}
      <select
        class="fb-add"
        aria-label="Add filter"
        value=""
        onChange={(e) => {
          const f = fields.find((x) => x.key === (e.currentTarget as HTMLSelectElement).value);
          (e.currentTarget as HTMLSelectElement).value = '';
          if (!f) return;
          const c = defaultClause(f);
          if (clauseToToken(c)) onChange(appendClause(query, c));
          else setDrafts((d) => [...d, c]);
        }}
      >
        <option value="">+ Add filter…</option>
        {fields.map((f) => <option key={f.key} value={f.key}>{fieldLabel(f)}</option>)}
      </select>
    </div>
  );
}
