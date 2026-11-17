import { describe, it, expect, vi } from 'vitest';
import { PersistenceManager } from "./PersistenceManager.js";
import { SessionService } from '../../../server/application/services/SessionService.mjs';
import { serializeSession, reconstituteSession } from '../../../server/application/sessionRecords.mjs';
import { dehydrateSessionRecord } from '../../../server/adapters/persistence/YamlSessionDatastore.mjs';

// Minimal valid session payload that passes validateSessionPayload.
function validSession() {
  const now = Date.now();
  // Need 100+ ticks to pass tickCount check; HR series must use key ending in ':hr'
  const hrData = Array.from({ length: 100 }, () => 120);
  return {
    sessionId: 'fs_20260528194117',
    startTime: now - 600000,
    endTime: now,
    durationMs: 600000,
    roster: [{ userId: 'user_2' }],
    timeline: {
      series: { 'user_2:hr': hrData },
      timebase: { tickCount: 100 },
    },
  };
}

describe('PersistenceManager — whenLastSaveSettled', () => {
  it('resolves after the save_session POST settles', async () => {
    let resolveSave;
    const persistApi = vi.fn((url) => {
      if (url === 'api/v1/fitness/save_session') {
        return new Promise((res) => { resolveSave = () => res({ ok: true }); });
      }
      return Promise.resolve({ ok: true, granted: true });
    });
    const pm = new PersistenceManager({ persistApi });

    pm.persistSession(validSession(), { force: true });
    const settled = pm.whenLastSaveSettled();
    expect(settled).toBeInstanceOf(Promise);

    let done = false;
    settled.then(() => { done = true; });

    // Drain microtasks until the save_session mock is called (resolveSave is set).
    // The chain goes through _enrichMissingPlexMetadata (async) + 2 .then() steps,
    // so we need multiple ticks before the POST fires.
    for (let i = 0; i < 10 && typeof resolveSave !== 'function'; i++) {
      await Promise.resolve();
    }
    expect(typeof resolveSave).toBe('function');  // POST is now in flight
    expect(done).toBe(false);   // not yet — save_session POST is pending
    resolveSave();
    await settled;
    expect(done).toBe(true);
  });

  it('returns an already-resolved promise when no save is in flight', async () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    await expect(pm.whenLastSaveSettled()).resolves.toBeUndefined();
  });
});

describe('PersistenceManager transport checkpoint followed by explicit end', () => {
  it('commits the final snapshot after an in-flight checkpoint and waits for both', async () => {
    let completeCheckpoint;
    let completeFirstFinal;
    const requests = [];
    let disk;
    const service = new SessionService({ sessionStore: {
      findById: async () => disk ? reconstituteSession(disk) : null,
      findByDate: async () => [{ ...reconstituteSession(disk), contentId: 'plex:test' }],
      save: async entity => { disk = JSON.parse(JSON.stringify(dehydrateSessionRecord(entity))); },
    } });
    const pm = new PersistenceManager({ persistApi: async (url, body) => {
      if (!url.endsWith('save_session')) return { granted: true };
      requests.push(body.sessionData);
      if (requests.length === 1) await new Promise(resolve => { completeCheckpoint = resolve; });
      if (requests.length === 2) await new Promise(resolve => { completeFirstFinal = resolve; });
      return service.saveSession(body.sessionData, 'test');
    } });
    const checkpoint = { ...validSession(), metadata: { transportPause: { incidentId: 'loss-1' } } };
    expect(pm.persistSession(checkpoint, { force: true })).toBe(true);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(requests).toHaveLength(1);
    const final = { ...validSession(), finalized: true, metadata: { endReason: 'force_break' } };
    expect(pm.persistSession(final, { force: true })).toBe(true);
    final.metadata.endReason = 'manual';
    expect(pm.persistSession(final, { force: true })).toBe(true);
    final.metadata.endReason = 'mutated-after-request';
    let settled = false;
    const completion = pm.whenLastSaveSettled().then(() => { settled = true; });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(settled).toBe(false);
    completeCheckpoint({ ok: true });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(pm.isSaveInProgress()).toBe(true);
    expect(settled).toBe(false);
    let latestSettled = false;
    const latestCompletion = pm.whenLastSaveSettled().then(() => { latestSettled = true; });
    expect(latestSettled).toBe(false);
    completeFirstFinal({ ok: true });
    await completion;
    await latestCompletion;
    expect(requests).toHaveLength(3);
    expect(requests[1]).toMatchObject({ finalized: true, metadata: { endReason: 'force_break' } });
    expect(requests[2]).toMatchObject({ finalized: true, metadata: { endReason: 'manual' } });
    expect(pm.successfulSaveRevision).toBe(3);
    const reopened = serializeSession(reconstituteSession(disk));
    expect(reopened).toMatchObject({ finalized: true, metadata: { endReason: 'manual' } });
    expect(reopened.metadata.transportPause).toBeUndefined();
    expect(await service.findResumable('plex:test', 'test')).toEqual({ resumable: false });
  });
});
