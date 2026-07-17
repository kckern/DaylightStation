import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svcWithPlan(plan) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => ({}) },
    cadenceService: { resolve: () => ({}) },
    ceremonyRecordStore: { getRecords: () => [] },
    clock,
  });
}

describe('AlignmentService anti-goal suppression', () => {
  it('does NOT emit an anti_goal_warning even when proximity is imminent', () => {
    const plan = {
      anti_goals: [{ nightmare: 'Estranged from my kids', proximity: 'imminent' }],
      beliefs: [], values: [], feedback: [],
      getActiveGoals: () => [], toJSON: () => ({}),
    };
    const result = svcWithPlan(plan).computeAlignment('test-user');
    expect(result.priorities.some((p) => p.type === 'anti_goal_warning')).toBe(false);
  });
});
