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
import { collectProgramStatuses } from '../programStatusCollection.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { mintAccessCode } from '#domains/school/sessions/accessCode.mjs';
import { agendaDocument, noticeDocument, reviewNoteLines } from '#domains/school/documents/receipts.mjs';
import { studyDayIndex, offsetMinutesFor, studyDayWindow, studyDayWindowForDate, studyDayForInstant } from '#domains/school/studyDay.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';
import { withCurriculumExceptions } from '../curriculumExceptionProjection.mjs';

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
  #selfService; #curriculumExceptions; #languageReelService; #previewOnly;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id -> launcher. Consulted read-only (`status`) for every
   *   DISTINCT program instance among the plan's entries.
   * @param {string|null} [deps.timezone] - IANA zone the study-day boundary
   *   and the printed time are both read against
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng] - injected so a test can mint predictable tokens
   * @param {() => string} [deps.newSessionId]
   * @param {number} [deps.subjectTokenTtlHours]
   * @param {{enabled?: boolean}|null} [deps.selfService] - `school.yml`'s
   *   `selfService` block, passed through by composition. With `enabled: true`
   *   every subject ticket also gets a six-digit panel code, printed beside the
   *   lesson so a child can start their own work at the school-room panel.
   *   Anything else — absent, `false`, a typo — and this use case behaves
   *   exactly as it did before the feature existed: no code minted, no key on
   *   the record, no line on the paper. Requires a token registry that can
   *   report its live codes (`liveAccessCodes`).
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
    selfService = null, curriculumExceptions = null, languageReelService = null,
    // A planning preview may render the same agenda without manufacturing a
    // plausible-looking scan ticket.  It is deliberately distinct from
    // `selfService`: even when self-service is enabled for real paper, a
    // preview has no actionable QR or digit code at all.
    previewOnly = false,
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
    this.#curriculumExceptions = curriculumExceptions;
    this.#languageReelService = languageReelService;
    this.#previewOnly = previewOnly === true;
    // One switch, read once: `selfService.enabled !== true` is today's agenda,
    // byte for byte — no code minted, no key on the record, no line on the paper.
    this.#selfService = selfService?.enabled === true;
    // A code is only unique if something can say whether it is already taken.
    // Refuse at CONSTRUCTION rather than letting the first agenda of the day
    // discover it: `mintAccessCode` has no default `taken`, and a registry
    // that cannot answer would leave the within-agenda set as the only guard —
    // which never sees yesterday's still-live codes.
    if (this.#selfService && typeof tokens.liveAccessCodes !== 'function') {
      throw new Error('BuildAgenda: selfService requires a token registry with liveAccessCodes');
    }
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
  async execute({ learnerId, learnerName = null, studyDay = null } = {}) {
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

    // A dry-run caller may ask what a particular *study day* would offer.
    // Choose the midpoint of that day rather than treating YYYY-MM-DD as UTC:
    // the planner and printed heading must agree with the household's 4am
    // study-day boundary, including DST. Normal issuance never passes this
    // argument and continues to use the live clock.
    const window = studyDay == null ? null : studyDayWindowForDate(studyDay, {
      timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
    });
    if (studyDay != null && !window) {
      throw new ValidationError('studyDay must be a real date in YYYY-MM-DD form');
    }
    const now = window
      ? new Date(window.startAtMs + Math.floor((window.endAtMs - window.startAtMs) / 2))
      : this.#clock();
    const nowIso = now.toISOString();
    const [assignment, units, works, rawHistory] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#curriculum.listWorks?.() ?? [],
      this.#sessions.listForLearner(learnerId),
    ]);
    const activeExceptions = await this.#curriculumExceptions?.active?.() ?? [];
    const history = withCurriculumExceptions(
      withAttestedPasses(rawHistory, this.#attestations, learnerId), activeExceptions, learnerId,
    );

    const coursePolicies = Object.fromEntries((works ?? []).map((work) => [work.work, work.progression]).filter(([, p]) => p));
    const plan = planLearnerWork({ learnerId, assignment, units, sessions: history, now: nowIso, timezone: this.#timezone, coursePolicies });
    const reelEnrollment = (assignment?.programs ?? []).find((entry) => entry?.programId === 'language-reels'
      && entry?.corpusId === 'korean-language-reels' && entry?.daily?.selection === 'random_category');
    if (reelEnrollment && this.#languageReelService) {
      const dayKey = studyDayForInstant(now.getTime(), { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR });
      const entry = this.#languageReelService.dailyEntry({ learnerId, dayKey, rng: this.#rng });
      if (entry) plan.entries.push(entry);
      else this.#logger.warn?.('school.language-reels.daily-none-approved', { learnerId, dayKey });
    }
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
    // Keyed by TOKEN, not subject (Slice H, 2026-08-22): `receipts.mjs` pairs
    // a code with the QR that carries the SAME token, and a subject key could
    // only ever alias one offer — two tokened offers sharing a subject would
    // silently fight over a single code.
    const accessCodesByToken = {};
    // Two sets, two kinds of collision. `mintedCodes` guards the sheet being
    // built — two lessons on ONE piece of paper must never carry the same code.
    // `liveCodes` guards ACROSS DAYS: a code still live from a previous agenda
    // must not be reissued, or the registry's index keeps only the last writer
    // and the earlier record's code silently stops resolving.
    const mintedCodes = new Set();
    // Read ONCE per build, deliberately: the mint predicate is synchronous.
    let liveCodes = new Set();
    if (this.#selfService) {
      const live = await this.#tokens.liveAccessCodes();
      // "No live codes" and "the registry answered with nothing" are different
      // things, and `new Set(undefined)` cannot tell them apart — it is an
      // empty set either way, which would leave the cross-day guard silently
      // not running. Say so instead.
      if (!live || typeof live[Symbol.iterator] !== 'function') {
        throw new Error('BuildAgenda: tokens.liveAccessCodes must resolve to an iterable of live codes');
      }
      liveCodes = new Set(live);
    }
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

      if (this.#previewOnly) {
        actionLabelBySubject.set(section.subject, 'Preview only — ask a grown-up to start this lesson.');
        offers.push({
          subject: section.subject, unitId: entry.unitId, sessionId,
          token: null, tokenClass: 'preview',
          label: `${entry.title} — ${actionLabelBySubject.get(section.subject)}`,
        });
        continue;
      }

      const expiresAt = new Date(Date.parse(nowIso) + this.#ttlMs).toISOString();
      // `mintAccessCode` tests `taken` SYNCHRONOUSLY, so the registry cannot be
      // asked per draw — a Promise is always truthy and every attempt would read
      // as taken, failing as a (wildly misleading) exhausted code space. The
      // live set is fetched once, above, and closed over here.
      const accessCode = this.#selfService
        ? mintAccessCode({ rng: this.#rng, taken: (code) => liveCodes.has(code) || mintedCodes.has(code) })
        : null;
      if (accessCode) mintedCodes.add(accessCode);
      const record = mintToken({
        tokenClass: 'subject_next',
        subject: { learnerId, subject: section.subject },
        at: nowIso,
        rng: this.#rng,
        expiresAt,
        ...(accessCode ? {
          accessCode,
          // The code dies at the rollover; the token above keeps its week.
          accessCodeExpiresAt: this.#accessCodeExpiryFor(nowIso, expiresAt),
        } : {}),
      });
      // eslint-disable-next-line no-await-in-loop
      await this.#tokens.put(record);

      tokensBySubject[section.subject] = record.token;
      if (record.accessCode) accessCodesByToken[record.token] = record.accessCode;
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
          const enrollment = assignment?.courses?.find((course) => course.courseId === entry?.courseId)?.enrollment;
          const moduleIndex = enrollment?.moduleOrder?.indexOf(entry?.module) ?? -1;
          const moduleTitle = work?.modules?.find((module) => module.module === entry?.module)?.title;
          return {
            subject: section.subject[0].toUpperCase() + section.subject.slice(1),
            course: work?.title ?? entry?.courseId ?? 'Independent study',
            unit: moduleIndex >= 0 ? `Unit ${moduleIndex}: ${moduleTitle}` : (moduleTitle ?? entry?.module ?? entry?.title),
            lesson: entry?.title,
          };
        })(),
        progressLabel: (() => {
          const entry = section.next;
          const enrollment = assignment?.courses?.find((course) => course.courseId === entry?.courseId)?.enrollment;
          const moduleIndex = enrollment?.moduleOrder?.indexOf(entry?.module) ?? -1;
          const lessons = enrollment?.lessonOrder?.[entry?.module] ?? [];
          const lessonIndex = lessons.indexOf(entry?.unitId);
          return moduleIndex >= 0 && lessonIndex >= 0
            ? `Unit ${moduleIndex} · ${lessonIndex + 1}/${lessons.length}`
            : section.progressLabel;
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
        sections: sectionsForDocument, tokensBySubject, accessCodesByToken, notes,
      }),
    };
  }

  /**
   * When the printed code stops working: the next study-day rollover, so a
   * code is only good for the day its paper describes.
   *
   * `studyDayWindow`'s `endAtMs` IS that boundary — one copy of the math, in
   * the domain, so this and `GetTeacherToday` can never disagree about when
   * "today" ends.
   *
   * The clamp is the interesting part. `createTokenRecord` refuses a code that
   * outlives its token (`SCHOOL_ACCESS_CODE_OUTLIVES_TOKEN`), and the two
   * clocks are configured independently: the token's TTL is
   * `lifecycle.subjectTokenTtlHours` (a week by default), the code's is the
   * rollover. Set that TTL under ~24 hours and the rollover lands PAST the
   * token's expiry — which would throw here and take the whole agenda with it.
   * A child would get no paper at all because a grown-up shortened a TTL.
   *
   * So we clamp rather than fail, and say so: the code dies WITH its token,
   * which is exactly the invariant the rule is protecting, and the print
   * survives. The warning names the config key so the household can see why
   * their codes expire early instead of guessing.
   */
  #accessCodeExpiryFor(nowIso, tokenExpiresAt) {
    const rolloverMs = studyDayWindow(Date.parse(nowIso), {
      timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
    }).endAtMs;
    const tokenMs = Date.parse(tokenExpiresAt);
    if (Number.isFinite(tokenMs) && rolloverMs > tokenMs) {
      this.#logger.warn?.('school.agenda.access-code-clamped', {
        configKey: 'lifecycle.subjectTokenTtlHours',
        tokenExpiresAt,
        rolloverAt: new Date(rolloverMs).toISOString(),
        reason: 'subject token TTL is shorter than a study day; the panel code now dies with its token',
      });
      return tokenExpiresAt;
    }
    return new Date(rolloverMs).toISOString();
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
   * DISTINCT program instance among the plan's entries. A program that throws or was
   * never registered must not blank the rest of the agenda — it degrades to
   * `{ error: true }`, which `planDailyAgenda` turns into that subject's
   * "not answering" line.
   *
   * @returns {Promise<Record<string, {doneToday: boolean, progressLabel: string|null,
   *   score: number|null}|{error: true}>>}
   */
  async #collectProgramStatuses(plan, learnerId) {
    return collectProgramStatuses({
      plan, learnerId, launchers: this.#launchers, logger: this.#logger,
      logEvent: 'school.agenda.launcher-failed',
    });
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
    const paused = (await this.#curriculumExceptions?.active?.() ?? [])
      .find((exception) => exception.kind === 'paused' && exception.resolvedLessonIds?.includes(entry.unitId));
    if (paused) return { sessionId: null, suffix: `content paused (${paused.reason})`, created: false };
    const { sessionId, state, created } = await ensureSession({
      entry, learnerId, nowIso, sessions: this.#sessions, newSessionId: this.#newSessionId,
      timezone: this.#timezone,
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
