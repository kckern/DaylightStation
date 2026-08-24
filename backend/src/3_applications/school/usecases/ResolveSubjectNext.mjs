/**
 * ResolveSubjectNext — what a scanned `subject_next` ticket means RIGHT NOW
 * (spec §6.3, v2 sectioned agenda; Task 11).
 *
 * `BuildAgenda` mints one sessionless ticket per subject and moves on; this is
 * the second caller of the same computation, invoked at SCAN time rather than
 * PRINT time. It reads the plan and the daily sections exactly as `BuildAgenda`
 * does — same planner, same `planDailyAgenda`, same per-program `status()`
 * fan-out with its own try/catch — because the ticket names a learner and a
 * subject, not a moment, and the only way to keep it meaning something as the
 * day's work advances underneath it is to recompute "what's next" from
 * scratch on every scan.
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
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { collectProgramStatuses } from '../programStatusCollection.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';
import { pausedExceptionFor, withCurriculumExceptions } from '../curriculumExceptionProjection.mjs';

export class ResolveSubjectNext {
  #curriculum; #assignments; #sessions; #launchers; #timezone; #clock; #newSessionId; #logger; #attestations; #curriculumExceptions;

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
    logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions || typeof newSessionId !== 'function') {
      throw new Error('ResolveSubjectNext requires curriculum, assignments, sessions and newSessionId');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#launchers = launchers;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#newSessionId = newSessionId;
    this.#logger = logger;
    this.#attestations = attestations;
    this.#curriculumExceptions = curriculumExceptions;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.subject
   * @returns {Promise<
   *   { kind: 'served', subjectLabel: string } |
   *   { kind: 'locked', remedy: string|null } |
   *   { kind: 'empty' } |
   *   { kind: 'unavailable' } |
   *   { kind: 'program', programId: string, unit: object|null } |
   *   { kind: 'move', move: object, sessionId: string, state: object, unit: object|null, entry: object }
   * >}
   */
  async execute({ learnerId, subject, continueToday = false } = {}) {
    const nowIso = this.#clock().toISOString();
    const [assignment, units, rawHistory, works] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#sessions.listForLearner(learnerId),
      this.#curriculum.listWorks?.() ?? [],
    ]);
    // Same attestation gate-unlock as BuildAgenda: the PLANNER sees the
    // attested unit as passed so its successor unlocks; the daily-serving
    // layer below reads RAW history only — an attestation must not mark the
    // subject served on the repair day itself.
    const attested = (this.#attestations?.list?.({ learnerId }) ?? []).map((a) => ({
      sessionId: `attested:${a.id}`, learnerId, unitId: a.unitId,
      outcome: { result: 'passed' }, attested: true, terminal: true, updatedAt: a.at,
    }));
    const activeExceptions = await this.#curriculumExceptions?.active?.() ?? [];
    const history = withCurriculumExceptions(
      attested.length ? [...rawHistory, ...attested] : rawHistory, activeExceptions, learnerId,
    );

    const coursePolicies = Object.fromEntries((works ?? [])
      .map((work) => [work.work, work.progression]).filter(([, progression]) => progression));
    const plan = planLearnerWork({
      learnerId, assignment, units, sessions: history, now: nowIso, timezone: this.#timezone, coursePolicies,
    });
    if (plan.errors.length) {
      this.#logger.warn?.('school.subject.plan-errors', { learnerId, subject, errors: plan.errors });
    }

    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    const { sections } = planDailyAgenda({
      plan, sessions: rawHistory, programStatuses, now: nowIso, timezone: this.#timezone,
    });

    const section = sections.find((s) => s.subject === subject);
    if (!section) return { kind: 'empty' };
    if (section.servedToday && !continueToday) return { kind: 'served', subjectLabel: subject };

    const entry = section.next ?? (continueToday && section.servedToday
      ? [...plan.inProgress, ...plan.available].find((candidate) => candidate.subject === subject)
      : null);
    if (!entry) {
      if (section.lockedRemedy) return { kind: 'locked', remedy: section.lockedRemedy };
      if (section.programUnavailable) return { kind: 'unavailable' };
      return { kind: 'empty' };
    }

    const unitsById = new Map(units.map((u) => [u.unitId, u]));
    const unit = unitsById.get(entry.unitId) ?? null;

    // A program entry never gets a session — there is nothing here to track,
    // same rule `BuildAgenda#offerFor` follows for the identical case.
    if (entry.program) return { kind: 'program', programId: entry.program, unit };

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

  /**
   * One read-only `status()` call per DISTINCT program instance among the plan's
   * entries — mirrors `BuildAgenda#collectProgramStatuses` exactly. A program
   * that throws or was never registered must not blank the rest of the
   * subject's resolution — it degrades to `{ error: true }`, which
   * `planDailyAgenda` turns into `programUnavailable`.
   */
  async #collectProgramStatuses(plan, learnerId) {
    return collectProgramStatuses({
      plan, learnerId, launchers: this.#launchers, logger: this.#logger,
      logEvent: 'school.subject.launcher-failed',
    });
  }
}

export default ResolveSubjectNext;
