// tests/unit/governance/GovernanceEngine-cycleDispatch.test.mjs
//
// Integration test for Task 14: wire cycle challenges into the main
// _evaluateChallenges dispatch path. Exercises the public evaluate() API
// end-to-end so cycle start and cycle evaluation actually fire through the
// same scheduling/runtime flow as zone challenges.

import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildSession() {
  return {
    _deviceRouter: {
      getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix'] }]
    },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({
      participants: ['felix'],
      zoneMap: { felix: 'active' },
      totalCount: 1
    })
  };
}

function tick(engine, nowValue, { zone = 'active', rpm = 0, connected = true } = {}) {
  return engine.evaluate({
    activeParticipants: ['felix'],
    userZoneMap: { felix: zone },
    zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
    zoneInfoMap: { active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' } },
    totalCount: 1,
    equipmentCadenceMap: { cycle_ace: { rpm, connected } }
  });
}

describe('GovernanceEngine cycle challenge dispatch', () => {
  it('starts a cycle challenge when a cycle selection is drawn, and evaluates it via evaluate()', () => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(42) });

    engine.configure({
      governed_labels: ['cardio'],
      grace_period_seconds: 30,
      policies: {
        default: {
          name: 'Default',
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [1, 1],
            selections: [{
              type: 'cycle',
              equipment: 'cycle_ace',
              hi_rpm_range: [60, 60],
              segment_count: [1, 1],
              segment_duration_seconds: [2, 2],
              ramp_seconds: [5, 5],
              init: { min_rpm: 30, time_allowed_seconds: 10 },
              lo_rpm_ratio: 0.5,
              time_allowed: 999
            }]
          }]
        }
      }
    });

    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });

    // Tick 1: ensure unlocked and schedule the next challenge.
    nowValue = 101500;
    tick(engine, nowValue, { zone: 'active', rpm: 0 });
    expect(engine.phase).toBe('unlocked');
    // After scheduling, nextChallengeAt should be set (interval [1,1] => ~1000ms out).
    expect(Number.isFinite(engine.challengeState.nextChallengeAt)).toBe(true);

    // Tick 2: nextChallengeAt has elapsed → cycle challenge starts.
    nowValue = 102500;
    tick(engine, nowValue, { zone: 'active', rpm: 0 });

    const active = engine.challengeState.activeChallenge;
    expect(active).toBeTruthy();
    expect(active.type).toBe('cycle');
    expect(active.cycleState).toBe('init');
    expect(active.rider).toBe('felix');
    expect(active.equipment).toBe('cycle_ace');

    // Tick 3: rider reaches min_rpm (30) while base_req is satisfied → init→ramp
    nowValue = 103000;
    tick(engine, nowValue, { zone: 'active', rpm: 40 });
    expect(engine.challengeState.activeChallenge.cycleState).toBe('ramp');

    // Tick 4: rider hits hi_rpm (60) → ramp→maintain
    nowValue = 103500;
    tick(engine, nowValue, { zone: 'warm', rpm: 65 });
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    // Tick 5: hold target for maintain duration (2s = 2000ms) → success
    // dt from tick 4 (103500) to now (106000) = 2500ms > 2000ms at 1x multiplier
    nowValue = 106000;
    tick(engine, nowValue, { zone: 'warm', rpm: 65 });
    expect(engine.challengeState.activeChallenge?.status).toBe('success');
  });

  it('does not dispatch cycle when media is not governed', () => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(7) });

    engine.configure({
      governed_labels: ['cardio'],
      grace_period_seconds: 30,
      policies: {
        default: {
          name: 'Default',
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [1, 1],
            selections: [{
              type: 'cycle',
              equipment: 'cycle_ace',
              hi_rpm_range: [60, 60],
              segment_count: [1, 1],
              segment_duration_seconds: [2, 2],
              ramp_seconds: [5, 5],
              init: { min_rpm: 30, time_allowed_seconds: 10 },
              lo_rpm_ratio: 0.5,
              time_allowed: 999
            }]
          }]
        }
      }
    });

    // Media labels do NOT include 'cardio' → not governed, challenges must not trigger.
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['NonGoverned'] });

    // Run a handful of ticks where cycle would otherwise have scheduled/started.
    for (let step = 0; step < 4; step++) {
      nowValue += 1000;
      tick(engine, nowValue, { zone: 'active', rpm: 80 });
    }

    expect(engine.challengeState.activeChallenge).toBeFalsy();
  });
});
