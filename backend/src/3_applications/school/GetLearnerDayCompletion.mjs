/**
 * GetLearnerDayCompletion — the read-only twin of `BuildAgenda`'s planning
 * path (design: 2026-08-23-student-completion-state-machine). Same assembly,
 * same `planLearnerWork` -> `planDailyAgenda` sequence, but it stops there:
 * no session is created, no token is minted, no document is built. A status
 * read must never carry `BuildAgenda`'s paper-issuing side effects, because
 * it is read far more often than paper is printed.
 *
 * "TWIN" IS NOT "IDENTICAL", AND THAT IS DELIBERATE.
 *
 * This use case asks `PlanProjection` for a NARROWER projection than the
 * agenda gets: no attested-pass overlay, no curriculum-exception projection,
 * no assigned-program entries. That is exactly what it did before the shared
 * assembler existed — not by decision, but because each of the six hand-copied
 * recipes had drifted its own way and this one had drifted to none of the
 * three. The behaviour is preserved byte for byte; what changed is that the
 * divergence is now three booleans you can read, rather than four lines you
 * would have had to notice were missing.
 *
 * WHY IT WAS NOT "FIXED" HERE. This verdict gates the piano-games unlock
 * (`useSchoolGameAccess.js`). Turning the overlays on would mean an attested
 * or excused lesson counts as done and games unlock EARLIER; appending
 * assigned programs would add a flashcards or piano-course section that has to
 * be finished first, so games unlock LATER. Both are household-visible changes
 * to a reward a child can feel, in opposite directions, and neither belongs in
 * a refactor. Deciding them is a separate, reviewable change to completion
 * semantics — with the three flags below as the one place to make it.
 */
import { resolveDayCompletion } from '#domains/school/completion.mjs';
import { PlanProjection } from './PlanProjection.mjs';
import { studyDayWindow } from '#domains/school/studyDay.mjs';

export class GetLearnerDayCompletion {
  // No clock field: the instant this read is answered for is the projection's,
  // so there is only one of it.
  #timezone; #planProjection;

  constructor({
    curriculum, assignments, sessions, launchers = new Map(),
    timezone = null, clock = () => new Date(),
    // Shared with the agenda surfaces in composition. Sharing the ASSEMBLER
    // does not mean sharing the recipe: the flags in `execute` below are what
    // makes this read what it has always been.
    planProjection = null,
    logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions) {
      throw new Error('GetLearnerDayCompletion requires curriculum, assignments and sessions');
    }
    this.#timezone = timezone;
    this.#planProjection = planProjection ?? new PlanProjection({
      curriculum, assignments, sessions, launchers, timezone, clock,
      planErrorEvent: 'school.completion.plan-errors',
      launcherFailedEvent: 'school.completion.launcher-failed',
      logger,
    });
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @returns {Promise<{ learnerId: string, state: 'incomplete'|'complete'|'no_work_today',
   *                      excused: Array<{subject: string|null, reason: string}> }>}
   */
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('GetLearnerDayCompletion requires learnerId');
    }
    const { plan, sections, projection } = await this.#planProjection.project({
      learnerId,
      // The three that make this a narrower read than the agenda. See the file
      // header before changing any of them: each moves the piano-games unlock,
      // and two of them move it in opposite directions.
      attested: false,
      exceptions: false,
      assignedPrograms: false,
      planErrorEvent: 'school.completion.plan-errors',
      launcherFailedEvent: 'school.completion.launcher-failed',
    });
    const { state, excused, faults } = resolveDayCompletion({ sections, planErrors: plan.errors });
    const { startAtMs } = studyDayWindow(Date.parse(projection.nowIso), { timezone: this.#timezone });
    const studyDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(startAtMs));
    return { learnerId, studyDate, state, excused, faults };
  }
}

export default GetLearnerDayCompletion;
