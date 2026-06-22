import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

const { FitnessSession } = await import('./FitnessSession.js');

// Build a valid HR sample the pre-session buffer accepts.
const hrSample = (deviceId, hr) => ({
  deviceId, type: 'heart_rate', profile: 'heart_rate', heartRate: hr,
  data: { heartRate: hr }, timestamp: Date.now()
});

// Push enough valid HR samples to cross the 3-sample threshold and start a
// session. Content is seeded so the resume check runs immediately instead of
// deferring (the content-race deferral is covered separately in
// FitnessSession.resumeContentRace.test.js); we flush the async resume check
// (DaylightAPI mocked → not resumable → fresh start).
async function startSession(session, deviceId = '1001') {
  session.setKioskMode(true);
  session.setPendingContentId('plex:demo');
  for (let i = 0; i < 4; i++) session.ingestData(hrSample(deviceId, 120));
  await Promise.resolve();
  await Promise.resolve();
  return session.sessionId;
}

describe('FitnessSession deliberate-end cooldown bypass', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does NOT arm the auto-start cooldown after a user_initiated end', async () => {
    const session = new FitnessSession();
    const firstId = await startSession(session);
    expect(firstId).toBeTruthy();

    session.endSession('user_initiated');
    expect(session.sessionId).toBeNull();

    // A fresh, genuine workout should be able to start immediately (no cooldown).
    // NB: the id is a YYYYMMDDHHmmss timestamp, so a same-second restart in tests
    // can reuse the id — the meaningful assertion is that a session starts at all.
    const secondId = await startSession(session, '1002');
    expect(secondId).toBeTruthy();
  });

  it('STILL arms the cooldown after an inactivity/empty_roster end', async () => {
    const session = new FitnessSession();
    await startSession(session);
    session.endSession('empty_roster');
    expect(session.sessionId).toBeNull();

    // Cooldown active → genuine HR within the window must NOT start a session.
    // (The cooldown short-circuits before the resume check, so this stays null.)
    const secondId = await startSession(session, '1002');
    expect(secondId).toBeNull();
  });
});
