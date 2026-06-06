/**
 * hrPlausibility — shared HR floor/ceiling used by the timeline + metrics
 * recorders. Guards against phantom-strap ghosts (e.g. the 11 BPM device:28690
 * leak observed 2026-06-05) reaching the recorded session series.
 */
import { describe, it, expect } from 'vitest';

import { sanitizeHeartRate, MIN_PLAUSIBLE_HR, MAX_PLAUSIBLE_HR } from './hrPlausibility.js';

describe('sanitizeHeartRate', () => {
  it('rejects the phantom-strap lows that leaked into the timeline (11, 10, 2)', () => {
    expect(sanitizeHeartRate(11)).toBeNull();
    expect(sanitizeHeartRate(10)).toBeNull();
    expect(sanitizeHeartRate(2)).toBeNull();
  });

  it('rejects zero and negatives', () => {
    expect(sanitizeHeartRate(0)).toBeNull();
    expect(sanitizeHeartRate(-5)).toBeNull();
  });

  it('rejects readings below the floor and above the ceiling', () => {
    expect(sanitizeHeartRate(MIN_PLAUSIBLE_HR - 1)).toBeNull();
    expect(sanitizeHeartRate(MAX_PLAUSIBLE_HR + 1)).toBeNull();
  });

  it('keeps real readings, including a hard-effort youth max (207)', () => {
    expect(sanitizeHeartRate(69)).toBe(69);
    expect(sanitizeHeartRate(129)).toBe(129);
    expect(sanitizeHeartRate(207)).toBe(207);
  });

  it('keeps the inclusive boundaries', () => {
    expect(sanitizeHeartRate(MIN_PLAUSIBLE_HR)).toBe(MIN_PLAUSIBLE_HR);
    expect(sanitizeHeartRate(MAX_PLAUSIBLE_HR)).toBe(MAX_PLAUSIBLE_HR);
  });

  it('rounds fractional readings and rejects non-numeric / nullish input', () => {
    expect(sanitizeHeartRate(72.4)).toBe(72);
    expect(sanitizeHeartRate(null)).toBeNull();
    expect(sanitizeHeartRate(undefined)).toBeNull();
    expect(sanitizeHeartRate('abc')).toBeNull();
  });
});
