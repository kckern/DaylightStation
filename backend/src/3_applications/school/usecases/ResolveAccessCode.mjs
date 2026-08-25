/**
 * ResolveAccessCode — six digits typed at the school-room panel become a
 * launch card (self-service access codes design, §4).
 *
 * IT READS. IT DOES NOT WRITE. That is the whole reason this use case exists
 * beside `ResolveSubjectNext` rather than inside it.
 *
 * `ResolveSubjectNext.execute` calls `ensureSession`, and `ensureSession`
 * APPENDS a `created` event for a plan entry that has no session yet
 * (`offerSession.mjs`). At scan time that is correct: a grown-up scanned a
 * ticket, work is starting. At the keypad it is not. `BuildAgenda` pre-creates
 * the session for the entry it printed, so the first code of the day usually
 * lands on an existing one — but the moment the day advances (the first unit
 * graded, so the subject's `next` is a fresh unit) that entry is sessionless,
 * and typing a code would open a work session. A curious child, or one typing
 * a SIBLING's code off their paper, would then write `created` sessions into
 * another learner's history, flip plan entries to `in_progress`, and pile up
 * opened-never-touched sessions on the parent board (`WorkSessionReporter`).
 * There is no abandoned-session sweeper to mop that up.
 *
 * So the plan is computed here the same way `ResolveSubjectNext` computes it —
 * same planner, same `planDailyAgenda`, same read-only per-program `status()`
 * fan-out — and the ONE step that differs is the session:
 *
 *   - the entry already has a session -> reduce its events, read-only;
 *   - the entry has none              -> reduce a SYNTHETIC `created` event
 *                                        that is never persisted, and report
 *                                        `sessionId: null`.
 *
 * A `created` state needs no real session to predict the move, which is what
 * makes the synthetic reduction accurate rather than a guess. `sessionId` is
 * deliberately `null` in that case: an id for a session that does not exist is
 * a trap for whoever acts on this card next, and opening one for real is
 * `/act`'s job, not this one's.
 *
 * DUPLICATION, DELIBERATELY. The plan computation below mirrors
 * `ResolveSubjectNext.execute`. Keep the two in step: a change to the planner
 * inputs, the attestation gate-unlock, or the daily sectioning belongs in both.
 * The alternative — a `writes: false` flag threaded through the scan-time
 * resolver — puts the no-write guarantee inside the file whose default is to
 * write, where a later edit can drop it with nothing to notice.
 *
 * NEVER A DEAD END. Every failure — an unknown code, an expired one, a revoked
 * one, junk, or a catalog that will not load — comes back as a card with a
 * sentence on it. This use case does not throw; a keypad that says nothing is
 * the failure the whole subsystem exists to avoid.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda, programStatusFor } from '#domains/school/agenda.mjs';
import { collectProgramStatuses } from '../programStatusCollection.mjs';
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { resumeAgeDays } from '#domains/school/selfService/offeredActions.mjs';
import { buildContextualLaunchCard } from '#domains/school/selfService/contextualLaunchCard.mjs';
import { lessonProgressRows } from '#domains/school/lessonProgress.mjs';
import { courseDisplay, moduleDisplay } from '#domains/school/curriculum/display.mjs';
import { nextMove } from './offerSession.mjs';
import { pausedExceptionFor, withCurriculumExceptions } from '../curriculumExceptionProjection.mjs';
import { appendAssignedProgramEntries, projectProgramEntry } from '../assignedProgramPlan.mjs';

/**
 * The sessionId the synthetic `created` event carries. Never persisted, and
 * named so that anyone who finds it in a log or a debugger can see at a glance
 * that it is not a session id — the reduced state travels out on the
 * resolution, and `sessionId` beside it is `null`.
 */
export const SYNTHETIC_SESSION_ID = 'synthetic:unopened';

/**
 * WHY A REFUSAL CARD CARRIES A `reason`.
 *
 * Both refusals below are `{ok: false}` 200s — this use case never throws, so
 * HTTP status cannot tell them apart. But they mean opposite things to a child
 * standing at the panel, and they earn opposite affordances: a bad code means
 * stay on the keypad and type a better one, while a backend fault means show
 * the message AND a retry button, because there is nothing the child can type
 * that would help.
 *
 * `reason` is the machine-readable discriminator, and it exists so the panel
 * does not have to recognise the refusal by string-matching `sentence`.
 * Duplicating a user-facing string across two layers means rewording this copy
 * for a child reclassifies an outage as a wrong code and removes the
 * retry button — the same dead end, reintroduced by a typo.
 *
 * FOR WHOEVER ADDS A THIRD VALUE (`expired`, `revoked`, …): a consumer must
 * treat an UNRECOGNISED `reason` as a FAULT, never as a bad code. The failure
 * modes are not symmetric — a spurious retry button is a wasted tap, while a
 * missing one strands a child in front of a keypad that cannot help them.
 */

/** Wrong code, dead code, revoked code, junk. The keypad stays alive. */
const TRY_AGAIN = Object.freeze({
  ok: false, reason: 'unknown_code', learner: null, subject: null, title: null,
  sentence: 'Try again.', actions: Object.freeze([]),
});

/** The backend broke, not the child. Distinct wording so the logs and the
 * child's face agree about which of the two happened. */
const NOT_ANSWERING = Object.freeze({
  ok: false, reason: 'not_answering', learner: null, subject: null, title: null,
  sentence: "The school computer isn't answering. Tell a grown-up.",
  actions: Object.freeze([]),
});

export class ResolveAccessCode {
  #tokens; #curriculum; #assignments; #sessions; #launchers; #attestations; #curriculumExceptions;
  #issueDocument; #companions; #roster; #mediaSurface; #timezone; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   *   read-only here: `listForLearner` and `readEvents`. `appendEvent` is never
   *   called, and the regression test for that is the point of this file.
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   * @param {object} [deps.attestations] - the same gate-unlock source BuildAgenda reads
   * @param {{canIssueBank: (bankId: string) => boolean}} [deps.issueDocument]
   *   the ONE authority on whether a bank unit has a sheet to hand out. Absent,
   *   bank work goes to the panel's screen.
   * @param {object} [deps.selfService] - `school.yml`'s `selfService` block; only
   *   `mediaSurface` is read here.
   * @param {string|null} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    tokens, curriculum, assignments, sessions, launchers = new Map(),
    attestations = null, curriculumExceptions = null, issueDocument = null, companions = null, roster = null, selfService = null,
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!tokens || !curriculum || !assignments || !sessions) {
      throw new Error('ResolveAccessCode requires tokens, curriculum, assignments and sessions');
    }
    this.#tokens = tokens;
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#launchers = launchers;
    this.#attestations = attestations;
    this.#curriculumExceptions = curriculumExceptions;
    this.#issueDocument = issueDocument;
    this.#companions = companions;
    this.#roster = roster;
    this.#mediaSurface = selfService?.mediaSurface ?? null;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.code - the six digits, as typed
   * @returns {Promise<{ok: boolean, reason?: 'unknown_code'|'not_answering',
   *                    schema?: 'school.self-service-card/v2',
   *                    learner: string|null, subject: string|null,
   *                    title: string|null, sentence: string|null,
   *                    context?: object, presentation?: object,
   *                    actions: Array<{kind: string, label: string, target?: string,
   *                      role?: string, operation?: string, followUp?: string}>}>}
   *   `sentence` is null when the buttons say it all; `actions` always ends
   *   with the exit on a card, and is empty on a refusal. `reason` is present
   *   only on a refusal, and is what a caller branches on — see the constants
   *   above, including why an unrecognised value must be read as a fault.
   */
  async execute({ code } = {}) {
    return (await this.resolve({ code })).card;
  }

  /**
   * The card AND the resolution it was built from.
   *
   * `RunSelfServiceAction` (`/act`) needs both: the card to check that the
   * button it was asked for is really on offer right now, and the resolution
   * to know WHICH unit, plan entry and session that button acts on. `execute`
   * is this, narrowed to the card — the wire shape `/resolve` answers with.
   *
   * `resolution` is `null` on every refusal. On a card built from a
   * sessionless entry its `sessionId` is `null` and the state it was decided
   * against carries the synthetic id — see the header. Opening a real session
   * is `/act`'s job, and it must never pass that synthetic id on.
   *
   * @param {object} args
   * @param {string} args.code
   * @returns {Promise<{card: object, resolution: object|null}>}
   */
  async resolve({ code } = {}) {
    let record;
    try {
      // Format, expiry, revocation and class are ALL the registry's answer —
      // it returns null for every one of them, and for junk. A second opinion
      // about what six digits means is a second rule to drift from.
      record = await this.#tokens.getByAccessCode(code);
    } catch (error) {
      return { card: this.#faulted('lookup', { error: error?.message ?? String(error) }), resolution: null };
    }

    if (record?.tokenClass === 'worksheet_companion') {
      try {
        return await this.#resolveCompanion(record);
      } catch (error) {
        return {
          card: this.#faulted('resolve-companion', { error: error?.message ?? String(error) }),
          resolution: null,
        };
      }
    }
    const learnerId = record?.subject?.learnerId ?? null;
    const subject = record?.subject?.subject ?? null;
    if (!record || !learnerId || !subject) {
      // Typed at a wall panel by a child, so it is logged rather than
      // swallowed: a code that never works is a minting or expiry bug and
      // there is no other way to see it.
      this.#logger.info?.('school.selfservice.code.rejected', {
        reason: record ? 'unscoped-record' : 'no-live-record',
      });
      return { card: TRY_AGAIN, resolution: null };
    }

    try {
      const resolution = await this.#resolve({ learnerId, subject });
      const options = {
        mediaSurface: this.#mediaSurface,
        bankPrintable: this.#bankPrintable(resolution.unit),
        // `offeredActions` is pure and reads no clock of its own, so the one
        // time value it needs comes from here.
        now: this.#clock(),
      };
      const projection = await this.#projectionFor({ resolution, learnerId, subject, options });
      const card = {
        ok: true,
        learner: learnerId,
        subject,
        title: resolution.unit?.title ?? null,
        sentence: projection.presentation.message,
        ...projection,
      };
      this.#logger.info?.('school.selfservice.code.resolved', {
        learnerId, subject, kind: resolution.kind,
        state: resolution.state?.state ?? null,
        unitId: resolution.unit?.unitId ?? null,
        // A card whose only button is the exit is the interesting one.
        offered: projection.actions.map((a) => a.kind),
      });
      // How often a child picks up work from a previous day, which is the
      // question Felix's eight-day resume raised and nothing could answer:
      // the ordinary `code.resolved` line above says `state: 'reprinted'`
      // without saying reprinted from WHEN. Logged whenever the card decided
      // the work was old enough to name a date, so the log and the paper
      // never disagree about what counts as a resume.
      const resumeDays = resumeAgeDays(resolution.state?.firstIssuedAt, options.now);
      if (resumeDays !== null && resumeDays >= 1) {
        this.#logger.info?.('school.session.stale-resume', {
          sessionId: resolution.state?.sessionId ?? null,
          learnerId,
          subject,
          ageDays: resumeDays,
          firstIssuedAt: resolution.state.firstIssuedAt,
        });
      }
      return { card, resolution };
    } catch (error) {
      return {
        card: this.#faulted('resolve', { learnerId, subject, error: error?.message ?? String(error) }),
        resolution: null,
      };
    }
  }

  async #resolveCompanion(record) {
    const offer = await this.#companions?.get?.(record.subject.companionId);
    if (!offer || offer.learnerId !== record.subject.learnerId) return { card: TRY_AGAIN, resolution: null };
    const unit = await this.#curriculum.getUnit?.(offer.lessonId) ?? null;
    const resolution = { kind: 'companion', offer, record, unit };
    const projection = await this.#projectionFor({
      resolution,
      learnerId: offer.learnerId,
      subject: unit?.subject ?? null,
      options: { mediaSurface: this.#mediaSurface, bankPrintable: false, now: this.#clock() },
    });
    return {
      card: {
        ok: true,
        learner: offer.learnerId,
        subject: unit?.subject ?? null,
        title: unit?.title ?? offer.companion?.payload?.playlist?.title ?? 'Lesson companion',
        sentence: projection.presentation.message,
        ...projection,
      },
      resolution,
    };
  }

  async #projectionFor({ resolution, learnerId, subject, options }) {
    let facts = resolution?.projection ?? null;
    const unit = resolution?.unit ?? null;
    if (!facts && unit) {
      const [assignment, units, sessions, works] = await Promise.all([
        this.#assignments.get(learnerId),
        this.#curriculum.listUnits(),
        this.#sessions.listForLearner(learnerId),
        this.#curriculum.listWorks?.() ?? [],
      ]);
      facts = { assignment, units, sessions, works, nowIso: this.#clock().toISOString() };
    }
    const works = facts?.works ?? [];
    const course = unit?.courseId ? works.find((candidate) => (
      candidate.work === unit.courseId || `${candidate.subject}/${candidate.work}` === unit.courseId
    )) ?? null : null;
    const enrollment = facts?.assignment?.courses?.find?.((candidate) => (
      typeof candidate === 'object' && candidate.courseId === unit?.courseId
    ))?.enrollment ?? null;
    const courseLabel = courseDisplay({ work: course, enrollment, fallback: unit?.courseId ?? 'Course' });
    const moduleLabel = moduleDisplay({
      work: course, enrollment, moduleId: unit?.module, fallbackTitle: unit?.module ?? unit?.title,
    });
    let progress = null;
    if (unit && facts) {
      try {
        progress = lessonProgressRows({
          learnerId,
          unit,
          assignment: facts.assignment,
          units: facts.units,
          sessions: facts.sessions,
          works,
          now: facts.nowIso,
          timezone: this.#timezone,
        });
      } catch (error) {
        this.#logger.warn?.('school.selfservice.card-context-incomplete', {
          learnerId, missing: 'progress', error: error?.message ?? String(error),
        });
      }
    }
    let displayName = null;
    let displayNameError = null;
    try {
      displayName = this.#roster?.displayName?.(learnerId) ?? null;
    } catch (error) {
      displayNameError = error?.message ?? String(error);
    }
    if (!displayName) {
      this.#logger.warn?.('school.selfservice.card-context-incomplete', {
        learnerId, missing: 'learner-display-name', ...(displayNameError ? { error: displayNameError } : {}),
      });
    }
    const programContext = unit?.programContext ?? null;
    return buildContextualLaunchCard({
      resolution,
      learner: { id: learnerId, displayName },
      subjectId: subject ?? unit?.subject ?? null,
      // A valid unit already proves the course association. Catalog metadata
      // enriches its label, but a missing/temporarily-invalid work index must
      // not erase that context from the learner's card.
      course: programContext?.course ?? (unit?.courseId ? { id: unit.courseId, title: courseLabel.title } : null),
      module: programContext?.unit ?? (unit?.module ? {
        id: unit.module,
        title: moduleLabel.title,
        position: moduleLabel.number,
      } : null),
      lesson: programContext?.lesson ?? (unit?.unitId ? { id: unit.unitId, title: unit.title } : null),
      progress: unit?.programProgress ?? progress?.map((row, index) => ({
        scope: index === 0 ? 'course' : 'module',
        ...row,
      })) ?? [],
      options,
    });
  }

  /**
   * `IssueDocument.canIssueBank` — asked once per card, and only for a unit
   * that actually has a bank. Whether a bank unit has a sheet to hand out
   * needs `worksheetInstances`, `assignments` and a bank reader, none of which
   * a pure domain module can reach, which is why `offeredActions` takes the
   * answer rather than making it.
   */
  #bankPrintable(unit) {
    if (!unit?.bank || typeof this.#issueDocument?.canIssueBank !== 'function') return false;
    try {
      return this.#issueDocument.canIssueBank(unit.bank) === true;
    } catch (error) {
      // A bank reader that throws means "we cannot promise paper", which is
      // the screen — not a blank card.
      this.#logger.warn?.('school.selfservice.bank-printable-failed', {
        bank: unit.bank, error: error?.message ?? String(error),
      });
      return false;
    }
  }

  /**
   * The `ResolveSubjectNext` resolution shape, computed WITHOUT ensuring a
   * session. See the file header for why the two are not one function.
   */
  async #resolve({ learnerId, subject }) {
    const nowIso = this.#clock().toISOString();
    const [assignment, units, rawHistory, works] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#sessions.listForLearner(learnerId),
      this.#curriculum.listWorks?.() ?? [],
    ]);

    // Same attestation gate-unlock as BuildAgenda/ResolveSubjectNext: the
    // PLANNER sees an attested unit as passed so its successor unlocks, while
    // the daily-serving layer below reads RAW history only.
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
    appendAssignedProgramEntries(plan, assignment);
    if (plan.errors.length) {
      this.#logger.warn?.('school.selfservice.plan-errors', { learnerId, subject, errors: plan.errors });
    }

    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    const { sections } = planDailyAgenda({
      plan, sessions: rawHistory, programStatuses, now: nowIso, timezone: this.#timezone,
    });

    const projection = { assignment, units, sessions: rawHistory, works, nowIso };
    const withProjection = (value) => ({ ...value, projection });
    const section = sections.find((s) => s.subject === subject);
    if (!section) return withProjection({ kind: 'empty' });
    // No `continueToday` here, ever: the panel has no affordance for "do it
    // again anyway", and that flag is precisely the case that would force a
    // fresh session open on a subject already finished for the day.
    if (section.servedToday) return withProjection({ kind: 'served', subjectLabel: subject });

    const entry = section.next;
    if (!entry) {
      if (section.lockedRemedy) return withProjection({ kind: 'locked', remedy: section.lockedRemedy });
      if (section.programUnavailable) return withProjection({ kind: 'unavailable' });
      return withProjection({ kind: 'empty' });
    }

    const unit = new Map(units.map((u) => [u.unitId, u])).get(entry.unitId) ?? null;
    if (entry.program) return withProjection({
      kind: 'program', programId: entry.program,
      unit: projectProgramEntry(entry, programStatusFor(programStatuses, entry)),
    });

    const paused = pausedExceptionFor(activeExceptions, entry.unitId);
    if (paused) return withProjection({ kind: 'locked', remedy: `Content paused: ${paused.reason}` });

    const { sessionId, state } = await this.#readState({ entry, learnerId, nowIso });
    return withProjection({ kind: 'move', move: nextMove(unit ?? {}, state), sessionId, state, unit, entry });
  }

  /**
   * The read-only half of `ensureSession`. An entry that carries a session is
   * reduced from its real events; one that does not is reduced from a
   * synthetic `created` event built through the SAME constructor a real one
   * goes through (`createEvent`), so the state this card is decided against is
   * structurally identical to the state opening the session would have
   * produced — minus the append.
   */
  async #readState({ entry, learnerId, nowIso }) {
    if (entry.sessionId) {
      return { sessionId: entry.sessionId, state: reduceSession(await this.#sessions.readEvents(entry.sessionId)) };
    }
    const { errors, event } = createEvent({
      type: 'created', at: nowIso, sessionId: SYNTHETIC_SESSION_ID, learnerId, unitId: entry.unitId,
    });
    if (errors.length) throw new Error(`ResolveAccessCode: could not model a fresh session: ${errors.join('; ')}`);
    return { sessionId: null, state: reduceSession([{ ...event, seq: 1 }]) };
  }

  /**
   * One read-only `status()` per distinct program instance, mirroring
   * `ResolveSubjectNext#collectProgramStatuses`. A program that throws or was
   * never registered degrades to `{ error: true }`, which `planDailyAgenda`
   * turns into `programUnavailable` — never a blank card.
   */
  async #collectProgramStatuses(plan, learnerId) {
    return collectProgramStatuses({
      plan, learnerId, launchers: this.#launchers, logger: this.#logger,
      logEvent: 'school.selfservice.launcher-failed',
    });
  }

  #faulted(stage, data) {
    this.#logger.error?.('school.selfservice.code.failed', { stage, ...data });
    return NOT_ANSWERING;
  }
}

export default ResolveAccessCode;
