import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { User } from './UserManager.js';

const zones = [{ id: 'cool', min: 60 }, { id: 'active', min: 110 }, { id: 'fire', min: 180 }];
function rider() {
  const user = new User('Rider A', 2000, 'strap-a', null, { id: 'rider-a', globalZones: zones });
  user.hrDeviceIds.add('strap-b');
  return user;
}
const feed = (user, deviceId, heartRate, zoneReadingEligible) => user.updateFromDevice({ type: 'heart_rate', deviceId, heartRate, zoneReadingEligible });

describe('User selected HR provenance', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(100000); });
  afterEach(() => vi.useRealTimers());

  it('keeps discarded lowest-reading provenance through an accepted higher packet', () => {
    const user = rider();
    feed(user, 'strap-a', 187, true);
    feed(user, 'strap-b', 90, false);
    feed(user, 'strap-a', 188, true);
    expect(user.currentData).toMatchObject({ heartRate: 90, heartRateDeviceId: 'strap-b', zoneReadingEligible: false });
    feed(user, 'strap-b', 90, true);
    expect(user.currentData).toMatchObject({ heartRate: 90, heartRateDeviceId: 'strap-b', zoneReadingEligible: true });
  });

  it('drops stale low readings with their provenance before selecting another strap', () => {
    const user = rider();
    feed(user, 'strap-b', 90, false);
    vi.setSystemTime(110001);
    feed(user, 'strap-a', 187, true);
    expect(user.currentData).toMatchObject({ heartRate: 187, heartRateDeviceId: 'strap-a', zoneReadingEligible: true });
  });

  it('clears prior wearer readings without erasing historical HR statistics', () => {
    const user = rider();
    feed(user, 'strap-b', 90, true);
    expect(user.summary.avgHR).toBe(90);
    user.resetHrReadings();
    expect(user.currentData).toMatchObject({ heartRate: null, heartRateDeviceId: null, zoneReadingEligible: false, hrInactive: true });
    expect(user.summary.avgHR).toBe(90);
    feed(user, 'strap-a', 187, false);
    expect(user.currentData).toMatchObject({ heartRate: 187, heartRateDeviceId: 'strap-a', zoneReadingEligible: false });
  });
});
