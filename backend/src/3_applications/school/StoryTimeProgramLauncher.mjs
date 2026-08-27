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
 *
 * NOT ENROLLED IS NOT AN ERROR EITHER. `status()` answers three distinguishable
 * things — enrolled (`error: false, enrolled: true`), not enrolled
 * (`error: false, enrolled: false`), and unreadable (`error: true`) — because
 * the living-room reading session derives its assignment/browsing MODE from
 * exactly this. While the first two shared one answer, an unreadable log
 * relaxed a child who was mid-assignment as silently as a child who was never
 * enrolled at all.
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
   * The `learner_action` a reader must declare for a child to start story time
   * by tapping their card. `locationHint` above is the words; this is the
   * configuration those words promise, and on 2026-08-26 the two disagreed —
   * the receipt said "tap your card there" while the living-room source
   * declared no `learner_action` at all, so the tap resolved to a null intent
   * and Soren stood at a reader that could not help him.
   */
  get entryAction() { return 'reading-session'; }

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
   * What the enrollment says, in THREE answers rather than two.
   *
   *   `{enrolled: false}`  — the assignment record READ FINE and holds no
   *                          story-time entry. A perfectly ordinary state, not
   *                          a fault: this learner simply owes no stories (D1),
   *                          and the reading session puts them in BROWSING mode.
   *   `{unreadable: true}` — the enrollment could not be trusted. Surfaced, and
   *                          never downgraded to "nothing owed" (§9).
   *   `{target: n}`        — enrolled, with the number of stories they owe.
   *
   * Those first two used to be the SAME answer, and the collapse was not
   * harmless: the reading-session interceptor derives assignment-vs-browsing
   * from this, so an unreadable log relaxed a child who was mid-assignment
   * exactly as if they had never been enrolled — the hardening silently off,
   * with nothing on any screen to say so.
   *
   * `YamlAssignmentStore.get()` NEVER THROWS: a missing file and unparseable
   * YAML both answer `null`. Those two genuinely cannot be told apart here, so
   * the pair stays `unreadable` — falling back to the default target off a
   * corrupt file would call the child whose target is 5 DONE at two, and a
   * false done fails silently in the direction that matters least visibly.
   *
   * A `target` that is present but not a positive integer is `unreadable` for
   * the same reason: `target: '5'` in a hand-edited plan must not quietly
   * become 2. Only an ABSENT target takes the default.
   *
   * Deliberately not wrapped in a catch — a store that genuinely throws is a
   * real fault, and `status()` turns it into the same honest `error` answer.
   *
   * @returns {Promise<{enrolled: boolean|null, target: number|null, unreadable: boolean}>}
   */
  async #enrollmentFor(userId) {
    const assignment = await this.#assignments.get(userId);
    if (!assignment || typeof assignment !== 'object') {
      return { enrolled: null, target: null, unreadable: true };
    }
    const programs = Array.isArray(assignment.programs) ? assignment.programs : [];
    const entry = programs.find((p) => p?.programId === STORY_TIME_PROGRAM_ID);
    if (!entry) return { enrolled: false, target: null, unreadable: false };
    if (entry.target === undefined || entry.target === null) {
      return { enrolled: true, target: DEFAULT_STORY_TARGET, unreadable: false };
    }
    if (Number.isInteger(entry.target) && entry.target > 0) {
      return { enrolled: true, target: entry.target, unreadable: false };
    }
    return { enrolled: true, target: null, unreadable: true };
  }

  /**
   * The one error shape, so both branches answer what the success branch does.
   * `enrolled` is whatever we managed to establish before failing — `null` when
   * even that is unknown. It is NEVER `false` here: "not enrolled" is a normal
   * answer with `error: false`, and conflating the two is the bug this shape
   * exists to prevent.
   */
  #unavailable(progressLabel, target, enrolled = null) {
    return {
      error: true, enrolled, doneToday: false, progressLabel, score: null, terminal: false,
      count: null, target, reads: [],
    };
  }

  /**
   * A learner with no story-time enrollment. NOT an error: nothing is owed, so
   * there is nothing to count and nothing to fault. `count`/`target` are null
   * rather than 0 — "no obligation" is not "an obligation of zero".
   */
  #notEnrolled() {
    return {
      error: false, enrolled: false, doneToday: false,
      progressLabel: 'No reading assignment', score: null, terminal: false,
      count: null, target: null, reads: [],
    };
  }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  async status({ userId }) {
    const day = this.studyDay();
    let enrollment;
    try {
      enrollment = await this.#enrollmentFor(userId);
    } catch (err) {
      this.#logger.error?.('school.story-time.enrollment-unreadable', { userId, day, error: err.message });
      return this.#unavailable('Reading assignment unavailable', null);
    }
    if (enrollment.unreadable) {
      this.#logger.error?.('school.story-time.target-unknown', {
        userId, day, reason: enrollment.enrolled ? 'unusable target' : 'no readable enrollment',
      });
      return this.#unavailable('Reading assignment unavailable', null, enrollment.enrolled);
    }
    // No enrollment, no obligation — and no reason to read the log for a count
    // nothing will be compared against.
    if (!enrollment.enrolled) return this.#notEnrolled();
    const { target } = enrollment;
    let rows;
    try {
      rows = await this.#readingLog.listForDay(userId, day);
    } catch (err) {
      this.#logger.error?.('school.story-time.log-unreadable', { userId, day, error: err.message });
      return this.#unavailable('Reading log unavailable', target, true);
    }
    const count = Array.isArray(rows) ? rows.length : 0;
    return {
      error: false,
      enrolled: true,
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
