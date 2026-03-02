// tests/unit/fitness/VibrationActivityTracker-timeline.test.mjs
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { VibrationActivityTracker } = await import('#frontend/hooks/fitness/VibrationActivityTracker.js');

describe('VibrationActivityTracker timeline series', () => {
  it('produces series-ready values from snapshot', () => {
    const tracker = new VibrationActivityTracker('punching_bag', {
      impact_magnitude_threshold: 500,
      impact_multiplier: 2.0,
      intensity_levels: [500, 1000, 1500]
    });

    // Idle state
    let snap = tracker.snapshot;
    expect(snap.status === 'active' ? 1 : 0).toBe(0);

    // Active state
    tracker.ingest({ vibration: true, x_axis: 800, y_axis: 0, z_axis: 0, timestamp: 1000 });
    snap = tracker.snapshot;
    expect(snap.status === 'active' ? 1 : 0).toBe(1);
    expect(snap.currentIntensity).toBe(800);
    expect(snap.estimatedImpacts).toBe(2); // 1 detected * 2.0 multiplier
  });
});
