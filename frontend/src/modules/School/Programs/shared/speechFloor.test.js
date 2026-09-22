import { describe, expect, it } from 'vitest';
import { MIN_TAKE_MS, SILENT_AFTER_MS, SILENT_LEVEL, judgeTake } from './speechFloor.js';

describe('speech floor', () => {
  it('keeps the measured thresholds', () => {
    expect([SILENT_LEVEL, SILENT_AFTER_MS, MIN_TAKE_MS]).toEqual([0.04, 2000, 1200]);
  });
  it('refuses a measured take that was never heard', () => {
    expect(judgeTake({ heard: false, sampled: true, durationMs: 3000 })).toBe('too-quiet');
  });
  it('never refuses on loudness it could not measure', () => {
    expect(judgeTake({ heard: false, sampled: false, durationMs: 3000 })).toBeNull();
  });
  it('refuses a take shorter than the floor', () => {
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1199 })).toBe('too-short');
    expect(judgeTake({ heard: true, sampled: true, durationMs: 1200 })).toBeNull();
  });
});
