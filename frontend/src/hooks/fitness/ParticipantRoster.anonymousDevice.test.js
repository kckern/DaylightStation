/**
 * ParticipantRoster — anonymous HR devices must render.
 *
 * When an ANT+ HR strap broadcasts a deviceId that is NOT in
 * fitness.yml `devices.heart_rate` AND has no guest-assignment ledger
 * entry, the roster currently drops the device silently. That makes the
 * existing `FitnessSidebarMenu` assignment UX unreachable — there is no
 * card to tap. These tests guard the contract that anonymous devices
 * appear with a synthetic `#<deviceId>` name + `device:<deviceId>` id,
 * matching the behavior described in
 * docs/reference/fitness/unknown-hr-monitors.md.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = () => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — anonymous HR device rendering', () => {
  it('emits a roster entry for an HR device with no mapped user and no ledger assignment', () => {
    const { roster, deviceManager } = buildRoster();

    // Simulate the WS frame path: registerDevice with an HR profile and
    // an unrecognized deviceId.
    deviceManager.registerDevice({
      id: '10366',
      deviceId: '10366',
      type: 'heart_rate',
      profile: 'HR',
      heartRate: 72,
      lastSeen: Date.now()
    });

    const result = roster.getRoster();

    expect(result).toHaveLength(1);
    const [entry] = result;
    expect(entry.name).toBe('#10366');
    expect(entry.hrDeviceId).toBe('10366');
    expect(entry.hrDeviceIds).toEqual(['10366']);
    expect(entry.profileId).toBe('device:10366');
    expect(entry.id).toBe('device:10366');
    expect(entry.isGuest).toBe(true);
    expect(entry.avatarUrl).toBeNull();
  });

  it('preserves the synthetic identifiers for two simultaneous anonymous devices (no collision)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 70, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '11521', type: 'heart_rate', heartRate: 80, lastSeen: Date.now() });

    const result = roster.getRoster();
    expect(result).toHaveLength(2);
    const ids = result.map(e => e.id).sort();
    expect(ids).toEqual(['device:10366', 'device:11521']);
    const names = result.map(e => e.name).sort();
    expect(names).toEqual(['#10366', '#11521']);
  });
});
