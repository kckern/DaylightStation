/**
 * SurfaceProgramLauncher — the generic `IProgramLauncher` for a `school.yml`
 * `programs:` entry (spec §6 "Surface programs — how daily PE actually
 * exists"): one class, config-driven, covering every daily "go do it on that
 * surface" program (PE in the garage today; anything else tomorrow) with zero
 * new code per program.
 *
 * `launch()` is a thin call into `DoNowService.dispatch` — occupancy, the
 * pending-approval ladder and the dispatch log all live there, uniformly,
 * exactly as a `launch:` unit's one-shot dispatch does. `requestedBy:
 * 'school-program'` and `ref: id` (also copied to `programId`) are what let
 * the dispatch log tell a one-shot garage launch apart from a genuine PE
 * dispatch for THIS program (spec §6's evidence rule).
 *
 * `status()` derives `doneToday` by reading the DoNow dispatch log directly —
 * honor-system by household decision, same as the language ladder is
 * evidence-owned by its OWN service rather than DoNow's. It reads TWO UTC day
 * shards (today's and yesterday's) because the log shards by the UTC date of
 * the dispatch, not the household's local calendar day: a study day runs
 * 4am→4am in the household's own timezone, so a 5:01pm PDT dispatch is
 * already tomorrow in UTC and lands in TOMORROW's shard relative to the
 * moment it happened — reading only "today's" UTC shard would silently
 * un-serve an evening PE dispatch. Concatenating both shards and filtering by
 * `isSameStudyDay` (the same 4am boundary the rest of the agenda uses) is
 * what makes the two-shard read correct regardless of what hour it is.
 *
 * A same-surface, same-learner, same-day row that lacks THIS program's
 * `programId` (e.g. a one-shot `launch:` unit dispatched to the same surface)
 * must never count as done — the filter checks `programId === id` by
 * identity, not merely that a row exists (spec §9 row 8).
 */
import { isSameStudyDay } from '#domains/school/studyDay.mjs';

export class SurfaceProgramLauncher {
  #id; #label; #surface; #action; #subject; #donow; #datastore; #timezone; #clock; #logger;

  /**
   * @param {object} config
   * @param {string} config.id - stable program id, e.g. `pe-daily`; must not
   *   collide with a code-registered launcher id (`language`) — a boot-time
   *   concern, not this class's.
   * @param {string} [config.label] - human label; defaults to `id`.
   * @param {string} config.surface - the DoNow surface id this program dispatches to.
   * @param {object} [config.action] - the surface-specific action payload, from config.
   * @param {string} [config.subject] - the subject shelf this program's units are assigned under.
   * @param {import('../donow/DoNowService.mjs').DoNowService} config.donow
   * @param {object} config.datastore - YamlDoNowDatastore-shaped (`listDispatches({dayStamp})`).
   * @param {string|null} [config.timezone] - household timezone, for the study-day boundary.
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({
    id, label = null, surface, action = {}, subject = null,
    donow, datastore, timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!id || !surface || !donow || !datastore) {
      throw new Error('SurfaceProgramLauncher requires id, surface, donow and datastore');
    }
    this.#id = id;
    this.#label = label ?? id;
    this.#surface = surface;
    this.#action = action;
    this.#subject = subject;
    this.#donow = donow;
    this.#datastore = datastore;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Stable id, matches the `programs:` config entry and the plan's `program` field. */
  get id() { return this.#id; }

  /** Human label, e.g. 'P.E.' — surfaced to any caller that wants to name it. */
  get label() { return this.#label; }

  /** The subject shelf this program is assigned under, when config declares one. */
  get subject() { return this.#subject; }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed', approvalId?: string, message: string}>}
   */
  async launch({ userId }) {
    return this.#donow.dispatch({
      surface: this.#surface,
      action: this.#action,
      learnerId: userId,
      requestedBy: 'school-program',
      ref: this.#id,
      programId: this.#id,
    });
  }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: null, score: null}>}
   */
  async status({ userId }) {
    const nowMs = this.#nowMs();
    // Both UTC shards spanning "today" in the household's local timezone —
    // see the class doc for why one shard is not enough.
    const dayStamps = [...new Set([this.#utcDay(nowMs), this.#utcDay(nowMs - 24 * 3_600_000)])];

    let rows;
    try {
      const shards = await Promise.all(dayStamps.map((dayStamp) => this.#datastore.listDispatches({ dayStamp })));
      rows = shards.flat();
    } catch (err) {
      this.#logger.warn?.('school.surface-program.status-failed', {
        programId: this.#id, error: err?.message ?? String(err),
      });
      return { doneToday: false, progressLabel: null, score: null };
    }

    const doneToday = rows.some((row) => row
      && row.programId === this.#id
      && row.learnerId === userId
      && isSameStudyDay(Date.parse(row.at), nowMs, { timezone: this.#timezone, boundaryHour: 4 }));

    return { doneToday, progressLabel: null, score: null };
  }

  #utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default SurfaceProgramLauncher;
