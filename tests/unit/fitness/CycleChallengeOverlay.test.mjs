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
let rpmToAngle;
let polarToCartesian;
let getBoosterAvatarSlots;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/overlays/cycleOverlayVisuals.js');
  getCycleOverlayVisuals = mod.getCycleOverlayVisuals;
  CYCLE_OVERLAY_RING_COLORS = mod.CYCLE_OVERLAY_RING_COLORS;
  rpmToAngle = mod.rpmToAngle;
  polarToCartesian = mod.polarToCartesian;
  getBoosterAvatarSlots = mod.getBoosterAvatarSlots;
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

describe('cycleOverlayVisuals — gauge geometry', () => {
  it('rpm 0 maps to angle π (left edge)', () => {
    expect(rpmToAngle(0, 120)).toBeCloseTo(Math.PI);
  });

  it('rpm equal to gaugeMax maps to angle 2π (right edge)', () => {
    expect(rpmToAngle(120, 120)).toBeCloseTo(2 * Math.PI);
  });

  it('rpm halfway maps to angle 1.5π (top)', () => {
    expect(rpmToAngle(60, 120)).toBeCloseTo(1.5 * Math.PI);
  });

  it('clamps rpm above gaugeMax', () => {
    expect(rpmToAngle(200, 120)).toBeCloseTo(2 * Math.PI);
  });

  it('clamps rpm below 0', () => {
    expect(rpmToAngle(-10, 120)).toBeCloseTo(Math.PI);
  });

  it('treats non-finite rpm as 0 (pinned to left edge)', () => {
    expect(rpmToAngle(NaN, 120)).toBeCloseTo(Math.PI);
    expect(rpmToAngle(undefined, 120)).toBeCloseTo(Math.PI);
  });

  it('invalid gaugeMax returns left edge (fail-safe)', () => {
    expect(rpmToAngle(50, 0)).toBeCloseTo(Math.PI);
    expect(rpmToAngle(50, -10)).toBeCloseTo(Math.PI);
    expect(rpmToAngle(50, NaN)).toBeCloseTo(Math.PI);
  });

  it('scales linearly for intermediate rpm values', () => {
    // 30 rpm on a 120 max → 1/4 of the way → π + π/4 = 1.25π
    expect(rpmToAngle(30, 120)).toBeCloseTo(1.25 * Math.PI);
    // 90 rpm on a 120 max → 3/4 of the way → π + 3π/4 = 1.75π
    expect(rpmToAngle(90, 120)).toBeCloseTo(1.75 * Math.PI);
  });

  it('polarToCartesian: angle π at R=10 gives (-10, 0) offset', () => {
    const { x, y } = polarToCartesian(100, 100, 10, Math.PI);
    expect(x).toBeCloseTo(90);
    expect(y).toBeCloseTo(100);
  });

  it('polarToCartesian: angle 1.5π at R=10 gives (0, -10) offset (SVG top)', () => {
    const { x, y } = polarToCartesian(100, 100, 10, 1.5 * Math.PI);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(90);
  });

  it('polarToCartesian: angle 2π at R=10 gives (+10, 0) offset (right)', () => {
    const { x, y } = polarToCartesian(100, 100, 10, 2 * Math.PI);
    expect(x).toBeCloseTo(110);
    expect(y).toBeCloseTo(100);
  });

  it('polarToCartesian: origin shifts correctly', () => {
    const { x, y } = polarToCartesian(0, 0, 5, Math.PI);
    expect(x).toBeCloseTo(-5);
    expect(y).toBeCloseTo(0);
  });

  it('gauge geometry composes: rpm → angle → point stays on top hemisphere', () => {
    const cx = 110;
    const cy = 110;
    const r = 80;
    // For any rpm in [0, gaugeMax], y of the resulting point should be <= cy.
    for (let rpm = 0; rpm <= 120; rpm += 15) {
      const angle = rpmToAngle(rpm, 120);
      const { y } = polarToCartesian(cx, cy, r, angle);
      expect(y).toBeLessThanOrEqual(cy + 1e-9);
    }
  });
});

describe('getBoosterAvatarSlots', () => {
  it('returns empty array for empty/null input', () => {
    expect(getBoosterAvatarSlots([])).toEqual([]);
    expect(getBoosterAvatarSlots(null)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(getBoosterAvatarSlots(undefined)).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(getBoosterAvatarSlots('felix')).toEqual([]);
    expect(getBoosterAvatarSlots(42)).toEqual([]);
    expect(getBoosterAvatarSlots({})).toEqual([]);
  });

  it('returns one avatar at NE position', () => {
    const slots = getBoosterAvatarSlots(['felix']);
    expect(slots.length).toBe(1);
    expect(slots[0].id).toBe('felix');
    expect(slots[0].initial).toBe('F');
  });

  it('uppercases the first character of the id for the initial', () => {
    const slots = getBoosterAvatarSlots(['alice']);
    expect(slots[0].initial).toBe('A');
  });

  it('caps at 4 boosters', () => {
    const slots = getBoosterAvatarSlots(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(slots.length).toBe(4);
    expect(slots.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('positions 4 boosters in NE, SE, SW, NW order', () => {
    const slots = getBoosterAvatarSlots(['a', 'b', 'c', 'd'], 220);
    // NE: top small, left large
    expect(parseInt(slots[0].style.top, 10)).toBeLessThan(50);
    expect(parseInt(slots[0].style.left, 10)).toBeGreaterThan(150);
    // SE: top large, left large
    expect(parseInt(slots[1].style.top, 10)).toBeGreaterThan(150);
    expect(parseInt(slots[1].style.left, 10)).toBeGreaterThan(150);
    // SW: top large, left small
    expect(parseInt(slots[2].style.top, 10)).toBeGreaterThan(150);
    expect(parseInt(slots[2].style.left, 10)).toBeLessThan(50);
    // NW: top small, left small
    expect(parseInt(slots[3].style.top, 10)).toBeLessThan(50);
    expect(parseInt(slots[3].style.left, 10)).toBeLessThan(50);
  });

  it('defaults overlaySize to 220 when omitted', () => {
    const slots = getBoosterAvatarSlots(['a', 'b']);
    // NE: top 8, left 220-32 = 188
    expect(slots[0].style.top).toBe('8px');
    expect(slots[0].style.left).toBe('188px');
    // SE: top 188, left 188
    expect(slots[1].style.top).toBe('188px');
    expect(slots[1].style.left).toBe('188px');
  });

  it('scales positions with custom overlaySize', () => {
    const slots = getBoosterAvatarSlots(['a'], 300);
    // NE at size 300 → left = 300 - 32 = 268
    expect(slots[0].style.left).toBe('268px');
    expect(slots[0].style.top).toBe('8px');
  });

  it('handles empty-string id gracefully', () => {
    const slots = getBoosterAvatarSlots(['']);
    expect(slots.length).toBe(1);
    expect(slots[0].initial).toBe('?');
  });

  it('returns style with px units (strings)', () => {
    const slots = getBoosterAvatarSlots(['x']);
    expect(typeof slots[0].style.top).toBe('string');
    expect(typeof slots[0].style.left).toBe('string');
    expect(slots[0].style.top.endsWith('px')).toBe(true);
    expect(slots[0].style.left.endsWith('px')).toBe(true);
  });

  it('preserves id verbatim (no case change to id, only initial)', () => {
    const slots = getBoosterAvatarSlots(['KCKern']);
    expect(slots[0].id).toBe('KCKern');
    expect(slots[0].initial).toBe('K');
  });
});
