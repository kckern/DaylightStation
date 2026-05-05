import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

describe('GovernanceEngine cycle history and cooldown', () => {
  function setupWith(nowRef) {
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix'] }]
      },
      getParticipantProfile: () => null,
      zoneProfileStore: null,
      getActiveParticipantState: () => ({ participants: ['felix'], zoneMap: { felix: 'warm' }, totalCount: 1 })
    };
    const engine = new GovernanceEngine(session, { now: () => nowRef.value, random: seededRng(1) });
    engine.configure({
      governed_labels: ['cardio'],
      grace_period_seconds: 30,
      policies: {
        default: {
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [1, 1],
            selections: [{
              type: 'cycle',
              equipment: 'cycle_ace',
              hi_rpm_range: [60, 60], segment_count: [1, 1],
              segment_duration_seconds: [2, 2], ramp_seconds: [5, 5],
              init: { min_rpm: 30, time_allowed_seconds: 10 },
              lo_rpm_ratio: 0.5, user_cooldown_seconds: 300,
              time_allowed: 999
            }]
          }]
        }
      }
    });
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    return engine;
  }

  it('records cycle success history with full fields and applies cooldown', () => {
    const nowRef = { value: 100000 };
    const engine = setupWith(nowRef);
    // Drive to success. Ticks: schedule → start (init) → init→ramp →
    // ramp→maintain → accrue 2s in maintain → success.
    nowRef.value = 101500;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'active' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { active: { name:'Active' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 0, connected: true, ts: nowRef.value } } });
    nowRef.value = 102500;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'active' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { active: { name:'Active' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 40, connected: true, ts: nowRef.value } } });
    nowRef.value = 103000;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { warm: { name:'Warm' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 65, connected: true, ts: nowRef.value } } });
    nowRef.value = 103500;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { warm: { name:'Warm' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 65, connected: true, ts: nowRef.value } } });
    nowRef.value = 106000;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { warm: { name:'Warm' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 65, connected: true, ts: nowRef.value } } });

    const history = engine.challengeState.challengeHistory;
    expect(history.length).toBe(1);
    const entry = history[0];
    expect(entry.type).toBe('cycle');
    expect(entry.status).toBe('success');
    expect(entry.rider).toBe('felix');
    expect(entry.ridersUsed).toEqual(['felix']);
    expect(entry.totalPhases).toBe(1);
    expect(entry.phasesCompleted).toBe(1);
    expect(entry.totalLockEventsCount).toBe(0);
    expect(entry.totalBoostedMs).toBe(0);
    expect(Array.isArray(entry.boostContributors)).toBe(true);
    expect(entry.selectionLabel).toBeDefined();
    // Cooldown applied
    expect(engine._cycleCooldowns.felix).toBe(106000 + 300 * 1000);
  });

  it('abandonActiveChallenge() records abandoned status and applies cooldown', () => {
    const nowRef = { value: 200000 };
    const engine = setupWith(nowRef);
    // Tick 1: schedule the next cycle challenge (sets nextChallengeAt).
    nowRef.value = 201500;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { warm: { name:'Warm' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 0, connected: true, ts: nowRef.value } } });
    // Tick 2: nextChallengeAt has elapsed → cycle challenge actually starts.
    nowRef.value = 202500;
    engine.evaluate({ activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool:0, active:1, warm:2, hot:3, fire:4 },
      zoneInfoMap: { warm: { name:'Warm' } }, totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 0, connected: true, ts: nowRef.value } } });
    expect(engine.challengeState.activeChallenge?.type).toBe('cycle');

    nowRef.value = 203000;
    engine.abandonActiveChallenge();

    expect(engine.challengeState.activeChallenge).toBeNull();
    const history = engine.challengeState.challengeHistory;
    expect(history.length).toBe(1);
    expect(history[0].status).toBe('abandoned');
    expect(history[0].type).toBe('cycle');
    expect(engine._cycleCooldowns.felix).toBe(203000 + 300 * 1000);
  });

  it('abandonActiveChallenge() is a no-op when no active challenge', () => {
    const nowRef = { value: 200000 };
    const engine = setupWith(nowRef);
    engine.abandonActiveChallenge();
    expect(engine.challengeState.challengeHistory.length).toBe(0);
  });

  it('abandonActiveChallenge() is a no-op for non-cycle types', () => {
    const nowRef = { value: 200000 };
    const engine = setupWith(nowRef);
    engine.challengeState.activeChallenge = { type: 'zone', rider: 'x' };
    engine.abandonActiveChallenge();
    expect(engine.challengeState.activeChallenge).toBeTruthy();
  });
});
