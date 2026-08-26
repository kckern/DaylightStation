/**
 * StoryTimeProgramLauncher — the `IProgramLauncher` for a daily reading
 * obligation that has NO COURSE behind it.
 *
 * There is no curriculum here: no units, no sequence, no gate, no grade. The
 * only question is "how many stories today", so `doneToday` is a count against
 * a per-learner target and the program is NEVER terminal — tomorrow it asks
 * again. That is what distinguishes it from `cadence: 'once'` programs, which
 * leave the agenda when their launcher reports terminal.
 *
 * THE TARGET IS PER LEARNER and lives on the enrollment, because how many
 * stories a four-year-old owes is a teaching decision, not a household setting.
 *
 * AN UNREADABLE LOG IS `error: true`, NOT ZERO. A false zero would show a child
 * who read three books as owing three books; `error` makes the agenda report
 * the program unavailable and completion indeterminate, which is the honest
 * state. See `resolveDayCompletion`'s `indeterminate` branch.
 */
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

export const STORY_TIME_PROGRAM_ID = 'story-time';
export const DEFAULT_STORY_TARGET = 2;

/** Wording for every "you can't start this here" path — one sentence, one place. */
const AT_THE_TV = 'Story time happens on the living room TV — tap your card there.';

export class StoryTimeProgramLauncher {
  #readingLog; #assignments; #timezone; #clock; #logger;

  constructor({ readingLog, assignments, timezone = null, clock = () => new Date(), logger = console } = {}) {
    if (!readingLog) throw new Error('StoryTimeProgramLauncher requires a readingLog');
    if (!assignments) throw new Error('StoryTimeProgramLauncher requires an assignments store');
    this.#readingLog = readingLog;
    this.#assignments = assignments;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  get id() { return STORY_TIME_PROGRAM_ID; }

  /**
   * The room, in the words a child reads. `surface` stays null (the base
   * default): there is no DoNow surface to dispatch to yet, so the self-service
   * panel must route through `launch()` — which refuses truthfully — rather
   * than mounting a screen that isn't there.
   */
  get locationHint() { return 'on the living room TV'; }

  /** The learner's own target, or the default when the enrollment omits one. */
  async #targetFor(userId) {
    try {
      const assignment = await this.#assignments.get(userId);
      const entry = (assignment?.programs ?? []).find((p) => p?.programId === STORY_TIME_PROGRAM_ID);
      return Number.isInteger(entry?.target) && entry.target > 0 ? entry.target : DEFAULT_STORY_TARGET;
    } catch {
      return DEFAULT_STORY_TARGET;
    }
  }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  async status({ userId }) {
    const target = await this.#targetFor(userId);
    const day = this.studyDay();
    let rows;
    try {
      rows = await this.#readingLog.listForDay(userId, day);
    } catch (err) {
      this.#logger.error?.('school.story-time.log-unreadable', { userId, day, error: err.message });
      return { error: true, doneToday: false, progressLabel: 'Reading log unavailable', score: null, terminal: false };
    }
    const count = Array.isArray(rows) ? rows.length : 0;
    return {
      doneToday: count >= target,
      progressLabel: `${count} of ${target} ${target === 1 ? 'story' : 'stories'}`,
      score: null,
      terminal: false,
      count,
      target,
      reads: rows ?? [],
    };
  }

  /**
   * Story time happens at the TV, not on the Portal. Until the living-room
   * reading session ships (plan 03) this is a sentence, not a dispatch — and a
   * sentence naming the room is what the self-service card is for.
   */
  async issueLaunchTarget() {
    return { kind: 'message', message: AT_THE_TV };
  }

  /**
   * `{decision, message}` — DoNow's contract, not an ad-hoc `{ok}`. Both
   * callers (`ResolveScanAction`, `RunSelfServiceAction`) read `decision` and
   * then relay `message` VERBATIM; anything else here and a child is told the
   * generic "ask a grown-up" instead of which room to walk to.
   */
  async launch() {
    return { decision: 'failed', message: AT_THE_TV };
  }
}

export default StoryTimeProgramLauncher;
