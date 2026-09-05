/**
 * ResolveSubjectNext — what a scanned `subject_next` ticket means RIGHT NOW
 * (spec §6.3, v2 sectioned agenda; Task 11).
 *
 * `BuildAgenda` mints one sessionless ticket per subject and moves on; this is
 * the second caller of the same computation, invoked at SCAN time rather than
 * PRINT time. The ticket names a learner and a subject, not a moment, so the
 * only way to keep it meaning something as the day's work advances underneath
 * it is to recompute "what's next" from scratch on every scan.
 *
 * It recomputes it through the SAME `PlanProjection` the agenda printed from —
 * not "the same way", which is what this file used to say while carrying its
 * own copy of the attestation overlay. Two copies that are byte-identical
 * today are two copies, and the day one of them is edited is the day a child
 * scans a ticket for work the panel then refuses.
 *
 * This use case COMPUTES; it never prints. `ResolveScanAction#subjectNext` is
 * the only caller and is the only place a physical outcome (a worksheet, a
 * dispatch, a slip) gets made from the answer here.
 *
 * A `launch:` unit at `created` surfaces as `move.kind === 'launch'` (Task 12,
 * spec §6) — `ResolveScanAction` routes it through `DoNowService.dispatch`
 * exactly as it does the per-unit `select_unit` path for the same unit, one
 * helper for both callers.
 *
 * For a curriculum entry the session is ENSURED here (reused if the entry
 * already carries one, opened fresh otherwise — the same idempotent rule
 * `offerSession.mjs` gives `BuildAgenda`), and the resulting `state` rides
 * along in the return value. The caller must never re-read the session's
 * events itself — that would risk seeing a different moment than the one this
 * decision was actually made against.
 */
import { programStatusFor } from '#domains/school/agenda.mjs';
import { PlanProjection } from '../PlanProjection.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';
import { pausedExceptionFor } from '../curriculumExceptionProjection.mjs';
import { projectProgramEntry } from '../assignedProgramPlan.mjs';
import { findContinuationEntry } from './continuationEntry.mjs';

export class ResolveSubjectNext {
  // `curriculum`, `assignments`, `attestations` and `curriculumExceptions` are
  // not held: the plan is assembled in ONE place now, and a second handle to
  // its inputs is how this file grew its own copy of the recipe in the first
  // place. `sessions` stays — `ensureSession` is this use case's own job.
  // `launchers` and `logger` are not held either: the only reads this file made
  // of them were the launcher fan-out and the plan-error line, both of which
  // now happen inside the projection under this surface's own event names.
  #sessions; #timezone; #clock; #newSessionId; #planProjection;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id -> launcher, consulted read-only (`status`) — the same map
   *   `ResolveScanAction` separately calls `launch()` on.
   * @param {string|null} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {() => string} deps.newSessionId
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions, launchers = new Map(),
    timezone = null, clock = () => new Date(), newSessionId,
    // Attestation gate-unlock source (spec D2), optional.
    attestations = null,
    curriculumExceptions = null,
    // Shared with `BuildAgenda` and `ResolveAccessCode` in composition, so a
    // scanned ticket can never mean something the printed paper did not say.
    planProjection = null,
    logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions || typeof newSessionId !== 'function') {
      throw new Error('ResolveSubjectNext requires curriculum, assignments, sessions and newSessionId');
    }
    this.#sessions = sessions;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#newSessionId = newSessionId;
    this.#planProjection = planProjection ?? new PlanProjection({
      curriculum, assignments, sessions, attestations, curriculumExceptions,
      launchers, timezone, clock,
      planErrorEvent: 'school.subject.plan-errors',
      launcherFailedEvent: 'school.subject.launcher-failed',
      logger,
    });
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.subject
   * @param {boolean} [args.continueToday] the token asked to continue past a served day
   * @param {string|null} [args.program] the program the token named (the daily
   *   reading code names `book-log`; forwardAction's tokens name none)
   * @returns {Promise<
   *   { kind: 'served', subjectLabel: string } |
   *   { kind: 'locked', remedy: string|null } |
   *   { kind: 'empty' } |
   *   { kind: 'unavailable' } |
   *   { kind: 'program', programId: string, unit: object|null } |
   *   { kind: 'move', move: object, sessionId: string, state: object, unit: object|null, entry: object }
   * >}
   */
  async execute({
    learnerId, subject, continueToday = false, program = null,
  } = {}) {
    // BuildAgenda's recipe, not a copy of it. The ticket names a learner and a
    // subject rather than a moment, so "what's next" is recomputed on every
    // scan — and it must be recomputed the same WAY the paper was printed, or
    // the receipt promises work the panel then refuses.
    const {
      plan, sections, activeExceptions, programStatuses, projection,
    } = await this.#planProjection.project({
      learnerId,
      planErrorEvent: 'school.subject.plan-errors',
      launcherFailedEvent: 'school.subject.launcher-failed',
    });
    const { units, nowIso } = projection;

    const section = sections.find((s) => s.subject === subject);
    if (!section) return { kind: 'empty' };
    if (section.servedToday && !continueToday) return { kind: 'served', subjectLabel: subject };

    // The served-day continuation is ONE rule shared with `ResolveAccessCode`
    // (`continuationEntry.mjs`): read `plan.entries` by status, prefer the
    // program the token named. Two inline copies of this line drifted once.
    // A token that names a program names the destination, even before the
    // subject has been served. English curriculum and the reading shelf share
    // a subject; letting `section.next` win first made User_4's reading code open
    // the English lesson whenever that lesson happened to sort first.
    const requestedProgram = program ? findContinuationEntry(plan, { subject, program }) : null;
    const entry = requestedProgram?.program === program
      ? requestedProgram
      : (section.next ?? (continueToday && section.servedToday
        ? findContinuationEntry(plan, { subject, program })
        : null));
    if (!entry) {
      if (section.lockedRemedy) return { kind: 'locked', remedy: section.lockedRemedy };
      if (section.programUnavailable) return { kind: 'unavailable' };
      return { kind: 'empty' };
    }

    const unitsById = new Map(units.map((u) => [u.unitId, u]));
    const unit = unitsById.get(entry.unitId) ?? null;

    // A program entry never gets a session — there is nothing here to track,
    // same rule `BuildAgenda#offerFor` follows for the identical case.
    if (entry.program) {
      const status = programStatusFor(programStatuses, entry);
      if (status?.error === true) return { kind: 'unavailable' };
      return {
        kind: 'program', programId: entry.program,
        unit: projectProgramEntry(entry, status),
      };
    }

    const paused = pausedExceptionFor(activeExceptions, entry.unitId);
    if (paused) return { kind: 'locked', remedy: `Content paused: ${paused.reason}` };

    const { sessionId, state } = await ensureSession({
      entry, learnerId, nowIso, sessions: this.#sessions, newSessionId: this.#newSessionId,
      timezone: this.#timezone,
    });
    const move = nextMove(unit ?? {}, state);
    return {
      kind: 'move', move, sessionId, state, unit, entry,
    };
  }

}

export default ResolveSubjectNext;
