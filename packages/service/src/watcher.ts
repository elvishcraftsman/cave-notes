import fs from 'node:fs';
import path from 'node:path';
import { IGNORE_FILE, createIgnoreSync, defaultNoteExt, isNoteFile } from '@cave-notes/core-tree';
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
  /** a `.caveignore` file changed (what is hidden may be different now) */
  ignores: boolean;
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
  let ignores = false;
  const ignoreRules = only ? null : createIgnoreSync(root, (f, enc) => fs.readFileSync(f, enc));
  let timer: NodeJS.Timeout | null = null;

  const rel = (abs: string): string | null => {
    const r = path.relative(root, abs).split(path.sep).join('/');
    return r === '' || r.startsWith('..') ? null : r;
  };

  const flush = (): void => {
    timer = null;
    if (files.size === 0 && folders.size === 0 && !schema && !others && !automations && !ignores) return;
    const batch = { files, folders, schema, others, automations, ignores };
    files = new Set();
    folders = new Set();
    schema = false;
    others = false;
    automations = false;
    ignores = false;
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
  // every YAML file directly in .cave-notes, and in its plugins/ and styles/ folders (a plugin may keep more files in a folder
  // of its own), can hold settings (schema, global attributes, queries, rules, export styles ...)
  const isSettings = (r: string): boolean => /^\.cave-notes\/([^/]+\.ya?ml|(plugins|styles)\/.+\.ya?ml)$/i.test(r);
  const isConfigPart = (r: string): boolean => /^\.cave-notes\/(plugins|styles|templates)(\/|$)/.test(r);
  const isIgnoreFile = (r: string): boolean => r === IGNORE_FILE || r.endsWith(`/${IGNORE_FILE}`);
  const watcher: FSWatcher = chokidar.watch(only ? [path.join(root, only), path.join(root, '.cave-notes')] : root, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p) => {
      const r = rel(p);
      if (r === null) return false;
      if (r === '.cave-notes' || isSettings(r) || isConfigPart(r) || isIgnoreFile(r)) return false;
      // what a `.caveignore` hides is not watched (it is not indexed either); the open workspace's own `.cave-notes` is never hidden
      if (ignoreRules) {
        const guessDir = !r.slice(r.lastIndexOf('/') + 1).includes('.');
        if (guessDir ? ignoreRules.skipDir(r) : ignoreRules.isIgnored(r, false)) return true;
      }
      // another workspace inside this one is watched by its own tab, not by this one
      if (!only && !r.includes('.') && isWorkspaceFolder(p)) return true;
      return r.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules') || r.includes('.cave-tmp-');
    },
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });

  const onFile = (abs: string): void => {
    const r = rel(abs);
    if (r && isIgnoreFile(r)) {
      ignoreRules?.reset();
      ignores = true;
      schedule();
    } else if (r && isSettings(r)) {
      schema = true;
      automations = true;
      schedule();
    } else if (r && isConfigPart(r) && !r.startsWith('.cave-notes/templates/')) {
      // helper files of a plugin: the rules or queries that use them may need to read them again
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
