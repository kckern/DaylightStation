// backend/src/3_applications/school/WordLadderSittingService.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { emptyDay, emptyStatusV3, emptyWordV3 } from '#domains/school/wordLadder/index.mjs';
import { WordLadderSittingService } from './WordLadderSittingService.mjs';

const DECK = 'language/korean/week-01';
const DECK_OTHER = 'language/korean/week-00';
const REF = 'media:language/korean-vocab/lexicon.yml';
const TODAY = '2026-09-22';
const SETTINGS = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 }, review: { gapScale: 1, typedEvery: 2 },
  drill: { afterMisses: 2 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
function memoryStore() {
  const s = { status: emptyStatusV3(), days: {}, writes: 0 };
  return {
    s,
    readStatus: () => structuredClone(s.status),
    readDay: (_u, _p, d) => structuredClone(s.days[d] ?? emptyDay(d)),
    transact(_u, _p, d, fn) { const n = fn({ status: structuredClone(s.status), dayFile: structuredClone(s.days[d] ?? emptyDay(d)) }); s.status = n.status; s.days[d] = n.dayFile; s.writes += 1; return n; },
  };
}
const lexicon = {
  package: 'korean-vocab', program: { title: 'Korean words' }, language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  entries: new Map([['gawi', { id: 'gawi', group: 'week-01', term: '가위', gloss: 'Scissors', kind: 'word', decoys: { term: ['a', 'b', 'c'], gloss: ['x', 'y', 'z'] } }],
    ['pul', { id: 'pul', group: 'week-01', term: '풀', gloss: 'Glue', kind: 'word', decoys: { term: ['d', 'e', 'f'], gloss: ['u', 'v', 'w'] } }]]),
};
function make({ mode = 'live', attempts = null, attemptsReader = null, teacherGate = null, judge = null, store = memoryStore(), media = false, decks = null } = {}) {
  let t = Date.parse('2026-09-22T16:00:00-07:00');
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const judgeFn = judge ?? vi.fn(async ({ typed, entry }) => ({ score: typed === entry.term ? 10 : 2, judge: 'exact', reason: null, pass: typed === entry.term }));
  const token = mode === 'test' ? 'abc123' : 'live';
  const service = new WordLadderSittingService({
    stores: { open: () => ({ store, token }), forToken: (tk) => { if (tk !== token) throw new Error('unknown sitting'); return store; } },
    decks: decks ?? {
      getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, words: ['gawi', 'pul'], lexicon: REF } : null),
      listFlashcardDecks: async () => [{ id: DECK, words: ['gawi', 'pul'], lexicon: REF }, { id: DECK_OTHER, words: ['pul'], lexicon: REF }, { id: 'biology/cells', cards: [] }],
    },
    lexicons: { getLexicon: () => lexicon },
    assignments: { get: async (u) => (u === 'test-learner' ? { programs: [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }] } : { programs: [] }) },
    attempts: attemptsReader ? { readAttemptsInRange: attemptsReader } : attempts ? { readAttemptsInRange: vi.fn(() => attempts) } : null,
    assets: { exists: typeof media === 'function' ? media : () => media },
    judge: { judge: judgeFn },
    teacherGate,
    settings: () => SETTINGS, timezone: 'America/Los_Angeles', now: () => (t += 4000), logger, mode,
  });
  return { service, store, logger, judge: judgeFn, advance: (ms) => { t += ms; } };
}

/** A store whose only word is `gawi`, mastered and due today with `rechecks` prior rechecks. */
function dueStore(rechecks) {
  const store = memoryStore();
  store.s.status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 0, dueDay: TODAY, introducedDay: '2026-09-20', rechecks };
  store.s.status.words.pul = { ...emptyWordV3(), state: 'mastered', stage: 3, dueDay: '2026-10-30', introducedDay: '2026-09-01' };
  store.s.status.decksSeen = [DECK];
  return store;
}

async function walkToGraded(service, opened) {
  let { item } = opened;
  for (let i = 0; i < 40 && !['typed', 'choice', 'summary'].includes(item.type); i += 1) {
    const response = item.type === 'copy' ? { typed: item.word.term } : item.mode === 'intro' ? { seen: true } : { sort: 'claimed' };
    ({ item } = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: item.id, response }));
  }
  return item;
}

describe('WordLadderSittingService', () => {
  it('opens a sitting on the first intro flashcard with its word card', async () => {
    const { service } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.sittingId).toMatch(/^korean-vocab\.live\./);
    expect(opened.item).toMatchObject({ type: 'flashcard', mode: 'intro', word: { term: '가위', gloss: 'Scissors' } });
    expect(opened.package).toBe('korean-vocab');
    expect(opened.title).toBe('Korean words');
    expect(opened.progress).toMatchObject({ phase: 'round', round: { index: 1, size: 2, phase: 'intro' }, capMs: 15 * 60000 });
    expect(opened.progress.round).toHaveProperty('remainingInStream');
    expect(opened.progress.round).toHaveProperty('quizLeft');
  });

  it('graded items never carry the answer', async () => {
    const { service } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    const item = await walkToGraded(service, opened);
    expect(item.type).toBe('typed');
    expect(JSON.stringify(item)).not.toContain('가위');
    expect(item.word).toBeUndefined();
  });

  it('refuses a learner without the enrollment', async () => {
    const { service } = make();
    await expect(service.open({ userId: 'someone-else', deckId: 'other' })).rejects.toThrow(/assignment/);
  });

  it('a 2.2 recheck carries the term as its prompt and never the gloss answer outside the choices', async () => {
    const tasks = {};
    for (const rechecks of [0, 2]) {
      const { service } = make({ store: dueStore(rechecks) });
      const { item } = await service.open({ userId: 'test-learner', deckId: DECK });
      tasks[item.task] = item;
    }
    expect(Object.keys(tasks).sort()).toEqual(['2.2', '3.1']);
    const meaning = tasks['2.2'];
    expect(meaning).toMatchObject({ type: 'choice', prompt: '가위' });
    expect(meaning.word).toBeUndefined();
    expect(meaning.choices).toContain('Scissors');
    expect(JSON.stringify({ ...meaning, choices: [] })).not.toContain('Scissors');
    const pickTerm = tasks['3.1'];
    expect(pickTerm.word).toBeUndefined();
    expect(pickTerm.prompt).toBeUndefined();
    expect(pickTerm.choices).toContain('가위');
    expect(JSON.stringify({ ...pickTerm, choices: [] })).not.toContain('가위');
  });

  it('an image cue on 3.1 / 3.3 carries the gloss as its text fallback, never the term', async () => {
    const noGlossAudio = (id) => !String(id).includes('gloss');
    const seen = {};
    for (const rechecks of [0, 1, 2]) {
      const { service } = make({ store: dueStore(rechecks), media: noGlossAudio });
      const { item } = await service.open({ userId: 'test-learner', deckId: DECK });
      if (item.cue?.type === 'image') seen[item.task] = item;
    }
    expect(Object.keys(seen).sort()).toEqual(['3.1', '3.3']);
    for (const item of Object.values(seen)) {
      expect(item.cue).toEqual({ type: 'image', text: 'Scissors' });
      expect(item.assets.image).toEqual(expect.any(String));
      expect(JSON.stringify({ ...item, choices: [] })).not.toContain('가위');
    }
  });

  it('a 3.3 recheck carries no term anywhere', async () => {
    const { service } = make({ store: dueStore(1), media: true });
    const { item } = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(item).toMatchObject({ type: 'typed', task: '3.3' });
    expect(JSON.stringify(item)).not.toContain('가위');
    expect(item.word).toBeUndefined();
    expect(item.prompt).toBeUndefined();
    expect(item.assets.audio).toBeNull(); // term audio would speak the answer
  });

  it('judges a typed answer before the engine sees it, once per item', async () => {
    const { service, judge } = make({ store: dueStore(1) });
    const { sittingId, item } = await service.open({ userId: 'test-learner', deckId: DECK });
    const response = { typed: '가비' };
    const out = await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0]).toMatchObject({ pkg: 'korean-vocab', typed: '가비', entry: { id: 'gawi' } });
    expect(judge.mock.calls[0][0].otherWords).toEqual(expect.arrayContaining(['풀', 'a', 'b', 'c']));
    expect(out.result).toMatchObject({ correct: false, answer: '가위', score: 2, judge: 'exact' });
    const repeat = await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response });
    expect(repeat.result).toEqual(out.result);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('get returns the current item; close records the reason', async () => {
    const { service, store } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    const got = await service.get({ userId: 'test-learner', sittingId: opened.sittingId });
    expect(got.item).toEqual(opened.item);
    await service.close({ userId: 'test-learner', sittingId: opened.sittingId, reason: 'leave' });
    expect(store.s.days[TODAY].sittings[opened.sittingId]).toMatchObject({ deckId: DECK, reason: 'leave' });
    expect(store.s.days[TODAY].sittings[opened.sittingId].closedAt).toEqual(expect.any(String));
  });

  it('an unknown sitting and a test id on the live service are not found', async () => {
    const { service } = make();
    await expect(service.get({ userId: 'test-learner', sittingId: 'korean-vocab.live.nope' })).rejects.toThrow(/sitting/);
    await expect(service.get({ userId: 'test-learner', sittingId: 'test.korean-vocab.abc123.1' })).rejects.toThrow(/sitting/);
  });

  it('test mode ids carry the test prefix and the shadow token', async () => {
    const { service } = make({ mode: 'test' });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.sittingId).toMatch(/^test\.korean-vocab\.abc123\./);
    await expect(service.get({ userId: 'test-learner', sittingId: opened.sittingId })).resolves.toMatchObject({ item: { id: opened.item.id } });
    await expect(service.get({ userId: 'test-learner', sittingId: 'korean-vocab.live.x' })).rejects.toThrow(/sitting/);
  });

  it('settings come from the day file\'s at-open snapshot; a null snapshot falls back to current settings', async () => {
    const snapStore = memoryStore();
    snapStore.s.days[TODAY] = { ...emptyDay(TODAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 4, settings: { ...SETTINGS, session: { capMinutes: 30 } } } };
    const a = make({ store: snapStore });
    expect((await a.service.open({ userId: 'test-learner', deckId: DECK })).progress.capMs).toBe(30 * 60000);

    const doneStore = memoryStore();
    doneStore.s.days[TODAY] = { ...emptyDay(TODAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 0, settings: null }, doneAt: '2026-09-22T15:00:00-07:00' };
    const b = make({ store: doneStore });
    const opened = await b.service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.item.type).toBe('summary');
    expect(opened.progress).toMatchObject({ phase: 'summary', round: null, capMs: 15 * 60000 });
    await expect(b.service.get({ userId: 'test-learner', sittingId: opened.sittingId })).resolves.toMatchObject({ item: { type: 'summary' } });
    await expect(b.service.dayStatus({ userId: 'test-learner', deckId: DECK })).resolves.toMatchObject({ doneToday: true });
  });

  it('a day with nothing to do is done for today as soon as it is opened', async () => {
    const store = memoryStore();
    for (const id of ['gawi', 'pul']) store.s.status.words[id] = { ...emptyWordV3(), state: 'mastered', stage: 3, dueDay: '2026-10-30', introducedDay: '2026-09-01' };
    store.s.status.decksSeen = [DECK];
    const { service } = make({ store });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.item.type).toBe('summary');
    expect(store.s.days[TODAY].doneAt).toMatch(/^2026-09-22T16:00:0\d-07:00$/);
    await expect(service.dayStatus({ userId: 'test-learner', deckId: DECK })).resolves.toMatchObject({ doneToday: true, progressLabel: 'Done for today' });
  });

  it('dayStatus: not opened, then in progress', async () => {
    const { service } = make();
    await expect(service.dayStatus({ userId: 'test-learner', deckId: DECK })).resolves.toEqual({ doneToday: false, progressLabel: 'Not opened', remaining: null });
    await service.open({ userId: 'test-learner', deckId: DECK });
    await expect(service.dayStatus({ userId: 'test-learner', deckId: DECK })).resolves.toEqual({ doneToday: false, progressLabel: 'In progress', remaining: null });
  });

  it('open folds scanned paper misses once, from any deck sharing the lexicon', async () => {
    const store = memoryStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const attempts = [{ id: 'att_1', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK_OTHER}-quiz@abcdef`, itemId: 'pul', correct: false, transport: 'paper' }];
    const { service } = make({ store, attempts });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.status.words.pul.state).toBe('familiar');
    expect(store.s.status.paperAttemptsFolded).toEqual(['att_1']);
    expect(store.s.status.lastFoldedDay).toBe(TODAY);
  });

  it('an unreadable attempts log does not advance lastFoldedDay', async () => {
    const { service, store, logger } = make({ attemptsReader: () => { throw new Error('disk'); } });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.status.lastFoldedDay).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.attempts-unreadable', expect.objectContaining({ learnerId: 'test-learner' }));
  });

  it('fold: the teacher gate refuses a non-teacher', async () => {
    const teacherGate = { assert: vi.fn(() => { throw new Error('teacher PIN required'); }) };
    const { service } = make({ teacherGate, attempts: [] });
    await expect(service.fold({ learnerId: 'test-learner', actorId: 'test-learner', pin: null })).rejects.toThrow(/teacher/);
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ action: 'word-ladder.fold', context: { learnerId: 'test-learner' } }));
  });

  it('fold: without a teacher gate it refuses', async () => {
    const { service } = make({ attempts: [] });
    await expect(service.fold({ learnerId: 'test-learner', actorId: 'parent' })).rejects.toThrow(/teacher gate/);
  });

  it('fold: a folded paper miss demotes a claimed word, without opening a sitting', async () => {
    const store = memoryStore();
    store.s.status.words.gawi = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const attempts = [{ id: 'att_2', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK}-quiz@abcdef`, itemId: 'gawi', correct: false, transport: 'paper' }];
    const { service } = make({ store, attempts, teacherGate: { assert: vi.fn() } });
    await expect(service.fold({ learnerId: 'test-learner', actorId: 'parent', pin: '1234' })).resolves.toEqual({ learnerId: 'test-learner', folded: 1, demoted: ['gawi'] });
    expect(store.s.status.words.gawi.state).toBe('familiar');
    expect(store.s.days[TODAY].sittings).toEqual({});
    expect(store.s.days[TODAY].atOpen).toBeNull();
    await expect(service.fold({ learnerId: 'test-learner', actorId: 'parent', pin: '1234' })).resolves.toEqual({ learnerId: 'test-learner', folded: 0, demoted: [] });
  });

  it('open writes once: fold, plan and sitting row in one transaction', async () => {
    const { service, store } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.writes).toBe(1);
    expect(store.s.days[TODAY].rounds).toHaveLength(1);
    expect(store.s.days[TODAY].rounds[0].newWords).toEqual(['gawi', 'pul']);
    expect(store.s.days[TODAY].sittings[opened.sittingId]).toMatchObject({ closedAt: null });
  });

  it('a closed sitting reopens on get and on respond instead of 404ing', async () => {
    const { service, store } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    await service.close({ userId: 'test-learner', sittingId: opened.sittingId, reason: 'unmount' });
    expect(store.s.days[TODAY].sittings[opened.sittingId].reason).toBe('unmount');
    await expect(service.get({ userId: 'test-learner', sittingId: opened.sittingId })).resolves.toMatchObject({ item: { id: opened.item.id } });
    expect(store.s.days[TODAY].sittings[opened.sittingId]).toMatchObject({ closedAt: null, reason: null });
    await service.close({ userId: 'test-learner', sittingId: opened.sittingId, reason: 'leave' });
    const out = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: opened.item.id, response: { seen: true } });
    expect(out.item.type).toBe('copy');
    expect(store.s.days[TODAY].sittings[opened.sittingId]).toMatchObject({ closedAt: null, reason: null });
  });

  it('close skips the write when the sitting is already closed', async () => {
    const { service, store } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    await service.close({ userId: 'test-learner', sittingId: opened.sittingId, reason: 'leave' });
    const writes = store.s.writes;
    const closedAt = store.s.days[TODAY].sittings[opened.sittingId].closedAt;
    await expect(service.close({ userId: 'test-learner', sittingId: opened.sittingId, reason: 'idle' })).resolves.toMatchObject({ closed: true });
    expect(store.s.writes).toBe(writes);
    expect(store.s.days[TODAY].sittings[opened.sittingId]).toMatchObject({ closedAt, reason: 'leave' });
  });

  it('a typed item answered by a request prepared before the previous answer landed is stale', async () => {
    const store = dueStore(1);
    store.s.status.words.pul = { ...emptyWordV3(), state: 'mastered', stage: 0, dueDay: TODAY, introducedDay: '2026-09-20', rechecks: 1 };
    store.s.status.decksSeen = [DECK_OTHER, DECK];
    let gate = null;
    const decks = {
      getFlashcardDeck: async (id) => {
        if (id === DECK_OTHER && gate) { const wait = gate; gate = null; await wait; }
        return id === DECK ? { id: DECK, words: ['gawi', 'pul'], lexicon: REF } : id === DECK_OTHER ? { id: DECK_OTHER, words: [], lexicon: REF } : null;
      },
      listFlashcardDecks: async () => [],
    };
    const { service, judge } = make({ store, decks });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.item).toMatchObject({ type: 'typed', task: '3.3' });
    const secondId = opened.item.id === 'rc:gawi' ? 'rc:pul' : 'rc:gawi';
    let release;
    gate = new Promise((resolve) => { release = resolve; });
    // Request 2 reads the day (item 1 still current), then stalls in #pool.
    const late = service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: secondId, response: { typed: '풀' } });
    await new Promise((resolve) => setImmediate(resolve));
    // Request 1 answers item 1 and commits; item 2 is now current.
    const first = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: opened.item.id, response: { typed: 'x' } });
    expect(first.item.id).toBe(secondId);
    release();
    await expect(late).rejects.toThrow(/stale item/);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(store.s.days[TODAY].items[secondId]).toBeUndefined();
  });

  it('idle close: after 5 min without input, other open sittings close as idle at the last input', async () => {
    const { service, store, logger, advance } = make();
    const a = await service.open({ userId: 'test-learner', deckId: DECK });
    await service.respond({ userId: 'test-learner', sittingId: a.sittingId, itemId: a.item.id, response: { seen: true } });
    const lastInputAt = store.s.days[TODAY].lastInputAt;
    const b = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].sittings[a.sittingId].closedAt).toBeNull();
    advance(5 * 60_000);
    await service.get({ userId: 'test-learner', sittingId: b.sittingId });
    const rowA = store.s.days[TODAY].sittings[a.sittingId];
    expect(rowA.reason).toBe('idle');
    expect(Date.parse(rowA.closedAt)).toBe(lastInputAt);
    expect(store.s.days[TODAY].sittings[b.sittingId]).toMatchObject({ closedAt: null, reason: null });
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.closed', expect.objectContaining({ sittingId: a.sittingId, reason: 'idle' }));
    // A quiet reload does not write.
    const writes = store.s.writes;
    await service.get({ userId: 'test-learner', sittingId: b.sittingId });
    expect(store.s.writes).toBe(writes);
  });
});
