import { describe, it, expect } from 'vitest';
import { planBudgetSettingsMigration } from './budgetSettingsMigration.mjs';

const today = '2026-09-24';

describe('planBudgetSettingsMigration', () => {
  it('changes nothing when budgetFloor is set, and reports every source and conflict', () => {
    const plan = planBudgetSettingsMigration({
      healthGoals: { budgetFloor: 1200, targetWeightLbs: 180 },
      profile: { apps: { nutribot: { goals: { calories_min: 1200, calories_max: 1600 } } } },
      coachGoals: { weight: { target_lbs: 165, target_date: '2026-03-11' }, nutrition: { calories_min: 1200, calories_max: 1600 } },
      coachingConfig: { logging_completeness: { min_calories: 1200 } },
      today,
    });
    expect(plan.set).toEqual({});
    expect(plan.report).toContainEqual({ key: 'floor', source: 'coaching.logging_completeness.min_calories', value: 1200 });
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.stringMatching(/target weight: health goals 180 vs coach 165/),
      expect.stringMatching(/coach target_date 2026-03-11 has passed/),
      expect.stringMatching(/no targetDate/),
    ]));
  });

  it('fills an unset budgetFloor from the profile, then the coach goals, then the coaching config', () => {
    expect(planBudgetSettingsMigration({ healthGoals: {}, profile: { apps: { nutribot: { goals: { calories_min: 1100 } } } }, today }).set)
      .toEqual({ budgetFloor: 1100 });
    expect(planBudgetSettingsMigration({ healthGoals: {}, coachGoals: { nutrition: { calories_min: 1150 } }, today }).set)
      .toEqual({ budgetFloor: 1150 });
    expect(planBudgetSettingsMigration({ healthGoals: {}, coachingConfig: { logging_completeness: { min_calories: 1300 } }, today }).set)
      .toEqual({ budgetFloor: 1300 });
  });

  it('flags floor sources that disagree', () => {
    const plan = planBudgetSettingsMigration({ healthGoals: { budgetFloor: 1200 }, coachingConfig: { logging_completeness: { min_calories: 1400 } }, today });
    expect(plan.conflicts).toContainEqual(expect.stringMatching(/floor: .*1200.*1400/));
  });

  it('never proposes a targetDate', () => {
    const plan = planBudgetSettingsMigration({ healthGoals: { budgetFloor: 1200 }, coachGoals: { weight: { target_date: '2027-01-01' } }, today });
    expect(plan.set).not.toHaveProperty('targetDate');
  });
});
