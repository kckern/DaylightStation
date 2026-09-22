import { describe, expect, it, vi } from 'vitest';
import { WordLadderStudyService } from './WordLadderStudyService.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { answerFor, emptyStatus, validateLexicon } from '#domains/school/wordLadder/index.mjs';

const DECK_ID = 'language/korean/week-01-classroom';
const DECK_B = 'language/korean/week-02-names';
const REF = 'media:language/korean-vocab/lexicon.yml';
const { entries: LEXICON } = validateLexicon({ schema: 'school.word-lexicon/v1', entries: [
  { id: 'gawi', kind: 'word', korean: '가위', english: 'Scissors', pronunciation: null, decoys: { korean: ['가지', '바위', '가방'], english: ['Knife', 'Tape', 'Ruler'] } },
  { id: 'pul', kind: 'word', korean: '풀', english: 'Glue', pronunciation: null, decoys: { korean: ['불', '뿔', '발'], english: ['Tape', 'Paint', 'Stapler'] } },
  { id: 'ireum', kind: 'word', korean: '이름', english: 'Name', pronunciation: null, decoys: { korean: ['여름', '아름', '이불'], english: ['Age', 'Face', 'Home'] } },
] });
const DAY1_MS = Date.parse('2026-09-22T23:00:00.000Z'); // 16:00 PDT, study day 2026-09-22
const DAY_MS = 86_400_000;

function memoryStore() {
  const data = {};
  return {
    data,
    read: (userId) => structuredClone(data[userId] ?? emptyStatus()),
    update: (userId, fn) => { const next = fn(structuredClone(data[userId] ?? emptyStatus())); data[userId] = structuredClone(next); return structuredClone(next); },
  };
}

function make({ policy = { mode: 'word-ladder' }, attempts = [], media = false, attemptsReader = null } = {}) {
  let now = DAY1_MS; let n = 0;
  const store = memoryStore();
  const saved = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new WordLadderStudyService({
    store,
    decks: {
      getFlashcardDeck: async (id) => (id === DECK_ID ? { id: DECK_ID, lexicon: REF, words: ['gawi', 'pul'], cards: [] }
        : id === DECK_B ? { id: DECK_B, lexicon: REF, words: ['ireum'], cards: [] } : null),
      listFlashcardDecks: async () => [{ id: DECK_ID, lexicon: REF, words: ['gawi', 'pul'] }, { id: 'biology/cells', cards: [] }],
    },
    lexicons: { getLexicon: () => LEXICON },
    assignments: { get: async () => ({ programs: [
      { programId: 'flashcards', deckId: DECK_ID, policy },
      { programId: 'flashcards', deckId: DECK_B, policy },
    ] }) },
    attempts: { readAttemptsInRange: attemptsReader ?? vi.fn(() => attempts) },
    recordings: { save: (args) => { saved.push(args); return { take: saved.length, file: 'f' }; }, latest: () => ({ resource: { body: 'x' }, contentType: 'audio/webm' }) },
    assets: { exists: () => media },
    teacherGate: { assert: vi.fn() },
    timezone: 'America/Los_Angeles',
    now: () => now,
    id: () => `ses_${++n}`,
    logger,
  });
  return { service, store, saved, logger, advanceDays: (days) => { now += days * DAY_MS; } };
}

async function studyAll(service, sessionId, plan, mark = 'know') {
  let current = plan;
  for (const item of plan.study) {
    ({ plan: current } = await service.saveRecording({ userId: 'kid', sessionId, wordId: item.wordId, buffer: Buffer.from('audio') }));
    ({ plan: current } = await service.markCard({ userId: 'kid', sessionId, wordId: item.wordId, mark }));
  }
  return current;
}
async function answerAll(service, sessionId, items, { wrong = [] } = {}) {
  let plan = null;
  for (const item of items) {
    const entry = LEXICON.get(item.wordId);
    const right = answerFor(entry, item.direction);
    const choice = wrong.includes(item.wordId) ? item.choices.find((c) => c !== right) : right;
    ({ plan } = await service.answerCheck({ userId: 'kid', sessionId, wordId: item.wordId, choice }));
  }
  return plan;
}

describe('WordLadderStudyService', () => {
  it('refuses a learner whose assignment is not a word ladder for this deck', async () => {
    const { service } = make({ policy: { mode: 'fsrs' } });
    await expect(service.open({ userId: 'kid', deckId: DECK_ID })).rejects.toBeInstanceOf(GuestForbiddenError);
  });

  it('day 1: everything is study; recording + "I know it" earns the day', async () => {
    const { service, store } = make();
    const { sessionId, day, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(day).toBe('2026-09-22');
    expect(plan.checks).toEqual([]);
    expect(plan.study.map((s) => s.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(plan.study[0].card.media).toEqual({ image: null, audio: null });
    expect(plan.deckCards.map((c) => c.wordId)).toEqual(['gawi', 'pul']);
    const done = await studyAll(service, sessionId, plan);
    expect(done.doneToday).toBe(true);
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'claimed', claimedDay: '2026-09-22' });
    expect(store.data.kid.words.gawi.history.map((e) => e.event)).toEqual(['study', 'claim']);
    expect(store.data.kid.words.gawi.history[0].at).toMatch(/^2026-09-22T16:00:00-07:00$/);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: true, progressLabel: 'Done for today' });
  });

  it('a reload the same day returns the same frozen plan and never checks a word claimed today', async () => {
    const { service } = make();
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, first.sessionId, first.plan);
    const again = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(again.sessionId).not.toBe(first.sessionId);
    expect(again.plan.checks).toEqual([]);
    expect(again.plan.review).toEqual([]);
    expect(again.plan.study.map((s) => s.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(again.plan.doneToday).toBe(true);
  });

  it('day 2 checks yesterday\'s claims; a scheduled pass makes the word KNOWN with a +3 day check', async () => {
    const { service, store, advanceDays } = make();
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, first.sessionId, first.plan);
    advanceDays(1);
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(plan.checks.map((c) => c.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(plan.checks.every((c) => c.direction === 'korean_to_english' && c.prompt.type === 'text' && c.choices.length === 4)).toBe(true);
    const after = await answerAll(service, sessionId, plan.checks);
    expect(after.doneToday).toBe(true);
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'known', step: 0, nextCheckDay: '2026-09-26' });
  });

  it('day 3 with nothing due is a mandatory review quiz; passes are early and change nothing', async () => {
    const { service, store, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await answerAll(service, d2.sessionId, d2.plan.checks);
    advanceDays(1);
    const d3 = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(d3.plan.checks).toEqual([]);
    expect(d3.plan.review.map((c) => c.wordId).sort()).toEqual(['gawi', 'pul']);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: false });
    const before = structuredClone(store.data.kid.words.gawi);
    const after = await answerAll(service, d3.sessionId, d3.plan.review);
    expect(after.doneToday).toBe(true);
    expect({ ...store.data.kid.words.gawi, history: null }).toEqual({ ...before, history: null });
    expect(store.data.kid.words.gawi.history.at(-1).event).toBe('check-pass-early');
  });

  it('a word stuck in learning from another deck is carried into study and does not suppress the review quiz', async () => {
    const { service, store, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await answerAll(service, d2.sessionId, d2.plan.checks);
    store.data.kid.words.ireum = { state: 'learning', step: 0, claimedDay: null, nextCheckDay: null, history: [] };
    advanceDays(1);
    const d3 = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(d3.plan.checks).toEqual([]);
    expect(d3.plan.study.map((s) => s.wordId)).toEqual(['ireum']);
    expect(d3.plan.review.map((c) => c.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(d3.plan.deckCards.map((c) => c.wordId)).toEqual(['gawi', 'pul']);
    await answerAll(service, d3.sessionId, d3.plan.review);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: false });
    const done = await studyAll(service, d3.sessionId, { study: d3.plan.study }, 'learning');
    expect(done.doneToday).toBe(true);
  });

  it('a review-quiz miss demotes and puts the word into today\'s study pass', async () => {
    const { service, store, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await answerAll(service, d2.sessionId, d2.plan.checks);
    advanceDays(1);
    const d3 = await service.open({ userId: 'kid', deckId: DECK_ID });
    const plan = await answerAll(service, d3.sessionId, d3.plan.review, { wrong: ['gawi'] });
    expect(store.data.kid.words.gawi).toMatchObject({ state: 'learning', step: 0 });
    expect(plan.study.map((s) => s.wordId)).toEqual(['gawi']);
    expect(plan.doneToday).toBe(false);
    const done = await studyAll(service, d3.sessionId, plan, 'learning');
    expect(done.doneToday).toBe(true);
  });

  it('mic unavailable: marking without a take is allowed only when declared, and still earns the day', async () => {
    const { service } = make();
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    await expect(service.markCard({ userId: 'kid', sessionId, wordId: plan.study[0].wordId, mark: 'know' })).rejects.toThrow(/record the word first/);
    let current = plan;
    for (const item of plan.study) {
      ({ plan: current } = await service.markCard({ userId: 'kid', sessionId, wordId: item.wordId, mark: 'know', recording: { status: 'unavailable', reason: 'denied' } }));
    }
    expect(current.doneToday).toBe(true);
    expect(current.study.every((s) => s.recording === 'unavailable')).toBe(true);
  });

  it('refuses a choice that was never offered and a second answer to the same check', async () => {
    const { service, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    const item = plan.checks[0];
    await expect(service.answerCheck({ userId: 'kid', sessionId, wordId: item.wordId, choice: 'Banana' })).rejects.toThrow(/not one of the offered answers/);
    await answerAll(service, sessionId, [item]);
    await expect(answerAll(service, sessionId, [item])).rejects.toThrow(/has no open check today/);
  });

  it('folds scanned paper misses once, at open', async () => {
    const attempts = [{ id: 'att_9', at: '2026-09-23T03:00:00.000Z', bankId: `${DECK_ID}-quiz@abcdef123`, itemId: 'gawi', correct: false, transport: 'paper' }];
    const { service, store } = make({ attempts });
    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(first.folded).toBe(1);
    expect(store.data.kid.words.gawi.history.at(-1)).toMatchObject({ event: 'quiz-miss', attemptId: 'att_9', day: '2026-09-22' });
    const second = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(second.folded).toBe(0);
    expect(store.data.kid.paperAttemptsFolded).toEqual(['att_9']);
  });

  it('a teacher fold applies scans without opening a session', async () => {
    const attempts = [{ id: 'att_2', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK_ID}-quiz@abcdef123`, itemId: 'pul', correct: false, transport: 'paper' }];
    const { service } = make({ attempts });
    await expect(service.fold({ learnerId: 'kid', actorId: 'parent', pin: null })).resolves.toEqual({ learnerId: 'kid', folded: 1, demoted: ['pul'] });
  });

  it('a failed attempts read folds nothing and does not advance lastFoldedDay; the next successful read still folds the earlier attempt', async () => {
    const attempt = { id: 'att_9', at: '2026-09-23T03:00:00.000Z', bankId: `${DECK_ID}-quiz@abcdef123`, itemId: 'gawi', correct: false, transport: 'paper' };
    let calls = 0;
    const attemptsReader = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('store unreachable');
      return [attempt];
    });
    const { service, store, logger } = make({ attemptsReader });

    const first = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(first.folded).toBe(0);
    expect(store.data.kid.lastFoldedDay ?? null).toBeNull();
    expect(store.data.kid.words.gawi).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.attempts-unreadable', expect.objectContaining({ learnerId: 'kid' }));

    const second = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(second.folded).toBe(1);
    expect(store.data.kid.lastFoldedDay).toBe('2026-09-22');
    expect(store.data.kid.words.gawi.history.at(-1)).toMatchObject({ event: 'quiz-miss', attemptId: 'att_9', day: '2026-09-22' });
  });

  it('replays a past day from its frozen plan', async () => {
    const { service, advanceDays } = make();
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID, day: '2026-09-22' })).resolves.toMatchObject({ doneToday: true });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID, day: '2026-09-20' })).resolves.toMatchObject({ doneToday: false, progressLabel: 'Not opened' });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: false });
  });

  it('review run: a viewed card logs `review` and changes neither state nor credit', async () => {
    const { service, store } = make();
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    await studyAll(service, sessionId, plan);
    const before = structuredClone(store.data.kid.words.pul);
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'pul' })).resolves.toEqual({ wordId: 'pul', logged: true });
    expect({ ...store.data.kid.words.pul, history: null }).toEqual({ ...before, history: null });
    expect(store.data.kid.words.pul.history.at(-1)).toMatchObject({ event: 'review', day: '2026-09-22' });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: true });
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'ireum' })).rejects.toThrow(/not in this deck/);
  });

  it('a second deck opened the same day freezes its own plan and never overwrites the first deck\'s', async () => {
    const { service, store } = make();
    const a = await service.open({ userId: 'kid', deckId: DECK_ID });
    const doneA = await studyAll(service, a.sessionId, a.plan);
    expect(doneA.doneToday).toBe(true);
    const frozenA = structuredClone(store.data.kid.days['2026-09-22'][DECK_ID]);
    const b = await service.open({ userId: 'kid', deckId: DECK_B });
    expect(b.plan.deckId).toBe(DECK_B);
    expect(b.plan.checks).toEqual([]);
    expect(b.plan.study.map((s) => s.wordId)).toEqual(['ireum']);
    expect(b.plan.doneToday).toBe(false);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_B })).resolves.toMatchObject({ doneToday: false });
    const again = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(store.data.kid.days['2026-09-22'][DECK_ID]).toEqual(frozenA);
    expect(again.plan.checks).toEqual([]);
    expect(again.plan.study.map((s) => s.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(again.plan.doneToday).toBe(true);
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID })).resolves.toMatchObject({ doneToday: true });
    await expect(service.dayStatus({ userId: 'kid', deckId: DECK_ID, day: '2026-09-22' })).resolves.toMatchObject({ doneToday: true });
  });

  it('the review run is refused until the day\'s plan for the deck is done', async () => {
    const { service, store } = make();
    const { sessionId, plan } = await service.open({ userId: 'kid', deckId: DECK_ID });
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'gawi' })).rejects.toThrow(/review run opens after/);
    expect(store.data.kid.words.gawi).toBeUndefined();
    await studyAll(service, sessionId, plan);
    await expect(service.viewReviewCard({ userId: 'kid', sessionId, wordId: 'gawi' })).resolves.toEqual({ wordId: 'gawi', logged: true });
  });

  it('sessions expire at the study-day boundary', async () => {
    const { service, advanceDays } = make();
    const { sessionId } = await service.open({ userId: 'kid', deckId: DECK_ID });
    advanceDays(1);
    await expect(service.plan({ userId: 'kid', sessionId })).rejects.toThrow(/word-ladder session not found/);
  });

  it('uses available media for prompts and card faces', async () => {
    const { service, advanceDays } = make({ media: true });
    const d1 = await service.open({ userId: 'kid', deckId: DECK_ID });
    expect(d1.plan.study[0].card.media.image).toMatch(/^media:language\/korean-vocab\/words\/.+\/image\.jpg$/);
    await studyAll(service, d1.sessionId, d1.plan);
    advanceDays(1);
    const d2 = await service.open({ userId: 'kid', deckId: DECK_ID });
    for (const item of d2.plan.checks) {
      if (item.direction === 'picture_to_korean') expect(item.prompt).toEqual({ type: 'image', assetId: `media:language/korean-vocab/words/${item.wordId}/image.jpg` });
      if (item.direction === 'audio_to_korean') expect(item.prompt).toEqual({ type: 'audio', assetId: `media:language/korean-vocab/words/${item.wordId}/ko.mp3` });
      if (item.direction === 'korean_to_english') expect(item.prompt).toEqual({ type: 'text', text: LEXICON.get(item.wordId).korean });
    }
  });
});
