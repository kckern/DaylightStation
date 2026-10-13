import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import RepInterstitial, { REP_CARD_MS, repCardCopy } from './RepInterstitial.jsx';

const base = {
  score: 1, setIndex: 1, setCount: 3, repIndex: 1, repCount: 3, setClear: false, next: { key: 'G major', hand: null },
};

describe('repCardCopy — the coach’s three lines', () => {
  it('after a rep inside a set: the score, the rep banked, the same key again', () => {
    expect(repCardCopy({ ...base, score: 0.9411 })).toEqual({
      eyebrow: 'Rep 1 of 3',
      headline: '94%',
      line: 'G major again — rep 2 of 3',
    });
  });

  it('after the last rep of a set: set clear, and the NEXT key named', () => {
    expect(repCardCopy({ ...base, repIndex: 3, setClear: true, next: { key: 'D major', hand: 'left hand' } })).toEqual({
      eyebrow: 'Set 1 of 3 clear',
      headline: '100%',
      line: 'Next: D major, left hand',
    });
  });

  it('says Passed when there is no score to show, never NaN%', () => {
    expect(repCardCopy({ ...base, score: null }).headline).toBe('Passed');
  });

  it('never names a key it does not know', () => {
    expect(repCardCopy({ ...base, next: { key: null, hand: null } }).line).toBe('Rep 2 of 3');
    expect(repCardCopy({ ...base, repIndex: 3, setClear: true, next: { key: null, hand: null } }).line).toBe('Next set');
  });
});

describe('RepInterstitial', () => {
  it('renders the three lines and hands back after REP_CARD_MS', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const { container } = render(<RepInterstitial {...base} score={1} onDone={onDone} />);
      expect(container.querySelector('.rep-card')).toBeTruthy();
      expect(container.textContent).toContain('100%');
      expect(container.textContent).toContain('G major again');
      act(() => vi.advanceTimersByTime(REP_CARD_MS - 50));
      expect(onDone).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(100));
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('arms its timer once, however many times the parent re-renders it', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const { rerender } = render(<RepInterstitial {...base} onDone={onDone} />);
      act(() => vi.advanceTimersByTime(REP_CARD_MS / 2));
      rerender(<RepInterstitial {...base} onDone={() => onDone('late')} />);
      act(() => vi.advanceTimersByTime(REP_CARD_MS / 2 + 50));
      expect(onDone).toHaveBeenCalledTimes(1);
      // The LATEST callback runs, from the mount-armed timer.
      expect(onDone).toHaveBeenCalledWith('late');
    } finally { vi.useRealTimers(); }
  });
});
