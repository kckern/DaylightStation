/**
 * PlanProjection — the ONE sanctioned way to obtain a learner's plan and their
 * daily sections.
 *
 * `planLearnerWork` and `planDailyAgenda` are pure and singular; the *assembly
 * of their inputs* was not. Assignments + units + raw session history +
 * attested-pass overlay + curriculum-exception projection + coursePolicies was
 * hand-copied into `BuildAgenda`, `ResolveSubjectNext`, `ResolveAccessCode`,
 * `GetLearnerDayCompletion` and `CloseSessionOutcome` with DIFFERENT recipes:
 * two of them wrapped history in both overlays, two wrapped neither. SSOT held
 * for the computation and not for the access, and so the printed agenda, the
 * scan resolver and the panel genuinely disagreed about what a child was
 * allowed to do next — the "the receipt promised work the panel then refused"
 * family of failures, one of which stranded a child mid-lesson. Hand-assembly
 * is the defect. Use this class; do not copy the recipe again.
 *
 * The recipe reproduced here is `BuildAgenda`'s, deliberately, because
 * `BuildAgenda`'s is the one that prints the paper a child is holding, so it is
 * the one every other surface must converge on.
 *
 * THE `attested` / `exceptions` FLAGS ARE NOT COSMETIC. They default to `true`
 * (the canonical recipe). They exist because `GetLearnerDayCompletion`
 * historically wrapped NEITHER overlay, and its verdict gates the piano-games
 * unlock in the household. Migrating that call site with the defaults would
 * silently move a reward gate a child can feel. It must migrate as
 * `{ attested: false, exceptions: false }` first, and any change to that is a
 * deliberate, separately-reviewed decision about completion semantics — never a
 * side effect of a refactor.
 *
 * Two subtleties the recipe depends on and that a re-implementation keeps
 * getting wrong:
 *
 *   1. **The planner sees the OVERLAID history; `planDailyAgenda` sees the RAW
 *      history.** The synthetic attested/exception rows exist to unlock the
 *      planner's sequence gate. If the daily-serving layer sees them too, an
 *      attestation reads as "this subject was already served today" and the
 *      repair day becomes the day the agenda goes silent.
 *   2. **`programStatuses` is not optional in effect.** `planDailyAgenda`
 *      without it treats every program's `doneToday` as false, so a finished
 *      PE or flashcards subject looks unserved and gets offered again.
 *
 * Unlike `CurriculumAccess` — the pattern this follows one level up — the
 * settled result is NOT held for a TTL. A catalog is slow-moving; a plan goes
 * stale the instant a session opens underneath it, and `BuildAgenda` opens
 * sessions in the same breath it projects. So the dedupe here is in-flight
 * only: identical concurrent calls share one fan-out, and nothing survives the
 * settle.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda, programStatusFor } from '#domains/school/agenda.mjs';
import { collectProgramStatuses } from './programStatusCollection.mjs';
import { withCurriculumExceptions } from './curriculumExceptionProjection.mjs';
import { appendAssignedProgramEntries, projectProgramEntry } from './assignedProgramPlan.mjs';

/**
 * Attestation gate-unlock (spec D2): an attested unit enters the planner's
 * history as a synthetic PASSED session, so its successor unlocks exactly as if
 * the engine had graded it. The row is marked `attested: true` — a reader that
 * must distinguish evidence kinds can. Lifted verbatim from `BuildAgenda`.
 */
function withAttestedPasses(history, attestations, learnerId) {
  const entries = attestations?.list?.({ learnerId }) ?? [];
  if (!entries.length) return history;
  return [
    ...history,
    ...entries.map((a) => ({
      sessionId: `attested:${a.id}`, learnerId, unitId: a.unitId,
      outcome: { result: 'passed' }, attested: true, terminal: true, updatedAt: a.at,
    })),
  ];
}

export class PlanProjection {
  #curriculum; #assignments; #sessions; #attestations; #curriculumExceptions;
  #launchers; #timezone; #clock; #logger; #planErrorEvent; #launcherFailedEvent;
  #inflight = new Map();

  /**
   * @param {object} deps
   * @param {import('./CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('./ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('./ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {{list: Function}|null} [deps.attestations] - teacher attestation log
   *   (spec D2). Absent means no attested passes exist, which is NOT the same as
   *   `attested: false` — that flag suppresses an overlay that does exist.
   * @param {{active: Function}|null} [deps.curriculumExceptions]
   * @param {Map<string, import('./ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id → launcher, consulted READ-ONLY (`status`).
   * @param {string|null} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {string} [deps.planErrorEvent] - log event name for a plan carrying
   *   errors. Injectable so a migrating call site keeps the event name its
   *   dashboards and runbooks already know instead of gaining a second line.
   * @param {string} [deps.launcherFailedEvent] - same, for a launcher that threw.
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions,
    attestations = null, curriculumExceptions = null, launchers = new Map(),
    timezone = null, clock = () => new Date(),
    planErrorEvent = 'school.plan.errors',
    launcherFailedEvent = 'school.plan.launcher-failed',
    logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions) {
      throw new Error('PlanProjection requires curriculum, assignments and sessions');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#attestations = attestations;
    this.#curriculumExceptions = curriculumExceptions;
    this.#launchers = launchers;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#planErrorEvent = planErrorEvent;
    this.#launcherFailedEvent = launcherFailedEvent;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {boolean} [args.attested=true] - apply the attested-pass overlay to
   *   the PLANNER's history. See the class header before changing this at a
   *   call site: it moves what a child is offered.
   * @param {boolean} [args.exceptions=true] - apply the curriculum-exception
   *   (`excused`/`replaced`) projection to the PLANNER's history.
   * @param {Record<string, object>|null} [args.programStatuses] - pre-collected
   *   statuses. Null (the default) fans out to the launchers once per DISTINCT
   *   program instance. Pass a value only when the caller already has them —
   *   omitting them makes every program subject look unserved.
   * @param {Date|string|null} [args.now] - the instant to plan against. Null
   *   reads the clock; a dry-run asking what a particular study day would offer
   *   passes the midpoint of that day's window (`BuildAgenda`'s `studyDay`).
   * @param {((plan: object, ctx: {assignment: object|null, nowIso: string}) => void)|null}
   *   [args.augmentPlan] - the seam for a caller that injects its own synthetic
   *   entry between `planLearnerWork` and the assigned-program append, which is
   *   where `BuildAgenda` pushes the day's language reel. It runs INSIDE the
   *   assembly on purpose: an entry added after sectioning would be missing
   *   from `sections`, which is the surface everything downstream reads.
   * @returns {Promise<{plan: object, sections: object[],
   *   programStatuses: Record<string, object>, activeExceptions: object[],
   *   projection: {assignment: object|null, units: object[], sessions: object[],
   *                works: object[], nowIso: string}}>}
   */
  async project({
    learnerId, attested = true, exceptions = true,
    programStatuses = null, now = null, augmentPlan = null,
  } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('PlanProjection.project requires learnerId');
    }
    // Only a plain read is shareable. A caller-supplied `programStatuses`, an
    // explicit instant or an `augmentPlan` closure each make the call something
    // other than "the current plan for this learner", and two of them cannot be
    // compared for equality at all.
    const shareable = programStatuses == null && now == null && augmentPlan == null;
    const key = `${learnerId}|${attested}|${exceptions}`;
    if (shareable && this.#inflight.has(key)) return this.#inflight.get(key);

    const pending = this.#project({ learnerId, attested, exceptions, programStatuses, now, augmentPlan });
    if (!shareable) return pending;
    this.#inflight.set(key, pending);
    // Dropped on settle, success or failure: nothing here outlives its own
    // fan-out (see the class header on why there is no TTL).
    return pending.finally(() => { this.#inflight.delete(key); });
  }

  async #project({ learnerId, attested, exceptions, programStatuses, now, augmentPlan }) {
    const at = now == null ? this.#clock() : (now instanceof Date ? now : new Date(now));
    const nowIso = at.toISOString();

    // BuildAgenda's read set, in BuildAgenda's shape: one parallel fan-out, and
    // `listWorks` tolerated as absent because a catalog adapter predating work
    // configs simply has none.
    const [assignment, units, works, rawHistory] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#curriculum.listWorks?.() ?? [],
      this.#sessions.listForLearner(learnerId),
    ]);
    const activeExceptions = await this.#curriculumExceptions?.active?.() ?? [];

    // The planner's view: raw history plus whichever overlays are in force.
    // Order matters only in that both are additive; it is kept identical to
    // BuildAgenda's so nothing can drift on a nested rewrite.
    const attestedHistory = attested
      ? withAttestedPasses(rawHistory, this.#attestations, learnerId)
      : rawHistory;
    const history = exceptions
      ? withCurriculumExceptions(attestedHistory, activeExceptions, learnerId)
      : attestedHistory;

    const coursePolicies = Object.fromEntries((works ?? [])
      .map((work) => [work.work, work.progression]).filter(([, p]) => p));
    const plan = planLearnerWork({
      learnerId, assignment, units, sessions: history, now: nowIso,
      timezone: this.#timezone, coursePolicies,
    });
    augmentPlan?.(plan, { assignment, nowIso });
    appendAssignedProgramEntries(plan, assignment);
    if (plan.errors.length) {
      this.#logger.warn?.(this.#planErrorEvent, { learnerId, errors: plan.errors });
    }

    const statuses = programStatuses ?? await collectProgramStatuses({
      plan, learnerId, launchers: this.#launchers, logger: this.#logger,
      logEvent: this.#launcherFailedEvent,
    });

    // RAW history, never the overlaid one — see the class header, subtlety 1.
    const { sections: rawSections } = planDailyAgenda({
      plan, sessions: rawHistory, programStatuses: statuses, now: nowIso,
      timezone: this.#timezone, logger: this.#logger,
    });
    const sections = rawSections.map((section) => (section.next?.program
      ? { ...section, next: projectProgramEntry(section.next, programStatusFor(statuses, section.next)) }
      : section));

    return {
      plan,
      sections,
      programStatuses: statuses,
      activeExceptions,
      projection: { assignment, units, sessions: rawHistory, works, nowIso },
    };
  }
}

export default PlanProjection;
