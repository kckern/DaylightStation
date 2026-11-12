import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn(), error: vi.fn() };
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));
vi.mock('./useLessonPractice.js', () => ({ CHECK_IN_GRACE_MS: 3000 }));

import { useEngagementGate } from './useEngagementGate.js';
import { PRESCHOOL_POLICY } from '../../../../portable/practice/goodFaith.mjs';

beforeEach(() => { vi.useFakeTimers(); Object.values(log).forEach((f) => f.mockReset()); });
afterEach(() => { vi.useRealTimers(); });

const stats = { notes: 0, distinctPitches: 0, pitchSpan: 0, medianIoiMs: 0, velocitySpread: 0 };
const burst = (verdict, legitNotes = 0) => ({ events: [], verdict, legitNotes, stats });

function setup({ bursts, judgeBurst = null, policy } = {}) {
  let current = burst('spam');
  const recordCheckIn = vi.fn();
  const hook = renderHook(() => useEngagementGate({
    pause: vi.fn(), play: vi.fn(), isPaused: () => false, isSequential: true, timeoutSeconds: 2,
    burstSince: () => current, judgeBurst, recordCheckIn, ...(policy ? { policy } : {}),
  }));
  const idleOpen = () => { act(() => { vi.advanceTimersByTime(2500); }); return hook.result.current.step; };
  const answer = (next) => { act(() => { hook.result.current.dismissGate(); }); current = next ?? burst('spam'); };
  return { hook, idleOpen, answer, recordCheckIn, set: (b) => { current = b; } };
}

describe('useEngagementGate — ladder', () => {
  it('note → 1 scale → 2 scales → 2 scales with only the answers between', () => {
    const g = setup();
    expect(g.idleOpen()).toEqual({ kind: 'note' });
    g.answer(burst('spam', 1));
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 1 });
    g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 2 });
    g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 2 });
    expect(g.recordCheckIn).toHaveBeenCalledWith({ open: true, scales: 2 });
    expect(g.recordCheckIn).toHaveBeenCalledWith({ open: false });
  });

  it('8+ legit notes since the answer drop back to a note (RF5)', () => {
    const g = setup();
    g.idleOpen(); g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 1 });
    g.answer(burst('legit', 10));
    expect(g.idleOpen()).toEqual({ kind: 'note' });
  });

  it('mashing (spam) between check-ins escalates', () => {
    const g = setup();
    g.idleOpen(); g.answer(burst('spam', 3));
    expect(g.idleOpen().kind).toBe('scales');
  });

  it('an ambiguous burst sends one judge request; pending holds, 0.9 resets, 0.2 escalates, fallback resets (RF6)', async () => {
    let resolve;
    const judgeBurst = vi.fn(() => new Promise((r) => { resolve = r; }));
    const g = setup({ judgeBurst });
    g.idleOpen(); g.answer();
    g.idleOpen(); // scales 1
    g.answer(burst('ambiguous', 9));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(judgeBurst).toHaveBeenCalledTimes(1);
    expect(judgeBurst.mock.calls[0][0]).toMatchObject({ kind: 'check-in' });
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 1 }); // pending → hold
    expect(judgeBurst).toHaveBeenCalledTimes(1);
    g.answer(burst('ambiguous', 9));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: true, probability: 0.9, source: 'model' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen()).toEqual({ kind: 'note' });

    g.answer(burst('spam')); g.idleOpen(); // up to 1
    g.answer(burst('ambiguous', 9));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: false, probability: 0.2, source: 'model' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen()).toEqual({ kind: 'scales', count: 2 });

    g.answer(burst('ambiguous', 9));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: null, probability: null, source: 'fallback' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen()).toEqual({ kind: 'note' });
  });

  it('the gate opens and dismisses normally while a judge promise never settles', () => {
    const judgeBurst = vi.fn(() => new Promise(() => {}));
    const g = setup({ judgeBurst });
    g.idleOpen(); g.answer(burst('ambiguous', 9));
    expect(g.idleOpen()).toBeTruthy();
    expect(g.hook.result.current.gateOpen).toBe(true);
    act(() => { g.hook.result.current.dismissGate(); });
    expect(g.hook.result.current.gateOpen).toBe(false);
  });

  it('preschool never leaves the single note', () => {
    const g = setup({ policy: PRESCHOOL_POLICY });
    g.idleOpen(); g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'note' });
    g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'note' });
  });
});
