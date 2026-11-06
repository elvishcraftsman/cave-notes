import test from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../src/index.js';
import { expandSaved, normalizeQueries, normalizeRelations } from '../src/saved.js';
import { tmpRoot, ws, paths } from './helpers.js';

test('saved queries are read from workspace.yaml, in either form, and mistakes are reported', () => {
  const q = normalizeQueries({ 'open-tasks': 'status:todo', Projects: { query: 'kind:project', title: 'All projects' }, bad: 5, 'OPEN-TASKS': 'x' });
  assert.deepEqual(q.queries, [
    { name: 'open-tasks', query: 'status:todo' },
    { name: 'Projects', query: 'kind:project', title: 'All projects' },
  ]);
  assert.equal(q.problems.length, 2);
  assert.equal(normalizeQueries([]).problems.length, 1);
  const r = normalizeRelations(
    [
      { name: 'Project', from: 'open-tasks', attribute: 'project', to: 'Projects', reverse: 'Tasks' },
      { from: 'nope', attribute: 'x', to: 'Projects' },
      { from: 'open-tasks', attribute: 'x' },
      { name: 'tasks', from: 'open-tasks', attribute: 'y', to: 'Projects' },
    ],
    q.queries,
  );
  assert.deepEqual(r.relations, [{ name: 'Project', reverse: 'Tasks', from: 'open-tasks', to: 'Projects', attribute: 'project', multiple: true }]);
  assert.equal(r.problems.length, 3);
});

test('saved:name is replaced by the saved text, nested, with the rest of the query kept', () => {
  const by = new Map([['a', 'status:todo saved:b'], ['b', 'tags:x'], ['loop', 'saved:loop'], ['my tasks', 'kind:task']]);
  const errors = [];
  assert.equal(expandSaved('grace saved:a sort:due', by, errors), 'grace status:todo tags:x sort:due');
  assert.equal(expandSaved('saved:"My Tasks"', by, errors), 'kind:task');
  assert.deepEqual(errors, []);
  expandSaved('saved:loop saved:missing -saved:a', by, errors);
  assert.equal(errors.length, 3);
  assert.equal(expandSaved('saved:', by, errors), ''); // still typing
});

test('search uses saved queries; editing workspace.yaml changes them without a rebuild', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    '.cave-notes/workspace.yaml': JSON.stringify({ queries: { todo: 'status:todo', mine: { query: 'saved:todo owner:ann' } } }),
    'A.md': '---\nstatus: todo\nowner: ann\n---\n# A',
    'B.md': '---\nstatus: todo\nowner: bob\n---\n# B',
    'C.md': '---\nstatus: done\nowner: ann\n---\n# C',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  assert.deepEqual(paths(idx.search('saved:todo')).sort(), ['A.md', 'B.md']);
  assert.deepEqual(paths(idx.search('saved:mine')), ['A.md']);
  assert.deepEqual(paths(idx.search('saved:todo -owner:ann')), ['B.md']);
  assert.match(idx.search('saved:nothing').errors.join(), /no saved query/);
  assert.deepEqual(idx.savedQueries.map((x) => x.name), ['todo', 'mine']);

  await w.write('.cave-notes/workspace.yaml', JSON.stringify({ queries: { todo: 'status:done' } }));
  const r = await idx.reloadSchema();
  assert.equal(r.changed, true);
  assert.deepEqual(paths(idx.search('saved:todo')), ['C.md']);
  assert.equal((await idx.reloadSchema()).changed, false);
});

test('relations: the column of the pages that name others, and the reverse column', async (t) => {
  const root = await tmpRoot(t);
  const w = ws(root);
  await w.writeAll({
    '.cave-notes/workspace.yaml': JSON.stringify({
      queries: { tasks: 'kind:task', projects: 'kind:project' },
      relations: [{ name: 'Project', from: 'tasks', attribute: 'project', to: 'projects', reverse: 'Tasks' }],
    }),
    'Alpha.md': '---\nkind: project\n---\n# Alpha',
    'Beta.md': '---\nkind: project\n---\n# Beta',
    'Notes/Idea.md': '---\nkind: note\n---\n# Idea',
    'T1.md': '---\nkind: task\nproject: "[[Alpha]]"\n---\n# One',
    'T2.md': '---\nkind: task\nproject: [Alpha, Beta]\n---\n# Two',
    'T3.md': '---\nkind: task\nproject: "[[Idea]]"\n---\n# Three',
    'Loose.md': '---\nproject: "[[Alpha]]"\n---\n# Loose',
  });
  const idx = await openIndex(root);
  t.after(() => idx.close());
  await idx.reconcile();
  const rel = idx.relatedFor(['T1.md', 'T2.md', 'T3.md', 'Alpha.md', 'Beta.md']);
  assert.deepEqual(rel['T1.md'], { Project: [{ path: 'Alpha.md', title: 'Alpha' }] });
  assert.deepEqual(rel['T2.md'].Project.map((x) => x.title), ['Alpha', 'Beta']); // a plain name works too, and lists
  assert.deepEqual(rel['T3.md'], { Project: [] }, 'Idea is not in the projects query, so the cell is empty but still a relation cell');
  assert.deepEqual(rel['Alpha.md'].Tasks.map((x) => x.title), ['One', 'Two']); // Loose is not in the tasks query
  assert.deepEqual(rel['Beta.md'].Tasks.map((x) => x.title), ['Two']);
  assert.deepEqual(idx.relatedFor([]), {});
});

test('saved:Workspace::name is for views: the index reports it instead of looking for a saved query called that', () => {
  const errors = [];
  const out = expandSaved('saved:open OR saved:Theology::tasks', new Map([['open', 'status:todo']]), errors);
  assert.equal(out, 'status:todo OR path:"\u0001"');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /another workspace/);
});

test('a saved query with an OR is one unit: terms next to it apply to all of it', () => {
  const byName = new Map([['both', 'kind:project OR saved:Theology::projects sort:title'], ['plain', 'kind:task status:todo']]);
  assert.equal(expandSaved('saved:both title:a', byName), '( kind:project OR path:"\u0001" ) sort:title title:a');
  assert.equal(expandSaved('saved:plain title:a', byName), 'kind:task status:todo title:a');
});
