import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { gemAwards, gemSnapshot } from './gemCeremonyModel.js';
import { useGemCeremony } from './useGemCeremony.js';
import GemCeremony from './GemCeremony.jsx';

const board = (cells, week = '2026-11-02') => ({
  mode: 'live', week,
  learners: [{ learnerId: 'a', name: 'Ann' }, { learnerId: 'b', name: 'Ben' }],
  categories: [
    { id: 'race-champion', label: 'Race of the week', cadence: 'contest', color: '#ff7a2f' },
    { id: 'perfect-sheet', label: 'Perfect worksheet', cadence: 'milestone', color: '#2e9e5b' },
  ],
  cells,
});
const cell = (state, week = 0) => ({ state, week });
const NONE = { 'race-champion': { a: cell('none'), b: cell('none') }, 'perfect-sheet': { a: cell('none'), b: cell('none') } };

describe('gemAwards', () => {
  it('a lead just taken is an award; holding it is not', () => {
    const before = gemSnapshot(board(NONE));
    const after = board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') } });
    const { awards, snapshot } = gemAwards(before, after);
    expect(awards).toEqual([{ learnerId: 'a', name: 'Ann', categoryId: 'race-champion', ruleId: 'race-champion', label: 'Race of the week', color: '#ff7a2f', cadence: 'contest', kind: 'leading', count: 0 }]);
    expect(gemAwards(snapshot, after).awards).toEqual([]);
  });

  it('a lead that becomes a win is celebrated again; a count that grows celebrates the new ones', () => {
    const leading = gemSnapshot(board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') }, 'perfect-sheet': { a: cell('earned', 1), b: cell('none') } }));
    const after = board({ ...NONE, 'race-champion': { a: cell('won', 1), b: cell('none') }, 'perfect-sheet': { a: cell('earned', 2), b: cell('none') } });
    expect(gemAwards(leading, after).awards.map((x) => [x.categoryId, x.kind, x.count])).toEqual([['race-champion', 'won', 1], ['perfect-sheet', 'earned', 1]]);
  });

  it('learns without celebrating with no snapshot, a snapshot from another week, or the economy off; never celebrates a loss', () => {
    const after = board({ ...NONE, 'perfect-sheet': { a: cell('earned', 1), b: cell('none') } });
    expect(gemAwards(null, after).awards).toEqual([]);
    expect(gemAwards(gemSnapshot(board(NONE, '2026-10-26')), after).awards).toEqual([]);
    expect(gemAwards(gemSnapshot(board(NONE)), { ...after, mode: 'off' }).awards).toEqual([]);
    const lost = gemSnapshot(board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') } }));
    expect(gemAwards(lost, board({ ...NONE, 'race-champion': { a: cell('none'), b: cell('leading') } })).awards.map((x) => x.learnerId)).toEqual(['b']);
  });
});

// Rows that fold several rules: the cell carries one part per rule.
const part = (ruleId, label, cadence, state = 'none', week = 0, extra = {}) => ({ ruleId, label, cadence, state, week, ...extra });
const merged = (cells, week = '2026-11-02') => ({
  mode: 'live', week,
  learners: [{ learnerId: 'a', name: 'Ann' }, { learnerId: 'b', name: 'Ben' }],
  categories: [
    { id: 'ring-contests', label: 'Ring contests', cadence: 'contest', color: '#8e5bd0' },
    { id: 'racing', label: 'Racing', cadence: 'contest', color: '#ff7a2f' },
    { id: 'reading', label: 'Reading', cadence: 'weekly', color: '#2e9e5b' },
  ],
  cells,
});
const rings = (most = 'none', improved = 'none') => ({
  state: most === 'leading' || improved === 'leading' ? 'leading' : 'none', week: 0,
  parts: [part('ring-contest', 'Most rings this week', 'contest', most, 0, { color: '#8e5bd0' }), part('ring-improved', 'Most improved', 'contest', improved, 0, { color: '#8e5bd0' })],
});
const racing = (champion = 'none', pb = 0) => ({
  state: pb > 0 ? 'earned' : champion, week: pb,
  parts: [part('race-champion', 'Race of the week', 'contest', champion), part('race-pb', 'Personal best', 'milestone', pb > 0 ? 'earned' : 'none', pb)],
});
const reading = (week = 0, books = 0) => ({
  state: week + books > 0 ? 'earned' : 'none', week: week + books,
  parts: [part('reader-week', 'Story time 4 days', 'weekly', week > 0 ? 'earned' : 'none', week), part('book-finished', 'Book finished', 'milestone', books > 0 ? 'earned' : 'none', books, { color: '#2e9e5b' })],
});
const rows = (a = {}, b = {}) => ({
  'ring-contests': { a: a.rings ?? rings(), b: b.rings ?? rings() },
  racing: { a: a.racing ?? racing(), b: b.racing ?? racing() },
  reading: { a: a.reading ?? reading(), b: b.reading ?? reading() },
});

describe('gemAwards by rule', () => {
  it('remembers one entry per rule, and a cell without parts under its category id', () => {
    expect(gemSnapshot(merged(rows({ racing: racing('leading', 1) })))).toEqual({
      week: '2026-11-02', v: 2,
      parts: {
        a: { 'ring-contest': ['none', 0], 'ring-improved': ['none', 0], 'race-champion': ['leading', 0], 'race-pb': ['earned', 1], 'reader-week': ['none', 0], 'book-finished': ['none', 0] },
        b: { 'ring-contest': ['none', 0], 'ring-improved': ['none', 0], 'race-champion': ['none', 0], 'race-pb': ['none', 0], 'reader-week': ['none', 0], 'book-finished': ['none', 0] },
      },
    });
    expect(gemSnapshot(board({ ...NONE, 'perfect-sheet': { a: cell('earned', 2), b: cell('none') } }))).toEqual({
      week: '2026-11-02', v: 2,
      parts: { a: { 'race-champion': ['none', 0], 'perfect-sheet': ['earned', 2] }, b: { 'race-champion': ['none', 0], 'perfect-sheet': ['none', 0] } },
    });
  });

  it('a lead taken in a row its other rule already earned is celebrated', () => {
    const before = gemSnapshot(merged(rows({ racing: racing('none', 1) })));
    const after = merged(rows({ racing: racing('leading', 1) }));
    expect(after.cells.racing.a).toMatchObject({ state: 'earned', week: 1 }); // the cell itself did not move
    const { awards, snapshot } = gemAwards(before, after);
    expect(awards).toEqual([{ learnerId: 'a', name: 'Ann', categoryId: 'racing', ruleId: 'race-champion', label: 'Race of the week', color: '#ff7a2f', cadence: 'contest', kind: 'leading', count: 0 }]);
    expect(gemAwards(snapshot, after).awards).toEqual([]);
  });

  it('a second contest lead in one row is celebrated though the cell was already leading', () => {
    const before = gemSnapshot(merged(rows({ rings: rings('leading', 'none') })));
    const { awards } = gemAwards(before, merged(rows({ rings: rings('leading', 'leading') })));
    expect(awards.map((x) => [x.categoryId, x.ruleId, x.label, x.kind, x.color])).toEqual([['ring-contests', 'ring-improved', 'Most improved', 'leading', '#8e5bd0']]);
  });

  it('a snapshot in the old per-row shape is learned without celebrating, and a per-rule one comes out', () => {
    const held = merged(rows({ rings: rings('leading'), racing: racing('leading', 1), reading: reading(1, 2) }));
    const v1 = { week: '2026-11-02', cells: { a: { 'ring-contest': ['leading', 0], 'race-champion': ['leading', 0], 'reader-week': ['earned', 1] }, b: {} } };
    const { awards, snapshot } = gemAwards(v1, held);
    expect(awards).toEqual([]);
    expect(snapshot).toEqual(gemSnapshot(held));
    expect(snapshot.v).toBe(2);
    expect(snapshot.cells).toBeUndefined();
    expect(gemAwards({ ...snapshot, v: 1 }, held).awards).toEqual([]);
    expect(gemAwards(snapshot, held).awards).toEqual([]);
  });

  it('a finished book is announced as the book, a milestone, in its own colour', () => {
    const before = gemSnapshot(merged(rows({ reading: reading(1, 0) })));
    const { awards } = gemAwards(before, merged(rows({ reading: reading(1, 1) })));
    expect(awards).toEqual([{ learnerId: 'a', name: 'Ann', categoryId: 'reading', ruleId: 'book-finished', label: 'Book finished', color: '#2e9e5b', cadence: 'milestone', kind: 'earned', count: 1 }]);
  });

  it('a count that grows on one rule celebrates only the new gems of that rule; a part with no colour takes the row’s', () => {
    const before = gemSnapshot(merged(rows({ reading: reading(1, 1), racing: racing('none', 1) })));
    const { awards } = gemAwards(before, merged(rows({ reading: reading(1, 3), racing: racing('none', 2) })));
    expect(awards.map((x) => [x.ruleId, x.kind, x.count, x.color])).toEqual([['race-pb', 'earned', 1, '#ff7a2f'], ['book-finished', 'earned', 2, '#2e9e5b']]);
  });

  it('a lead that becomes a win is celebrated again; a lead lost is not; awards run by row, then child, then rule', () => {
    const before = gemSnapshot(merged(rows({ rings: rings('leading', 'leading') }, { racing: racing('leading') })));
    const won = { state: 'won', week: 1, parts: [part('ring-contest', 'Most rings this week', 'contest', 'won', 1), part('ring-improved', 'Most improved', 'contest', 'none')] };
    const after = merged(rows({ rings: won, racing: racing('leading', 1), reading: reading(1, 1) }, { rings: rings('none', 'leading'), racing: racing('none') }));
    expect(gemAwards(before, after).awards.map((x) => [x.categoryId, x.learnerId, x.ruleId, x.kind, x.count])).toEqual([
      ['ring-contests', 'a', 'ring-contest', 'won', 1],
      ['ring-contests', 'b', 'ring-improved', 'leading', 0],
      ['racing', 'a', 'race-champion', 'leading', 0],
      ['racing', 'a', 'race-pb', 'earned', 1],
      ['reading', 'a', 'reader-week', 'earned', 1],
      ['reading', 'a', 'book-finished', 'earned', 1],
    ]);
  });
});

describe('gemAwards through an unreadable look', () => {
  const unknownBook = (week = 1) => ({ state: 'earned', week, parts: [part('reader-week', 'Story time 4 days', 'weekly', 'earned', week), part('book-finished', 'Book finished', 'milestone', 'unknown', 0)] });
  it('earned, then unreadable, then earned again is not a new gem: the snapshot keeps what it knew', () => {
    const earned = merged(rows({ reading: reading(1, 2) }));
    const first = gemSnapshot(earned);
    const blind = gemAwards(first, merged(rows({ reading: unknownBook() })));
    expect(blind.awards).toEqual([]);
    expect(blind.snapshot.parts.a['book-finished']).toEqual(['earned', 2]);
    expect(blind.snapshot.parts.a['reader-week']).toEqual(['earned', 1]);
    expect(gemAwards(blind.snapshot, earned).awards).toEqual([]);
  });

  it('a lead unreadable for one look is still the same lead', () => {
    const leading = merged(rows({ rings: rings('leading') }));
    const blind = gemAwards(gemSnapshot(leading), merged(rows({ rings: rings('unknown') })));
    expect(blind.snapshot.parts.a['ring-contest']).toEqual(['leading', 0]);
    expect(gemAwards(blind.snapshot, leading).awards).toEqual([]);
  });

  it('nothing, then unreadable, then earned celebrates once; with nothing known the unreadable state is what is kept', () => {
    const blind = gemAwards(gemSnapshot(merged(rows())), merged(rows({ reading: unknownBook(0) })));
    expect(blind.snapshot.parts.a['book-finished']).toEqual(['none', 0]);
    const earned = merged(rows({ reading: reading(0, 1) }));
    const after = gemAwards(blind.snapshot, earned);
    expect(after.awards.map((x) => [x.ruleId, x.kind, x.count])).toEqual([['book-finished', 'earned', 1]]);
    expect(gemAwards(after.snapshot, earned).awards).toEqual([]);
    // No earlier look, another week's look, or an old-shape one: nothing to keep.
    const unreadable = merged(rows({ reading: unknownBook(0) }));
    expect(gemSnapshot(unreadable).parts.a['book-finished']).toEqual(['unknown', 0]);
    expect(gemSnapshot(unreadable, gemSnapshot(merged(rows({ reading: reading(0, 1) }), '2026-10-26'))).parts.a['book-finished']).toEqual(['unknown', 0]);
    expect(gemSnapshot(unreadable, { week: '2026-11-02', cells: {} }).parts.a['book-finished']).toEqual(['unknown', 0]);
  });
});

function Probe(props) {
  const { ceremony, done } = useGemCeremony(props);
  return <div data-testid="probe" data-n={ceremony ? ceremony.awards.length : 0} onClick={done} />;
}

describe('useGemCeremony', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

  it('learns on mount, then celebrates a race after its event with a FRESH read', async () => {
    let current = board(NONE);
    const load = vi.fn(async () => current);
    render(<Probe surface="t1" events={['race-saved']} learnOnMount load={load} settleMs={10} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
    current = board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') } });
    act(() => { window.dispatchEvent(new CustomEvent('race-saved')); vi.advanceTimersByTime(11); });
    await flush();
    expect(load).toHaveBeenLastCalledWith(null, { fresh: true });
    expect(screen.getByTestId('probe').dataset.n).toBe('1');
  });

  it('without learnOnMount, a remount shows what landed while it was away — once', async () => {
    localStorage.setItem('daylight.gemCeremony.v2.t2', JSON.stringify(gemSnapshot(board(NONE))));
    const load = async () => board({ ...NONE, 'perfect-sheet': { a: cell('none'), b: cell('earned', 1) } });
    const first = render(<Probe surface="t2" load={load} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('1');
    first.unmount();
    render(<Probe surface="t2" load={load} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
  });

  it('handed a stored snapshot in the old per-row shape, learns the week without celebrating, then celebrates what is new', async () => {
    localStorage.setItem('daylight.gemCeremony.v2.t3', JSON.stringify({ week: '2026-11-02', cells: { a: { 'reader-week': ['earned', 1] }, b: {} } }));
    let current = merged(rows({ reading: reading(1, 1), racing: racing('leading') }));
    const load = async () => current;
    render(<Probe surface="t3" events={['book-logged']} load={load} settleMs={10} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
    expect(JSON.parse(localStorage.getItem('daylight.gemCeremony.v2.t3'))).toEqual(gemSnapshot(current));
    current = merged(rows({ reading: reading(1, 2), racing: racing('leading') }));
    act(() => { window.dispatchEvent(new CustomEvent('book-logged')); vi.advanceTimersByTime(11); });
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('1');
  });

  it('learnOnMount over an old-shape snapshot writes the per-rule one, so the next look replays nothing', async () => {
    localStorage.setItem('daylight.gemCeremony.v2.t4', JSON.stringify({ week: '2026-11-02', cells: { a: { racing: ['earned', 1] } } }));
    const held = merged(rows({ racing: racing('leading', 1) }));
    render(<Probe surface="t4" events={['race-saved']} learnOnMount load={async () => held} settleMs={10} />);
    await flush();
    expect(JSON.parse(localStorage.getItem('daylight.gemCeremony.v2.t4'))).toEqual(gemSnapshot(held));
    act(() => { window.dispatchEvent(new CustomEvent('race-saved')); vi.advanceTimersByTime(11); });
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
  });

  it('learnOnMount through an unreadable board keeps what the last look knew; every write clears the key the older bundle used', async () => {
    const earned = merged(rows({ reading: reading(1, 2) }));
    localStorage.setItem('daylight.gemCeremony.v2.t5', JSON.stringify(gemSnapshot(earned)));
    localStorage.setItem('daylight.gemCeremony.t5', JSON.stringify({ week: '2026-11-02', cells: {} }));
    localStorage.setItem('daylight.gemCeremony.other', 'kept');
    let current = merged(rows({ reading: { state: 'earned', week: 1, parts: [part('reader-week', 'Story time 4 days', 'weekly', 'earned', 1), part('book-finished', 'Book finished', 'milestone', 'unknown', 0)] } }));
    render(<Probe surface="t5" events={['book-logged']} learnOnMount load={async () => current} settleMs={10} />);
    await flush();
    expect(localStorage.getItem('daylight.gemCeremony.t5')).toBeNull();
    expect(localStorage.getItem('daylight.gemCeremony.other')).toBe('kept');
    expect(JSON.parse(localStorage.getItem('daylight.gemCeremony.v2.t5'))).toEqual(gemSnapshot(earned));
    current = earned;
    localStorage.setItem('daylight.gemCeremony.t5', 'back again');
    act(() => { window.dispatchEvent(new CustomEvent('book-logged')); vi.advanceTimersByTime(11); });
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
    expect(localStorage.getItem('daylight.gemCeremony.t5')).toBeNull();
  });
});

describe('GemCeremony', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const awards = [
    { learnerId: 'a', name: 'Ann', categoryId: 'race-champion', label: 'Race of the week', color: '#ff7a2f', kind: 'leading', count: 0 },
    { learnerId: 'b', name: 'Ben', categoryId: 'perfect-sheet', label: 'Perfect worksheet', color: '#2e9e5b', kind: 'earned', count: 2 },
  ];
  it('one card per award, plays its cue once, and dismisses once on tap or the clock', () => {
    vi.useFakeTimers();
    const onShow = vi.fn();
    const onDone = vi.fn();
    render(<GemCeremony awards={awards} surface="t" onShow={onShow} onDone={onDone} />);
    expect(screen.getByText('Took the lead!')).toBeTruthy();
    expect(screen.getByText('Gem earned! ×2')).toBeTruthy();
    expect(onShow).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId('gem-ceremony'));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('tap');
  });

  it('two gems in one row for one child are two cards, each under its own rule', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const two = [
      { learnerId: 'a', name: 'Ann', categoryId: 'reading', ruleId: 'reader-week', label: 'Story time 4 days', color: '#2e9e5b', cadence: 'weekly', kind: 'earned', count: 1 },
      { learnerId: 'a', name: 'Ann', categoryId: 'reading', ruleId: 'book-finished', label: 'Book finished', color: '#2e9e5b', cadence: 'milestone', kind: 'earned', count: 1 },
    ];
    const { container } = render(<GemCeremony awards={two} surface="t" onDone={() => {}} />);
    expect([...container.querySelectorAll('.gem-ceremony__label')].map((n) => n.textContent)).toEqual(['Story time 4 days', 'Book finished']);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('same key'))).toEqual([]);
    errors.mockRestore();
  });
});
