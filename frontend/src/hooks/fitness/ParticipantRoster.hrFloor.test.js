/**
 * ParticipantRoster — unregistered-device HR floor filter (§2B).
 *
 * A stray ANT+ HR strap (one not in fitness.yml `devices.heart_rate` and with
 * no guest-assignment ledger entry) can broadcast a physiologically impossible
 * reading — e.g. 16 BPM from a sensor sitting in a drawer. Because anonymous
 * devices render as tappable `#<deviceId>` cards (see
 * ParticipantRoster.anonymousDevice.test.js), such a ghost litters the roster.
 *
 * Rule: when a device is UNREGISTERED (no mapped user, no guest assignment) and
 * its heart rate is below a configurable floor (default 60 BPM), drop it from
 * the roster. Registered users and explicitly-assigned guests are NEVER
 * filtered, regardless of HR.
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

describe('ParticipantRoster — unregistered HR floor filter', () => {
  it('drops an unregistered HR device reading below the default floor (16 BPM ghost)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({
      id: '29425',
      type: 'heart_rate',
      heartRate: 16,
      lastSeen: Date.now()
    });

    const result = roster.getRoster();
    expect(result).toHaveLength(0);
  });

  it('keeps an unregistered HR device reading at or above the floor (real user)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({
      id: '10366',
      type: 'heart_rate',
      heartRate: 72,
      lastSeen: Date.now()
    });

    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('#10366');
  });

  it('never filters an explicitly-assigned guest even with a low reading', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    deviceManager.registerDevice({
      id: '29425',
      type: 'heart_rate',
      heartRate: 16,
      lastSeen: Date.now()
    });
    userManager.assignGuest('29425', 'Guest', {
      profileId: 'guest_29425',
      occupantType: 'guest'
    });

    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Guest');
  });

  it('honors a configurable floor passed via configure()', () => {
    const { roster, deviceManager } = buildRoster({ anonymousHrFloor: 100 });
    deviceManager.registerDevice({
      id: '10366',
      type: 'heart_rate',
      heartRate: 72,
      lastSeen: Date.now()
    });

    // 72 is above the hard floor (40) but below the configured comfort floor (100)
    // → KEPT as a weak-signal card (demote-not-drop), not dropped.
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(true);
  });
});
