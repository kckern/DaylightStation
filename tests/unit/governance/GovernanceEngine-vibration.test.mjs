import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine vibration challenges', () => {
  let engine;
  let mockSession;
  let mockTracker;

  beforeEach(() => {
    mockTracker = {
      snapshot: {
        status: 'idle',
        sessionDurationMs: 0,
        estimatedImpacts: 0,
        currentIntensity: 0,
        recentIntensityHistory: []
      }
    };

    mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#aaa' },
          { id: 'active', name: 'Active', color: '#f00' }
        ]
      },
      getActiveParticipantState: () => ({
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      }),
      getVibrationTracker: (id) => id === 'punching_bag' ? mockTracker : null
    };

    engine = new GovernanceEngine(mockSession);
  });

  describe('_normalizePolicies with vibration selections', () => {
    it('parses vibration selection from policy config', () => {
      const policies = engine._normalizePolicies({
        test_policy: {
          name: 'Test',
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [60, 120],
            selections: [{
              vibration: 'punching_bag',
              criteria: 'duration',
              target: 30,
              time_allowed: 60,
              label: 'Bag Work'
            }]
          }]
        }
      });

      expect(policies.length).toBe(1);
      const challenge = policies[0].challenges[0];
      expect(challenge.selections.length).toBe(1);
      const sel = challenge.selections[0];
      expect(sel.vibration).toBe('punching_bag');
      expect(sel.criteria).toBe('duration');
      expect(sel.target).toBe(30);
      expect(sel.label).toBe('Bag Work');
    });

    it('allows mixed zone and vibration selections', () => {
      const policies = engine._normalizePolicies({
        test_policy: {
          name: 'Test',
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [60, 120],
            selections: [
              { zone: 'active', min_participants: 'all', time_allowed: 60 },
              { vibration: 'punching_bag', criteria: 'duration', target: 30, time_allowed: 60, label: 'Bag' }
            ]
          }]
        }
      });

      const sels = policies[0].challenges[0].selections;
      expect(sels.length).toBe(2);
      expect(sels[0].zone).toBe('active');
      expect(sels[0].vibration).toBeNull();
      expect(sels[1].zone).toBeNull();
      expect(sels[1].vibration).toBe('punching_bag');
    });
  });

  describe('_evaluateVibrationChallenge', () => {
    it('satisfies duration challenge when tracker shows enough duration', () => {
      mockTracker.snapshot.status = 'active';
      mockTracker.snapshot.sessionDurationMs = 31000;
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'duration', target: 30 })).toBe(true);
    });

    it('fails duration challenge when tracker duration insufficient', () => {
      mockTracker.snapshot.sessionDurationMs = 15000;
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'duration', target: 30 })).toBe(false);
    });

    it('satisfies impacts challenge when estimated impacts meet target', () => {
      mockTracker.snapshot.estimatedImpacts = 12;
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'impacts', target: 10 })).toBe(true);
    });

    it('fails impacts challenge when insufficient', () => {
      mockTracker.snapshot.estimatedImpacts = 5;
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'impacts', target: 10 })).toBe(false);
    });

    it('satisfies intensity challenge when enough high-magnitude hits', () => {
      mockTracker.snapshot.recentIntensityHistory = [1600, 800, 1700, 500, 1800];
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'intensity', target: 1500, count: 3 })).toBe(true);
    });

    it('fails intensity challenge when not enough high hits', () => {
      mockTracker.snapshot.recentIntensityHistory = [1600, 800, 500, 500, 1800];
      expect(engine._evaluateVibrationChallenge({ vibration: 'punching_bag', criteria: 'intensity', target: 1500, count: 3 })).toBe(false);
    });

    it('returns false for unknown equipment', () => {
      expect(engine._evaluateVibrationChallenge({ vibration: 'nonexistent', criteria: 'duration', target: 10 })).toBe(false);
    });

    it('returns false for missing selection', () => {
      expect(engine._evaluateVibrationChallenge(null)).toBe(false);
      expect(engine._evaluateVibrationChallenge({})).toBe(false);
    });
  });
});
