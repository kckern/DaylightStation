/**
 * Saved participant flags describe the PERSON, not how they were assigned:
 * is_primary comes from the configured `primary` list, everyone else is a
 * guest, base_user is only for guests, display_name is the configured name.
 * Participants come from surviving stints; a relabelled-away name is dropped;
 * a cumulative series that dips is flattened and reported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const warn = vi.fn();
vi.mock('../../lib/logging/Logger.js', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: (...a) => warn(...a), error: vi.fn(), sampled: vi.fn(), child: () => logger };
  return { default: () => logger, getLogger: () => logger };
});
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../../lib/clientId.js', () => ({ getClientId: () => 'test-client' }));

const { PersistenceManager } = await import('./PersistenceManager.js');

const t0 = 1_790_213_728_000;
const N = 80;
const fill = (n, v) => Array(n).fill(v);

function sessionData() {
  return {
    sessionId: 'fs_20260923183528',
    startTime: t0,
    endTime: t0 + N * 5000,
    finalized: true,
    roster: [
      // kid-a: the live ledger path marked him a guest (strap given back).
      { profileId: 'kid-a', name: 'kid-a', hrDeviceId: 'D2', isGuest: true, baseUserName: 'Kid A' },
      { profileId: 'guest-c', name: 'guest-c', hrDeviceId: 'D1' },
      { profileId: 'parent', name: 'parent', hrDeviceId: 'D4', baseUserName: 'Parent' },
    ],
    deviceAssignments: [
      { deviceId: 'D2', occupantId: 'kid-a', occupantName: 'Kid A' },
      { deviceId: 'D1', occupantId: 'guest-c', occupantName: 'Guest C', metadata: { baseUserName: 'Kid D' } },
    ],
    entities: [
      { entityId: 'e2', profileId: 'kid-a', name: 'Kid A', deviceId: 'D2', startTime: t0, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-a', 'kid-b'] },
      { entityId: 'e1', profileId: 'guest-c', name: 'Guest C', deviceId: 'D1', startTime: t0, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-d'] },
      { entityId: 'e4', profileId: 'parent', name: 'Parent', deviceId: 'D4', startTime: t0, endTime: null, status: 'active', startTick: 0 },
      // Dropped out before save — not in the live roster, but has a stint.
      { entityId: 'e5', profileId: 'kid-f', name: 'Kid F', deviceId: 'D5', startTime: t0, endTime: t0 + 200000, status: 'dropped', startTick: 0 },
    ],
    timeline: {
      timebase: { startTime: t0, intervalMs: 5000, tickCount: N },
      series: {
        'user:kid-a:heart_rate': fill(N, 150), 'user:kid-a:zone_id': fill(N, 'warm'),
        'user:kid-a:rings_total': [...fill(40, 10), ...fill(40, 3)], // a dip
        'user:guest-c:heart_rate': fill(N, 140), 'user:guest-c:rings_total': Array.from({ length: N }, (_, i) => i),
        'user:parent:heart_rate': fill(N, 70), 'user:parent:rings_total': fill(N, 0),
        'user:kid-f:heart_rate': [...fill(40, 130), ...fill(40, null)], 'user:kid-f:zone_id': [...fill(40, 'warm'), ...fill(40, null)],
        'user:kid-f:rings_total': Array.from({ length: N }, (_, i) => Math.min(i, 40)),
        'user:kid-b:heart_rate': fill(N, null), 'user:kid-b:rings_total': fill(N, 0),
        'user:kid-d:heart_rate': fill(N, null), 'user:kid-d:rings_total': fill(N, 0),
        'user:stray:heart_rate': fill(N, null), 'user:stray:rings_total': fill(N, 0),
      },
      events: [],
    },
  };
}

async function save(pm, data) {
  let payload = null;
  pm._persistApi = vi.fn().mockImplementation(async (url, body) => {
    if (url === 'api/v1/fitness/save_session') payload = body?.sessionData;
    return { ok: true };
  });
  expect(pm.persistSession(data, { force: true })).toBe(true);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return payload;
}

describe('PersistenceManager — participants describe the person', () => {
  let pm;
  beforeEach(() => {
    warn.mockClear();
    pm = new PersistenceManager({ persistApi: vi.fn() });
    pm.setUsageThresholdMs(300000);
    pm.setParticipantDirectory({
      primaryIds: ['kid-a', 'kid-d', 'kid-f', 'parent'],
      names: { 'kid-a': 'Kid A', 'kid-d': 'Kid D', 'kid-f': 'Kid F', parent: 'Parent', 'guest-c': 'Guest C', 'kid-b': 'Kid B' },
    });
  });

  it('derives flags and names from the directory', async () => {
    const p = (await save(pm, sessionData())).participants;
    expect(p['kid-a']).toMatchObject({ display_name: 'Kid A', is_primary: true });
    expect(p['kid-a']).not.toHaveProperty('is_guest');
    expect(p['kid-a']).not.toHaveProperty('base_user');
    expect(p['guest-c']).toMatchObject({ display_name: 'Guest C', is_guest: true });
    expect(p['guest-c']).not.toHaveProperty('is_primary');
    expect(p.parent).toMatchObject({ display_name: 'Parent', is_primary: true });
    expect(p.parent).not.toHaveProperty('base_user');
  });

  it('takes participants from stints, not stray series names', async () => {
    const p = (await save(pm, sessionData())).participants;
    expect(Object.keys(p).sort()).toEqual(['guest-c', 'kid-a', 'kid-f', 'parent']);
  });

  it('flattens a dipping cumulative series and reports it', async () => {
    await save(pm, sessionData());
    expect(warn).toHaveBeenCalledWith('fitness.persistence.cumulative_regressed', expect.objectContaining({ key: 'user:kid-a:rings_total', tick: 40, drop: 7 }));
  });
});
