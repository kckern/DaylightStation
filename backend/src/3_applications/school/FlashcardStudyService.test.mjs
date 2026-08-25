import { describe, expect, it, vi } from 'vitest';
import { FlashcardStudyService } from './FlashcardStudyService.mjs';
const deck = { id: 'science/cells/cards', assessment: { bankId: 'science/cells/test' }, cards: [{ cardId: 'a' }, { cardId: 'b' }] };
const profile = { id: 'default', revision: 'default', parameters: {} };
const scheduler = {
  initial: ({ now }) => ({ state: 'new', dueAt: now.toISOString(), reviews: 0 }),
  rate: ({ rating, now }) => ({ progress: { state: rating === 'again' ? 'learning' : 'review', dueAt: new Date(now.getTime() + (rating === 'again' ? 60000 : 86400000)).toISOString(), lastReviewedAt: now.toISOString(), reviews: 1 }, reviewLog: {} }),
  preview: () => [],
};
const policyResolver = { resolveLaunch: async () => ({ studyPolicy: {}, profiles: { defaultProfile: 'default', byId: { default: profile } }, layers: [] }), resolveCard: () => profile };
const deps = { scheduler, policyResolver };
function harness() { let state = { schema: 'school.flashcard-progress/v1', cards: {}, sessions: {} }; const now = Date.parse('2026-08-24T12:00:00.000Z'); return { service: new FlashcardStudyService({ ...deps, progressStore: { update: (_u, fn) => { state = fn(state); return state; }, read: () => structuredClone(state) }, decks: { getFlashcardDeck: async () => deck, listFlashcardDecks: async () => [deck] }, now: () => now, id: () => 'session-1' }), read: () => state }; }
describe('FlashcardStudyService', () => {
  it('creates a resumable due/new study session and persists ratings', async () => { const { service, read } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id }); expect(opened.cards).toHaveLength(2); const rated = service.review({ userId: 'kid', sessionId: opened.session.sessionId, cardId: 'a', rating: 'again' }); expect(rated.card.state).toBe('learning'); expect(read().sessions['session-1'].reviews).toBe(1); });
  it('caps heartbeat credit so a client cannot claim an arbitrary duration', async () => { const { service } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id }); expect(service.heartbeat({ userId: 'kid', sessionId: opened.session.sessionId, seconds: 9999 }).activeSeconds).toBe(60); });
  it('summarizes due work and recent review history', async () => { const { service } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id }); service.review({ userId: 'kid', sessionId: opened.session.sessionId, cardId: 'a', rating: 'again' }); await expect(service.summary({ userId: 'kid', deckId: deck.id })).resolves.toMatchObject({ counts: { due: 0, new: 1, learning: 1 }, recent: [{ cardId: 'a' }] }); });
  it('reports assignment minutes and reviews within the current study-day window', async () => {
    let state = { schema: 'school.flashcard-progress/v1', cards: {}, sessions: {}, events: [
      { type: 'flashcard_review', at: '2026-08-23T12:00:00.000Z', deckId: deck.id },
      { type: 'flashcard_active_time', at: '2026-08-24T12:00:00.000Z', deckId: deck.id, seconds: 30 },
      { type: 'flashcard_review', at: '2026-08-24T12:00:00.000Z', deckId: deck.id },
    ] };
    const service = new FlashcardStudyService({ ...deps, progressStore: { update: (_u, fn) => { state = fn(state); return state; }, read: () => structuredClone(state) }, decks: { getFlashcardDeck: async () => deck }, now: () => Date.parse('2026-08-24T12:00:00.000Z'), boundaryHour: 4 });
    await expect(service.summary({ userId: 'kid', deckId: deck.id })).resolves.toMatchObject({ today: { reviewed: 1, activeSeconds: 30 } });
  });
  it('selects persisted due cards despite deck-prefixed storage keys', async () => { const { service } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id }); service.review({ userId: 'kid', sessionId: opened.session.sessionId, cardId: 'a', rating: 'again' }); const resumed = await service.open({ userId: 'kid', deckId: deck.id }); expect(resumed.cards.map((card) => card.cardId)).toEqual(['b']); });
  it('keeps an attributable append-only review and active-time history', async () => { const { service, read } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id }); service.review({ userId: 'kid', sessionId: opened.session.sessionId, cardId: 'a', rating: 'good', mode: 'learn', direction: 'back_to_front' }); service.heartbeat({ userId: 'kid', sessionId: opened.session.sessionId, seconds: 30 }); expect(read().events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'flashcard_review', cardId: 'a', rating: 'good', mode: 'learn', direction: 'back_to_front' }), expect.objectContaining({ type: 'flashcard_active_time', seconds: 30 })])); });
  it('records a revision migration while preserving surviving card history and retiring removed ids', async () => {
    let state = { schema: 'school.flashcard-progress/v1', cards: {}, sessions: {}, events: [] };
    let published = { id: deck.id, revision: 1, cards: [{ cardId: 'a' }, { cardId: 'b' }] };
    const service = new FlashcardStudyService({ ...deps, progressStore: { update: (_u, fn) => { state = fn(state); return state; }, read: () => structuredClone(state) }, decks: { getFlashcardDeck: async () => published }, now: () => Date.parse('2026-08-24T12:00:00.000Z'), id: () => 'revision-session' });
    const first = await service.open({ userId: 'kid', deckId: deck.id });
    service.review({ userId: 'kid', sessionId: first.session.sessionId, cardId: 'a', rating: 'good' });
    published = { ...published, revision: 2, cards: [{ cardId: 'a' }, { cardId: 'c' }] };
    await service.open({ userId: 'kid', deckId: deck.id });
    expect(state.cards[`${deck.id}/a`]).toBeTruthy();
    expect(state.decks[deck.id]).toMatchObject({ revision: '2', cardIds: ['a', 'c'], retiredCardIds: ['b'] });
    expect(state.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'flashcard_deck_revision', fromRevision: '1', toRevision: '2', retiredCardIds: ['b'], addedCardIds: ['c'] })]));
  });
  it('reports each published deck without exposing self-ratings as quiz grades', async () => { const { service } = harness(); await expect(service.report({ userId: 'kid' })).resolves.toMatchObject({ learnerId: 'kid', decks: [{ id: deck.id, cardCount: 2, summary: { counts: { new: 2 } } }] }); });
  it('opens an assigned assessment through a server-tagged quiz session', async () => {
    const { service } = harness();
    const grader = { getBank: () => ({ id: 'science/cells/test', items: [{ id: 'q1', type: 'multiple_choice' }, { id: 'q2', type: 'matching' }] }), openResolvedSession: (args) => ({ sessionId: 'quiz-1', args }), flashcardTestStatus: () => ({ passed: true }) };
    const assessed = new FlashcardStudyService({ ...deps, progressStore: { update: (_u, fn) => fn({ cards: {}, sessions: {} }), read: () => ({ cards: {}, sessions: {} }) }, decks: { getFlashcardDeck: async () => deck }, assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: deck.id, policy: { quizRequired: true } }] }) }, grader, id: () => 'test-run' });
    const result = await assessed.assessment({ userId: 'kid', deckId: deck.id, testPlan: { count: 1, types: ['matching'] }, open: true });
    expect(result.args).toMatchObject({ bankSnapshot: { items: [{ id: 'q2', type: 'matching' }] }, provenance: { flashcardTest: { deckId: deck.id, itemCount: 1, testId: 'test-run' } } });
    await expect(assessed.assessmentStatus({ userId: 'kid', deckId: deck.id })).resolves.toMatchObject({ required: true, passed: true });
    void service;
  });
  it('uses the deck assessment even when assignment policy has no bank id', async () => {
    const grader = { getBank: (id) => ({ id, items: [{ id: 'q1', type: 'multiple_choice' }] }) };
    const assessed = new FlashcardStudyService({ ...deps,
      progressStore: { update: (_u, fn) => fn({ cards: {}, sessions: {} }), read: () => ({ cards: {}, sessions: {} }) },
      decks: { getFlashcardDeck: async () => deck }, assignments: { get: async () => ({ programs: [] }) }, grader,
    });
    await expect(assessed.assessment({ userId: 'kid', deckId: deck.id })).resolves.toMatchObject({ bank: { id: 'science/cells/test' }, policy: {} });
  });
  it('dry-runs and applies a teacher-approved profile replay while invalidating sessions', async () => {
    const { service, read } = harness(); const opened = await service.open({ userId: 'kid', deckId: deck.id });
    service.review({ userId: 'kid', sessionId: opened.session.sessionId, cardId: 'a', rating: 'good' });
    const teacherGate = { assert: vi.fn() };
    const migrated = new FlashcardStudyService({ ...deps, teacherGate, progressStore: { update: (_u, fn) => fn(read()), read }, decks: { getFlashcardDeck: async () => deck }, now: () => Date.parse('2026-08-25T12:00:00.000Z') });
    await expect(migrated.migrateProfile({ learnerId: 'kid', deckId: deck.id, actorId: 'parent' })).resolves.toMatchObject({ dryRun: true, cards: 1 });
    await expect(migrated.migrateProfile({ learnerId: 'kid', deckId: deck.id, actorId: 'parent', dryRun: false })).resolves.toMatchObject({ dryRun: false, cards: 1 });
    expect(teacherGate.assert).toHaveBeenCalled(); expect(read().sessions).toEqual({});
  });
});
