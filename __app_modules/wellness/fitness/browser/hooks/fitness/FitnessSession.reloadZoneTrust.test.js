import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logger = vi.hoisted(() => {
  const l = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  l.child = () => l;
  return l;
});
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => logger, getLogger: () => logger }));

const { FitnessSession } = await import('./FitnessSession.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');
const { ZONE_TRUST_STORAGE_KEY } = await import('./zoneTrustLocalStore.js');

/**
 * Replay of 2026-11-10 on the garage kiosk: a rider climbed cool → hot, the page
 * reloaded onto a menu (no content, so no session resume) with the rider at
 * warm ~150, and they sat at NO ZONE for 68 min. The kiosk's own storage now
 * vouches for them on the same strap.
 */
const zones = [
  { id: 'cool', name: 'Cool', min: 60, rings: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 120, rings: 1, color: 'green' },
  { id: 'warm', name: 'Warm', min: 140, rings: 2, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 160, rings: 3, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 190, rings: 5, color: 'red' }
];
const hr = (deviceId, value) => ({ topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: value } });
const advance = (ms) => vi.setSystemTime(Date.now() + ms);
const infos = (name) => logger.info.mock.calls.filter(([e]) => e === name).map(([, d]) => d);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

function sessionFor(users, storage) {
  const session = new FitnessSession(undefined, { zoneTrustStorage: storage });
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  session.userManager.configure({ primary: users }, zones);
  session.ensureStarted({ force: true, reason: 'reload-zone-trust-test' });
  session.zoneProfileStore.setBaseZoneConfig(zones);
  session.treasureBox.configure({ zones });
  return session;
}
const feed = (session, deviceId, values, stepMs = 1000) => {
  for (const v of values) { advance(stepMs); session.ingestData(hr(deviceId, v)); }
};
const riderA = [{ id: 'rider-a', name: 'Rider A', hr_device_id: 'strap-a1' }];

describe('FitnessSession — zone trust survives a kiosk reload', () => {
  let sessions;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T18:42:00Z'));
    Object.values(logger).forEach((fn) => fn.mockClear?.());
    sessions = [];
  });
  afterEach(() => { sessions.forEach((s) => s.destroy()); vi.useRealTimers(); });
  const boot = (users, storage) => { const s = sessionFor(users, storage); sessions.push(s); return s; };

  const warmUpThenReload = (storage, gapMs = 60000) => {
    const before = boot(riderA, storage);
    feed(before, 'strap-a1', [90, 90, 90, 90]);
    feed(before, 'strap-a1', [120, 130, 140, 145, 150, 150, 150, 150, 150, 150]);
    expect(before.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'warm' });
    before.saveLocalZoneTrust({ force: true, reason: 'pagehide' });
    advance(gapMs);
    return boot(riderA, storage); // the page reloads: a new session, a new store
  };

  it('resumes the rider at warm on the same strap, without a fresh Cool', () => {
    const storage = memory();
    const after = warmUpThenReload(storage);
    expect(infos('fitness.zone_trust.restored')).toContainEqual(expect.objectContaining({ via: 'local', userId: 'rider-a' }));
    feed(after, 'strap-a1', [152, 152, 152, 152, 152, 152]);
    expect(after.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'warm' });
    expect(after.getZoneProfile('rider-a').zoneEntry).toMatchObject({ resumed: true });
  });

  it('a strap now worn by someone else gets no trust from the previous wearer', () => {
    const storage = memory();
    warmUpThenReload(storage);
    const riderB = boot([{ id: 'rider-b', name: 'Rider B', hr_device_id: 'strap-a1' }], storage);
    feed(riderB, 'strap-a1', [152, 152, 152, 152, 152, 152]);
    expect(riderB.getZoneProfile('rider-b')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('evidence older than 30 min is dropped and the Cool rule applies', () => {
    const storage = memory();
    const after = warmUpThenReload(storage, 31 * 60 * 1000);
    expect(infos('fitness.zone_trust.not_restored')).toContainEqual(expect.objectContaining({ via: 'local', userId: 'rider-a', reason: 'evidence-too-old' }));
    feed(after, 'strap-a1', [152, 152, 152, 152, 152, 152]);
    expect(after.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('saves after zone syncs on its own, throttled', () => {
    const storage = memory();
    const s = boot(riderA, storage);
    feed(s, 'strap-a1', [90, 90, 90, 90, 90, 90, 90]);
    const saved = JSON.parse(storage.map.get(ZONE_TRUST_STORAGE_KEY));
    expect(saved.riders).toEqual([expect.objectContaining({ userId: 'rider-a', evidence: expect.objectContaining({ deviceId: 'strap-a1', heartRate: 90 }) })]);
  });

  it('without storage (the default) nothing is saved or restored', () => {
    const s = boot(riderA, null);
    feed(s, 'strap-a1', [90, 90, 90, 90]);
    expect(s.saveLocalZoneTrust({ force: true })).toBe(false);
    expect(infos('fitness.zone_trust.restored')).toEqual([]);
  });
});
