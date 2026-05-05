import { describe, it, expect } from 'vitest';
import { getCycleOverlayVisuals } from './cycleOverlayVisuals.js';

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

  it('exposes dangerActive=true when challenge.dangerActive is true', () => {
    const v = getCycleOverlayVisuals({
      ...baseChallenge,
      dangerActive: true,
      dangerRemainingMs: 1500,
      dangerProgress: 0.5
    });
    expect(v.dangerActive).toBe(true);
    expect(v.dangerRemainingMs).toBe(1500);
    expect(v.dangerProgress).toBe(0.5);
  });

  it('defaults dangerActive=false, dangerProgress=1, dangerRemainingMs=null when absent', () => {
    const v = getCycleOverlayVisuals(baseChallenge);
    expect(v.dangerActive).toBe(false);
    expect(v.dangerRemainingMs).toBeNull();
    expect(v.dangerProgress).toBe(1);
  });
});
