import { describe, it, expect } from 'vitest';
import { resolveRpmLimits, clampCountedRpm } from './equipmentRpm.js';

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
