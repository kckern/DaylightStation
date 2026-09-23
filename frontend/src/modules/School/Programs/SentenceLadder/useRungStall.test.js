import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stalled } = vi.hoisted(() => ({ stalled: vi.fn() }));
vi.mock('./languageLog.js', () => ({ languageLog: { rungStalled: (...a) => stalled(...a) } }));

describe('useRungStall', () => {
  beforeEach(() => { vi.useFakeTimers(); stalled.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('logs rung.stalled at 45s and 120s with rung, seq, the rung phase and the screen state', async () => {
    const { useRungStall } = await import('./useRungStall.js');
    const phaseRef = { current: 'review' };
    renderHook(() => useRungStall({ rung: 'recording', seq: 16, phaseRef }));
    vi.advanceTimersByTime(45_000);
    expect(stalled).toHaveBeenCalledWith({ rung: 'recording', seq: 16, phase: 'review', ms: 45_000, screen: 'visible' });
    phaseRef.current = 'recording';
    vi.advanceTimersByTime(75_000);
    expect(stalled).toHaveBeenLastCalledWith({ rung: 'recording', seq: 16, phase: 'recording', ms: 120_000, screen: 'visible' });
  });

  it('arms nothing when there is no sentence on a rung', async () => {
    const { useRungStall } = await import('./useRungStall.js');
    renderHook(() => useRungStall({ rung: null, seq: null }));
    vi.advanceTimersByTime(200_000);
    expect(stalled).not.toHaveBeenCalled();
  });

  it('a new sentence re-arms from zero', async () => {
    const { useRungStall } = await import('./useRungStall.js');
    const { rerender } = renderHook((p) => useRungStall(p), { initialProps: { rung: 'recording', seq: 1 } });
    vi.advanceTimersByTime(40_000);
    rerender({ rung: 'recording', seq: 2 });
    vi.advanceTimersByTime(40_000);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(stalled).toHaveBeenCalledWith(expect.objectContaining({ seq: 2, phase: null, ms: 45_000 }));
  });
});
