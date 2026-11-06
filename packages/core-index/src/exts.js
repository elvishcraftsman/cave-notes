import { noteExtensions, noteExtOf } from '@cave-notes/core-tree';

/** `Foo.md` -> `Foo` (any configured notes extension; other names stay as they are). */
export const stripNoteExt = (s) => {
  const e = noteExtOf(s);
  return e ? s.slice(0, -e.length) : s;
};

export const hasNoteExt = (s) => noteExtOf(s) !== null;

/** The page whose path is `stem` plus one of the notes extensions, or undefined. */
export function pageByStem(byPath, stem) {
  for (const e of noteExtensions()) {
    const r = byPath.get(stem + e);
    if (r) return r;
  }
  return undefined;
}

/** True when `path` (lower case) ends with `/suffixStem` plus one of the notes extensions. */
export function endsWithStem(pathLower, suffixStemLower) {
  return noteExtensions().some((e) => pathLower.endsWith(suffixStemLower + e));
}
