// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ManageEarnRules } from './ManageEarnRules.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function build({ refuse = false } = {}) {
  const teacherGate = { assert: vi.fn(() => { if (refuse) throw new Error('Only a grown-up can do this.'); }) };
  const earnRules = {
    setUserOverride: vi.fn(async (args) => ({ revision: 5, ...args })),
    replace: vi.fn(async (args) => ({ revision: 6, ...args })),
  };
  return { teacherGate, earnRules, useCase: new ManageEarnRules({ teacherGate, earnRules, logger: silent }) };
}

describe('ManageEarnRules', () => {
  it('a teacher sets one learner\'s rates: gate first, then a stamped revision', async () => {
    const { teacherGate, earnRules, useCase } = build();
    const out = await useCase.setLearnerRates({ learnerId: 'learner-a', patch: { multiplier: 2 }, actorId: 'parent', pin: '1234' });
    expect(teacherGate.assert).toHaveBeenCalledWith({ userId: 'parent', pin: '1234', action: 'economy.earn-rates', context: { learnerId: 'learner-a' } });
    expect(earnRules.setUserOverride).toHaveBeenCalledWith({ learnerId: 'learner-a', patch: { multiplier: 2 }, actorId: 'parent' });
    expect(out.revision).toBe(5);
  });

  it('a teacher replaces the household rules through the same gate', async () => {
    const { teacherGate, earnRules, useCase } = build();
    await useCase.setHouseholdRules({ doc: { rules: [] }, actorId: 'parent', pin: null });
    expect(teacherGate.assert).toHaveBeenCalledWith({ userId: 'parent', pin: null, action: 'economy.earn-rules', context: {} });
    expect(earnRules.replace).toHaveBeenCalledWith({ doc: { rules: [] }, actorId: 'parent' });
  });

  it('refuses rates for someone not on the school roster (no typo entries piling up in the rules)', async () => {
    const teacherGate = { assert: vi.fn() };
    const earnRules = { setUserOverride: vi.fn(), replace: vi.fn() };
    const useCase = new ManageEarnRules({ teacherGate, earnRules, learnerIds: async () => ['learner-a'], logger: silent });
    await expect(useCase.setLearnerRates({ learnerId: 'lerner-a', patch: {}, actorId: 'parent' })).rejects.toThrow(/lerner-a/);
    expect(earnRules.setUserOverride).not.toHaveBeenCalled();
  });

  it('a refused gate writes nothing', async () => {
    const { earnRules, useCase } = build({ refuse: true });
    await expect(useCase.setLearnerRates({ learnerId: 'learner-a', patch: {}, actorId: 'kid', pin: null })).rejects.toThrow(/grown-up/);
    await expect(useCase.setHouseholdRules({ doc: { rules: [] }, actorId: 'kid' })).rejects.toThrow(/grown-up/);
    expect(earnRules.setUserOverride).not.toHaveBeenCalled();
    expect(earnRules.replace).not.toHaveBeenCalled();
  });
});
