import { describe, expect, it, vi } from 'vitest';
import { ConfigFlashcardSchedulerPolicySource } from './ConfigFlashcardSchedulerPolicySource.mjs';

describe('ConfigFlashcardSchedulerPolicySource', () => {
  it('projects household and learner scheduler policy from their canonical config locations', () => {
    const household = { defaultProfile: 'steady' };
    const learner = { overrides: { requestRetention: 0.92 } };
    const configService = {
      getHouseholdAppConfig: vi.fn(() => ({ flashcards: { scheduler: household } })),
      getUserProfile: vi.fn(() => ({ apps: { school: { flashcards: { scheduler: learner } } } })),
    };
    const source = new ConfigFlashcardSchedulerPolicySource({ configService });

    expect(source.householdScheduler()).toBe(household);
    expect(source.learnerScheduler('learner')).toBe(learner);
    expect(configService.getHouseholdAppConfig).toHaveBeenCalledWith(null, 'school');
    expect(configService.getUserProfile).toHaveBeenCalledWith('learner');
  });

  it('returns empty policy objects for absent optional configuration', () => {
    const source = new ConfigFlashcardSchedulerPolicySource({
      configService: { getHouseholdAppConfig: () => null, getUserProfile: () => null },
    });
    expect(source.householdScheduler()).toEqual({});
    expect(source.learnerScheduler('missing')).toEqual({});
  });
});
