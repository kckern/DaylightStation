import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => {
  const l = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  return l;
});
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger, getLogger: () => logger }));

const { FitnessSession } = await import('./FitnessSession.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');
const { nextFireToasts, createFireZoneTracker } = await import('../../player/overlays/fireZoneTracker.js');

/**
 * Replays of the 2026-10-23 session through the whole ingestion path.
 *  - Bug #10: one corrupt 204 bpm packet each from Rider A's and Rider B's straps
 *    became a Fire ceremony and a Fire-rate ring tick.
 *  - Bug #5: Rider C stepped out at Hot, came back at 165-171 and had no zone
 *    for 2m13s because a confirmed loss required a fresh Cool.
 */
const zones = [
  { id: 'cool', name: 'Cool', min: 60, rings: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 120, rings: 1, color: 'green' },
  { id: 'warm', name: 'Warm', min: 140, rings: 2, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 160, rings: 3, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 190, rings: 5, color: 'red' }
];
const hr = (deviceId, value, extra = {}) => ({
  topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: value, ...extra }
});
const advance = (ms) => vi.setSystemTime(Date.now() + ms);
const eventsNamed = (level, name) => logger[level].mock.calls.filter(([event]) => event === name).map(([, data]) => data);

function sessionFor(users) {
  const session = new FitnessSession();
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  session.userManager.configure({ primary: users }, zones);
  session.ensureStarted({ force: true, reason: 'zone-trust-test' });
  session.zoneProfileStore.setBaseZoneConfig(zones);
  session.treasureBox.configure({ zones });
  return session;
}

describe('FitnessSession — implausible spikes and returning riders', () => {
  let session;
  let tracker;
  let toasts;
  let zonesSeen;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T00:20:00Z'));
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
  const feed = (deviceId, userId, values, stepMs, extra) => {
    for (const value of values) {
      advance(stepMs);
      session.ingestData(hr(deviceId, value, extra));
      observe(userId);
    }
  };
  const highestZoneId = (userId) => session.treasureBox.perUser.get(userId)?.highestZone?.id ?? null;

  it('Rider A: 152, 152, 204, 153 — no Fire, no Fire rings, and the spike is logged with its raw fields', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90], 250);
    advance(3000); // a warm-up, not a jump: outside the 2s slew window
    feed('strap-a1', 'rider-a', Array(40).fill(152), 250);
    expect(session.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'warm' });
    const highest = [];
    for (const value of [204, 153, 153, 153]) {
      advance(250);
      session.ingestData(hr('strap-a1', value, { BeatCount: 17, BeatTime: 4242 }));
      observe('rider-a');
      highest.push(highestZoneId('rider-a'));
    }
    expect(zonesSeen).not.toContain('fire');
    expect(toasts).toEqual([]);
    expect(highest).not.toContain('fire');
    expect(session.getZoneProfile('rider-a').heartRate).toBe(153);
    const [held] = eventsNamed('warn', 'fitness.hr.spike_held');
    expect(held).toMatchObject({ deviceId: 'strap-a1', heldHr: 204, previousHr: 152, raw: { ComputedHeartRate: 204, BeatCount: 17, BeatTime: 4242 } });
    expect(eventsNamed('warn', 'fitness.hr.spike_rejected')[0]).toMatchObject({ deviceId: 'strap-a1', heldHr: 204, hr: 153 });
  });

  it('Rider B: Cool 111, one 204, then 110 — stays Cool', () => {
    session = sessionFor([{ id: 'rider-b', name: 'Rider B', hr_device_id: 'strap-b1' }]);
    feed('strap-b1', 'rider-b', Array(20).fill(111), 250);
    const highest = [];
    for (const value of [204, 110, 110, 110]) {
      advance(250); session.ingestData(hr('strap-b1', value)); observe('rider-b');
      highest.push(highestZoneId('rider-b'));
    }
    expect(zonesSeen.filter(Boolean).every((zone) => zone === 'cool')).toBe(true);
    expect(toasts).toEqual([]);
    expect(highest).not.toContain('fire');
  });

  it('a real climb into Fire still celebrates, once, with the confirming HR', () => {
    session = sessionFor([{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }]);
    feed('strap-a1', 'rider-a', [90, 90, 90, 90], 1000);
    feed('strap-a1', 'rider-a', [150, 160, 165, 170, 175, 180, 184, 186, 188, 188, 188, 188, 188, 188], 1000);
    feed('strap-a1', 'rider-a', [190, 191, 192, 193], 1000);
    expect(session.getZoneProfile('rider-a').currentZoneId).toBe('fire');
    expect(toasts).toEqual([]); // a ceremony needs Fire HELD (FIRE_CEREMONY_SUSTAIN_MS)
    feed('strap-a1', 'rider-a', [193, 193, 193], 1000);
    expect(toasts).toEqual([expect.objectContaining({ userId: 'rider-a', heartRate: 191, fireThreshold: 190 })]);
  });

  // Rider C, strap strap-c1, 23:49:57Z: trusted at Hot, 16s of radio silence, a
  // null packet that confirms the loss at once, then 171, 163, 165...
  const felixToHot = () => {
    session = sessionFor([{ id: 'rider-c', name: 'Rider C', hr_device_id: 'strap-c1' }]);
    feed('strap-c1', 'rider-c', [90, 90, 90, 90], 1000);
    feed('strap-c1', 'rider-c', [130, 140, 150, 160, 165, 170, 172, 174, 174, 174], 1000);
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
    advance(16000);
    session.ingestData(hr('strap-c1', null));
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(eventsNamed('info', 'fitness.zone_state.reset').at(-1)).toMatchObject({ userId: 'rider-c', reason: 'confirmed-loss', keepsEvidence: true });
  };

  it('Rider C: resumes Hot on the first eligible packet after the water break; rings resume', () => {
    felixToHot();
    feed('strap-c1', 'rider-c', [171, 163, 165], 1000); // the 3-packet reconnect discard still applies
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    feed('strap-c1', 'rider-c', [165], 1000);
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
    expect(session.getZoneProfile('rider-c').zoneEntry).toMatchObject({ zoneId: 'hot', heartRate: 165, resumed: true });
    expect(highestZoneId('rider-c')).toBe('hot');
    expect(eventsNamed('info', 'fitness.zone_trust.resumed')[0]).toMatchObject({ userId: 'rider-c', path: 'evidence-plausible', deviceId: 'strap-c1' });
    const before = session.treasureBox.perUser.get('rider-c').totalRings;
    feed('strap-c1', 'rider-c', Array(70).fill(166), 1000);
    expect(session.treasureBox.perUser.get('rider-c').totalRings).toBeGreaterThan(before);
    expect(toasts).toEqual([]);
  });

  it('Rider C: a 204 first packet back does not resume him into Fire', () => {
    felixToHot();
    feed('strap-c1', 'rider-c', [171, 163, 165], 1000);
    feed('strap-c1', 'rider-c', [204], 1000);
    expect(session.getZoneProfile('rider-c').currentZoneId).not.toBe('fire');
    feed('strap-c1', 'rider-c', [166], 1000);
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
    expect(zonesSeen).not.toContain('fire');
    expect(toasts).toEqual([]);
  });

  it('a fresh session with no evidence still suppresses a high first reading (stale previous-day Fire)', () => {
    session = sessionFor([{ id: 'rider-c', name: 'Rider C', hr_device_id: 'strap-c1' }]);
    feed('strap-c1', 'rider-c', Array(10).fill(187), 1000);
    expect(session.getZoneProfile('rider-c')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(toasts).toEqual([]);
  });
});
