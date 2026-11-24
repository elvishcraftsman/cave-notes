import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { type FormatItem, formatItems } from './formatMenu';

/** Whether a position is in code, a table or front matter, where a slash is just a slash. */
function inLiteral(ctx: CompletionContext): boolean {
  for (let at: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); at; at = at.parent) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'Frontmatter', 'Table', 'HTMLBlock'].includes(at.name)) return true;
  }
  return false;
}

/**
 * A slash at the start of a line lists what the selection menu offers; going on typing narrows the list, and choosing one takes
 * the slash and what was typed away and does it.
 */
export function slashCompletionSource() {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const m = /^(\s*)\/([\w .-]*)$/.exec(before);
    if (!m || inLiteral(ctx)) return null;
    const slash = line.from + m[1]!.length;
    const options: Completion[] = formatItems().map((it: FormatItem, i) => ({
      label: it.label,
      detail: it.detail,
      type: 'keyword',
      boost: -i, // the order of the menu, when nothing has been typed
      apply: (view, _c, _from, to) => {
        view.dispatch({ changes: { from: slash, to }, selection: { anchor: slash } });
        it.run(view);
      },
    }));
    return { from: slash + 1, options, validFor: /^[\w .-]*$/ };
  };
}
