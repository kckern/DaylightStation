import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useScoreTransport } from './useScoreTransport.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.setSystemTime(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const STEPS = [
  { t: 0, index: 0, kind: 'step' }, { t: 500, index: 1, kind: 'step' },
  { t: 1000, index: 2, kind: 'step' }, { t: 1500, index: 3, kind: 'step' },
];
const MIXED = [
  { t: 0, index: 0, kind: 'step' },
  { t: 0, type: 'note_on', note: 60, velocity: 80 },
  { t: 480, type: 'note_off', note: 60 },
  { t: 500, index: 1, kind: 'step' },
  { t: 500, type: 'note_on', note: 64, velocity: 80 },
  { t: 980, type: 'note_off', note: 64 },
];

describe('useScoreTransport (lookahead scheduler)', () => {
  it('fires step events at their absolute due times', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));
    expect(fired).toEqual([0, 1]);
    act(() => vi.advanceTimersByTime(1100));
    expect(fired).toEqual([0, 1, 2, 3]);
  });

  it('schedules note events ahead with absolute wall timestamps', () => {
    const sched = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED,
      onEvent: () => {},
      onSchedule: (e, atWall, leadMs) => sched.push({ note: e.note, type: e.type, atWall, leadMs }),
      lookaheadMs: 400, tickMs: 100,
    }));
    act(() => result.current.play()); // immediate tick at pos=0: horizon=400
    expect(sched.map((s) => [s.type, s.note, s.atWall])).toEqual([['note_on', 60, 0]]);
    act(() => vi.advanceTimersByTime(100)); // pos=100, horizon=500 → t:480 off + t:500 on
    expect(sched.map((s) => s.atWall)).toEqual([0, 480, 500]);
    expect(sched[1].leadMs).toBeGreaterThan(0);
  });

  it('a callback seek during the fire loop redirects it (loop wrap) instead of spinning on the stale position', () => {
    const fired = [];
    let api;
    const { result } = renderHook(() => useScoreTransport({
      timeline: STEPS,
      onEvent: (e) => {
        fired.push(e.index);
        if (e.index === 2 && fired.length < 5) api.seek(500); // wrap back to the t:500 step (once)
      },
    }));
    api = result.current;
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1050)); // fires 0,1,2 → wrap-seek(500) → re-fires 1, then waits
    expect(fired).toEqual([0, 1, 2, 1]);
    expect(result.current.playing).toBe(true); // wrapped, not done
  });

  it('never routes step events through onSchedule, and still fires notes via onEvent at due time', () => {
    const sched = []; const fired = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED, onSchedule: (e) => sched.push(e), onEvent: (e) => fired.push(e),
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1100));
    expect(sched.every((e) => e.type === 'note_on' || e.type === 'note_off')).toBe(true);
    expect(fired.length).toBe(MIXED.length);
  });

  it('pause rewinds the scheduling index so resume re-schedules pending notes', () => {
    const sched = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED, onEvent: () => {},
      onSchedule: (e, atWall) => sched.push({ note: e.note, type: e.type, atWall }),
      lookaheadMs: 400, tickMs: 100,
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(150));
    const before = sched.length;
    act(() => result.current.pause());
    act(() => result.current.play());
    // Advance far enough that the resume lookahead window (pos + 400ms) reaches
    // note_off64@980 — i.e. the tick at wall 650 (pos 650, horizon 1050). 400ms
    // only reaches pos 550 (horizon 950), one tick short of 980.
    act(() => vi.advanceTimersByTime(500));
    const again = sched.slice(before).filter((s) => s.atWall > 480);
    expect(again.length).toBeGreaterThanOrEqual(2);
  });

  it('pause holds position; resume neither replays nor skips fired events', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(5000));
    expect(fired).toEqual([0, 1]);
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(320));
    expect(fired).toEqual([0, 1, 2]);
  });

  it('seek repositions both planes; the event AT the seek time fires', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.seek(1000));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([2]);
  });

  it('finishes when the FIRE index exhausts (not the schedule index)', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useScoreTransport({ timeline: MIXED, onEvent: () => {}, onSchedule: () => {}, onDone }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
  });

  it('stop resets to the top', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.stop());
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([0, 1, 0]);
  });

  it('reports fire drift and tick gap via onFire; passes dueWall to onEvent', () => {
    const fires = []; const walls = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: [{ t: 0, index: 0, kind: 'step' }, { t: 100, index: 1, kind: 'step' }],
      onEvent: (e, dueWall) => walls.push(dueWall),
      onFire: (e, driftMs, gapMs) => fires.push({ driftMs, gapMs }),
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(200));
    expect(fires.length).toBe(2);
    expect(fires.every((f) => f.driftMs >= 0 && Number.isFinite(f.gapMs))).toBe(true);
    expect(walls).toEqual([0, 100]);
  });
});
