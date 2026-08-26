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
// ONE declaration of the id and the default, in the domain module that also
// validates them. A launcher fallback that could drift from the validator's
// default would change what a learner's obligation MEANS without anything
// failing.
import { STORY_TIME_PROGRAM_ID, DEFAULT_STORY_TARGET } from '#domains/school/storyTime.mjs';

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

  /** The room, in the words a child reads. */
  get locationHint() { return 'on the living room TV'; }

  /**
   * Explicit, because these launchers are duck-typed rather than extending
   * `IProgramLauncher` — there is no base class to inherit a default from, and
   * an absent getter would read `undefined` rather than the documented `null`.
   * There is no DoNow surface to dispatch to yet, so the self-service panel
   * must route through `launch()` — which refuses truthfully — rather than
   * mounting a screen that isn't there.
   */
  get surface() { return null; }

  /**
   * The learner's own target, or `null` when there is NO ENROLLMENT TO READ IT
   * FROM — which is not the same thing as an enrollment that omits it.
   *
   * The distinction is the whole point. `YamlAssignmentStore.get()` never
   * throws: a missing file and unparseable YAML both answer `null`. Falling
   * back to the default there would set every learner's target to 2 off a
   * corrupt file — asking the child whose target is 1 for a second book, and
   * calling the child whose target is 5 DONE at two. A false done is worse
   * than the false zero this file's header rules out, and it fails silently.
   *
   * A `target` that is present but not a positive integer is refused for the
   * same reason: `target: '5'` in a hand-edited plan must not quietly become 2.
   * Only an ABSENT target takes the default.
   *
   * Deliberately not wrapped in a catch — a store that genuinely throws is a
   * real fault, and `status()` turns it into the same honest `error` answer.
   */
  async #targetFor(userId) {
    const assignment = await this.#assignments.get(userId);
    const entry = (assignment?.programs ?? []).find((p) => p?.programId === STORY_TIME_PROGRAM_ID);
    if (!entry) return null;
    if (entry.target === undefined || entry.target === null) return DEFAULT_STORY_TARGET;
    return Number.isInteger(entry.target) && entry.target > 0 ? entry.target : null;
  }

  /** The one error shape, so both branches answer what the success branch does. */
  #unavailable(progressLabel, target) {
    return {
      error: true, doneToday: false, progressLabel, score: null, terminal: false,
      count: null, target, reads: [],
    };
  }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  async status({ userId }) {
    const day = this.studyDay();
    let target;
    try {
      target = await this.#targetFor(userId);
    } catch (err) {
      this.#logger.error?.('school.story-time.target-unknown', { userId, day, error: err.message });
      return this.#unavailable('Reading assignment unavailable', null);
    }
    if (target === null) {
      this.#logger.error?.('school.story-time.target-unknown', { userId, day, reason: 'no readable enrollment' });
      return this.#unavailable('Reading assignment unavailable', null);
    }
    let rows;
    try {
      rows = await this.#readingLog.listForDay(userId, day);
    } catch (err) {
      this.#logger.error?.('school.story-time.log-unreadable', { userId, day, error: err.message });
      return this.#unavailable('Reading log unavailable', target);
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
