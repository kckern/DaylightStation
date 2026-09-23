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
function make({ judgementCache = null, recordings = null, mode = 'live', attempts = null, attemptsReader = null, teacherGate = null, judge = null, store = memoryStore(), media = false, decks = null, bounds = null } = {}) {
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
    teacherGate, recordings, judgementCache,
    settings: () => SETTINGS, bounds, timezone: 'America/Los_Angeles', now: () => (t += 4000), logger, mode,
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

  it('3.1 / 3.3 carry the whole English bundle (text + picture + gloss audio), never the term', async () => {
    const seen = {};
    for (const rechecks of [0, 1, 2]) {
      const { service } = make({ store: dueStore(rechecks), media: true });
      const { item } = await service.open({ userId: 'test-learner', deckId: DECK });
      if (item.task === '3.1' || item.task === '3.3') seen[item.task] = item;
    }
    expect(Object.keys(seen).sort()).toEqual(['3.1', '3.3']);
    for (const item of Object.values(seen)) {
      expect(item.cue).toEqual({ type: 'english', text: 'Scissors', image: true, audio: true });
      expect(item.assets.image).toEqual(expect.any(String));
      expect(item.assets.glossAudio).toEqual(expect.stringContaining('gawi/gloss.mp3'));
      expect(JSON.stringify({ ...item, choices: [] })).not.toContain('가위');
    }
  });

  it('with no picture or gloss audio, the bundle is the text alone — never an empty prompt', async () => {
    const termAudioOnly = (id) => !String(id).includes('gloss') && !String(id).includes('image');
    const { service } = make({ store: dueStore(1), media: termAudioOnly });
    const { item } = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(item.cue).toEqual({ type: 'english', text: 'Scissors', image: false, audio: false });
    expect(item.assets).toMatchObject({ image: null, glossAudio: null });
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

  it('open folds a per-learner quiz document addressed to this learner (plan 3, spec §8)', async () => {
    const store = memoryStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const attempts = [{ id: 'att_own', at: '2026-09-22T20:00:00.000Z', bankId: 'language/korean/korean-vocab-quiz-test-learner-2026-w39@1', itemId: 'pul', correct: false, transport: 'paper' }];
    const { service } = make({ store, attempts });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.status.words.pul.state).toBe('familiar');
    expect(store.s.status.paperAttemptsFolded).toEqual(['att_own']);
  });

  it('open refuses a sibling\'s per-learner quiz document, logs it, never demotes, and does not re-log it (plan 3, spec §8)', async () => {
    const store = memoryStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const bankId = 'language/korean/korean-vocab-quiz-someone-else-2026-w39@1';
    const attempts = [{ id: 'att_sibling', at: '2026-09-22T20:00:00.000Z', bankId, itemId: 'pul', correct: false, transport: 'paper' }];
    const { service, logger, store: s } = make({ store, attempts });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(s.s.status.words.pul.state).toBe('claimed'); // unchanged, never demoted
    expect(s.s.status.paperAttemptsFolded).toEqual(['att_sibling']); // recorded so it is not re-evaluated
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.fold-refused', {
      learnerId: 'test-learner', package: 'korean-vocab', mode: 'live', attemptId: 'att_sibling', bankId,
    });
    logger.warn.mockClear();
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(logger.warn).not.toHaveBeenCalledWith('school.word-ladder.fold-refused', expect.anything());
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

/** gawi tricky since yesterday (streak at threshold), pul familiar: the day opens on gawi's drill. */
function trickyStore() {
  const store = memoryStore();
  store.s.status.words.gawi = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-19', tricky: true, trickySince: '2026-09-21', missStreak: 2 };
  store.s.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-19' };
  store.s.status.decksSeen = [DECK];
  return store;
}
const DRILL_RESPONSE = {
  copy: { typed: '가위' }, dictation: { typed: '가위' }, type: { typed: '가위' }, tiles: { tiles: ['가', '위'] },
};
const MIC = { microphone: true };
const TERM_AUDIO = 'gawi/term.mp3';

/** Opens the tricky day with a mic and every asset, walks the drill, and returns each step's public item. */
async function walkDrill(service, { onStep = async () => {} } = {}) {
  const opened = await service.open({ userId: 'test-learner', deckId: DECK, capabilities: MIC });
  const steps = {};
  let { item } = opened;
  for (let i = 0; i < 20 && item.type === 'drill'; i += 1) {
    steps[item.step] = item;
    await onStep(item, opened.sittingId);
    ({ item } = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: item.id, response: DRILL_RESPONSE[item.step] ?? { done: true } }));
  }
  return { opened, steps, after: item };
}

function doneStore() {
  const store = memoryStore();
  for (const id of ['gawi', 'pul']) store.s.status.words[id] = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
  store.s.status.decksSeen = [DECK];
  store.s.days[TODAY] = { ...emptyDay(TODAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 0, settings: null }, doneAt: '2026-09-22T15:00:00-07:00' };
  return store;
}

describe('WordLadderSittingService — drills, speaking, practice, My words', () => {
  it('open passes the microphone capability to the day: an intro word is said after its copy', async () => {
    const { service, store } = make({ media: true });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK, capabilities: MIC });
    expect(store.s.days[TODAY].capabilities).toEqual({ microphone: true });
    let { item } = opened;
    ({ item } = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: item.id, response: { seen: true } }));
    ({ item } = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: item.id, response: { typed: '가위' } }));
    expect(item).toMatchObject({ type: 'say', mode: 'say-after', word: { term: '가위', media: { audio: expect.stringContaining(TERM_AUDIO) } } });
  });

  it('without a microphone no say step is offered', async () => {
    const { service, store } = make({ media: true });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].capabilities).toEqual({ microphone: false });
  });

  it('drill steps carry exactly what the screen needs, and the unsupported ones never the term', async () => {
    const { service } = make({ store: trickyStore(), media: true });
    const { steps } = await walkDrill(service);
    expect(Object.keys(steps)).toEqual(['look', 'copy', 'say-after', 'match', 'read-aloud', 'dictation', 'tiles', 'say-from-cue', 'type']);
    for (const step of ['look', 'copy', 'say-after']) {
      expect(steps[step].word).toMatchObject({ term: '가위', gloss: 'Scissors', media: { audio: expect.stringContaining(TERM_AUDIO) } });
    }
    // read-aloud: the text, and no audio until the take.
    expect(steps['read-aloud'].word.term).toBe('가위');
    expect(JSON.stringify(steps['read-aloud'])).not.toContain(TERM_AUDIO);
    // dictation: the audio, no text.
    expect(steps.dictation.assets.audio).toEqual(expect.stringContaining(TERM_AUDIO));
    expect(JSON.stringify(steps.dictation)).not.toContain('가위');
    expect(steps.dictation.word).toBeUndefined();
    // tiles: syllables and a cue, never the joined term or its audio.
    expect(steps.tiles.tiles).toEqual(expect.arrayContaining(['가', '위']));
    const cueCarried = (item) => {
      expect(item.cue).toEqual({ type: 'english', text: 'Scissors', image: true, audio: true });
      expect(item.assets.glossAudio).toEqual(expect.stringContaining('gawi/gloss.mp3'));
      expect(item.assets.image).toEqual(expect.stringContaining('gawi/image.jpg'));
    };
    cueCarried(steps.tiles);
    expect(JSON.stringify(steps.tiles)).not.toContain('가위');
    expect(JSON.stringify(steps.tiles)).not.toContain(TERM_AUDIO);
    for (const step of ['say-from-cue', 'type']) {
      cueCarried(steps[step]);
      expect(JSON.stringify(steps[step])).not.toContain('가위');
      expect(JSON.stringify(steps[step])).not.toContain(TERM_AUDIO);
      expect(steps[step].word).toBeUndefined();
    }
    // match: Korean on the left, pictures (asset ids, gloss as fallback text) on the right.
    const pairs = steps.match.board.pairs;
    expect(pairs.map((pair) => pair.term).sort()).toEqual(['가위', '풀']);
    expect(pairs.find((pair) => pair.wordId === 'gawi').right).toEqual({ type: 'image', image: expect.stringContaining('gawi/image.jpg'), text: 'Scissors' });
  });

  it('saveRecording keeps a take for the current speaking step only, and never touches status', async () => {
    const recordings = { save: vi.fn(() => ({ take: 1, file: '/x' })) };
    const { service, store } = make({ store: trickyStore(), media: true, recordings });
    const takes = {};
    await walkDrill(service, {
      onStep: async (item, sittingId) => {
        const upload = () => service.saveRecording({ userId: 'test-learner', sittingId, itemId: item.id, buffer: Buffer.from('audio'), ext: 'webm' });
        if (!['say-after', 'read-aloud', 'say-from-cue'].includes(item.step)) {
          await expect(upload()).rejects.toThrow(/speaking/);
          return;
        }
        const status = structuredClone(store.s.status);
        const writes = store.s.writes;
        takes[item.step] = await upload();
        expect(store.s.status).toEqual(status);
        expect(store.s.writes).toBe(writes);
        await expect(service.saveRecording({ userId: 'test-learner', sittingId, itemId: 'd1:99', buffer: Buffer.from('a') })).rejects.toThrow(/stale item/);
      },
    });
    expect(recordings.save).toHaveBeenCalledTimes(3);
    expect(recordings.save).toHaveBeenCalledWith({ package: 'korean-vocab', learnerId: 'test-learner', day: TODAY, wordId: 'gawi', buffer: Buffer.from('audio'), ext: 'webm' });
    expect(takes['say-after']).toEqual({ take: 1 });
    // After the take, the native model is revealed for the unsupported steps.
    expect(takes['read-aloud']).toEqual({ take: 1, reveal: { term: '가위', audio: expect.stringContaining(TERM_AUDIO) } });
    expect(takes['say-from-cue']).toEqual({ take: 1, reveal: { term: '가위', audio: expect.stringContaining(TERM_AUDIO) } });
  });

  it('saveRecording refuses an empty take, an unknown format, and a service without a sink', async () => {
    const recordings = { save: vi.fn(() => ({ take: 1 })) };
    const { service } = make({ store: trickyStore(), media: true, recordings });
    const toSayAfter = async (svc) => {
      const opened = await svc.open({ userId: 'test-learner', deckId: DECK, capabilities: MIC });
      let { item } = opened;
      while (item.step !== 'say-after') {
        ({ item } = await svc.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: item.id, response: DRILL_RESPONSE[item.step] ?? { done: true } }));
      }
      return { sittingId: opened.sittingId, itemId: item.id };
    };
    const at = await toSayAfter(service);
    await expect(service.saveRecording({ userId: 'test-learner', ...at, buffer: Buffer.alloc(0) })).rejects.toThrow(/recording is required/);
    await expect(service.saveRecording({ userId: 'test-learner', ...at, buffer: Buffer.from('a'), ext: 'exe' })).rejects.toThrow(/format/);
    const bare = make({ store: trickyStore(), media: true });
    const at2 = await toSayAfter(bare.service);
    await expect(bare.service.saveRecording({ userId: 'test-learner', ...at2, buffer: Buffer.from('a') })).rejects.toThrow(/not configured/);
    expect(recordings.save).not.toHaveBeenCalled();
  });

  it("practice is refused before today's goal", async () => {
    const { service } = make();
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    await expect(service.practice({ userId: 'test-learner', sittingId: opened.sittingId, mode: 'write' })).rejects.toThrow(/goal/);
  });

  it('practice after the goal: a type-from-cue item is judged but never grades', async () => {
    const store = doneStore();
    const { service, judge } = make({ store });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.item.type).toBe('summary');
    const started = await service.practice({ userId: 'test-learner', sittingId: opened.sittingId, mode: 'write', help: false });
    expect(started.item).toMatchObject({ type: 'typed', task: '3.3', source: 'practice', graded: false });
    expect(JSON.stringify(started.item)).not.toMatch(/가위|풀/);
    expect(started.progress).toMatchObject({ phase: 'practice' });
    const before = structuredClone(store.s.status.words);
    const out = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: started.item.id, response: { typed: 'zz' } });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(out.result).toMatchObject({ correct: false, score: 2, judge: 'exact' });
    expect(store.s.status.words).toEqual(before);
  });

  it('practice listen and match items carry their words', async () => {
    const { service } = make({ store: doneStore(), media: true });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    const listen = await service.practice({ userId: 'test-learner', sittingId: opened.sittingId, mode: 'listen' });
    expect(listen.item.type).toBe('listen');
    expect(listen.item.words).toEqual(expect.arrayContaining([
      { wordId: 'gawi', term: '가위', audio: expect.stringContaining(TERM_AUDIO) },
      { wordId: 'pul', term: '풀', audio: expect.stringContaining('pul/term.mp3') },
    ]));
    const menu = await service.respond({ userId: 'test-learner', sittingId: opened.sittingId, itemId: listen.item.id, response: { done: true } });
    expect(menu.item).toMatchObject({ type: 'menu', modes: expect.arrayContaining(['listen', 'write']) });
    expect(menu.progress.phase).toBe('summary');
  });

  it('words lists every word of the package in deck order, with its ladder state', async () => {
    const store = memoryStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-10-01', introducedDay: '2026-09-01' };
    store.s.status.words.gawi = { ...emptyWordV3(), state: 'familiar', tricky: true, trickySince: TODAY, introducedDay: '2026-09-10' };
    store.s.status.decksSeen = [DECK_OTHER];
    const decks = {
      getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, words: ['gawi', 'pul'], lexicon: REF } : id === DECK_OTHER ? { id: DECK_OTHER, words: ['pul'], lexicon: REF } : null),
      listFlashcardDecks: async () => [],
    };
    const { service } = make({ store, decks });
    await expect(service.words({ userId: 'test-learner', deckId: DECK })).resolves.toEqual({
      words: [
        { wordId: 'pul', term: '풀', gloss: 'Glue', state: 'mastered', stage: 2, tricky: false, dueDay: '2026-10-01' },
        { wordId: 'gawi', term: '가위', gloss: 'Scissors', state: 'familiar', stage: 0, tricky: true, dueDay: null },
      ],
    });
    await expect(service.words({ userId: 'someone-else', deckId: DECK })).rejects.toThrow(/assignment/);
  });

  it('words in test mode reads the sitting\'s shadow and needs its id', async () => {
    const { service } = make({ mode: 'test' });
    await expect(service.words({ userId: 'test-learner', deckId: DECK })).rejects.toThrow(/sittingId/);
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    const { words } = await service.words({ userId: 'test-learner', deckId: DECK, sittingId: opened.sittingId });
    expect(words.map((w) => w.wordId)).toEqual(['gawi', 'pul']);
  });
});

describe('WordLadderSittingService — graded and transition events (plan 4, spec §8)', () => {
  const calls = (logger, event) => logger.info.mock.calls.filter(([name]) => name === event).map(([, data]) => data);

  it('an ordinary response logs answered and its transition, never graded', async () => {
    const { service, logger } = make();
    const { sittingId, item } = await service.open({ userId: 'test-learner', deckId: DECK });
    await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response: { seen: true } });
    expect(calls(logger, 'school.word-ladder.graded')).toEqual([]);
    expect(calls(logger, 'school.word-ladder.answered')).toEqual([expect.objectContaining({ learnerId: 'test-learner', sittingId, mode: 'live', itemId: item.id, type: 'flashcard', wordId: 'gawi' })]);
    expect(calls(logger, 'school.word-ladder.transition')).toEqual([{
      learnerId: 'test-learner', sittingId, mode: 'live', package: 'korean-vocab', day: TODAY, itemId: item.id,
      wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro',
    }]);
  });

  it('a graded recheck logs graded once and its transition, with mode', async () => {
    const { service, logger } = make({ store: dueStore(1), mode: 'test' });
    const { sittingId, item } = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(item).toMatchObject({ type: 'typed', source: 'recheck' });
    await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response: { typed: '가비' } });
    expect(calls(logger, 'school.word-ladder.graded')).toEqual([{
      learnerId: 'test-learner', sittingId, mode: 'test', package: 'korean-vocab', day: TODAY, itemId: item.id,
      wordId: 'gawi', task: '3.3', source: 'recheck', correct: false, score: 2, judge: 'exact',
    }]);
    expect(calls(logger, 'school.word-ladder.transition')).toEqual([expect.objectContaining({
      mode: 'test', wordId: 'gawi', from: { state: 'mastered', stage: 0 }, to: { state: 'familiar', stage: null }, source: 'recheck',
    })]);
    expect(calls(logger, 'school.word-ladder.answered')).toHaveLength(1);
  });

  it('a replayed answer logs no second graded or transition', async () => {
    const { service, logger } = make({ store: dueStore(1) });
    const { sittingId, item } = await service.open({ userId: 'test-learner', deckId: DECK });
    await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response: { typed: '가비' } });
    await service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response: { typed: '가비' } });
    expect(calls(logger, 'school.word-ladder.graded')).toHaveLength(1);
    expect(calls(logger, 'school.word-ladder.transition')).toHaveLength(1);
  });

  it('a paper fold on open logs its transitions with source paper', async () => {
    const store = memoryStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const attempts = [{ id: 'att_1', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK}-quiz@abcdef`, itemId: 'pul', correct: false, transport: 'paper' }];
    const { service, logger } = make({ store, attempts });
    const { sittingId } = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(calls(logger, 'school.word-ladder.transition')).toEqual([{
      learnerId: 'test-learner', sittingId, mode: 'live', package: 'korean-vocab', day: TODAY, itemId: null,
      wordId: 'pul', from: { state: 'claimed', stage: null }, to: { state: 'familiar', stage: null }, source: 'paper',
    }]);
  });

  it('a teacher fold logs its transitions with source paper and no sitting', async () => {
    const store = memoryStore();
    store.s.status.words.gawi = { ...emptyWordV3(), state: 'claimed', introducedDay: '2026-09-20' };
    const attempts = [{ id: 'att_2', at: '2026-09-22T20:00:00.000Z', bankId: `${DECK}-quiz@abcdef`, itemId: 'gawi', correct: false, transport: 'paper' }];
    const { service, logger } = make({ store, attempts, teacherGate: { assert: vi.fn() } });
    await service.fold({ learnerId: 'test-learner', actorId: 'parent', pin: '1234' });
    expect(calls(logger, 'school.word-ladder.transition')).toEqual([expect.objectContaining({
      learnerId: 'test-learner', sittingId: null, mode: 'live', wordId: 'gawi', source: 'paper', to: { state: 'familiar', stage: null },
    })]);
  });
});

describe('WordLadderSittingService — grown-up word controls (plan 4 task 4, spec §6)', () => {
  const gate = () => ({ assert: vi.fn() });
  const who = { learnerId: 'test-learner', deckId: DECK, actorId: 'parent', pin: '1234' };
  function adminStore() {
    const store = dueStore(2);
    store.s.status.words.gawi = { ...store.s.status.words.gawi, lastGraded: { day: '2026-09-20', task: '3.3', correct: false } };
    store.s.status.decksSeen = [DECK_OTHER, DECK];
    return store;
  }
  const cacheMock = () => ({ get: vi.fn(() => null), set: vi.fn() });
  const adminCalls = (service) => [
    () => service.adminWords(who),
    () => service.adminReset({ ...who, wordId: 'gawi' }),
    () => service.adminMarkMastered({ ...who, wordId: 'gawi', stage: 1 }),
    () => service.adminExclude({ ...who, wordId: 'gawi', excluded: true }),
    () => service.adminDropDeck({ ...who, dropDeckId: DECK_OTHER }),
    () => service.adminRegrade({ ...who, day: TODAY, itemId: 'rc:gawi', pass: true }),
  ];

  it('every admin call is teacher-gated, and a refusal changes nothing', async () => {
    const teacherGate = { assert: vi.fn(() => { throw new Error('Only a grown-up can do this.'); }) };
    const store = adminStore();
    const { service } = make({ store, teacherGate, judgementCache: cacheMock() });
    const before = structuredClone(store.s);
    for (const call of adminCalls(service)) await expect(call()).rejects.toThrow(/grown-up/);
    expect(teacherGate.assert).toHaveBeenCalledTimes(6);
    for (const [args] of teacherGate.assert.mock.calls) {
      expect(args).toEqual({ userId: 'parent', pin: '1234', action: 'word-ladder.admin', context: { learnerId: 'test-learner' } });
    }
    expect(store.s).toEqual(before);
  });

  it('is answered by the live service only', async () => {
    const { service } = make({ mode: 'test', teacherGate: gate(), judgementCache: cacheMock() });
    for (const call of adminCalls(service)) await expect(call()).rejects.toThrow(/live/);
  });

  it('adminWords lists every word with its state and the last 14 days of typed answers', async () => {
    const store = adminStore();
    store.s.days['2026-09-20'] = {
      ...emptyDay('2026-09-20'),
      items: {
        'rc:gawi': { at: '2026-09-20T16:00:00-07:00', response: { typed: '가이' }, result: { correct: false, score: 5, judge: 'model' }, wordId: 'gawi', task: '3.3', source: 'recheck', reason: 'close' },
        'r1:q:1': { at: '2026-09-20T16:01:00-07:00', response: { choice: 'Glue' }, result: { correct: true }, wordId: 'pul', task: '2.2', source: 'verify' },
      },
    };
    store.s.days['2026-09-01'] = { ...emptyDay('2026-09-01'), items: { 'rc:gawi': { at: 'x', response: { typed: '가우' }, result: { score: 2, judge: 'distance' }, wordId: 'gawi', task: '3.3' } } };
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    const { words } = await service.adminWords(who);
    expect(words.map((w) => w.wordId)).toEqual(['gawi', 'pul']);
    expect(words.find((w) => w.wordId === 'gawi')).toEqual({
      wordId: 'gawi', term: '가위', gloss: 'Scissors', state: 'mastered', stage: 0, dueDay: TODAY, missStreak: 0, tricky: false, excluded: false,
      lastGraded: { day: '2026-09-20', task: '3.3', correct: false },
      recentTyped: [{ day: '2026-09-20', itemId: 'rc:gawi', typed: '가이', score: 5, judge: 'model', reason: 'close', correct: false, source: 'recheck', regraded: null }],
    });
    expect(words.find((w) => w.wordId === 'pul').recentTyped).toEqual([]);
  });

  it('adminReset returns a word to new, clearing notYetCarry, and logs admin + transition', async () => {
    const store = adminStore();
    store.s.status.words.gawi.notYetCarry = true;
    const { service, logger } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await service.adminReset({ ...who, wordId: 'gawi' });
    expect(store.s.status.words.gawi).toEqual(emptyWordV3());
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.admin', expect.objectContaining({
      actorId: 'parent', learnerId: 'test-learner', package: 'korean-vocab', wordId: 'gawi', action: 'reset',
    }));
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.transition', expect.objectContaining({
      wordId: 'gawi', from: { state: 'mastered', stage: 0 }, to: { state: 'new', stage: null }, source: 'admin',
    }));
  });

  it('adminMarkMastered sets the stage and its due day', async () => {
    const store = adminStore();
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await service.adminMarkMastered({ ...who, wordId: 'pul', stage: 2 });
    expect(store.s.status.words.pul).toMatchObject({ state: 'mastered', stage: 2, dueDay: '2026-09-29' });
    delete store.s.status.words.gawi;
    await service.adminMarkMastered({ ...who, wordId: 'gawi', stage: 1 });
    expect(store.s.status.words.gawi).toMatchObject({ state: 'mastered', stage: 1, introducedDay: TODAY });
    await expect(service.adminMarkMastered({ ...who, wordId: 'pul', stage: -2 })).rejects.toThrow(/stage/);
    await expect(service.adminMarkMastered({ ...who, wordId: 'nope', stage: 1 })).rejects.toThrow(/nope/);
  });

  it('adminExclude flags the word, takes its pending recheck off today, and re-settles the day', async () => {
    const store = adminStore();
    store.s.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(opened.item).toMatchObject({ wordId: 'gawi' }); // the due recheck
    expect(store.s.days[TODAY].rounds).toHaveLength(0);
    await service.adminExclude({ ...who, wordId: 'gawi', excluded: true });
    expect(store.s.status.words.gawi.excluded).toBe(true);
    expect(store.s.days[TODAY].rechecks.order).toEqual([]);
    // Not a false "done" summary: the carry round for pul is planned now.
    expect(store.s.days[TODAY].doneAt).toBeNull();
    expect(store.s.days[TODAY].rounds.map((round) => round.words)).toEqual([['pul']]);
    const again = await service.get({ userId: 'test-learner', sittingId: opened.sittingId });
    expect(again.item.type).not.toBe('summary');
    expect(again.item.wordId).not.toBe('gawi');
    await service.adminExclude({ ...who, wordId: 'gawi', excluded: false });
    expect(store.s.status.words.gawi.excluded).toBe(false);
    await expect(service.adminExclude({ ...who, wordId: 'gawi', excluded: 'yes' })).rejects.toThrow(/excluded/);
  });

  it('adminMarkMastered applies the day\'s tuned gapScale', async () => {
    const store = adminStore();
    store.s.days[TODAY] = { ...emptyDay(TODAY), atOpen: { dueRechecks: [], tricky: [], newAllowance: 0, settings: { ...SETTINGS, review: { ...SETTINGS.review, gapScale: 2 } } } };
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await service.adminMarkMastered({ ...who, wordId: 'pul', stage: 2 });
    expect(store.s.status.words.pul.dueDay).toBe('2026-10-06');
  });

  it('word controls on a day never opened leave its day file empty (the store then writes status only)', async () => {
    const store = adminStore();
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await service.adminReset({ ...who, wordId: 'gawi' });
    await service.adminMarkMastered({ ...who, wordId: 'gawi', stage: 1 });
    await service.adminExclude({ ...who, wordId: 'pul', excluded: true });
    await service.adminDropDeck({ ...who, dropDeckId: DECK_OTHER });
    expect(store.s.days[TODAY]).toEqual(emptyDay(TODAY));
  });

  it('adminDropDeck refuses the current deck or any deck the learner is still enrolled in; adminWords lists the droppable ones', async () => {
    const store = adminStore();
    const { service } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await expect(service.adminDropDeck({ ...who, dropDeckId: DECK })).rejects.toThrow(/enrolled/);
    expect(store.s.status.decksSeen).toEqual([DECK_OTHER, DECK]);
    const listed = await service.adminWords(who);
    expect(listed.decksSeen).toEqual([DECK_OTHER, DECK]);
    expect(listed.droppableDecks).toEqual([DECK_OTHER]);
  });

  it('adminDropDeck removes a deck from decksSeen and keeps introduced words', async () => {
    const store = adminStore();
    const { service, logger } = make({ store, teacherGate: gate(), judgementCache: cacheMock() });
    await service.adminDropDeck({ ...who, dropDeckId: DECK_OTHER });
    expect(store.s.status.decksSeen).toEqual([DECK]);
    expect(store.s.status.words.pul.state).toBe('mastered');
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.admin', expect.objectContaining({ action: 'drop-deck', deckId: DECK_OTHER, wordId: null }));
  });

  it('adminRegrade overwrites the judge cache for that answer, records it on the item, and leaves word state', async () => {
    const store = adminStore();
    store.s.days['2026-09-20'] = {
      ...emptyDay('2026-09-20'),
      items: {
        'rc:gawi': { at: 'a', response: { typed: ' 가이 ' }, result: { correct: false, score: 5, judge: 'model' }, wordId: 'gawi', task: '3.3', source: 'recheck' },
        'r1:q:1': { at: 'b', response: { choice: 'Glue' }, result: { correct: true }, wordId: 'pul', task: '2.2', source: 'verify' },
      },
    };
    const judgementCache = cacheMock();
    const { service, logger } = make({ store, teacherGate: gate(), judgementCache });
    const wordBefore = structuredClone(store.s.status.words.gawi);
    await service.adminRegrade({ ...who, day: '2026-09-20', itemId: 'rc:gawi', pass: true });
    expect(judgementCache.set).toHaveBeenCalledWith('korean-vocab', 'gawi', '가이', { score: 6, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
    expect(store.s.days['2026-09-20'].items['rc:gawi'].regraded).toEqual({ at: expect.any(String), actorId: 'parent', pass: true });
    expect(store.s.status.words.gawi).toEqual(wordBefore);
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.admin', expect.objectContaining({ action: 'regrade', wordId: 'gawi', pass: true }));
    await service.adminRegrade({ ...who, day: '2026-09-20', itemId: 'rc:gawi', pass: false });
    expect(judgementCache.set).toHaveBeenLastCalledWith('korean-vocab', 'gawi', '가이', { score: 1, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
    await expect(service.adminRegrade({ ...who, day: '2026-09-20', itemId: 'r1:q:1', pass: true })).rejects.toThrow(/typed/);
    await expect(service.adminRegrade({ ...who, day: '2026-09-20', itemId: 'rc:none', pass: true })).rejects.toThrow(/rc:none/);
  });

  it('adminRegrade needs a judgement cache', async () => {
    const { service } = make({ store: adminStore(), teacherGate: gate() });
    await expect(service.adminRegrade({ ...who, day: TODAY, itemId: 'rc:gawi', pass: true })).rejects.toThrow(/cache/);
  });

  it('My words never lists an excluded word', async () => {
    const store = adminStore();
    store.s.status.words.pul = { ...store.s.status.words.pul, excluded: true };
    const { service } = make({ store });
    const { words } = await service.words({ userId: 'test-learner', deckId: DECK });
    expect(words.map((w) => w.wordId)).toEqual(['gawi']);
  });
});

describe('WordLadderSittingService — tuned settings (plan 5 task 3, spec §7)', () => {
  const DAY = 24 * 3600000;
  function tunedStore(values = {}) {
    const store = memoryStore();
    store.s.tuning = { schema: 'school.word-ladder-tuning/v1', values, lastChanged: {}, lastTunedDay: null, history: [] };
    store.readTuning = vi.fn(() => structuredClone(store.s.tuning));
    return store;
  }
  it('a tuning change lands at the NEXT day\'s first open, never mid-day', async () => {
    const store = tunedStore();
    const { service, advance } = make({ store });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(5);
    store.s.tuning.values = { 'round.size': 6, 'review.gapScale': 1.1 };
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(5);
    advance(DAY);
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days['2026-09-23'].atOpen.settings.round).toEqual({ size: 6, maxPasses: 3 });
    expect(store.s.days['2026-09-23'].atOpen.settings.review.gapScale).toBe(1.1);
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(5);
  });
  it('tuned values are clamped to the household word_ladder.bounds too', async () => {
    const store = tunedStore({ 'round.size': 7 });
    const { service } = make({ store, bounds: { 'round.size': [3, 6] } });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(6);
  });
  it('tuned values never touch grown-up settings', async () => {
    const store = tunedStore({ 'session.capMinutes': 60, 'typing.passScore': 2 });
    const { service } = make({ store });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.session.capMinutes).toBe(15);
    expect(store.s.days[TODAY].atOpen.settings.typing.passScore).toBe(6);
  });
  it('a store with no tuning (or one that throws) opens on the defaults', async () => {
    const store = memoryStore();
    store.readTuning = () => { throw new Error('disk'); };
    const { service, logger } = make({ store });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(5);
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-unreadable', expect.objectContaining({ learnerId: 'test-learner', package: 'korean-vocab' }));
  });
  it('test mode plays with the learner\'s tuned values (read-only)', async () => {
    const store = tunedStore({ 'round.size': 4 });
    store.writeTuning = vi.fn();
    const { service } = make({ store, mode: 'test' });
    await service.open({ userId: 'test-learner', deckId: DECK });
    expect(store.s.days[TODAY].atOpen.settings.round.size).toBe(4);
    expect(store.writeTuning).not.toHaveBeenCalled();
  });
});
