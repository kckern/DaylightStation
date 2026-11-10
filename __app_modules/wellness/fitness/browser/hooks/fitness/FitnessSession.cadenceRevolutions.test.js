/**
 * cadence_floor counts crank turns BETWEEN calls, so the counter on a cadence
 * map entry must come from one sensor and survive a quiet second. Before, it
 * rode on whichever wheel won on rpm and vanished from a "disconnected" read.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

afterEach(() => vi.useRealTimers());

const setup = (cadence) => {
  const session = new FitnessSession();
  session._equipmentById.set('tricycle', { id: 'tricycle', cadence });
  return session;
};

describe('FitnessSession.getEquipmentCadence — revolution counter', () => {
  it('takes the counter from the first configured sensor, not the fastest wheel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const session = setup(['left', 'right']);
    const left = session.deviceManager.registerDevice({ id: 'left', type: 'cadence', cadence: 40, revolutionCount: 100 });
    const right = session.deviceManager.registerDevice({ id: 'right', type: 'cadence', cadence: 70, revolutionCount: 900 });
    left.update({ cadence: 40, revolutionCount: 100, lastSeen: 10_000 });
    right.update({ cadence: 70, revolutionCount: 900, lastSeen: 10_000 });
    const reading = session.getEquipmentCadence('tricycle');
    expect(reading.rpm).toBe(70);
    expect(reading).toMatchObject({ revolutions: 100, deviceId: 'left' });
  });

  it('keeps the counter on a reading that has gone quiet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const session = setup('solo');
    const solo = session.deviceManager.registerDevice({ id: 'solo', type: 'cadence', cadence: 55, revolutionCount: 42 });
    solo.update({ cadence: 55, revolutionCount: 42, lastSeen: 10_000 });
    vi.setSystemTime(20_000);
    const reading = session.getEquipmentCadence('tricycle');
    expect(reading.connected).toBe(false);
    expect(reading).toMatchObject({ revolutions: 42, deviceId: 'solo' });
  });
});
