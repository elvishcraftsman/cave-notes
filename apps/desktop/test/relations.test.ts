import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';
import type { RelationConflict, WorkerEvents } from '../src/shared/api';

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
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const ready = (): Promise<Ev> => waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'ready');

async function open(files: Record<string, string>, relation: Record<string, unknown>): Promise<void> {
  await write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { tasks: 'kind:task', projects: 'kind:project' }, relations: [{ name: 'Project', from: 'tasks', to: 'projects', attribute: 'project', backattribute: 'tasks', backname: 'Tasks', ...relation }] }));
  for (const [k, v] of Object.entries(files)) await write(k, v);
  await svc.openWorkspace(root);
  await ready();
}
const task = (name: string, extra = ''): Record<string, string> => ({ [`${name}.md`]: `---\nkind: task\n${extra}---\n# ${name}\n` });
const project = (name: string, extra = ''): Record<string, string> => ({ [`${name}.md`]: `---\nkind: project\n${extra}---\n# ${name}\n` });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-rel-'));
  events = [];
  svc = new WorkspaceService((event, payload) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
});

describe('mutual relations', () => {
  it('naming a page names this page back, and dropping it takes it out again', async () => {
    await open({ ...task('Write'), ...project('Alpha'), ...project('Beta', 'tasks:\n  - "[[Other]]"\n') }, { multiple: false });
    let r = await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md'] });
    expect(r).toMatchObject({ ok: true });
    expect(await read('Write.md')).toMatch(/project: "?\[\[Alpha\]\]"?/);
    expect(await read('Alpha.md')).toMatch(/tasks:\n?\s*-?\s*"?\[\[Write\]\]/);
    // a single attribute: choosing another page lets the first go
    r = await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Beta.md'] });
    expect(r).toMatchObject({ ok: true });
    expect(await read('Alpha.md')).not.toMatch(/Write/);
    const beta = await read('Beta.md');
    expect(beta).toMatch(/\[\[Other\]\]/); // what was there stays
    expect(beta).toMatch(/\[\[Write\]\]/);
    r = await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: [] });
    expect(r).toMatchObject({ ok: true });
    expect(await read('Write.md')).not.toMatch(/project/);
    expect(await read('Beta.md')).not.toMatch(/Write/);
  });

  it('editing from the other side works the same way, and a single attribute there is asked about', async () => {
    await open({ ...task('One'), ...task('Two'), ...project('Alpha'), ...project('Beta') }, { multiple: false, backmultiple: true });
    expect(await svc.editRelation({ page: 'Alpha.md', relation: 'Project', side: 'back', values: ['One.md', 'Two.md'] })).toMatchObject({ ok: true });
    expect(await read('One.md')).toMatch(/\[\[Alpha\]\]/);
    expect(await read('Two.md')).toMatch(/\[\[Alpha\]\]/);
    // Beta takes One, which has room for one project only and has Alpha
    const ask = await svc.editRelation({ page: 'Beta.md', relation: 'Project', side: 'back', values: ['One.md'] });
    expect(ask.ok).toBe(false);
    const conflicts = (ask as { conflicts: RelationConflict[] }).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'taken', action: 'link', page: { path: 'One.md' }, holder: { path: 'Alpha.md' } });
    expect(await read('Beta.md')).not.toMatch(/One/); // nothing was written
    // skip: the rest of the change still happens, this link does not
    expect(await svc.editRelation({ page: 'Beta.md', relation: 'Project', side: 'back', values: ['One.md'], resolutions: { [conflicts[0]!.id]: 'skip' } })).toMatchObject({ ok: true, changed: [] });
    expect(await read('One.md')).toMatch(/\[\[Alpha\]\]/);
    // replace: One moves to Beta and Alpha stops naming One
    expect(await svc.editRelation({ page: 'Beta.md', relation: 'Project', side: 'back', values: ['One.md'], resolutions: { [conflicts[0]!.id]: 'replace' } })).toMatchObject({ ok: true });
    expect(await read('One.md')).toMatch(/\[\[Beta\]\]/);
    expect(await read('One.md')).not.toMatch(/Alpha/);
    expect(await read('Alpha.md')).not.toMatch(/One/);
    expect(await read('Alpha.md')).toMatch(/Two/);
    expect(await read('Beta.md')).toMatch(/One/);
  });

  it('a page that cannot be changed is asked about, with the choice to link on this side only', async () => {
    await open({ ...task('Write'), ...project('Alpha', 'tasks: [unclosed\n') }, {});
    const ask = await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md'] });
    // Alpha's frontmatter is invalid, so it is not even in the relation's pages; the answer is a plain refusal
    expect(ask.ok).toBe(false);
    expect(await read('Write.md')).not.toMatch(/project/);
  });

  it('does not touch a relation that is not mutual, and refuses to edit its other column', async () => {
    await open({ ...task('Write'), ...project('Alpha') }, { backattribute: undefined, backname: undefined, reverse: 'Tasks' });
    expect(await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md'] })).toMatchObject({ ok: true, changed: ['Write.md'] });
    expect(await read('Alpha.md')).not.toMatch(/Write/);
    expect(await svc.editRelation({ page: 'Alpha.md', relation: 'Project', side: 'back', values: ['Write.md'] })).toMatchObject({ ok: false });
  });

  it('offers the pages of the other query, by the start of their title', async () => {
    await open({ ...task('Write'), ...project('Alpha'), ...project('Beta'), ...project('Alpine') }, {});
    const all = await svc.relationCandidates('Project', 'forward', '', []);
    expect(all.map((p) => p.path).sort()).toEqual(['Alpha.md', 'Alpine.md', 'Beta.md']);
    expect((await svc.relationCandidates('Project', 'forward', 'alp', ['Alpine.md'])).map((p) => p.path)).toEqual(['Alpha.md']);
    expect((await svc.relationCandidates('Project', 'back', '', [])).map((p) => p.path)).toEqual(['Write.md']);
  });

  it('both sides of a symmetric relation use one attribute', async () => {
    await write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { notes: 'kind:note' }, relations: [{ name: 'Related', from: 'notes', to: 'notes', attribute: 'related', backattribute: 'related', backname: 'Related by' }] }));
    for (const n of ['A', 'B']) await write(`${n}.md`, `---\nkind: note\n---\n# ${n}\n`);
    await svc.openWorkspace(root);
    await ready();
    expect(await svc.editRelation({ page: 'A.md', relation: 'Related', side: 'forward', values: ['B.md'] })).toMatchObject({ ok: true });
    expect(await read('B.md')).toMatch(/\[\[A\]\]/);
    expect(await svc.editRelation({ page: 'B.md', relation: 'Related', side: 'forward', values: [] })).toMatchObject({ ok: true });
    expect(await read('A.md')).not.toMatch(/related/);
  });
});

describe('adding several pages to a relation', () => {
  it('keeps every page, whether they are added together or one after the other', async () => {
    await open({ ...task('Write'), ...project('Alpha'), ...project('Beta'), ...project('Gamma') }, { multiple: true });
    expect(await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md'] })).toMatchObject({ ok: true });
    expect(await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md', 'Beta.md', 'Gamma.md'] })).toMatchObject({ ok: true });
    const w = await read('Write.md');
    for (const n of ['Alpha', 'Beta', 'Gamma']) expect(w).toContain(`[[${n}]]`);
    for (const n of ['Alpha', 'Beta', 'Gamma']) expect(await read(`${n}.md`)).toContain('[[Write]]');
  });

  it('keeps every page when the attribute was written as one plain value', async () => {
    await open({ ...task('Write', 'project: "[[Alpha]]"\n'), ...project('Alpha'), ...project('Beta') }, { multiple: true });
    expect(await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Alpha.md', 'Beta.md'] })).toMatchObject({ ok: true });
    const w = await read('Write.md');
    expect(w).toContain('[[Alpha]]');
    expect(w).toContain('[[Beta]]');
  });

  it('keeps every page from the other side, where each page holds one link', async () => {
    await open({ ...task('One'), ...task('Two'), ...task('Three'), ...project('Alpha') }, { multiple: false, backmultiple: true });
    expect(await svc.editRelation({ page: 'Alpha.md', relation: 'Project', side: 'back', values: ['One.md'] })).toMatchObject({ ok: true });
    expect(await svc.editRelation({ page: 'Alpha.md', relation: 'Project', side: 'back', values: ['One.md', 'Two.md', 'Three.md'] })).toMatchObject({ ok: true });
    const a = await read('Alpha.md');
    for (const n of ['One', 'Two', 'Three']) expect(a).toContain(`[[${n}]]`);
  });

  it('keeps every page of a symmetric relation', async () => {
    await write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { notes: 'kind:note' }, relations: [{ name: 'Related', from: 'notes', to: 'notes', attribute: 'related', backattribute: 'related', backname: 'Related by' }] }));
    for (const n of ['A', 'B', 'C', 'D']) await write(`${n}.md`, `---\nkind: note\n---\n# ${n}\n`);
    await svc.openWorkspace(root);
    await ready();
    expect(await svc.editRelation({ page: 'A.md', relation: 'Related', side: 'forward', values: ['B.md'] })).toMatchObject({ ok: true });
    expect(await svc.editRelation({ page: 'A.md', relation: 'Related', side: 'forward', values: ['B.md', 'C.md', 'D.md'] })).toMatchObject({ ok: true });
    const a = await read('A.md');
    for (const n of ['B', 'C', 'D']) expect(a).toContain(`[[${n}]]`);
    for (const n of ['B', 'C', 'D']) expect(await read(`${n}.md`)).toContain('[[A]]');
  });
});

describe('a relation whose pages are partly in another workspace', () => {
  let theo: string;
  const theoWrite = async (rel: string, text: string): Promise<void> => {
    const p = path.join(theo, ...rel.split('/'));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, text);
  };
  const theoRead = (rel: string): Promise<string> => fs.readFile(path.join(theo, ...rel.split('/')), 'utf8');
  /** the request the window sends: the workspaces on this computer, and the foreign pages the cell should name */
  const edit = (extra: Record<string, unknown>) =>
    svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: [], workspaces: [{ name: 'Theology', root: theo }], ...extra } as never);
  const ownName = (): string => path.basename(root);

  beforeEach(async () => {
    theo = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cave-theo-')), 'Theology');
    await fs.mkdir(path.join(theo, '.cave-notes'), { recursive: true });
    await theoWrite('Projects/Plan.md', '---\nkind: project\n---\n# Plan\n');
    await theoWrite('Other.md', '---\nkind: project\ntasks:\n  - "[[Somebody]]"\n---\n# Other\n');
  });
  afterEach(async () => {
    await fs.rm(path.dirname(theo), { recursive: true, force: true });
  });

  it('naming a page of the other workspace writes the link back in that file, and dropping it takes it out', async () => {
    await open({ ...task('Write'), ...project('Alpha') }, {});
    expect(await edit({ values: ['Alpha.md'], foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] })).toMatchObject({ ok: true, changedForeign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] });
    // here: a link that names the workspace; there: a link back that names this one
    expect(await read('Write.md')).toMatch(/\[\[Theology::Projects\/Plan\]\]/);
    expect(await read('Write.md')).toMatch(/\[\[Alpha\]\]/);
    expect(await theoRead('Projects/Plan.md')).toMatch(new RegExp(`\\[\\[${ownName()}::Write\\]\\]`));
    expect(await read('Alpha.md')).toMatch(/\[\[Write\]\]/);
    // and the view shows it, as a page of the other workspace
    const view = await svc.queryView('kind:task', null);
    const row = (view.rows as Array<{ path: string; related?: Record<string, Array<{ path: string; title: string; workspace?: string }>> }>).find((r) => r.path === 'Write.md')!;
    expect(row.related!.Project).toEqual(expect.arrayContaining([{ path: 'Projects/Plan', title: 'Plan', workspace: 'Theology' }, expect.objectContaining({ path: 'Alpha.md' })]));
    const back = (await svc.queryView('kind:project', null)).rows as Array<{ path: string; related?: Record<string, Array<{ path: string }>> }>;
    expect(back.find((r) => r.path === 'Alpha.md')!.related!.Tasks!.map((p) => p.path)).toEqual(['Write.md']);
    // the page that was there before is kept as it was
    expect(await theoRead('Other.md')).toMatch(/Somebody/);
    // dropping it: the link goes from both files, and the local one stays
    expect(await edit({ values: ['Alpha.md'], foreign: [] })).toMatchObject({ ok: true, changedForeign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] });
    expect(await read('Write.md')).not.toMatch(/Theology/);
    expect(await theoRead('Projects/Plan.md')).not.toMatch(/Write/);
    expect(await read('Alpha.md')).toMatch(/\[\[Write\]\]/);
  });

  it('adds to what the other page already names, and the entries there are read in that workspace', async () => {
    await open({ ...task('Write') }, {});
    expect(await edit({ foreign: [{ workspace: 'theology', path: 'Other' }] })).toMatchObject({ ok: true });
    const other = await theoRead('Other.md');
    expect(other).toMatch(/Somebody/);
    expect(other).toMatch(new RegExp(`\\[\\[${ownName()}::Write\\]\\]`));
    // asking again changes nothing: the link there already names this page
    const again = await theoRead('Other.md');
    await edit({ foreign: [{ workspace: 'Theology', path: 'Other.md' }] });
    expect(await theoRead('Other.md')).toBe(again);
  });

  it('a back attribute that holds one page and names another is asked about, never overwritten unasked', async () => {
    await open({ ...task('Write'), ...task('Rival') }, { backmultiple: false });
    expect(await edit({ page: 'Rival.md', foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] })).toMatchObject({ ok: true });
    const ask = await edit({ foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] });
    expect(ask.ok).toBe(false);
    const conflicts = (ask as { conflicts: RelationConflict[] }).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'taken', action: 'link', page: { title: 'Plan', workspace: 'Theology' }, holder: { path: 'Rival.md' } });
    expect(await read('Write.md')).not.toMatch(/Theology/); // nothing was written
    expect(await edit({ foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }], resolutions: { [conflicts[0]!.id]: 'replace' } })).toMatchObject({ ok: true });
    expect(await theoRead('Projects/Plan.md')).toMatch(new RegExp(`${ownName()}::Write`));
    expect(await theoRead('Projects/Plan.md')).not.toMatch(/Rival/);
    expect(await read('Rival.md')).not.toMatch(/Theology/); // the page that had it lost it
  });

  it('a file that changes between being read and being written keeps the other change', async () => {
    await open({ ...task('Write') }, {});
    const before = await theoRead('Projects/Plan.md');
    // right after the page of the other workspace is first read, someone else saves it
    const orig = fs.readFile;
    let hit = false;
    (fs as { readFile: unknown }).readFile = async (...a: unknown[]): Promise<unknown> => {
      const out = await (orig as (...x: unknown[]) => Promise<unknown>)(...a);
      if (!hit && String(a[0]).endsWith(path.join('Theology', 'Projects', 'Plan.md'))) {
        hit = true;
        await fs.writeFile(String(a[0]), `${before}\nedited elsewhere\n`);
      }
      return out;
    };
    let r: unknown;
    try {
      r = await edit({ foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] });
    } finally {
      (fs as { readFile: unknown }).readFile = orig;
    }
    expect(hit).toBe(true);
    // the first try found the file changed and wrote nothing; the second read the new text and added the link to it
    expect(r).toMatchObject({ ok: true });
    const after = await theoRead('Projects/Plan.md');
    expect(after).toContain('edited elsewhere');
    expect(after).toMatch(new RegExp(`${ownName()}::Write`));
    expect(await read('Write.md')).toMatch(/Theology::Projects\/Plan/);
  });

  it('a workspace or page that cannot be found is refused, and a page without a file is asked about', async () => {
    await open({ ...task('Write') }, {});
    expect(await edit({ foreign: [{ workspace: 'Nowhere', path: 'X.md' }] })).toMatchObject({ ok: false, error: expect.stringContaining('Nowhere') });
    expect(await edit({ foreign: [{ workspace: 'Theology', path: 'Missing.md' }] })).toMatchObject({ ok: false, error: expect.stringContaining('Missing') });
    expect(await read('Write.md')).not.toMatch(/project/);
    // an entry that names a workspace this computer does not know is left alone when other pages change
    await write('Write.md', '---\nkind: task\nproject:\n  - "[[Lost::Page]]"\n---\n# Write\n');
    expect(await edit({ values: [], foreign: [] })).toMatchObject({ ok: true });
    expect(await read('Write.md')).toMatch(/Lost::Page/);
  });

  it('a query of another workspace finds no page here: alone it offers nothing, joined by OR it adds nothing', async () => {
    await write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { tasks: 'kind:task', only: 'saved:Theology::projects', both: 'kind:project OR saved:Theology::projects' }, relations: [
      { name: 'Alone', from: 'tasks', to: 'only', attribute: 'alone', backattribute: 'back1' },
      { name: 'Mixed', from: 'tasks', to: 'both', attribute: 'mixed', backattribute: 'back2' },
    ] }));
    for (const [k, v] of Object.entries({ ...task('Write'), ...project('Alpha'), 'Note.md': '---\nkind: note\n---\n# Note\n' })) await write(k, v);
    await svc.openWorkspace(root);
    await ready();
    expect(await svc.relationCandidates('Alone', 'forward', '', [])).toEqual([]);
    expect((await svc.relationCandidates('Mixed', 'forward', '', [])).map((p) => p.path)).toEqual(['Alpha.md']);
    // typing narrows the whole query, not only its last alternative
    expect(await svc.relationCandidates('Mixed', 'forward', 'zzz', [])).toEqual([]);
    expect((await svc.relationCandidates('Mixed', 'forward', 'alp', [])).map((p) => p.path)).toEqual(['Alpha.md']);
    const rows = (await svc.queryView('kind:task', null)).rows as Array<{ related?: Record<string, unknown[]> }>;
    expect(Object.keys(rows[0]!.related!).sort()).toEqual(['Alone', 'Mixed']);
    // nothing of this workspace is in the other side of "Alone", so no page gets its column
    const notes = (await svc.queryView('kind:note', null)).rows as Array<{ related?: Record<string, unknown[]> }>;
    expect(notes[0]!.related ?? {}).toEqual({});
  });

  it('a file that is not a note keeps its attributes in the page of its folder, and the file itself is never touched', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10]);
    await theoWrite('Docs.md', '# Docs\n');
    await fs.mkdir(path.join(theo, 'Docs'), { recursive: true });
    await fs.writeFile(path.join(theo, 'Docs', 'Paper.odt'), bytes);
    await open({ ...task('Write') }, {});
    expect(await edit({ foreign: [{ workspace: 'Theology', path: 'Docs/Paper.odt' }] })).toMatchObject({ ok: true, changedForeign: [{ workspace: 'Theology', path: 'Docs/Paper.odt' }] });
    expect(await fs.readFile(path.join(theo, 'Docs', 'Paper.odt'))).toEqual(bytes);
    const docs = await theoRead('Docs.md');
    expect(docs).toMatch(/files:/);
    expect(docs).toMatch(/Paper\.odt/);
    expect(docs).toMatch(new RegExp(`${ownName()}::Write`));
    expect(await read('Write.md')).toMatch(/Theology::Docs\/Paper\.odt/);
    // taking it out again takes the attribute out of that page, and the empty entry with it
    expect(await edit({ foreign: [] })).toMatchObject({ ok: true });
    const after = await theoRead('Docs.md');
    expect(after).not.toMatch(/Write/);
    expect(after).not.toMatch(/files:/);
    expect(await fs.readFile(path.join(theo, 'Docs', 'Paper.odt'))).toEqual(bytes);
  });

  it('a file at the top of the other workspace keeps its attributes in that workspace\'s settings', async () => {
    const bytes = Buffer.from([1, 2, 3, 0, 255]);
    await fs.writeFile(path.join(theo, 'Top.odt'), bytes);
    await open({ ...task('Write') }, {});
    expect(await edit({ foreign: [{ workspace: 'Theology', path: 'Top.odt' }] })).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(theo, 'Top.odt'))).toEqual(bytes);
    const yaml = (await fs.readdir(path.join(theo, '.cave-notes'))).filter((f) => /\.ya?ml$/.test(f));
    const all = (await Promise.all(yaml.map((f) => fs.readFile(path.join(theo, '.cave-notes', f), 'utf8')))).join('\n');
    expect(all).toMatch(/files:/);
    expect(all).toMatch(/Top\.odt/);
    expect(all).toMatch(new RegExp(`${ownName()}::Write`));
    expect(await edit({ foreign: [] })).toMatchObject({ ok: true });
    const gone = (await Promise.all(yaml.map((f) => fs.readFile(path.join(theo, '.cave-notes', f), 'utf8')))).join('\n');
    expect(gone).not.toMatch(/Top\.odt/);
  });

  it('a file of this workspace is the same: its attributes go in its folder\'s page, not into the file', async () => {
    const bytes = Buffer.from([9, 8, 7, 0, 250]);
    await write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { tasks: 'kind:task', stuff: 'kind:project OR is:file' }, relations: [{ name: 'Project', from: 'tasks', to: 'stuff', attribute: 'project', backattribute: 'tasks' }] }));
    await write('Folder.md', '# Folder\n');
    for (const [k, v] of Object.entries(task('Write'))) await write(k, v);
    await fs.mkdir(path.join(root, 'Folder'), { recursive: true });
    await fs.writeFile(path.join(root, 'Folder', 'scan.pdf'), bytes);
    await svc.openWorkspace(root);
    await ready();
    expect(await svc.relationCandidates('Project', 'forward', 'scan', [])).toEqual([{ path: 'Folder/scan.pdf', title: expect.any(String) }]);
    expect(await svc.editRelation({ page: 'Write.md', relation: 'Project', side: 'forward', values: ['Folder/scan.pdf'] } as never)).toMatchObject({ ok: true });
    expect(await fs.readFile(path.join(root, 'Folder', 'scan.pdf'))).toEqual(bytes);
    expect(await read('Folder.md')).toMatch(/scan\.pdf:/);
    expect(await read('Folder.md')).toMatch(/\[\[Write\]\]/);
    expect(await read('Write.md')).toMatch(/scan\.pdf/);
  });

  it('a non-mutual relation just writes the link', async () => {
    await open({ ...task('Write') }, { backattribute: undefined, backname: undefined, reverse: 'Tasks' });
    expect(await edit({ foreign: [{ workspace: 'Theology', path: 'Projects/Plan.md' }] })).toMatchObject({ ok: true, changed: ['Write.md'] });
    expect(await read('Write.md')).toMatch(/Theology::Projects\/Plan/);
    expect(await theoRead('Projects/Plan.md')).not.toMatch(/Write/);
  });
});
