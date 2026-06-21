import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

const { FitnessSession } = await import('./FitnessSession.js');

// Build a valid HR sample the pre-session buffer accepts.
const hrSample = (deviceId, hr) => ({
  deviceId, type: 'heart_rate', profile: 'heart_rate', heartRate: hr,
  data: { heartRate: hr }, timestamp: Date.now()
});

// Push enough valid HR samples to cross the 3-sample threshold and start a session.
function startSession(session, deviceId = '1001') {
  session.setKioskMode(true);
  for (let i = 0; i < 4; i++) session.ingestData(hrSample(deviceId, 120));
  return session.sessionId;
}

describe('FitnessSession deliberate-end cooldown bypass', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does NOT arm the auto-start cooldown after a user_initiated end', () => {
    const session = new FitnessSession();
    const firstId = startSession(session);
    expect(firstId).toBeTruthy();

    session.endSession('user_initiated');
    expect(session.sessionId).toBeNull();

    // A fresh, genuine workout should be able to start immediately (no cooldown).
    // NB: the id is a YYYYMMDDHHmmss timestamp, so a same-second restart in tests
    // can reuse the id — the meaningful assertion is that a session starts at all.
    const secondId = startSession(session, '1002');
    expect(secondId).toBeTruthy();
  });

  it('STILL arms the cooldown after an inactivity/empty_roster end', () => {
    const session = new FitnessSession();
    startSession(session);
    session.endSession('empty_roster');
    expect(session.sessionId).toBeNull();

    // Cooldown active → genuine HR within the window must NOT start a session.
    const secondId = startSession(session, '1002');
    expect(secondId).toBeNull();
  });
});
