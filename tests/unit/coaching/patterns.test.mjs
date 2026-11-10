import { describe, it, expect } from 'vitest';
import { detectPattern } from '../../../__app_modules/wellness/health/server/application/coaching/patterns.mjs';
const assessed = (planState = 'within', extra = {}) => ({
  calories: 1800, protein: 125, status: 'complete', assessment: {
    availability: 'available', finished: true, trustworthy: true, proteinKnown: true,
    planState, energyState: 'below-maintenance', ...extra,
  },
});
const goals = { calories_min: 1200, calories_max: 1600, protein: 120 };

describe('assessed coaching patterns', () => {
  it('counts over-plan separately from energy surplus', () => {
    expect(detectPattern([assessed('over'), assessed('over')], goals)).toBe('over_plan');
    expect(detectPattern([assessed('over', { energyState: 'surplus' }), assessed('over', { energyState: 'surplus' })], goals)).toBe('energy_surplus');
  });
  it('does not compare gross calories to legacy goal limits', () => {
    expect(detectPattern([assessed(), assessed(), assessed()], goals)).toBe('on_track');
  });
  it('reports incomplete yesterday as logging, never deficit or binge', () => {
    expect(detectPattern([{ calories: 400, status: 'incomplete' }, assessed('over'), assessed('over')], goals)).toBe('missed_logging');
    expect(detectPattern([assessed('over'), { calories: 800, status: 'incomplete' }, { calories: 900, status: 'incomplete' }], goals)).toBeNull();
  });
  it('suppresses calorie patterns when assessments are unavailable', () => {
    expect(detectPattern([{ calories: 3000, protein: 125, status: 'complete' }, { calories: 3000, protein: 125, status: 'complete' }], goals)).toBeNull();
    expect(detectPattern([{ status: 'unlogged' }], goals)).toBe('missed_logging');
  });
  it('requires finished trustworthy days for intake patterns', () => {
    expect(detectPattern([assessed('over', { finished: false }), assessed('over', { trustworthy: false })], goals)).toBeNull();
  });
  it('requires an explicit positive protein target and known protein for every on-track day', () => {
    const days = [assessed(), assessed(), assessed()];
    expect(detectPattern(days, {})).toBeNull();
    expect(detectPattern(days, { protein: 0 })).toBeNull();
    expect(detectPattern([assessed('within', { proteinKnown: false }), assessed(), assessed()], goals)).toBeNull();
  });
  it('detects protein shortfall only from known finished trustworthy protein values', () => {
    const short = () => ({ ...assessed(), protein: 50 });
    expect(detectPattern([short(), short(), short()], goals)).toBe('protein_short');
    expect(detectPattern([{ ...short(), assessment: { ...short().assessment, proteinKnown: false } }, short(), short()], goals)).toBeNull();
    expect(detectPattern([short(), short(), short()], {})).toBeNull();
  });
  it('preserves consecutive-day requirement for on-track despite an older incomplete gap', () => {
    expect(detectPattern([assessed(), { status: 'incomplete' }, assessed(), assessed()], goals)).toBeNull();
    expect(detectPattern([], goals)).toBeNull();
  });
});
