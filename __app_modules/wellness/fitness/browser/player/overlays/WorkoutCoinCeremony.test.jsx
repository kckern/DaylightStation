import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

const cue = vi.fn();
vi.mock('./ringCelebrationAudio.js', () => ({ playRingCelebrationCue: (...a) => cue(...a) }));
const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));
vi.mock('@/lib/api.mjs', () => ({ DaylightMediaPath: (p) => p }));

import WorkoutCoinCeremony, { ceremonyDurationMs } from './WorkoutCoinCeremony.jsx';

const L = (id, silver, total, extra = {}) => ({ learnerId: id, learnerName: id.toUpperCase(), rings: 0, gained: { silver, gems: 0 }, total: { silver: total }, nextCoinIn: null, ...extra });

describe('WorkoutCoinCeremony', () => {
  beforeEach(() => { vi.useFakeTimers(); cue.mockClear(); logSpy.info.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('times out after 4s plus 1.5s per extra card, capped at 10s', () => {
    expect(ceremonyDurationMs(1)).toBe(4000);
    expect(ceremonyDurationMs(3)).toBe(7000);
    expect(ceremonyDurationMs(9)).toBe(10000);
  });

  it('shows +N and the new total per learner, a card each', () => {
    const { container } = render(<WorkoutCoinCeremony sessionId="s1" learners={[L('learner-a', 3, 27), L('learner-b', 1, 9)]} onDone={() => {}} />);
    const cards = container.querySelectorAll('.workout-coin-ceremony__card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('+3');
    expect(cards[0].textContent).toContain('27 silver');
    expect(cards[1].textContent).toContain('+1');
    expect(container.querySelector('.workout-coin-ceremony__rings')).toBeNull();
  });

  it('logs the minted txnIds with the shown event', () => {
    render(<WorkoutCoinCeremony sessionId="s1" txnIds={['t1', 't2']} learners={[L('learner-a', 3, 27)]} onDone={() => {}} />);
    expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.shown', expect.objectContaining({ sessionId: 's1', txnIds: ['t1', 't2'], totalSilver: 3 }));
  });

  it('plays the coin cue once per card and logs shown', () => {
    render(<WorkoutCoinCeremony sessionId="s1" learners={[L('learner-a', 3, 27), L('learner-b', 1, 9)]} onDone={() => {}} />);
    expect(cue).toHaveBeenCalledTimes(2);
    expect(logSpy.info).toHaveBeenCalledWith('fitness.coin_ceremony.shown', expect.objectContaining({ sessionId: 's1', learners: 2, totalSilver: 4 }));
  });

  it('shows a gem when the ride paid one', () => {
    const { container } = render(<WorkoutCoinCeremony sessionId="s1" learners={[L('learner-a', 5, 30, { gained: { silver: 5, gems: 1 } })]} onDone={() => {}} />);
    expect(container.querySelector('.workout-coin-ceremony__gem')).toBeTruthy();
    // Said in words too, so it reads as an award, not decoration.
    expect(container.querySelector('.workout-coin-ceremony__gems').textContent).toBe('+1 gem');
  });

  it('dismisses on click, not pointerdown, so the tap cannot land on the screen underneath', () => {
    const onDone = vi.fn();
    const { container } = render(<WorkoutCoinCeremony sessionId="s9" learners={[L('learner-a', 3, 27)]} onDone={onDone} />);
    fireEvent.pointerDown(container.querySelector('[data-testid="workout-coin-ceremony"]'));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-testid="workout-coin-ceremony"]'));
    expect(onDone).toHaveBeenCalledWith('tap');
  });

  it('consumes the dismiss key so the menu underneath never sees it', () => {
    const below = vi.fn();
    window.addEventListener('keydown', below);
    try {
      const onDone = vi.fn();
      render(<WorkoutCoinCeremony sessionId="s8" learners={[L('learner-a', 3, 27)]} onDone={onDone} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onDone).toHaveBeenCalledWith('key');
      expect(below).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', below); }
  });

  it('dismisses on tap, on Enter, and on timeout — once', () => {
    const onDone = vi.fn();
    const { container, unmount } = render(<WorkoutCoinCeremony sessionId="s1" learners={[L('learner-a', 3, 27)]} onDone={onDone} />);
    fireEvent.click(container.querySelector('[data-testid="workout-coin-ceremony"]'));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('tap');
    unmount();

    const onKey = vi.fn();
    render(<WorkoutCoinCeremony sessionId="s2" learners={[L('learner-a', 3, 27)]} onDone={onKey} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onKey).toHaveBeenCalledWith('key');

    const onTime = vi.fn();
    render(<WorkoutCoinCeremony sessionId="s3" learners={[L('learner-a', 3, 27)]} onDone={onTime} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onTime).toHaveBeenCalledWith('timeout');
  });
});
