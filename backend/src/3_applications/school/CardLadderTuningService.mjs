// backend/src/3_applications/school/CardLadderTuningService.mjs
/**
 * The card ladder's tuning pass (mastery redesign spec §7): once per learner
 * × word package per study day, after the day has ended — build the digest,
 * ask the tuner agent, let the domain brakes decide what actually changes,
 * persist `tuning.yml`, log every applied and dropped change, and record an
 * outstanding push when the day reads as a concern (`deliverPushes` sends
 * it, waiting out quiet hours).
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
import { isCardLadderPolicy } from '#domains/school/flashcards/index.mjs';
import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import {
  applyTuningProposal, buildTuningDigest, dayStats, tunableValues, withTunedValues, TUNABLE, TUNING_BOUNDS,
} from '#domains/school/cardLadder/index.mjs';

const DIGEST_DAYS = 8; // the day just ended + the 7-day trailing window
const FINISHED = new Set(['goal', 'cap']);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const UNDO_REASON = 'grown-up undo';

/** Spec bounds narrowed by the household's, as `withTunedValues` clamps. */
function effectiveBounds(setting, household) {
  let [lo, hi] = TUNING_BOUNDS[setting];
  const own = household?.[setting];
  if (Array.isArray(own) && own.length === 2 && own.every(Number.isFinite)) { lo = Math.max(lo, own[0]); hi = Math.min(hi, own[1]); }
  return [lo, hi];
}

/**
 * The applied change that is the latest word on `setting` in `history`
 * (oldest first): `{ entry, row }`, or null. An undo entry counts — undoing
 * an undo is not offered.
 */
function latestChange(history, setting) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = (history[i]?.applied ?? []).find((change) => change?.setting === setting);
    if (row) return { entry: history[i], row };
  }
  return null;
}

function undoableRow(tuning, entry, row) {
  if (entry.undo || row.undone) return false;
  const latest = latestChange(tuning.history ?? [], row.setting);
  return latest?.row === row && tuning.values?.[row.setting] === row.to;
}

/**
 * A day is tuned only when it reached its goal or its time cap — as the
 * server recorded it (credited `doneAt`, or active time at the cap) or as a
 * sitting closed (`goal` | `cap`). A day that only closed idle / on unmount /
 * on leave, with neither reached, never qualifies.
 */
function finishedDay(dayFile, settings) {
  if (Object.values(dayFile?.sittings ?? {}).some((row) => FINISHED.has(row?.reason))) return true;
  if (!dayFile?.atOpen) return false;
  const stats = dayStats(dayFile, settings);
  return stats.credited || stats.reachedGoal || stats.capHit;
}

/**
 * Tuner off: a status from the digest alone. The note is plain copy for a
 * parent (it can reach a phone); the history row's `model: false` says the
 * rules, not a model, wrote it.
 */
function deterministicNote(digest) {
  const today = digest.today ?? {};
  if (today.credited && today.quizzed === 0) return { status: 'concern', notes: ['Credited with no words quizzed'] };
  return { status: 'on-track', notes: [] };
}

// A concern push waits out quiet hours (the NotificationService suppresses a
// non-critical push overnight, and the tuning pass runs just after the 4am
// rollover); one still undelivered after this long is stale news.
const PUSH_MAX_AGE_MS = 48 * 3600000;

export class CardLadderTuningService {
  #inFlight = new Set();
  #store; #assignments; #decks; #lexicons; #tuner; #settings; #bounds; #notify; #teacherGate; #timezone; #now; #logger; #dwellDays;

  constructor({
    store, assignments, decks, lexicons, tuner = null, settings, bounds = null, notify = null, teacherGate = null,
    timezone = null, now, logger = console, dwellDays = 5,
  } = {}) {
    for (const fn of ['readStatus', 'readDay', 'readTuning', 'tuningState', 'writeTuning', 'listDays']) {
      if (typeof store?.[fn] !== 'function') throw new Error(`CardLadderTuningService requires store.${fn}()`);
    }
    if (typeof assignments?.get !== 'function' || typeof assignments?.list !== 'function') throw new Error('CardLadderTuningService requires assignments.get/list');
    if (typeof decks?.getFlashcardDeck !== 'function') throw new Error('CardLadderTuningService requires decks.getFlashcardDeck');
    if (typeof lexicons?.getLexicon !== 'function') throw new Error('CardLadderTuningService requires lexicons.getLexicon');
    if (tuner !== null && typeof tuner?.tune !== 'function') throw new Error('CardLadderTuningService tuner must have tune()');
    if (notify !== null && typeof notify !== 'function') throw new Error('CardLadderTuningService notify must be a function');
    if (typeof settings !== 'function' || typeof now !== 'function') throw new Error('CardLadderTuningService requires settings() and now()');
    this.#store = store; this.#assignments = assignments; this.#decks = decks; this.#lexicons = lexicons;
    this.#tuner = tuner; this.#settings = settings; this.#bounds = bounds; this.#notify = notify; this.#teacherGate = teacherGate;
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
        if (program?.programId !== 'flashcards' || !isCardLadderPolicy(program.policy)) continue;
        const deckId = program.deckId ?? program.corpusId;
        try {
          const deck = await this.#decks.getFlashcardDeck(deckId);
          if (!deck || typeof deck.lexicon !== 'string') throw new Error('deck not found');
          const pkg = this.#lexicons.getLexicon(deck.lexicon).package;
          if (seen.has(pkg)) continue;
          seen.add(pkg);
          rows.push({ learnerId, pkg, deckId });
        } catch (error) {
          this.#logger.warn?.('school.card-ladder.tuning-deck-skipped', { learnerId, deckId, error: error.message });
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
        if (this.#store.tuningState(learnerId, pkg) === 'corrupt') continue;
        const settings = withTunedValues(this.#settings(), this.#store.readTuning(learnerId, pkg).values, this.#bounds);
        if (!finishedDay(this.#store.readDay(learnerId, pkg, day), settings)) continue;
        out.push({ learnerId, pkg, deckId, day });
      } catch (error) {
        this.#logger.warn?.('school.card-ladder.tuning-pending-failed', { learnerId, package: pkg, error: error.message });
      }
    }
    return out;
  }

  #log(base, row, extra = {}) {
    this.#logger.info?.('school.card-ladder.tuning', { ...base, setting: row.setting, from: row.from, to: row.to, reason: row.reason, ...extra });
  }

  #skip(base, why) {
    this.#logger.debug?.('school.card-ladder.tuning-skipped', { ...base, skipped: why });
    return { ...base, skipped: why };
  }

  /**
   * Tunes one learner × package for the study day `day` (which must have
   * ended). One run per learner package at a time: an overlapping call is
   * skipped `in-flight` rather than calling the model twice.
   */
  async runFor({ learnerId, pkg, deckId = null, day } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof pkg !== 'string' || !pkg) throw new ValidationError('pkg is required');
    if (typeof day !== 'string' || !DAY_PATTERN.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
    const base = { learnerId, package: pkg, day };
    const key = `${learnerId}|${pkg}`;
    if (this.#inFlight.has(key)) return this.#skip(base, 'in-flight');
    this.#inFlight.add(key);
    try {
      return await this.#run(base, deckId);
    } finally {
      this.#inFlight.delete(key);
    }
  }

  async #run(base, deckId) {
    const { learnerId, package: pkg, day } = base;
    if (day >= this.#today()) return this.#skip(base, 'day-not-ended');
    // A corrupt tuning.yml reads as empty; never spend a model call on it (it cannot be written).
    if (this.#store.tuningState(learnerId, pkg) === 'corrupt') return this.#skip(base, 'corrupt');
    const tuning = this.#store.readTuning(learnerId, pkg);
    if (tuning.lastTunedDay && tuning.lastTunedDay >= day) return this.#skip(base, 'already-tuned');
    const settings = withTunedValues(this.#settings(), tuning.values, this.#bounds);
    if (!finishedDay(this.#store.readDay(learnerId, pkg, day), settings)) return this.#skip(base, 'no-finished-sitting');

    const studyDays = this.#store.listDays(learnerId, pkg).filter((d) => d <= day);
    const days = studyDays.slice(-DIGEST_DAYS).map((d) => this.#store.readDay(learnerId, pkg, d));
    const digest = buildTuningDigest({ status: this.#store.readStatus(learnerId, pkg), days, settings, lastChanged: tuning.lastChanged });

    let status; let notes; let error = null;
    let applied = []; let dropped = [];
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
      } catch (failure) {
        status = null; notes = []; error = failure.message; applied = []; dropped = [];
        this.#logger.warn?.('school.card-ladder.tuning-failed', { ...base, error, code: failure.code ?? null });
      }
    }

    // Re-read just before writing (another process may have tuned meanwhile)
    // and merge this run's changes onto the fresh copy.
    const fresh = this.#store.readTuning(learnerId, pkg);
    if (fresh.lastTunedDay && fresh.lastTunedDay >= day) return this.#skip(base, 'already-tuned');
    const values = { ...fresh.values };
    const lastChanged = { ...fresh.lastChanged };
    for (const row of applied) { values[row.setting] = row.to; lastChanged[row.setting] = day; }
    const entry = {
      day, status, notes, applied, dropped, model: Boolean(this.#tuner), ...(error ? { error } : {}),
      // An outstanding push, delivered by `deliverPushes` (the scheduler's tick).
      ...(status === 'concern' && this.#notify ? { notified: false, concernAt: new Date(this.#now()).toISOString() } : {}),
    };
    this.#store.writeTuning(learnerId, pkg, {
      values, lastChanged, lastTunedDay: day, history: [...(fresh.history ?? []), entry],
    });
    const current = tunableValues(settings);
    for (const row of applied) this.#log(base, row, row.clampedFrom !== undefined ? { clampedFrom: row.clampedFrom } : {});
    for (const row of dropped) this.#log(base, { ...row, from: current[row.setting] ?? null }, { dropped: row.brake });
    this.#logger.info?.('school.card-ladder.tuned', {
      ...base, status, model: Boolean(this.#tuner), applied: applied.length, dropped: dropped.length, error,
    });

    return { ...base, status, notes, applied, dropped, ...(error ? { error } : {}) };
  }

  /**
   * Sends every outstanding concern push (history rows `notified: false`).
   * `notify` answers `{status: 'sent'|'suppressed'|'failed'}`: sent marks the
   * row `notified: true`; suppressed (quiet hours) leaves it pending for the
   * next tick; a failure is warned and retried. A row pending for over 48h is
   * marked `notified: 'dropped'` with a warn. Same in-flight guard and fresh
   * read → write as a tuning run. Returns one row per attempt.
   */
  async deliverPushes() {
    if (!this.#notify) return [];
    const out = [];
    for (const { learnerId, pkg, deckId } of await this.#enrolledPackages()) {
      const key = `${learnerId}|${pkg}`;
      if (this.#inFlight.has(key)) continue;
      this.#inFlight.add(key);
      try {
        if (this.#store.tuningState(learnerId, pkg) === 'corrupt') continue;
        const outstanding = (this.#store.readTuning(learnerId, pkg).history ?? []).filter((row) => row?.notified === false);
        if (!outstanding.length) continue;
        const results = new Map();
        for (const row of outstanding) {
          const base = { learnerId, package: pkg, day: row.day };
          const age = this.#now() - Date.parse(row.concernAt ?? '');
          if (!(age <= PUSH_MAX_AGE_MS)) {
            results.set(row.day, 'dropped');
            this.#logger.warn?.('school.card-ladder.tuning-push', { ...base, status: 'dropped', concernAt: row.concernAt ?? null });
            continue;
          }
          let status; let error = null;
          try {
            status = (await this.#notify({ learnerId, package: pkg, deckId, day: row.day, status: row.status, notes: row.notes ?? [] }))?.status ?? 'failed';
          } catch (failure) {
            status = 'failed'; error = failure.message;
          }
          if (status === 'sent') results.set(row.day, true);
          if (status === 'sent' || status === 'suppressed') this.#logger.info?.('school.card-ladder.tuning-push', { ...base, status });
          else this.#logger.warn?.('school.card-ladder.tuning-push', { ...base, status: 'failed', error });
          out.push({ ...base, status });
        }
        if (!results.size) continue;
        const fresh = this.#store.readTuning(learnerId, pkg);
        for (const row of fresh.history ?? []) {
          if (row?.notified === false && results.has(row.day)) {
            row.notified = results.get(row.day);
            if (row.notified === true) row.notifiedAt = new Date(this.#now()).toISOString();
          }
        }
        this.#store.writeTuning(learnerId, pkg, fresh);
      } catch (error) {
        this.#logger.warn?.('school.card-ladder.tuning-push', { learnerId, package: pkg, status: 'failed', error: error.message });
      } finally {
        this.#inFlight.delete(key);
      }
    }
    return out;
  }

  // ── Grown-up view and undo (spec §7 "listed in the teacher console with
  // undo"). Live only by construction (the store writes tuning), teacher-gated.

  async #adminScope({ learnerId, deckId, actorId, pin }) {
    if (!this.#teacherGate) throw new ValidationError('teacher gate is not configured');
    this.#teacherGate.assert({ userId: actorId, pin, action: 'card-ladder.tuning', context: { learnerId } });
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof deckId !== 'string' || !deckId) throw new ValidationError('deckId is required');
    const assignment = await this.#assignments.get(learnerId);
    const enrolled = (assignment?.programs ?? []).some((row) => row?.programId === 'flashcards'
      && isCardLadderPolicy(row.policy) && (row.deckId ?? row.corpusId) === deckId);
    if (!enrolled) throw new GuestForbiddenError(`'${learnerId}' has no card-ladder assignment for '${deckId}'`);
    const deck = await this.#decks.getFlashcardDeck(deckId);
    if (!deck || typeof deck.lexicon !== 'string') throw new EntityNotFoundError('card-ladder deck', deckId);
    return this.#lexicons.getLexicon(deck.lexicon).package;
  }

  /**
   * One learner × package: each tunable's current value (config + tuned,
   * clamped) against its default and bounds, the last tuning run, and the
   * history newest first, each applied change flagged `undoable` when it is
   * still the setting's latest change and still in force.
   */
  async adminTuning({ learnerId, deckId, actorId = null, pin = null } = {}) {
    const pkg = await this.#adminScope({ learnerId, deckId, actorId, pin });
    const tuning = this.#store.readTuning(learnerId, pkg);
    const defaults = tunableValues(this.#settings());
    const current = tunableValues(withTunedValues(this.#settings(), tuning.values, this.#bounds));
    const history = tuning.history ?? [];
    const last = [...history].reverse().find((entry) => !entry?.undo) ?? null;
    return {
      learnerId, package: pkg, state: this.#store.tuningState(learnerId, pkg), lastTunedDay: tuning.lastTunedDay ?? null,
      settings: Object.keys(TUNABLE).map((setting) => {
        const [min, max] = effectiveBounds(setting, this.#bounds);
        return {
          setting, current: current[setting] ?? null, default: defaults[setting] ?? null, min, max,
          tuned: Object.hasOwn(tuning.values ?? {}, setting), lastChanged: tuning.lastChanged?.[setting] ?? null,
        };
      }),
      last: last ? { day: last.day, status: last.status ?? null, notes: last.notes ?? [], error: last.error ?? null } : null,
      history: [...history].reverse().map((entry) => ({
        ...entry,
        applied: (entry.applied ?? []).map((row) => ({ ...row, undone: row.undone ?? null, undoable: undoableRow(tuning, entry, row) })),
        dropped: entry.dropped ?? [],
      })),
    };
  }

  /**
   * Puts one setting back to its value before the agent's latest change to
   * it. Back at the config default, the key is dropped so the setting
   * follows config again. `lastChanged` becomes today, so the dwell brake
   * holds the grown-up's choice for the next five study days. Same write
   * path and in-flight guard as a tuning run; never touches `lastTunedDay`.
   */
  async adminUndo({ learnerId, deckId, setting, actorId = null, pin = null } = {}) {
    const pkg = await this.#adminScope({ learnerId, deckId, actorId, pin });
    if (typeof setting !== 'string' || !Object.hasOwn(TUNABLE, setting)) throw new ValidationError(`'${setting}' is not a tuned setting`);
    const key = `${learnerId}|${pkg}`;
    if (this.#inFlight.has(key)) throw new DomainInvariantError('a tuning run is in progress for this learner; try again in a minute', { code: 'CARD_LADDER_TUNING_BUSY' });
    this.#inFlight.add(key);
    try {
      const tuning = this.#store.readTuning(learnerId, pkg);
      const history = tuning.history ?? [];
      const latest = latestChange(history, setting);
      if (!latest || latest.entry.undo || latest.row.undone) throw new DomainInvariantError(`nothing to undo for ${setting}`, { code: 'CARD_LADDER_TUNING_NOTHING_TO_UNDO' });
      const { row } = latest;
      if (tuning.values?.[setting] !== row.to) {
        throw new DomainInvariantError(`${setting} has changed since that change; nothing to undo`, { code: 'CARD_LADDER_TUNING_CHANGED' });
      }
      const day = this.#today();
      const values = { ...tuning.values };
      if (row.from === tunableValues(this.#settings())[setting]) delete values[setting]; else values[setting] = row.from;
      row.undone = { day, actorId };
      const change = { setting, from: row.to, to: row.from, reason: UNDO_REASON };
      this.#store.writeTuning(learnerId, pkg, {
        values, lastChanged: { ...tuning.lastChanged, [setting]: day }, lastTunedDay: tuning.lastTunedDay ?? null,
        history: [...history, { day, status: null, notes: [], applied: [change], dropped: [], undo: true, actorId }],
      });
      this.#log({ learnerId, package: pkg, day }, change, { actorId });
      return { learnerId, package: pkg, day, ...change };
    } finally {
      this.#inFlight.delete(key);
    }
  }
}

export default CardLadderTuningService;
