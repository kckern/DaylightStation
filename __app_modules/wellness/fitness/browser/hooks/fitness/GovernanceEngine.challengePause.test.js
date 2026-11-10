import { describe, it, expect, vi } from 'vitest';

// Silence the structured logger (same rationale as GovernanceEngine.audioDuck.test.js:
// we assert on return values, never on logs).
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from "./GovernanceEngine.js";

// A zone (non-cycle) challenge frozen mid-pause. expiresAt is deliberately STALE:
// evaluate()'s freeze-resume leaves it at its old absolute value while the real
// remaining time is banked in pausedRemainingMs.
const pausedChallenge = (overrides = {}) => ({
  id: 'ch1',
  status: 'pending',
  zone: 'active',
  requiredCount: 2,
  startedAt: 60000,
  timeLimitSeconds: 45,
  expiresAt: 100000,
  pausedAt: 85500,
  pausedRemainingMs: 14500,
  summary: null,
  ...overrides
});

describe('GovernanceEngine — _buildChallengeSnapshot pause-aware remaining time', () => {
  it('derives remainingSeconds from pausedRemainingMs while paused, not from stale expiresAt', () => {
    // 5 s past the stale expiresAt: expiresAt-now math would report 0.
    const engine = new GovernanceEngine(null, { now: () => 105000 });
    engine.challengeState.activeChallenge = pausedChallenge();
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(true);
    expect(snap.remainingSeconds).toBe(15); // round(14500 / 1000), banked clock
  });

  it('does not decay across ticks while paused', () => {
    let t = 90000;
    const engine = new GovernanceEngine(null, { now: () => t });
    engine.challengeState.activeChallenge = pausedChallenge();
    const first = engine._buildChallengeSnapshot(t).remainingSeconds;
    t = 130000; // 40 s later, still paused
    const second = engine._buildChallengeSnapshot(t).remainingSeconds;
    expect(second).toBe(first);
  });

  it('uses expiresAt - now when not paused', () => {
    const engine = new GovernanceEngine(null, { now: () => 90000 });
    engine.challengeState.activeChallenge = pausedChallenge({ pausedAt: null, pausedRemainingMs: null });
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(false);
    expect(snap.remainingSeconds).toBe(10); // (100000 - 90000) / 1000
  });

  it('falls back to expiresAt math when pausedAt is set but pausedRemainingMs is not finite', () => {
    const engine = new GovernanceEngine(null, { now: () => 95000 });
    engine.challengeState.activeChallenge = pausedChallenge({ pausedRemainingMs: null });
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(true);
    expect(snap.remainingSeconds).toBe(5); // defensive fallback, same as today
  });
});

it('excludes the union of overlapping manual and transport pauses starting at zero', () => {
  let now = 0;
  const engine = new GovernanceEngine(null, { now: () => now });
  const events = new Map();
  engine._setupPlaybackSubscription((event, callback) => { events.set(event, callback); return () => events.delete(event); });
  engine.challengeState.activeChallenge = pausedChallenge({ startedAt: 0, expiresAt: 40000, pausedAt: null, pausedRemainingMs: null, zoneHold: { rider: 0 } });
  engine.setPlaybackPaused(true);
  now = 10000; events.get('playback:stalled')();
  now = 20000; engine.setPlaybackPaused(false);
  expect(engine._timersPaused).toBe(true);
  now = 30000; events.get('playback:recovered')();
  expect(engine._timersPaused).toBe(false);
  expect(engine._buildChallengeSnapshot(now).remainingSeconds).toBe(40);
  expect(engine.challengeState.activeChallenge.zoneHold.rider).toBe(30000);
  events.get('playback:recovered')();
  expect(engine._buildChallengeSnapshot(now).remainingSeconds).toBe(40);
  engine.reset();
});

it('publishes a frozen countdown during a manual pause starting at zero', () => {
  let now = 0;
  const engine = new GovernanceEngine(null, { now: () => now });
  engine.challengeState.activeChallenge = pausedChallenge({ startedAt: 0, expiresAt: 40000, pausedAt: null, pausedRemainingMs: null });
  engine.setPlaybackPaused(true);
  now = 60000;
  expect(engine._buildChallengeSnapshot(now)).toMatchObject({ paused: true, pauseReason: null, remainingSeconds: 40 });
  engine.setPlaybackPaused(false);
  expect(engine._buildChallengeSnapshot(now)).toMatchObject({ paused: false, remainingSeconds: 40 });
  engine.reset();
});
