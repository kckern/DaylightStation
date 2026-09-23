import { describe, expect, it, vi } from 'vitest';
import { FlashcardProgramLauncher } from './FlashcardProgramLauncher.mjs';
import { findReopenableProgramEntry } from './usecases/continuationEntry.mjs';
import { projectProgramEntry } from './assignedProgramPlan.mjs';

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

describe('FlashcardProgramLauncher — word ladder', () => {
  const DECK = 'language/korean/week-01-classroom';
  function makeLadder(dayStatus) {
    const wordLadder = { dayStatus: vi.fn(dayStatus) };
    const studyService = { summary: vi.fn(), getDeck: async () => ({ id: DECK }) };
    const launcher = new FlashcardProgramLauncher({
      studyService, wordLadder,
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }] }) },
    });
    return { launcher, wordLadder, studyService };
  }

  it('is replayable', () => {
    expect(makeLadder(async () => ({})).launcher.replayable).toBe(true);
  });
  it('answers from the word ladder, never the FSRS summary, and names the served deck when done', async () => {
    const { launcher, wordLadder, studyService } = makeLadder(async () => ({ doneToday: true, progressLabel: 'Done for today', remaining: { checks: 0, study: 0, review: 0 } }));
    const status = await launcher.status({ userId: 'kid', programInstance: DECK });
    expect(status).toMatchObject({ doneToday: true, progressLabel: 'Done for today', reopenable: true, servedWork: [{ unitId: `flashcards:${DECK}`, title: 'Flashcards' }] });
    expect(wordLadder.dayStatus).toHaveBeenCalledWith({ userId: 'kid', deckId: DECK, day: null });
    expect(studyService.summary).not.toHaveBeenCalled();
  });
  it('carries the launch card to the agenda: projectProgramEntry reads the course poster and the words-learned bar', async () => {
    const card = {
      context: {
        course: { id: 'program:word-ladder:korean-vocab', title: 'Test Class' },
        unit: { id: DECK, title: 'Week 1: Classroom' },
        lesson: { id: `${DECK}:2026-09-23`, title: '4 new words · 3 to review' },
      },
      description: 'About 10 minutes',
      progress: [{ scope: 'unit', label: 'Words learned', completed: 0, total: 19 }],
    };
    const { launcher } = makeLadder(async () => ({ doneToday: false, progressLabel: 'Not opened', remaining: null, ...card }));
    const status = await launcher.status({ userId: 'kid', programInstance: DECK });
    expect(status).toMatchObject(card);
    const entry = { program: 'flashcards', programInstance: DECK, subject: 'language', unitId: `flashcards:${DECK}`, title: 'Flashcards' };
    const projected = projectProgramEntry(entry, status);
    expect(projected).toMatchObject({
      title: '4 new words · 3 to review', courseId: 'program:word-ladder:korean-vocab', module: DECK,
      description: 'About 10 minutes', programProgress: card.progress,
    });
  });
  it('replays a past day through the word ladder', async () => {
    const { launcher, wordLadder } = makeLadder(async () => ({ doneToday: false, progressLabel: 'Not opened', remaining: null }));
    await expect(launcher.status({ userId: 'kid', programInstance: DECK, day: '2026-09-21' })).resolves.toMatchObject({ doneToday: false, servedWork: [] });
    expect(wordLadder.dayStatus).toHaveBeenCalledWith({ userId: 'kid', deckId: DECK, day: '2026-09-21' });
  });
  it('keeps the tile openable after completion: a served subject reopens to the word ladder', async () => {
    const { launcher } = makeLadder(async () => ({ doneToday: true, progressLabel: 'Done for today', remaining: null }));
    const status = await launcher.status({ userId: 'kid', programInstance: DECK });
    const entry = { program: 'flashcards', programInstance: DECK, subject: 'flashcards', unitId: `flashcards:${DECK}` };
    expect(findReopenableProgramEntry({ entries: [entry] }, { subject: 'flashcards', statusOf: () => status })).toEqual({ entry, status });
  });
  it('an FSRS deck still cannot answer for a past day', async () => {
    const { launcher } = make();
    await expect(launcher.status({ userId: 'kid', programInstance: 'biology/cells', day: '2026-09-21' })).resolves.toMatchObject({ doneToday: null, unknowable: true, reason: 'no_history' });
  });
  it('fails loudly when a word-ladder enrollment has no word-ladder service', async () => {
    const launcher = new FlashcardProgramLauncher({
      studyService: { summary: vi.fn() },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }] }) },
    });
    await expect(launcher.status({ userId: 'kid', programInstance: DECK })).rejects.toThrow(/word-ladder study is not configured/);
  });
});
