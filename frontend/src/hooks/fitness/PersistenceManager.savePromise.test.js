import { describe, it, expect, vi } from 'vitest';
import { PersistenceManager } from './PersistenceManager.js';

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
