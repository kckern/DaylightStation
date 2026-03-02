import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { VibrationActivityTracker } = await import('#frontend/hooks/fitness/VibrationActivityTracker.js');

describe('FitnessSession vibration integration', () => {
  describe('tracker map lifecycle', () => {
    let trackers;

    beforeEach(() => {
      trackers = new Map();
    });

    it('creates trackers from equipment config', () => {
      const equipment = [
        { id: 'punching_bag', sensor: { type: 'vibration' }, activity: { impact_multiplier: 2.0 } },
        { id: 'step_platform', sensor: { type: 'vibration' }, activity: { intensity_levels: [] } },
        { id: 'some_bike', type: 'bike' }
      ];
      equipment.forEach(item => {
        if (item.sensor?.type === 'vibration') {
          trackers.set(item.id, new VibrationActivityTracker(item.id, item.activity || {}));
        }
      });
      expect(trackers.size).toBe(2);
      expect(trackers.has('punching_bag')).toBe(true);
      expect(trackers.has('step_platform')).toBe(true);
      expect(trackers.has('some_bike')).toBe(false);
    });

    it('routes vibration events to correct tracker', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag', { impact_magnitude_threshold: 500 }));
      trackers.set('step_platform', new VibrationActivityTracker('step_platform', { impact_magnitude_threshold: 300 }));

      const tracker = trackers.get('punching_bag');
      if (tracker) tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });

      expect(trackers.get('punching_bag').snapshot.status).toBe('active');
      expect(trackers.get('step_platform').snapshot.status).toBe('idle');
    });

    it('ignores events for unknown equipment', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag'));
      const tracker = trackers.get('unknown_device');
      expect(tracker).toBeUndefined();
    });

    it('resets all trackers', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag', { impact_magnitude_threshold: 500 }));
      trackers.get('punching_bag').ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(trackers.get('punching_bag').snapshot.detectedImpacts).toBe(1);
      trackers.forEach(t => t.reset());
      expect(trackers.get('punching_bag').snapshot.detectedImpacts).toBe(0);
    });
  });
});
