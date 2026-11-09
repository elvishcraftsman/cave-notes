import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WorkspaceService } from '@cave-notes/service/service';

let dir: string;
let svc: WorkspaceService;

const write = async (rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, 'ws', rel)), { recursive: true });
  await fs.writeFile(path.join(dir, 'ws', rel), text);
};
const attr = async (page: string, key: string): Promise<string | undefined> => {
  const info = await svc.pageInfo(page);
  return info?.attributes[key]?.map((e) => e.text).join('|');
};
/** formulas are worked out after indexing: wait until a value is there */
const until = async (f: () => Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cave-formula-'));
  await write('Budget.md', '---\ntotal: ${sum("under:$this", "cost")}\nhow_many: ${count("under:$this")}\nbiggest: ${max("under:$this", "cost")}\nsmallest: ${min("under:$this", "cost")}\naverage: ${round(avg("under:$this", "cost"), 2)}\nlabel: ${"Total " + fixed(this.total, 2)}\ntitles: ${titles("under:$this")}\n---\n# Budget\n');
  await write('Budget/Rent.md', '---\ncost: 1000\n---\n# Rent\n');
  await write('Budget/Food.md', '---\ncost: 350.5\n---\n# Food\n');
  await write('Budget/Misc.md', '---\ncost: 49.5\n---\n# Misc\n');
  svc = new WorkspaceService(() => {}, { workers: 0 });
  await svc.openWorkspace(path.join(dir, 'ws'), { dataDir: path.join(dir, 'data') });
  await until(async () => (await attr('Budget.md', 'label')) === 'Total 1400.00');
});
afterAll(async () => {
  await svc.closeWorkspace();
  await fs.rm(dir, { recursive: true, force: true });
});

it('an attribute written as a formula holds what it comes to', async () => {
  expect(await attr('Budget.md', 'total')).toBe('1400');
  expect(await attr('Budget.md', 'how_many')).toBe('3');
  expect(await attr('Budget.md', 'biggest')).toBe('1000');
  expect(await attr('Budget.md', 'smallest')).toBe('49.5');
  expect(await attr('Budget.md', 'average')).toBe('466.67');
  expect(await attr('Budget.md', 'label')).toBe('Total 1400.00'); // a formula that reads another formula
});

it('the result is a number the queries can use, and a list stays a list', async () => {
  const r = await svc.queryView('total:>1000', ['total'], 10, 0, []);
  expect(r.rows.map((x) => x.path)).toEqual(['Budget.md']);
  expect((await svc.pageInfo('Budget.md'))?.attributes.titles?.map((e) => e.text).sort()).toEqual(['Food', 'Misc', 'Rent']);
});

it('follows the pages: a new cost changes the total', async () => {
  await write('Budget/Fun.md', '---\ncost: 100\n---\n# Fun\n');
  await svc.refreshIndex();
  await until(async () => (await attr('Budget.md', 'total')) === '1500');
  expect(await attr('Budget.md', 'total')).toBe('1500');
  expect(await attr('Budget.md', 'how_many')).toBe('4');
});

it('works out an expression written in the text of a page', async () => {
  const sum = await svc.evaluateExpression('Budget.md', 'sum("under:$this", "cost") * 2');
  expect(sum).toMatchObject({ ok: true, text: '3000', kind: 'number' });
  expect(await svc.evaluateExpression(null, 'count("under:Budget")')).toMatchObject({ ok: true, text: '4' });
  expect(await svc.evaluateExpression('Budget/Rent.md', '[[Budget]].total - this.cost')).toMatchObject({ ok: true, text: '500' });
  expect(await svc.evaluateExpression('Budget.md', 'percent(this.total, 3000)')).toMatchObject({ ok: true, text: '50' });
  expect(await svc.evaluateExpression('Budget.md', 'join(sort(values("under:$this", "cost")), " < ")')).toMatchObject({ ok: true, text: '49.5 < 100 < 350.5 < 1000' });
});

it('says what is wrong instead of failing silently', async () => {
  expect(await svc.evaluateExpression('Budget.md', 'sum(query, "cost")')).toMatchObject({ ok: false });
  expect(await svc.evaluateExpression('Budget.md', '[[Nowhere]].x')).toMatchObject({ ok: false, error: expect.stringContaining('Nowhere') });
  expect(await svc.evaluateExpression('Budget.md', '1 +')).toMatchObject({ ok: false });
});

it('a formula handed down in a children: block is worked out for every sub-page', async () => {
  await write('Tasks.md', '---\nchildren:\n  doubled: ${this.n * 2}\n---\n# Tasks\n');
  await write('Tasks/One.md', '---\nn: 4\n---\n# One\n');
  await write('Tasks/Two.md', '---\nn: 10\n---\n# Two\n');
  await svc.refreshIndex();
  await until(async () => (await attr('Tasks/Two.md', 'doubled')) === '20');
  expect(await attr('Tasks/One.md', 'doubled')).toBe('8');
  expect(await attr('Tasks/Two.md', 'doubled')).toBe('20');
});

it('a formula that cannot be worked out keeps its text and is reported', async () => {
  await write('Broken.md', '---\nx: ${1 +}\n---\n# Broken\n');
  await svc.refreshIndex();
  await until(async () => (await attr('Broken.md', 'x')) !== undefined);
  expect(await attr('Broken.md', 'x')).toBe('${1 +}');
});
