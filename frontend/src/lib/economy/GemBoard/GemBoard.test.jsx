import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import GemBoardOverlay, { GemBoardGrid } from './GemBoard.jsx';

const BOARD = {
  mode: 'live',
  week: '2026-11-02',
  learners: [{ learnerId: 'a', name: 'Ann' }, { learnerId: 'b', name: 'Ben' }],
  categories: [
    { id: 'green-week', label: 'Green week', cadence: 'weekly', color: '#d6304a' },
    { id: 'exercise', label: 'Exercise', cadence: 'weekly', color: '#8e5bd0' },
    { id: 'ring-contest', label: 'Most rings', cadence: 'contest', color: '#1e88e5' },
  ],
  cells: {
    'green-week': { a: { state: 'unknown', week: 0 }, b: { state: 'none', week: 0 } },
    exercise: { a: { state: 'earned', week: 2 }, b: { state: 'pending', week: 0, progress: { have: 3, need: 5 } } },
    'ring-contest': { a: { state: 'leading', week: 0 }, b: { state: 'none', week: 0 } },
  },
  totals: { a: { week: 2, lifetime: 9 }, b: { week: 0, lifetime: 4 } },
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('GemBoardGrid', () => {
  it('columns in roster order, rows grouped by cadence, no failure marks', () => {
    const { container } = render(<GemBoardGrid board={BOARD} focusLearnerId="b" />);
    expect([...container.querySelectorAll('.gem-board__name')].map((n) => n.textContent)).toEqual(['Ann', 'Ben']);
    expect([...container.querySelectorAll('.gem-board__group-label')].map((n) => n.textContent)).toEqual(['This week', 'Contests']);
    const states = [...container.querySelectorAll('.gem-board__cell')].map((c) => c.dataset.state);
    expect(states).toEqual(['unknown', 'none', 'earned', 'pending', 'leading', 'none']);
    // Not earned is a blank cell, not a cross.
    expect(container.querySelector('.gem-board__cell.is-none').textContent).toBe('');
    expect(container.querySelector('.gem-board__cell.is-earned').textContent).toBe('×2');
    expect(container.querySelector('.gem-board__cell.is-pending').textContent).toBe('3/5');
    expect(screen.getByLabelText('Ben, Exercise: still in reach, 3 of 5')).toBeTruthy();
    expect(screen.getByLabelText('Ann: 2 this week, 9 in all')).toBeTruthy();
    expect(container.querySelectorAll('.gem-board__head.is-focus')).toHaveLength(1);
  });
});

describe('GemBoardOverlay', () => {
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('loads this week, steps to last week by its Monday minus 7, and closes on Escape', async () => {
    const load = vi.fn(async (week) => ({ ...BOARD, week: week ? '2026-10-26' : '2026-11-02' }));
    const onClose = vi.fn();
    render(<GemBoardOverlay open surface="fitness" load={load} onClose={onClose} />);
    await flush();
    expect(load).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByText('Last week'));
    await flush();
    expect(load).toHaveBeenLastCalledWith('2026-10-26');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('back');
  });

  it('takes a surface’s gamepad keys through keyRef: ←/→ moves the focus column', async () => {
    const keyRef = { current: null };
    const { container } = render(<GemBoardOverlay open surface="fitness" focusLearnerId="a" keyRef={keyRef} load={async () => BOARD} onClose={() => {}} />);
    await flush();
    const focused = () => container.ownerDocument.querySelector('.gem-board__head.is-focus .gem-board__name')?.textContent;
    expect(focused()).toBe('Ann');
    act(() => { keyRef.current('ArrowRight'); });
    expect(focused()).toBe('Ben');
    act(() => { keyRef.current('ArrowRight'); });
    expect(focused()).toBe('Ann');
  });

  it('closes itself after idleMs without input', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<GemBoardOverlay open surface="school" idleMs={1000} load={async () => BOARD} onClose={onClose} />);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(onClose).toHaveBeenCalledWith('timeout');
  });

  it('says so when the economy is off or the read fails', async () => {
    const { unmount } = render(<GemBoardOverlay open surface="school" load={async () => ({ mode: 'off' })} onClose={() => {}} />);
    await flush();
    expect(screen.getByText('Gems are switched off.')).toBeTruthy();
    unmount();
    render(<GemBoardOverlay open surface="school" load={async () => { throw new Error('503'); }} onClose={() => {}} />);
    await flush();
    expect(screen.getByText('Can’t load the gems right now.')).toBeTruthy();
  });
});
