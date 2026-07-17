import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svc(plan, snapshot) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => snapshot },
    cadenceService: { resolve: () => ({}) },
    ceremonyRecordStore: { getRecords: () => [] },
    clock,
  });
}

describe('drift alert copy', () => {
  it('names the value and the gap, not the enum/coefficient', () => {
    const plan = {
      values: [{ id: 'family', name: 'Family', rank: 1 }, { id: 'craft', name: 'Craft', rank: 2 },
               { id: 'health', name: 'Health', rank: 3 }, { id: 'wealth', name: 'Wealth', rank: 4 }],
      beliefs: [], anti_goals: [], feedback: [], getActiveGoals: () => [], toJSON: () => ({}),
    };
    const snapshot = {
      correlation: 0.2, status: 'reconsidering',
      statedOrder: ['family', 'craft', 'health', 'wealth'],
      observedOrder: ['wealth', 'health', 'craft', 'family'],
    };
    const alert = svc(plan, snapshot).computeAlignment('u').priorities.find((p) => p.type === 'drift_alert');
    expect(alert).toBeTruthy();
    expect(alert.title).toContain('Family');
    expect(alert.title + alert.reason).not.toMatch(/reconsidering|correlation|0\.\d/i);
  });
});
