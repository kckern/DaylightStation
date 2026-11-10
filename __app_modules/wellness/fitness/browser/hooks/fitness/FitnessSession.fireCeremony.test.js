import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => {
  const l = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  return l;
});
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger, getLogger: () => logger }));

const { FitnessSession } = await import('./FitnessSession.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');
const { GuestAssignmentService } = await import('./GuestAssignmentService.js');
const { nextFireToasts, createFireZoneTracker } = await import('../../player/overlays/fireZoneTracker.js');

/**
 * Owner rule: "A Fire ceremony should NEVER happen if the user is not actually
 * in Fire. Ever." These drive the whole ingestion path (DeviceManager slew gate
 * -> UserManager -> ZoneProfileStore -> fireZoneTracker).
 */
const zones = [
  { id: 'cool', name: 'Cool', min: 60, rings: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 120, rings: 1, color: 'green' },
  { id: 'warm', name: 'Warm', min: 140, rings: 2, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 160, rings: 3, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 190, rings: 5, color: 'red' }
];
const hr = (deviceId, value, extra = {}) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: value }, ...extra
});
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

function sessionFor(users) {
  const session = new FitnessSession();
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  session.userManager.configure({ primary: users }, zones);
  session.ensureStarted({ force: true, reason: 'fire-ceremony-test' });
  session.zoneProfileStore.setBaseZoneConfig(zones);
  session.treasureBox.configure({ zones });
  return session;
}

describe('FitnessSession — Fire ceremonies only for a rider actually in Fire', () => {
  let session;
  let tracker;
  let toasts;
  let zonesSeen;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    Object.values(logger).forEach((fn) => fn.mockClear?.());
    tracker = createFireZoneTracker();
    toasts = [];
    zonesSeen = [];
  });
  afterEach(() => { session?.reset(); vi.useRealTimers(); });

  const observe = (userId) => {
    const result = nextFireToasts(tracker, session.zoneProfiles);
    tracker = result.tracker;
    toasts.push(...result.entries);
    zonesSeen.push(session.getZoneProfile(userId)?.currentZoneId ?? null);
  };
  const feed = (deviceId, userId, values, stepMs = 1000, extra) => {
    for (const value of values) {
      advance(stepMs);
      session.ingestData(hr(deviceId, value, extra));
      observe(userId);
    }
  };

  it('a genuine climb into Fire, held, celebrates exactly once', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90]);
    feed('strap-a1', 'rider-a', [150, 160, 165, 170, 175, 180, 184, 186, 188, 188, 188, 188]);
    feed('strap-a1', 'rider-a', [190, 191, 192, 193, 193, 193, 193, 193, 193, 193]);
    expect(toasts).toEqual([expect.objectContaining({ userId: 'rider-a', heartRate: 191, fireThreshold: 190, deviceId: 'strap-a1' })]);
  });

  it('spike alternation 204/real after a radio gap never reaches Fire or celebrates', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90]);
    feed('strap-a1', 'rider-a', [120, 130, 140, 150, 152, 152, 152, 152, 152, 152]);
    expect(session.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'warm' });
    advance(3500); // 2-5s of radio silence: past the slew window
    const alternating = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 204 : 152));
    feed('strap-a1', 'rider-a', alternating);
    expect(zonesSeen).not.toContain('fire');
    expect(toasts).toEqual([]);
  });

  it('a lone spike right after a radio gap is discarded when the real line returns', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90]);
    feed('strap-a1', 'rider-a', [120, 130, 140, 150, 152, 152, 152, 152]);
    advance(3500);
    feed('strap-a1', 'rider-a', [204, 152, 152, 152]);
    expect(zonesSeen).not.toContain('fire');
    expect(toasts).toEqual([]);
    const rejected = logger.warn.mock.calls.filter(([e]) => e === 'fitness.hr.spike_rejected').map(([, d]) => d);
    expect(rejected[0]).toMatchObject({ deviceId: 'strap-a1', heldHr: 204, hr: 152 });
  });

  it('a short burst of spikes after a radio gap never lasts long enough to celebrate', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90]);
    feed('strap-a1', 'rider-a', [120, 130, 140, 150, 152, 152, 152, 152]);
    advance(3500);
    // Two agreeing readings are a real (if surprising) jump and may commit
    // Fire; a stint that short is not a ceremony.
    feed('strap-a1', 'rider-a', [204, 204, 204, 152, 152, 152, 152, 152, 152]);
    expect(toasts).toEqual([]);
  });

  it('simulated HR drives the zone (governance still works) but never celebrates', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    const sim = { source: 'fitness-simulator' };
    feed('strap-a1', 'rider-a', [90, 90, 90, 90], 1000, sim);
    feed('strap-a1', 'rider-a', [150, 160, 165, 170, 175, 180, 184, 186, 188, 188, 188, 188], 1000, sim);
    feed('strap-a1', 'rider-a', [190, 191, 192, 193, 193, 193, 193, 193, 193, 193, 193, 193], 1000, sim);
    const profile = session.getZoneProfile('rider-a');
    expect(profile.currentZoneId).toBe('fire');
    expect(profile.zoneReadingSimulated).toBe(true);
    expect(toasts).toEqual([]);
  });

  it('a real strap is not marked simulated', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90, 90]);
    expect(session.getZoneProfile('rider-a').zoneReadingSimulated).toBe(false);
  });

  it('a generic guest re-tagged under the same id starts a clean zone state', () => {
    session = sessionFor([]);
    const service = new GuestAssignmentService({ session, ledger: session.userManager.assignmentLedger });
    const guestId = 'guest_strap-g1';
    expect(service.assignGuest('strap-g1', { name: 'Guest', profileId: guestId, source: 'Guest' }).ok).toBe(true);
    feed('strap-g1', guestId, [90, 90, 90, 90, 90]);
    feed('strap-g1', guestId, [130, 150, 165, 170, 175, 178, 178, 178]);
    expect(session.getZoneProfile(guestId)).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
    // Someone else puts the strap on and is tagged Guest again: same id.
    expect(service.assignGuest('strap-g1', { name: 'Guest', profileId: guestId, source: 'Guest' }).ok).toBe(true);
    expect(session.getZoneProfile(guestId)?.zoneTrusted ?? false).toBe(false);
    const reset = logger.info.mock.calls.filter(([e, d]) => e === 'fitness.zone_state.reset' && d.userId === guestId);
    expect(reset.at(-1)[1]).toMatchObject({ reason: 'wearer-change' });
  });

  it('re-assigning a configured member to their own strap keeps their zone state', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    const service = new GuestAssignmentService({ session, ledger: session.userManager.assignmentLedger });
    feed('strap-a1', 'rider-a', [90, 90, 90, 90, 90]);
    feed('strap-a1', 'rider-a', [130, 150, 165, 170, 175, 178, 178, 178]);
    service.assignGuest('strap-a1', { name: 'Rider A', profileId: 'rider-a' });
    expect(session.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
  });
});
