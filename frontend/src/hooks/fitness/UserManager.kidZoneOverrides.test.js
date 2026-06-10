import { describe, it, expect, beforeEach } from 'vitest';
import { UserManager } from './UserManager.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';

/**
 * Task 9 review — Defect 1 end-to-end.
 *
 * A "Guest (kid)" assignment stores metadata.zones in the ARRAY shape
 * ([{ id, min }, ...]) on the device-assignment ledger. The pipeline's
 * Array.isArray gates pass that array through to buildZoneConfig — which,
 * before this fix, only understood the map shape and silently dropped every
 * entry. Net effect: kid guests got adult thresholds.
 *
 * These tests assert the full path: assignment ledger metadata with array
 * zones → resolveUserForDevice → User.zoneConfig carries the kid mins.
 */

const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 60, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'On Fire', min: 160, color: 'red' }
];

const KID_ZONES_ARRAY = [
  { id: 'active', min: 95 },
  { id: 'warm', min: 130 },
  { id: 'hot', min: 155 },
  { id: 'fire', min: 175 }
];

const minOf = (zones, id) => zones.find((z) => z.id === id)?.min;

describe('UserManager — kid guest array-shaped zone overrides (Task 9 review)', () => {
  let manager;
  let ledger;

  beforeEach(() => {
    manager = new UserManager();
    ledger = new DeviceAssignmentLedger();
    manager.setAssignmentLedger(ledger);
    manager.configure({ primary: [], family: [], friends: [] }, GLOBAL_ZONES);
  });

  it('resolveUserForDevice returns a user whose zoneConfig has the kid mins after assignGuest', () => {
    manager.assignGuest('48291', 'Guest', {
      profileId: 'guest_48291',
      occupantType: 'guest',
      candidateId: 'guest-kid',
      zones: KID_ZONES_ARRAY
    });

    // Scenario fidelity: the ledger really carries the ARRAY shape.
    expect(Array.isArray(ledger.get('48291')?.metadata?.zones)).toBe(true);

    const user = manager.resolveUserForDevice('48291');
    expect(user).toBeTruthy();
    expect(minOf(user.zoneConfig, 'active')).toBe(95);
    expect(minOf(user.zoneConfig, 'warm')).toBe(130);
    expect(minOf(user.zoneConfig, 'hot')).toBe(155);
    expect(minOf(user.zoneConfig, 'fire')).toBe(175);
  });

  it('resolves kid zones from a pre-populated ledger entry (no prior assignGuest call)', () => {
    // Simulates a ledger restored/synced from elsewhere — resolveUserForDevice
    // alone must materialize the user with the array overrides applied.
    ledger.upsert({
      deviceId: '48292',
      occupantId: 'guest_48292',
      occupantName: 'Guest',
      occupantType: 'guest',
      metadata: {
        candidateId: 'guest-kid',
        profileId: 'guest_48292',
        name: 'Guest',
        zones: KID_ZONES_ARRAY
      }
    });

    const user = manager.resolveUserForDevice('48292');
    expect(user).toBeTruthy();
    expect(user.id).toBe('guest_48292');
    expect(minOf(user.zoneConfig, 'active')).toBe(95);
    expect(minOf(user.zoneConfig, 'fire')).toBe(175);
  });

  it('a plain adult Guest keeps the global thresholds', () => {
    manager.assignGuest('48293', 'Guest', {
      profileId: 'guest_48293',
      occupantType: 'guest',
      candidateId: 'guest'
    });
    const user = manager.resolveUserForDevice('48293');
    expect(minOf(user.zoneConfig, 'active')).toBe(100);
    expect(minOf(user.zoneConfig, 'fire')).toBe(160);
  });

  it('re-tagging kid → plain Guest on the same device resets to global thresholds', () => {
    // Kid first: zone overrides applied to the shared guest_<deviceId> identity.
    manager.assignGuest('48291', 'Guest', {
      profileId: 'guest_48291',
      occupantType: 'guest',
      candidateId: 'guest-kid',
      zones: KID_ZONES_ARRAY
    });
    let user = manager.resolveUserForDevice('48291');
    expect(minOf(user.zoneConfig, 'active')).toBe(95);

    // Re-tag the SAME strap as a plain adult Guest (no zones). The reused
    // User object must NOT keep the previous occupant's kid thresholds.
    manager.assignGuest('48291', 'Guest', {
      profileId: 'guest_48291',
      occupantType: 'guest',
      candidateId: 'guest'
    });
    user = manager.resolveUserForDevice('48291');
    expect(minOf(user.zoneConfig, 'active')).toBe(100);
    expect(minOf(user.zoneConfig, 'warm')).toBe(120);
    expect(minOf(user.zoneConfig, 'hot')).toBe(140);
    expect(minOf(user.zoneConfig, 'fire')).toBe(160);
  });

  it('a configured user with personal zone overrides keeps them when guest-assigned without zones', () => {
    // Configured friend with personal zone overrides from household config.
    manager.configure({
      primary: [],
      family: [],
      friends: [{ id: 'friend-b', name: 'Friend B', zones: KID_ZONES_ARRAY }]
    }, GLOBAL_ZONES);

    // Guest-assign them to a device WITHOUT zones in the assignment metadata.
    manager.assignGuest('48295', 'Friend B', {
      profileId: 'friend-b',
      occupantType: 'guest',
      candidateId: 'friend-b'
    });
    const user = manager.resolveUserForDevice('48295');
    expect(user.id).toBe('friend-b');
    // Personal overrides must survive — the no-zones reset is scoped to
    // generic guest_<deviceId> identities only.
    expect(minOf(user.zoneConfig, 'active')).toBe(95);
    expect(minOf(user.zoneConfig, 'fire')).toBe(175);
  });
});
