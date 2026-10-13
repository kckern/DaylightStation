import { describe, it, expect } from 'vitest';
import { aqiColor, AQI_COLORS } from './aqiColor.js';

describe('aqiColor', () => {
  it('keeps the old band thresholds', () => {
    expect(aqiColor(0)).toBe(AQI_COLORS.good);
    expect(aqiColor(49)).toBe(AQI_COLORS.good);
    expect(aqiColor(50)).toBe(AQI_COLORS.moderate);
    expect(aqiColor(100)).toBe(AQI_COLORS.sensitive);
    expect(aqiColor(150)).toBe(AQI_COLORS.unhealthy);
  });
});
