const CONFLICT = /^(.*)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^./]+)?$/;

/** Is this file name a Syncthing conflict copy (`Grace.sync-conflict-20260101-120000-ABCDEFG.md`)? */
export const isConflictName = (name) => CONFLICT.test(name.split('/').pop() ?? name);

/** The page a conflict copy belongs to (`dir/Grace.md`), or null if `path` is not a conflict copy. */
export function conflictOriginal(path) {
  const slash = path.lastIndexOf('/');
  const dir = slash < 0 ? '' : path.slice(0, slash + 1);
  const m = CONFLICT.exec(path.slice(slash + 1));
  return m ? `${dir}${m[1]}${m[2] ?? ''}` : null;
}
