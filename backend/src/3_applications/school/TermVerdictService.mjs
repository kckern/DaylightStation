/**
 * TermVerdictService — a learner's term, one verdict per day, honestly
 * replayed and cheaply re-read.
 *
 * The term grid on the status board asks "how did every day since September
 * go?" and the only truthful way to answer is to REPLAY each day: project the
 * learner's plan as of that day's midpoint, seeing only evidence stamped
 * before the day closed (`GetLearnerDayCompletion.execute({studyDay})`), and
 * fold the sections through `termVerdict.dayVerdict`. That costs about a
 * second per day for a learner with a piano course (Plex), which is fine once
 * and unacceptable on every board refresh — hence the cache.
 *
 * THE CACHE IS DERIVED AND DISPOSABLE (`docs/reference/school/README.md`:
 * rollups are derived, never stored). Every row is this service's own output
 * and carries the ladder's `VERDICT_VERSION`; delete the file and the next
 * read rebuilds it. What the cache buys is not truth but time.
 *
 * READ RULE, in full:
 *   - TODAY and YESTERDAY are recomputed on read, unless a row was computed
 *     within `freshMs` (the board polls; one projection a minute per learner
 *     is the budget). Today is a live projection — the same call the piano
 *     games gate reads — so the grid's rightmost cell can never disagree with
 *     `school.day.complete`. Yesterday is replayed because an evening's
 *     evidence lands after the day was last looked at.
 *   - OLDER DAYS are served from the cache. A row is recomputed only when it
 *     is missing, its version is stale, or it is `unknown` for a fault whose
 *     `retryAfter` has passed — and those recomputes run on a per-learner
 *     background queue; the read returns `unknown/pending` for them until
 *     the rows are written.
 *
 * Writes for one learner are serialised (the `SchoolCompletionBridge`
 * pattern) so a background backfill and a foreground read never clobber
 * each other's rows.
 */
import {
  dayVerdict, weekVerdict, termDaysFor, resolveTermFor, weekIdFor, addDays, VERDICT_VERSION,
} from '#domains/school/termVerdict.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

const pendingRow = (studyDay, today) => ({ ...dayVerdict({ studyDay, today }), sections: [], weekly: [] });

export class TermVerdictService {
  #completion; #cache; #periods; #window; #timezone; #clock; #logger; #freshMs;
  #queues = new Map();

  /**
   * @param {object} deps
   * @param {{execute: Function}} deps.getLearnerDayCompletion
   * @param {import('./ports/ITermVerdictCache.mjs').ITermVerdictCache} deps.cache
   * @param {{listPeriods: Function}} deps.academicPeriods
   * @param {{from?: string, to?: string}|null} [deps.window] - `school.yml →
   *   lifecycle.board.term`: narrows the period's days for the grid (the
   *   household's Fall semester starts 1 August on paper; the board shows
   *   from 1 September). Never widens.
   * @param {string|null} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {number} [deps.freshMs] - how long today's/yesterday's row is trusted
   */
  constructor({
    getLearnerDayCompletion, cache, academicPeriods, window = null,
    timezone = null, clock = () => new Date(), freshMs = 60_000, logger = console,
  } = {}) {
    if (!getLearnerDayCompletion || !cache || !academicPeriods) {
      throw new Error('TermVerdictService requires getLearnerDayCompletion, cache and academicPeriods');
    }
    this.#completion = getLearnerDayCompletion;
    this.#cache = cache;
    this.#periods = academicPeriods;
    this.#window = window;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#freshMs = freshMs;
    this.#logger = logger;
  }

  today() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  /** The term the grid draws for `today` (or the named one). Null outside every period. */
  termFor({ today = this.today(), termId = null } = {}) {
    const periods = this.#periods.listPeriods?.() ?? [];
    return resolveTermFor(periods, { today, termId, window: this.#window });
  }

  /**
   * One day's row, computed now. Today is LIVE (no replay) so it equals what
   * the completion bridge and the games gate see; every other day replays.
   */
  async computeDay(learnerId, studyDay, today = this.today()) {
    const computedAt = this.#clock().toISOString();
    const result = await this.#completion.execute({
      learnerId, ...(studyDay === today ? {} : { studyDay }),
    });
    const verdict = dayVerdict({
      studyDay, today, completion: result, sections: result.sections ?? [], computedAt,
    });
    return {
      ...verdict, computedAt,
      sections: (result.sections ?? []).map(({ subject, state, reason, unknowable }) => ({ subject, state, reason, ...(unknowable ? { unknowable } : {}) })),
      weekly: (result.sections ?? []).flatMap((s) => s.weekly ?? []),
    };
  }

  /**
   * The term as the board reads it.
   * @returns {Promise<{term: object|null, today: string, version: number,
   *   days: object[], weeks: object[], pending: number}>}
   */
  async read(learnerId, { termId = null } = {}) {
    const today = this.today();
    const term = this.termFor({ today, termId });
    if (!term) return { term: null, today, version: VERDICT_VERSION, days: [], weeks: [], pending: 0 };

    const cached = await this.#cache.read(learnerId, term.termId);
    const valid = cached?.version === VERDICT_VERSION ? cached.days : {};
    const nowMs = this.#clock().getTime();
    const yesterday = addDays(today, -1);
    const last = term.to < today ? term.to : today;
    const fresh = {};
    const stale = [];
    const rows = {};

    for (const day of termDaysFor(term.from, last)) {
      const row = valid[day] ?? null;
      const recent = row?.computedAt && nowMs - Date.parse(row.computedAt) < this.#freshMs;
      if ((day === today || day === yesterday) && !recent) {
        // eslint-disable-next-line no-await-in-loop
        rows[day] = fresh[day] = await this.computeDay(learnerId, day, today);
        continue;
      }
      const retryDue = row?.state === 'unknown' && row.reason !== 'pending'
        && (!row.retryAfter || Date.parse(row.retryAfter) <= nowMs);
      if (row && !retryDue && !(row.state === 'unknown' && row.reason === 'pending')) { rows[day] = row; continue; }
      stale.push(day);
      rows[day] = row ?? pendingRow(day, today);
    }

    if (Object.keys(fresh).length) {
      this.#enqueue(learnerId, () => this.#merge(learnerId, term.termId, fresh)).catch(() => {});
    }
    if (stale.length) {
      this.#logger.info?.('school.term-verdicts.backfill-queued', { learnerId, termId: term.termId, days: stale.length });
      this.#enqueue(learnerId, () => this.#rebuildDays(learnerId, term, stale, { today })).catch((err) => {
        this.#logger.warn?.('school.term-verdicts.backfill-failed', { learnerId, error: err?.message ?? String(err) });
      });
    }
    return this.#present({ term, today, rows });
  }

  /**
   * Recompute every day of the term (or `from..to`), oldest first, writing
   * every ten days so a crash keeps what it had. `force` recomputes rows that
   * already exist; without it only missing/stale/retry-due rows are done.
   * @returns {Promise<{termId: string, computed: number, skipped: number, days: string[]}>}
   */
  async rebuild(learnerId, { termId = null, from = null, to = null, force = false, onProgress = null } = {}) {
    const today = this.today();
    const term = this.termFor({ today, termId });
    if (!term) throw new Error(`no academic period contains ${today}`);
    const last = term.to < today ? term.to : today;
    const days = termDaysFor(from ?? term.from, to && to < last ? to : last);
    return this.#enqueue(learnerId, async () => {
      const cached = await this.#cache.read(learnerId, term.termId);
      const valid = cached?.version === VERDICT_VERSION ? cached.days : {};
      const todo = force ? days : days.filter((day) => {
        const row = valid[day];
        return !row || row.state === 'unknown';
      });
      const written = await this.#rebuildDays(learnerId, term, todo, { today, onProgress });
      return { termId: term.termId, computed: written, skipped: days.length - todo.length, days: todo };
    });
  }

  async #rebuildDays(learnerId, term, days, { today, onProgress = null } = {}) {
    let batch = {};
    let written = 0;
    const flush = async () => {
      if (!Object.keys(batch).length) return;
      await this.#merge(learnerId, term.termId, batch);
      written += Object.keys(batch).length;
      batch = {};
    };
    for (const day of days) {
      let row;
      try {
        // eslint-disable-next-line no-await-in-loop
        row = await this.computeDay(learnerId, day, today);
      } catch (err) {
        // A day that threw is a fault, not a hole: recorded as unknown with a
        // retry, so the grid says "could not judge" rather than "not yet".
        const computedAt = this.#clock().toISOString();
        row = {
          ...dayVerdict({ studyDay: day, today, completion: { state: 'indeterminate', faults: [{ reason: 'replay_failed' }] }, sections: [], computedAt }),
          computedAt, sections: [], weekly: [], error: err?.message ?? String(err),
        };
        this.#logger.warn?.('school.term-verdicts.day-failed', { learnerId, day, error: row.error });
      }
      batch[day] = row;
      onProgress?.({ day, row });
      // eslint-disable-next-line no-await-in-loop
      if (Object.keys(batch).length >= 10) await flush();
    }
    await flush();
    return written;
  }

  /** Read-modify-write of the cache doc; callers hold the learner's queue. */
  async #merge(learnerId, termId, rows) {
    const cached = await this.#cache.read(learnerId, termId);
    const days = cached?.version === VERDICT_VERSION ? { ...cached.days } : {};
    Object.assign(days, rows);
    await this.#cache.write(learnerId, termId, {
      version: VERDICT_VERSION, computedAt: this.#clock().toISOString(), days,
    });
  }

  #enqueue(learnerId, task) {
    const previous = this.#queues.get(learnerId) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(task);
    this.#queues.set(learnerId, queued);
    return queued.finally(() => {
      if (this.#queues.get(learnerId) === queued) this.#queues.delete(learnerId);
    });
  }

  #present({ term, today, rows }) {
    const days = Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : 1)).map(([studyDay, row]) => ({
      studyDay, state: row.state, reason: row.reason ?? null,
      served: row.served ?? 0, asked: row.asked ?? 0, weekday: row.weekday,
      computedAt: row.computedAt ?? null,
    }));
    const byWeek = new Map();
    for (const [studyDay, row] of Object.entries(rows)) {
      const weekId = weekIdFor(studyDay);
      if (!byWeek.has(weekId)) byWeek.set(weekId, []);
      byWeek.get(weekId).push({ studyDay, weekly: row.weekly ?? [] });
    }
    // Every week the term touches, including the empty tail, so the grid can
    // draw its columns without counting.
    const weeks = [];
    for (let weekId = weekIdFor(term.from); weekId <= term.to; weekId = addDays(weekId, 7)) {
      const verdict = weekVerdict({ weekId, today, days: byWeek.get(weekId) ?? [] });
      weeks.push({ weekId, from: weekId, to: addDays(weekId, 6), ...verdict });
    }
    return {
      term, today, version: VERDICT_VERSION, days, weeks,
      pending: days.filter((d) => d.state === 'unknown' && d.reason === 'pending').length,
    };
  }
}

export default TermVerdictService;
