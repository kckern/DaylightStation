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
    { id: 'perfect-sheet', label: 'Perfect worksheet', cadence: 'milestone', color: '#d6304a' },
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
    expect(awards).toEqual([expect.objectContaining({ learnerId: 'a', name: 'Ann', categoryId: 'race-champion', label: 'Race of the week', kind: 'leading', count: 0 })]);
    expect(gemAwards(snapshot, after).awards).toEqual([]);
  });

  it('a lead that becomes a win is celebrated again; a count that grows celebrates the new ones', () => {
    const leading = gemSnapshot(board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') }, 'perfect-sheet': { a: cell('earned', 1), b: cell('none') } }));
    const after = board({ ...NONE, 'race-champion': { a: cell('won', 1), b: cell('none') }, 'perfect-sheet': { a: cell('earned', 2), b: cell('none') } });
    expect(gemAwards(leading, after).awards.map((x) => [x.categoryId, x.kind, x.count])).toEqual([['race-champion', 'won', 1], ['perfect-sheet', 'earned', 1]]);
  });

  it('learns silently with no snapshot, a snapshot from another week, or the economy off; never celebrates a loss', () => {
    const after = board({ ...NONE, 'perfect-sheet': { a: cell('earned', 1), b: cell('none') } });
    expect(gemAwards(null, after).awards).toEqual([]);
    expect(gemAwards(gemSnapshot(board(NONE, '2026-10-26')), after).awards).toEqual([]);
    expect(gemAwards(gemSnapshot(board(NONE)), { ...after, mode: 'off' }).awards).toEqual([]);
    const lost = gemSnapshot(board({ ...NONE, 'race-champion': { a: cell('leading'), b: cell('none') } }));
    expect(gemAwards(lost, board({ ...NONE, 'race-champion': { a: cell('none'), b: cell('leading') } })).awards.map((x) => x.learnerId)).toEqual(['b']);
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
    localStorage.setItem('daylight.gemCeremony.t2', JSON.stringify(gemSnapshot(board(NONE))));
    const load = async () => board({ ...NONE, 'perfect-sheet': { a: cell('none'), b: cell('earned', 1) } });
    const first = render(<Probe surface="t2" load={load} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('1');
    first.unmount();
    render(<Probe surface="t2" load={load} />);
    await flush();
    expect(screen.getByTestId('probe').dataset.n).toBe('0');
  });
});

describe('GemCeremony', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const awards = [
    { learnerId: 'a', name: 'Ann', categoryId: 'race-champion', label: 'Race of the week', color: '#ff7a2f', kind: 'leading', count: 0 },
    { learnerId: 'b', name: 'Ben', categoryId: 'perfect-sheet', label: 'Perfect worksheet', color: '#d6304a', kind: 'earned', count: 2 },
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
});
