/**
 * Session fs_20261106173151: a household member was auto-assigned to his own
 * strap; it went silent mid-session; the family picked a spare strap for him
 * five times and every pick was rejected `user-already-assigned` by the stale
 * ledger entry — silently. A silent strap must not hold its wearer hostage; a
 * sending strap still does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warn = vi.fn();
const info = vi.fn();
const sampled = vi.fn();
vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = {
    warn: (...a) => warn(...a), info: (...a) => info(...a), debug: () => {}, error: () => {},
    sampled: (...a) => sampled(...a), child: () => logger,
  };
  return { default: () => logger, getLogger: () => logger };
});

const { FitnessSession } = await import('./FitnessSession.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');
const { GuestAssignmentService } = await import('./GuestAssignmentService.js');

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', rings: 2 },
];
const USERS = { primary: [{ id: 'rider_m', name: 'Rider M', hr_device_id: '8317' }] };
const hr = (deviceId, bpm) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR',
  data: { ComputedHeartRate: bpm, timestamp: Date.now() },
});
// Exactly what FitnessSidebarMenu.handleAssignGuest sends for a primary.
const memberPick = { name: 'Rider M', profileId: 'rider_m', candidateId: 'rider_m', source: 'Family', occupantType: 'member' };

function build() {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger();
  session.userManager.setAssignmentLedger(ledger);
  session.userManager.configure(USERS, ZONES);
  session.ensureStarted({ force: true, reason: 'stale-strap-test' });
  session.zoneProfileStore.setBaseZoneConfig(ZONES);
  session.treasureBox.configure({ zones: ZONES });
  const svc = new GuestAssignmentService({ session, ledger, thresholdMs: 300_000 });
  return { session, ledger, svc };
}
const send = (session, seconds, devices) => {
  for (let s = 0; s < seconds; s++) {
    vi.advanceTimersByTime(1000);
    devices.forEach((d) => session.ingestData(hr(d, 120)));
  }
};

describe('GuestAssignmentService: a silent strap releases its wearer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_790_213_728_000); warn.mockClear(); info.mockClear(); sampled.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('own strap goes silent → member picked on a spare strap → assigned, old stint closed', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317']);
    expect(ledger.get('8317')).toMatchObject({ occupantId: 'rider_m' });
    const oldStint = session.entityRegistry.getByDevice('8317');
    expect(oldStint).toMatchObject({ profileId: 'rider_m', status: 'active' });
    const lastPacketAt = session.deviceManager.getDevice('8317').lastSeen;

    // 8317 falls silent; the spare keeps sending; the inactivity sweep runs.
    send(session, 90, ['10266']);
    session.deviceManager.pruneStaleDevices({ inactive: 60_000, remove: 180_000 });
    expect(session.deviceManager.getDevice('8317').inactiveSince).toBeTruthy();

    const result = svc.assignGuest('10266', memberPick);
    expect(result.ok).toBe(true);
    expect(ledger.get('8317')).toBeNull();
    expect(ledger.get('10266')).toMatchObject({ occupantId: 'rider_m', occupantType: 'member' });
    expect(oldStint).toMatchObject({ status: 'dropped', endReason: 'strap-silent-moved', endTime: lastPacketAt });
    expect(session.entityRegistry.getByDevice('10266')).toMatchObject({ profileId: 'rider_m', status: 'active' });
    expect(info).toHaveBeenCalledWith('guest_assignment.stale_entry_released',
      expect.objectContaining({ deviceId: '8317', userId: 'rider_m', toDeviceId: '10266' }));
    session.reset();
  });

  it('"Remove user" (device deleted) also releases the entry', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317', '10266']);
    session.deviceManager.removeDevice('8317');
    expect(svc.assignGuest('10266', memberPick).ok).toBe(true);
    expect(ledger.get('8317')).toBeNull();
    session.reset();
  });

  it('a member whose own strap is still sending is rejected — even with allowWhileAssigned — and it is logged at warn', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317', '10266']);
    const result = svc.assignGuest('10266', { ...memberPick, allowWhileAssigned: true });
    expect(result).toMatchObject({ ok: false, code: 'user-already-assigned', existingDeviceId: '8317' });
    expect(ledger.get('8317')).toMatchObject({ occupantId: 'rider_m' });
    expect(session.entityRegistry.getByDevice('8317')).toMatchObject({ status: 'active' });
    expect(warn).toHaveBeenCalledWith('guest_assignment.rejected', expect.objectContaining({
      code: 'user-already-assigned', deviceId: '10266', userId: 'rider_m', existingDeviceId: '8317'
    }));
    session.reset();
  });

  it('a member pick never stores allowWhileAssigned on his ledger entry', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317']);
    send(session, 90, ['10266']);
    session.deviceManager.pruneStaleDevices({ inactive: 60_000, remove: 180_000 });
    expect(svc.assignGuest('10266', { ...memberPick, allowWhileAssigned: true }).ok).toBe(true);
    expect(ledger.get('10266').metadata.allowWhileAssigned).toBeUndefined();
    session.reset();
  });

  it('own strap returns while he rides a live spare → left unmapped; spare goes silent → his own strap takes him back', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317']);
    send(session, 90, ['10266']);
    session.deviceManager.pruneStaleDevices({ inactive: 60_000, remove: 180_000 });
    expect(svc.assignGuest('10266', memberPick).ok).toBe(true);
    const spareStint = session.entityRegistry.getByDevice('10266');

    // 8317 starts sending again while 10266 is live: not his, not auto-assigned.
    send(session, 5, ['8317', '10266']);
    expect(ledger.get('8317')).toBeNull();
    expect(session.userManager.resolveUserForDevice('8317')).toBeNull();
    expect(ledger.get('10266')).toMatchObject({ occupantId: 'rider_m' });
    expect(sampled).toHaveBeenCalledWith('fitness.auto_assign_skip', expect.objectContaining({
      deviceId: '8317', userId: 'rider_m', reason: 'user-on-other-live-strap', heldDeviceId: '10266'
    }), expect.anything());
    expect(session.roster.find((e) => e.hrDeviceId === '8317')?.id).toBe('device:8317');

    // The spare falls silent; his own strap keeps sending → back to him.
    send(session, 90, ['8317']);
    session.deviceManager.pruneStaleDevices({ inactive: 60_000, remove: 180_000 });
    send(session, 2, ['8317']);
    expect(ledger.get('8317')).toMatchObject({ occupantId: 'rider_m' });
    expect(ledger.get('10266')).toBeNull();
    expect(spareStint).toMatchObject({ status: 'dropped', endReason: 'strap-silent-moved' });
    expect(session.entityRegistry.getByDevice('8317')).toMatchObject({ profileId: 'rider_m', status: 'active' });

    // The spare resumes (a sibling puts it on): it is not his any more.
    expect(session.userManager.getUserById('rider_m').hrDeviceIds.has('10266')).toBe(false);
    send(session, 5, ['8317', '10266']);
    expect(ledger.get('10266')).toBeNull();
    expect(session.userManager.resolveUserForDevice('10266')?.id ?? null).not.toBe('rider_m');
    const active = session.entityRegistry.getAll().filter((e) => e.profileId === 'rider_m' && e.status === 'active');
    expect(active.map((e) => e.deviceId)).toEqual(['8317']);
    session.reset();
  });

  it('clearing a picked spare takes the spare back from him (config strap kept)', () => {
    const { session, ledger, svc } = build();
    send(session, 10, ['8317']);
    send(session, 90, ['10266']);
    session.deviceManager.pruneStaleDevices({ inactive: 60_000, remove: 180_000 });
    expect(svc.assignGuest('10266', memberPick).ok).toBe(true);
    const rider = session.userManager.getUserById('rider_m');
    expect(rider.hrDeviceIds.has('10266')).toBe(true);
    expect(svc.clearGuest('10266').ok).toBe(true);
    expect(rider.hrDeviceIds.has('10266')).toBe(false);
    expect(rider.hrDeviceIds.has('8317')).toBe(true);
    expect(ledger.get('10266')).toBeNull();
    session.reset();
  });
});
