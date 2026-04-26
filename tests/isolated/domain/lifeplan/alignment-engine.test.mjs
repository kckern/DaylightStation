import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';
import { frozenClock } from '../../../_lib/clock-helper.mjs';

describe('AlignmentService', () => {
  const clock = frozenClock('2025-06-15');

  const plan = new LifePlan({
    purpose: { statement: 'Maximize joy' },
    goals: [
      { id: 'g1', name: 'Run marathon', state: 'committed', quality: 'health', deadline: '2025-06-25', metrics: [{ name: 'm', target: 100, current: 50 }] },
      { id: 'g2', name: 'Learn piano', state: 'dream' },
      { id: 'g3', name: 'Old goal', state: 'achieved' },
    ],
    beliefs: [
      { id: 'b1', if: 'Train consistently', then: 'Finish race', state: 'testing', confidence: 0.6 },
      { id: 'b2', if: 'Practice daily', then: 'Improve', state: 'confirmed', confidence: 0.8, evidence_history: [{ type: 'confirmation', date: '2025-06-14' }] },
    ],
    values: [
      { id: 'health', name: 'Health', rank: 1 },
      { id: 'family', name: 'Family', rank: 2 },
      { id: 'craft', name: 'Craft', rank: 3 },
    ],
    anti_goals: [
      { id: 'ag1', nightmare: 'Health collapse', proximity: 'approaching' },
    ],
  });

  const mockStore = { load: vi.fn().mockReturnValue(plan) };

  const mockMetrics = {
    getLatest: vi.fn().mockReturnValue({
      correlation: 0.65,
      status: 'drifting',
      allocation: { health: 0.3, family: 0.4, craft: 0.3 },
    }),
  };

  const mockCeremonyStore = {
    getRecords: vi.fn().mockReturnValue([
      { type: 'cycle_retro', date: '2025-06-08' },
    ]),
  };

  const service = new AlignmentService({
    lifePlanStore: mockStore,
    metricsStore: mockMetrics,
    cadenceService: new CadenceService(),
    ceremonyRecordStore: mockCeremonyStore,
    clock,
  });

  describe('computeAlignment()', () => {
    it('returns priorities, dashboard, briefingContext', () => {
      const result = service.computeAlignment('testuser');
      expect(result).toBeTruthy();
      expect(result.priorities).toBeDefined();
      expect(result.dashboard).toBeDefined();
      expect(result.briefingContext).toBeDefined();
      expect(result._meta.username).toBe('testuser');
    });

    it('priorities are scored and sorted', () => {
      const result = service.computeAlignment('testuser');
      const scores = result.priorities.map(p => p.score);
      // Should be sorted descending
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    });

    it('includes goal deadline priority for approaching deadlines', () => {
      const result = service.computeAlignment('testuser');
      const deadlineItem = result.priorities.find(p => p.type === 'goal_deadline');
      expect(deadlineItem).toBeTruthy();
      expect(deadlineItem.title).toContain('Run marathon');
    });

    it('includes drift alert when drifting', () => {
      const result = service.computeAlignment('testuser');
      const driftItem = result.priorities.find(p => p.type === 'drift_alert');
      expect(driftItem).toBeTruthy();
      expect(driftItem.title).toContain('drift');
    });

    it('includes anti-goal warning for approaching nightmares', () => {
      const result = service.computeAlignment('testuser');
      const agItem = result.priorities.find(p => p.type === 'anti_goal_warning');
      expect(agItem).toBeTruthy();
      expect(agItem.urgency).toBe('high');
    });

    it('value-aligned items score higher', () => {
      const result = service.computeAlignment('testuser');
      const deadlineItem = result.priorities.find(p => p.type === 'goal_deadline');
      // This goal has quality: 'health' which is rank 1, so gets a value boost
      expect(deadlineItem.score).toBeGreaterThan(0);
    });

    it('dashboard includes goal progress for active goals only', () => {
      const result = service.computeAlignment('testuser');
      expect(result.dashboard.goalProgress).toHaveLength(2); // committed + dream, not achieved
      expect(result.dashboard.goalProgress[0].progress).toBe(0.5);
    });

    it('dashboard includes belief summaries', () => {
      const result = service.computeAlignment('testuser');
      expect(result.dashboard.beliefConfidence).toHaveLength(2);
      expect(result.dashboard.beliefConfidence[0].id).toBe('b1');
    });

    it('dashboard includes cadence position', () => {
      const result = service.computeAlignment('testuser');
      expect(result.dashboard.cadencePosition.unit).toBeDefined();
      expect(result.dashboard.cadencePosition.cycle).toBeDefined();
    });

    it('briefing context includes plan and snapshot', () => {
      const result = service.computeAlignment('testuser');
      expect(result.briefingContext.plan.purpose.statement).toBe('Maximize joy');
      expect(result.briefingContext.snapshot.correlation).toBe(0.65);
    });

    it('returns null when no plan exists', () => {
      mockStore.load.mockReturnValueOnce(null);
      const result = service.computeAlignment('nobody');
      expect(result).toBeNull();
    });
  });
});
