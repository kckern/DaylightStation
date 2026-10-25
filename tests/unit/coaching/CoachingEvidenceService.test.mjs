import { describe, it, expect, vi } from 'vitest';
import { CoachingEvidenceService, budgetDayView } from '../../../__app_modules/wellness/health/server/application/coaching/CoachingEvidenceService.mjs';

const day = (date, food, exercise, extra = {}) => ({
  date, food, exercise, net: food - exercise, range: { floor: 1200, top: 1791 }, maintenance: 2291,
  complete: food >= 1200, declared: null, macros: { protein: 125 }, goalBasis: 'current', ...extra,
});
const october = () => [
  day('2026-10-19', 2030, 684), day('2026-10-20', 806, 302), day('2026-10-21', 1726, 882),
  day('2026-10-22', 1532, 275), day('2026-10-23', 330, 413), day('2026-10-24', 1704, 997),
];
const fixture = (rows = october(), nutrition = {}) => {
  const budgetService = { getBudgetRange: vi.fn().mockResolvedValue(rows), getBudget: vi.fn().mockResolvedValue(day('2026-10-25', 400, 0)) };
  const healthStore = { loadNutritionData: vi.fn().mockResolvedValue(nutrition), loadDayClosedData: vi.fn().mockResolvedValue({}) };
  const service = new CoachingEvidenceService({ budgetService, healthStore, clock: { now: () => new Date('2026-10-25T18:00:00Z') }, timezoneForUser: () => 'America/Los_Angeles' });
  return { service, budgetService, healthStore };
};

describe('CoachingEvidenceService', () => {
  it('assesses the October 19–24 exercise-adjusted budgets on one historical bulk read', async () => {
    const { service, budgetService } = fixture(october().reverse());
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 6 });
    expect(result.days.map(d => [d.date, d.assessment.planState])).toEqual([
      ['2026-10-19', 'within'], ['2026-10-20', 'unknown'], ['2026-10-21', 'within'],
      ['2026-10-22', 'within'], ['2026-10-23', 'unknown'], ['2026-10-24', 'within'],
    ]);
    expect(result.days.filter(d => d.status === 'incomplete')).toHaveLength(2);
    expect(result.period).toMatchObject({ coverage: { total: 6, available: 6, trustedFinished: 4 }, counts: { withinPlan: 4, overPlan: 0, surplus: 0 }, goalBasis: 'current' });
    expect(budgetService.getBudgetRange).toHaveBeenCalledExactlyOnceWith('u', '2026-10-19', '2026-10-24');
    expect(budgetService.getBudget).toHaveBeenCalledExactlyOnceWith('u', '2026-10-25');
    expect(result.current.assessment).toMatchObject({ finished: false, trustworthy: false });
  });

  it('uses each date’s own floor and plan rather than the current budget or summary', async () => {
    const { service } = fixture([
      day('2026-10-23', 1500, 300, { range: { floor: 1600, top: 1000 } }),
      day('2026-10-24', 1500, 300, { range: { floor: 1000, top: 1000 } }),
    ], { '2026-10-24': { calories: 9999, protein: 999 } });
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 2 });
    expect(result.days.map(d => [d.assessment.trustworthy, d.assessment.planState])).toEqual([[false, 'unknown'], [true, 'over']]);
    expect(result.days[1].protein).toBe(125);
    expect(result.period.counts).toEqual({ withinPlan: 0, overPlan: 1, surplus: 0 });
  });

  it('preserves gaps and errors without replacing yesterday with an earlier row', async () => {
    const { service } = fixture([day('2026-10-22', 1400, 0), { date: '2026-10-23', error: 'NO_WEIGHT_DATA' }]);
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 3 });
    expect(result.days.map(d => [d.date, d.assessment.availability])).toEqual([
      ['2026-10-22', 'available'], ['2026-10-23', 'unavailable'], ['2026-10-24', 'unavailable'],
    ]);
    expect(result.days[1].budget.error).toBe('NO_WEIGHT_DATA');
    expect(result.days[2].calories).toBeNull();
    expect(result.sourceState.budgetHistory).toBe('partial');
  });

  it('retains reconstructed provenance and excludes its protein even when a numeric macro exists', async () => {
    const { service } = fixture([day('2026-10-24', 1600, 0)], { '2026-10-24': { calories: 2200, protein: 150, reconstructed_calories: 600 } });
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 1 });
    expect(result.days[0]).toMatchObject({ provenance: 'reconstructed', protein: null, status: 'reconstructed', estimatedCalories: 2200, assessment: { proteinKnown: false, food: 1600, trustworthy: false, planState: 'unknown', energyState: 'unknown' } });
    expect(result.period.coverage.proteinKnown).toBe(0);
    expect(result.period.coverage.trustedFinished).toBe(0);
  });

  it.each(['done', 'fasting'])('keeps %s closure separate from reconstructed intake presentation', async declared => {
    const { service } = fixture([day('2026-10-24', 1600, 0, { declared })], {
      '2026-10-24': { calories: 2200, protein: 150, reconstructed_calories: 600 },
    });
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 1 });
    expect(result.days[0]).toMatchObject({
      declared, provenance: 'reconstructed', status: 'reconstructed', calories: 1600,
      estimatedCalories: 2200, protein: null,
      assessment: { finished: true, trustworthy: false, proteinKnown: false, planState: 'unknown', energyState: 'unknown' },
    });
    expect(result.period.coverage.trustedFinished).toBe(0);
  });

  it('requires a finite macro to claim protein is known, including declared fasting', async () => {
    const { service } = fixture([day('2026-10-24', 0, 0, { declared: 'fasting', macros: {} })]);
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 1 });
    expect(result.days[0]).toMatchObject({ protein: null, assessment: { trustworthy: true, proteinKnown: false } });
  });

  it('anchors a backdated window to the requested date and lifecycle to actual local today at midnight', async () => {
    const { budgetService, healthStore } = fixture();
    const service = new CoachingEvidenceService({ budgetService, healthStore, clock: { now: () => new Date('2026-10-25T06:59:59Z') }, timezoneForUser: () => 'America/Los_Angeles' });
    const result = await service.load({ userId: 'u', date: '2026-10-23', historyDays: 2 });
    expect(result.today).toBe('2026-10-24');
    expect(result.days.map(d => d.date)).toEqual(['2026-10-21', '2026-10-22']);
    expect(result.current.assessment.finished).toBe(true);
  });

  it('keeps source failures explicit and permits logging facts without calorie assessments', async () => {
    const { healthStore } = fixture([], { '2026-10-24': { calories: 400, protein: 20 } });
    const service = new CoachingEvidenceService({ healthStore, clock: { now: () => new Date('2026-10-25T18:00:00Z') }, timezoneForUser: () => 'UTC' });
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 1 });
    expect(result.days[0]).toMatchObject({ calories: 400, status: 'incomplete', assessment: { availability: 'unavailable', planState: 'unknown' } });
    expect(result.sourceState).toMatchObject({ budgetHistory: 'unavailable', currentBudget: 'unavailable', nutrition: 'available' });
    expect(result.period.averages.food).toBeNull();
  });

  it('isolates a whole history failure and nutrition failure from the current budget', async () => {
    const { service, budgetService, healthStore } = fixture();
    budgetService.getBudgetRange.mockRejectedValue(new Error('range offline'));
    healthStore.loadNutritionData.mockRejectedValue(new Error('nutrition offline'));
    const result = await service.load({ userId: 'u', date: '2026-10-25', historyDays: 2 });
    expect(result.sourceState).toMatchObject({ budgetHistory: 'unavailable', nutrition: 'unavailable', currentBudget: 'available' });
    expect(result.days).toHaveLength(2);
    expect(result.days[0].status).toBe('unavailable');
    expect(result.current.assessment.availability).toBe('available');
  });

  it('projects legacy tool fields and assessment using explicit lifecycle context', () => {
    const result = budgetDayView(day('2026-10-24', 2030, 684), { today: '2026-10-25' });
    expect(result).toMatchObject({ calories: 2030, protein: 125, exercise: 684, net: 1346, range: { floor: 1200, top: 1791 }, assessment: { finished: true, planState: 'within', energyState: 'below-maintenance' } });
    expect(result).not.toHaveProperty('goals');
  });
});
