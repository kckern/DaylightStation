/**
 * HA detection source tests.
 *
 * HA reports state CHANGES, not samples, so collapsing a series into "on"
 * intervals has two easy mistakes: dropping a detection that was still active
 * at the window edge, and treating a missing closing point as no-detection.
 * Both lose real events silently.
 */

import { describe, it, expect } from 'vitest';
import { createHaDetectionSource } from './HaDetectionSource.mjs';

const SENSORS = {
  doorbell: { person: 'binary_sensor.front_door_person', visitor: 'binary_sensor.front_door_visitor' },
};

function gatewayReturning(map) {
  return { getHistory: async () => new Map(Object.entries(map)) };
}

describe('createHaDetectionSource', () => {
  it('collapses on/off transitions into labelled intervals', async () => {
    const src = createHaDetectionSource({
      haGateway: gatewayReturning({
        'binary_sensor.front_door_person': [
          { t: '2026-07-17T10:00:00-07:00', v: 'off' },
          { t: '2026-07-17T10:01:00-07:00', v: 'on' },
          { t: '2026-07-17T10:02:00-07:00', v: 'off' },
        ],
      }),
      sensorsByCamera: SENSORS,
      logger: { debug() {}, warn() {} },
    });
    const out = await src.fetchDay('doorbell', '2026-07-17');
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('person');
    expect(out[0].start).toBe('2026-07-17T10:01:00-07:00');
  });

  it('clamps a still-active detection to the end of the day instead of dropping it', async () => {
    const src = createHaDetectionSource({
      haGateway: gatewayReturning({
        'binary_sensor.front_door_person': [{ t: '2026-07-17T23:58:00-07:00', v: 'on' }],
      }),
      sensorsByCamera: SENSORS,
      logger: { debug() {}, warn() {} },
    });
    const out = await src.fetchDay('doorbell', '2026-07-17');
    expect(out).toHaveLength(1);
    expect(new Date(out[0].end).getTime()).toBeGreaterThan(new Date(out[0].start).getTime());
  });

  it('ignores entities not present in the sensor map', async () => {
    const src = createHaDetectionSource({
      haGateway: gatewayReturning({
        'binary_sensor.unrelated_thing': [{ t: '2026-07-17T10:00:00-07:00', v: 'on' }],
      }),
      sensorsByCamera: SENSORS,
      logger: { debug() {}, warn() {} },
    });
    expect(await src.fetchDay('doorbell', '2026-07-17')).toEqual([]);
  });

  it('returns empty rather than throwing when HA is unreachable', async () => {
    const src = createHaDetectionSource({
      haGateway: { getHistory: async () => { throw new Error('ECONNREFUSED'); } },
      sensorsByCamera: SENSORS,
      logger: { debug() {}, warn() {} },
    });
    // The ledger must still run on filename bits + density if HA is down.
    expect(await src.fetchDay('doorbell', '2026-07-17')).toEqual([]);
  });

  it('returns empty for a camera with no configured sensors', async () => {
    const src = createHaDetectionSource({
      haGateway: gatewayReturning({}),
      sensorsByCamera: {},
      logger: { debug() {}, warn() {} },
    });
    expect(await src.fetchDay('driveway-camera', '2026-07-17')).toEqual([]);
  });
});
