// Weekly dictation (spec 2026-11-06): the service's dictation run, intro,
// launch card, Stop for now and teacher view. Split from
// CardLadderSittingService.test.mjs, which shares its fixtures.
import { describe, expect, it, vi } from 'vitest';
import { DECK, REF, TODAY, memoryStore, lexicon, make } from "../../../../../tests/_lib/school/cardLadderSittingFixtures.mjs";

describe('CardLadderSittingService — dictation', () => {
  const WEEK = '2026-W46';
  /** A copy of `base` whose entries named in `ids` carry `dictation: [week]` (lexicon order is the list order). */
  function tagged(ids, { week = WEEK, base = lexicon } = {}) {
    const entries = new Map([...base.entries].map(([id, entry]) => [id, ids.includes(id) ? { ...entry, dictation: [week] } : { ...entry }]));
    return { ...base, entries };
  }
  const decksWith = (words) => ({
    getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, title: 'Week 1: Classroom', words, lexicon: REF } : null),
    listFlashcardDecks: async () => [{ id: DECK, words, lexicon: REF }],
  });
  function dictationStore({ progress = null, fileState = null } = {}) {
    const store = memoryStore();
    store.s.progress = progress; store.s.progressWrites = [];
    Object.assign(store, {
      readDictationProgress: () => structuredClone(store.s.progress ?? { week: null, words: {} }),
      writeDictationProgress: (_u, _p, next) => { store.s.progress = structuredClone(next); store.s.progressWrites.push(structuredClone(next)); return next; },
      dictationFileState: () => fileState ?? { progress: store.s.progress ? 'ok' : 'missing' },
    });
    return store;
  }
  const makeD = ({ list = ['gawi', 'pul'], ...opts } = {}) => make({ media: true, lexiconData: tagged(list), ...opts });
  async function begin(opts = {}) {
    const made = makeD(opts);
    const opened = await made.service.open({ userId: 'test-learner', deckId: DECK });
    const started = await made.service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId: opened.sittingId });
    return { ...made, opened, started, sittingId: opened.sittingId };
  }
  const answer = (service, sittingId, item, response) => service.respond({ userId: 'test-learner', sittingId, itemId: item.id, response });
  const events = (logger, level, name) => logger[level].mock.calls.filter(([event]) => event === name);

  it('leaving mid-run keeps progress; a new sitting resumes each word at its step (Task 3, Review Focus 4)', async () => {
    const store = dictationStore();
    const { service, started, sittingId } = await begin({ store });
    const first = started.item;
    await answer(service, sittingId, first, { choice: '가위' });
    expect(store.s.progress.words.gawi.step).toBe('copy');
    await service.close({ userId: 'test-learner', sittingId, reason: 'leave' });
    const reopened = await service.open({ userId: 'test-learner', deckId: DECK });
    const again = await service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId: reopened.sittingId });
    expect(store.s.progress.words.gawi.step).toBe('copy');
    expect(again.dictation).toMatchObject({ week: WEEK, remaining: 2 });
    expect(again.item).toMatchObject({ wordId: 'gawi', dictationStep: 'copy' });
  });
  it('Stop for now logs dictation.exited (reason stop) and serves the regular ladder in the same sitting', async () => {
    const store = dictationStore();
    const { service, started, sittingId, logger } = await begin({ store });
    const out = await answer(service, sittingId, started.item, { stop: true });
    expect(out.result).toEqual({ stopped: true });
    expect(out.item.source).not.toBe('dictation');
    expect(events(logger, 'info', 'school.card-ladder.dictation.exited')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, sittingId, reason: 'stop' });
  });
  it('the launch card names the dictation: "Dictation: N words left" (audit placement 2)', async () => {
    const store = dictationStore();
    const { service } = makeD({ store });
    await service.open({ userId: 'test-learner', deckId: DECK });
    const status = await service.dayStatus({ userId: 'test-learner', deckId: DECK });
    expect(status.description).toMatch(/Dictation: 2 words left$/);
  });
  it('the launch card says nothing about dictation with no week tagged', async () => {
    const store = dictationStore();
    const { service } = make({ media: true, store });
    await service.open({ userId: 'test-learner', deckId: DECK });
    const status = await service.dayStatus({ userId: 'test-learner', deckId: DECK });
    expect(String(status.description ?? '')).not.toMatch(/Dictation/);
  });
  it('adminWords carries the week (count warning, waiting words) and step + blind passes for list words only (Task 5)', async () => {
    const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 1 } } } });
    const teacher = { teacherGate: { assert: vi.fn() }, judgementCache: { get: vi.fn(() => null), set: vi.fn() } };
    const { service } = makeD({ store, list: ['gawi'], ...teacher });
    const out = await service.adminWords({ learnerId: 'test-learner', deckId: DECK, actorId: 'parent', pin: '1234' });
    expect(out.dictation).toMatchObject({ week: WEEK, count: 1, countWarning: true, total: 1, remaining: 1, done: false, needsRecording: [], unknown: [] });
    expect(out.words.find((w) => w.wordId === 'gawi').dictation).toEqual({ step: 'blind', blindPasses: 1, done: false });
    expect(out.words.find((w) => w.wordId === 'pul')).not.toHaveProperty('dictation');
  });
  it('adminWords says dictation: null with no week tagged', async () => {
    const store = dictationStore();
    const { service } = make({ media: true, store, teacherGate: { assert: vi.fn() }, judgementCache: { get: vi.fn(() => null), set: vi.fn() } });
    const out = await service.adminWords({ learnerId: 'test-learner', deckId: DECK, actorId: 'parent', pin: '1234' });
    expect(out.dictation).toBeNull();
    expect(out.words.some((w) => 'dictation' in w)).toBe(false);
  });
  it('a finished week can be reviewed: blind straight away, one correct write per word, ready — progress never written (final review I2)', async () => {
    const finished = { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 2 }, pul: { step: 'blind', blindPasses: 2 } } };
    const store = dictationStore({ progress: finished });
    const { service, logger } = makeD({ store });
    const opened = await service.open({ userId: 'test-learner', deckId: DECK });
    const plain = await service.startDictation({ learnerId: 'test-learner', sittingId: opened.sittingId });
    expect(plain).toMatchObject({ done: true });
    const started = await service.startDictation({ learnerId: 'test-learner', sittingId: opened.sittingId, review: true });
    expect(started.item).toMatchObject({ type: 'drill', step: 'dictation', dictationStep: 'blind', source: 'dictation' });
    expect(JSON.stringify(started.item)).not.toContain('가위');
    let item = started.item;
    const write = async (typed) => ({ item } = await answer(service, opened.sittingId, item, { typed }));
    await write('틀림');
    expect(item).toMatchObject({ wordId: started.item.wordId, dictationStep: 'copy' });
    await write(lexicon.entries.get(item.wordId).term);
    await write(lexicon.entries.get(item.wordId).term);
    await write(lexicon.entries.get(item.wordId).term);
    expect(item).toMatchObject({ type: 'dictation-ready', ready: true });
    expect(store.s.progressWrites).toEqual([]);
    expect(events(logger, 'info', 'school.card-ladder.dictation.started').at(-1)[1]).toMatchObject({ review: true });
  });
  it('the intro and launch card probe only the tagged words\' term audio, never the whole lexicon (final review M3)', async () => {
    const probed = [];
    const store = dictationStore();
    const { service } = makeD({ store, list: ['gawi'], media: (id) => { probed.push(id); return true; } });
    await service.intro({ userId: 'test-learner', deckId: DECK });
    expect(probed.length).toBeGreaterThan(0);
    expect(probed.every((id) => /\/gawi\/term\./.test(id))).toBe(true);
  });
  it('the launch card says when the only words left are waiting for a grown-up (final review I3)', async () => {
    const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 2 } } } });
    const { service } = makeD({ store, media: (id) => !/\/pul\//.test(id) });
    await service.open({ userId: 'test-learner', deckId: DECK });
    const status = await service.dayStatus({ userId: 'test-learner', deckId: DECK });
    expect(status.description).toMatch(/Dictation: 1 word waiting for a grown-up$/);
  });
  it('intro carries the week\'s dictation summary for the start card (Task 3)', async () => {
    const store = dictationStore();
    const { service } = makeD({ store });
    const intro = await service.intro({ userId: 'test-learner', deckId: DECK });
    expect(intro.dictation).toMatchObject({ week: WEEK, total: 2, remaining: 2, done: false, ready: false, count: 2, countWarning: true, needsRecording: [], unknown: [] });
  });
  it('intro has no dictation field when no lexicon entry carries a week tag', async () => {
    const store = dictationStore();
    const { service } = make({ media: true, store });
    const intro = await service.intro({ userId: 'test-learner', deckId: DECK });
    expect(intro).not.toHaveProperty('dictation');
  });
  it('intro reports a corrupt progress file instead of a summary, and never throws', async () => {
    const store = dictationStore({ fileState: { progress: 'corrupt' } });
    const { service } = makeD({ store });
    const intro = await service.intro({ userId: 'test-learner', deckId: DECK });
    expect(intro.dictation).toMatchObject({ week: WEEK, unavailable: 'corrupt' });
  });
  it('starts before the daily goal on a D.1 pick: term audio, term choices including the answer', async () => {
    const store = dictationStore();
    const { started, logger } = await begin({ store });
    expect(store.s.days[TODAY].doneAt).toBeNull();
    expect(started.item).toMatchObject({ type: 'choice', task: 'D.1', source: 'dictation', wordId: 'gawi' });
    expect(started.item.assets.audio).toMatch(/words\/week-01\/gawi\/term\.mp3$/);
    expect(started.item.choices).toContain('가위');
    expect(started.item.choices).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(started.progress.phase).toBe('dictation');
    expect(started.dictation).toMatchObject({ week: WEEK, total: 2, remaining: 2, done: false, needsRecording: [], unknown: [] });
    expect(events(logger, 'info', 'school.card-ladder.dictation.started')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, remaining: 2 });
  });

  it('answers add no active time and leave the goal alone; attempts are day-file items', async () => {
    const store = dictationStore();
    const { service, started, sittingId, logger } = await begin({ store });
    const activeMs = store.s.days[TODAY].activeMs;
    const lastInputAt = store.s.days[TODAY].lastInputAt;
    const out = await answer(service, sittingId, started.item, { choice: '가위' });
    expect(out.dictation).toMatchObject({ step: 'match', pass: true, remaining: 2, done: false });
    const day = store.s.days[TODAY];
    expect(day.activeMs).toBe(activeMs);
    // The regular clock's reference moves past the dictation answer (fix round 1), adding nothing.
    expect(day.lastInputAt).toBeGreaterThan(lastInputAt ?? 0);
    expect(day.doneAt).toBeNull();
    expect(day.items[started.item.id]).toMatchObject({ wordId: 'gawi', task: 'D.1', source: 'dictation', result: { correct: true } });
    expect(store.s.progress).toMatchObject({ week: WEEK, words: { gawi: { step: 'copy', blindPasses: 0 } } });
    expect(events(logger, 'info', 'school.card-ladder.dictation.attempt')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, wordId: 'gawi', step: 'match', pass: true, dontKnow: false });
  });

  it('a correct copy moves the word to blind; a blind miss moves it back to copy with no answer text, and serves that copy next', async () => {
    const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'copy', blindPasses: 0 }, pul: { step: 'blind', blindPasses: 0 } } } });
    const { service, started, sittingId } = await begin({ store });
    expect(started.item).toMatchObject({ type: 'drill', step: 'copy', wordId: 'gawi', word: { term: '가위' } });
    expect(started.item.word.media.audio).toMatch(/gawi\/term\.mp3$/);
    const copied = await answer(service, sittingId, started.item, { typed: '가위' });
    expect(copied.dictation).toMatchObject({ step: 'copy', pass: true });
    expect(store.s.progress.words.gawi.step).toBe('blind');
    const blind = copied.item;
    expect(blind).toMatchObject({ type: 'drill', step: 'dictation', wordId: 'pul', dictationStep: 'blind' });
    expect(blind.assets.audio).toMatch(/pul\/term\.mp3$/);
    expect(JSON.stringify(blind)).not.toContain('풀');
    const missed = await answer(service, sittingId, blind, { typed: '불' });
    expect(missed.dictation).toMatchObject({ step: 'blind', pass: false, done: false });
    expect(JSON.stringify(missed.result)).not.toContain('풀');
    expect(store.s.progress.words.pul).toMatchObject({ step: 'copy', blindPasses: 0 });
    // Audit #3: the same word comes straight back, at copy, where it is shown.
    expect(missed.item).toMatchObject({ type: 'drill', step: 'copy', wordId: 'pul', word: { term: '풀' } });
  });

  it('a mixed-script answer is a miss, never a crash', async () => {
    const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 0 } } } });
    const { service, sittingId } = await begin({ store });
    const item = (await service.get({ userId: 'test-learner', sittingId })).item;
    // The first not-done word in list order is served first: gawi, at blind.
    expect(item.wordId).toBe('gawi');
    const out = await answer(service, sittingId, item, { typed: '가wi' });
    expect(out.result.correct).toBe(false);
    expect(store.s.progress.words.gawi.step).toBe('copy');
  });

  it('two blind passes per word end the run on an explicit ready item and one done log', async () => {
    const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 1 }, pul: { step: 'blind', blindPasses: 1 } } } });
    const { service, started, sittingId, logger } = await begin({ store });
    const first = await answer(service, sittingId, started.item, { typed: '가위' });
    expect(first.dictation).toMatchObject({ done: false, remaining: 1 });
    const second = await answer(service, sittingId, first.item, { typed: '풀' });
    expect(second.dictation).toMatchObject({ step: 'blind', pass: true, remaining: 0, done: true });
    expect(second.item).toMatchObject({ type: 'dictation-ready', ready: true, week: WEEK });
    expect(events(logger, 'info', 'school.card-ladder.dictation.done')).toHaveLength(1);
    expect(events(logger, 'info', 'school.card-ladder.dictation.done')[0][1]).toEqual({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK });
    // Replaying the last answer is not a second finish.
    await answer(service, sittingId, first.item, { typed: '풀' }).catch(() => null);
    expect(events(logger, 'info', 'school.card-ladder.dictation.done')).toHaveLength(1);
    expect(store.s.days[TODAY].doneAt).toBeNull();
    // A done list does not start again.
    expect(await service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId })).toMatchObject({ done: true });
  });

  it('refuses at entry when the progress file is corrupt', async () => {
    const made = makeD({ store: dictationStore({ fileState: { progress: 'corrupt' } }) });
    const opened = await made.service.open({ userId: 'test-learner', deckId: DECK });
    await expect(made.service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId: opened.sittingId })).rejects.toThrow(/unreadable/);
    expect(events(made.logger, 'warn', 'school.card-ladder.dictation.corrupt')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', progress: 'corrupt' });
  });

  it('refuses with no tagged week, and on another package', async () => {
    const made = makeD({ list: [], store: dictationStore() });
    const opened = await made.service.open({ userId: 'test-learner', deckId: DECK });
    await expect(made.service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId: opened.sittingId })).rejects.toThrow(/no dictation/i);
    await expect(made.service.startDictation({ learnerId: 'test-learner', package: 'other', sittingId: opened.sittingId })).rejects.toThrow(/package/);
  });

  it('reports needs-recording words and warns on each tagged word outside the deck (unknown) at start', async () => {
    const base = { ...lexicon, entries: new Map([...lexicon.entries, ['ghost', { id: 'ghost', group: 'week-01', term: '유령', gloss: 'Ghost', kind: 'word', decoys: { term: ['a', 'b', 'c'], gloss: ['x', 'y', 'z'] } }]]) };
    const store = dictationStore();
    const { started, logger } = await begin({ store, lexiconData: tagged(['gawi', 'ghost', 'pul'], { base }), media: (id) => !id.includes('/pul/') });
    expect(started.dictation).toMatchObject({ total: 1, remaining: 1, needsRecording: ['pul'], unknown: ['ghost'] });
    expect(events(logger, 'warn', 'school.card-ladder.dictation.unknown-word').map(([, data]) => data)).toEqual([
      { learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, wordId: 'ghost' },
    ]);
  });

  it('writes progress under the list week and drops another week\'s rows', async () => {
    const store = dictationStore({ progress: { week: '2026-W45', words: { pul: { step: 'blind', blindPasses: 1 } } } });
    const { service, started, sittingId } = await begin({ store });
    await answer(service, sittingId, started.item, { choice: '가위' });
    expect(store.s.progress).toEqual({ week: WEEK, words: { gawi: { step: 'copy', blindPasses: 0, lastAttemptAt: expect.any(String) } } });
  });

  it('another sitting of the same day keeps the regular ladder', async () => {
    const store = dictationStore();
    const { service } = await begin({ store });
    const other = await service.open({ userId: 'test-learner', deckId: DECK });
    expect(other.item.source).not.toBe('dictation');
    expect(other.progress.phase).not.toBe('dictation');
  });

  it('a regular answer right after a dictation stretch credits no dictation time', async () => {
    const store = dictationStore();
    const { service, advance } = makeD({ store });
    const regular = await service.open({ userId: 'test-learner', deckId: DECK });
    // One regular answer starts the goal clock.
    const seen = await answer(service, regular.sittingId, regular.item, { seen: true });
    const dictating = await service.open({ userId: 'test-learner', deckId: DECK });
    const started = await service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId: dictating.sittingId });
    advance(40000);
    await answer(service, dictating.sittingId, started.item, { choice: '가위' });
    const before = store.s.days[TODAY].activeMs;
    await answer(service, regular.sittingId, seen.item, { typed: '가위' });
    expect(store.s.days[TODAY].activeMs - before).toBeLessThan(20000);
  });

  it('D.1 keeps a lone authored decoy and borrows list words of any kind to make four choices', async () => {
    const entries = new Map([
      ['gawi', { id: 'gawi', group: 'week-01', term: '가위', gloss: 'Scissors', kind: 'word', decoys: { term: ['가이'], gloss: ['x', 'y', 'z'] } }],
      ['pul', { id: 'pul', group: 'week-01', term: '풀', gloss: 'Glue', kind: 'word', decoys: { term: [], gloss: ['u', 'v', 'w'] } }],
      ['saram', { id: 'saram', group: 'week-01', term: '사람 들', gloss: 'People', kind: 'phrase', decoys: { term: [], gloss: ['p', 'q', 'r'] } }],
      ['mul', { id: 'mul', group: 'week-01', term: '물', gloss: 'Water', kind: 'word', decoys: { term: [], gloss: ['m', 'n', 'o'] } }],
    ]);
    const lex = tagged(['gawi', 'pul', 'saram'], { base: { ...lexicon, entries } });
    const store = dictationStore();
    const { started, service, sittingId } = await begin({ store, lexiconData: lex, decks: decksWith(['gawi', 'pul', 'saram', 'mul']) });
    expect(started.item.wordId).toBe('gawi');
    expect(started.item.choices).toHaveLength(4);
    expect(started.item.choices).toEqual(expect.arrayContaining(['가위', '가이', '풀', '사람 들']));
    // pul has no authored decoys: other list words of any kind, then the lexicon fill it to four.
    const next = await answer(service, sittingId, started.item, { choice: '가위' });
    expect(next.item.wordId).toBe('pul');
    expect(next.item.choices).toHaveLength(4);
    expect(new Set(next.item.choices).size).toBe(4);
    expect(next.item.choices.filter((c) => c === '풀')).toHaveLength(1);
    expect(next.item.choices).toEqual(expect.arrayContaining(['풀', '가위', '사람 들', '물']));
  });

  // ── Task 2b: week tags and the UX audit's server fixes.
  describe('Task 2b', () => {
    const TEN = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9'];
    const tenLexicon = () => ({
      ...lexicon,
      entries: new Map(TEN.map((id, i) => [id, { id, group: 'week-01', term: `낱말${i}`, gloss: `Word ${i}`, kind: 'word', decoys: { term: [`가${i}`, `나${i}`, `다${i}`], gloss: ['x', 'y', 'z'] }, dictation: [WEEK] }])),
    });

    it('#1 reads the list from the newest week tag, never a per-learner list file; warns when the count is not ten', async () => {
      const lex = tagged(['pul', 'gawi']);
      lex.entries.set('gawi', { ...lex.entries.get('gawi'), dictation: ['2026-W45'] });
      const store = dictationStore();
      const { started, logger } = await begin({ store, lexiconData: lex });
      expect(started.dictation).toMatchObject({ week: WEEK, total: 1, count: 1, countWarning: true });
      expect(started.item.wordId).toBe('pul');
      expect(events(logger, 'warn', 'school.card-ladder.dictation.count')[0][1]).toMatchObject({ package: 'korean-vocab', week: WEEK, count: 1 });
    });

    it('#1 a ten-word week does not warn', async () => {
      const { started, logger } = await begin({ store: dictationStore(), lexiconData: tenLexicon(), decks: decksWith(TEN) });
      expect(started.dictation).toMatchObject({ total: 10, count: 10, countWarning: false });
      expect(events(logger, 'warn', 'school.card-ladder.dictation.count')).toHaveLength(0);
    });

    it('#2 a miss re-serves the same word at its new step; only a pass moves to another word', async () => {
      const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'copy', blindPasses: 0 } } } });
      const { service, started, sittingId } = await begin({ store });
      expect(started.item).toMatchObject({ wordId: 'gawi', dictationStep: 'copy' });
      const missed = await answer(service, sittingId, started.item, { typed: '가이' });
      expect(missed.item).toMatchObject({ wordId: 'gawi', dictationStep: 'match', task: 'D.1' });
      const passed = await answer(service, sittingId, missed.item, { choice: '가위' });
      expect(passed.item.wordId).toBe('pul');
    });

    it('#3 the finishing answer serves a dictation-ready item; { done: true } returns the sitting to its ladder', async () => {
      const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 1 }, pul: { step: 'blind', blindPasses: 2 } } } });
      const { service, started, sittingId, logger } = await begin({ store });
      const last = await answer(service, sittingId, started.item, { typed: '가위' });
      expect(last.item).toEqual({
        id: expect.stringMatching(/:ready$/), type: 'dictation-ready', source: 'dictation', week: WEEK,
        ready: true, wordCount: 2, wordsDone: 2, needsRecording: [], unknown: [],
      });
      expect(last.progress.phase).toBe('dictation');
      // A reload of the sitting still sees the ending.
      expect((await service.get({ userId: 'test-learner', sittingId })).item.type).toBe('dictation-ready');
      const back = await answer(service, sittingId, last.item, { done: true });
      expect(back.item.source).not.toBe('dictation');
      expect(back.progress.phase).not.toBe('dictation');
      expect(events(logger, 'info', 'school.card-ladder.dictation.ready-seen')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, ready: true });
    });

    it('#4 excluded words: the run and answers carry them, the ending is not ready, and a re-start is not "done"', async () => {
      const store = dictationStore({ progress: { week: WEEK, words: { gawi: { step: 'blind', blindPasses: 1 } } } });
      const { service, started, sittingId } = await begin({ store, media: (id) => !id.includes('/pul/') });
      expect(started.dictation).toMatchObject({ total: 1, needsRecording: ['pul'], unknown: [], done: false });
      const last = await answer(service, sittingId, started.item, { typed: '가위' });
      expect(last.dictation).toMatchObject({ remaining: 0, done: false, needsRecording: ['pul'], unknown: [] });
      expect(last.item).toMatchObject({ type: 'dictation-ready', ready: false, needsRecording: ['pul'] });
      await answer(service, sittingId, last.item, { done: true });
      const again = await service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId });
      expect(again).toMatchObject({ done: false, dictation: { remaining: 0, done: false, needsRecording: ['pul'] } });
      expect(again.item).toBeUndefined();
    });

    it('#4 an all-excluded list is never ready and opens no run', async () => {
      const { started } = await begin({ store: dictationStore(), media: false });
      expect(started).toMatchObject({ done: false, dictation: { total: 0, done: false, needsRecording: ['gawi', 'pul'] } });
      expect(started.item).toBeUndefined();
    });

    it('#5 a retag mid-run answers { dictation: { replaced: true } }, records nothing for the old week, and a restart serves the new week', async () => {
      const lex = tagged(['gawi', 'pul']);
      const store = dictationStore();
      const { service, started, sittingId, logger } = await begin({ store, lexiconData: lex });
      for (const id of ['gawi', 'pul']) lex.entries.get(id).dictation = ['2026-W47'];
      const out = await answer(service, sittingId, started.item, { choice: '가위' });
      expect(out.dictation).toEqual({ replaced: true, week: '2026-W47', previousWeek: WEEK });
      expect(out.item.source).not.toBe('dictation');
      expect(store.s.progressWrites).toHaveLength(0);
      expect(store.s.days[TODAY].items[started.item.id]).toBeUndefined();
      expect(store.s.days[TODAY].dictation).toMatchObject({ ended: 'replaced' });
      expect(events(logger, 'warn', 'school.card-ladder.dictation.replaced')[0][1]).toMatchObject({ learnerId: 'test-learner', package: 'korean-vocab', week: WEEK, listWeek: '2026-W47', itemId: started.item.id });
      const restarted = await service.startDictation({ learnerId: 'test-learner', package: 'korean-vocab', sittingId });
      expect(restarted.dictation.week).toBe('2026-W47');
      expect(restarted.item.source).toBe('dictation');
    });

    it('#5 tags removed mid-run also answer replaced (week null)', async () => {
      const lex = tagged(['gawi', 'pul']);
      const { service, started, sittingId } = await begin({ store: dictationStore(), lexiconData: lex });
      for (const id of ['gawi', 'pul']) delete lex.entries.get(id).dictation;
      const out = await answer(service, sittingId, started.item, { choice: '가위' });
      expect(out.dictation).toEqual({ replaced: true, week: null, previousWeek: WEEK });
    });

    it('#6 public items hear the word and carry the dictation header', async () => {
      const store = dictationStore({ progress: { week: WEEK, words: { pul: { step: 'copy', blindPasses: 0 } } } });
      const { service, started, sittingId } = await begin({ store });
      expect(started.item).toMatchObject({ task: 'D.1', channel: 'hear', listen: true, wordIndex: 1, wordCount: 2, wordsDone: 0 });
      expect(started.item.assets.audio).toMatch(/gawi\/term\.mp3$/);
      const next = await answer(service, sittingId, started.item, { choice: '가위' });
      expect(next.item).toMatchObject({ wordId: 'pul', step: 'copy', channel: 'hear', listen: true, wordIndex: 2, wordCount: 2, wordsDone: 0 });
    });
  });
});
