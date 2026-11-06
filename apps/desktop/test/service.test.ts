import YAML from 'yaml';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';
import type { WorkerEvents } from '../src/shared/api';

type Ev = { event: keyof WorkerEvents; payload: unknown };

let root: string;
let events: Ev[];
let svc: WorkspaceService;

const write = async (rel: string, text: string): Promise<void> => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
};
const read = (rel: string): Promise<string> => fs.readFile(path.join(root, ...rel.split('/')), 'utf8');

async function waitFor<T>(fn: () => T | undefined | false, what: string, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; events: ${JSON.stringify(events.map((e) => e.event))}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const eventsOf = (name: keyof WorkerEvents): Ev[] => events.filter((e) => e.event === name);

async function open(files: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(files)) await write(k, v);
  await svc.openWorkspace(root);
  await waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'initial indexing');
  events.length = 0;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-svc-'));
  events = [];
  svc = new WorkspaceService((event, payload) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('opening', () => {
  it('opens a folder, lists the hierarchy (with virtual pages) and reads pages', async () => {
    await open({ 'Notes.md': '# Notes', 'Theology.md': '# T', 'Theology/Grace.md': '# Grace', 'V/Kid.md': '# Kid' });
    expect(await svc.listChildren(null)).toEqual([
      { path: 'Notes.md', name: 'Notes', exists: true, hasChildren: false },
      { path: 'Theology.md', name: 'Theology', exists: true, hasChildren: true },
      { path: 'V.md', name: 'V', exists: false, hasChildren: true },
    ]);
    expect((await svc.listChildren('Theology.md')).map((i) => i.path)).toEqual(['Theology/Grace.md']);
    const page = await svc.readPage('Notes.md');
    expect(page).toMatchObject({ exists: true, text: '# Notes' });
    expect(page.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await svc.readPage('V.md')).toEqual({ path: 'V.md', exists: false, text: '', hash: null });
  });

  it('rejects a path that is not a folder, and calls with no workspace', async () => {
    await expect(svc.openWorkspace(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'NOT_A_FOLDER' });
    await expect(svc.listChildren(null)).rejects.toMatchObject({ code: 'NO_WORKSPACE' });
  });

  it('indexes in the background and reports status', async () => {
    await write('A.md', '# A\n[[B]]');
    await write('B.md', '# B');
    await svc.openWorkspace(root);
    expect(eventsOf('index:status')[0]?.payload).toMatchObject({ state: 'indexing' });
    await waitFor(() => eventsOf('index:status').find((e) => (e.payload as { state: string }).state === 'ready'), 'ready');
    expect(await svc.stats()).toMatchObject({ pages: 2, links: 1, brokenLinks: 0 });
  });

  it('sorts siblings by frontmatter order once indexed', async () => {
    await open({ 'A.md': '# A', 'B.md': '---\norder: 1\n---\n# B' });
    expect((await svc.listChildren(null)).map((i) => i.name)).toEqual(['B', 'A']);
  });
});

describe('saving', () => {
  it('writes atomically, returns the new hash and refreshes the index', async () => {
    await open({ 'A.md': '# A' });
    const first = await svc.readPage('A.md');
    const res = await svc.writePage('A.md', '# A\n\nhello world', first.hash);
    expect(res.ok).toBe(true);
    expect(await read('A.md')).toBe('# A\n\nhello world');
    expect((await svc.search('hello')).results.map((r) => r.path)).toEqual(['A.md']);
    expect((await fs.readdir(root)).filter((n) => n.includes('cave-tmp'))).toEqual([]);
  });

  it('detects a conflicting change on disk and does not overwrite it', async () => {
    await open({ 'A.md': '# A' });
    const first = await svc.readPage('A.md');
    await write('A.md', '# A\nsomeone else');
    const res = await svc.writePage('A.md', '# mine', first.hash);
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(await read('A.md')).toBe('# A\nsomeone else');
    // knowingly overwriting (no base hash) works
    expect((await svc.writePage('A.md', '# mine', null)).ok).toBe(true);
    expect(await read('A.md')).toBe('# mine');
  });

  it('saves over an earlier save of its own that the caller never heard back about', async () => {
    // the window gave up waiting for the first save (it was slow), so its next save still names the old base hash
    await open({ 'A.md': '# A' });
    const base = (await svc.readPage('A.md')).hash;
    const first = await svc.writePage('A.md', '# A\nfirst try', base);
    expect(first.ok).toBe(true);
    const second = await svc.writePage('A.md', '# A\nsecond try', base);
    expect(second.ok).toBe(true);
    expect(await read('A.md')).toBe('# A\nsecond try');
    // but a change made by somebody else in between is still a conflict
    await write('A.md', '# A\nsomeone else');
    expect(await svc.writePage('A.md', '# A\nthird try', base)).toMatchObject({ ok: false, conflict: true });
    expect(await read('A.md')).toBe('# A\nsomeone else');
  });

  it('runs overlapping saves of one page one after another, the last one winning', async () => {
    await open({ 'A.md': '# A' });
    const base = (await svc.readPage('A.md')).hash;
    const all = await Promise.all([1, 2, 3, 4, 5].map((n) => svc.writePage('A.md', `# A\nversion ${n}`, base, { deferIndex: n % 2 === 0 })));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(await read('A.md')).toBe('# A\nversion 5');
    expect((await fs.readdir(root)).filter((n) => n.includes('cave-tmp'))).toEqual([]);
  });

  it('with deferIndex answers first and refreshes the index afterwards', async () => {
    await open({ 'A.md': '# A' });
    const res = await svc.writePage('A.md', '# A\n\nzebrafish', (await svc.readPage('A.md')).hash, { deferIndex: true });
    expect(res.ok).toBe(true);
    await waitFor(() => eventsOf('index:updated').some((e) => (e.payload as { path: string | null }).path === 'A.md'), 'the deferred index refresh');
    expect((await svc.search('zebrafish')).results.map((r) => r.path)).toEqual(['A.md']);
  });

  it('does not report its own saves as external changes, but does report real ones', async () => {
    await open({ 'A.md': '# A' });
    await svc.writePage('A.md', '# A\nours', (await svc.readPage('A.md')).hash);
    await new Promise((r) => setTimeout(r, 500));
    expect(eventsOf('page:changed')).toEqual([]);
    await write('A.md', '# A\ntheirs');
    const ev = await waitFor(() => eventsOf('page:changed')[0], 'external change');
    expect(ev.payload).toMatchObject({ path: 'A.md' });
    expect((ev.payload as { hash: string }).hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('file watching', () => {
  it('reports new pages and refreshes the index and tree', async () => {
    await open({ 'A.md': '# A' });
    await write('Theology/Grace.md', '# Grace\nfavour');
    const tc = await waitFor(() => eventsOf('tree:changed').find((e) => JSON.stringify(e.payload).includes('Theology')), 'tree change');
    expect(JSON.stringify(tc.payload)).toContain('Theology.md');
    await waitFor(() => eventsOf('index:updated')[0], 'index update');
    expect((await svc.search('favour')).results.map((r) => r.path)).toEqual(['Theology/Grace.md']);
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md', 'Theology.md']);
  });

  it('reports deletions', async () => {
    await open({ 'A.md': '# A', 'B.md': '# B' });
    await fs.rm(path.join(root, 'B.md'));
    const ev = await waitFor(() => eventsOf('page:changed').find((e) => (e.payload as { path: string }).path === 'B.md'), 'deletion');
    expect((ev.payload as { hash: unknown }).hash).toBeNull();
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md']);
  });

  it('ignores hidden files, the .cave-notes folder and temp files', async () => {
    await open({ 'A.md': '# A' });
    await write('.cave-notes/x.md', 'x');
    await write('.hidden.md', 'x');
    await write('A.md.cave-tmp-1', 'x');
    await new Promise((r) => setTimeout(r, 500));
    expect(events.filter((e) => e.event === 'page:changed' || e.event === 'tree:changed')).toEqual([]);
  });
});

describe('creating, renaming, moving, deleting', () => {
  it('creates pages with a title and reports the tree change', async () => {
    await open({ 'Theology.md': '# T' });
    expect(await svc.createPage('Theology.md', 'Grace')).toBe('Theology/Grace.md');
    expect(await read('Theology/Grace.md')).toBe('# Grace\n\n');
    expect(eventsOf('tree:changed').at(-1)?.payload).toEqual({ parents: ['Theology.md'] });
    await expect(svc.createPage('Theology.md', 'grace')).rejects.toMatchObject({ code: 'COLLISION' });
    await expect(svc.createPage(null, 'bad/name')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('promotes a virtual page', async () => {
    await open({ 'V/Kid.md': '# Kid' });
    expect(await svc.promoteVirtual('V.md')).toBe('V.md');
    expect((await svc.listChildren(null))[0]).toMatchObject({ path: 'V.md', exists: true });
  });

  it('plans and applies a rename with link rewriting, then undoes it', async () => {
    await open({ 'A/Grace.md': 'text', 'Z.md': '[a](A/Grace.md) and [[Grace]]' });
    const plan = await svc.planMove('A/Grace.md', 'A.md', 'Mercy');
    expect(plan.summary).toMatchObject({ pagesMoved: 1, filesEdited: 1, linksRewritten: 2 });
    const res = await svc.applyPlan(plan);
    expect(res.to).toBe('A/Mercy.md');
    expect(await read('Z.md')).toBe('[a](A/Mercy.md) and [[Mercy]]');
    expect(await svc.lastMove()).toMatchObject({ from: 'A/Grace.md', to: 'A/Mercy.md' });
    expect((await svc.stats()).brokenLinks).toBe(0);

    const undone = await svc.undoLast();
    expect(undone.restored).toEqual(['Z.md']);
    expect(await read('Z.md')).toBe('[a](A/Grace.md) and [[Grace]]');
    expect(await svc.lastMove()).toBeNull();
  });

  it('describes a delete: what goes to the trash and who links to it', async () => {
    await open({ 'A.md': '# A', 'A/Kid.md': '# Kid', 'Z.md': '[[Kid]] [x](A.md)' });
    const info = await svc.deleteInfo('A.md');
    expect(info.pages.sort()).toEqual(['A.md', 'A/Kid.md']);
    expect(info.trash.map((p) => path.relative(root, p)).sort()).toEqual(['A', 'A.md']);
    expect(info.backlinks).toBe(2);
    await fs.rm(path.join(root, 'A.md'));
    await fs.rm(path.join(root, 'A'), { recursive: true });
    await svc.afterDelete(info.pages);
    expect((await svc.stats()).pages).toBe(1);
    expect((await svc.stats()).brokenLinks).toBe(2);
  });
});

describe('links', () => {
  it('resolves every kind of link', async () => {
    await open({
      'Top.md': '# Top',
      'A/Grace.md': '---\naliases: [Charis]\n---\n# Grace',
      'X/Intro.md': '# X', 'Y/Intro.md': '# Y',
      'A/Page.md': '# Page',
    });
    const r = (target: string, syntax: 'md' | 'wiki' = 'md', from = 'A/Page.md') => svc.resolveLink({ syntax, target }, from);
    expect(await r('Grace.md')).toEqual({ kind: 'page', status: 'ok', path: 'A/Grace.md', fragment: null });
    expect(await r('../Top.md')).toMatchObject({ status: 'ok', path: 'Top.md' });
    expect(await r('/Top.md')).toMatchObject({ status: 'ok', path: 'Top.md' });
    expect(await r('Nope.md')).toMatchObject({ kind: 'page', status: 'broken', name: 'Nope' });
    expect(await r('Charis', 'wiki')).toMatchObject({ status: 'ok', path: 'A/Grace.md' });
    expect(await r('Grace', 'wiki', 'Top.md')).toMatchObject({ status: 'ok', path: 'A/Grace.md' });
    expect(await r('Nothing', 'wiki')).toMatchObject({ status: 'broken', name: 'Nothing' });
    const amb = await r('Intro', 'wiki', 'Top.md');
    expect(amb).toMatchObject({ status: 'ambiguous' });
    expect((amb as { candidates: string[] }).candidates.sort()).toEqual(['X/Intro.md', 'Y/Intro.md']);
    expect(await r('https://example.com/x')).toEqual({ kind: 'web', url: 'https://example.com/x' });
    expect(await r('javascript:alert(1)')).toEqual({ kind: 'other' });
    const file = await r('../docs/spec.pdf');
    expect(file).toEqual({ kind: 'file', absPath: path.join(root, 'docs', 'spec.pdf') });
  });

  it('carries fragments through', async () => {
    await open({ 'A.md': '# A\n## Sub', 'B.md': '[[A#Sub]]' });
    expect(await svc.resolveLink({ syntax: 'wiki', target: 'A', fragment: 'Sub' }, 'B.md')).toEqual({ kind: 'page', status: 'ok', path: 'A.md', fragment: 'Sub' });
  });

  it('exposes links, backlinks and page info from the index', async () => {
    await open({ 'A.md': '---\nstatus: draft\n---\n# A\n[[B]] [web](https://e.com)', 'B.md': '# B' });
    const links = await svc.links('A.md');
    expect(links.map((l) => [l.kind, l.status])).toEqual([['page', 'ok'], ['web', 'external']]);
    expect((await svc.backlinks('B.md')).map((b) => b.fromPath)).toEqual(['A.md']);
    expect((await svc.pageInfo('A.md'))?.attributes.status?.[0]?.text).toBe('draft');
    expect(await svc.pageInfo('Nope.md')).toBeNull();
  });

  it('suggests pages for [[ completion: by name, title and alias, disambiguating duplicates', async () => {
    await open({
      'Grace.md': '# Grace and Favour', 'Graph.md': '# Graph', 'Mercy.md': '---\naliases: [Gracious]\n---\n# Mercy',
      'X/Intro.md': '# I', 'Y/Intro.md': '# I',
    });
    const grac = await svc.suggestPages('grac');
    expect(grac.map((s) => s.label)).toEqual(['Grace', 'Mercy']);
    expect((await svc.suggestPages('intro')).map((s) => s.label).sort()).toEqual(['X/Intro', 'Y/Intro']);
    expect((await svc.suggestPages('')).length).toBe(5); // real pages only
    expect(await svc.suggestPages('100%_')).toEqual([]);
  });

  it('finds pages for the tree\'s find box: every word must be in the title or name, quotes keep words together', async () => {
    await open({ 'Theology III.md': '# Theology III', 'Theology II.md': '# Theology II', 'Notes/Theory.md': '# Theory', 'Other.md': '# Other' });
    expect(await svc.findPagePaths('theo iii')).toEqual(['Theology III.md']);
    expect(await svc.findPagePaths('theo')).toEqual(['Notes/Theory.md', 'Theology II.md', 'Theology III.md']);
    expect(await svc.findPagePaths('"theology ii"')).toEqual(['Theology II.md', 'Theology III.md']);
    expect(await svc.findPagePaths('')).toEqual([]);
    expect(await svc.findPagePaths('zzz')).toEqual([]);
  });

  it('passes searches and attribute lookups through', async () => {
    await open({ 'A.md': '---\nstatus: draft\n---\n# A\nwords', 'B.md': '---\nstatus: done\n---\n# B' });
    expect((await svc.search('status:draft')).results.map((r) => r.path)).toEqual(['A.md']);
    expect((await svc.attributeKeys())[0]).toMatchObject({ key: 'status', pages: 2 });
    expect((await svc.attributeValues('status')).map((v) => v.value)).toEqual(['done', 'draft']);
  });
});

describe('per-workspace state', () => {
  it('persists expanded folders and the last page across sessions', async () => {
    await open({ 'A.md': '# A' });
    await svc.setState({ expanded: ['A.md'], lastPage: 'A.md' });
    await svc.closeWorkspace();
    await svc.openWorkspace(root);
    expect(await svc.getState()).toEqual({ expanded: ['A.md'], lastPage: 'A.md' });
  });
});

describe('dispatch', () => {
  it('only exposes public methods', async () => {
    await expect(svc.call('nope', [])).rejects.toMatchObject({ code: 'BAD_METHOD' });
    await expect(svc.call('call', [])).rejects.toMatchObject({ code: 'BAD_METHOD' });
    await expect(svc.call('_x', [])).rejects.toMatchObject({ code: 'BAD_METHOD' });
    await open({ 'A.md': '# A' });
    expect(await svc.call('readPage', ['A.md'])).toMatchObject({ text: '# A' });
  });
});

describe('database views', () => {
  const files = {
    '.cave-notes/schema.yaml': 'schema:\n  status: { type: enum, values: [todo, doing, done] }\n  due: { type: date }\n',
    'Proj.md': '# Proj',
    'Proj/A.md': '---\nstatus: todo\ndue: 2026-10-22\n# keep this comment\ntags: [x, y]\n---\n# A\nbody\n',
    'Proj/B.md': '---\nstatus: done\n---\n# B\n',
    'Proj/C.md': '# C\nno frontmatter\n',
  };

  it('queryView pages the results, colours rows by rule, and gives every page a filename and filetype', async () => {
    await open({
      'Proj.md': '# Proj',
      'Proj/A.md': '---\nstatus: todo\ndue: 2020-01-01\n---\n# A',
      'Proj/B.md': '---\nstatus: done\ndue: 2020-01-02\n---\n# B',
      'Proj/C.md': '---\nstatus: todo\ndue: 2099-01-01\n---\n# C',
      'Proj/photo.png': 'x',
    });
    const first = await svc.queryView('under:Proj filetype:md sort:title', null, 2, 0);
    expect(first.rows.map((x) => x.path)).toEqual(['Proj/A.md', 'Proj/B.md']);
    expect(first.total).toBe(3);
    const second = await svc.queryView('under:Proj filetype:md sort:title', null, 2, 2);
    expect(second.rows.map((x) => x.path)).toEqual(['Proj/C.md']);
    expect(second.rows[0]!.attrs.filename![0]!.text).toBe('C.md');
    expect(second.rows[0]!.attrs.filetype![0]!.text).toBe('md');
    const colored = await svc.queryView('under:Proj filetype:md sort:title', null, 10, 0, [
      { when: 'status:done', color: 'gray' },
      { when: 'due:<$now.day', color: 'red' },
    ]);
    expect(Object.fromEntries(colored.rows.map((x) => [x.path, x.color ?? null]))).toEqual({ 'Proj/A.md': 'red', 'Proj/B.md': 'gray', 'Proj/C.md': null });
    const files = await svc.queryView('under:Proj is:file', null);
    expect(files.rows.map((x) => x.path)).toEqual(['Proj/photo.png']);
  });

  it('queryView returns matching pages with only the attributes asked for', async () => {
    await open(files);
    const r = await svc.queryView('under:Proj sort:title', ['status', 'due']);
    expect(r.rows.map((x) => x.path)).toEqual(['Proj/A.md', 'Proj/B.md', 'Proj/C.md']);
    const a = r.rows[0]!;
    expect(Object.keys(a.attrs).sort()).toEqual(['due', 'status']);
    expect(a.attrs.status).toEqual([{ type: 'string', text: 'todo', num: null }]);
    expect(a.attrs.due?.[0]?.text).toBe('2026-10-22');
    expect(typeof a.attrs.due?.[0]?.num).toBe('number');
    expect(r.errors).toEqual([]);
    expect((await svc.queryView('status:done', null)).rows.map((x) => x.path)).toEqual(['Proj/B.md']);
  });

  it('setAttribute edits one key and keeps comments and the body', async () => {
    await open(files);
    const r = await svc.setAttribute('Proj/A.md', 'status', 'doing');
    expect(r.ok).toBe(true);
    const text = await read('Proj/A.md');
    expect(text).toContain('status: doing');
    expect(text).toContain('# keep this comment');
    expect(text).toContain('tags: [x, y]');
    expect(text.endsWith('# A\nbody\n')).toBe(true);
    await waitFor(() => eventsOf('index:updated').length > 0, 'index update after setAttribute');
    expect((await svc.queryView('status:doing', ['status'])).rows.map((x) => x.path)).toEqual(['Proj/A.md']);
  });

  it('setAttribute adds frontmatter when there is none, and removes a key with null', async () => {
    await open(files);
    await svc.setAttribute('Proj/C.md', 'status', 'todo');
    expect(await read('Proj/C.md')).toBe('---\nstatus: todo\n---\n# C\nno frontmatter\n');
    await svc.setAttribute('Proj/C.md', 'weight', 4);
    expect(await read('Proj/C.md')).toContain('weight: 4');
    await svc.setAttribute('Proj/C.md', 'status', null);
    expect(await read('Proj/C.md')).not.toContain('status');
    expect(await read('Proj/C.md')).toContain('weight: 4');
  });

  it('setAttribute rejects bad names and pages without a file, and leaves unchanged values alone', async () => {
    await open(files);
    await expect(svc.setAttribute('Proj/A.md', 'bad key', 'x')).rejects.toMatchObject({ code: 'BAD_ATTRIBUTE' });
    await expect(svc.setAttribute('Nope.md', 'status', 'x')).rejects.toMatchObject({ code: 'NO_FILE' });
    const before = await read('Proj/B.md');
    await svc.setAttribute('Proj/B.md', 'status', 'done');
    expect(await read('Proj/B.md')).toBe(before);
  });

  it('setAttribute does not clobber a page that changed on disk meanwhile is detected by the hash check', async () => {
    await open(files);
    const read1 = await svc.readPage('Proj/B.md');
    await write('Proj/B.md', '---\nstatus: done\n---\n# B edited elsewhere\n');
    const r = await svc.writePage('Proj/B.md', read1.text + 'x', read1.hash);
    expect(r.ok).toBe(false);
    // setAttribute reads fresh, so it applies on top of the new content
    await svc.setAttribute('Proj/B.md', 'status', 'todo');
    expect(await read('Proj/B.md')).toBe('---\nstatus: todo\n---\n# B edited elsewhere\n');
  });
});

describe('hidden pages', () => {
  it('leaves hidden pages out of the tree but not out of the sub-page list, and follows edits', async () => {
    await open({
      'Top.md': '# Top',
      'Top/Secret.md': '---\nhidden: true\n---\n# Secret',
      'Top/Secret/Deep.md': '# Deep',
      'Top/Shown.md': '# Shown',
      'Only.md': '# Only',
      'Only/Quiet.md': '---\nhidden: true\n---\n# Quiet',
    });
    expect((await svc.listChildren('Top.md')).map((i) => i.path)).toEqual(['Top/Shown.md']);
    const all = await svc.listChildren('Top.md', { includeHidden: true });
    expect(all.map((i) => [i.path, !!i.hidden])).toEqual([['Top/Secret.md', true], ['Top/Shown.md', false]]);
    // every sub-page hidden: nothing to expand
    expect((await svc.listChildren(null)).find((i) => i.path === 'Only.md')?.hasChildren).toBe(false);

    // the open hidden page is shown as its parent in the tree; so is anything below it
    expect(await svc.treeAnchor('Top/Secret.md')).toBe('Top.md');
    expect(await svc.treeAnchor('Top/Secret/Deep.md')).toBe('Top.md');
    expect(await svc.treeAnchor('Top/Shown.md')).toBe('Top/Shown.md');

    // a parent can hide all its sub-pages by default
    await svc.writePage('Top.md', '---\nchildren:\n  hidden: true\n---\n# Top', (await svc.readPage('Top.md')).hash);
    await waitFor(() => eventsOf('tree:changed').some((e) => (e.payload as { parents: unknown }).parents === 'all'), 'tree refresh after hiding');
    expect((await svc.listChildren('Top.md')).map((i) => i.path)).toEqual([]);
    expect((await svc.listChildren(null)).find((i) => i.path === 'Top.md')?.hasChildren).toBe(false);
  });

  it('a hidden page at the top has no anchor', async () => {
    await open({ 'Alone.md': '---\nhidden: true\n---\n# Alone', 'Other.md': '# Other' });
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['Other.md']);
    expect(await svc.treeAnchor('Alone.md')).toBeNull();
  });
});

describe('reordering', () => {
  const names = async (parent: string | null): Promise<string[]> => (await svc.listChildren(parent)).map((i) => i.name);

  it('puts a page in front of another by writing order numbers, and touches as little as it can', async () => {
    await open({ 'A.md': '# A', 'B.md': '# B', 'C.md': '# C', 'D.md': '# D' });
    await svc.reorderPage('D.md', 'B.md');
    expect(await names(null)).toEqual(['A', 'D', 'B', 'C']);
    await svc.reorderPage('A.md', null);
    expect(await names(null)).toEqual(['D', 'B', 'C', 'A']);
    await svc.reorderPage('C.md', 'D.md');
    expect(await names(null)).toEqual(['C', 'D', 'B', 'A']);
    // between two numbered pages only the moved page is written
    const before = await read('B.md');
    await svc.reorderPage('A.md', 'B.md');
    expect(await names(null)).toEqual(['C', 'D', 'A', 'B']);
    expect(await read('B.md')).toBe(before);
    expect(await read('A.md')).toMatch(/^---\norder: [\d.]+\n---\n# A/);
  });

  it('works inside a branch and leaves other branches alone', async () => {
    await open({ 'P.md': '# P', 'P/x.md': '# x', 'P/y.md': '# y', 'P/z.md': '# z', 'Q.md': '# Q', 'R.md': '# R' });
    await svc.reorderPage('P/z.md', 'P/x.md');
    expect(await names('P.md')).toEqual(['z', 'x', 'y']);
    expect(await names(null)).toEqual(['P', 'Q', 'R']);
    expect(await read('Q.md')).toBe('# Q');
  });

  it('refuses when a folder without a page would have to be numbered', async () => {
    await open({ 'A.md': '# A', 'B.md': '# B', 'Folder/Kid.md': '# Kid' });
    // A, B, Folder (virtual): moving Folder's neighbour behind it needs a number on Folder
    await expect(svc.reorderPage('A.md', null)).rejects.toMatchObject({ code: 'NEEDS_PAGE' });
    expect(await names(null)).toEqual(['A', 'B', 'Folder']);
    await svc.reorderPage('B.md', 'A.md'); // front part is A and B only
    expect(await names(null)).toEqual(['B', 'A', 'Folder']);
  });
});

describe('workspace appearance', () => {
  it('is saved in .cave-notes, validated, and merged', async () => {
    await open({ 'A.md': '# A' });
    const none = { color: null, icon: null, fontStyle: null, fontSizes: { sans: null, serif: null, mono: null } };
    expect(await svc.getAppearance()).toEqual(none);
    expect(await svc.setAppearance({ color: '#3584E4' })).toEqual({ ...none, color: '#3584e4' });
    expect(await svc.setAppearance({ icon: 'book' })).toEqual({ ...none, color: '#3584e4', icon: 'book' });
    expect(YAML.parse(await read('.cave-notes/workspace.yaml'))).toMatchObject({ color: '#3584e4', icon: 'book' });
    expect(await svc.setAppearance({ color: 'red; evil', icon: '../x' })).toEqual(none);
  });

  it('keeps the page text of a workspace: typeface and a size for each typeface, checked, and cleared with null', async () => {
    await open({ 'A.md': '# A' });
    expect(await svc.setAppearance({ fontStyle: 'serif', fontSizes: { serif: 20.26 } as never })).toMatchObject({ fontStyle: 'serif', fontSizes: { sans: null, serif: 20.5, mono: null } });
    expect(YAML.parse(await read('.cave-notes/workspace.yaml'))).toMatchObject({ font: 'serif', fontSizes: { serif: 20.5 } });
    expect(await svc.setAppearance({ fontSizes: { mono: 13 } as never })).toMatchObject({ fontStyle: 'serif', fontSizes: { sans: null, serif: 20.5, mono: 13 } });
    expect(await svc.setAppearance({ fontSizes: { serif: 400 } as never })).toMatchObject({ fontSizes: { serif: 40, mono: 13 } });
    expect(await svc.setAppearance({ fontStyle: 'comic' as never, fontSizes: { serif: null, mono: null } as never })).toMatchObject({ fontStyle: null, fontSizes: { sans: null, serif: null, mono: null } });
    expect(YAML.parse(await read('.cave-notes/workspace.yaml')).fontSizes).toBeUndefined();
  });
});

describe('syncing', () => {
  const COPY = (name: string): string => `${name}.sync-conflict-20260101-120000-ABCDEFG.md`;

  it('keeps conflict copies out of the tree and the index', async () => {
    await open({ 'A.md': '# A', [COPY('A')]: '# A other' });
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['A.md']);
  });

  it('merges a conflict copy into its page and deletes it, keeping both texts in the history', async () => {
    await write('Note.md', '# Note\n\none\ntwo\nthree\n');
    await open({});
    await svc.readPage('Note.md'); // the app has seen this version: it is the common ancestor
    await svc.setSyncOptions({ conflictMerge: 'auto' });
    await write('Note.md', '# Note\n\nONE\ntwo\nthree\n');
    await write(COPY('Note'), '# Note\n\none\ntwo\nTHREE\n');
    await waitFor(() => eventsOf('sync:merged')[0], 'merge');
    expect(await read('Note.md')).toBe('# Note\n\nONE\ntwo\nTHREE\n');
    await expect(fs.stat(path.join(root, COPY('Note')))).rejects.toThrow();
    const texts = await svc.historyTexts('Note.md', 20);
    expect(texts).toContain('# Note\n\none\ntwo\nTHREE\n');
    expect(texts).toContain('# Note\n\nONE\ntwo\nthree\n');
  });

  it('with no known ancestor it still keeps everything from both versions', async () => {
    await open({ 'Note.md': 'shared\nonly here\n' });
    await svc.setSyncOptions({ conflictMerge: 'auto' });
    await write(COPY('Note'), 'shared\nonly there\n');
    await waitFor(() => eventsOf('sync:merged')[0], 'merge');
    const merged = await read('Note.md');
    expect(merged).toContain('only here');
    expect(merged).toContain('only there');
  });

  it('asks first when the setting says so, and leaves the copy alone', async () => {
    await open({ 'Note.md': 'x\n' });
    await svc.setSyncOptions({ conflictMerge: 'ask' });
    await write(COPY('Note'), 'y\n');
    const ev = await waitFor(() => eventsOf('sync:conflicts')[0], 'question');
    expect((ev.payload as { pages: string[] }).pages).toEqual(['Note.md']);
    await fs.stat(path.join(root, COPY('Note')));
    expect(await svc.mergeConflictCopies()).toBe(1);
    await expect(fs.stat(path.join(root, COPY('Note')))).rejects.toThrow();
  });

  it('merges conflict copies found when the setting is switched on', async () => {
    await open({ 'Note.md': 'x\n', [COPY('Note')]: 'x\ny\n' });
    await svc.setSyncOptions({ conflictMerge: 'auto' });
    await waitFor(() => eventsOf('sync:merged')[0], 'merge');
    expect(await read('Note.md')).toBe('x\ny\n');
  });

  it('recognises a move (same content, new place) instead of reporting a deletion', async () => {
    await open({ 'A.md': '# A\nunique body\n', 'Dir.md': '# Dir' });
    await svc.readPage('A.md');
    await fs.mkdir(path.join(root, 'Dir'));
    await fs.rename(path.join(root, 'A.md'), path.join(root, 'Dir', 'A.md'));
    const ev = await waitFor(() => eventsOf('page:moved')[0], 'move');
    expect(ev.payload).toMatchObject({ from: 'A.md', to: 'Dir/A.md' });
    await new Promise((r) => setTimeout(r, 500));
    expect(eventsOf('page:changed').filter((e) => (e.payload as { hash: unknown }).hash === null)).toEqual([]);
  });

  it('still reports a real deletion, after a short wait for a possible move', async () => {
    await open({ 'A.md': '# A', 'B.md': '# B' });
    await fs.rm(path.join(root, 'A.md'));
    const ev = await waitFor(() => eventsOf('page:changed').find((e) => (e.payload as { path: string }).path === 'A.md'), 'deletion');
    expect((ev.payload as { hash: unknown }).hash).toBeNull();
    expect(eventsOf('page:moved')).toEqual([]);
  });

  it('follows edits to .cave-notes/schema.yaml without a restart', async () => {
    await open({ 'A.md': '---\nflag: true\n---\n# A' });
    expect((await svc.attributeKeys()).find((k) => k.key === 'tags')).toBeUndefined();
    await write('.cave-notes/schema.yaml', 'schema:\n  tags: { type: multiselect, values: [a, b] }\n');
    await waitFor(async () => false as never, 'nothing', 1).catch(() => {});
    await waitFor(() => eventsOf('index:updated')[0], 'schema reload');
    const tags = (await svc.attributeKeys()).find((k) => k.key === 'tags');
    expect(tags).toMatchObject({ list: true, values: ['a', 'b'] });
  });

  it('follows edits to the global attributes in .cave-notes/workspace.yaml without a restart', async () => {
    await open({ 'A.md': '# A', 'A/B.md': '---\nlang: fr\n---\n# B' });
    expect((await svc.attributeKeys()).find((k) => k.key === 'lang')?.pages).toBe(1);
    const before = eventsOf('index:updated').length;
    await write('.cave-notes/workspace.yaml', JSON.stringify({ attributes: { lang: 'en' } }));
    await waitFor(() => eventsOf('index:updated').length > before, 'global attributes reload');
    expect((await svc.attributeKeys()).find((k) => k.key === 'lang')?.pages).toBe(2); // A gets it; B keeps its own
  });

  it('saves a query in the workspace file, uses it as saved:name, and fills relation columns', async () => {
    await open({
      'Alpha.md': '---\nkind: project\n---\n# Alpha',
      'T1.md': '---\nkind: task\nproject: "[[Alpha]]"\n---\n# One',
    });
    const before = eventsOf('index:updated').length;
    await svc.saveQuery('projects', 'kind:project');
    await svc.saveQuery('tasks', 'kind:task');
    expect((await svc.savedQueries()).queries.map((q) => q.name)).toEqual(['projects', 'tasks']);
    expect(eventsOf('index:updated').length).toBeGreaterThan(before);
    expect((await svc.queryView('saved:projects', null)).rows.map((r) => r.path)).toEqual(['Alpha.md']);
    await expect(svc.saveQuery('bad"name', 'x')).rejects.toThrow();
    // a relation is written by hand in the workspace file; the other settings in it are kept
    const file = YAML.parse(await fs.readFile(path.join(root, '.cave-notes', 'workspace.yaml'), 'utf8'));
    file.relations = [{ name: 'Project', from: 'tasks', attribute: 'project', to: 'projects', reverse: 'Tasks' }];
    await write('.cave-notes/workspace.yaml', JSON.stringify(file));
    await waitFor(() => (svc as unknown as { open: { index: { relations: unknown[] } } }).open.index.relations.length > 0, 'relations reload');
    const tasks = await svc.queryView('saved:tasks', null);
    expect(tasks.rows[0]!.related).toEqual({ Project: [{ path: 'Alpha.md', title: 'Alpha' }] });
    const projects = await svc.queryView('saved:projects', null);
    expect(projects.rows[0]!.related?.Tasks?.map((x) => x.title)).toEqual(['One']);
  });

  it('opens one file on its own: only that page, nothing written beside it, a history kept apart', async () => {
    await write('Solo.md', '# Solo\n');
    await write('Other.md', '# Other\n');
    const hist = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-hist-'));
    const info = await svc.openWorkspace(root, { file: 'Solo.md', dataDir: hist });
    expect(info).toMatchObject({ single: true, name: 'Solo' });
    await waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'index');
    expect((await svc.listChildren(null)).map((i) => i.path)).toEqual(['Solo.md']);
    expect((await svc.writePage('Solo.md', '# Solo\nedited\n', (await svc.readPage('Solo.md')).hash)).ok).toBe(true);
    expect((await fs.readdir(root)).sort()).toEqual(['Other.md', 'Solo.md']);
    expect((await svc.historyList('Solo.md')).length).toBeGreaterThan(0);
    await fs.rm(hist, { recursive: true, force: true });
  });

  it('setPageTitle rewrites the first heading and nothing else', async () => {
    await open({ 'A.md': '---\nx: 1\n---\n# Old name\n\nbody # not a heading\n' });
    const r = await svc.setPageTitle('A.md', 'New name');
    expect(r.ok).toBe(true);
    expect(await read('A.md')).toBe('---\nx: 1\n---\n# New name\n\nbody # not a heading\n');
  });
  it('duplicatePage adds .1, counts up from .number, copies sub-pages and keeps the title exactly', async () => {
    await open({ 'Plan.md': '---\nx: 1\n---\n# Plan\n', 'Plan/Step.md': '# Step\n', 'Plan/Step/Deep.md': '# Deep\n' });
    const first = await svc.duplicatePage('Plan.md');
    expect(first).toBe('Plan.1.md');
    expect(await read('Plan.1.md')).toBe(await read('Plan.md'));
    expect(await read('Plan.1/Step.md')).toBe('# Step\n');
    expect(await read('Plan.1/Step/Deep.md')).toBe('# Deep\n');
    expect(await svc.duplicatePage('Plan.1.md')).toBe('Plan.2.md');
    expect(await svc.duplicatePage('Plan.md')).toBe('Plan.3.md'); // .1 and .2 are taken
    expect(await svc.duplicatePage('Plan/Step.md')).toBe('Plan/Step.1.md');
  });

  it('keeps workspace YAML as text: refuses what is not YAML, saves what is, and an empty attribute is there with no value', async () => {
    await open({ 'Tasks.md': '---\nchildren:\n  due:\n---\n# Tasks\n', 'Tasks/A.md': '# A\n' });
    const bad = await svc.setWorkspaceYaml('schema', 'attributes: [oops');
    expect(bad.ok).toBe(false);
    expect((await svc.getWorkspaceYaml()).schema).toBe('');
    expect(await svc.setWorkspaceYaml('schema', 'due:\n  type: date\n')).toEqual({ ok: true });
    expect(await svc.setWorkspaceYaml('attributes', 'status: idea\nowner:\n')).toEqual({ ok: true });
    const y = await svc.getWorkspaceYaml();
    expect(y.schema).toContain('type: date');
    expect(y.attributes).toContain('status: idea');
    // sections live in whichever file has them: here the usual ones; moving one into a file of its own changes nothing
    expect(await read('.cave-notes/schema.yaml')).toContain('schema:');
    expect((await svc.setWorkspaceYaml('attributes', 'just text')).ok).toBe(false);
    const v = await svc.queryView('under:Tasks', null);
    const a = v.rows.find((r) => r.path === 'Tasks/A.md')!;
    expect(a.attrs.due?.[0]).toMatchObject({ type: 'date', text: '' });
    expect(a.attrs.owner?.[0]?.text).toBe('');
    expect(a.attrs.status?.[0]?.text).toBe('idea');
  });

  it('syncFolder indexes pages of one folder that the index does not know yet', async () => {
    await open({ 'Top.md': '# Top\n' });
    await write('Top/New.md', '---\nstatus: fresh\n---\n# New\n');
    await svc.syncFolder('Top.md');
    const v = await svc.queryView('status:fresh', null);
    expect(v.rows.map((r) => r.path)).toEqual(['Top/New.md']);
  });
});

describe('pages that were moved away outside the app', () => {
  it('are not written back when the open page is saved', async () => {
    await open({ 'A.md': '# A\n' });
    const page = await svc.readPage('A.md');
    await fs.rm(path.join(root, 'A.md'));
    const res = await svc.writePage('A.md', '# A changed\n', page.hash);
    expect(res).toMatchObject({ ok: false, conflict: true, diskHash: null });
    await expect(fs.stat(path.join(root, 'A.md'))).rejects.toBeTruthy();
    // an explicit "keep it" (no base) still writes
    expect(await svc.writePage('A.md', '# A changed\n', null)).toMatchObject({ ok: true });
  });
});

describe('moving a folder that has no page of its own', () => {
  it('moves it with everything inside it', async () => {
    await open({ 'Folder/Kid.md': '# Kid', 'Dest.md': '# Dest' });
    const plan = await svc.planMove('Folder.md', 'Dest.md');
    await svc.applyPlan(plan);
    expect(await read('Dest/Folder/Kid.md')).toBe('# Kid');
  });
});

describe('copying pages in', () => {
  it('copies a page with its sub-pages, under a free name', async () => {
    await open({ 'A.md': '# A', 'A/Kid.md': '# Kid', 'Dest.md': '# Dest', 'Dest/A.md': '# taken' });
    const src = await svc.pageSource('A.md');
    const made = await svc.copyPageIn(src, 'Dest.md');
    expect(made).toBe('Dest/A.1.md');
    expect(await read('Dest/A.1.md')).toBe('# A');
    expect(await read('Dest/A.1/Kid.md')).toBe('# Kid');
    expect(await read('A.md')).toBe('# A');
  });
});

describe('settings in one file', () => {
  it('reads every section from a single file, and saves a changed section back into the file that has it', async () => {
    await open({
      'Tasks/A.md': '# A\n',
      '.cave-notes/setup.yaml': 'schema:\n  due: { type: date }\nattributes:\n  status: idea\nqueries:\n  open: status:idea\nrules: []\n',
    });
    const y = await svc.getWorkspaceYaml();
    expect(y.schema).toContain('type: date');
    expect(y.attributes).toContain('status: idea');
    expect(y.queries).toContain('status:idea');
    expect(await svc.setWorkspaceYaml('attributes', 'status: done\n')).toEqual({ ok: true });
    expect(await svc.setWorkspaceYaml('schema', 'due:\n  type: text\n')).toEqual({ ok: true });
    // no other settings file was made: the single file kept its sections
    const names = (await fs.readdir(path.join(root, '.cave-notes'))).filter((n) => n.endsWith('.yaml')).sort();
    expect(names).toEqual(['setup.yaml']);
    const text = await read('.cave-notes/setup.yaml');
    expect(text).toContain('status: done');
    expect(text).toContain('type: text');
    expect(text).toContain('queries:');
    // a section that is not in the file yet goes there too (it is the only settings file)
    expect(await svc.setExportStyles('Plain:\n  units: cm\n')).toEqual({ ok: true });
    expect(await read('.cave-notes/setup.yaml')).toContain('export-style:');
    expect(await svc.getExportStyles()).toContain('Plain');
  });
});

describe('files dropped on a page', () => {
  it('a file already in the page\'s folder is not copied again', async () => {
    await open({ 'Trip.md': '# Trip\n', 'Trip/map.png': 'png' });
    const inside = path.join(root, 'Trip', 'map.png');
    expect(await svc.fileInPage('Trip.md', inside)).toBe('Trip/map.png');
    const r = await svc.importFile('Trip.md', inside);
    expect(r.rel).toBe('Trip/map.png');
    expect((await fs.readdir(path.join(root, 'Trip'))).sort()).toEqual(['map.png']); // no map.1.png
    // a file from elsewhere is copied, as before
    const outside = path.join(os.tmpdir(), `cave-out-${process.pid}.png`);
    await fs.writeFile(outside, 'x');
    expect(await svc.fileInPage('Trip.md', outside)).toBeNull();
    const c = await svc.importFile('Trip.md', outside);
    expect(c.rel).toBe(`Trip/cave-out-${process.pid}.png`);
    await fs.rm(outside);
  });
});

describe('workspace preferences after a custom font size', () => {
  it('still reads and writes everything', async () => {
    await open({ 'A.md': '# A' });
    await svc.setAppearance({ fontSizes: { sans: 18 } as never });
    expect(Object.keys(await svc.getWorkspaceYaml()).sort()).toEqual(['attributes', 'automations', 'files', 'queries', 'relations', 'schema']);
    expect(await svc.setWorkspaceYaml('attributes', 'status: [a, b]\n')).toMatchObject({ ok: true });
    expect(await svc.setAppearance({ color: '#3584e4' })).toMatchObject({ color: '#3584e4', fontSizes: { sans: 18 } });
    expect(await svc.setAppearance({ fontSizes: { mono: 14 } as never })).toMatchObject({ fontSizes: { sans: 18, mono: 14 } });
    expect(await svc.getNoteTypes()).toBeTruthy();
    expect(await svc.setNoteTypes({ exts: ['.md', '.txt'], create: '.md' }, { exts: ['.md'], create: '.md' })).toBeUndefined();
  });
});

describe('plugins that another workspace offers', () => {
  it('are listed as pending until accepted, then run like the others', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-other-'));
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-shared-'));
    try {
      await fs.mkdir(path.join(other, '.cave-notes'), { recursive: true });
      await fs.writeFile(path.join(other, 'N.md'), '# N');
      await fs.writeFile(path.join(other, '.cave-notes', 'automations.yaml'), 'rules: !global\n  - id: hello\n    on: { plugin: "Say hello" }\n    do:\n      - notify: hi\n');
      await svc.openWorkspace(other, { globalDir: shared, globalsEnabled: true });
      await waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'first workspace');
      await fs.writeFile(path.join(root, 'A.md'), '# A');
      await svc.openWorkspace(root, { globalDir: shared, globalsEnabled: true });
      await waitFor(() => events.filter((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready').length >= 2, 'second workspace');
      const listed = await svc.automationPlugins();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: 'hello', label: 'Say hello', pending: { name: path.basename(other) } });
      const offer = await svc.globalsOffer(listed[0]!.pending!.source);
      expect(offer).toMatchObject({ name: path.basename(other) });
      await svc.globalsDecide(offer!.source, offer!.hash, [fs.realpath ? await fs.realpath(root) : root], [await fs.realpath(root)]);
      const after = await svc.automationPlugins();
      expect(after.map((p) => [p.id, p.pending])).toEqual([['hello', undefined]]);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
      await fs.rm(shared, { recursive: true, force: true });
    }
  });
});

describe('absolutePath', () => {
  it('answers for a picture or a folder as well as for a page', async () => {
    await open({ 'Sermons/Survival Skills.md': '# S\n', 'Sermons/Survival Skills/pic.jpg': 'x' });
    expect(await svc.absolutePath('Sermons/Survival Skills.md')).toBe(path.join(root, 'Sermons', 'Survival Skills.md'));
    expect(await svc.absolutePath('Sermons/Survival Skills/pic.jpg')).toBe(path.join(root, 'Sermons', 'Survival Skills', 'pic.jpg'));
    expect(await svc.absolutePath('Sermons/Survival Skills')).toBe(path.join(root, 'Sermons', 'Survival Skills'));
    await expect(svc.absolutePath('../outside.jpg')).rejects.toThrow();
  });
});

describe('search and replace', () => {
  const req = { find: 'cat', replace: 'dog', regex: false, matchCase: false, wholeWord: false, kinds: ['text', 'headings', 'attributes', 'code'], names: false, pages: '' };

  it('previews, then changes only what was chosen, and renames with the links', async () => {
    await open({
      'Cat Facts.md': '---\npet: cat\n---\n# Cat facts\n\nA cat sat.\n\n```\ncat --help\n```\n',
      'Other.md': 'See [[Cat Facts]] and a cat.\n',
      'Dogs.md': 'only dogs\n',
    });
    const found = await svc.replaceFind({ ...req, kinds: ['text', 'headings'], names: true });
    expect(found.error).toBeNull();
    expect(found.pages.map((p) => p.path)).toEqual(['Cat Facts.md', 'Other.md']);
    expect(found.pages[0]!.rename).toBe('dog Facts');
    expect(found.pages[0]!.matches.map((m) => m.kind)).toEqual(['headings', 'text']);

    const noCode = await svc.replaceFind({ ...req, kinds: ['text'] });
    expect(noCode.pages[0]!.matches).toHaveLength(1);

    // choose: the first page's text only (not the heading), the second page's whole
    const text = found.pages[0]!.matches.find((m) => m.kind === 'text')!;
    const done = await svc.replaceApply({ ...req, kinds: ['text', 'headings'], names: true }, [
      { path: 'Cat Facts.md', matches: [text.id], rename: true },
      { path: 'Other.md', matches: null, rename: false },
    ]);
    expect(done).toMatchObject({ matches: 3, pages: 2, renamed: 1, failed: [] }); // the link's own text counts, as a match
    const renamed = await svc.readPage('dog Facts.md');
    expect(renamed.text).toContain('# Cat facts');
    expect(renamed.text).toContain('A dog sat.');
    expect(renamed.text).toContain('pet: cat'); // attributes were not asked for
    const other = await svc.readPage('Other.md');
    expect(other.text).toBe('See [[dog Facts]] and a dog.\n'); // the link followed the rename
  });

  it('reports a regular expression that is not one, and keeps to the pages a search picks', async () => {
    await open({ 'A.md': 'status: x\n', 'B.md': '---\nstatus: draft\n---\nx\n' });
    expect((await svc.replaceFind({ ...req, find: '(', regex: true })).error).toEqual(expect.any(String));
    const only = await svc.replaceFind({ ...req, find: 'x', replace: 'y', pages: 'status:draft' });
    expect(only.pages.map((p) => p.path)).toEqual(['B.md']);
  });
});
