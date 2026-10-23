import { describe, expect, it, vi } from 'vitest';
import { GovernanceEngine } from "./GovernanceEngine.js";

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
  engine.configure({ ...CONFIG, ...overrides });
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
    const h = harness({ challenge_hold_seconds: 0 }); // asserts same-tick completion, not the D5 hold
    h.evaluate({ first: 'hot', second: 'hot' }); // both started: these tests are about challenges, not the D3 start gate
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
    const h = harness({ challenge_hold_seconds: 0 }); // asserts same-tick completion, not the D5 hold
    h.evaluate({ first: 'hot', second: 'hot' }); // both started: these tests are about challenges, not the D3 start gate
    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    h.advance(90_000);
    h.evaluate({ first: 'warm', second: 'active' });
    expect(h.engine.phase).toBe('locked');
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');
    expect(h.engine.challengeState.videoLocked).toBe(false);
  });

  // 2026-10-10 garage session: three kids alone, all-warm passed, then every
  // hot challenge was skipped by the 20-BPM feasibility check (kids cruising
  // ~26 BPM under hot). The countdown hit zero and silently reset, forever.
  it('issues the hot challenge even when every child is far below hot', () => {
    const h = harness({ challenge_hold_seconds: 0 }); // asserts same-tick completion, not the D5 hold
    const hotMin = 160;
    const zoneConfig = [
      { id: 'cool', min: 0 }, { id: 'active', min: 100 },
      { id: 'warm', min: 120 }, { id: 'hot', min: hotMin }, { id: 'fire', min: 180 },
    ];
    h.engine.session = {
      getParticipantProfile: () => ({ heartRate: 134, zoneConfig }),
    };
    h.evaluate({ first: 'hot', second: 'hot' }); // both started: these tests are about challenges, not the D3 start gate
    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge?.status).toBe('success');

    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({
      zone: 'hot', rule: 'all', status: 'pending',
    });
  });
});

describe('GovernanceEngine — cyclic selection after an infeasible skip', () => {
  it('moves past a skipped selection instead of retrying it forever', () => {
    let now = 100_000;
    const engine = new GovernanceEngine(null, { now: () => now, random: () => 0 });
    engine.configure({
      governed_labels: ['cardio'],
      policies: {
        default: {
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [60, 60],
            selection_type: 'cyclic',
            selections: [
              { zone: 'hot', min_participants: 'all', time_allowed: 60 },
              { zone: 'warm', min_participants: 'all', time_allowed: 60 },
            ],
          }],
        },
      },
      zoneConfig: Object.values(ZONES.zoneInfoMap),
    });
    engine.setMedia({ id: 'episode-1', type: 'episode', labels: ['cardio'] });
    const zoneConfig = [
      { id: 'cool', min: 0 }, { id: 'active', min: 100 },
      { id: 'warm', min: 120 }, { id: 'hot', min: 160 }, { id: 'fire', min: 180 },
    ];
    engine.session = { getParticipantProfile: () => ({ heartRate: 125, zoneConfig }) };
    const evaluate = (userZoneMap) => engine.evaluate({
      activeParticipants: Object.keys(userZoneMap), userZoneMap,
      totalCount: Object.keys(userZoneMap).length, guestIds: [], ...ZONES,
    });

    evaluate({ a: 'active', b: 'active' });
    expect(engine.phase).toBe('unlocked');
    // Hot comes due and is skipped as infeasible (both 35 BPM under hot).
    now = engine.challengeState.nextChallengeAt;
    evaluate({ a: 'active', b: 'active' });
    evaluate({ a: 'active', b: 'active' });
    expect(engine.challengeState.activeChallenge).toBeNull();
    expect(engine.challengeState.nextChallenge?.zone).toBe('warm');

    now = engine.challengeState.nextChallengeAt;
    evaluate({ a: 'active', b: 'active' });
    evaluate({ a: 'active', b: 'active' });
    expect(engine.challengeState.activeChallenge).toMatchObject({ zone: 'warm', status: 'pending' });
  });
});

describe('GovernanceEngine — no eligible child', () => {
  it('an exempt rider alone gets the normal policy, not the hot start gate', () => {
    const h = harness();
    h.engine.config.exemptions = ['exempt-rider'];
    h.evaluate({ 'exempt-rider': 'active' });
    const reqs = h.engine.requirementSummary.requirements;
    expect(reqs.some((r) => r.type === 'unattended_startup')).toBe(false);
    // Normal base requirement (active), not the hot start gate. An exempt rider
    // alone cannot satisfy it (non_exempt_contributor_required), so it stays pending.
    expect(reqs).toEqual(expect.arrayContaining([expect.objectContaining({ zone: 'active' })]));
    expect(reqs.some((r) => r.zone === 'hot')).toBe(false);
  });
  // Anti-cheat: guests never unlock governed content by themselves.
  it('a guest alone keeps the unattended start gate and the video stays locked', () => {
    const h = harness();
    h.evaluate({ visitor: 'hot' }, ['visitor']);
    expect(h.engine.phase).toBe('pending');
    const start = h.engine.requirementSummary.requirements.find((r) => r.type === 'unattended_startup');
    expect(start).toMatchObject({ satisfied: false });
  });
  it('a child who hands their strap to a guest and leaves does not keep the video open', () => {
    const h = harness();
    h.evaluate({ child: 'hot' });
    expect(h.engine.phase).toBe('unlocked');
    h.evaluate({ visitor: 'hot' }, ['visitor']); // strap reassigned to a guest, child gone
    expect(h.engine.phase).not.toBe('unlocked');
    expect(['pending', 'locked']).toContain(h.engine.phase);
    h.advance(60_000);
    h.evaluate({ visitor: 'hot' }, ['visitor']);
    expect(['pending', 'locked']).toContain(h.engine.phase);
  });
});

describe('GovernanceEngine — guest-assigned supervisor', () => {
  it('a supervisor picked as a guest does not supervise', () => {
    const h = harness();
    h.evaluate({ parent: 'active', child: 'active' }, ['parent']);
    expect(h.engine.phase).toBe('pending');
    expect(h.engine.requirementSummary.requirements.some((r) => r.type === 'unattended_startup')).toBe(true);
  });
  it('the same supervisor on their own strap does supervise', () => {
    const h = harness();
    h.evaluate({ parent: 'active', child: 'active' });
    expect(h.engine.phase).toBe('unlocked');
  });
});

describe('GovernanceEngine — leaving a start lock', () => {
  it('an overdue child goes warning, then reaching hot clears the requirement and unlocks', () => {
    const h = harness();
    h.engine.config.grace_period_seconds = 30;
    h.evaluate({ 'child-a': 'hot' });
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    h.advance(121_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.phase).toBe('warning');
    h.advance(1_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'hot' });
    expect(h.engine.requirementSummary.requirements.some((r) => r.id === '__unattended_child_start')).toBe(false);
    expect(h.engine.phase).toBe('unlocked');
  });
});

describe('GovernanceEngine — per-child start gate', () => {
  it('a second child does not lock the video while inside the 120s window', () => {
    const h = harness();
    h.evaluate({ 'child-a': 'hot' });
    expect(h.engine.phase).toBe('unlocked');
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    h.advance(119_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(['unlocked']).toContain(h.engine.phase);
  });
  it('past 120s without hot, the start requirement names only that child', () => {
    const h = harness();
    h.engine.config.grace_period_seconds = 30; // harness has no grace; 0 grace locks with no warning step
    h.evaluate({ 'child-a': 'hot' });
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    h.advance(121_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    const req = h.engine.requirementSummary.requirements.find((r) => r.id === '__unattended_child_start');
    expect(req.missingUsers).toEqual(['child-b']);
    expect(h.engine.phase).toBe('warning');
  });
  it('a child already hot when the video opens is started immediately', () => {
    const h = harness();
    h.evaluate({ 'child-a': 'hot', 'child-b': 'hot' });
    h.advance(200_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.requirementSummary.requirements.some((r) => r.id === '__unattended_child_start')).toBe(false);
  });
  it('rejoining on the same video keeps the started state; a new video resets it', () => {
    const h = harness();
    h.evaluate({ 'child-a': 'hot', 'child-b': 'hot' });
    h.evaluate({ 'child-a': 'active' });
    h.advance(200_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.requirementSummary.requirements.some((r) => r.id === '__unattended_child_start')).toBe(false);
    h.engine.setMedia({ id: 'episode-2', type: 'episode', labels: ['cardio'] });
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.phase).toBe('pending'); // new video: hot gate again
  });
  it('a stand-down on the same video (parent visits) keeps each child\'s start', () => {
    const h = harness();
    h.evaluate({ 'child-a': 'hot', 'child-b': 'hot' });
    h.evaluate({ parent: 'active', 'child-a': 'active', 'child-b': 'active' });
    h.evaluate({ 'child-a': 'hot', 'child-b': 'active' }); // fresh hot gate reopens
    h.advance(200_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.requirementSummary.requirements.some((r) => r.id === '__unattended_child_start')).toBe(false);
  });
  it('three children get "most" challenges; two get "all"', () => {
    const h = harness();
    h.evaluate({ a: 'hot', b: 'hot', c: 'hot' });
    const three = h.engine._applyUnattendedPolicy({ requirements: [] }, ['a', 'b', 'c'], { a: 'hot', b: 'hot', c: 'hot' });
    expect(three.challenges[0].selections.every((s) => s.rule === 'most')).toBe(true);
    expect(three.challenges[0].selections.map((s) => s.label)).toEqual(['Most warm', 'Most hot']);
    const two = h.engine._applyUnattendedPolicy({ requirements: [] }, ['a', 'b'], { a: 'hot', b: 'hot' });
    expect(two.challenges[0].selections.every((s) => s.rule === 'all')).toBe(true);
    expect(two.challenges[0].selections.map((s) => s.label)).toEqual(['All warm', 'All hot']);
  });
  it('a challenge completes only after the 10s hold, with a pulse due at the hold end', () => {
    const h = harness({ challenge_hold_seconds: 10 });
    h.evaluate({ first: 'hot', second: 'hot' });
    h.advance(180_000);
    h.evaluate({ first: 'active', second: 'active' });
    expect(h.engine.challengeState.activeChallenge).toMatchObject({ zone: 'warm', status: 'pending' });
    const pulse = vi.spyOn(h.engine, '_schedulePulse');
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge.status).toBe('pending');
    expect(pulse).toHaveBeenLastCalledWith(10_000);
    h.advance(9_999);
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge.status).toBe('pending');
    h.advance(1);
    h.evaluate({ first: 'warm', second: 'warm' });
    expect(h.engine.challengeState.activeChallenge.status).toBe('success');
  });
});

describe('GovernanceEngine — start state and holds in the composed state', () => {
  it('exposes each child\'s start window once the video opens', () => {
    const h = harness();
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.state.unattendedStart).toBeNull(); // gate not open yet
    h.evaluate({ 'child-a': 'hot', 'child-b': 'active' });
    const start = h.engine.state.unattendedStart;
    expect(start).toMatchObject({ zone: 'hot', zoneLabel: 'hot' });
    expect(start.children['child-a']).toEqual({ started: true, overdue: false, remainingMs: 0 });
    expect(start.children['child-b']).toMatchObject({ started: false, overdue: false });
    expect(start.children['child-b'].remainingMs).toBeLessThanOrEqual(120_000);
    expect(start.children['child-b'].remainingMs).toBeGreaterThan(119_000);

    h.advance(30_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.state.unattendedStart.children['child-b'].remainingMs).toBe(90_000);

    h.advance(91_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    expect(h.engine.state.unattendedStart.children['child-b']).toEqual({ started: false, overdue: true, remainingMs: 0 });

    h.evaluate({ 'child-a': 'active', 'child-b': 'hot' });
    expect(h.engine.state.unattendedStart.children['child-b']).toEqual({ started: true, overdue: false, remainingMs: 0 });
  });

  it('is null while a supervisor is present', () => {
    const h = harness();
    h.evaluate({ parent: 'active', 'child-a': 'active' });
    expect(h.engine.state.unattendedStart).toBeNull();
  });

  it('carries riders mid-hold on the challenge snapshot', () => {
    const h = harness({ challenge_hold_seconds: 10 });
    h.evaluate({ 'child-a': 'hot', 'child-b': 'hot' });
    h.advance(180_000);
    h.evaluate({ 'child-a': 'active', 'child-b': 'active' });
    h.advance(1_000);
    h.evaluate({ 'child-a': 'warm', 'child-b': 'active' });
    h.advance(4_000);
    h.evaluate({ 'child-a': 'warm', 'child-b': 'active' });
    const challenge = h.engine.state.challenge;
    expect(challenge.status).toBe('pending');
    expect(challenge.holding).toEqual(['child-a']);
    expect(challenge.holdRemainingMs).toBe(6_000);
    expect(challenge.missingUsers).toContain('child-b');
  });
});
