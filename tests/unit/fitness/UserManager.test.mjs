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
