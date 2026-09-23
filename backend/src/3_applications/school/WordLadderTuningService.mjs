// backend/src/3_applications/school/WordLadderTuningService.mjs
/**
 * The word ladder's tuning pass (mastery redesign spec §7): once per learner
 * × word package per study day, after the day has ended — build the digest,
 * ask the tuner agent, let the domain brakes decide what actually changes,
 * persist `tuning.yml`, log every applied and dropped change, and push a
 * grown-up when the day reads as a concern.
 *
 * The values written here take effect at the learner's NEXT day's first open
 * (the sitting service captures settings into `atOpen.settings` once a day).
 *
 * Live only: the store must be able to write tuning, which a test-mode shadow
 * store cannot, so test mode can never trigger the tuner. With no tuner (no
 * model configured) the day still gets a deterministic status note and no
 * changes. A tuner failure changes nothing and still marks the day, so a
 * broken model costs one call per learner per day, not one per tick.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import {
  applyTuningProposal, buildTuningDigest, tunableValues, withTunedValues,
} from '#domains/school/wordLadder/index.mjs';

const DIGEST_DAYS = 8; // the day just ended + the 7-day trailing window
const FINISHED = new Set(['goal', 'cap']);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A day is tuned only when a sitting closed on its goal or its time cap. */
function finishedSitting(dayFile) {
  return Object.values(dayFile?.sittings ?? {}).some((row) => FINISHED.has(row?.reason));
}

/** Tuner off: a status note from the digest alone. */
function deterministicNote(digest) {
  const today = digest.today ?? {};
  if (today.credited && today.quizzed === 0) {
    return { status: 'concern', notes: 'Tuner has no model. The day was credited with no words quizzed.' };
  }
  return { status: 'on-track', notes: 'Tuner has no model; settings unchanged.' };
}

export class WordLadderTuningService {
  #store; #assignments; #decks; #lexicons; #tuner; #settings; #bounds; #notify; #timezone; #now; #logger; #dwellDays;

  constructor({
    store, assignments, decks, lexicons, tuner = null, settings, bounds = null, notify = null,
    timezone = null, now, logger = console, dwellDays = 5,
  } = {}) {
    for (const fn of ['readStatus', 'readDay', 'readTuning', 'writeTuning', 'listDays']) {
      if (typeof store?.[fn] !== 'function') throw new Error(`WordLadderTuningService requires store.${fn}()`);
    }
    if (typeof assignments?.get !== 'function' || typeof assignments?.list !== 'function') throw new Error('WordLadderTuningService requires assignments.get/list');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('WordLadderTuningService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('WordLadderTuningService requires lexicons.getLexicon');
    if (tuner !== null && typeof tuner?.tune !== 'function') throw new Error('WordLadderTuningService tuner must have tune()');
    if (notify !== null && typeof notify !== 'function') throw new Error('WordLadderTuningService notify must be a function');
    if (typeof settings !== 'function' || typeof now !== 'function') throw new Error('WordLadderTuningService requires settings() and now()');
    this.#store = store; this.#assignments = assignments; this.#decks = decks; this.#lexicons = lexicons;
    this.#tuner = tuner; this.#settings = settings; this.#bounds = bounds; this.#notify = notify;
    this.#timezone = timezone; this.#now = now; this.#logger = logger; this.#dwellDays = dwellDays;
  }

  #today(ms = this.#now()) { return studyDayForInstant(ms, { timezone: this.#timezone }); }

  /** `[{ learnerId, pkg, deckId }]` — one row per word package a learner is enrolled in. */
  async #enrolledPackages() {
    const rows = [];
    for (const record of await this.#assignments.list()) {
      const learnerId = record?.learnerId;
      if (typeof learnerId !== 'string' || !learnerId) continue;
      const seen = new Set();
      for (const program of record.programs ?? []) {
        if (program?.programId !== 'flashcards' || program.policy?.mode !== 'word-ladder') continue;
        const deckId = program.deckId ?? program.corpusId;
        try {
          const deck = await this.#decks.getFlashcardDeck(deckId);
          if (!deck || typeof deck.lexicon !== 'string') throw new Error('deck not found');
          const pkg = this.#lexicons.getLexicon(deck.lexicon).package;
          if (seen.has(pkg)) continue;
          seen.add(pkg);
          rows.push({ learnerId, pkg, deckId });
        } catch (error) {
          this.#logger.warn?.('school.word-ladder.tuning-deck-skipped', { learnerId, deckId, error: error.message });
        }
      }
    }
    return rows;
  }

  /**
   * Learner packages whose previous study day (the last day studied before
   * today) finished on its goal or cap and has not been tuned yet.
   */
  async pending({ now = this.#now() } = {}) {
    const today = this.#today(now instanceof Date ? now.getTime() : now);
    const out = [];
    for (const { learnerId, pkg, deckId } of await this.#enrolledPackages()) {
      try {
        const day = this.#store.listDays(learnerId, pkg).filter((d) => d < today).at(-1);
        if (!day) continue;
        const { lastTunedDay } = this.#store.readTuning(learnerId, pkg);
        if (lastTunedDay && lastTunedDay >= day) continue;
        if (!finishedSitting(this.#store.readDay(learnerId, pkg, day))) continue;
        out.push({ learnerId, pkg, deckId, day });
      } catch (error) {
        this.#logger.warn?.('school.word-ladder.tuning-pending-failed', { learnerId, package: pkg, error: error.message });
      }
    }
    return out;
  }

  #log(base, row, extra = {}) {
    this.#logger.info?.('school.word-ladder.tuning', { ...base, setting: row.setting, from: row.from, to: row.to, reason: row.reason, ...extra });
  }

  /** Tunes one learner × package for the study day `day` (which must have ended). */
  async runFor({ learnerId, pkg, deckId = null, day } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof pkg !== 'string' || !pkg) throw new ValidationError('pkg is required');
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
    const base = { learnerId, package: pkg, day };
    const skip = (why) => {
      this.#logger.debug?.('school.word-ladder.tuning-skipped', { ...base, skipped: why });
      return { ...base, skipped: why };
    };
    if (day >= this.#today()) return skip('day-not-ended');
    const tuning = this.#store.readTuning(learnerId, pkg);
    if (tuning.lastTunedDay && tuning.lastTunedDay >= day) return skip('already-tuned');
    if (!finishedSitting(this.#store.readDay(learnerId, pkg, day))) return skip('no-finished-sitting');

    const studyDays = this.#store.listDays(learnerId, pkg).filter((d) => d <= day);
    const days = studyDays.slice(-DIGEST_DAYS).map((d) => this.#store.readDay(learnerId, pkg, d));
    const settings = withTunedValues(this.#settings(), tuning.values);
    const digest = buildTuningDigest({ status: this.#store.readStatus(learnerId, pkg), days, settings, lastChanged: tuning.lastChanged });

    let status; let notes; let error = null;
    let applied = []; let dropped = [];
    let values = { ...tuning.values }; let { lastChanged } = tuning;
    if (!this.#tuner) {
      ({ status, notes } = deterministicNote(digest));
    } else {
      try {
        const out = await this.#tuner.tune(digest);
        ({ status, notes } = out);
        const braked = applyTuningProposal({
          current: tunableValues(settings), proposal: out.changes, bounds: this.#bounds ?? undefined,
          day, lastChanged: tuning.lastChanged, studyDays, dwellDays: this.#dwellDays,
        });
        ({ applied, dropped } = braked);
        lastChanged = braked.lastChanged;
        for (const row of applied) values[row.setting] = row.to;
      } catch (failure) {
        status = null; notes = ''; error = failure.message; applied = []; dropped = [];
        values = { ...tuning.values }; lastChanged = tuning.lastChanged;
        this.#logger.warn?.('school.word-ladder.tuning-failed', { ...base, error, code: failure.code ?? null });
      }
    }

    const entry = { day, status, notes, applied, dropped, ...(error ? { error } : {}) };
    this.#store.writeTuning(learnerId, pkg, {
      values, lastChanged, lastTunedDay: day, history: [...(tuning.history ?? []), entry],
    });
    const current = tunableValues(settings);
    for (const row of applied) this.#log(base, row, row.clampedFrom !== undefined ? { clampedFrom: row.clampedFrom } : {});
    for (const row of dropped) this.#log(base, { ...row, from: current[row.setting] ?? null }, { dropped: row.brake });
    this.#logger.info?.('school.word-ladder.tuned', {
      ...base, status, model: Boolean(this.#tuner), applied: applied.length, dropped: dropped.length, error,
    });

    if (status === 'concern' && this.#notify) {
      try {
        await this.#notify({ learnerId, package: pkg, deckId, day, status, notes });
      } catch (failure) {
        this.#logger.warn?.('school.word-ladder.tuning-notify-failed', { ...base, error: failure.message });
      }
    }
    return { ...base, status, notes, applied, dropped, ...(error ? { error } : {}) };
  }
}

export default WordLadderTuningService;
