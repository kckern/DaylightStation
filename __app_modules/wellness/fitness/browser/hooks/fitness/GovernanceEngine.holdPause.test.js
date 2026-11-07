import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger, getLogger: () => logger };
});
// resolveGovernanceDisplay is pure; only the hook wrapper uses React. Stub it so
// this engine→display test runs without a React install.
vi.mock('react', () => ({ useMemo: (fn) => fn() }));

import { GovernanceEngine } from './GovernanceEngine.js';
import { resolveGovernanceDisplay } from '../useGovernanceDisplay.js';

const ZONES = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const zoneMeta = { map: Object.fromEntries(Object.entries(ZONES).map(([id, rank]) => [id, { id, name: id, rank }])) };

function setup() {
  let now = 1_000_000;
  const engine = new GovernanceEngine(null, { now: () => now });
  engine.config = { challenge_hold_seconds: 10 };
  engine._latestInputs = { ...(engine._latestInputs || {}), zoneRankMap: ZONES, guestIds: [] };
  // A failed (locking) warm challenge, rider-a in zone and holding.
  const challenge = {
    id: 'ch1', type: 'zone', status: 'failed', zone: 'warm', rule: 1, requiredCount: 1,
    startedAt: now - 60_000, expiresAt: now - 1_000, timeLimitSeconds: 59,
  };
  engine.challengeState.activeChallenge = challenge;
  const evaluate = () => {
    challenge.summary = engine.evaluateChallengeZone(challenge, ['rider-a'], { 'rider-a': 'warm' }, 1);
  };
  evaluate();
  const display = () => resolveGovernanceDisplay(
    { isGoverned: true, status: 'locked', requirements: [], challenge: engine._buildChallengeSnapshot(now) },
    new Map(), zoneMeta,
  );
  return { engine, evaluate, display, advance: (ms) => { now += ms; } };
}

describe('zone challenge hold pause → display row', () => {
  it('a playback pause marks the zone-challenge snapshot paused and the row holdPaused', () => {
    const { engine, display, advance, evaluate } = setup();
    advance(3_000); evaluate();
    const live = display();
    expect(live.rows[0]).toMatchObject({ userId: 'rider-a', status: 'holding', holdPaused: false });
    expect(live.rows[0].holdProgress.elapsedMs).toBe(3_000);

    engine.setPlaybackPaused(true);
    expect(engine._buildChallengeSnapshot(engine._now()).paused).toBe(true);
    advance(20_000);
    const paused = display();
    expect(paused.rows[0].holdPaused).toBe(true);
    // the banked hold has not grown while paused
    expect(paused.rows[0].holdProgress.elapsedMs).toBe(3_000);

    engine.setPlaybackPaused(false);
    evaluate();
    const resumed = display();
    expect(resumed.rows[0].holdPaused).toBe(false);
    expect(resumed.rows[0].holdProgress.elapsedMs).toBe(3_000);
  });
});
