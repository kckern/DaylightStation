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

function make({ store = memoryStore(), tuner = undefined, notify = vi.fn(async () => ({ status: 'sent' })), programs = null, bounds = null, teacherGate = null, now = () => NOW } = {}) {
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
    notify, teacherGate, timezone: 'America/Los_Angeles', now, logger,
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

  it('a concern is recorded as an outstanding push; deliverPushes sends it through the notify port once', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const { service, notify } = make({ store, tuner: { tune: async () => ({ status: 'concern', notes: ['Guessing through quizzes.'], changes: [] }) } });
    await service.runFor(RUN);
    expect(notify).not.toHaveBeenCalled();
    expect(store.s.tuning.history.at(-1)).toMatchObject({ status: 'concern', notified: false, concernAt: new Date(NOW).toISOString() });
    await service.deliverPushes();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'test-learner', package: PKG, deckId: DECK, day: YESTERDAY, status: 'concern', notes: ['Guessing through quizzes.'] }));
    expect(store.s.tuning.history.at(-1)).toMatchObject({ notified: true });
    await service.deliverPushes();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a push suppressed by quiet hours stays pending and goes out on a later tick — exactly one push', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const notify = vi.fn().mockResolvedValueOnce({ status: 'suppressed' }).mockResolvedValue({ status: 'sent' });
    const { service, logger } = make({ store, notify, tuner: { tune: async () => ({ status: 'concern', notes: ['x'], changes: [] }) } });
    await service.runFor(RUN);
    await service.deliverPushes();
    expect(store.s.tuning.history.at(-1).notified).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning-push', expect.objectContaining({ status: 'suppressed', day: YESTERDAY }));
    await service.deliverPushes();
    expect(store.s.tuning.history.at(-1).notified).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning-push', expect.objectContaining({ status: 'sent' }));
    await service.deliverPushes();
    expect(notify.mock.calls.length).toBe(2); // one suppressed attempt + the one push that went out
  });

  it('a push that fails is warned and retried; the tuning write is never lost', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const notify = vi.fn().mockRejectedValueOnce(new Error('push down')).mockResolvedValue({ status: 'sent' });
    const { service, logger } = make({ store, notify, tuner: { tune: async () => ({ status: 'concern', notes: ['x'], changes: [] }) } });
    await service.runFor(RUN);
    await service.deliverPushes();
    expect(store.s.tuning.lastTunedDay).toBe(YESTERDAY);
    expect(store.s.tuning.history.at(-1).notified).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-push', expect.objectContaining({ status: 'failed', error: 'push down' }));
    await service.deliverPushes();
    expect(store.s.tuning.history.at(-1).notified).toBe(true);
  });

  it('a push still pending after 48h is dropped with a warn', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    let clock = NOW;
    const notify = vi.fn(async () => ({ status: 'suppressed' }));
    const { service, logger } = make({ store, notify, now: () => clock, tuner: { tune: async () => ({ status: 'concern', notes: ['x'], changes: [] }) } });
    await service.runFor(RUN);
    clock = NOW + 48 * 3600000 + 1;
    await service.deliverPushes();
    expect(notify).not.toHaveBeenCalled();
    expect(store.s.tuning.history.at(-1).notified).toBe('dropped');
    expect(logger.warn).toHaveBeenCalledWith('school.word-ladder.tuning-push', expect.objectContaining({ status: 'dropped' }));
  });

  it('without a notify port nothing is marked outstanding', async () => {
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) } });
    const { service } = make({ store, notify: null, tuner: { tune: async () => ({ status: 'concern', notes: ['x'], changes: [] }) } });
    await service.runFor(RUN);
    expect(Object.hasOwn(store.s.tuning.history.at(-1), 'notified')).toBe(false);
    await expect(service.deliverPushes()).resolves.toEqual([]);
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
      const entry = store.s.tuning.history.at(-1);
      expect(entry.model).toBe(false);
      expect(entry.notes.join(' ')).not.toMatch(/model/i);
      await service.deliverPushes();
      expect(notify).not.toHaveBeenCalled();
    });
    it('a day credited with zero quizzed words is a concern, and pushes', async () => {
      const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY, { quizzed: 0 }) } });
      const { service, notify } = make({ store, tuner: null });
      expect(await service.runFor(RUN)).toMatchObject({ status: 'concern', applied: [] });
      // Plain copy for a parent: no word about the model.
      expect(store.s.tuning.history.at(-1).notes).toEqual(['Credited with no words quizzed']);
      await service.deliverPushes();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'concern', notes: ['Credited with no words quizzed'] }));
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

describe('WordLadderTuningService — grown-up view and undo', () => {
  const gate = () => ({ assert: vi.fn(({ userId }) => { if (userId !== 'grown-up') throw Object.assign(new Error('not a teacher'), { status: 403 }); }) });
  const ADMIN = { learnerId: 'test-learner', deckId: DECK, actorId: 'grown-up', pin: null };
  const applied = (setting, from, to, over = {}) => ({ setting, from, to, reason: 'r', ...over });
  const tuned = () => ({
    ...emptyTuning(),
    values: { 'batch.newPerDay': 3, 'round.size': 6 },
    lastChanged: { 'batch.newPerDay': '2026-09-21', 'round.size': '2026-09-10' },
    lastTunedDay: '2026-09-21',
    history: [
      { day: '2026-09-10', status: 'coasting', notes: [], applied: [applied('round.size', 5, 6)], dropped: [] },
      { day: '2026-09-21', status: 'stuck', notes: ['Cap hit.'], applied: [applied('batch.newPerDay', 4, 3)], dropped: [{ setting: 'round.size', to: 7, reason: 'r', brake: 'dwell' }] },
    ],
  });

  it('the view is teacher-gated and shows current vs default, the last run and the history newest first', async () => {
    const teacherGate = gate();
    const { service } = make({ store: memoryStore({ tuning: tuned() }), teacherGate });
    await expect(service.adminTuning({ ...ADMIN, actorId: 'someone' })).rejects.toThrow(/not a teacher/);
    const view = await service.adminTuning(ADMIN);
    expect(teacherGate.assert).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'grown-up', action: 'word-ladder.tuning' }));
    expect(view.package).toBe(PKG);
    expect(view.settings.find((row) => row.setting === 'batch.newPerDay')).toMatchObject({ current: 3, default: 4, min: 2, max: 6, tuned: true });
    expect(view.settings.find((row) => row.setting === 'drill.afterMisses')).toMatchObject({ tuned: false });
    expect(view.last).toMatchObject({ day: '2026-09-21', status: 'stuck', notes: ['Cap hit.'] });
    expect(view.history.map((row) => row.day)).toEqual(['2026-09-21', '2026-09-10']);
    expect(view.history[0].applied[0]).toMatchObject({ setting: 'batch.newPerDay', undoable: true });
    expect(view.history[1].applied[0]).toMatchObject({ setting: 'round.size', undoable: true });
  });

  it('a learner not enrolled in the deck is refused', async () => {
    const { service } = make({ store: memoryStore({ tuning: tuned() }), teacherGate: gate() });
    await expect(service.adminTuning({ ...ADMIN, learnerId: 'other-learner' })).rejects.toThrow(/assignment/);
  });

  it('undo restores the previous value, marks the change undone, holds the dwell and logs a grown-up undo', async () => {
    const store = memoryStore({ tuning: tuned() });
    const { service, logger } = make({ store, teacherGate: gate() });
    const out = await service.adminUndo({ ...ADMIN, setting: 'round.size' });
    expect(out).toMatchObject({ setting: 'round.size', from: 6, to: 5 });
    const written = store.s.tuning;
    // Back to the default: the key is dropped so the setting follows config again.
    expect(Object.hasOwn(written.values, 'round.size')).toBe(false);
    expect(written.values['batch.newPerDay']).toBe(3);
    expect(written.lastChanged['round.size']).toBe('2026-09-22');
    expect(written.lastTunedDay).toBe('2026-09-21');
    expect(written.history[0].applied[0].undone).toEqual({ day: '2026-09-22', actorId: 'grown-up' });
    expect(written.history.at(-1)).toMatchObject({
      day: '2026-09-22', undo: true, actorId: 'grown-up', applied: [{ setting: 'round.size', from: 6, to: 5, reason: 'grown-up undo' }],
    });
    expect(logger.info).toHaveBeenCalledWith('school.word-ladder.tuning', expect.objectContaining({
      learnerId: 'test-learner', package: PKG, setting: 'round.size', from: 6, to: 5, reason: 'grown-up undo', actorId: 'grown-up',
    }));
    const view = await service.adminTuning(ADMIN);
    const undone = view.history.find((row) => row.day === '2026-09-10').applied[0];
    expect(undone).toMatchObject({ undoable: false, undone: { day: '2026-09-22' } });
    expect(view.history[0]).toMatchObject({ undo: true });
    expect(view.history[0].applied[0].undoable).toBe(false);
    expect(view.last.day).toBe('2026-09-21');
  });

  it('undo to a value that is not the default keeps it as a tuned value', async () => {
    const tuning = tuned();
    tuning.values['batch.newPerDay'] = 2;
    tuning.history.push({ day: '2026-09-22', status: 'stuck', notes: [], applied: [applied('batch.newPerDay', 3, 2)], dropped: [] });
    tuning.values['batch.newPerDay'] = 2;
    const store = memoryStore({ tuning });
    const { service } = make({ store, teacherGate: gate() });
    await service.adminUndo({ ...ADMIN, setting: 'batch.newPerDay' });
    expect(store.s.tuning.values['batch.newPerDay']).toBe(3);
  });

  it('refuses an undo with nothing to undo, a value changed since, an unknown setting, or a non-teacher', async () => {
    const teacherGate = gate();
    const store = memoryStore({ tuning: tuned() });
    const { service } = make({ store, teacherGate });
    await expect(service.adminUndo({ ...ADMIN, setting: 'drill.afterMisses' })).rejects.toThrow(/nothing to undo/i);
    await expect(service.adminUndo({ ...ADMIN, setting: 'session.capMinutes' })).rejects.toThrow(/not a tuned setting/i);
    await expect(service.adminUndo({ ...ADMIN, actorId: 'someone', setting: 'round.size' })).rejects.toThrow(/not a teacher/);
    store.s.tuning.values['round.size'] = 7;
    await expect(service.adminUndo({ ...ADMIN, setting: 'round.size' })).rejects.toThrow(/changed since/i);
    await service.adminUndo({ ...ADMIN, setting: 'batch.newPerDay' });
    await expect(service.adminUndo({ ...ADMIN, setting: 'batch.newPerDay' })).rejects.toThrow(/nothing to undo/i);
    expect(store.writeTuning).toHaveBeenCalledTimes(1);
  });

  it('an undo while a tuning run is in flight for the same learner package is refused', async () => {
    let release;
    const tune = vi.fn(() => new Promise((resolve) => { release = () => resolve({ status: 'on-track', notes: [], changes: [] }); }));
    const store = memoryStore({ days: { [YESTERDAY]: studyDay(YESTERDAY) }, tuning: { ...tuned(), lastTunedDay: '2026-09-20' } });
    const { service } = make({ store, tuner: { tune }, teacherGate: gate() });
    const run = service.runFor(RUN);
    await vi.waitFor(() => expect(tune).toHaveBeenCalled());
    await expect(service.adminUndo({ ...ADMIN, setting: 'round.size' })).rejects.toThrow(/in progress/i);
    release();
    await run;
    await expect(service.adminUndo({ ...ADMIN, setting: 'round.size' })).resolves.toMatchObject({ setting: 'round.size' });
  });

  it('no teacher gate: the grown-up routes are refused', async () => {
    const { service } = make({ store: memoryStore({ tuning: tuned() }) });
    await expect(service.adminTuning(ADMIN)).rejects.toThrow(/teacher gate/);
  });
});
