import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

const { FitnessSession } = await import('./FitnessSession.js');

// Garage, 2026-10-02: the garage→server link black-holed the sensor socket for
// 2m15s mid-workout. Every HR strap was still broadcasting — the garage logged
// them the whole time — but nothing reached the browser, the roster emptied, and
// the empty-roster timer ended the session 4 minutes before the video did. A
// starved pipeline says nothing about whether anyone left the room.

function sessionWithEmptyRoster() {
  const session = new FitnessSession();
  session.sessionId = 'fs_test';
  session.startTime = Date.now() - 600000;
  Object.defineProperty(session, 'roster', { get: () => [] });
  const ended = vi.spyOn(session, 'endSession').mockImplementation(() => true);
  return { session, ended };
}

describe('FitnessSession empty-roster timeout vs transport stall', () => {
  let now;
  beforeEach(() => {
    now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('ends the session after the empty-roster timeout when packets keep arriving', () => {
    const { session, ended } = sessionWithEmptyRoster();
    for (let t = 0; t <= 70000; t += 5000) {
      now += 5000;
      session.deviceManager.lastPacketAt = now; // e.g. an idle cadence sensor still broadcasting
      session._checkEmptyRosterTimeout();
    }
    expect(ended).toHaveBeenCalledWith('empty_roster');
  });

  it('holds the timer while the whole sensor pipeline is silent', () => {
    const { session, ended } = sessionWithEmptyRoster();
    session.deviceManager.lastPacketAt = now; // last packet, then the link goes dark
    for (let t = 0; t < 136000; t += 5000) {
      now += 5000;
      session._checkEmptyRosterTimeout();
    }
    expect(ended).not.toHaveBeenCalled();
  });

  it('restarts the empty-roster clock from the moment packets resume', () => {
    const { session, ended } = sessionWithEmptyRoster();
    session.deviceManager.lastPacketAt = now;
    for (let t = 0; t < 120000; t += 5000) { now += 5000; session._checkEmptyRosterTimeout(); }
    // Link back, but nobody on the roster: a genuine empty room again.
    for (let t = 0; t < 50000; t += 5000) {
      now += 5000;
      session.deviceManager.lastPacketAt = now;
      session._checkEmptyRosterTimeout();
    }
    expect(ended).not.toHaveBeenCalled();
    for (let t = 0; t < 20000; t += 5000) {
      now += 5000;
      session.deviceManager.lastPacketAt = now;
      session._checkEmptyRosterTimeout();
    }
    expect(ended).toHaveBeenCalledWith('empty_roster');
  });

  it('stops holding once the stall outlasts the cap (bridge really gone)', () => {
    const { session, ended } = sessionWithEmptyRoster();
    session.deviceManager.lastPacketAt = now;
    for (let t = 0; t < 300000; t += 5000) { now += 5000; session._checkEmptyRosterTimeout(); }
    expect(ended).toHaveBeenCalledWith('empty_roster');
  });
});
