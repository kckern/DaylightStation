import { describe, expect, it } from 'vitest';
import { FlashcardSchedulerPolicyResolver } from './FlashcardSchedulerPolicyResolver.mjs';

const deck = { id: 'science/cells', scheduler: { overrides: { requestRetention: 0.92 } }, cards: [] };
const configService = {
  getHouseholdAppConfig: () => ({ flashcards: { scheduler: {
    defaultProfile: 'exam', profiles: { exam: { requestRetention: 0.9, maximumIntervalDays: 120 } },
  } } }),
  getUserProfile: () => ({ apps: { school: { flashcards: { scheduler: { overrides: { maximumIntervalDays: 90 } } } } } }),
};

describe('FlashcardSchedulerPolicyResolver', () => {
  it('layers only trusted sources and snapshots safe overrides', async () => {
    const resolver = new FlashcardSchedulerPolicyResolver({ configService, assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: deck.id, policy: { newCardLimit: 7 } }] }) } });
    const launch = await resolver.resolveLaunch({ userId: 'kid', deck });
    expect(launch.studyPolicy).toEqual({ newCardLimit: 7 });
    expect(resolver.resolveCard({ card: { cardId: 'a', concepts: [] }, launch })).toMatchObject({ id: 'exam', parameters: { requestRetention: 0.92, maximumIntervalDays: 90 } });
  });
  it('rejects conflicting concept-specific scheduler settings', async () => {
    const resolver = new FlashcardSchedulerPolicyResolver({ configService: { ...configService, getHouseholdAppConfig: () => ({ flashcards: { scheduler: { concepts: { one: { overrides: { requestRetention: 0.8 } }, two: { overrides: { requestRetention: 0.9 } } } } } }) }, assignments: { get: async () => null } });
    const launch = await resolver.resolveLaunch({ userId: 'kid', deck: { ...deck, scheduler: {} } });
    expect(() => resolver.resolveCard({ card: { cardId: 'a', concepts: ['one', 'two'] }, launch })).toThrow(/conflicting concept scheduler override/);
  });
});
