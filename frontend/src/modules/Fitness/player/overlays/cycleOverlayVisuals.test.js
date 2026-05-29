import { describe, it, expect } from 'vitest';
import { getCycleOverlayVisuals, getBoosterAvatarSlots } from './cycleOverlayVisuals.js';

describe('cycleOverlayVisuals — extended state', () => {
  const baseChallenge = {
    type: 'cycle',
    cycleState: 'init',
    dimFactor: 0,
    phaseProgressPct: 0
  };

  it('exposes lostSignal flag from cadenceFlags', () => {
    const v = getCycleOverlayVisuals({
      ...baseChallenge,
      cadenceFlags: { lostSignal: true, stale: false, smoothed: false, implausible: false }
    });
    expect(v.lostSignal).toBe(true);
  });

  it('exposes stale flag from cadenceFlags', () => {
    const v = getCycleOverlayVisuals({
      ...baseChallenge,
      cadenceFlags: { lostSignal: false, stale: true, smoothed: true, implausible: false }
    });
    expect(v.stale).toBe(true);
  });

  it('exposes waitingForBaseReq flag', () => {
    const v = getCycleOverlayVisuals({ ...baseChallenge, waitingForBaseReq: true });
    expect(v.waitingForBaseReq).toBe(true);
  });

  it('exposes clockPaused flag', () => {
    const v = getCycleOverlayVisuals({ ...baseChallenge, clockPaused: true });
    expect(v.clockPaused).toBe(true);
  });

  it('exposes initRemainingMs and rampRemainingMs', () => {
    const v = getCycleOverlayVisuals({
      ...baseChallenge,
      initRemainingMs: 23000,
      rampRemainingMs: 7000
    });
    expect(v.initRemainingMs).toBe(23000);
    expect(v.rampRemainingMs).toBe(7000);
  });

  it('defaults extended fields to safe values when absent', () => {
    const v = getCycleOverlayVisuals(baseChallenge);
    expect(v.lostSignal).toBe(false);
    expect(v.stale).toBe(false);
    expect(v.waitingForBaseReq).toBe(false);
    expect(v.clockPaused).toBe(false);
    expect(v.initRemainingMs).toBeNull();
    expect(v.rampRemainingMs).toBeNull();
  });

  it('returns visible:false for non-cycle challenge', () => {
    const v = getCycleOverlayVisuals({ type: 'zone', cycleState: null });
    expect(v.visible).toBe(false);
  });

});

describe('cycleOverlayVisuals — health meter', () => {
  it('passes through cycleHealthPct', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0, phaseProgressPct: 0.4, cycleHealthPct: 0.5 });
    expect(v.cycleHealthPct).toBe(0.5);
  });
  it('defaults cycleHealthPct to 1 when absent', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0, phaseProgressPct: 0 });
    expect(v.cycleHealthPct).toBe(1);
  });
});

describe('getBoosterAvatarSlots — percentage positioning', () => {
  it('returns percentage-based positions, not pixels', () => {
    const slots = getBoosterAvatarSlots(['kc', 'alan']);
    expect(slots).toHaveLength(2);
    expect(slots[0].style).toEqual({ top: '16%', left: '84%' }); // NE
    expect(slots[1].style).toEqual({ top: '84%', left: '84%' }); // SE
    expect(slots[0].style.left.endsWith('%')).toBe(true);
    expect(slots[0].style.top.endsWith('%')).toBe(true);
  });

  it('is independent of any overlay-size argument', () => {
    const a = getBoosterAvatarSlots(['kc'], 220);
    const b = getBoosterAvatarSlots(['kc'], 160);
    expect(a[0].style).toEqual(b[0].style);
  });

  it('caps at four entries and uppercases the initial', () => {
    const slots = getBoosterAvatarSlots(['a', 'b', 'c', 'd', 'e']);
    expect(slots).toHaveLength(4);
    expect(getBoosterAvatarSlots(['kc'])[0].initial).toBe('K');
  });

  it('returns [] for empty or non-array input', () => {
    expect(getBoosterAvatarSlots([])).toEqual([]);
    expect(getBoosterAvatarSlots(null)).toEqual([]);
  });
});

