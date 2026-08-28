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
 * agenda gets: no attested-pass overlay, no curriculum-exception projection.
 * That is what it did before the shared assembler existed — not by decision,
 * but because each of the six hand-copied recipes had drifted its own way and
 * this one had drifted to none of the three. The remaining divergence is now
 * two booleans you can read, rather than lines you would have had to notice
 * were missing.
 *
 * `assignedPrograms` WAS THE THIRD, AND IT WAS WRONG (fixed 2026-08-28).
 *
 * This verdict gates the piano-games unlock (`useSchoolGameAccess.js`), and the
 * header here used to defer the decision as "a separate, reviewable change to
 * completion semantics". The field made the decision for us. Two preschoolers
 * carry `enrollments: []` and nothing but PROGRAMS — story time and a piano
 * course. With programs excluded, their day projected to ZERO sections, which
 * `resolveDayCompletion` folds to `no_work_today` — and `no_work_today` unlocks
 * games exactly as `complete` does.
 *
 * So the two children whose entire curriculum is assigned programs could never
 * be gated by schoolwork at all. Not transiently: structurally, every day. And
 * the converse was just as bad — one of them finished a piano lesson on the
 * kiosk, the evidence was written, the ceremony fired, and his completion state
 * was byte-identical before and after, because the section it would have served
 * did not exist.
 *
 * The direction of the change is the one the old header predicted: appending
 * programs adds a section that has to be finished first, so games now unlock
 * LATER for a learner who holds one. That is the point. A reward gate that
 * cannot see a child's only assignment is not a lenient gate, it is not a gate.
 *
 * SAFE HERE BECAUSE THIS USE CASE HAS LAUNCHERS. Composition wires it with the
 * full `launchers` map, so an appended program entry fans out to a real status.
 * `CloseSessionOutcome` — the other caller that passed `false` — is wired with
 * NO launchers and pins `programStatuses: []`, so the same flip there would
 * make every program subject look permanently unserved. It therefore keeps
 * `false`, and the two now DIVERGE; see the note at its `#projectPlan`.
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
      // The two that still make this a narrower read than the agenda. See the
      // file header before changing either: each moves the piano-games unlock.
      attested: false,
      exceptions: false,
      // TRUE since 2026-08-28. A learner whose whole plan is programs projected
      // to zero sections and read `no_work_today`, which unlocks games — so the
      // gate was inoperative for exactly the children it most needed to hold.
      // Left at the default rather than omitted: this is the line the bug was,
      // and it should be impossible to change it back without reading why.
      assignedPrograms: true,
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
