import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { readConfig, effectiveSections } from '@cave-notes/core-index/config';
import { fillPath, fillSetup, listInstalled, packageFromPlain, parsePackage, planInstall, planUpdate, writeUpdate, removeInstalled, writeInstall, type ExistingNames, type PluginPackage } from '../src/plugins';
import { findTemplate, listTemplates } from '../src/templates';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cn-plugin-'));
const enc = new TextEncoder();
const pack = (files: Record<string, string>): Record<string, Uint8Array> => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)]));

const MANIFEST = `plugin:
  id: cash-collection
  name: Cash Collection
  version: 1.0.0
  description: Reconcile the tills and record each deposit.
  author: Brechbill Tools
setup:
  folder:     { type: text,   label: "Put the pages under", default: "Cash" }
  safe_start: { type: number, label: "Bills in the safe", default: 0 }
  company:    { type: text, label: "Company", default: "Acme" }
automations:
  - automations/cash.yaml
definitions:
  - definitions/cash.yaml
export-styles:
  - styles/letterhead.yaml
templates:
  - path: templates/Cash Collection.md
    managed: true
  - path: templates/Cash Record.md
    hidden: true
pages:
  - from: Cash Collection
    path: "{{setup.folder}}/Cash Collection"
    open: true
assets:
  - assets/
`;
const FILES: Record<string, string> = {
  'plugin.yaml': MANIFEST,
  'README.md': '# Cash\n',
  'automations/cash.yaml': `rules:
  - id: record-deposit
    name: Record the deposit
    on: { button: record }
    do:
      - create_page: { in: "{{setup.folder}}/Cash Records", template: Cash Record, title: "Deposit \${today}" }
  - id: weekly
    name: Weekly summary
    on: { schedule: { weekly: monday } }
    do:
      - notify: "hello"
`,
  'definitions/cash.yaml': `schema:
  amount: { type: number }
queries:
  Unbalanced days: kind:cash-day
`,
  'styles/letterhead.yaml': `Letterhead:
  header: {{setup.company}}
`,
  'templates/Cash Collection.md': `---
safe_previous: {{setup.safe_start}}
total: \${=sum(this.till)}
exportStyle: Letterhead
---
# {{title}}

Company {{setup.company}}
`,
  'templates/Cash Record.md': `---
kind: cash-record
---
# {{title}}
`,
  'assets/logo.png': 'PNG',
};

const none = (over: Partial<ExistingNames> = {}): ExistingNames => ({ styles: new Set(), templates: new Set(), queries: new Set(), folders: new Map(), pageTaken: () => false, ...over });
const read = (files: Record<string, string>, extra = {}): PluginPackage => {
  const r = parsePackage(pack(files), extra);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.plugin;
};

describe('reading a package', () => {
  it('accepts a valid one and counts what is in it', () => {
    const p = read(FILES);
    expect(p.manifest.templates.map((t) => [t.name, t.managed, t.hidden])).toEqual([['Cash Collection', true, false], ['Cash Record', false, true]]);
    expect(p.manifest.setup.map((q) => q.name)).toEqual(['folder', 'safe_start', 'company']);
  });

  it('refuses unsafe paths, missing files and a missing manifest', () => {
    expect(parsePackage(pack({ ...FILES, '../x.txt': 'x' })).ok).toBe(false);
    expect(parsePackage(pack({ 'automations/x.yaml': 'rules: []' })).ok).toBe(false);
    const r = parsePackage(pack({ ...FILES, 'plugin.yaml': MANIFEST.replace('automations/cash.yaml', 'automations/nope.yaml') }));
    expect(r.ok === false && r.errors.join()).toContain('automations/nope.yaml');
  });

  it('refuses an automations file with a schema: section and a definitions file with rules:, naming the section', () => {
    const a = parsePackage(pack({ ...FILES, 'automations/cash.yaml': `${FILES['automations/cash.yaml']}schema:\n  x: { type: text }\n` }));
    expect(a.ok === false && a.errors.join()).toMatch(/automations\/cash\.yaml.*schema/);
    const d = parsePackage(pack({ ...FILES, 'definitions/cash.yaml': `${FILES['definitions/cash.yaml']}rules: []\n` }));
    expect(d.ok === false && d.errors.join()).toMatch(/definitions\/cash\.yaml.*rules/);
  });

  it('refuses {{setup.typo}} and a page from a template that is not there, and a plugin that needs a newer app', () => {
    const t = parsePackage(pack({ ...FILES, 'templates/Cash Record.md': 'Hello {{setup.typo}}\n' }));
    expect(t.ok === false && t.errors.join()).toMatch(/Cash Record\.md line 1.*typo/);
    expect(parsePackage(pack({ ...FILES, 'plugin.yaml': MANIFEST.replace('from: Cash Collection', 'from: Nothing') })).ok).toBe(false);
    const v = parsePackage(pack({ ...FILES, 'plugin.yaml': MANIFEST.replace('author:', 'minAppVersion: 9.0.0\n  author:') }), { appVersion: '0.20.0' });
    expect(v.ok === false && v.errors.join()).toContain('9.0.0');
  });
});

describe('setup values', () => {
  const values = { company: 'A: B # "q" \'s\nline 2', n: 1022, folder: 'Cash' };
  it('are filled into YAML that stays valid and means the same', () => {
    for (const form of ['header: {{setup.company}}', 'header: "{{setup.company}}"', "header: '{{setup.company}}'", 'header: Dear {{setup.company}} team']) {
      const out = fillSetup('a.yaml', `${form}\nother: \${=this.x}\n`, values);
      const doc = YAML.parse(out) as Record<string, unknown>;
      expect(String(doc.header)).toContain(values.company);
      expect(doc.other).toBe('${=this.x}');
    }
  });
  it('are numbers where an answer is a number filling a whole value, and text inside a longer one', () => {
    expect(YAML.parse(fillSetup('a.yaml', 'a: {{setup.n}}\nb: "{{setup.n}}"\nc: n={{setup.n}}\n', values))).toEqual({ a: 1022, b: 1022, c: 'n=1022' });
  });
  it('leave ${…}, {{title}} and {{date}} alone, in YAML, in frontmatter and in text', () => {
    const md = '---\nx: {{setup.n}}\ny: "{{title}}"\nz: ${=this.q}\n---\nHello {{title}} {{date}} {{setup.folder}} ${=this.q}\n';
    const out = fillSetup('t.md', md, values);
    expect(out).toContain('{{title}} {{date}} Cash ${=this.q}');
    expect(out).toContain('{{title}}');
    expect(YAML.parse(out.split('---')[1]!)).toEqual({ x: 1022, y: '{{title}}', z: '${=this.q}' });
  });
  it('make a page path of one clean segment per answer', () => {
    expect(fillPath('{{setup.folder}}/Cash Collection', { folder: '../a/b' })).toBe('-a-b/Cash Collection');
    expect(fillPath('{{setup.folder}}/X', { folder: '.hidden' })).toBe('hidden/X');
  });
});

describe('planning and writing an install', () => {
  it('lists what it adds, what it can do, and the starter page with its pluginPage id', () => {
    const plan = planInstall(read(FILES), { scope: 'workspace', answers: { folder: 'Tills', safe_start: 1022 }, existing: none() });
    expect(plan.folder).toBe('Cash Collection');
    expect(plan.pages).toEqual([{ template: 'Cash Collection', path: 'Tills/Cash Collection', open: true, pageId: 'cash-collection/cash-collection-1', managed: true }]);
    expect(plan.adds.join('\n')).toMatch(/1 page: Tills\/Cash Collection/);
    expect(plan.adds.join('\n')).toMatch(/2 automations/);
    expect(plan.adds.join('\n')).toMatch(/used only by its automations/);
    expect(plan.can.map((c) => c.kind)).toEqual(expect.arrayContaining(['changes-pages', 'runs-on-its-own', 'changes-definitions']));
    const tpl = new TextDecoder().decode(plan.files.find((f) => f.rel === 'templates/Cash Collection.md')!.data);
    expect(tpl).toContain('safe_previous: 1022');
    expect(tpl).toContain('plugin: cash-collection');
    expect(tpl).toContain('managed: true');
  });

  it('says it only adds content when it does nothing else', () => {
    const f = { ...FILES, 'plugin.yaml': MANIFEST.replace(/automations:\n  - automations\/cash.yaml\n/, '').replace(/definitions:\n  - definitions\/cash.yaml\n/, ''), };
    delete (f as Record<string, string>)['automations/cash.yaml'];
    delete (f as Record<string, string>)['definitions/cash.yaml'];
    expect(planInstall(read(f), { scope: 'workspace', existing: none() }).can.map((c) => c.kind)).toEqual(['content-only']);
  });

  it('keeps both on a clash, renaming the plugin’s style, template and query and what refers to them inside the plugin', () => {
    const plan = planInstall(read(FILES), {
      scope: 'workspace',
      existing: none({ styles: new Set(['letterhead']), templates: new Set(['cash collection']), queries: new Set(['unbalanced days']) }),
    });
    expect(plan.conflicts.map((c) => [c.kind, c.becomes])).toEqual([
      ['template', 'Cash Collection (Cash Collection)'],
      ['export-style', 'Letterhead (Cash Collection)'],
      ['query', 'Unbalanced days (Cash Collection)'],
    ]);
    const get = (rel: string): string => new TextDecoder().decode(plan.files.find((f) => f.rel === rel)!.data);
    expect(get('templates/Cash Collection (Cash Collection).md')).toContain('exportStyle: Letterhead (Cash Collection)');
    expect(get('styles/letterhead.yaml')).toContain('Letterhead (Cash Collection):');
    expect(get('definitions/cash.yaml')).toContain('Unbalanced days (Cash Collection):');
    expect(plan.pages[0]!.template).toBe('Cash Collection (Cash Collection)');
  });

  it('adds to a schema the workspace already has, and makes a taken page as “Name 2”', () => {
    const plan = planInstall(read(FILES), { scope: 'workspace', existing: { ...none({ pageTaken: (p) => p === 'Cash/Cash Collection' }), schema: new Set(['amount']) } as ExistingNames });
    expect(plan.conflicts.map((c) => [c.kind, c.resolution])).toEqual(expect.arrayContaining([['schema', 'add-to-it'], ['page', 'make-as']]));
    expect(plan.pages[0]!.path).toBe('Cash/Cash Collection 2');
  });

  it('writes one folder with a record, and the workspace then reads it: automations, definitions, styles, templates', async () => {
    const ws = tmp();
    const dir = path.join(ws, '.cave-notes');
    const plan = planInstall(read(FILES), { scope: 'workspace', answers: { folder: 'Tills', safe_start: 7 }, existing: none() });
    await writeInstall(dir, plan);
    const folder = path.join(dir, 'plugins', 'Cash Collection');
    expect(fs.existsSync(path.join(folder, '.installed.json'))).toBe(true);
    expect(fs.readFileSync(path.join(folder, 'automations/cash.yaml'), 'utf8').startsWith('# installed by "plugin:cash-collection"\n')).toBe(true);
    expect(fs.existsSync(path.join(folder, 'assets/logo.png'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'base/templates/Cash Collection.md'))).toBe(true);
    const eff = effectiveSections(await readConfig(dir));
    expect(eff.sections.rules.map((r: { id: string }) => r.id)).toEqual(['record-deposit', 'weekly']);
    expect(Object.keys(eff.sections.schema)).toEqual(['amount']);
    expect(Object.keys(eff.sections.queries)).toEqual(['Unbalanced days']);
    expect(Object.keys(eff.sections['export-style'])).toEqual(['Letterhead']);
    // templates: the visible one is offered, the hidden one only to automations
    expect((await listTemplates(ws, null)).map((t) => [t.name, t.plugin])).toEqual([['Cash Collection', 'Cash Collection']]);
    expect((await findTemplate(ws, null, 'Cash Record'))!.hidden).toBe(true);
    expect((await listInstalled(dir)).map((i) => i.record.plugin)).toEqual(['cash-collection']);
    await removeInstalled(dir, 'Cash Collection');
    expect(await listInstalled(dir)).toEqual([]);
  });

  it('leaves nothing behind when a write fails midway', async () => {
    const dir = path.join(tmp(), '.cave-notes');
    const plan = planInstall(read(FILES), { scope: 'workspace', existing: none() });
    await expect(writeInstall(dir, plan, { failAfter: 3 })).rejects.toThrow('simulated');
    expect(fs.readdirSync(path.join(dir, 'plugins'))).toEqual([]);
    expect((await readConfig(dir)).files).toEqual([]);
  });

  it('makes the folder “Name 2” when a different plugin has the name', () => {
    const plan = planInstall(read(FILES), { scope: 'app', existing: none({ folders: new Map([['Cash Collection', 'other']]) }) });
    expect(plan.folder).toBe('Cash Collection 2');
    expect(() => planInstall(read(FILES), { scope: 'app', existing: none({ folders: new Map([['Cash Collection', 'cash-collection']]) }) })).toThrow(/already installed/);
  });
});

describe('plain files made into a package', () => {
  const item = (name: string, body: string): { name: string; data: Uint8Array } => ({ name, data: enc.encode(body) });
  it('splits a YAML file by what its sections are for, takes bare styles and notes as templates, and installs like any plugin', () => {
    const r = packageFromPlain(
      [
        item('mine.yaml', 'rules: !global\n  - id: a\n    name: A\n    on: { plugin: A }\n    do: [ { log: hi } ]\nschema:\n  amount: { type: number }\n'),
        item('look.yaml', 'Letterhead:\n  units: cm\n'),
        item('Meeting.md', '# {{title}}\n'),
        item('notes.txt.bak', 'x'),
      ],
      'My things',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.files).sort()).toEqual(['automations/mine.yaml', 'definitions/mine.yaml', 'plugin.yaml', 'styles/look.yaml', 'templates/Meeting.md']);
    const parsed = parsePackage(r.files);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plugin.manifest.id).toBe('file-my-things');
    const plan = planInstall(parsed.plugin, { scope: 'workspace', existing: none() });
    expect(plan.adds.join('\n')).toMatch(/1 automation.*1 file of definitions.*1 template.*1 export style/s);
    // the shared tags were dropped by the split; the scope decides about sharing
    expect(new TextDecoder().decode(r.files['automations/mine.yaml'])).not.toContain('!global');
  });
  it('says so when there is nothing it can use', () => {
    const r = packageFromPlain([item('x.png', 'x')], 'X');
    expect(r.ok).toBe(false);
  });
  it('shared scope tags each section with !global in what it writes', () => {
    const plan = planInstall(read(FILES), { scope: 'shared', existing: none() });
    const get = (rel: string): string => new TextDecoder().decode(plan.files.find((f) => f.rel === rel)!.data);
    expect(get('automations/cash.yaml')).toContain('rules: !global');
    expect(get('definitions/cash.yaml')).toContain('schema: !global');
    expect(get('styles/letterhead.yaml')).toContain('export-style: !global');
  });
});

describe('updating an installed plugin', () => {
  const V2 = {
    ...FILES,
    'plugin.yaml': MANIFEST.replace('version: 1.0.0', 'version: 1.1.0').replace('  - path: templates/Cash Record.md\n    hidden: true\n', '  - path: templates/Cash Record.md\n    hidden: true\n  - path: templates/Cash Report.md\n').replace('export-styles:\n  - styles/letterhead.yaml\n', ''),
    'automations/cash.yaml': `${FILES['automations/cash.yaml']}  - id: extra\n    name: Extra\n    on: { menu: Extra }\n    do: [ { log: hi } ]\n`,
    'definitions/cash.yaml': `schema:\n  amount: { type: number }\n  tendered: { type: number }\nqueries:\n  Unbalanced days: kind:cash-day\n`,
    'templates/Cash Report.md': '# {{title}}\n',
  };
  delete (V2 as Record<string, string>)['styles/letterhead.yaml'];
  const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

  const install = async (existing: ExistingNames = none()): Promise<{ dir: string; folder: string }> => {
    const dir = path.join(tmp(), '.cave-notes');
    const plan = planInstall(read(FILES), { scope: 'workspace', answers: { folder: 'Tills' }, existing });
    await writeInstall(dir, plan);
    return { dir, folder: plan.folder };
  };
  const inst = async (dir: string): Promise<Parameters<typeof planUpdate>[1]> => ({ ...(await listInstalled(dir))[0]!, settingsDir: dir });

  it('replaces what was not edited, keeps what was, adds what is new and drops what the plugin dropped', async () => {
    const { dir, folder } = await install();
    const root = path.join(dir, 'plugins', folder);
    // the person edits the automations file and deletes nothing else
    fs.appendFileSync(path.join(root, 'automations/cash.yaml'), '# my note\n');
    const up = await planUpdate(read(V2), await inst(dir), { existing: none() });
    expect(up.direction).toBe('upgrade');
    expect(up.kept).toEqual(['automations/cash.yaml']);
    expect(up.replaced.sort()).toEqual(['definitions/cash.yaml']);
    expect(up.added).toEqual(['templates/Cash Report.md']);
    expect(up.removed).toEqual(['styles/letterhead.yaml']);
    await writeUpdate(dir, folder, up);
    expect(fs.readFileSync(path.join(root, 'automations/cash.yaml'), 'utf8')).toContain('# my note');
    expect(fs.readFileSync(path.join(root, 'automations/cash.yaml'), 'utf8')).not.toContain('id: extra');
    expect(fs.readFileSync(path.join(root, 'base/automations/cash.yaml'), 'utf8')).toContain('id: extra');
    expect(fs.readFileSync(path.join(root, 'definitions/cash.yaml'), 'utf8')).toContain('tendered');
    expect(fs.existsSync(path.join(root, 'styles/letterhead.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'templates/Cash Report.md'))).toBe(true);
    const rec = (await listInstalled(dir))[0]!.record;
    expect(rec.version).toBe('1.1.0');
    expect(rec.setup.folder).toBe('Tills');
    expect(rec.pages).toHaveLength(1);
    // the next update still sees the edit as an edit
    const again = await planUpdate(read({ ...V2, 'plugin.yaml': V2['plugin.yaml'].replace('1.1.0', '1.2.0'), 'automations/cash.yaml': `${V2['automations/cash.yaml']}# v3\n` }), await inst(dir), { existing: none() });
    expect(again.kept).toEqual(['automations/cash.yaml']);
  });

  it('replaces an automations file nobody edited (it is written with an owner line, which is part of its fingerprint)', async () => {
    const { dir, folder } = await install();
    const up = await planUpdate(read(V2), await inst(dir), { existing: none() });
    expect(up.replaced).toContain('automations/cash.yaml');
    expect(up.kept).toEqual([]);
    await writeUpdate(dir, folder, up);
    expect(fs.readFileSync(path.join(dir, 'plugins', folder, 'automations/cash.yaml'), 'utf8')).toContain('id: extra');
  });

  it('leaves what the person deleted deleted, and reports going back or adding the same version', async () => {
    const { dir, folder } = await install();
    fs.rmSync(path.join(dir, 'plugins', folder, 'definitions/cash.yaml'));
    const up = await planUpdate(read(V2), await inst(dir), { existing: none() });
    expect(up.left).toContain('definitions/cash.yaml');
    expect(up.writes.some((w) => w.rel === 'definitions/cash.yaml')).toBe(false);
    expect((await planUpdate(read(FILES), await inst(dir), { existing: none() })).direction).toBe('same');
    await writeUpdate(dir, folder, up);
    expect((await planUpdate(read(FILES), await inst(dir), { existing: none() })).direction).toBe('older');
  });

  it('keeps the names it was given when something else had its own', async () => {
    const taken = none({ styles: new Set(['letterhead']), templates: new Set(['cash collection']) });
    const { dir, folder } = await install(taken);
    const v2 = { ...FILES, 'plugin.yaml': MANIFEST.replace('1.0.0', '1.0.1') };
    // while updating, the plugin's own renamed items are not taken by "themselves"
    const own = none({ styles: new Set(['letterhead', 'letterhead (cash collection)']), templates: new Set(['cash collection', 'cash collection (cash collection)']) });
    const up = await planUpdate(read(v2), await inst(dir), { existing: own });
    expect(up.plan.conflicts).toEqual([]);
    expect(up.plan.files.some((f) => f.rel === 'templates/Cash Collection (Cash Collection).md')).toBe(true);
    await writeUpdate(dir, folder, up);
    expect(fs.existsSync(path.join(dir, 'plugins', folder, 'templates/Cash Collection (Cash Collection).md'))).toBe(true);
  });

  it('puts everything back when the update fails midway', async () => {
    const { dir, folder } = await install();
    const root = path.join(dir, 'plugins', folder);
    const snapshot = (): Record<string, string> => Object.fromEntries(['automations/cash.yaml', 'definitions/cash.yaml', 'styles/letterhead.yaml', '.installed.json'].map((r) => [r, fs.readFileSync(path.join(root, r), 'utf8')]));
    const before = snapshot();
    const up = await planUpdate(read(V2), await inst(dir), { existing: none() });
    await expect(writeUpdate(dir, folder, up, { failAfter: 4 })).rejects.toThrow('simulated');
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(root, 'templates/Cash Report.md'))).toBe(false);
    void dec;
  });
});
