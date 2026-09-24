/**
 * A reloaded kiosk resumes the session from the saved file. The saved file
 * uses on-disk series keys (`kid-a:rings`, zone letters) — the resume must put
 * them back under live keys, restore the ring/beat counters and the stints, so
 * the resumed session continues every line instead of restarting it, and a
 * rider who left before the reload is still a participant at save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));

const { FitnessSession } = await import('./FitnessSession.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', rings: 2 },
];
const T0 = 1_790_213_728_000;

function savedPayload(now) {
  return {
    sessionId: '20260923183528',
    session: { id: '20260923183528' },
    startTime: T0,
    endTime: now - 1000,
    timeline: {
      tick_count: 4,
      interval_seconds: 5,
      series: {
        'kid-a:hr': [140, 141, 142, 143],
        'kid-a:zone': ['w', 'w', 'w', 'w'],
        'kid-a:rings': [0, 2, 4, 6],
        'kid-a:beats': [11.7, 23.4, 35.2, 47.1],
        'kid-f:hr': [130, 130, null, null],
        'kid-f:rings': [0, 2, 2, 2],
        'device:91002:heart-rate': [140, 141, 142, 143],
        'bike:7138:rpm': [60, 61, 62, 63],
        'global:rings': [0, 4, 6, 8],
        'device:step_mat:steps_total': [1, 2, 3, 4],
      },
    },
    entities: [
      { entityId: 'e-a', profileId: 'kid-a', deviceId: 'D2', startTime: T0, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-b'] },
    ],
    treasureBox: { totalRings: 8, buckets: { yellow: 8 } },
  };
}

const hr = (deviceId, bpm) => ({ topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: bpm, timestamp: Date.now() } });

function resumed() {
  const session = new FitnessSession();
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  session.userManager.configure({ primary: [{ id: 'kid-a', name: 'Kid A', hr_device_id: 'D2' }] }, ZONES);
  session.ensureStarted({ force: true, reason: 'resumed' });
  session.zoneProfileStore.setBaseZoneConfig(ZONES);
  session.treasureBox.configure({ zones: ZONES });
  session._hydrateFromSession(savedPayload(Date.now()));
  return session;
}

describe('FitnessSession resume — stints, counters and live keys', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0 + 20_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('puts on-disk series back under live keys (zone letters expanded)', () => {
    const s = resumed().timeline.series;
    expect(s['user:kid-a:rings_total'].slice(0, 4)).toEqual([0, 2, 4, 6]);
    expect(s['user:kid-a:heart_rate'].slice(0, 4)).toEqual([140, 141, 142, 143]);
    expect(s['user:kid-a:zone_id'].slice(0, 4)).toEqual(['warm', 'warm', 'warm', 'warm']);
    expect(s['user:kid-a:heart_beats'][3]).toBeCloseTo(47.1);
    expect(s['device:91002:heart_rate'].slice(0, 4)).toEqual([140, 141, 142, 143]);
    expect(s['device:7138:rpm'].slice(0, 4)).toEqual([60, 61, 62, 63]);
    expect(s['global:rings_total'].slice(0, 4)).toEqual([0, 4, 6, 8]);
    expect(s['device:step_mat:steps_total'].slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(s).not.toHaveProperty('kid-a:rings');
  });

  it('restores ring and beat counters so lines continue, not restart', () => {
    const session = resumed();
    expect(session.treasureBox.perUser.get('kid-a')?.totalRings).toBe(6);
    expect(session._timelineRecorder._cumulativeBeats.get('kid-a')).toBeCloseTo(47.1);
    for (let i = 0; i < 30; i += 1) { vi.advanceTimersByTime(1000); session.ingestData(hr('D2', 140)); }
    const rings = session.timeline.series['user:kid-a:rings_total'].filter(Number.isFinite);
    expect(rings.every((v, i) => i === 0 || v >= rings[i - 1])).toBe(true);
    expect(rings[rings.length - 1]).toBeGreaterThan(6);
    session.reset();
  });

  it('restores the stints, so a correction after the reload still moves the whole stint', () => {
    const session = resumed();
    const stint = session.entityRegistry.getByDevice('D2');
    expect(stint).toMatchObject({ entityId: 'e-a', profileId: 'kid-a', startTick: 0, relabeledFrom: ['kid-b'] });
    session.reset();
  });
});
