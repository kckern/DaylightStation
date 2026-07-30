/**
 * BuildAgenda — turn a learner's plan into a piece of paper they can scan
 * (spec §6.3).
 *
 * This is where the console stops being a database and becomes an object in a
 * child's hand. It reads the assignment, asks the planner what there is to do,
 * makes sure every offered choice has a work session behind it, mints ONE opaque
 * token per choice, and returns an agenda document.
 *
 * Three rules it exists to hold:
 *
 *   1. **Re-scanning the card never creates a second session.** An open session
 *      for a unit is REUSED; only a unit with none gets a fresh one. That single
 *      rule satisfies the first two rows of the spec's idempotency matrix.
 *   2. **The planner creates the work session before any work is issued**
 *      (§6.3). Selecting is therefore a state transition, not a creation — which
 *      is what lets `select_unit` be idempotent at all.
 *   3. **Every offered line is scannable, and every unscannable line says why.**
 *      A locked unit prints with its remedy; a unit waiting on a grown-up says
 *      so. Nothing is a bare title with no next move.
 *
 * Token expiry: agenda tokens carry a conservative TTL rather than being revoked
 * when the next agenda prints. Revocation would strand a child holding this
 * morning's sheet the moment a sibling's agenda was drawn, and it is unnecessary:
 * a token names a SESSION, so yesterday's ticket for still-open work is still
 * the right ticket, and once the session advances `resolveTokenState` answers
 * `already_done` on its own.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { agendaDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { ensureSession, nextMove } from './offerSession.mjs';

const DEFAULT_TOKEN_TTL_HOURS = 48;
const HOUR_MS = 3_600_000;

export class BuildAgenda {
  #curriculum; #assignments; #sessions; #tokens; #clock; #rng; #newSessionId; #ttlMs; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng] - injected so a test can mint predictable tokens
   * @param {() => string} [deps.newSessionId]
   * @param {number} [deps.tokenTtlHours]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions, tokens,
    clock = () => new Date(), rng = Math.random,
    newSessionId = () => `ses_${shortId(8)}`,
    tokenTtlHours = DEFAULT_TOKEN_TTL_HOURS, logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions || !tokens) {
      throw new Error('BuildAgenda requires curriculum, assignments, sessions and tokens');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#clock = clock;
    this.#rng = rng;
    this.#newSessionId = newSessionId;
    this.#ttlMs = tokenTtlHours * HOUR_MS;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} [args.learnerName] - what the child is called on the paper
   * @returns {Promise<{ learnerId: string|null, plan: object|null, document: object,
   *                     offers: Array<object>, createdSessions: string[] }>}
   */
  async execute({ learnerId, learnerName = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      // No identity means no session and no records (§ guest path). The child
      // still gets paper — an explanation is the whole point of the slip.
      return {
        learnerId: null,
        plan: null,
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

    const unitsById = new Map(units.map((u) => [u.unitId, u]));
    const offers = [];
    const createdSessions = [];
    const entries = [];

    for (const entry of plan.entries) {
      if (entry.status === 'completed') continue;
      if (entry.status === 'locked') { entries.push(entry); continue; }

      // eslint-disable-next-line no-await-in-loop
      const offer = await this.#offerFor({ entry, unit: unitsById.get(entry.unitId), learnerId, nowIso });
      if (offer.created) createdSessions.push(offer.sessionId);
      offers.push(offer);
      entries.push({ ...entry, sessionId: offer.sessionId, token: offer.token, actionLabel: offer.label });
    }

    return {
      learnerId,
      plan,
      offers,
      createdSessions,
      document: agendaDocument({ learnerId, learnerName, generatedAt: nowIso, entries }),
    };
  }

  /**
   * Make sure this unit has a session and a scannable ticket.
   * @returns {Promise<{unitId, sessionId, token: string|null, tokenClass: string|null, label: string, created: boolean}>}
   */
  async #offerFor({ entry, unit, learnerId, nowIso }) {
    const { sessionId, state, created } = await ensureSession({
      entry, learnerId, nowIso, sessions: this.#sessions, newSessionId: this.#newSessionId,
    });

    const move = nextMove(unit ?? {}, state);
    const label = `${entry.title} — ${move.label}`;
    const tokenClass = move.tokenClass;
    if (!tokenClass) return { unitId: entry.unitId, sessionId, token: null, tokenClass: null, label, created };

    const record = mintToken({
      tokenClass,
      subject: { sessionId },
      at: nowIso,
      rng: this.#rng,
      expiresAt: new Date(Date.parse(nowIso) + this.#ttlMs).toISOString(),
    });
    await this.#tokens.put(record);
    return { unitId: entry.unitId, sessionId, token: record.token, tokenClass, label, created };
  }
}

export default BuildAgenda;
