import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { RESERVED_FRONTMATTER, RESERVED_VIEW, type SchemaHint, schemaTip } from './yamlHints';

/** What the completions draw on: the attributes of the workspace and the names of its saved queries. */
export interface YamlCompleteHost {
  attributes: () => SchemaHint[];
  savedQueries: () => string[];
}

type Kind = 'frontmatter' | 'view';

/** Whether a position is inside a frontmatter block or a ```view block, and where that block's YAML starts. */
export function yamlContextAt(state: EditorState, pos: number): { kind: Kind; from: number } | null {
  const doc = state.doc;
  let found: { kind: Kind; from: number } | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (ref) => {
      if (ref.name === 'Frontmatter') {
        const first = doc.lineAt(ref.from);
        const last = doc.lineAt(Math.max(ref.from, ref.to - 1));
        const closed = last.number > first.number && /^(---|\.\.\.)\s*$/.test(last.text);
        // the first and the closing `---` lines are not YAML
        if (pos > first.to && (!closed || pos <= last.from)) found = { kind: 'frontmatter', from: first.to + 1 };
        return false;
      }
      if (ref.name === 'FencedCode') {
        const first = doc.lineAt(ref.from);
        const lang = /^\s*(?:```|~~~)\s*([^\s`]*)/.exec(first.text)?.[1]?.toLowerCase();
        if (lang === 'view' && pos > first.to) {
          const last = doc.lineAt(ref.to);
          const closed = last.number > first.number && /^\s*(```|~~~)\s*$/.test(last.text);
          if (!closed || pos <= last.from) found = { kind: 'view', from: first.to + 1 };
        }
        return false;
      }
      return undefined;
    },
  });
  return found;
}

const reservedValues: Record<string, string[]> = {
  hidden: ['tree', 'children', 'search', 'queries', 'all', 'true', 'false'],
  defaults: ['default', 'inherit', 'original', 'none'],
  inheritance: ['all', 'children'],
  template: ['true', 'false'],
  ignoreIndicators: ['true'],
};
const viewValues: Record<string, string[]> = {
  type: ['table', 'list', 'gallery', 'kanban', 'calendar'],
  groupDir: ['asc', 'desc'],
  relationFiles: ['link', 'skip'],
  noDuplicateWarning: ['true', 'false'],
};
/** View settings whose value is made of attribute names. */
const viewAttrs = new Set(['sort', 'group', 'date', 'cover', 'columns', 'newFields']);

const KEY_LINE = /^(\s*)(- +)?([A-Za-z_][\w.-]*)?$/;
const VALUE_LINE = /^(\s*)(?:- +)?([A-Za-z_][\w.-]*)(\s*:)[ \t]*(.*)$/;

function attrOption(a: SchemaHint, suffix = ''): Completion {
  return { label: a.key, apply: a.key + suffix, type: 'property', detail: a.declared ? (a.schemaType ?? a.type) : `${a.pages ?? 0} pages`, info: a.declared ? schemaTip(a) : undefined, boost: a.declared ? 1 : 0 };
}

/** Completion for the YAML of frontmatter and ```view blocks: names, then values, then the pieces of a query. */
export function yamlCompletionSource(host: YamlCompleteHost) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const at = yamlContextAt(ctx.state, ctx.pos);
    if (!at) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const attrs = host.attributes();
    const afterColon = /^\s*:/.test(line.text.slice(ctx.pos - line.from));

    // a name: at the start of a line (after "- " too)
    const k = KEY_LINE.exec(before);
    if (k) {
      const typed = k[3] ?? '';
      if (typed === '' && !ctx.explicit) return null;
      const from = ctx.pos - typed.length;
      const suffix = afterColon ? '' : ': ';
      const reserved = at.kind === 'frontmatter' ? RESERVED_FRONTMATTER : RESERVED_VIEW;
      const seen = new Set<string>();
      const options: Completion[] = [];
      for (const [name, tip] of Object.entries(reserved)) {
        // `defaults` and `inheritance` belong inside a block, the other frontmatter names at the top
        if (at.kind === 'frontmatter' && (name === 'defaults' || name === 'inheritance') && k[1]!.length === 0) continue;
        seen.add(name.toLowerCase());
        options.push({ label: name, apply: name + suffix, type: 'keyword', info: tip, boost: 2 });
      }
      if (at.kind === 'frontmatter') for (const a of attrs) if (!seen.has(a.key.toLowerCase())) options.push(attrOption(a, suffix));
      return options.length ? { from, options, validFor: /^[\w.-]*$/ } : null;
    }

    // a value: after "name:"
    const v = VALUE_LINE.exec(before);
    if (!v) return null;
    const key = v[2]!;
    const value = v[4]!;
    if (at.kind === 'frontmatter') {
      const reservedList = reservedValues[key] ?? reservedValues[Object.keys(reservedValues).find((x) => x.toLowerCase() === key.toLowerCase()) ?? ''];
      const a = attrs.find((x) => x.key.toLowerCase() === key.toLowerCase());
      const choices = reservedList ?? a?.values ?? (a?.type === 'bool' && a.declared ? ['true', 'false'] : undefined);
      if (!choices) return null;
      const typed = /[^\s,\[]*$/.exec(value)![0];
      return { from: ctx.pos - typed.length, options: choices.map((c) => ({ label: c, type: 'enum' })), validFor: /^[^\s,\]]*$/ };
    }

    // a ```view block
    const fixed = viewValues[key];
    if (fixed) return { from: ctx.pos - value.length, options: fixed.map((c) => ({ label: c, type: 'enum' })), validFor: /^\w*$/ };
    if (viewAttrs.has(key)) {
      const typed = /[^\s,\[\-]*$/.exec(value)![0];
      return { from: ctx.pos - typed.length, options: attrs.map((a) => attrOption(a)), validFor: /^[\w.-]*$/ };
    }
    if (key === 'query' || key === 'when') {
      // `!Name` takes the query of a saved query or of another view
      const bang = /!("?)([^\s"]*)$/.exec(value);
      if (bang && key === 'query') {
        const names = host.savedQueries();
        return names.length ? { from: ctx.pos - bang[1]!.length - bang[2]!.length, options: names.map((n) => ({ label: n, apply: /\s/.test(n) ? `"${n}"` : n, type: 'variable', detail: 'saved query' })), validFor: /^[^\s]*$/ } : null;
      }
      // `name:` and then the choices of that attribute; or the start of a name
      const val = /(?:^|[\s(!-])([\w.-]+):([^\s)]*)$/.exec(value);
      if (val) {
        const a = attrs.find((x) => x.key.toLowerCase() === val[1]!.toLowerCase());
        const choices = a?.values ?? (a?.type === 'bool' ? ['true', 'false'] : undefined);
        return choices ? { from: ctx.pos - val[2]!.length, options: choices.map((c) => ({ label: c, type: 'enum' })), validFor: /^[^\s)]*$/ } : null;
      }
      const word = /(?:^|[\s(!-])([\w.-]*)$/.exec(value);
      if (word && (word[1]!.length > 0 || ctx.explicit)) {
        return { from: ctx.pos - word[1]!.length, options: attrs.map((a) => attrOption(a, ':')).concat([{ label: '$this', type: 'variable', info: 'the page showing the view' }, { label: '$self', type: 'variable', info: 'the page the view is written in' }]), validFor: /^[\w.$-]*$/ };
      }
    }
    return null;
  };
}
