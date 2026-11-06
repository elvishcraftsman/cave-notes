/** `A/B.md` -> `A/B`, `Plan.txt` -> `Plan`: the page path without its extension (any extension). */
export const stripExt = (p: string): string => p.replace(/\.[^./]+$/, '');

/** The last part of a page path, without extension: `A/B.md` -> `B`. */
export const pageTitleOf = (p: string): string => stripExt(p).split('/').pop() ?? '';

/** Is this file name one of the note types (extensions with the dot)? */
export const isNoteName = (name: string, exts: readonly string[]): boolean => {
  const low = name.toLowerCase();
  return exts.some((e) => low.endsWith(e));
};

/** Read the file types people type ("md, txt", ".md .txt"): each `.name` in lower case, no repeats. Null when none is usable. */
export function parseNoteTypes(text: string, create: string): { exts: string[]; create: string } | null {
  const fix = (e: string): string | null => {
    const x = e.trim().toLowerCase().replace(/^\.+/, '');
    return /^[a-z0-9][a-z0-9_-]{0,14}$/.test(x) ? `.${x}` : null;
  };
  const exts: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const c = fix(part);
    if (c && !exts.includes(c)) exts.push(c);
  }
  if (exts.length === 0) return null;
  const made = fix(create) ?? exts[0]!;
  if (!exts.includes(made)) exts.push(made);
  return { exts, create: made };
}

/** The path of `target` (a path in the workspace) as written in a link inside the page `from`: relative to the folder the page file is in. */
export function relativeLinkPath(from: string, target: string): string {
  const base = from.split('/').slice(0, -1);
  const to = target.split('/');
  let i = 0;
  while (i < base.length && i < to.length - 1 && base[i] === to[i]) i++;
  return [...base.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}
