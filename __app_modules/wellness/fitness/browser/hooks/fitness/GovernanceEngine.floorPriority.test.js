import { afterEach, describe, expect, it, vi } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

vi.mock('../../../../../../frontend/src/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});
const engines = [];
afterEach(() => engines.splice(0).forEach((engine) => engine.reset()));
const ranks = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
function harness({ hold = 0, start = 100000, type = 'zone' } = {}) {
  let now = start;
  const awardBonus = vi.fn(() => ({ awarded: true }));
  const engine = new GovernanceEngine({ treasureBox: { awardBonus }, getVibrationTracker: () => null }, { now: () => now, random: () => 0 });
  engines.push(engine);
  engine.configure({ governed_labels: ['cardio'], grace_period_seconds: 30, challenge_hold_seconds: hold,
    policies: { default: { base_requirement: [{ active: 'all' }], challenges: [{ interval: [100, 100], min_participants: 0,
      selections: [{ zone: 'warm', participants: 'all', time_allowed: 40 }] }] } } });
  engine.setMedia({ id: 'workout', labels: ['cardio'] });
  const evaluate = (zones = { a: 'active', b: 'active' }, steps = 10) => engine.evaluate({
    activeParticipants: Object.keys(zones), userZoneMap: zones, zoneRankMap: ranks,
    zoneInfoMap: { active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' } }, totalCount: Object.keys(zones).length,
    activityMetricMap: { mat: { online: true, active: false, sessionSteps: steps } }, equipmentRiderMap: { mat: 'a' },
    equipmentCadenceMap: { bike: { rpm: 80, connected: true, ts: now } },
  });
  evaluate();
  const challenge = { id: 'saved-challenge', policyId: 'default', type, status: 'pending', zone: 'warm', rule: 'all', requiredCount: 2,
    startedAt: now, expiresAt: now + 40000, timeLimitSeconds: 40, pausedAt: null, pausedRemainingMs: null,
    ...(type === 'step' ? { equipment: 'mat', metric: 'steps', target: 40, requiredCount: 40, startCount: 10 } : {}),
    ...(type === 'cycle' ? { equipment: 'bike', rider: 'a', cycleState: 'maintain', currentPhaseIndex: 0, totalPhases: 1,
      generatedPhases: [{ hiRpm: 60, loRpm: 30, maintainSeconds: 120, rampSeconds: 10 }],
      selection: { init: { minRpm: 30 }, boost: {} }, phaseProgressMs: 2000, cycleHealthMs: 10000,
      _lastCycleTs: now, totalBoostedMs: 0, boostContributors: new Set(), totalLockEventsCount: 0 } : {}),
  };
  engine.challengeState.activeChallenge = challenge;
  evaluate();
  return { engine, challenge, evaluate, awardBonus, advance: (ms) => { now += ms; }, now: () => now };
}

describe('floor priority through evaluate', () => {
  it('pending challenge pauses as soon as floor becomes unmet', () => {
    const h = harness();
    h.evaluate({ a: 'cool', b: 'warm' });
    expect(h.engine.phase).toBe('warning');
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'pending', paused: true, pauseReason: 'floor_unmet', remainingSeconds: 40 });
    h.advance(60000); h.evaluate({ a: 'cool', b: 'warm' });
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'pending', remainingSeconds: 40 });
    expect(h.engine.state.challengeHistory).toEqual([]);
    expect(h.awardBonus).not.toHaveBeenCalled();
  });
  it('terminal failed cycle banks its remaining publication window and then cleans up without new recovery', () => {
    const h = harness({ type: 'cycle' });
    Object.assign(h.challenge, { status: 'failed', failReason: 'never_started', cycleState: 'locked', lockReason: 'init' });
    h.evaluate();
    const publicationStart = h.challenge.failPublishedAt;
    const cooldownUntil = h.engine._cycleCooldowns.a;
    expect(h.engine.state.challengeHistory).toEqual([expect.objectContaining({ id: 'saved-challenge', status: 'failed', failReason: 'never_started' })]);
    h.advance(200); h.evaluate({ a: 'cool', b: 'active' });
    h.advance(60000); h.evaluate({ a: 'cool', b: 'active' });
    // The original 600ms publication window expired long ago in wall time.
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'failed', paused: true, pauseReason: 'floor_unmet' });
    expect(h.challenge.failPublishedAt).toBe(publicationStart);
    expect(h.engine.state.challengeHistory).toHaveLength(1);
    expect(h.engine._cycleCooldowns.a).toBe(cooldownUntil);
    h.evaluate();
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'failed', paused: false });
    expect(h.challenge.failPublishedAt).toBe(publicationStart + 60000);
    h.advance(399); h.evaluate();
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'failed' });
    h.advance(1); h.evaluate();
    expect(h.engine.state.challenge).toBeNull();
    h.advance(1); h.evaluate();
    expect(h.engine.state.videoLocked).toBe(false);
    expect(h.engine.state.challengeHistory).toHaveLength(1);
    expect(h.engine._cycleCooldowns.a).toBe(cooldownUntil);
    expect(h.awardBonus).not.toHaveBeenCalled();
  });
  it('failed challenge backgrounds and returns after floor recovery', () => {
    const h = harness();
    h.advance(40001); h.evaluate();
    expect(h.engine.state.challenge.status).toBe('failed');
    h.evaluate({ a: 'cool', b: 'active' });
    expect(h.engine.state.challenge).toMatchObject({ status: 'failed', paused: true });
    h.advance(60000); h.evaluate();
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', status: 'failed', paused: false });
    expect(h.engine.state.videoLocked).toBe(true);
    h.evaluate({ a: 'warm', b: 'warm' });
    expect(h.engine.state.challenge.status).toBe('success');
    expect(h.engine.state.videoLocked).toBe(false);
  });
  it('floor recovery resumes saved challenge time once', () => {
    const h = harness();
    h.evaluate({ a: 'cool', b: 'active' });
    h.advance(60000); h.evaluate(); h.evaluate();
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', paused: false, remainingSeconds: 40 });
    h.advance(1000); h.evaluate();
    expect(h.engine.state.challenge.remainingSeconds).toBe(39);
    h.engine.challengeState.activeChallenge = null;
    h.engine.challengeState.nextChallengeAt = h.now();
    h.evaluate({ a: 'cool', b: 'active' });
    expect(h.engine.state.challenge).toBeNull();
  });
  it('paused hold preserves earned elapsed time without earning paused time', () => {
    const h = harness({ hold: 10 });
    h.evaluate({ a: 'warm', b: 'active' });
    h.advance(4000); h.evaluate({ a: 'warm', b: 'active' });
    h.evaluate({ a: 'warm', b: 'cool' });
    h.advance(60000); h.evaluate({ a: 'warm', b: 'cool' });
    expect(h.engine.state.challenge.holdProgressByUser.a).toEqual({ elapsedMs: 4000, remainingMs: 6000, totalMs: 10000 });
    h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.holdProgressByUser.a.remainingMs).toBe(6000);
    h.advance(5999); h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.metUsers).toEqual([]);
    h.advance(1); h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.metUsers).toEqual(['a']);
  });
  it.each(['target loss', 'departure'])('paused hold resets after observed %s without transferring credit', (loss) => {
    const h = harness({ hold: 10 });
    h.evaluate({ a: 'warm', b: 'active' });
    h.advance(4000); h.evaluate({ a: 'warm', b: 'active' });
    h.evaluate({ a: 'warm', b: 'cool' });
    h.advance(1000); h.evaluate(loss === 'departure' ? { b: 'cool' } : { a: 'active', b: 'cool' });
    h.advance(59000); h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.holdProgressByUser.a).toEqual({ elapsedMs: 0, remainingMs: 10000, totalMs: 10000 });
    expect(h.engine.state.challenge.metUsers).toEqual([]);
  });
  it('step and cycle effort do not accrue behind floor', () => {
    const h = harness({ type: 'step' });
    h.evaluate(undefined, 14);
    expect(h.engine.state.challenge.actualCount).toBe(4);
    h.evaluate({ a: 'cool', b: 'active' }, 14);
    h.advance(60000); h.evaluate({ a: 'cool', b: 'active' }, 100);
    expect(h.engine.state.challenge).toMatchObject({ paused: true, actualCount: 4, status: 'pending' });
    h.evaluate(undefined, 120);
    expect(h.engine.state.challenge.actualCount).toBe(4);
    h.advance(1000); h.evaluate(undefined, 123);
    expect(h.engine.state.challenge.actualCount).toBe(7);
    expect(h.awardBonus).not.toHaveBeenCalled();
    const c = harness({ type: 'cycle' });
    c.evaluate({ a: 'cool', b: 'active' });
    c.advance(60000); c.evaluate({ a: 'cool', b: 'active' });
    expect(c.challenge.phaseProgressMs).toBe(2000);
    expect(c.engine.state.challenge).toMatchObject({ paused: true, pauseReason: 'floor_unmet', status: 'pending' });
    c.evaluate();
    expect(c.challenge.phaseProgressMs).toBe(2000);
    c.advance(1000); c.evaluate();
    expect(c.challenge.phaseProgressMs).toBe(3000);
  });
  it('banks the challenge and invalidates holds when the last participant leaves', () => {
    const h = harness({ hold: 10 });
    h.evaluate({ a: 'warm', b: 'active' });
    h.advance(4000); h.evaluate({ a: 'warm', b: 'active' });
    h.evaluate({});
    h.advance(60000); h.evaluate({});
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', paused: true, remainingSeconds: 36 });
    h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.holdProgressByUser.a.remainingMs).toBe(10000);
  });
  it('observes target loss during a nested manual pause without earning hold time', () => {
    const h = harness({ hold: 10 });
    h.evaluate({ a: 'warm', b: 'active' });
    h.advance(4000); h.evaluate({ a: 'warm', b: 'active' });
    h.evaluate({ a: 'warm', b: 'cool' });
    h.engine.setPlaybackPaused(true);
    h.advance(1000); h.evaluate({ a: 'active', b: 'cool' });
    h.advance(59000); h.engine.setPlaybackPaused(false);
    h.evaluate({ a: 'warm', b: 'active' });
    expect(h.engine.state.challenge.holdProgressByUser.a.remainingMs).toBe(10000);
  });
  it('preserves an active challenge when departure falls below its start minimum', () => {
    const h = harness({ hold: 10 });
    h.engine.policies[0].challenges[0].minParticipants = 2;
    h.evaluate({ a: 'warm', b: 'cool' });
    h.advance(1000); h.evaluate({ b: 'cool' });
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', paused: true, status: 'pending' });
  });
  it('base credit identities match subject numerator with an exempt rider', () => {
    const h = harness();
    h.engine.config.exemptions = ['exempt'];
    h.evaluate({ a: 'cool', b: 'active', c: 'active', d: 'active', exempt: 'warm' });
    expect(h.engine.state.requirements[0]).toMatchObject({ actualCount: 3, requiredCount: 4, eligibleMetUsers: ['b', 'c', 'd'] });
  });
  it('zero timestamp and nested manual pause restore clocks once', () => {
    const h = harness({ start: 0, hold: 10 });
    h.evaluate({ a: 'cool', b: 'active' });
    expect(h.engine.state.challenge.paused).toBe(true);
    h.advance(10000); h.engine.setPlaybackPaused(true);
    h.advance(20000); h.engine.setPlaybackPaused(false);
    h.advance(30000); h.evaluate(); h.evaluate();
    expect(h.engine.state.challenge).toMatchObject({ id: 'saved-challenge', remainingSeconds: 40, paused: false });
    h.advance(5000); h.evaluate({ a: 'cool', b: 'active' });
    h.advance(20000); h.evaluate();
    expect(h.engine.state.challenge.remainingSeconds).toBe(35);
  });
});
