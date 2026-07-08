import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClickScheduler } from './clickScheduler.js';

function fakeCtx() { return { currentTime: 0, state: 'running', resume: vi.fn() }; }

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createClickScheduler', () => {
  it('schedules every beat inside the lookahead window on the AUDIO clock', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_ac, t) => blips.push(t), lookaheadS: 0.3, tickMs: 100 });
    s.start(120); // period 0.5s; first beat ~ +0.08
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08]);
    ac.currentTime = 0.4; vi.advanceTimersByTime(100);
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 0.58]);
    s.stop();
  });

  it('never schedules the same beat twice even when ticks overlap windows', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t), lookaheadS: 0.3, tickMs: 100 });
    s.start(120);
    vi.advanceTimersByTime(100); // audio clock hasn't moved — window unchanged
    expect(blips.length).toBe(1);
    s.stop();
  });

  it('setBpm changes spacing from the NEXT beat (keeps phase, no restart)', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t), lookaheadS: 1.2, tickMs: 100 });
    s.start(60); // period 1s → beats 0.08, 1.08 within 1.2
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 1.08]);
    s.setBpm(120); // period 0.5 from the next unscheduled beat
    ac.currentTime = 1.0; vi.advanceTimersByTime(100); // horizon 2.2 → 1.58, 2.08
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 1.08, 1.58, 2.08]);
    s.stop();
  });

  it('guards non-positive bpm — start(<=0) schedules nothing and never loops', () => {
    // Without the `bpm > 0` guard, a negative bpm makes periodS < 0, so
    // `nextBeat += periodS` decreases forever and the while loop hangs the tab.
    // With the guard, start() returns early: no blips, no timer.
    for (const bad of [-120, 0]) {
      const ac = fakeCtx();
      const blips = [];
      const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t) });
      s.start(bad);
      expect(blips.length).toBe(0);
      ac.currentTime = 10; vi.advanceTimersByTime(1000); // no timer should be firing
      expect(blips.length).toBe(0);
      s.stop();
    }
  });

  it('stop halts future scheduling', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t) });
    s.start(120);
    s.stop();
    ac.currentTime = 5; vi.advanceTimersByTime(1000);
    expect(blips.length).toBe(1);
  });
});
