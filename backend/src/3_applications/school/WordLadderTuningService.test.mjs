// backend/src/3_applications/school/WordLadderTuningService.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, emptyDay, emptyStatusV3, emptyTuning } from '#domains/school/wordLadder/index.mjs';
import { WordLadderTuningService } from './WordLadderTuningService.mjs';

const DECK = 'language/korean/week-01';
const PKG = 'korean-vocab';
const NOW = Date.parse('2026-09-22T16:00:00-07:00'); // study day 2026-09-22
const YESTERDAY = '2026-09-21';

/** A finished study day: one sitting closed on `reason`, `quizzed` words quizzed (all passed). */
function studyDay(day, { reason = 'goal', doneAt = `${day}T16:10:00-07:00`, quizzed = 3 } = {}) {
  const words = ['gawi', 'pul', 'jaw'].slice(0, quizzed);
  return {
    ...emptyDay(day),
    atOpen: { dueRechecks: [], tricky: [], newAllowance: 2, settings: structuredClone(DEFAULT_SETTINGS) },
    doneAt,
    activeMs: 8 * 60000,
    rounds: quizzed ? [{ index: 1, phase: 'done', words, stream: { latest: {} }, quiz: { passed: words, failed: [] } }] : [],
    sittings: { [`${PKG}.live.a`]: { deckId: DECK, openedAt: `${day}T16:00:00-07:00`, closedAt: `${day}T16:10:00-07:00`, reason } },
  };
}

function memoryStore({ days = {}, tuning = emptyTuning() } = {}) {
  const s = { status: emptyStatusV3(), days, tuning, writes: [] };
  return {
    s,
    readStatus: () => structuredClone(s.status),
    readDay: (_u, _p, d) => structuredClone(s.days[d] ?? emptyDay(d)),
    listDays: () => Object.keys(s.days).sort(),
    readTuning: () => structuredClone(s.tuning),
    tuningState: () => s.tuningState ?? 'ok',
    writeTuning: vi.fn((_u, _p, next) => { s.tuning = structuredClone({ ...next, history: next.history.slice(-60) }); s.writes.push(next); return next; }),
  };
}

function make({ store = memoryStore(), tuner = undefined, notify = vi.fn(async () => {}), programs = null, bounds = null } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const rows = programs ?? [{ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } }];
  const service = new WordLadderTuningService({
    store,
    assignments: {
      get: async (id) => (id === 'test-learner' ? { learnerId: id, programs: rows } : null),
      list: async () => [{ learnerId: 'test-learner', programs: rows }, { learnerId: 'other-learner', programs: [{ programId: 'flashcards', deckId: 'x', policy: { mode: 'classic' } }] }],
    },
    decks: { getFlashcardDeck: async (id) => (id === DECK ? { id: DECK, words: ['gawi'], lexicon: 'media:lex.yml' } : null) },
    lexicons: { getLexicon: () => ({ package: PKG }) },
    tuner: tuner === undefined ? { tune: vi.fn(async () => ({ status: 'on-track', notes: ['Fine.'], changes: [] })) } : tuner,
    bounds,
    settings: () => structuredClone(DEFAULT_SETTINGS),
    notify, timezone: 'America/Los_Angeles', now: () => NOW, logger,
  });
  return { service, store, logger, notify };
}

const RUN = { learnerId: 'test-learner', pkg: PKG, deckId: DECK, day: YESTERDAY };

describe('WordLadderTuningService', () => {
  it('requires a store that can write tuning — a test-mode (shadow) store is refused', () => {
    const shadow = memoryStore();
    delete shadow.writeTuning;
    expect(() => make({ store: shadow })).toThrow(/writeTuning/);
  });

  describe('skip rules', () => {
    it('skips a day already tuned', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) }, tuning: { ...emptyTuning(), lastTunedDay: YESTERDAY } });
      const { service } = make({ store });
      expect(await service.runFor(RUN)).toMatchObject({ skipped: 'already-tuned' });
      expect(store.writeTuning).not.toHaveBeenCalled();
    });
    it('skips a day whose sittings only closed idle / unmount / leave with neither goal nor cap reached', async () => {
      for (const reason of ['idle', 'unmount', 'leave', null]) {
        const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { reason, doneAt: null }) } });
        const { service } = make({ store });
        expect(await service.runFor(RUN)).toMatchObject({ skipped: 'no-finished-sitting' });
        expect(store.writeTuning).not.toHaveBeenCalled();
      }
    });
    it('a day the server credited (doneAt) or capped qualifies whatever the close reason', async () => {
      const credited = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { reason: 'idle' }) } });
      expect(await make({ store: credited }).service.runFor(RUN)).toMatchObject({ status: 'on-track' });
      const capped = { ...studyDay(YESTERDAY, { reason: 'unmount', doneAt: null }), activeMs: 15 * 60000 };
      const cappedStore = memoryStore({ days: { [YESTERDAY]: capped } });
      expect(await make({ store: cappedStore }).service.runFor(RUN)).toMatchObject({ status: 'on-track' });
    });
    it('skips a corrupt tuning.yml before calling the model', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
      store.s.tuningState = 'corrupt';
      const tune = vi.fn();
      const { service } = make({ store, tuner: { tune } });
      expect(await service.runFor(RUN)).toMatchObject({ skipped: 'corrupt' });
      expect(tune).not.toHaveBeenCalled();
      expect(store.writeTuning).not.toHaveBeenCalled();
    });
    it('a cap close triggers', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { reason: 'cap' }) } });
      const { service } = make({ store });
      expect(await service.runFor(RUN)).toMatchObject({ status: 'on-track' });
    });
    it('never tunes a day that has not ended', async () => {
      const store = memoryStore({ days: { '2026-09-22': studyDay('2026-09-22') } });
      const { service } = make({ store });
      expect(await service.runFor({ ...RUN, day: '2026-09-22' })).toMatchObject({ skipped: 'day-not-ended' });
    });
  });

  it('applies a braked proposal, persists tuning.yml, logs each change and each dropped proposal', async () => {
    const days = { '2026-09-19': studyDay('2026-09-19'), '2026-09-20': studyDay('2026-09-20'), [YESTERDAY]: studyDay(YESTERDAY) };
    const store = memoryStore({ days, tuning: { ...emptyTuning(), values: { 'review.gapScale': 1.1 }, lastChanged: { 'review.gapScale': '2026-09-20' } } });
    const tune = vi.fn(async () => ({
      status: 'coasting', notes: ['Passing everything.'],
      changes: [
        { setting: 'round.size', to: 6, reason: 'all passed' },
        { setting: 'review.gapScale', to: 1.2, reason: 'longer gaps' },
        { setting: 'session.capMinutes', to: 20, reason: 'more time' },
      ],
    }));
    const { service, logger, notify } = make({ store, tuner: { tune } });
    const out = await service.runFor(RUN);
    const digest = tune.mock.calls[0][0];
    expect(digest.day).toBe(YESTERDAY);
    expect(digest.settings).toMatchObject({ 'round.size': 5, 'review.gapScale': 1.1 });
    expect(digest.trailing7.days).toBe(2);
    expect(out.applied).toEqual([{ setting: 'round.size', from: 5, to: 6, reason: 'all passed' }]);
    expect(out.dropped.map((d) => [d.setting, d.brake])).toEqual([['review.gapScale', 'dwell'], ['session.capMinutes', 'not-tunable']]);
    expect(store.s.tuning).toMatchObject({
      values: { 'review.gapScale': 1.1, 'round.size': 6 },
      lastChanged: { 'review.gapScale': '2026-09-20', 'round.size': YESTERDAY },
      lastTunedDay: YESTERDAY,
    });
    expect(store.s.tuning.history.at(-1)).toMatchObject({ day: YESTERDAY, status: 'coasting', notes: ['Passing everything.'], applied: out.applied });
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning', {
      learnerId: 'test-learner', package: PKG, day: YESTERDAY, setting: 'round.size', from: 5, to: 6, reason: 'all passed',
    });
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning', expect.objectContaining({
      setting: 'review.gapScale', from: 1.1, to: 1.2, dropped: 'dwell',
    }));
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning', expect.objectContaining({ setting: 'session.capMinutes', dropped: 'not-tunable' }));
    expect(notify).not.toHaveBeenCalled();
    // A second run for the same day is a no-op.
    expect(await service.runFor(RUN)).toMatchObject({ skipped: 'already-tuned' });
    expect(tune).toHaveBeenCalledTimes(1);
  });

  it('dwell counts the study days the learner actually studied', async () => {
    // Changed on 09-10; only 4 study days since (09-12, 09-15, 09-18, 09-21) → still in dwell.
    const days = Object.fromEntries(['2026-09-10', '2026-09-12', '2026-09-15', '2026-09-18', YESTERDAY].map((d) => [d, studyDay(d)]));
    const store = memoryStore({ days, tuning: { ...emptyTuning(), lastChanged: { 'round.size': '2026-09-10' } } });
    const { service } = make({ store, tuner: { tune: async () => ({ status: 'coasting', notes: [], changes: [{ setting: 'round.size', to: 6, reason: 'r' }] }) } });
    expect((await service.runFor(RUN)).dropped).toEqual([expect.objectContaining({ setting: 'round.size', brake: 'dwell' })]);
  });

  it('concern pushes through the notify port', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const { service, notify } = make({ store, tuner: { tune: async () => ({ status: 'concern', notes: ['Guessing through quizzes.'], changes: [] }) } });
    await service.runFor(RUN);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'test-learner', package: PKG, deckId: DECK, day: YESTERDAY, status: 'concern', notes: ['Guessing through quizzes.'] }));
  });

  it('a failing notify is logged and never loses the tuning write', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const { service, logger } = make({ store, notify: async () => { throw new Error('push down'); }, tuner: { tune: async () => ({ status: 'concern', notes: ['x'], changes: [] }) } });
    await service.runFor(RUN);
    expect(store.s.tuning.lastTunedDay).toBe(YESTERDAY);
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-notify-failed', expect.objectContaining({ error: 'push down' }));
  });

  it('model failure → no changes, logged, the day is marked so it is not retried every tick', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) }, tuning: { ...emptyTuning(), values: { 'round.size': 6 } } });
    const { service, logger, notify } = make({ store, tuner: { tune: async () => { throw new Error('invalid tuner output: nope'); } } });
    const out = await service.runFor(RUN);
    expect(out).toMatchObject({ status: null, notes: [], applied: [], error: 'invalid tuner output: nope' });
    expect(store.s.tuning.values).toEqual({ 'round.size': 6 });
    expect(store.s.tuning.lastTunedDay).toBe(YESTERDAY);
    expect(store.s.tuning.history.at(-1)).toMatchObject({ day: YESTERDAY, status: null, notes: [], error: 'invalid tuner output: nope', applied: [] });
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-failed', expect.objectContaining({ learnerId: 'test-learner', day: YESTERDAY, error: 'invalid tuner output: nope' }));
    expect(notify).not.toHaveBeenCalled();
  });

  describe('no model (tuner disabled)', () => {
    it('writes a deterministic note and changes nothing', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
      const { service, notify } = make({ store, tuner: null });
      const out = await service.runFor(RUN);
      expect(out).toMatchObject({ status: 'on-track', applied: [], dropped: [] });
      expect(store.s.tuning).toMatchObject({ values: {}, lastChanged: {}, lastTunedDay: YESTERDAY });
      const { notes } = store.s.tuning.history.at(-1);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/no model/i);
      expect(notify).not.toHaveBeenCalled();
    });
    it('a day credited with zero quizzed words is a concern, and pushes', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { quizzed: 0 }) } });
      const { service, notify } = make({ store, tuner: null });
      expect(await service.runFor(RUN)).toMatchObject({ status: 'concern', applied: [] });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'concern' }));
    });
  });

  describe('pending', () => {
    it('lists a learner whose previous study day finished and is after lastTunedDay', async () => {
      const store = memoryStore({ days: { '2026-09-19': studyDay('2026-09-19'), [YESTERDAY]: studyDay(YESTERDAY), '2026-09-22': studyDay('2026-09-22') }, tuning: { ...emptyTuning(), lastTunedDay: '2026-09-19' } });
      const { service } = make({ store });
      expect(await service.pending({ now: NOW })).toEqual([{ learnerId: 'test-learner', pkg: PKG, deckId: DECK, day: YESTERDAY }]);
    });
    it('the previous study day is the last day studied before today, not the calendar yesterday', async () => {
      const store = memoryStore({ days: { '2026-09-18': studyDay('2026-09-18') } });
      const { service } = make({ store });
      expect(await service.pending({ now: NOW })).toEqual([{ learnerId: 'test-learner', pkg: PKG, deckId: DECK, day: '2026-09-18' }]);
    });
    it('omits a tuned day, an unfinished day and a learner with no study days', async () => {
      const tuned = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) }, tuning: { ...emptyTuning(), lastTunedDay: YESTERDAY } });
      expect(await make({ store: tuned }).service.pending({ now: NOW })).toEqual([]);
      const idle = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { reason: 'idle', doneAt: null }) } });
      expect(await make({ store: idle }).service.pending({ now: NOW })).toEqual([]);
      expect(await make({ store: memoryStore() }).service.pending({ now: NOW })).toEqual([]);
    });
    it('one package per learner even with two decks in it; an unloadable deck is skipped and logged', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
      const programs = [
        { programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } },
        { programId: 'flashcards', corpusId: DECK, policy: { mode: 'word-ladder' } },
        { programId: 'flashcards', deckId: 'gone', policy: { mode: 'word-ladder' } },
      ];
      const { service, logger } = make({ store, programs });
      expect(await service.pending({ now: NOW })).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-deck-skipped', expect.objectContaining({ deckId: 'gone' }));
    });
  });
});

describe('WordLadderTuningService — races and bounds (fix round 1)', () => {
  it('two overlapping runs for the same learner package: one model call, one write', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    let release;
    const tune = vi.fn(() => new Promise((resolve) => { release = () => resolve({ status: 'on-track', notes: [], changes: [] }); }));
    const { service } = make({ store, tuner: { tune } });
    const first = service.runFor(RUN);
    const second = service.runFor(RUN);
    await vi.waitFor(() => expect(tune).toHaveBeenCalled());
    release();
    const results = await Promise.all([first, second]);
    expect(tune).toHaveBeenCalledTimes(1);
    expect(store.writeTuning).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.skipped ?? 'ran').sort()).toEqual(['in-flight', 'ran']);
    // The guard is released afterwards.
    expect(await service.runFor(RUN)).toMatchObject({ skipped: 'already-tuned' });
  });
  it('re-reads tuning before writing: another writer that tuned the day wins, no second write', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const tune = vi.fn(async () => { store.s.tuning = { ...store.s.tuning, lastTunedDay: YESTERDAY }; return { status: 'coasting', notes: [], changes: [{ setting: 'round.size', to: 6, reason: 'r' }] }; });
    const { service } = make({ store, tuner: { tune } });
    expect(await service.runFor(RUN)).toMatchObject({ skipped: 'already-tuned' });
    expect(store.writeTuning).not.toHaveBeenCalled();
  });
  it('merges onto the fresh copy: a value written meanwhile is kept', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const tune = vi.fn(async () => {
      store.s.tuning = { ...store.s.tuning, values: { 'batch.workingSet': 8 }, lastChanged: { 'batch.workingSet': '2026-09-20' }, history: [{ day: '2026-09-20' }] };
      return { status: 'coasting', notes: [], changes: [{ setting: 'round.size', to: 6, reason: 'r' }] };
    });
    const { service } = make({ store, tuner: { tune } });
    await service.runFor(RUN);
    expect(store.s.tuning.values).toEqual({ 'batch.workingSet': 8, 'round.size': 6 });
    expect(store.s.tuning.lastChanged).toEqual({ 'batch.workingSet': '2026-09-20', 'round.size': YESTERDAY });
    expect(store.s.tuning.history.map((h) => h.day)).toEqual(['2026-09-20', YESTERDAY]);
  });
  it('clamps tuned values to the household bounds before digesting and braking', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) }, tuning: { ...emptyTuning(), values: { 'round.size': 7 } } });
    const tune = vi.fn(async () => ({ status: 'on-track', notes: [], changes: [] }));
    const { service } = make({ store, tuner: { tune }, bounds: { 'round.size': [3, 6] } });
    await service.runFor(RUN);
    expect(tune.mock.calls[0][0].settings['round.size']).toBe(6);
  });
});
