import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svc(plan, { due = [] } = {}) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => ({}) },
    cadenceService: { resolve: () => ({ unit: { periodId: '2026-07-17' } }) },
    ceremonyRecordStore: { getRecords: () => [], hasRecord: () => false },
    ceremonyDueResolver: { listDue: () => due },
    clock,
  });
}

const sparsePlan = {
  purpose: null, values: [{ id: 'family', name: 'Family', rank: 1 }],
  beliefs: [], anti_goals: [], feedback: [],
  getActiveGoals: () => [], toJSON: () => ({}),
};

describe('AlignmentService stage + ceremony_due + plan_gap', () => {
  it('reports scaffolding stage and a plan_gap for a sparse plan', () => {
    const r = svc(sparsePlan).computeAlignment('u');
    expect(r.dashboard.stage).toBe('scaffolding');
    expect(r.dashboard.completeness.valueCount).toBe(1);
    expect(r.priorities.some((p) => p.type === 'plan_gap')).toBe(true);
  });

  it('emits a ceremony_due priority for each due ceremony', () => {
    const r = svc(sparsePlan, { due: [{ type: 'unit_intention', periodId: '2026-07-17', title: 'Set your intention' }] })
      .computeAlignment('u');
    const cd = r.priorities.find((p) => p.type === 'ceremony_due');
    expect(cd).toBeTruthy();
    expect(cd.title).toBe('Set your intention');
    expect(cd.ceremonyType).toBe('unit_intention');
  });
});
