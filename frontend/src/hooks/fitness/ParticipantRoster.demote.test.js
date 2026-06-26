/**
 * ParticipantRoster — demote-not-drop for low-HR unregistered devices.
 *
 * A real guest (e.g. a grandparent) can broadcast a genuine 58-59 bpm that sits
 * just under the comfort floor. Such a device must NOT be deleted — it must
 * still render as a tappable card, flagged `weakSignal`. Only readings below a
 * low HARD floor (drawer-strap noise, e.g. 16 bpm) are dropped entirely.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster, DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = (rosterConfig = {}) => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager, ...rosterConfig });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — demote-not-drop', () => {
  it('exports a hard-floor default below the comfort floor', () => {
    expect(DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM).toBeLessThan(60);
  });

  it('KEEPS a low-HR unregistered device (59 bpm) as a weakSignal card', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 59, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('#10266');
    expect(result[0].weakSignal).toBe(true);
  });

  it('does NOT flag a healthy-HR unregistered device as weakSignal', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 120, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(false);
  });

  it('DROPS an unregistered device below the hard floor (drawer-strap noise)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 16, lastSeen: Date.now() });
    expect(roster.getRoster()).toHaveLength(0);
  });

  it('honors a configurable hard floor', () => {
    const { roster, deviceManager } = buildRoster({ anonymousHrHardFloor: 50 });
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 45, lastSeen: Date.now() });
    expect(roster.getRoster()).toHaveLength(0);
  });

  it('never flags a registered user as weakSignal even at low HR', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 45, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(false);
  });
});
