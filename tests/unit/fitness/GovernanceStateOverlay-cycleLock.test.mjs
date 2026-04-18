import { describe, it, expect, beforeAll } from '@jest/globals';

/**
 * computeCycleLockPanelData — unit tests (Task 25).
 *
 * Pure helper that maps a cycle challenge snapshot (when locked) to the
 * display data used by `GovernanceStateOverlay`'s cycle-lock panel.
 */

let computeCycleLockPanelData;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/overlays/cycleLockPanelData.js');
  computeCycleLockPanelData = mod.computeCycleLockPanelData;
});

describe('computeCycleLockPanelData', () => {
  it('returns null for non-cycle challenge', () => {
    expect(
      computeCycleLockPanelData({ type: 'zone', cycleState: 'locked' })
    ).toBeNull();
  });

  it('returns null when cycle challenge is not locked', () => {
    expect(
      computeCycleLockPanelData({ type: 'cycle', cycleState: 'maintain' })
    ).toBeNull();
  });

  it('returns null when challenge is null/undefined', () => {
    expect(computeCycleLockPanelData(null)).toBeNull();
    expect(computeCycleLockPanelData(undefined)).toBeNull();
  });

  it('init-lock: instruction mentions init minRpm and uses it as target', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'init',
      currentRpm: 10,
      initMinRpm: 30
    }, 'cool');
    expect(data.instruction).toMatch(/30 RPM/);
    expect(data.targetRpm).toBe(30);
    expect(data.progress).toBeCloseTo(10 / 30, 2);
    expect(data.title).toBe('Cycle Challenge Locked');
  });

  it('init-lock: falls back to selection.init.minRpm when initMinRpm missing', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'init',
      currentRpm: 5,
      selection: { init: { minRpm: 25 } }
    }, 'cool');
    expect(data.targetRpm).toBe(25);
    expect(data.instruction).toMatch(/25 RPM/);
  });

  it('init-lock: defaults target to 30 when no init threshold available', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'init',
      currentRpm: 0
    }, 'cool');
    expect(data.targetRpm).toBe(30);
  });

  it('ramp-lock: instruction mentions hi_rpm as "Climb to"', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'ramp',
      currentRpm: 40,
      currentPhase: { hiRpm: 60, loRpm: 45 }
    }, 'active');
    expect(data.instruction).toMatch(/Climb to 60 RPM/);
    expect(data.targetRpm).toBe(60);
    expect(data.progress).toBeCloseTo(40 / 60, 2);
  });

  it('maintain-lock: instruction says "Reach" and uses hi_rpm', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentRpm: 40,
      currentPhase: { hiRpm: 60 }
    }, 'warm');
    expect(data.instruction).toMatch(/Reach 60 RPM to resume/);
    expect(data.targetRpm).toBe(60);
  });

  it('unknown lockReason: falls back to maintain-style instruction', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'something-else',
      currentRpm: 0,
      currentPhase: { hiRpm: 55 }
    }, 'cool');
    expect(data.instruction).toMatch(/Reach 55 RPM to resume/);
    expect(data.targetRpm).toBe(55);
  });

  it('progress clamps to 1.0 when currentRpm exceeds target', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentRpm: 100,
      currentPhase: { hiRpm: 60 }
    }, 'hot');
    expect(data.progress).toBe(1.0);
  });

  it('progress clamps to 0 when currentRpm is negative', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentRpm: -5,
      currentPhase: { hiRpm: 60 }
    }, 'cool');
    expect(data.progress).toBe(0);
  });

  it('progress is 0 when targetRpm is 0 (no divide-by-zero)', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentRpm: 40,
      currentPhase: { hiRpm: 0 }
    }, 'cool');
    expect(data.progress).toBe(0);
  });

  it('zone defaults to "cool" when not provided', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'init',
      initMinRpm: 30,
      currentRpm: 0
    });
    expect(data.zone).toBe('cool');
  });

  it('passes through provided zone', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'ramp',
      currentRpm: 40,
      currentPhase: { hiRpm: 60 }
    }, 'hot');
    expect(data.zone).toBe('hot');
  });

  it('includes rider object passthrough', () => {
    const rider = { id: 'user_alice', name: 'Alice' };
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentRpm: 10,
      currentPhase: { hiRpm: 60 },
      rider
    }, 'cool');
    expect(data.rider).toBe(rider);
  });

  it('rider is null when challenge.rider is absent', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'init',
      initMinRpm: 30,
      currentRpm: 0
    }, 'cool');
    expect(data.rider).toBeNull();
  });

  it('currentRpm defaults to 0 when not finite', () => {
    const data = computeCycleLockPanelData({
      type: 'cycle',
      cycleState: 'locked',
      lockReason: 'maintain',
      currentPhase: { hiRpm: 60 }
    }, 'cool');
    expect(data.currentRpm).toBe(0);
    expect(data.progress).toBe(0);
  });
});
