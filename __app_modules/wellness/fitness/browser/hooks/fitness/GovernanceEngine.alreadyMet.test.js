/**
 * A challenge must never be satisfied the moment it starts. Audit 2026-10-29:
 * 6 of 12 challenges completed 1–158ms after starting (the riders were already
 * in the zone) and cut their own start sound. With no configured hold, a
 * challenge the room already meets asks the riders to HOLD the zone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

const engines = [];
afterEach(() => { engines.splice(0).forEach((e) => e.reset()); });

const ZONES = {
  zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
  zoneInfoMap: Object.fromEntries(['cool', 'active', 'warm', 'hot', 'fire'].map((id) => [id, { id, name: id }])),
};
const CONFIG = {
  governed_labels: ['cardio'],
  superusers: ['parent'],
  unattended_policy: {
    enabled: true,
    startup_zone: 'hot',
    challenge_zones: ['warm', 'hot'],
    challenge_interval_seconds: 180,
    challenge_time_allowed_seconds: 90,
  },
  policies: { default: { base_requirement: [{ active: 'all' }], challenges: [] } },
  zoneConfig: Object.values(ZONES.zoneInfoMap),
};

function harness(overrides = {}) {
  let now = 100_000;
  const engine = new GovernanceEngine(null, { now: () => now, random: () => 0 });
  engines.push(engine);
  engine.configure({ ...CONFIG, ...overrides });
  engine.setMedia({ id: 'episode-1', type: 'episode', labels: ['cardio'] });
  const evaluate = (userZoneMap, guestIds = []) => engine.evaluate({
    activeParticipants: Object.keys(userZoneMap), userZoneMap,
    totalCount: Object.keys(userZoneMap).length, guestIds, ...ZONES,
  });
  return { engine, evaluate, advance: (ms) => { now += ms; } };
}

describe('a challenge already met at its start requires a hold', () => {
  it('_alreadyMetHoldSeconds: met + no configured hold → default 10s; unmet → null', () => {
    const eng = new GovernanceEngine();
    eng.config = { challenge_hold_seconds: 0 };
    eng._captureLatestInputs({ activeParticipants: ['a', 'b'], guestIds: [], zoneRankMap: ZONES.zoneRankMap });
    expect(eng._alreadyMetHoldSeconds({ zone: 'warm', rule: 'all' }, ['a', 'b'], { a: 'hot', b: 'warm' }, 2)).toBe(10);
    expect(eng._alreadyMetHoldSeconds({ zone: 'warm', rule: 'all' }, ['a', 'b'], { a: 'hot', b: 'active' }, 2)).toBeNull();
    eng.config = { challenge_hold_seconds: 0, challenge_already_met_hold_seconds: 5 };
    expect(eng._alreadyMetHoldSeconds({ zone: 'warm', rule: 1 }, ['a', 'b'], { a: 'hot', b: 'cool' }, 2)).toBe(5);
    // A configured hold already prevents an instant win.
    eng.config = { challenge_hold_seconds: 3 };
    expect(eng._alreadyMetHoldSeconds({ zone: 'warm', rule: 'all' }, ['a', 'b'], { a: 'hot', b: 'warm' }, 2)).toBeNull();
  });

  it('a challenge that starts with every rider already in the zone does not complete on the next tick', () => {
    const h = harness({ challenge_hold_seconds: 0 });
    h.evaluate({ first: 'hot', second: 'hot' });
    h.advance(180_000);
    // The warm challenge comes due while both riders are already warm.
    h.evaluate({ first: 'warm', second: 'warm' });
    const started = h.engine.challengeState.activeChallenge;
    expect(started).toMatchObject({ zone: 'warm', status: 'pending', holdSeconds: 10 });
    h.advance(150);
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('pending');
    // Holding the zone for the hold completes it.
    h.advance(10_000);
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');
  });

  it('a challenge that starts unmet keeps instant credit (no hold added)', () => {
    const h = harness({ challenge_hold_seconds: 0 });
    h.evaluate({ first: 'hot', second: 'hot' });
    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({ zone: 'warm', status: 'pending' });
    expect(h.engine.challengeState.activeChallenge.holdSeconds).toBeUndefined();
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');
  });

  it('a rider straddling the zone boundary still completes it (brief dips keep the hold)', () => {
    const h = harness({ challenge_hold_seconds: 0 });
    h.evaluate({ first: 'hot', second: 'hot' });
    h.advance(180_000);
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({ zone: 'warm', holdSeconds: 10 });
    // 12s of samples every 500ms; the second rider dips to active for 1s every 2s.
    for (let t = 500; t <= 12_000; t += 500) {
      h.advance(500);
      const dip = (t % 2000) >= 1000;
      h.evaluate({ first: 'warm', second: dip ? 'active' : 'warm' });
      if (h.engine.challengeState.activeChallenge?.status === 'success') break;
    }
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');
  });

  it('a rider who genuinely leaves the zone (longer than the grace) loses the hold', () => {
    const h = harness({ challenge_hold_seconds: 0 });
    h.evaluate({ first: 'hot', second: 'hot' });
    h.advance(180_000);
    h.evaluate({ first: 'warm', second: 'warm' });
    // 4s below zone (grace is 3s), then back in zone.
    for (let i = 0; i < 8; i++) { h.advance(500); h.evaluate({ first: 'warm', second: 'active' }); }
    h.advance(500);
    h.evaluate({ first: 'warm', second: 'warm' });
    const challenge = h.engine.challengeState.activeChallenge;
    expect(challenge?.status).toBe('pending');
    // The second rider's hold restarted; the first rider's did not.
    expect(challenge.zoneHold.second).toBeGreaterThan(challenge.zoneHold.first);
  });

  it('a configured challenge_hold_seconds keeps its strict reset on any dip', () => {
    const eng = new GovernanceEngine(null, { now: () => clock });
    let clock = 0;
    eng.config = { challenge_hold_seconds: 5 };
    eng._captureLatestInputs({ activeParticipants: ['a'], guestIds: [], zoneRankMap: ZONES.zoneRankMap });
    const ch = { zone: 'warm', rule: 'all' };
    eng.evaluateChallengeZone(ch, ['a'], { a: 'warm' }, 1);
    clock = 1000;
    eng.evaluateChallengeZone(ch, ['a'], { a: 'active' }, 1);
    expect(ch.zoneHold.a).toBeUndefined();
  });
});
