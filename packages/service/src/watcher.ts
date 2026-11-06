import fs from 'node:fs';
import path from 'node:path';
import { defaultNoteExt, isNoteFile } from '@cave-notes/core-tree';
import chokidar, { type FSWatcher } from 'chokidar';
import { log } from './log';

export interface WatchBatch {
  /** page paths whose files were added, changed or removed */
  files: Set<string>;
  /** page paths of folders that appeared or disappeared (virtual pages) */
  folders: Set<string>;
  /** a settings file in `.cave-notes` changed (schema, global attributes, saved queries, relations) */
  schema: boolean;
  /** a file that is not a note (an image, a document) changed: files given attributes may need a new look */
  others: boolean;
  /** a settings file in `.cave-notes` changed (the rules are read again) */
  automations: boolean;
}

/**
 * Watches a workspace and reports batches of changed page paths, debounced so that a burst of
 * events (git checkout, a sync client, our own rename) arrives as one.
 */
export function watchWorkspace(root: string, onBatch: (batch: WatchBatch) => void, debounceMs = 150, only?: string): () => Promise<void> {
  let files = new Set<string>();
  let folders = new Set<string>();
  let schema = false;
  let others = false;
  let automations = false;
  let timer: NodeJS.Timeout | null = null;

  const rel = (abs: string): string | null => {
    const r = path.relative(root, abs).split(path.sep).join('/');
    return r === '' || r.startsWith('..') ? null : r;
  };

  const flush = (): void => {
    timer = null;
    if (files.size === 0 && folders.size === 0 && !schema && !others && !automations) return;
    const batch = { files, folders, schema, others, automations };
    files = new Set();
    folders = new Set();
    schema = false;
    others = false;
    automations = false;
    onBatch(batch);
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const isWorkspaceFolder = (abs: string): boolean => {
    if (path.resolve(abs) === path.resolve(root)) return false;
    try {
      return fs.statSync(path.join(abs, '.cave-notes')).isDirectory();
    } catch {
      return false;
    }
  };
  // every YAML file directly in .cave-notes can hold settings (schema, global attributes, queries, rules, export styles ...)
  const isSettings = (r: string): boolean => /^\.cave-notes\/[^/]+\.ya?ml$/i.test(r);
  const watcher: FSWatcher = chokidar.watch(only ? [path.join(root, only), path.join(root, '.cave-notes')] : root, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p) => {
      const r = rel(p);
      if (r === null) return false;
      if (r === '.cave-notes' || isSettings(r)) return false;
      // another workspace inside this one is watched by its own tab, not by this one
      if (!only && !r.includes('.') && isWorkspaceFolder(p)) return true;
      return r.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules') || r.includes('.cave-tmp-');
    },
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });

  const onFile = (abs: string): void => {
    const r = rel(abs);
    if (r && isSettings(r)) {
      schema = true;
      automations = true;
      schedule();
    } else if (r && isNoteFile(r)) {
      files.add(r);
      schedule();
    } else if (r && !r.startsWith('.')) {
      others = true;
      schedule();
    }
  };
  const onDir = (abs: string): void => {
    const r = rel(abs);
    if (r && !only && r !== '.cave-notes') {
      folders.add(`${r}${defaultNoteExt()}`);
      schedule();
    }
  };
  watcher.on('add', onFile).on('change', onFile).on('unlink', onFile).on('addDir', onDir).on('unlinkDir', onDir);
  // A vanished directory etc.: the next reconcile catches up, but the log should say it happened.
  watcher.on('error', (e) => log.warn(`watcher error root=${root}`, e));
  const t0 = performance.now();
  watcher.on('ready', () => {
    let dirs = 0;
    let entries = 0;
    for (const [, names] of Object.entries(watcher.getWatched())) {
      dirs++;
      entries += names.length;
    }
    const ms = Math.round(performance.now() - t0);
    (ms > 3000 || dirs > 5000 ? log.warn : log.info)(`watcher ready after ${ms} ms: watching ${dirs} folders, ${entries} entries under ${root}`);
  });

  return async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
}
