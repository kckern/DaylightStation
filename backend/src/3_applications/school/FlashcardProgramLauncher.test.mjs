import { describe, expect, it } from 'vitest';
import { FlashcardProgramLauncher } from './FlashcardProgramLauncher.mjs';

function make({ policy = { activeMinutes: 1, minimumReviews: 2, masteryPercent: 50 } } = {}) {
  const dispatches = [];
  const launcher = new FlashcardProgramLauncher({
    studyService: {
      getDeck: async () => ({ id: 'biology/cells' }),
      summary: async () => ({ counts: { due: 0, new: 0, learning: 1, mastered: 1, reviewed: 2, activeSeconds: 60 } }),
    },
    assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'biology/cells', policy }] }) },
    donow: { dispatch: async (row) => { dispatches.push(row); return { decision: 'dispatched', message: 'Opened.' }; } },
  });
  return { launcher, dispatches };
}

describe('FlashcardProgramLauncher', () => {
  it('reports assignment-target completion from durable deck summary', async () => {
    const { launcher } = make();
    await expect(launcher.status({ userId: 'kid', programInstance: 'biology/cells' })).resolves.toMatchObject({ doneToday: true, score: 50 });
  });
  it('uses today\'s credited reviews and active minutes, not lifetime totals', async () => {
    const launcher = new FlashcardProgramLauncher({
      studyService: {
        summary: async () => ({ counts: { due: 0, new: 0, learning: 0, mastered: 1, reviewed: 99, activeSeconds: 9_999 }, today: { reviewed: 0, activeSeconds: 0 } }),
      },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 1, activeMinutes: 1 } }] }) },
    });
    await expect(launcher.status({ userId: 'kid', programInstance: 'biology/cells' })).resolves.toMatchObject({ doneToday: false });
  });
  it('dispatches a policy-bearing portal target', async () => {
    const { launcher, dispatches } = make();
    await launcher.launch({ userId: 'kid', programInstance: 'biology/cells', unitId: 'flashcards:biology/cells' });
    expect(dispatches[0].action.target).toMatchObject({ kind: 'program', program: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 2 } });
  });
});
