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
  // A finished deck has no School work session behind it — `BuildAgenda` never
  // opens one for a program entry — so the agenda's `servedWork` is the only
  // record the status board can draw a completed disc from. Without it the
  // disc does not turn green when a child finishes: it leaves the board, the
  // way the Sentence Ladder's did.
  it('names the finished deck, so the board can keep a disc no session backs', async () => {
    const { launcher } = make();
    const status = await launcher.status({ userId: 'kid', programInstance: 'biology/cells' });
    expect(status.servedWork).toEqual([{ unitId: 'flashcards:biology/cells', title: 'Flashcards' }]);
  });
  it('reports nothing served while the deck target is still open', async () => {
    const launcher = new FlashcardProgramLauncher({
      studyService: {
        summary: async () => ({ counts: { due: 0, new: 0, learning: 0, mastered: 1, reviewed: 99, activeSeconds: 9_999 }, today: { reviewed: 0, activeSeconds: 0 } }),
      },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 1, activeMinutes: 1 } }] }) },
    });
    const status = await launcher.status({ userId: 'kid', programInstance: 'biology/cells' });
    expect(status).toMatchObject({ doneToday: false });
    expect(status.servedWork).toEqual([]);
  });
  it('has nothing to report before a deck is even chosen', async () => {
    const { launcher } = make();
    await expect(launcher.status({ userId: 'kid' })).resolves.toMatchObject({ servedWork: [] });
  });
  it('dispatches a policy-bearing portal target', async () => {
    const { launcher, dispatches } = make();
    await launcher.launch({ userId: 'kid', programInstance: 'biology/cells', unitId: 'flashcards:biology/cells' });
    expect(dispatches[0].action.target).toMatchObject({ kind: 'program', program: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 2 } });
  });
});
