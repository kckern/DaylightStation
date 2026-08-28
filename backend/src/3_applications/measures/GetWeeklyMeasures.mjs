/**
 * GetWeeklyMeasures — the roster's weekly measures, assembled where the domain
 * calculations are allowed to live.
 *
 * WHY THIS EXISTS AS A USE CASE. The `/measures/weekly` router used to do this
 * inline, which meant `4_api` imported `#domains/measures/weeklyWindow.mjs`
 * directly — the `api-no-domains` rule `scripts/audit-layer-imports.mjs`
 * ratchets, and one of the three imports that pushed that counter past its
 * baseline. The view is unchanged; only the layer it is computed in moved.
 *
 * ROSTER-WIDE, NOT PER-LEARNER, and that is the point: the school status board
 * draws one card per child, and four cards must not mean four round trips on a
 * wall panel that repaints every five minutes.
 *
 * Read-only. It mints nothing, opens no session and writes no evidence — it is
 * a view over facts fitness already recorded.
 *
 * Layer: APPLICATION (3_applications/measures).
 */
import { studyDayFor, weekWindowFor, weekState } from '#domains/measures/weeklyWindow.mjs';

export class GetWeeklyMeasures {
  #registry; #learners; #timezone; #clock; #logger;

  /**
   * @param {object} deps
   * @param {{totalsFor: Function}} deps.registry
   * @param {() => Promise<Array<{id?: string, learnerId?: string}>>} [deps.learners] - the school roster
   * @param {string} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ registry, learners = null, timezone = 'UTC', clock = () => new Date(), logger = null } = {}) {
    if (!registry || typeof registry.totalsFor !== 'function') {
      throw new Error('GetWeeklyMeasures requires a measure registry');
    }
    this.#registry = registry;
    this.#learners = learners;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} [args]
   * @param {string|null} [args.week] - any day inside the wanted week (`YYYY-MM-DD`);
   *   absent or malformed means the current week. Validated by the CALLER — this
   *   accepts what it is given and falls back rather than throwing, because a bad
   *   query string is an HTTP concern and 404-ing a wall panel over one is worse
   *   than showing it this week.
   * @returns {Promise<{window: object, learners: Array<object>}>}
   */
  async execute({ week = null } = {}) {
    const asked = typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week)
      ? week
      : studyDayFor(this.#clock(), { timezone: this.#timezone });
    const window = weekWindowFor(asked);
    const today = studyDayFor(this.#clock(), { timezone: this.#timezone });

    const roster = (await this.#learners?.()) ?? [];
    const learners = [];
    for (const learner of roster) {
      const learnerId = learner?.id ?? learner?.learnerId;
      if (!learnerId) continue;
      const measures = await this.#registry.totalsFor({ learnerId, ...window, logger: this.#logger });
      learners.push({
        learnerId,
        measures: measures.map((m) => ({
          ...m,
          // v1 configures no targets, so this is `untargeted` for everyone. It
          // is computed anyway because it is the vocabulary the eventual gate
          // needs, and deriving it later would mean revisiting every layer.
          state: weekState({ value: m.value ?? 0, target: null, day: today, window }),
        })),
      });
    }
    return { window, learners };
  }
}

export default GetWeeklyMeasures;
