/**
 * Regression: the auto-merge/resume check must not fork a fresh session when
 * the HR buffer trips before content has registered (mid-workout kiosk reload).
 *
 * Incident 2026-06-22 (sessions 20260622054305 + 20260622062051): on a reload,
 * buffer.threshold_met fired at +1s but the play-queue head (contentId) wasn't
 * known until +3s. The resume check saw no content, logged
 * `resume_check.no_content`, and started a brand-new session WITHOUT querying
 * the backend `/resumable` — permanently forking what should have been one
 * resumed session. Fix: defer the check (bounded by resumeContentWait) and
 * retry via the natural buffer re-trigger once content arrives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The live-session claim on the start path calls DaylightAPI. Unmocked it
// reaches for the fictional test-page origin, and the rejection adds an
// unpredictable number of async turns before the session id appears. `{}` is
// the "no authority answer" shape, which falls through to a normal fresh start.
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

import { FitnessSession } from './FitnessSession.js';

function hrPacket(deviceId, bpm) {
  return { topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: bpm } };
}

// Feed enough packets to clear the per-device startup discard and trip the
// pre-session buffer threshold at least once.
function feedUntilThreshold(session, deviceId, n = 10) {
  for (let i = 0; i < n; i += 1) session.ingestData(hrPacket(deviceId, 120 + i));
}

describe('FitnessSession — resume check defers when content is not registered yet', () => {
  let resumableSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_782_133_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeSession() {
    const session = new FitnessSession();
    session.userManager.registerUser({ id: 'u1', name: 'U One', hr_device_id: 'hr-1' });
    // Resolve as "no resumable" so the post-content path completes deterministically.
    resumableSpy = vi.spyOn(session, '_checkResumable').mockResolvedValue({ resumable: false });
    return session;
  }

  it('does NOT start a session or query the backend while content is unknown', () => {
    const session = makeSession();
    feedUntilThreshold(session, 'hr-1');

    // Deferred: no session forked, no backend resumable query.
    expect(session.sessionId).toBeFalsy();
    expect(resumableSpy).not.toHaveBeenCalled();
  });

  it('runs the resumable check once content registers (within the wait budget)', () => {
    const session = makeSession();
    feedUntilThreshold(session, 'hr-1');
    expect(session.sessionId).toBeFalsy(); // still deferred

    // Content arrives a moment later (play-queue head resolves).
    vi.advanceTimersByTime(2500);
    session.setPendingContentId('plex:598547');
    feedUntilThreshold(session, 'hr-1'); // buffer re-trips

    expect(resumableSpy).toHaveBeenCalledTimes(1);
    expect(resumableSpy).toHaveBeenCalledWith('plex:598547');
  });

  it('falls back to a fresh session if content never registers within the budget', async () => {
    const session = makeSession();
    feedUntilThreshold(session, 'hr-1');
    expect(session.sessionId).toBeFalsy();

    // Content never arrives; wait past the budget, then more HR data.
    vi.advanceTimersByTime(6500); // > resumeContentWait (6000)
    feedUntilThreshold(session, 'hr-1');

    // The start path awaits the resume check and the live-session claim, so the
    // id lands a few async turns after the packets — wait on the condition
    // rather than a fixed flush count that goes stale as hops are added.
    for (let i = 0; i < 50 && session.sessionId == null; i++) await Promise.resolve();

    expect(session.sessionId).toBeTruthy();        // fresh session started
    expect(resumableSpy).not.toHaveBeenCalled();   // never had content to check
  });
});
