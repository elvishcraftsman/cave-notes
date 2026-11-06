import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error plain JS package without types
import { tokenize as coreTokenize } from '@cave-notes/core-index/query';
import { SearchSession, breadcrumb, chips, removeChip, segments, setSort, toggleToken, tokenize, type SearchOutcome } from '../src/index';

describe('tokenize', () => {
  const samples = [
    'grace',
    'status:draft,review -status:done',
    '"justification by faith" -heresy',
    'due:<2026-12-01 weight:>=5 under:"Theology/Soteriology"',
    'title:gr* sort:-title',
    'status: x',
    '-',
    'unterminated "quote',
  ];
  it('matches the core-index tokenizer on every sample', () => {
    for (const s of samples) {
      const mine = tokenize(s).map(({ raw, negated, key, value, quoted }) => ({ raw, negated, key, value, quoted }));
      expect(mine, s).toEqual(coreTokenize(s));
    }
  });
  it('reports positions that slice back to the raw token', () => {
    const s = '  status:draft   "a b"  -x';
    for (const t of tokenize(s)) expect(s.slice(t.start, t.end)).toBe(t.raw);
  });
});

describe('chips', () => {
  it('makes chips for filters, exclusions and sorts, but not plain words or unfinished tokens', () => {
    const c = chips('grace status:draft,review -heresy tags: sort:-due is:orphan');
    expect(c.map((x) => x.label)).toEqual(['status: draft, review', 'not heresy', 'sort due ↓', 'is: orphan']);
    expect(c.map((x) => x.kind)).toEqual(['filter', 'exclude', 'sort', 'filter']);
  });
  it('labels negated filters', () => {
    expect(chips('-status:done')[0]?.label).toBe('not status: done');
  });
  it('removing a chip leaves the rest of the query tidy', () => {
    const text = 'grace status:draft  due:<2026-12-01';
    const chip = chips(text)[0]!;
    expect(removeChip(text, chip)).toBe('grace due:<2026-12-01');
  });
});

describe('toggleToken / setSort', () => {
  it('adds a token, and removes it when it is already there', () => {
    expect(toggleToken('grace', 'status:draft')).toBe('grace status:draft ');
    expect(toggleToken('grace status:draft ', 'status:draft')).toBe('grace');
    expect(toggleToken('', 'is:orphan')).toBe('is:orphan ');
  });
  it('replaces any existing sort', () => {
    expect(setSort('grace sort:title', '-due')).toBe('grace sort:-due ');
    expect(setSort('grace sort:title sort:rank', null)).toBe('grace');
    expect(setSort('', 'title')).toBe('sort:title ');
  });
});

describe('snippets', () => {
  it('splits highlight markers into segments', () => {
    expect(segments('a \u0001grace\u0002 and \u0001faith\u0002!')).toEqual([
      { text: 'a ', match: false },
      { text: 'grace', match: true },
      { text: ' and ', match: false },
      { text: 'faith', match: true },
      { text: '!', match: false },
    ]);
    expect(segments(null)).toEqual([]);
  });
  it('never treats text as markup', () => {
    expect(segments('<b>x</b>')).toEqual([{ text: '<b>x</b>', match: false }]);
  });
  it('breadcrumbs are the ancestors only', () => {
    expect(breadcrumb('Theology/Soteriology/Grace.md')).toEqual(['Theology', 'Soteriology']);
    expect(breadcrumb('Welcome.md')).toEqual([]);
  });
});

describe('SearchSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hit = (title: string) => ({ id: 1, path: `${title}.md`, title, isVirtual: false, snippet: null });
  const outcome = (...t: string[]): SearchOutcome => ({ results: t.map(hit), total: t.length, errors: [] });

  it('debounces typing into a single search for the last text', async () => {
    const run = vi.fn(async (q: string) => outcome(q));
    const s = new SearchSession({ run, onChange: () => {}, delay: 40 });
    for (const q of ['g', 'gr', 'gra', 'grac']) {
      s.setQuery(q);
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe('grac');
    expect(s.state.results.map((r) => r.title)).toEqual(['grac']);
    expect(s.state.loading).toBe(false);
  });

  it('drops a slow answer to an older query', async () => {
    let release!: (o: SearchOutcome) => void;
    const run = vi.fn((q: string) => (q === 'old' ? new Promise<SearchOutcome>((r) => (release = r)) : Promise.resolve(outcome('new'))));
    const s = new SearchSession({ run, onChange: () => {}, delay: 0 });
    s.setQuery('old');
    await vi.advanceTimersByTimeAsync(1);
    s.setQuery('new');
    await vi.advanceTimersByTimeAsync(1);
    release(outcome('old'));
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state.results.map((r) => r.title)).toEqual(['new']);
  });

  it('an empty query clears the results without searching', async () => {
    const run = vi.fn(async () => outcome('x'));
    const s = new SearchSession({ run, onChange: () => {}, delay: 0 });
    s.setQuery('x');
    await vi.advanceTimersByTimeAsync(5);
    s.setQuery('   ');
    expect(s.state.results).toEqual([]);
    expect(s.state.searched).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a failed search instead of throwing', async () => {
    const s = new SearchSession({ run: async () => { throw new Error('index closed'); }, onChange: () => {}, delay: 0 });
    s.setQuery('x');
    await vi.advanceTimersByTimeAsync(5);
    expect(s.state.failure).toBe('index closed');
    expect(s.state.loading).toBe(false);
  });

  it('stops after dispose', async () => {
    const onChange = vi.fn();
    const s = new SearchSession({ run: async () => outcome('x'), onChange, delay: 10 });
    s.setQuery('x');
    s.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(s.state.results).toEqual([]);
  });
});
