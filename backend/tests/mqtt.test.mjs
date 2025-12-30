import { jest } from '@jest/globals';
import { buildSensorTopicMap, validateVibrationPayload } from '../lib/mqtt.mjs';

describe('mqtt.mjs utilities', () => {
  describe('buildSensorTopicMap', () => {
    it('builds map from valid equipment config', () => {
      const equipment = [
        {
          id: 'punching_bag',
          name: 'Punching Bag',
          type: 'punching_bag',
          sensor: { type: 'vibration', mqtt_topic: 'zigbee/sensor1' },
          thresholds: { low: 5, medium: 15, high: 30 },
        },
      ];

      const map = buildSensorTopicMap(equipment);
      expect(map.size).toBe(1);
      expect(map.get('zigbee/sensor1')).toEqual({
        id: 'punching_bag',
        name: 'Punching Bag',
        type: 'punching_bag',
        thresholds: { low: 5, medium: 15, high: 30 },
      });
    });

    it('skips equipment without vibration sensors', () => {
      const equipment = [
        { id: 'bike', name: 'Bike', type: 'bike' },
        { id: 'bag', sensor: { type: 'heartrate' } },
      ];

      const map = buildSensorTopicMap(equipment);
      expect(map.size).toBe(0);
    });

    it('uses default thresholds when missing', () => {
      const equipment = [
        {
          id: 'test',
          name: 'Test',
          type: 'test',
          sensor: { type: 'vibration', mqtt_topic: 'test/topic' },
        },
      ];

      const map = buildSensorTopicMap(equipment);
      expect(map.get('test/topic').thresholds).toEqual({ low: 5, medium: 15, high: 30 });
    });

    it('handles null or undefined equipment', () => {
      expect(buildSensorTopicMap(null).size).toBe(0);
      expect(buildSensorTopicMap(undefined).size).toBe(0);
    });

    it('warns and returns empty map for non-array input', () => {
      expect(buildSensorTopicMap('invalid').size).toBe(0);
      expect(buildSensorTopicMap({ foo: 'bar' }).size).toBe(0);
    });
  });

  describe('validateVibrationPayload', () => {
    it('accepts valid payload', () => {
      const payload = {
        vibration: true,
        x_axis: 10.5,
        y_axis: -3.2,
        z_axis: 8.0,
        battery: 95,
        voltage: 3100,
        linkquality: 156,
        battery_low: false,
      };

      const result = validateVibrationPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('requires vibration to be boolean', () => {
      const result = validateVibrationPayload({ vibration: 'yes' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('vibration must be a boolean');
    });

    it('rejects non-numeric axis values', () => {
      const result = validateVibrationPayload({ vibration: true, x_axis: 'bad' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('x_axis must be a number if provided');
    });

    it('validates battery range', () => {
      const result = validateVibrationPayload({ vibration: true, battery: 150 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('battery must be between 0 and 100');
    });

    it('accepts null or undefined optional fields', () => {
      const result = validateVibrationPayload({ vibration: false, x_axis: null, battery: undefined });
      expect(result.valid).toBe(true);
    });

    it('rejects null payload', () => {
      const result = validateVibrationPayload(null);
      expect(result.valid).toBe(false);
    });
  });
});
