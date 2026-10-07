import { describe, expect, it } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

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

function harness() {
  let now = 100_000;
  const engine = new GovernanceEngine(null, { now: () => now, random: () => 0 });
  engine.configure(CONFIG);
  engine.setMedia({ id: 'episode-1', type: 'episode', labels: ['cardio'] });
  const evaluate = (userZoneMap, guestIds = []) => engine.evaluate({
    activeParticipants: Object.keys(userZoneMap), userZoneMap,
    totalCount: Object.keys(userZoneMap).length, guestIds, ...ZONES,
  });
  return { engine, evaluate, advance: (ms) => { now += ms; } };
}

describe('GovernanceEngine — unattended child policy', () => {
  it('keeps playback pending until a non-admin child reaches hot', () => {
    const h = harness();
    h.evaluate({ child: 'active' });
    expect(h.engine.phase).toBe('pending');
    expect(h.engine.requirementSummary.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ zone: 'hot', rule: 1, satisfied: false }),
    ]));
    h.evaluate({ child: 'hot' });
    expect(h.engine.phase).toBe('unlocked');
    expect(h.engine.challengeState.nextChallengeAt).toBe(280_000);
  });

  it('does not let a guest or exempt child satisfy the startup gate', () => {
    const h = harness();
    h.engine.config.exemptions = ['exempt-child'];
    h.evaluate({ visitor: 'hot', 'exempt-child': 'hot' }, ['visitor']);
    expect(h.engine.phase).toBe('pending');
  });

  it('uses normal governance while a parent is present', () => {
    const h = harness();
    h.evaluate({ parent: 'active', child: 'active' });
    expect(h.engine.phase).toBe('unlocked');
    expect(h.engine.challengeState.nextChallengeAt).toBeNull();
  });

  it('starts a fresh hot gate when the parent leaves', () => {
    const h = harness();
    h.evaluate({ parent: 'active', child: 'active' });
    expect(h.engine.phase).toBe('unlocked');

    h.evaluate({ child: 'active' });

    expect(h.engine.phase).toBe('pending');
    expect(h.engine.meta.satisfiedOnce).toBe(false);
  });

  it('alternates all-child warm and hot challenges after startup unlock', () => {
    const h = harness();
    h.evaluate({ first: 'hot', second: 'active' });
    h.advance(179_999);
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toBeNull();
    h.advance(1);
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({
      zone: 'warm', rule: 'all', requiredCount: 2, timeLimitSeconds: 90, status: 'pending',
    });
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');

    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({
      zone: 'hot', rule: 'all', requiredCount: 2, timeLimitSeconds: 90, status: 'pending',
    });
  });

  it('locks a failed all-warm challenge and recovers only when every child is warm', () => {
    const h = harness();
    h.evaluate({ first: 'hot', second: 'active' });
    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    h.advance(90_000);
    h.evaluate({ first: 'warm', second: 'active' });
    expect(h.engine.phase).toBe('locked');
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');
    expect(h.engine.challengeState.videoLocked).toBe(false);
  });
});
