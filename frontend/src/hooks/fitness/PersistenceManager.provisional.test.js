/**
 * Provisional persistence (Stage 3 of the 2026-07-17 fitness re-architecture).
 *
 * Bug: PersistenceManager rejected ALL persistence — including autosaves and the
 * endSession() final save — for sessions under 5 minutes (durationMs < 300000).
 * So a crash/reload before the 5-min mark left nothing on the backend, /resumable
 * found no session, and the workout forked + lost its opening minutes (the
 * 2026-07-17 incident lost ~4.5 min). A deliberately-ended 4:59 workout lost
 * everything too (force:true does NOT bypass validation).
 *
 * Fix: lower the hard floor to 60s and persist 60s–5min non-finalized sessions
 * marked `provisional: true` so /resumable can match them on reload. The
 * roster/HR/tick junk gates stay, so sensor-flap noise is still rejected.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => ({
  default: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  __esModule: true,
}));

import { PersistenceManager } from './PersistenceManager.js';

/** A session that passes the roster/HR/tick junk gates; caller sets durationMs. */
function session(durationMs, extra = {}) {
  const now = Date.now();
  return {
    sessionId: 'fs_20260717080000',
    startTime: now - durationMs,
    endTime: now,
    durationMs,
    roster: [{ userId: 'user_2' }],
    deviceAssignments: [{ deviceId: 'd1' }],
    timeline: { series: { 'user:user_2:hr': [120, 121, 122] }, timebase: { tickCount: 20 }, events: [] },
    tickCount: 20,
    ...extra,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PersistenceManager — provisional persistence', () => {
  it('rejects a sub-60s session as too short', () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    const v = pm.validateSessionPayload(session(45000));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('session-too-short');
  });

  it('accepts a 90s session (was rejected under the old 5-min floor)', () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    expect(pm.validateSessionPayload(session(90000)).ok).toBe(true);
  });

  it('marks a 90s non-finalized save as provisional in the payload', async () => {
    const persistApi = vi.fn().mockResolvedValue({ ok: true });
    const pm = new PersistenceManager({ persistApi });
    pm.persistSession(session(90000), { force: true });
    await flush();

    const saveCall = persistApi.mock.calls.find(([url]) => url === 'api/v1/fitness/save_session');
    expect(saveCall).toBeTruthy();
    expect(saveCall[1].sessionData.provisional).toBe(true);
  });

  it('does NOT mark a 6-minute session provisional', async () => {
    const persistApi = vi.fn().mockResolvedValue({ ok: true });
    const pm = new PersistenceManager({ persistApi });
    pm.persistSession(session(360000), { force: true });
    await flush();

    const saveCall = persistApi.mock.calls.find(([url]) => url === 'api/v1/fitness/save_session');
    expect(saveCall[1].sessionData.provisional).toBeFalsy();
  });

  it('does NOT mark a finalized short session provisional (finalized wins)', async () => {
    const persistApi = vi.fn().mockResolvedValue({ ok: true });
    const pm = new PersistenceManager({ persistApi });
    pm.persistSession(session(90000, { finalized: true }), { force: true });
    await flush();

    const saveCall = persistApi.mock.calls.find(([url]) => url === 'api/v1/fitness/save_session');
    expect(saveCall[1].sessionData.provisional).toBeFalsy();
  });
});
