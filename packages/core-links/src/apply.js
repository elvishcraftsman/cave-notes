import { fs as fsp, path, utf8Bytes, utf8Text } from '@cave-notes/platform';
import { parentPage, pageName } from '@cave-notes/core-tree';
import { LinksError } from './errors.js';
import { sha1 } from './plan.js';

const JOURNAL_DIR = ['.cave-notes', 'journal'];

/** Where journals live: `dir` when the caller keeps them outside the workspace, else `<root>/.cave-notes/journal`. */
function journalBase(root, dir) {
  return dir ?? path.join(root, ...JOURNAL_DIR);
}

function journalDir(root, id, dir) {
  return path.join(journalBase(root, dir), id);
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    if (out.slice(e.start, e.end) !== e.oldText) {
      throw new LinksError('STALE', `Text changed under an edit at offset ${e.start}`);
    }
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/** Write a file atomically (temp file in the same directory, then rename), keeping its mode. */
async function atomicWrite(fs, file, data, mode, tag) {
  const tmp = `${file}.cave-tmp-${tag}`;
  try {
    await fs.writeFile(tmp, data, mode === undefined ? undefined : { mode });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

async function readJournal(fs, root, id, dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(journalDir(root, id, dir), 'journal.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Journal entries, newest first: [{ id, state, createdAt, move, summary }]. */
export async function listJournal(root, { fs = fsp, journalDir: dir } = {}) {
  let ids;
  try {
    ids = await fs.readdir(journalBase(root, dir));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const id of ids) {
    try {
      const j = await readJournal(fs, root, id, dir);
      if (j) out.push({ id: j.id, state: j.state, createdAt: j.createdAt, move: j.move, summary: j.summary });
    } catch {
      /* unreadable journal: ignore */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

async function prune(fs, root, keep, dir) {
  const all = await listJournal(root, { fs, journalDir: dir });
  for (const j of all.slice(keep)) await fs.rm(journalDir(root, j.id, dir), { recursive: true, force: true });
}

/**
 * Apply a plan from planMove.
 *
 * 1. Verifies every file to be edited is exactly as it was when planned (else STALE; nothing changes).
 * 2. Journals the original contents.
 * 3. Edits the files, then moves the pages. If anything fails, everything is put back.
 * 4. Optionally reconciles the index.
 *
 * @param {object} plan
 * @param {object} o
 * @param {object} o.tree
 * @param {object} [o.index]         reconciled after a successful apply
 * @param {number} [o.keepJournals=20]
 * @param {string} [o.journalDir]    keep journals here instead of in `<root>/.cave-notes/journal`
 * @param {object} [o.fs]            fs/promises overrides (tests inject failures)
 * @param {(message: string) => void} [o.onStep]  told what is happening and how long each step took (for a log)
 * @returns {{ id, from, to, pageMoves, filesEdited, linksRewritten }}
 */
export async function applyPlan(plan, { tree, index, keepJournals = 20, journalDir: jdir, fs: fsOverride = {}, onStep } = {}) {
  const fs = { ...fsp, ...fsOverride };
  const step = onStep ?? (() => {});
  const t0 = performance.now();
  const ms = (t = t0) => Math.round(performance.now() - t);
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.files) || !plan.move) {
    throw new LinksError('BAD_PLAN', 'Not a plan');
  }
  if (plan.root !== tree.root) throw new LinksError('BAD_PLAN', 'Plan belongs to a different workspace');
  if (plan.noop) return { id: plan.id, from: plan.move.from, to: plan.move.to, pageMoves: [], filesEdited: 0, linksRewritten: 0 };

  const root = tree.root;
  const abs = (rel) => path.join(root, ...rel.split('/'));
  step(`apply: ${plan.move.from} -> ${plan.move.to}: ${plan.pageMoves.length} entr${plan.pageMoves.length === 1 ? 'y' : 'ies'}, ${plan.files.length} file(s) to edit, ${plan.summary.linksRewritten} link(s) (plan ${plan.id})`);

  // 1. Everything must still be as planned.
  const originals = [];
  for (const f of plan.files) {
    let buf;
    try {
      buf = await fs.readFile(abs(f.path));
    } catch (e) {
      if (e.code === 'ENOENT') {
        step(`apply: step 1 failed: ${f.path} no longer exists`);
        throw new LinksError('STALE', `${f.path} no longer exists`, { path: f.path });
      }
      step(`apply: step 1 failed reading ${f.path}: ${e.code ?? ''} ${e.message}`);
      throw e;
    }
    if (sha1(buf) !== f.sourceHash) {
      step(`apply: step 1 failed: ${f.path} changed since the plan was made (now ${sha1(buf).slice(0, 8)}, planned ${f.sourceHash.slice(0, 8)})`);
      throw new LinksError('STALE', `${f.path} changed since the plan was made`, { path: f.path });
    }
    const st = await fs.stat(abs(f.path));
    originals.push({ f, buf, mode: st.mode & 0o7777 });
  }
  let current;
  try {
    current = await tree.planMove(plan.move.from, parentPage(plan.move.to), pageName(plan.move.to));
  } catch (cause) {
    step(`apply: step 1 failed: the move is no longer possible: ${cause.code ?? ''} ${cause.message}`);
    throw new LinksError('STALE', `The move is no longer possible: ${cause.message}`, { cause });
  }
  if (current.to !== plan.move.to || current.pageMoves.length !== plan.pageMoves.length) {
    step(`apply: step 1 failed: the subtree changed (planned ${plan.pageMoves.length} entries to ${plan.move.to}, now ${current.pageMoves.length} to ${current.to})`);
    throw new LinksError('STALE', 'The pages being moved changed since the plan was made');
  }
  step(`apply: step 1 (everything still as planned) ok after ${ms()} ms`);

  // 2. Journal the originals before touching anything.
  const dir = journalDir(root, plan.id, jdir);
  await fs.mkdir(path.join(dir, 'files'), { recursive: true });
  const journal = {
    version: 1,
    id: plan.id,
    state: 'applying',
    createdAt: plan.createdAt,
    move: plan.move,
    pageMoves: plan.pageMoves.map((m) => ({ from: m.from, to: m.to })),
    summary: plan.summary,
    files: originals.map(({ f, mode }, n) => ({ n, path: f.path, newPath: f.newPath, beforeHash: f.sourceHash, afterHash: null, mode })),
  };
  for (const [n, o] of originals.entries()) await fs.writeFile(path.join(dir, 'files', `${n}.orig`), o.buf);
  const saveJournal = () => fs.writeFile(path.join(dir, 'journal.json'), JSON.stringify(journal, null, 2));
  await saveJournal();
  step(`apply: step 2 (journal ${dir}) written after ${ms()} ms`);

  // 3a. Edit the files (still at their old paths).
  const written = [];
  const restoreEdits = async () => {
    for (const w of written.reverse()) {
      try {
        await atomicWrite(fs, abs(w.f.path), w.buf, w.mode, plan.id);
      } catch {
        /* best effort; the journal still holds every original */
      }
    }
  };
  try {
    for (const [n, o] of originals.entries()) {
      const next = utf8Bytes(applyEdits(utf8Text(o.buf), o.f.edits));
      await atomicWrite(fs, abs(o.f.path), next, o.mode, plan.id);
      written.push(o);
      journal.files[n].afterHash = sha1(next);
    }
  } catch (cause) {
    step(`apply: step 3a failed while rewriting links: ${cause.code ?? ''} ${cause.message}; putting ${written.length} edited file(s) back`);
    await restoreEdits();
    journal.state = 'failed';
    await saveJournal().catch(() => {});
    throw new LinksError('APPLY_FAILED', `Could not rewrite links; nothing was changed: ${cause.message}`, { cause });
  }

  step(`apply: step 3a (${written.length} file(s) rewritten) ok after ${ms()} ms`);

  // 3b. Move the pages.
  try {
    await tree.movePage(plan.move.from, parentPage(plan.move.to), pageName(plan.move.to));
  } catch (cause) {
    step(`apply: step 3b failed while moving the pages: ${cause.code ?? ''} ${cause.message}${cause.details ? ` ${JSON.stringify(cause.details)}` : ''}; putting ${written.length} edited file(s) back`);
    await restoreEdits();
    journal.state = 'failed';
    await saveJournal().catch(() => {});
    throw new LinksError('APPLY_FAILED', `Could not move the pages; nothing was changed: ${cause.message}`, { cause });
  }

  step(`apply: step 3b (pages moved on disk) ok after ${ms()} ms`);

  // 4. Done.
  journal.state = 'applied';
  await saveJournal();
  await prune(fs, root, keepJournals, jdir).catch(() => {});
  if (index) {
    const paths = affectedPaths(plan);
    step(`apply: refreshing the index for ${paths.length} path(s)`);
    await index.refresh(paths);
  }
  step(`apply: done in ${ms()} ms`);
  return {
    id: plan.id,
    from: plan.move.from,
    to: plan.move.to,
    pageMoves: plan.pageMoves,
    filesEdited: plan.files.length,
    linksRewritten: plan.summary.linksRewritten,
  };
}

/**
 * Undo an applied plan (the most recent one unless `id` is given): moves the pages back and
 * restores the original text of every edited file.
 *
 * Files edited by someone since the move are reported as UNDO_CONFLICT; pass { force: true } to
 * undo everything else and leave those files alone.
 */
export async function undo({ tree, index, id, force = false, journalDir: jdir, fs: fsOverride = {} } = {}) {
  const fs = { ...fsp, ...fsOverride };
  const root = tree.root;
  const abs = (rel) => path.join(root, ...rel.split('/'));

  let journal;
  if (id) journal = await readJournal(fs, root, id, jdir);
  else {
    const latest = (await listJournal(root, { fs, journalDir: jdir })).find((j) => j.state === 'applied');
    journal = latest ? await readJournal(fs, root, latest.id, jdir) : null;
  }
  if (!journal) throw new LinksError('NO_JOURNAL', id ? `No journal ${id}` : 'Nothing to undo');
  if (journal.state !== 'applied') throw new LinksError('NO_JOURNAL', `Journal ${journal.id} is ${journal.state}, not applied`);

  // Files still exactly as we left them can be restored safely.
  const restorable = [];
  const conflicts = [];
  for (const f of journal.files) {
    let hash = null;
    try {
      hash = sha1(await fs.readFile(abs(f.newPath)));
    } catch {
      /* missing: conflict */
    }
    if (hash === f.afterHash) restorable.push(f);
    else conflicts.push(f.newPath);
  }
  if (conflicts.length && !force) {
    throw new LinksError('UNDO_CONFLICT', `${conflicts.length} file(s) changed since the move`, { files: conflicts });
  }

  await tree.movePage(journal.move.to, parentPage(journal.move.from), pageName(journal.move.from));
  const dir = journalDir(root, journal.id, jdir);
  for (const f of restorable) {
    const orig = await fs.readFile(path.join(dir, 'files', `${f.n}.orig`));
    await atomicWrite(fs, abs(f.path), orig, f.mode, journal.id);
  }
  journal.state = 'undone';
  await fs.writeFile(path.join(dir, 'journal.json'), JSON.stringify(journal, null, 2));
  if (index) {
    const touched = new Set(journal.files.flatMap((f) => [f.path, f.newPath]));
    touched.add(journal.move.from);
    touched.add(journal.move.to);
    for (const m of journal.pageMoves ?? []) {
      touched.add(m.from);
      touched.add(m.to);
    }
    await index.refresh([...touched]);
  }
  return { id: journal.id, restored: restorable.map((f) => f.path), skipped: conflicts };
}

/** Every page path whose file or location a plan changes (for refreshing the index). */
function affectedPaths(plan) {
  const set = new Set();
  for (const m of plan.pageMoves) {
    set.add(m.from);
    set.add(m.to);
  }
  for (const f of plan.files) {
    set.add(f.path);
    set.add(f.newPath);
  }
  return [...set];
}

/** Human-readable preview lines for a plan: one per rewritten link. */
export function describePlan(plan) {
  const lines = [];
  for (const f of plan.files) {
    for (const e of f.edits) lines.push(`${f.path}:${e.line}  ${e.oldText}  →  ${e.newText}`);
  }
  return lines;
}
