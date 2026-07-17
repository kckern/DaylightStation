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
    expect(alert.related_value).toBe('family');
  });

  it('resolves the drifted value by the id it already found, not a re-lookup by name (dup names)', () => {
    // Two values share the display name "Health" but have distinct ids.
    // plan.values lists health-new FIRST — a name-based re-lookup would
    // always resolve to that first match, even though the value that
    // actually drifted (per stated/observed order below) is health-old.
    const plan = {
      values: [
        { id: 'health-new', name: 'Health', rank: 2 },
        { id: 'health-old', name: 'Health', rank: 1 },
      ],
      beliefs: [], anti_goals: [], feedback: [], getActiveGoals: () => [], toJSON: () => ({}),
    };
    const snapshot = {
      correlation: 0.2, status: 'reconsidering',
      statedOrder: ['health-old', 'health-new'],
      observedOrder: ['health-new', 'health-old'],
    };
    const alert = svc(plan, snapshot).computeAlignment('u').priorities.find((p) => p.type === 'drift_alert');
    expect(alert).toBeTruthy();
    // health-new dropped from stated #2 to observed #1... but health-old dropped from
    // stated #1 to observed #2 (drop = 1), which is the only positive drop, so it wins.
    expect(alert.related_value).toBe('health-old');
  });
});
