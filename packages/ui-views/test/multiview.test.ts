import { describe, expect, it } from 'vitest';
import { addViewToSource, parseViewSet, removeViewFromSource, setOpenView, updateViewSource } from '../src/config';

const SRC = `views:
  - name: Projects #optional
    type: table
    query: under:$this type:project
    columns: [title, type]
  - name: #blank for just an icon
    type: gallery
    query: !Projects #this way it can copy the query before it
  - name: Complete
    type: list
    query: !Projects status:complete #the query shortcode can also have other filters
    columns: [title]`;

describe('several views in one block', () => {
  it('reads each view and works out the !Name shortcodes', () => {
    const r = parseViewSet(SRC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set.segmented).toBe(true);
    expect(r.set.views.map((v) => v.type)).toEqual(['table', 'gallery', 'list']);
    expect(r.set.views.map((v) => v.title)).toEqual(['Projects', undefined, 'Complete']);
    expect(r.set.views.map((v) => v.query)).toEqual(['under:$this type:project', 'under:$this type:project', 'under:$this type:project status:complete']);
    expect(r.set.views[2]!.columns).toEqual(['title']);
  });

  it('a block without views: is one view', () => {
    const r = parseViewSet('type: kanban\nquery: under:$this\ngroup: status\n');
    expect(r.ok && r.set.segmented).toBe(false);
    expect(r.ok && r.set.views).toHaveLength(1);
  });

  it('warns about a shortcode nobody has and about one that points at itself', () => {
    const a = parseViewSet('views:\n  - type: table\n    query: !Nothing status:x');
    expect(a.ok && a.set.warnings[0]).toMatch(/no view called “Nothing”/);
    expect(a.ok && a.set.views[0]!.query).toBe('status:x');
    const b = parseViewSet('views:\n  - name: A\n    query: !A');
    expect(b.ok && b.set.warnings[0]).toMatch(/itself/);
  });

  it('explains that the old repeated view: keys are no longer read', () => {
    const r = parseViewSet('view:\n  type: table\nview:\n  type: list');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/views:/);
  });

  it('reports the line of broken YAML, and which view has a wrong setting', () => {
    const bad = parseViewSet('views:\n  - type: table\n  - type: [oops');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/line 3/);
    const wrong = parseViewSet('views:\n  - type: table\n  - type: nonsense');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/^View 2:/);
  });

  it('changes one view and leaves the others, comments and shortcodes alone', () => {
    const out = updateViewSource(SRC, 1, { type: 'table' });
    expect(out).toContain('type: table\n    query: !Projects #this way it can copy the query before it');
    expect(out.split('\n')).toHaveLength(SRC.split('\n').length);
    expect(out.startsWith('views:\n  - name: Projects #optional')).toBe(true);
    expect(out).toContain('query: !Projects status:complete #the query shortcode can also have other filters');
    const cols = updateViewSource(SRC, 2, { columns: ['title', 'due'] });
    expect(cols).toContain('columns: [title, due]');
    expect(cols).toContain('columns: [title, type]');
  });

  it('a name set from the UI is written as name: in a block of several views', () => {
    const out = updateViewSource(SRC, 1, { title: 'Pictures' });
    expect(out).toContain('name: Pictures');
  });

  it('adds and removes views', () => {
    const added = addViewToSource('type: table\nquery: under:$this\n', { type: 'list', query: 'a:b' });
    expect(added).toBe('views:\n  - type: table\n    query: under:$this\n  - type: list\n    query: a:b');
    const r = parseViewSet(added);
    expect(r.ok && r.set.views).toHaveLength(2);
    expect(removeViewFromSource(added, 1)).toBe('type: table\nquery: under:$this');
    const less = removeViewFromSource(SRC, 1);
    const p = parseViewSet(less);
    expect(p.ok && p.set.views.map((v) => v.title)).toEqual(['Projects', 'Complete']);
  });
});

describe('remembering the open view', () => {
  const SRC = 'views:\n  - name: A\n    type: table\n    query: under:$this\n  - name: B # the second\n    type: list\n    query: under:$this\n  - name: C\n    type: gallery\n    query: under:$this\n';
  const openOf = (s: string): number => {
    const r = parseViewSet(s);
    if (!r.ok) throw new Error(r.error);
    return r.set.openIndex;
  };

  it('opens the first view when none says it is open', () => {
    expect(openOf(SRC)).toBe(0);
  });

  it('puts `open: true` on the chosen view, takes it off the others and keeps comments', () => {
    const b = setOpenView(SRC, 1);
    expect(openOf(b)).toBe(1);
    expect(b).toContain('# the second');
    const c = setOpenView(b, 2);
    expect(openOf(c)).toBe(2);
    expect(c.match(/open: true/g)?.length).toBe(1);
  });

  it('the first view needs no mark: choosing it removes the others', () => {
    const back = setOpenView(setOpenView(SRC, 2), 0);
    expect(back).toBe(SRC.trimEnd());
    expect(openOf(back)).toBe(0);
  });

  it('leaves a block that is already right, and a single view, alone', () => {
    const b = setOpenView(SRC, 1);
    expect(setOpenView(b, 1)).toBe(b);
    const one = 'type: table\nquery: under:$this\n';
    expect(setOpenView(one, 0)).toBe(one);
  });
});
