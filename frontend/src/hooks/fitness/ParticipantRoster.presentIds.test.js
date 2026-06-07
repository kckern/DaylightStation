/**
 * ParticipantRoster — cheap presence query (getPresentParticipantIds).
 *
 * The per-HR-packet zone-sync path needs only the SET of present participant
 * IDs, not full roster entries. getRoster() does an expensive rebuild (zone
 * lookup + label resolution + per-entry logging) and was being called ~55×/sec
 * just to extract those IDs. getPresentParticipantIds() returns the same set of
 * real-user IDs that getRoster() would emit, WITHOUT building entries.
 *
 * Contract guarded here:
 *  - mapped users present → their user IDs are included
 *  - ledger guests → their occupant/profile IDs are included
 *  - truly-anonymous devices (no user, no ledger) → OMITTED (their getRoster
 *    entry id is `device:<id>`, which never matches a real user id)
 *  - equivalence with getRoster()'s id set, filtered to real users
 *  - cheapness: does NOT call _buildZoneLookup()
 */
import { describe, it, expect, vi } from 'vitest';

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

describe('ParticipantRoster — getPresentParticipantIds (cheap presence query)', () => {
  it('returns a Set containing mapped-user IDs for present HR devices', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    userManager.registerUser({ id: 'test-user-a', name: 'Test User A', hr_device_id: '10366' });
    userManager.registerUser({ id: 'test-user-b', name: 'Test User B', hr_device_id: '11521' });
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 75, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '11521', type: 'heart_rate', heartRate: 80, lastSeen: Date.now() });

    const ids = roster.getPresentParticipantIds();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has('test-user-a')).toBe(true);
    expect(ids.has('test-user-b')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('includes a ledger guest occupant ID but OMITS a truly-anonymous device', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    // Ledger guest — assigned with an explicit profileId.
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 72, lastSeen: Date.now() });
    userManager.assignGuest('29425', 'Guest', {
      profileId: 'guest_29425',
      occupantType: 'guest'
    });
    // Truly anonymous — no user, no ledger. getRoster id would be `device:33001`.
    deviceManager.registerDevice({ id: '33001', type: 'heart_rate', heartRate: 90, lastSeen: Date.now() });

    const ids = roster.getPresentParticipantIds();
    expect(ids.has('guest_29425')).toBe(true);
    expect(ids.has('device:33001')).toBe(false);
    expect(ids.has('33001')).toBe(false);
    expect(ids.size).toBe(1);
  });

  it('ledger-fallback branch: includes occupantId when resolveUserForDevice returns null', () => {
    // Exercises ParticipantRoster.js:225-227 in isolation. In normal flow,
    // resolveUserForDevice already resolves ledger guests (via the named-ledger
    // path → registered-user lookup), so the `ledgerEntry?.occupantId` fallback
    // is dead-but-defensive. Here we force the null-resolution case with a stub
    // userManager: resolveUserForDevice → null, but assignmentLedger.get →
    // an entry carrying only occupantId. A real DeviceManager supplies the
    // present HR device.
    const deviceManager = new DeviceManager();
    deviceManager.registerDevice({ id: '40110', type: 'heart_rate', heartRate: 72, lastSeen: Date.now() });

    const userManager = {
      resolveUserForDevice: () => null,
      assignmentLedger: {
        get: (deviceId) =>
          String(deviceId) === '40110' ? { occupantId: 'guest_iso' } : null,
      },
    };

    const roster = new ParticipantRoster();
    roster.configure({ deviceManager, userManager });

    const ids = roster.getPresentParticipantIds();
    expect(ids.has('guest_iso')).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('equivalence guard: matches getRoster()\'s real-user id set on a mixed roster', () => {
    const { roster, deviceManager, userManager } = buildRoster();

    // ≥2 mapped users
    userManager.registerUser({ id: 'test-user-a', name: 'Test User A', hr_device_id: '10366' });
    userManager.registerUser({ id: 'test-user-b', name: 'Test User B', hr_device_id: '11521' });
    // 1 ledger guest
    userManager.assignGuest('29425', 'Guest', {
      profileId: 'guest_29425',
      occupantType: 'guest'
    });
    // Register devices for the mapped users + guest + 1 anonymous device
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 75, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '11521', type: 'heart_rate', heartRate: 80, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 72, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '33001', type: 'heart_rate', heartRate: 90, lastSeen: Date.now() });

    // The universe of real users, consistent with the userManager stub state.
    const allUsers = userManager.getAllUsers().map(u => ({ id: u.id }));

    const presentSet = roster.getPresentParticipantIds();
    const cheap = allUsers.filter(u => presentSet.has(u.id));

    const rosterIdSet = new Set(roster.getRoster().map(e => e.id));
    const reference = allUsers.filter(u => rosterIdSet.has(u.id));

    expect(cheap).toEqual(reference);
  });

  it('equivalence guard: holds when a sub-floor (< anonymous floor) ghost is present', () => {
    const { roster, deviceManager, userManager } = buildRoster();

    // ≥2 mapped users
    userManager.registerUser({ id: 'test-user-a', name: 'Test User A', hr_device_id: '10366' });
    userManager.registerUser({ id: 'test-user-b', name: 'Test User B', hr_device_id: '11521' });
    // 1 ledger guest
    userManager.assignGuest('29425', 'Guest', {
      profileId: 'guest_29425',
      occupantType: 'guest'
    });
    // Devices for the mapped users + guest
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 75, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '11521', type: 'heart_rate', heartRate: 80, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 72, lastSeen: Date.now() });
    // Sub-floor ghost: unregistered (no mapped user, no ledger) device whose HR
    // (30) sits below the default anonymous floor (60). getRoster() drops it via
    // _buildRosterEntry's §2B low-HR filter; the cheap path omits it because it
    // matches no real user and has no ledger entry. The intersection with the
    // real-user universe must be identical on both paths.
    deviceManager.registerDevice({ id: '33002', type: 'heart_rate', heartRate: 30, lastSeen: Date.now() });

    const allUsers = userManager.getAllUsers().map(u => ({ id: u.id }));

    const presentSet = roster.getPresentParticipantIds();
    const cheap = allUsers.filter(u => presentSet.has(u.id));

    const rosterIdSet = new Set(roster.getRoster().map(e => e.id));
    const reference = allUsers.filter(u => rosterIdSet.has(u.id));

    expect(cheap).toEqual(reference);
    // Sanity: the sub-floor ghost is in neither id set.
    expect(presentSet.has('device:33002')).toBe(false);
    expect(rosterIdSet.has('device:33002')).toBe(false);
  });

  it('cheapness guard: does NOT call _buildZoneLookup, but getRoster does', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    userManager.registerUser({ id: 'test-user-a', name: 'Test User A', hr_device_id: '10366' });
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 75, lastSeen: Date.now() });

    const spy = vi.spyOn(roster, '_buildZoneLookup');

    roster.getPresentParticipantIds();
    expect(spy).not.toHaveBeenCalled();

    roster.getRoster();
    expect(spy).toHaveBeenCalled();
  });
});
