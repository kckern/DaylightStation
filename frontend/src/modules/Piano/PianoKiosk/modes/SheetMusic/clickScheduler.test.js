import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClickScheduler, epochToContextMap } from './clickScheduler.js';

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

  it('uses the supplied phase and accents beat one of each measure', () => {
    const ac = fakeCtx();
    const beats = [];
    const s = createClickScheduler({
      getCtx: () => ac,
      scheduleBlip: (_a, t, options) => beats.push({ t, ...options }),
      lookaheadS: 2,
      tickMs: 100,
    });
    s.start(120, { firstBeatDelayS: 0.25, beatsPerBar: 3, firstBeatIndex: 2 });
    expect(beats.map(({ t, accent }) => ({ t, accent }))).toEqual([
      { t: 0.25, accent: false },
      { t: 0.75, accent: true },
      { t: 1.25, accent: false },
      { t: 1.75, accent: false },
    ]);
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

  describe('anchored grid (start(bpm, { anchorEpochMs, leadMs }))', () => {
    // Epoch 1_000_000 ms ↔ audio clock 10 s. performance.timeOrigin 999_000, so
    // performanceTime 1000 ms is epoch 1_000_000.
    const EPOCH = 1_000_000;

    it('lands beat n at anchor + n·period − lead on the audio clock (output timestamp)', () => {
      const ac = { ...fakeCtx(), currentTime: 10.05, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }) };
      const beats = [];
      const s = createClickScheduler({
        getCtx: () => ac, scheduleBlip: (_a, t) => beats.push(t), lookaheadS: 2, tickMs: 100,
        now: () => EPOCH + 60, timeOrigin: () => EPOCH - 1000,
      });
      const info = s.start(120, { anchorEpochMs: EPOCH + 500, leadMs: 200 });
      // beat 0 = epoch +300 → ctx 10.3; then 10.8, 11.3, 11.8 (< horizon 12.05)
      expect(beats.map((t) => +t.toFixed(3))).toEqual([10.3, 10.8, 11.3, 11.8]);
      expect(info).toMatchObject({ anchored: true, mapping: 'output-timestamp', skipped: 0, leadMs: 200 });
      s.stop();
    });

    it('falls back to currentTime paired with Date.now() when there is no output timestamp', () => {
      const ac = { ...fakeCtx(), currentTime: 5 };
      const beats = [];
      const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => beats.push(t), lookaheadS: 1, now: () => EPOCH });
      const info = s.start(60, { anchorEpochMs: EPOCH + 400, leadMs: 150 });
      expect(beats.map((t) => +t.toFixed(3))).toEqual([5.25]);
      expect(info.mapping).toBe('current-time');
      s.stop();
    });

    it('skips beats already in the past but keeps phase and the measure accent', () => {
      const ac = { ...fakeCtx(), currentTime: 20 };
      const beats = [];
      const s = createClickScheduler({
        getCtx: () => ac, scheduleBlip: (_a, t, o) => beats.push({ t: +t.toFixed(3), accent: o.accent }), lookaheadS: 1.3, now: () => EPOCH,
      });
      // Anchor 1.3 s ago at 120 bpm: beats 0,1,2 (−1.3, −0.8, −0.3 s) are past.
      const info = s.start(120, { anchorEpochMs: EPOCH - 1300, leadMs: 0, beatsPerBar: 4 });
      expect(info.skipped).toBe(3);
      expect(beats).toEqual([
        { t: 20.2, accent: false }, // n=3
        { t: 20.7, accent: true },  // n=4 → beat one of bar 2
        { t: 21.2, accent: false }, // n=5
      ]);
      s.stop();
    });

    it('setBpm still retunes an anchored grid from the next beat', () => {
      const ac = { ...fakeCtx(), currentTime: 0 };
      const beats = [];
      const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => beats.push(+t.toFixed(3)), lookaheadS: 1.2, now: () => EPOCH });
      s.start(60, { anchorEpochMs: EPOCH + 100 });
      expect(beats).toEqual([0.1, 1.1]);
      s.setBpm(120);
      ac.currentTime = 1.0; vi.advanceTimersByTime(100);
      expect(beats).toEqual([0.1, 1.1, 1.6, 2.1]);
      s.stop();
    });

    it('without an anchor, behaves exactly as before (first beat +80 ms)', () => {
      const ac = { ...fakeCtx(), currentTime: 3, getOutputTimestamp: () => ({ contextTime: 2.9, performanceTime: 1000 }) };
      const beats = [];
      const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => beats.push(+t.toFixed(3)), lookaheadS: 0.3 });
      expect(s.start(120)).toEqual({ anchored: false });
      expect(beats).toEqual([3.08]);
      s.stop();
    });
  });

  describe('epochToContextMap', () => {
    it('uses a sane output timestamp', () => {
      const ac = { currentTime: 10.05, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }) };
      const m = epochToContextMap(ac, { now: () => 1_000_060, timeOrigin: () => 999_000 });
      expect(m.mapping).toBe('output-timestamp');
      expect(m.toContext(1_000_500)).toBeCloseTo(10.5, 6);
    });

    it('rejects a zeroed timestamp and folds the reported latency into the paired fallback', () => {
      const ac = { currentTime: 4, outputLatency: 0.05, baseLatency: 0.01, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) };
      const m = epochToContextMap(ac, { now: () => 1_000_000, timeOrigin: () => 999_000 });
      expect(m.mapping).toBe('current-time+latency');
      // audible at epoch+1000 → render at ctx 4 + 1 − 0.06
      expect(m.toContext(1_001_000)).toBeCloseTo(4.94, 6);
    });

    it('rejects a timestamp more than a second away from the render clock', () => {
      const ac = { currentTime: 50, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }) };
      const m = epochToContextMap(ac, { now: () => 1_000_000, timeOrigin: () => 999_000 });
      expect(m.mapping).toBe('current-time');
      expect(m.toContext(1_000_000)).toBe(50);
    });
  });
});
