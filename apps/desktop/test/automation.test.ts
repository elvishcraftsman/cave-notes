import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { WorkspaceService } from '@cave-notes/service/service';
import type { WorkerEvents } from '../src/shared/api';

type Ev = { event: keyof WorkerEvents; payload: unknown };
let root: string;
let data: string;
let events: Ev[];
let svc: WorkspaceService;

const abs = (rel: string): string => path.join(root, ...rel.split('/'));
const write = async (rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
  await fs.writeFile(abs(rel), text);
};
const read = (rel: string): Promise<string> => fs.readFile(abs(rel), 'utf8');
const exists = (rel: string): Promise<boolean> => fs.stat(abs(rel)).then(() => true, () => false);
const front = async (rel: string): Promise<Record<string, unknown>> => (YAML.parse(((await read(rel)).match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? '') ?? {}) as Record<string, unknown>;

async function waitFor<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, what: string, ms = 10_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; events: ${JSON.stringify(events.map((e) => e.event))}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}
const eventsOf = (name: keyof WorkerEvents): Ev[] => events.filter((e) => e.event === name);
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = (): string => ymd(new Date());

/** Open the workspace and wait until the automations are running. */
async function open(files: Record<string, string>, rules: string | null): Promise<void> {
  for (const [k, v] of Object.entries(files)) await write(k, v);
  if (rules !== null) await write('.cave-notes/automations.yaml', rules);
  await svc.openWorkspace(root, { dataDir: data, deviceName: 'testbox' });
  await waitFor(() => events.find((e) => e.event === 'index:status' && (e.payload as { state: string }).state === 'ready'), 'indexing');
  if (rules !== null) await waitFor(() => eventsOf('automation:active').length > 0, 'the automations to start');
  // the automations may already have acted while starting: keep what they asked for
  events = events.filter((e) => e.event === 'automation:notify' || e.event === 'automation:shell');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-auto-'));
  data = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-auto-data-'));
  events = [];
  svc = new WorkspaceService((event, payload) => void events.push({ event, payload }), { workers: 0, watchDebounceMs: 60, moveGraceMs: 200 });
});
afterEach(async () => {
  await svc.closeWorkspace();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(data, { recursive: true, force: true });
});

const TASK = (status: string, due = '2026-10-15') => `---\nkind: task\nstatus: ${status}\ndue: ${due}\n---\n# Water plants\n`;

describe('automations on a real workspace', () => {
  it('a page deleted in the app gets a tombstone in this computer\'s device file, and is pointed out if it comes back', async () => {
    const page = '---\ntype: task\nid: k3f9q2xw7m1t0hbz\n---\n# Old\n';
    await open({ 'Tasks/Old.md': page, 'Tasks/Kept.md': '---\ntype: task\nid: abc\n---\n# Kept\n' }, `
settings: { tombstones: { where: type:task } }
rules: []
`);
    const info = await svc.deleteInfo('Tasks/Old.md');
    const cancelled = await svc.deleteInfo('Tasks/Kept.md'); // the person says no to this one
    for (const f of info.trash) await fs.rm(f, { recursive: true, force: true });
    await svc.afterDelete(info.pages);
    await svc.afterDelete(cancelled.pages);
    const devices = path.join(root, '.cave-notes', 'devices');
    const file = await waitFor(async () => (await fs.readdir(devices).catch(() => [] as string[]))[0], 'the device file');
    const doc = YAML.parse(await fs.readFile(path.join(devices, file), 'utf8')) as { buried?: Record<string, { path: string }> };
    expect(Object.keys(doc.buried ?? {})).toEqual(['k3f9q2xw7m1t0hbz']);
    expect(doc.buried?.k3f9q2xw7m1t0hbz?.path).toBe('Tasks/Old.md');

    await write('Tasks/Old.md', page); // sync brings it back
    const note = await waitFor(() => eventsOf('automation:notify')[0], 'the came-back notice');
    expect(JSON.stringify(note.payload)).toMatch(/A deleted page came back/);
  });

  it('a task marked done on disk spawns its next occurrence and is stamped', async () => {
    await open({ 'Tasks/Water.md': TASK('todo') }, `
rules:
  - id: recur
    where: kind:task
    on: { change: status, to: done }
    do:
      - set_property: { completed_at: "\${today}" }
      - create_page:
          name: "Water plants \${add(this.due, '7d')}"
          in: Tasks
          properties: { kind: task, status: todo, due: "\${add(this.due, '7d')}" }
      - set_property: { recurred_to: "\${created.path}" }
`);
    await write('Tasks/Water.md', TASK('done'));
    await waitFor(() => exists('Tasks/Water plants 2026-10-22.md'), 'the next task');
    const next = await front('Tasks/Water plants 2026-10-22.md');
    expect(String(next.due)).toContain('2026-10-22');
    expect(next.status).toBe('todo');
    await waitFor(async () => (await front('Tasks/Water.md')).recurred_to, 'the stamp');
    const old = await front('Tasks/Water.md');
    expect(old.completed_at).toBe(today());
    expect(old.recurred_to).toBe('Tasks/Water plants 2026-10-22.md');
    // the engine's own writes did not make it run again
    await new Promise((r) => setTimeout(r, 400));
    expect((await fs.readdir(abs('Tasks'))).sort()).toEqual(['Water plants 2026-10-22.md', 'Water.md']);
  });

  it('a date that has arrived produces a notification, once', async () => {
    await open({ 'Tasks/Due.md': `---\nkind: task\ndue: ${today()}\n---\n# Pay rent\n`, 'Tasks/Later.md': `---\nkind: task\ndue: 2099-01-01\n---\n# Later\n` }, `
rules:
  - id: due-today
    where: kind:task
    on: { at: due, time: "00:00" }
    do: [ { notify: { title: "Due today", body: "\${this.title}" } } ]
`);
    await waitFor(() => eventsOf('automation:notify').length > 0, 'a notification');
    expect(eventsOf('automation:notify').map((e) => (e.payload as { body: string }).body)).toEqual(['Pay rent']);
    // the rules and the log can be looked at
    const st = await svc.automationStatus();
    expect(st.enabled).toBe(true);
    expect(st.rules.map((r) => r.id)).toEqual(['due-today']);
    expect((await svc.automationLog())[0]).toMatchObject({ rule: 'due-today', status: 'done', path: 'Tasks/Due.md' });
  });

  it('"unless" with $this asks the real query engine about the page\'s children', async () => {
    await open({
      'P/Alpha.md': '---\nkind: project\nstatus: active\n---\n# Alpha\n', 'P/Alpha/T.md': '---\nstatus: doing\n---\n# t\n',
      'P/Beta.md': '---\nkind: project\nstatus: active\n---\n# Beta\n', 'P/Beta/T.md': '---\nstatus: todo\n---\n# t\n',
    }, `
rules:
  - id: stalled
    where: kind:project status:active
    unless: under:$this status:doing
    on: { schedule: "0 9 * * *" }
    do: [ { set_property: { status: blocked } } ]
`);
    const out = await svc.automationRun('stalled', { dry: false });
    expect(out.map((o) => [o.path, o.status]).sort()).toEqual([['P/Alpha.md', 'skipped'], ['P/Beta.md', 'done']]);
    expect((await front('P/Beta.md')).status).toBe('blocked');
    expect((await front('P/Alpha.md')).status).toBe('active');
  });

  it('move_file moves the page and keeps links to it working', async () => {
    await open({
      'Done.md': '---\nkind: task\nstatus: todo\n---\n# Done thing\n',
      'Index.md': '# Index\n\nSee [the thing](Done.md).\n',
    }, `
rules:
  - id: archive
    where: kind:task
    on: { change: status, to: done }
    do: [ { move_file: Archive/ } ]
`);
    await write('Done.md', '---\nkind: task\nstatus: done\n---\n# Done thing\n');
    await waitFor(() => exists('Archive/Done.md'), `the move (log: ${JSON.stringify((await svc.automationLog()).map((e) => [e.status, e.detail]))})`);
    expect(await exists('Done.md')).toBe(false);
    await waitFor(async () => (await read('Index.md')).includes('Archive/Done.md'), 'the link to be rewritten');
  });

  it('shell commands are asked of the main process and the answer is used', async () => {
    await open({ 'Posts/p.md': '---\nkind: post\nstatus: draft\n---\n# Hello\n' }, `
rules:
  - id: publish
    device: testbox
    where: kind:post
    on: { change: status, to: published }
    do:
      - run_shell:
          command: 'make deploy "$CAVE_TITLE"'
          cwd: Posts
          on_success: { set_property: { published_at: "\${today}" } }
          on_failure: { notify: failed }
`);
    await write('Posts/p.md', '---\nkind: post\nstatus: published\n---\n# Hello\n');
    const ev = await waitFor(() => eventsOf('automation:shell')[0], 'a shell request');
    const req = ev.payload as WorkerEvents['automation:shell'];
    expect(req.spec.command).toBe('make deploy "$CAVE_TITLE"');
    expect(req.spec.env.CAVE_TITLE).toBe('Hello');
    expect(req.spec.cwd).toBe('Posts');
    await svc.automationShellResult(req.id, { code: 0, stdout: 'ok' });
    await waitFor(async () => (await front('Posts/p.md')).published_at, 'the on_success action');
    expect((await front('Posts/p.md')).published_at).toBe(today());
  });

  it('a button runs a rule that lists "button", for its own page, and says why when it cannot', async () => {
    await open({ 'Tasks/Water.md': TASK('todo'), 'Notes/Idea.md': '# Idea\\n' }, `
rules:
  - id: finish
    where: kind:task -status:done
    on: button
    do: [ { set_property: { status: done } } ]
  - id: passive
    where: kind:task
    on: { change: status, to: blocked }
    do: [ { set_property: { seen: true } } ]
`);
    const done = await svc.automationButton('finish', 'Tasks/Water.md');
    expect(done.status).toBe('done');
    expect((await front('Tasks/Water.md')).status).toBe('done');
    expect((await svc.automationButton('finish', 'Tasks/Water.md')).status).toBe('skipped');
    expect((await svc.automationButton('finish', 'Notes/Idea.md')).status).toBe('skipped');
    const no = await svc.automationButton('passive', 'Tasks/Water.md');
    expect([no.status, /on: button/.test(no.detail)]).toEqual(['refused', true]);
    expect((await svc.automationButton('missing', 'Tasks/Water.md')).status).toBe('refused');
  });

  it('a button in a workspace with no automations is refused, not an error', async () => {
    await open({ 'A.md': '# A\\n' }, null);
    expect((await svc.automationButton('x', 'A.md')).status).toBe('refused');
  });

  it('editing the rules file takes effect without reopening', async () => {
    await open({ 'A.md': TASK('todo') }, `rules: []\n`);
    await write('.cave-notes/automations.yaml', `
rules:
  - id: ping
    on: { change: status, to: done }
    do: [ { notify: hi } ]
`);
    await waitFor(async () => (await svc.automationStatus()).rules.length === 1, 'the new rules');
    await write('A.md', TASK('done'));
    await waitFor(() => eventsOf('automation:notify').length > 0, 'a notification from the new rule');
  });

  it('a workspace with no automations file costs nothing and reports so', async () => {
    await open({ 'A.md': '# A\n' }, null);
    expect((await svc.automationStatus()).enabled).toBe(false);
    expect(eventsOf('automation:active')).toHaveLength(0);
    await expect(svc.automationRun('x')).rejects.toThrow(/no automation rules/);
  });

  it('stale pages are found by their real modification time (mtime:)', async () => {
    await write('Inbox/Old.md', '---\nstatus: inbox\n---\n# Old\n');
    await write('Inbox/Fresh.md', '---\nstatus: inbox\n---\n# Fresh\n');
    const old = new Date(Date.now() - 10 * 86_400_000);
    await fs.utimes(abs('Inbox/Old.md'), old, old);
    await open({}, `
rules:
  - id: stale-inbox
    where: under:"Inbox" mtime:<$now.day-3 -has:stale
    on: { schedule: "0 7 * * *" }
    do: [ { set_property: { stale: true } } ]
`);
    const out = await svc.automationRun('stale-inbox', { dry: false });
    expect(out.map((o) => [o.path, o.status])).toEqual([['Inbox/Old.md', 'done']]);
    expect((await front('Inbox/Old.md')).stale).toBe(true);
    expect((await front('Inbox/Fresh.md')).stale).toBeUndefined();
    // flagged once: the next look finds nothing more
    expect(await svc.automationRun('stale-inbox', { dry: true })).toEqual([]);
  });

  it('the device file of this computer is written for the others to read', async () => {
    await open({ 'Tasks/Water.md': TASK('todo') }, `
rules:
  - id: r
    on: { change: status, to: done }
    where: kind:task
    do: [ { set_property: { seen: true } } ]
`);
    await write('Tasks/Water.md', TASK('done'));
    await waitFor(async () => (await front('Tasks/Water.md')).seen, 'the rule');
    const doc = await waitFor(async () => {
      const names = await fs.readdir(abs('.cave-notes/devices')).catch(() => [] as string[]);
      if (names.length === 0) return undefined;
      const d = YAML.parse(await read(`.cave-notes/devices/${names[0]}`)) as { id: string; name: string; fired: Record<string, number> };
      return Object.keys(d.fired ?? {}).some((k) => k.startsWith('r|Tasks/Water.md|change')) ? d : undefined;
    }, 'this computer\'s device file to list what it did');
    expect(doc.name).toBe('testbox');
  });

  it('JavaScript in a rule waits for the main process to allow it, then runs in the sandbox; a refusal stops it', async () => {
    await open({ 'N.md': '# N\n' }, `
rules:
  - id: count
    on: { plugin: "Count" }
    do:
      - run_js:
          code: |
            return { text: text + String(cursor.line), cursor: 0 };
`);
    const run = svc.automationPlugin('count', 'N.md', 'x\ny', false, {}, 3);
    const ev = await waitFor(() => eventsOf('automation:js')[0], 'a JavaScript request');
    const req = ev.payload as WorkerEvents['automation:js'];
    expect(req.ruleId).toBe('count');
    expect(req.code).toContain('cursor.line');
    await svc.automationJsResult(req.id, { allowed: true });
    const res = await run;
    expect(res.status).toBe('done');
    expect(res.text).toBe('x\ny2');
    expect(res.selection).toEqual({ anchor: 0, head: 0 });

    events = [];
    const refused = svc.automationPlugin('count', 'N.md', 'x', false, {}, 0);
    const ev2 = await waitFor(() => eventsOf('automation:js')[0], 'a second request');
    await svc.automationJsResult((ev2.payload as WorkerEvents['automation:js']).id, { allowed: false, reason: 'JavaScript in rules is switched off in Preferences' });
    const r2 = await refused;
    expect(r2.status).toBe('failed');
    expect(r2.detail).toMatch(/switched off in Preferences/);
    expect(r2.text).toBe('x');
  });

  describe('a rule that installs rules', () => {
    const INSTALL = `
rules:
  - id: setup
    on: { plugin: "Set up" }
    do:
      - install_automations:
          file: extra.yaml
          owner: demo
          content: |
            rules:
              - id: from-extra
                on: button
                do:
                  - run_js: { code: "return { props: { a: 1 } };" }
      - create_page: { name: Made, in: N }
  - id: undo
    on: { plugin: "Undo setup" }
    do:
      - install_automations: { file: extra.yaml, owner: demo, remove: true }
`;

    it('asks the person, shows what the rules can do, and writes the file only when allowed', async () => {
      await open({ 'N.md': '# N\n' }, INSTALL);
      const run = svc.automationPlugin('setup', 'N.md', '', false, {});
      const ev = await waitFor(() => eventsOf('automation:rules')[0], 'the question about changing automations');
      const req = ev.payload as WorkerEvents['automation:rules'];
      expect(req).toMatchObject({ ruleId: 'setup', file: 'extra.yaml', remove: false, created: true });
      expect(req.summary).toMatchObject({ js: true, shell: false, installs: false });
      expect(req.summary.rules.map((r) => r.id)).toEqual(['from-extra']);
      expect(req.content).toContain('# installed by "demo"');
      expect(await exists('.cave-notes/plugins/extra.yaml')).toBe(false); // nothing is written before the answer
      await svc.automationRulesResult(req.id, { allowed: true });
      const res = await run;
      expect(res.status).toBe('done');
      const file = await read('.cave-notes/plugins/extra.yaml');
      expect(file.split('\n')[0]).toBe('# installed by "demo"');
      expect(file).toContain('- id: from-extra');
      expect(await exists('N/Made.md')).toBe(true);

      // already installed exactly like that: nothing is asked
      events = [];
      const again = await svc.automationPlugin('setup', 'N.md', '', false, {});
      expect(again.status).not.toBe('failed');
      expect(eventsOf('automation:rules')).toHaveLength(0);
    });

    it('a refusal writes nothing, and the rest of the rule does not happen', async () => {
      await open({ 'N.md': '# N\n' }, INSTALL);
      const run = svc.automationPlugin('setup', 'N.md', '', false, {});
      const ev = await waitFor(() => eventsOf('automation:rules')[0], 'the question');
      await svc.automationRulesResult((ev.payload as WorkerEvents['automation:rules']).id, { allowed: false, reason: 'you did not allow it' });
      const res = await run;
      expect(res.status).toBe('failed');
      expect(res.detail).toMatch(/you did not allow it/);
      expect(await exists('.cave-notes/plugins/extra.yaml')).toBe(false);
      expect(await exists('N/Made.md')).toBe(false);
    });

    it('never touches a file that is not its own', async () => {
      await write('.cave-notes/plugins/extra.yaml', 'rules: []\n');
      await open({ 'N.md': '# N\n' }, INSTALL);
      const res = await svc.automationPlugin('setup', 'N.md', '', false, {});
      expect(res.status).toBe('failed');
      expect(res.detail).toMatch(/a file of yours/);
      expect(eventsOf('automation:rules')).toHaveLength(0);
      expect(await read('.cave-notes/plugins/extra.yaml')).toBe('rules: []\n');
    });

    it('another rule with the same owner can remove it, after asking', async () => {
      await open({ 'N.md': '# N\n' }, INSTALL);
      const first = svc.automationPlugin('setup', 'N.md', '', false, {});
      const a = await waitFor(() => eventsOf('automation:rules')[0], 'the first question');
      await svc.automationRulesResult((a.payload as WorkerEvents['automation:rules']).id, { allowed: true });
      await first;
      events = [];
      const gone = svc.automationPlugin('undo', 'N.md', '', false, {});
      const b = await waitFor(() => eventsOf('automation:rules')[0], 'the second question');
      expect((b.payload as WorkerEvents['automation:rules']).remove).toBe(true);
      await svc.automationRulesResult((b.payload as WorkerEvents['automation:rules']).id, { allowed: true });
      expect((await gone).status).toBe('done');
      expect(await exists('.cave-notes/plugins/extra.yaml')).toBe(false);
    });

    it('a button asks its questions first, and the answers reach the rule', async () => {
      await open({ 'N.md': '---\nkind: thing\n---\n# N\n' }, `
rules:
  - id: ask-me
    name: Ask me
    where: kind:thing
    on: button
    ask:
      hello: { type: info, label: "Page \${this.title}" }
      n: { type: number, label: How many, default: 3 }
    do:
      - set_property: { field: got, value: "\${ask.n * 2}" }
`);
      const q = await svc.automationButtonAsk('ask-me', 'N.md');
      expect(q.title).toBe('Ask me');
      expect(q.ask.map((x) => [x.name, x.label])).toEqual([['hello', 'Page N'], ['n', 'How many']]);
      const res = await svc.automationButton('ask-me', 'N.md', { n: 21 });
      expect(res.status).toBe('done');
      expect((await front('N.md')).got).toBe(42);
    });
  });
});
