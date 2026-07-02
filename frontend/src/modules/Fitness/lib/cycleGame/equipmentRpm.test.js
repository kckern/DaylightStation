import { describe, it, expect } from 'vitest';
import { resolveRpmLimits, clampCountedRpm, rpmDuringGap } from './equipmentRpm.js';

describe('resolveRpmLimits', () => {
  it('uses the equipment max_rpm as the gauge scale', () => {
    expect(resolveRpmLimits({ max_rpm: 250 }).gaugeMaxRpm).toBe(250);
  });
  it('defaults the gauge to 120 when max_rpm is absent or invalid', () => {
    expect(resolveRpmLimits({}).gaugeMaxRpm).toBe(120);
    expect(resolveRpmLimits({ max_rpm: 0 }).gaugeMaxRpm).toBe(120);
  });
  it('reports an abuse cap only when abuse_max_rpm is set (else null = uncapped)', () => {
    expect(resolveRpmLimits({ abuse_max_rpm: 120 }).abuseMaxRpm).toBe(120);
    expect(resolveRpmLimits({ max_rpm: 250 }).abuseMaxRpm).toBeNull();
  });
});

describe('clampCountedRpm', () => {
  it('caps the counted RPM when an abuse cap is set', () => {
    expect(clampCountedRpm(300, 120)).toBe(120);
  });
  it('passes RPM through untouched when uncapped (null)', () => {
    expect(clampCountedRpm(300, null)).toBe(300);
  });
  it('coerces non-finite RPM to 0', () => {
    expect(clampCountedRpm(undefined, null)).toBe(0);
  });
});

describe('rpmDuringGap', () => {
  it('holds the last RPM when the rider was steady/high (abrupt cut = sensor gap)', () => {
    expect(rpmDuringGap([186, 180, 175])).toBe(175); // 175 ≥ 70% of peak 186 → hold
  });
  it('holds when accelerating into the gap', () => {
    expect(rpmDuringGap([170, 180, 186])).toBe(186);
  });
  it('honors zero when the rider was decelerating into the gap (real cooldown)', () => {
    expect(rpmDuringGap([186, 120, 60])).toBe(0); // 60 < 70% of 186 → cooldown → drop
    expect(rpmDuringGap([100, 80, 50])).toBe(0);
  });
  it('returns 0 with no history or when already at rest', () => {
    expect(rpmDuringGap([])).toBe(0);
    expect(rpmDuringGap([0])).toBe(0);
  });
  it('holds a single steady reading', () => {
    expect(rpmDuringGap([150])).toBe(150);
  });

  // Backward-compatible default: gapTicks omitted ⇒ behaves as tick 1 (the
  // pre-cap hold), so any other caller/test that doesn't pass gapTicks is
  // unaffected by the cap.
  it('defaults gapTicks to 1 (full hold) when omitted', () => {
    expect(rpmDuringGap([186, 180, 175])).toBe(rpmDuringGap([186, 180, 175], 1));
  });

  it('holds the full value through ticks 1-5 of a gap', () => {
    for (let t = 1; t <= 5; t += 1) {
      expect(rpmDuringGap([186, 180, 175], t)).toBe(175);
    }
  });

  it('decays the held value by half per tick across ticks 6-8', () => {
    expect(rpmDuringGap([100], 6)).toBe(50);
    expect(rpmDuringGap([100], 7)).toBe(25);
    expect(rpmDuringGap([100], 8)).toBe(12.5);
  });

  it('goes to 0 at tick 9 and beyond — a dead sensor stops riding forever (audit game-design #6)', () => {
    expect(rpmDuringGap([100], 9)).toBe(0);
    expect(rpmDuringGap([100], 20)).toBe(0);
    expect(rpmDuringGap([100], 500)).toBe(0);
  });

  it('still honors the cooldown heuristic during the hold/decay phase (decelerating ⇒ 0 at any tick)', () => {
    expect(rpmDuringGap([186, 120, 60], 1)).toBe(0);
    expect(rpmDuringGap([186, 120, 60], 5)).toBe(0);
    expect(rpmDuringGap([186, 120, 60], 7)).toBe(0); // 0 held ⇒ decay of 0 is still 0
  });

  it('never resurrects a rider once already at rest, regardless of gapTicks', () => {
    expect(rpmDuringGap([0], 1)).toBe(0);
    expect(rpmDuringGap([], 9)).toBe(0);
  });
});
