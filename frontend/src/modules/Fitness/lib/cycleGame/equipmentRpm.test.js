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
});
