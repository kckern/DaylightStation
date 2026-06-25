/**
 * Goal: a guest ANT+ HR strap that connects while reading 0 bpm (backend strips
 * it to null but forwards profile 'HR') must appear in the roster as a tappable
 * anonymous `#<deviceId>` card, so it can be assigned to a family member/friend.
 *
 * Exercises the real updateDevice → DeviceManager → ParticipantRoster path.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = (rosterConfig = {}) => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager, ...rosterConfig });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — guest HR strap appears on connection', () => {
  it('surfaces a null-reading HR strap as a tappable anonymous card', () => {
    const { roster, deviceManager } = buildRoster();
    // Mirrors the live broadcast: profile 'HR', reading stripped to null.
    deviceManager.updateDevice('10266', 'HR', { ComputedHeartRate: null });

    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('#10266');
  });

  it('still classifies it as heart_rate in the device manager (assignment gate)', () => {
    const { deviceManager } = buildRoster();
    const device = deviceManager.updateDevice('10266', 'HR', { ComputedHeartRate: null });
    // FitnessUsers.jsx:511 gates the guest-assignment tap on this exact value.
    expect(device.type).toBe('heart_rate');
  });
});
