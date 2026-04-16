// tests/unit/fitness/UserManager.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Logger module before importing User
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  })
}));

// Import User after mocking
const { User } = await import('#frontend/hooks/fitness/UserManager.js');
const { UserManager } = await import('#frontend/hooks/fitness/UserManager.js');

// Zone config: cool (min:60), active (min:100), warm (min:130)
const TEST_ZONES = [
  { id: 'cool', name: 'Cool', min: 60, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow' }
];

const DEVICE_ID = 'test-hr-device-1';

const createTestUser = () => {
  return new User('TestUser', 1990, DEVICE_ID, null, {
    id: 'test-user',
    globalZones: TEST_ZONES
  });
};

const sendHeartRate = (user, heartRate) => {
  user.updateFromDevice({
    type: 'heart_rate',
    deviceId: DEVICE_ID,
    heartRate
  });
};

describe('User HR=0 device disconnect handling', () => {
  it('should preserve last known zone when heartRate drops to 0', () => {
    const user = createTestUser();

    // Send a real HR reading of 120 -> should be in "active" zone (100-129)
    sendHeartRate(user, 120);
    expect(user.currentData.zone).toBe('active');

    // Send HR=0 (device disconnect) -> should STILL be in "active" zone (not "cool")
    sendHeartRate(user, 0);
    expect(user.currentData.zone).toBe('active');
  });

  it('should still update zone normally for real HR values after HR=0', () => {
    const user = createTestUser();

    // Send HR 120 -> "active"
    sendHeartRate(user, 120);
    expect(user.currentData.zone).toBe('active');

    // Send HR 0 -> should stay "active" (preserved)
    sendHeartRate(user, 0);
    expect(user.currentData.zone).toBe('active');

    // Send HR 50 -> should now be "cool" (normal update resumes with real reading)
    sendHeartRate(user, 50);
    expect(user.currentData.zone).toBe('cool');
  });

  it('should preserve zone snapshot fields when HR drops to 0', () => {
    const user = createTestUser();

    // Send HR 135 -> "warm" zone
    sendHeartRate(user, 135);
    expect(user.currentData.zone).toBe('warm');
    expect(user.currentData.zoneName).toBe('Warm');
    expect(user.currentData.color).toBe('yellow');

    // Send HR=0 -> all zone snapshot fields should be preserved
    sendHeartRate(user, 0);
    expect(user.currentData.zone).toBe('warm');
    expect(user.currentData.zoneName).toBe('Warm');
    expect(user.currentData.color).toBe('yellow');
  });

  it('should not add HR=0 to cumulative readings', () => {
    const user = createTestUser();

    sendHeartRate(user, 120);
    const readingsAfterReal = user._cumulativeData.heartRate.readings.length;

    sendHeartRate(user, 0);
    const readingsAfterZero = user._cumulativeData.heartRate.readings.length;

    // HR=0 should not add a reading to cumulative data
    expect(readingsAfterZero).toBe(readingsAfterReal);
  });
});

describe('User hrInactive flag', () => {
  it('should start with hrInactive true (no valid HR yet)', () => {
    const user = createTestUser();
    expect(user.currentData.hrInactive).toBe(true);
  });

  it('should set hrInactive false when valid HR received', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);
  });

  it('should set hrInactive true when HR drops to 0', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);
    sendHeartRate(user, 0);
    expect(user.currentData.hrInactive).toBe(true);
  });

  it('should clear hrInactive when valid HR returns after 0', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    sendHeartRate(user, 0);
    expect(user.currentData.hrInactive).toBe(true);
    sendHeartRate(user, 105);
    expect(user.currentData.hrInactive).toBe(false);
  });

  it('should include hrInactive in summary getter', () => {
    const user = createTestUser();
    expect(user.summary.hrInactive).toBe(true);
    sendHeartRate(user, 120);
    expect(user.summary.hrInactive).toBe(false);
  });

  it('should reset hrInactive to true on resetSession', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);
    user.resetSession();
    expect(user.currentData.hrInactive).toBe(true);
  });
});

describe('User multi-device ownership', () => {
  it('constructor accepts single hrDeviceId and stores in Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    expect(user.hrDeviceIds.has('20991')).toBe(true);
    expect(user.hrDeviceId).toBe('20991');
  });

  it('ownsHrDevice checks the Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
    expect(user.ownsHrDevice('99999')).toBe(false);
  });

  it('hrDeviceId setter adds to Set (does not replace)', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceId = '10366';
    expect(user.hrDeviceIds.size).toBe(2);
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
  });

  it('hrDeviceId = null clears the Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');
    user.hrDeviceId = null;
    expect(user.hrDeviceIds.size).toBe(0);
    expect(user.hrDeviceId).toBeNull();
  });

  it('updateFromDevice accepts any owned device', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 110 });
    expect(user.currentData.heartRate).toBe(110);

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 105 });
    // Multi-device: lowest wins
    expect(user.currentData.heartRate).toBe(105);
  });

  it('updateFromDevice ignores unowned device', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 110 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '99999', heartRate: 200 });
    expect(user.currentData.heartRate).toBe(110);
  });
});

describe('Multi-device HR arbitration (lowest wins)', () => {
  it('uses lowest HR when both devices report', () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 115 });
    expect(user.currentData.heartRate).toBe(115);
  });

  it('uses single device reading when only one reports', () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    expect(user.currentData.heartRate).toBe(130);
  });

  it('ignores stale readings from disconnected device', async () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    // Both report
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 115 });

    // Simulate 10366 going stale by manually backdating its pending entry
    user._pendingHR.get('10366').ts = Date.now() - 15000;

    // Only 20991 reports — stale 10366 should be pruned, use 20991's value
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 140 });
    expect(user.currentData.heartRate).toBe(140);
  });
});

describe('UserManager.registerUser with hr_device_ids', () => {
  let manager;
  beforeEach(() => {
    manager = new UserManager();
    manager._defaultZones = TEST_ZONES;
  });

  it('registers all device IDs from hr_device_ids array', () => {
    manager.registerUser({
      name: 'Alan',
      id: 'alan',
      hr_device_ids: [20991, 10366, 28676]
    });
    const user = manager.getUser('alan');
    expect(user.hrDeviceIds.size).toBe(3);
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
    expect(user.ownsHrDevice('28676')).toBe(true);
  });

  it('falls back to single hr field when hr_device_ids absent', () => {
    manager.registerUser({
      name: 'Felix',
      id: 'felix',
      hr: 28812
    });
    const user = manager.getUser('felix');
    expect(user.hrDeviceIds.size).toBe(1);
    expect(user.ownsHrDevice('28812')).toBe(true);
  });

  it('exposes deviceOwnershipIndex after registration', () => {
    manager.registerUser({ name: 'Alan', id: 'alan', hr_device_ids: [20991, 10366] });
    manager.registerUser({ name: 'Felix', id: 'felix', hr: 28812 });

    const index = manager.deviceOwnershipIndex;
    expect(index).toBeDefined();
    expect(index.getOwner('20991').id).toBe('alan');
    expect(index.getOwner('10366').id).toBe('alan');
    expect(index.getOwner('28812').id).toBe('felix');
    expect(index.getOwner('99999')).toBeNull();
  });
});
