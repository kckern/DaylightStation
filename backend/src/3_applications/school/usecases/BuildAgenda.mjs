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
import { agendaDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';

const DEFAULT_SUBJECT_TOKEN_TTL_HOURS = 168;
const HOUR_MS = 3_600_000;

export class BuildAgenda {
  #curriculum; #assignments; #sessions; #tokens; #launchers; #timezone;
  #clock; #rng; #newSessionId; #ttlMs; #logger;

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
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions, tokens, launchers = new Map(),
    timezone = null, clock = () => new Date(), rng = Math.random,
    newSessionId = () => `ses_${shortId(8)}`,
    subjectTokenTtlHours = DEFAULT_SUBJECT_TOKEN_TTL_HOURS, logger = console,
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
    this.#logger = logger;
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
    const [assignment, units, history] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#sessions.listForLearner(learnerId),
    ]);

    const plan = planLearnerWork({ learnerId, assignment, units, sessions: history, now: nowIso });
    if (plan.errors.length) this.#logger.warn?.('school.agenda.plan-errors', { learnerId, errors: plan.errors });

    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    const { sections } = planDailyAgenda({
      plan, sessions: history, programStatuses, now: nowIso, timezone: this.#timezone,
    });

    const unitsById = new Map(units.map((u) => [u.unitId, u]));
    const offers = [];
    const createdSessions = [];
    const tokensBySubject = {};
    const actionLabelBySubject = new Map();

    for (const section of sections) {
      const entry = section.next;
      if (!entry) continue; // served today, locked-with-no-offer, or unavailable

      // eslint-disable-next-line no-await-in-loop
      const { sessionId, suffix, created } = await this.#offerFor({ entry, unitsById, learnerId, nowIso });
      if (created) createdSessions.push(sessionId);

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
    const sectionsForDocument = sections.map((section) => (actionLabelBySubject.has(section.subject)
      ? { ...section, next: { ...section.next, actionLabel: actionLabelBySubject.get(section.subject) } }
      : section));

    return {
      learnerId,
      plan,
      sections,
      offers,
      createdSessions,
      document: agendaDocument({
        learnerId, learnerName, generatedAt: nowIso, timeZone: this.#timezone,
        sections: sectionsForDocument, tokensBySubject,
      }),
    };
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

export default BuildAgenda;
