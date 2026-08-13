/**
 * BuildAgenda — turn a learner's plan into a piece of paper they can scan
 * (spec §6.3, v2 sectioned agenda).
 *
 * This is where the console stops being a database and becomes an object in a
 * child's hand. It reads the assignment, asks the planner what there is to
 * do, sections that flat plan by subject (`planDailyAgenda`), makes sure the
 * one thing each subject offers has a work session behind it, mints ONE
 * opaque token per SUBJECT (not per unit), and returns an agenda document.
 *
 * Three rules it exists to hold:
 *
 *   1. **Re-scanning the card never creates a second session.** An open
 *      session for a unit is REUSED; only a unit with none gets a fresh one.
 *   2. **The planner creates the work session before any work is issued**
 *      (§6.3). Selecting is therefore a state transition, not a creation.
 *   3. **A subject's ticket is sessionless.** `subject_next` names a learner
 *      and a subject, never a unit or a session — a child scans one code per
 *      subject and the resolver (Task 11) works out what "next" means at scan
 *      time, which is what lets the same ticket survive a session advancing
 *      underneath it.
 *
 * Program entries (a unit whose content IS a whole external program) never
 * get a work session here — there is nothing for this console to track, and
 * "starting" one just means sending the child to the Portal.
 *
 * Token expiry: the subject ticket carries a conservative TTL rather than
 * being revoked when the next agenda prints, for the same reason the old
 * per-unit tokens did — a token a child is already holding should keep
 * meaning something.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { agendaDocument, noticeDocument, reviewNoteLines } from '#domains/school/documents/receipts.mjs';
import { studyDayIndex, offsetMinutesFor } from '#domains/school/studyDay.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';

const DEFAULT_SUBJECT_TOKEN_TTL_HOURS = 168;
const HOUR_MS = 3_600_000;
// Study-day boundary agenda.mjs's own `planDailyAgenda` uses when BuildAgenda
// calls it without one (its own default) — kept in step so "yesterday's
// note" and "served today" roll over on the exact same instant.
const BOUNDARY_HOUR = 4;


/**
 * Attestation gate-unlock (spec D2): an attested unit enters the planner's
 * history as a synthetic PASSED session, so its successor unlocks exactly
 * as if the engine had graded it. The row is marked `attested: true` — a
 * reader that must distinguish evidence kinds can.
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

export class BuildAgenda {
  #curriculum; #assignments; #sessions; #tokens; #launchers; #timezone; #attestations; #teacherNotes;
  #clock; #rng; #newSessionId; #ttlMs; #logger; #reviewQueue; #schoolCalcStudies; #schoolCalcMode;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id -> launcher. Consulted read-only (`status`) for every
   *   DISTINCT program id among the plan's entries.
   * @param {string|null} [deps.timezone] - IANA zone the study-day boundary
   *   and the printed time are both read against
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng] - injected so a test can mint predictable tokens
   * @param {() => string} [deps.newSessionId]
   * @param {number} [deps.subjectTokenTtlHours]
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} [deps.reviewQueue] - read
   *   for the "Notes for you" section (spec R7): a grown-up's resolved-item
   *   notes for this learner, from the current or previous study day.
   *   Optional — absent, the agenda simply carries no notes section.
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions, tokens, launchers = new Map(),
    timezone = null, clock = () => new Date(), rng = Math.random,
    newSessionId = () => `ses_${shortId(8)}`,
    subjectTokenTtlHours = DEFAULT_SUBJECT_TOKEN_TTL_HOURS, reviewQueue = null,
    // Repair-wave sources (spec D2/D3), both optional: attestations feed the
    // planner's gate-unlock; teacher notes join the "Notes for you" window.
    attestations = null, teacherNotes = null,
    schoolCalcStudies = null, schoolCalcMode = 'off',
    logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions || !tokens) {
      throw new Error('BuildAgenda requires curriculum, assignments, sessions and tokens');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#launchers = launchers;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#rng = rng;
    this.#newSessionId = newSessionId;
    this.#ttlMs = subjectTokenTtlHours * HOUR_MS;
    this.#reviewQueue = reviewQueue;
    this.#logger = logger;
    this.#attestations = attestations;
    this.#teacherNotes = teacherNotes;
    if (!['off', 'issue', 'preview'].includes(schoolCalcMode)) {
      throw new Error('BuildAgenda schoolCalcMode must be off, issue, or preview');
    }
    this.#schoolCalcStudies = schoolCalcStudies;
    this.#schoolCalcMode = schoolCalcMode;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} [args.learnerName] - what the child is called on the paper
   * @returns {Promise<{ learnerId: string|null, plan: object|null, sections: object[],
   *                     offers: Array<{subject: string, unitId: string, sessionId: string|null,
   *                     token: string, tokenClass: 'subject_next', label: string}>,
   *                     createdSessions: string[], document: object }>}
   */
  async execute({ learnerId, learnerName = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      // No identity means no session and no records (§ guest path). The child
      // still gets paper — an explanation is the whole point of the slip.
      return {
        learnerId: null,
        plan: null,
        sections: [],
        offers: [],
        createdSessions: [],
        document: noticeDocument({
          id: 'no-learner',
          headline: 'Whose card is this?',
          lines: ['We could not tell who scanned. Ask a grown-up to set up your card.'],
        }),
      };
    }

    const now = this.#clock();
    const nowIso = now.toISOString();
    const [assignment, units, works, rawHistory] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#curriculum.listWorks?.() ?? [],
      this.#sessions.listForLearner(learnerId),
    ]);
    const history = withAttestedPasses(rawHistory, this.#attestations, learnerId);

    const coursePolicies = Object.fromEntries((works ?? []).map((work) => [work.work, work.progression]).filter(([, p]) => p));
    const plan = planLearnerWork({ learnerId, assignment, units, sessions: history, now: nowIso, coursePolicies });
    if (plan.errors.length) this.#logger.warn?.('school.agenda.plan-errors', { learnerId, errors: plan.errors });

    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    // RAW history only (M5 review): the synthetic attested rows exist to
    // unlock the PLANNER's gate — the daily-serving layer must not read an
    // attestation as "this subject was served today", or the repair day is
    // exactly the day the agenda goes silent.
    const { sections } = planDailyAgenda({
      plan, sessions: rawHistory, programStatuses, now: nowIso, timezone: this.#timezone,
    });

    const unitsById = new Map(units.map((u) => [u.unitId, u]));
    const offers = [];
    const createdSessions = [];
    const tokensBySubject = {};
    const actionLabelBySubject = new Map();
    const calculatorBySubject = new Map();

    for (const section of sections) {
      const entry = section.next;
      if (!entry) continue; // served today, locked-with-no-offer, or unavailable

      // eslint-disable-next-line no-await-in-loop
      const { sessionId, suffix, created } = await this.#offerFor({ entry, unitsById, learnerId, nowIso });
      if (created) createdSessions.push(sessionId);

      if (entry.schoolcalc) {
        if (!this.#schoolCalcStudies || this.#schoolCalcMode === 'off') {
          throw new Error(`BuildAgenda: SchoolCalc unit '${entry.unitId}' is enabled but study issuance is not wired`);
        }
        const method = this.#schoolCalcMode === 'preview' ? 'preview' : 'ensure';
        // eslint-disable-next-line no-await-in-loop
        const study = await this.#schoolCalcStudies[method]?.({
          workSessionId: sessionId, learnerId,
          unit: unitsById.get(entry.unitId), descriptor: entry.schoolcalc, at: nowIso,
        }) ?? null;
        const calculator = {
          eligible: true,
          ...(study?.studySessionId ? { studySessionId: study.studySessionId } : {}),
          ...(study?.code ? { code: study.code, displayCode: formatStudyCode(study.code) } : {}),
        };
        calculatorBySubject.set(section.subject, calculator);
        actionLabelBySubject.set(section.subject, study?.code
          ? 'Enter on calculator.'
          : 'Calculator eligible — code issued when printed.');
        offers.push({
          subject: section.subject, unitId: entry.unitId, sessionId,
          token: null, tokenClass: 'schoolcalc_study', calculator,
          label: `${entry.title} — ${actionLabelBySubject.get(section.subject)}`,
        });
        continue;
      }

      const record = mintToken({
        tokenClass: 'subject_next',
        subject: { learnerId, subject: section.subject },
        at: nowIso,
        rng: this.#rng,
        expiresAt: new Date(Date.parse(nowIso) + this.#ttlMs).toISOString(),
      });
      // eslint-disable-next-line no-await-in-loop
      await this.#tokens.put(record);

      tokensBySubject[section.subject] = record.token;
      actionLabelBySubject.set(section.subject, suffix);
      offers.push({
        subject: section.subject,
        unitId: entry.unitId,
        sessionId,
        token: record.token,
        tokenClass: 'subject_next',
        label: `${entry.title} — ${suffix}`,
      });
    }

    // `agendaDocument` composes its own "{title} — {actionLabel}" line, so the
    // document sees only the SUFFIX here — the offer above carries the full
    // label, which is a different consumer's concern (Task 11's resolver).
    const worksById = new Map((works ?? []).map((work) => [work.work, work]));
    const sectionsForDocument = sections.map((section) => (actionLabelBySubject.has(section.subject)
      ? { ...section, next: {
        ...section.next,
        taxonomy: (() => {
          const entry = section.next;
          const work = worksById.get(entry?.courseId);
          const moduleTitle = work?.modules?.find((module) => module.module === entry?.module)?.title;
          return {
            subject: section.subject[0].toUpperCase() + section.subject.slice(1),
            course: work?.title ?? entry?.courseId ?? 'Independent study',
            unit: moduleTitle ?? entry?.module ?? entry?.title,
            lesson: entry?.title,
          };
        })(),
        actionLabel: actionLabelBySubject.get(section.subject),
        ...(calculatorBySubject.has(section.subject)
          ? { schoolcalcHandoff: calculatorBySubject.get(section.subject) }
          : {}),
      } }
      : section));

    const enrichedSections = sections.map((section) => (calculatorBySubject.has(section.subject)
      ? { ...section, next: { ...section.next, schoolcalcHandoff: calculatorBySubject.get(section.subject) } }
      : section));

    const notes = await this.#collectNotes(learnerId, now.getTime());

    return {
      learnerId,
      plan,
      sections: enrichedSections,
      offers,
      createdSessions,
      document: agendaDocument({
        learnerId, learnerName, generatedAt: nowIso, timeZone: this.#timezone,
        sections: sectionsForDocument, tokensBySubject, notes,
      }),
    };
  }

  /**
   * "Notes for you" (spec R7): a grown-up's resolved-item notes for this
   * learner, restricted to items marked within the CURRENT or PREVIOUS study
   * day (`studyDay.mjs` boundaries, same 4am rollover `planDailyAgenda`
   * already uses for "served today") — a note from last week is stale
   * homework feedback, not something worth reprinting on every agenda from
   * here on. Never blocks the agenda: an unwired or failing review queue
   * just means no notes section, same as `#collectProgramStatuses`'s own
   * per-source degrade.
   */
  async #collectNotes(learnerId, nowMs) {
    if (!this.#reviewQueue?.listForLearner && !this.#teacherNotes) return [];
    try {
      const reviewItems = this.#reviewQueue?.listForLearner
        ? await this.#reviewQueue.listForLearner(learnerId, { limit: 20 })
        : [];
      // Standalone teacher notes (spec D3) ride the same window and cap as
      // resolved-review notes — one delivery rule, two sources.
      const standalone = (this.#teacherNotes?.list?.({ learnerId }) ?? [])
        .map((n) => ({ note: n.note, gradedAt: n.at }));
      const items = [...reviewItems, ...standalone];
      const offsetMinutes = offsetMinutesFor(this.#timezone, nowMs);
      const todayIndex = studyDayIndex(nowMs, { boundaryHour: BOUNDARY_HOUR, offsetMinutes });
      const windowed = items.filter((item) => {
        const at = Date.parse(item?.gradedAt ?? '');
        if (!Number.isFinite(at)) return false;
        const itemOffset = offsetMinutesFor(this.#timezone, at);
        const itemIndex = studyDayIndex(at, { boundaryHour: BOUNDARY_HOUR, offsetMinutes: itemOffset });
        const daysAgo = todayIndex - itemIndex;
        return daysAgo === 0 || daysAgo === 1;
      });
      return reviewNoteLines(windowed);
    } catch (err) {
      this.#logger.warn?.('school.agenda.notes-failed', { learnerId, error: err?.message ?? String(err) });
      return [];
    }
  }

  /**
   * `programStatuses` for `planDailyAgenda`: one read-only `status()` call per
   * DISTINCT program id among the plan's entries. A program that throws or was
   * never registered must not blank the rest of the agenda — it degrades to
   * `{ error: true }`, which `planDailyAgenda` turns into that subject's
   * "not answering" line.
   *
   * @returns {Promise<Record<string, {doneToday: boolean, progressLabel: string|null,
   *   score: number|null}|{error: true}>>}
   */
  async #collectProgramStatuses(plan, learnerId) {
    const programIds = [...new Set((plan.entries ?? []).filter((e) => e.program).map((e) => e.program))];
    const statuses = {};
    await Promise.all(programIds.map(async (programId) => {
      try {
        const launcher = this.#launchers.get(programId);
        if (!launcher) throw new Error(`no launcher registered for program "${programId}"`);
        statuses[programId] = await launcher.status({ userId: learnerId });
      } catch (err) {
        this.#logger.warn?.('school.agenda.launcher-failed', {
          learnerId, program: programId, error: err?.message ?? String(err),
        });
        statuses[programId] = { error: true };
      }
    }));
    return statuses;
  }

  /**
   * What the section's `next` entry means RIGHT NOW: a program entry never
   * gets a session (there is nothing here to track — whatever surface the
   * program's own launcher dispatches to owns it); a curriculum entry gets
   * `ensureSession` + `nextMove`, exactly as the old per-unit path did, just
   * no longer minting its own token.
   *
   * The suffix used to be hardcoded `'on the Portal'` for EVERY program,
   * which was simply wrong for a surface program like `pe-daily` (dispatches
   * to `garage-fitness`, never the Portal) — a garage PE ticket printed
   * "on the Portal" and sent a child to the wrong room. It now reads the
   * offering launcher's own `locationHint` (`null` for one that declares
   * none, e.g. an unconfigured `SurfaceProgramLauncher`) and only falls back
   * to a generic, location-agnostic phrase — never assumes the Portal.
   *
   * @returns {Promise<{sessionId: string|null, suffix: string, created: boolean}>}
   */
  async #offerFor({ entry, unitsById, learnerId, nowIso }) {
    if (entry.program) {
      const launcher = this.#launchers.get(entry.program);
      const hint = launcher?.locationHint ?? null;
      return { sessionId: null, suffix: hint ?? 'go do this', created: false };
    }
    const { sessionId, state, created } = await ensureSession({
      entry, learnerId, nowIso, sessions: this.#sessions, newSessionId: this.#newSessionId,
    });
    const move = nextMove(unitsById.get(entry.unitId) ?? {}, state);
    return { sessionId, suffix: move.label, created };
  }
}

function formatStudyCode(code) {
  if (!/^[0-9]{6}$/.test(code || '')) throw new Error('BuildAgenda: SchoolCalc code must contain six digits');
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export default BuildAgenda;
