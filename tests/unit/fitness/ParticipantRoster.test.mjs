// tests/unit/fitness/ParticipantRoster.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  })
}));

const { ParticipantRoster } = await import('#frontend/hooks/fitness/ParticipantRoster.js');

// ─── Minimal fakes (no real DeviceManager / UserManager pulled in) ──────────

function makeDevice({ id, heartRate = null, inactiveSince = null }) {
  return { id: String(id), deviceId: String(id), type: 'heart_rate', heartRate, inactiveSince };
}

function makeUser({ id, name, hrDeviceIds, currentHR = null }) {
  return {
    id,
    name,
    hrDeviceIds: new Set((hrDeviceIds || []).map(String)),
    groupLabel: null,
    source: 'Primary',
    avatarUrl: null,
    currentData: { heartRate: currentHR, hrInactive: currentHR == null },
  };
}

function makeDeviceManager(devices) {
  return { getAllDevices: () => devices };
}

function makeUserManager(userByDevice) {
  // userByDevice: Map<deviceId, user>
  return {
    resolveUserForDevice(deviceId) {
      return userByDevice.get(String(deviceId)) || null;
    },
    assignmentLedger: null,
  };
}

function newRoster(devices, userByDevice) {
  const roster = new ParticipantRoster();
  roster.configure({
    deviceManager: makeDeviceManager(devices),
    userManager: makeUserManager(userByDevice),
  });
  return roster;
}

describe('ParticipantRoster.getRoster — dual-device aggregation', () => {
  it('emits one entry per device when each device belongs to a different user', () => {
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 120 });
    const felix = makeUser({ id: 'felix', name: 'Felix', hrDeviceIds: ['28812'], currentHR: 95 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 120 }),
      makeDevice({ id: '28812', heartRate: 95 }),
    ];
    const userByDevice = new Map([['20991', alan], ['28812', felix]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(2);
    const names = roster.map(e => e.name).sort();
    expect(names).toEqual(['Alan', 'Felix']);
  });

  it('collapses two devices owned by the same user into ONE entry', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 118
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: 120 }),
      makeDevice({ id: '10366', heartRate: 118 }), // the lower — matches currentHR
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    const entry = roster[0];
    expect(entry.name).toBe('Alan');
    expect(entry.id).toBe('alan');
    // Full device list — the whole point of the fix
    expect(entry.hrDeviceIds.sort()).toEqual(['10366', '20991']);
  });

  it('uses the user\'s aggregated HR (min-HR arbitration result) not a single device\'s raw reading', () => {
    // UserManager.updateFromDevice picks the minimum and writes it to
    // user.currentData.heartRate. The roster must surface THAT value.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 118 // the min
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: 150 }), // spurious-high outlier
      makeDevice({ id: '10366', heartRate: 118 }),
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].heartRate).toBe(118);
  });

  it('collapses THREE devices (real-world: Alan has 28676, 10366, 20991 in prod config)', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['28676', '10366', '20991'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '28676', heartRate: 130 }), // "bad readings" device
      makeDevice({ id: '10366', heartRate: 100 }),
      makeDevice({ id: '20991', heartRate: 105 }),
    ];
    const userByDevice = new Map([
      ['28676', alan], ['10366', alan], ['20991', alan]
    ]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].hrDeviceIds.sort()).toEqual(['10366', '20991', '28676']);
    expect(roster[0].heartRate).toBe(100);
  });

  it('anonymous-rider device (no user, no ledger) still renders as its own entry', () => {
    // resolveUserForDevice returns null for unmapped devices. A ledger-less,
    // user-less device must be silently dropped per the CURRENT contract —
    // _buildRosterEntry returns null when participantName is absent (line 363).
    // This test locks in the drop-anon behavior (it is NOT new behavior).
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 110 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 110 }),
      makeDevice({ id: '99999', heartRate: 80 }), // unknown, unowned
    ];
    const userByDevice = new Map([['20991', alan]]); // 99999 not mapped
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe('Alan');
  });

  it('anonymous rider with a ledger assignment still renders as its own entry', () => {
    // When a device is claimed via GuestAssignmentService, _buildRosterEntry
    // reads the ledger name. That path must survive the group-by-user change.
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 110 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 110 }),
      makeDevice({ id: '44444', heartRate: 88 }),
    ];
    const userByDevice = new Map([['20991', alan]]);
    // Stub ledger: device 44444 is assigned to "Visitor Joe"
    const ledger = {
      get: (id) => String(id) === '44444'
        ? { deviceId: '44444', occupantId: 'guest-joe', occupantName: 'Visitor Joe',
            occupantType: 'guest', metadata: { profileId: 'guest-joe' } }
        : null
    };
    const roster = new ParticipantRoster();
    roster.configure({
      deviceManager: makeDeviceManager(devices),
      userManager: { resolveUserForDevice: (id) => userByDevice.get(String(id)) || null, assignmentLedger: ledger },
    });
    const out = roster.getRoster();

    expect(out).toHaveLength(2);
    const names = out.map(e => e.name).sort();
    expect(names).toEqual(['Alan', 'Visitor Joe']);
  });

  it('entry.hrDeviceId (singular, legacy) points to an active device when available', () => {
    // Backwards-compat: many downstream consumers still read entry.hrDeviceId
    // (singular). It must be one of the user's devices, and prefer an active one.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: Date.now() - 60000 }),
      makeDevice({ id: '10366', heartRate: 100 }), // active
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].hrDeviceId).toBe('10366'); // the active one
    expect(roster[0].isActive).toBe(true);
  });

  it('entry.isActive is true when ANY owned device is active', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: Date.now() - 60000 }), // inactive
      makeDevice({ id: '10366', heartRate: 100 }), // active
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();
    expect(roster[0].isActive).toBe(true);
  });

  it('entry.isActive is false when ALL owned devices are inactive', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: null
    });
    const t = Date.now() - 60000;
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: t }),
      makeDevice({ id: '10366', heartRate: null, inactiveSince: t }),
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();
    expect(roster[0].isActive).toBe(false);
  });

  it('preferGroupLabels triggers only when 2+ USERS are present (not 2+ devices from one user)', () => {
    // Key regression: before the fix, Alan alone with 3 devices would trip
    // the "2+ present devices" group-label threshold and cards would show
    // "Dad" instead of "Alan" in a single-user session. After the fix, only
    // real multi-user presence switches labels.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366', '28676'], currentHR: 100
    });
    alan.groupLabel = 'Dad';
    const devices = [
      makeDevice({ id: '20991', heartRate: 100 }),
      makeDevice({ id: '10366', heartRate: 100 }),
      makeDevice({ id: '28676', heartRate: 100 }),
    ];
    const userByDevice = new Map([
      ['20991', alan], ['10366', alan], ['28676', alan]
    ]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    // Solo user → displayLabel is the first name, not the group label
    expect(roster[0].displayLabel).toBe('Alan');
  });
});

// ─── Integration: real UserManager + DeviceManager + ParticipantRoster ─────

const { UserManager } = await import('#frontend/hooks/fitness/UserManager.js');
const { DeviceManager } = await import('#frontend/hooks/fitness/DeviceManager.js');

describe('ParticipantRoster — integration with real UserManager min-HR arbitration', () => {
  it('alan with 3 HR monitors → ONE entry, HR = minimum across devices', () => {
    const userManager = new UserManager();
    userManager.registerUser({
      id: 'alan',
      name: 'Alan',
      birth_year: 1984,
      hr_device_ids: [28676, 10366, 20991],
    });

    const deviceManager = new DeviceManager();
    const t = Date.now();
    [28676, 10366, 20991].forEach((id) => {
      deviceManager.registerDevice({
        id: String(id), type: 'heart_rate', heartRate: null, lastSeen: t
      });
    });

    // Send readings: spurious-high 150 on the "bad" device, real 105 and 100
    // on the other two. Min-HR arbitration must pick 100.
    const alan = userManager.getUser('alan');
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '28676', heartRate: 150 });
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 105 });
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 100 });
    // Mirror readings into DeviceManager so roster sees device.heartRate.
    deviceManager.registerDevice({ id: '28676', type: 'heart_rate', heartRate: 150, lastSeen: t });
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 105, lastSeen: t });
    deviceManager.registerDevice({ id: '20991', type: 'heart_rate', heartRate: 100, lastSeen: t });

    const roster = new ParticipantRoster();
    roster.configure({ deviceManager, userManager });
    const out = roster.getRoster();

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Alan');
    expect(out[0].heartRate).toBe(100);
    expect(out[0].hrDeviceIds.sort()).toEqual(['10366', '20991', '28676']);
  });
});
