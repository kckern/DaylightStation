import { describe, it, expect, beforeAll } from '@jest/globals';

/**
 * getCycleOverlayVisuals(challenge) — unit tests (Task 21).
 *
 * Pure helper that maps a cycle challenge snapshot to the outer ring visuals
 * (color, opacity, dim pulse) and visibility flag used by CycleChallengeOverlay.
 *
 * Lives in its own module so we can unit-test the state → visual mapping
 * without spinning up React Testing Library (matches Task 20 precedent —
 * jest's `testEnvironment: 'node'`).
 */

let getCycleOverlayVisuals;
let CYCLE_OVERLAY_RING_COLORS;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/overlays/cycleOverlayVisuals.js');
  getCycleOverlayVisuals = mod.getCycleOverlayVisuals;
  CYCLE_OVERLAY_RING_COLORS = mod.CYCLE_OVERLAY_RING_COLORS;
});

describe('getCycleOverlayVisuals', () => {
  it('returns slate-blue ring color for init state', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'init', dimFactor: 0 });
    expect(v.ringColor).toBe('#64748b');
    expect(v.visible).toBe(true);
  });

  it('returns yellow for ramp', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'ramp', dimFactor: 0 });
    expect(v.ringColor).toBe('#f59e0b');
  });

  it('returns green for maintain at hi (dimFactor=0)', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0 });
    expect(v.ringColor).toBe('#22c55e');
    expect(v.dimPulse).toBe(false);
  });

  it('returns orange for maintain in dim band (dimFactor > 0)', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0.5 });
    expect(v.ringColor).toBe('#f97316');
    expect(v.dimPulse).toBe(true);
  });

  it('returns red for locked', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'locked', dimFactor: 0 });
    expect(v.ringColor).toBe('#ef4444');
  });

  it('null challenge returns not visible', () => {
    const v = getCycleOverlayVisuals(null);
    expect(v.visible).toBe(false);
  });

  it('undefined challenge returns not visible', () => {
    const v = getCycleOverlayVisuals(undefined);
    expect(v.visible).toBe(false);
  });

  it('non-cycle challenge (type=zone) is not visible', () => {
    const v = getCycleOverlayVisuals({ type: 'zone', cycleState: 'init' });
    expect(v.visible).toBe(false);
  });

  it('non-cycle challenge (type=hr) is not visible', () => {
    const v = getCycleOverlayVisuals({ type: 'hr', status: 'active', dimFactor: 0.7 });
    expect(v.visible).toBe(false);
  });

  it('cycle challenge without cycleState is not visible', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle' });
    expect(v.visible).toBe(false);
  });

  it('ring opacity dims as dimFactor approaches 1', () => {
    const full = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0 });
    const dim = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 1 });
    expect(dim.ringOpacity).toBeLessThan(full.ringOpacity);
  });

  it('ring opacity for fully-dimmed maintain still has a floor (> 0)', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 1 });
    expect(v.ringOpacity).toBeGreaterThan(0);
  });

  it('ring opacity for maintain at dimFactor=0 is full brightness', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0 });
    expect(v.ringOpacity).toBe(1);
  });

  it('clamps dimFactor above 1 to 1 for opacity calc', () => {
    const a = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 1 });
    const b = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 2.5 });
    expect(b.ringOpacity).toBe(a.ringOpacity);
  });

  it('clamps dimFactor below 0 to 0 (stays green)', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: -0.5 });
    expect(v.ringColor).toBe('#22c55e');
    expect(v.dimPulse).toBe(false);
  });

  it('treats non-numeric dimFactor as 0', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 'half' });
    expect(v.ringColor).toBe('#22c55e');
    expect(v.dimPulse).toBe(false);
  });

  it('passes through phaseProgressPct clamped to [0..1]', () => {
    expect(getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', phaseProgressPct: 0.4 })
      .phaseProgress).toBe(0.4);
    expect(getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', phaseProgressPct: 2 })
      .phaseProgress).toBe(1);
    expect(getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', phaseProgressPct: -1 })
      .phaseProgress).toBe(0);
  });

  it('treats missing phaseProgressPct as 0', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'init' });
    expect(v.phaseProgress).toBe(0);
  });

  it('accepts cycleState in mixed case (case-insensitive)', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'LOCKED' });
    expect(v.ringColor).toBe('#ef4444');
    expect(v.visible).toBe(true);
  });

  it('unknown cycleState returns not visible', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'bogus' });
    expect(v.visible).toBe(false);
  });

  it('infers cycle type when challenge has cycleState but no type field', () => {
    const v = getCycleOverlayVisuals({ cycleState: 'ramp', dimFactor: 0 });
    expect(v.visible).toBe(true);
    expect(v.ringColor).toBe('#f59e0b');
  });

  it('exposes the canonical color palette as a frozen object', () => {
    expect(CYCLE_OVERLAY_RING_COLORS.init).toBe('#64748b');
    expect(CYCLE_OVERLAY_RING_COLORS.ramp).toBe('#f59e0b');
    expect(CYCLE_OVERLAY_RING_COLORS.maintainGreen).toBe('#22c55e');
    expect(CYCLE_OVERLAY_RING_COLORS.maintainOrange).toBe('#f97316');
    expect(CYCLE_OVERLAY_RING_COLORS.locked).toBe('#ef4444');
    expect(Object.isFrozen(CYCLE_OVERLAY_RING_COLORS)).toBe(true);
  });

  it('not-visible result also has positionValid=false', () => {
    expect(getCycleOverlayVisuals(null).positionValid).toBe(false);
  });

  it('visible result has positionValid=true', () => {
    expect(getCycleOverlayVisuals({ type: 'cycle', cycleState: 'init' }).positionValid).toBe(true);
  });
});
