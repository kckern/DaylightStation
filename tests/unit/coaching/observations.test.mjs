import { describe, it, expect } from 'vitest';
import * as observations from '../../../__app_modules/wellness/health/server/application/coaching/observations.mjs';
import * as text from '../../../__app_modules/wellness/health/server/application/coaching/observationText.mjs';
import { assessBudgetDay } from '../../../__app_modules/wellness/health/portable/contracts/health/budgetAssessment.mjs';
import { summarizeBudgetPeriod } from '../../../__app_modules/wellness/health/portable/contracts/health/budgetPeriod.mjs';
import { buildPostReportSnapshot, buildRecentCoaching } from '../../../__app_modules/wellness/health/server/application/coaching/snapshots.mjs';

const day = ({ date = '2026-10-24', food = 1704, exercise = 997, protein = 118, declared = null, provenance = 'logged', maintenance = 2291, range = { floor: 1200, top: 1791 } } = {}) => {
  const budget = { date, food, exercise, range, maintenance, macros: { protein }, declared, goalBasis: 'current' };
  const assessment = assessBudgetDay(budget, { date, today: '2026-10-25', provenance });
  return { date, budget, assessment, calories: food, protein: assessment.proteinKnown ? protein : null, provenance, status: assessment.trustworthy ? 'complete' : 'incomplete' };
};
const evidence = (days = [day()], current = day({ date: '2026-10-25' })) => ({ date: '2026-10-25', today: '2026-10-25', current, days, period: summarizeBudgetPeriod(days.map(d => d.assessment)), sourceState: {} });
const build = (ev, opts = {}) => observations.buildObservations({ type: 'morning-brief', evidence: ev, proteinGoal: 150, ...opts });
const render = list => list.map(text.renderObservation).join('\n');

// These fail if calorie position is inferred from food alone or from weight.
describe('supported observations', () => {
  it('has the specified callable contracts', () => {
    expect(typeof observations.buildObservations).toBe('function');
    expect(typeof text.renderObservation).toBe('function');
  });
  it.each([[1704, 997, 'within_plan'], [2200, 0, 'over_plan']])('does not call %i food and %i exercise a surplus', (food, exercise, kind) => {
    const result = build(evidence([day({ food, exercise })]));
    expect(result.some(o => o.kind === kind)).toBe(true);
    expect(result.some(o => o.kind === 'energy_surplus')).toBe(false);
    expect(render(result)).not.toMatch(/energy surplus|fill|eat.*remaining|target met/i);
  });
  it('renders a completed day using its configured protein target', () => {
    const result = build(evidence());
    const within = result.find(o => o.kind === 'within_plan');
    expect(within).toMatchObject({ date: '2026-10-24', evidenceDates: ['2026-10-24'], facts: { proteinGap: 32, proteinGoal: 150 } });
    expect(text.renderObservation(within)).toContain('2026-10-24: Within your exercise-adjusted calorie plan; protein was 32g below your 150g target.');
    expect(render(build(evidence(), { proteinGoal: undefined }))).not.toMatch(/150g|target|protein.*below/);
  });
  it('reserves surplus for intake above estimated maintenance', () => {
    const result = build(evidence([day({ food: 2500, exercise: 0 })]));
    expect(result.find(o => o.kind === 'energy_surplus')?.facts.surplusKcal).toBe(209);
    expect(render(result)).toContain('209 cal above estimated maintenance');
    expect(build(evidence([day({ food: 2291, exercise: 0 })])).some(o => o.kind === 'energy_surplus')).toBe(false);
  });
  it('never treats 105/150 protein as target met or an early failure', () => {
    const ev = evidence([], day({ date: '2026-10-25', food: 1500, exercise: 0, protein: 105 }));
    const result = build(ev, { type: 'post-report' });
    expect(result.some(o => o.kind === 'within_plan')).toBe(true);
    expect(result.some(o => o.kind === 'protein_gap')).toBe(false);
    expect(render(result)).toContain('so far');
    expect(render(result)).not.toMatch(/was|below.*target|target met|failure/i);
    ev.current.assessment.finished = true;
    const closed = build(ev, { type: 'post-report' });
    expect(closed.find(o => o.kind === 'within_plan')?.facts).toMatchObject({ protein: 105, proteinGoal: 150, proteinGap: 45 });
    expect(closed.some(o => o.kind === 'protein_gap')).toBe(false);
    const over = build(evidence([day({ food: 2200, exercise: 0, protein: 105 })]));
    expect(over.find(o => o.kind === 'protein_gap')?.facts).toMatchObject({ protein: 105, proteinGoal: 150, proteinGap: 45 });
    expect(text.renderObservation(over.find(o => o.kind === 'protein_gap'))).toContain('current configured goals');
  });
  it('does not infer an energy surplus from rising weight or reconstructed intake', () => {
    const reconstructed = day({ food: 3000, exercise: 0, provenance: 'reconstructed' });
    const result = build({ ...evidence([reconstructed]), weight: { trend7d: 2 } });
    expect(result.map(o => o.kind)).toEqual(['logging_incomplete']);
    expect(render(result)).toContain('estimated');
  });
  it('keeps incomplete days out of verdicts, even after midnight', () => {
    const result = build(evidence([day({ food: 806, exercise: 302 })]));
    expect(result.map(o => o.kind)).toEqual(['logging_incomplete']);
    expect(render(result)).toContain('incomplete');
    expect(render(result)).not.toMatch(/deficit|surplus|low intake|below.*target/i);
  });
  it('requires at least half trusted finished coverage for a period summary', () => {
    const days = Array.from({ length: 7 }, (_, i) => day({ date: `2026-10-${18 + i}`, food: i < 3 ? 1704 : 400 }));
    const result = build(evidence(days), { type: 'weekly-digest' });
    expect(result.map(o => o.kind)).toEqual(['logging_incomplete']);
    expect(render(result)).toContain('3 of 7');
    days[3] = day({ date: '2026-10-21' });
    const summary = build(evidence(days), { type: 'weekly-digest' }).find(o => o.kind === 'period_summary');
    expect(summary).toMatchObject({ evidenceDates: ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'], facts: { trustedDays: 4, totalDays: 7, withinPlan: 4, goalBasis: 'current' } });
    expect(text.renderObservation(summary)).toContain('current configured goals');
  });
  it('projects separate verdict coverage into weekly facts and qualifies partial maintenance', () => {
    const days = [day({ date: '2026-10-23', food: 3500 }), day({ maintenance: null })];
    const summary = build(evidence(days), { type: 'weekly-digest' }).find(o => o.kind === 'period_summary');
    expect(summary.facts).toMatchObject({ trustedDays: 2, planKnown: 2, maintenanceKnown: 1, withinPlan: 1, overPlan: 1, surplus: 1 });
    expect(text.renderObservation(summary)).toContain('1 of 1 days with known maintenance were above estimated maintenance.');
    expect(text.renderObservation(summary)).toContain('Maintenance comparisons are unavailable for 1 of 2 trustworthy finished days.');
  });
  it('keeps all-unknown verdict clauses unavailable independently', () => {
    const maintenanceUnknown = build(evidence([day({ maintenance: null })]), { type: 'weekly-digest' });
    expect(render(maintenanceUnknown)).toContain('1 of 1 trustworthy finished days were within');
    expect(render(maintenanceUnknown)).toContain('Maintenance comparisons are unavailable.');
    expect(render(maintenanceUnknown)).not.toContain('0 were above estimated maintenance');
    const planUnknown = build(evidence([day({ range: { floor: 1200 } })]), { type: 'weekly-digest' });
    expect(render(planUnknown)).toContain('Plan comparisons are unavailable.');
    expect(render(planUnknown)).toContain('0 were above estimated maintenance');
    expect(render(planUnknown)).not.toMatch(/within the exercise-adjusted plan|were over plan/);
  });
  it('does not claim just logged without event items and preserves fingerprint after text truncation', () => {
    const current = day({ date: '2026-10-25', food: 700 });
    const result = build(evidence([], current), { type: 'post-report' });
    expect(render(result)).not.toMatch(/just logged/i);
    const eventResult = build(evidence([], current), { type: 'post-report', eventItems: [{ name: 'Rice & beans', calories: 300 }] });
    expect(render(eventResult)).toContain('Just logged: Rice & beans.');
    const history = buildRecentCoaching({ '2026-10-25': [{ type: 'post-report', text: 'x'.repeat(500), timestamp: new Date().toISOString(), observationFingerprint: result[0].fingerprint }] });
    expect(history[0].text).toHaveLength(200);
    expect(build(evidence([], current), { type: 'post-report', recentObservations: history })).toEqual([]);
  });
  it('offers canonical exercise credit once, independent of whether food logging is complete', () => {
    const ev = evidence([], day({ date: '2026-10-25', food: 700, exercise: 997 }));
    const result = build(ev, { type: 'exercise-reaction' });
    const exercise = result.find(o => o.kind === 'exercise_budget');
    expect(exercise.facts).toMatchObject({ exercise: 997, planFood: 2788 });
    expect(text.renderObservation(exercise)).toContain('997 cal of exercise credit is included once in your 2788 cal food plan');
    ev.current.assessment.exercise = null;
    expect(build(ev, { type: 'exercise-reaction' }).some(o => o.kind === 'exercise_budget')).toBe(false);
  });
  it('does not present daily prominent foods as event items', () => {
    const snapshot = buildPostReportSnapshot({ date: '2026-10-25', calories: { consumed: 700 }, protein: { consumed: 30 }, items: [{ name: 'Chicken', calories: 300, protein: 30 }], evidence: evidence([], day({ date: '2026-10-25', food: 700 })) });
    expect(snapshot.notable_items_scope).toBe('foods_logged_today');
    expect(render(snapshot.observations)).not.toMatch(/just logged/i);
  });
});

it('allows a newly eligible protein gap after a live within-plan fact was delivered', () => {
  const current = day({ date: '2026-10-25', food: 1500, exercise: 0, protein: 105 });
  const live = build(evidence([], current), { type: 'post-report' })[0];
  current.assessment.finished = true;
  const result = build(evidence([], current), { type: 'post-report', recentObservations: [live] });
  expect(result.map(o => o.kind)).toEqual(['protein_gap']);
  expect(render(result)).toContain('45g below your 150g target');
});
