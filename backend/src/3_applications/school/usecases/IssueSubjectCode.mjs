/**
 * IssueSubjectCode — one subject's six-digit code, without the paper.
 *
 * THE BROWSER'S TESTING DOOR ONTO THE DAY BOARD. In a grown-up's browser the
 * status board's subject discs can be tapped; this is what a tap mints. It
 * is deliberately NOT a new way in: the record is the SAME `subject_next`
 * token `BuildAgenda` prints on the agenda — same subject, same TTL, same
 * rollover expiry, same use cap — and the client then types the code into
 * the ordinary keypad path (`/self-service/resolve`, `/act`). Every branch
 * downstream of a printed code is shared, which is the point of a testing
 * door: it must exercise what the child exercises.
 *
 * A reprint mints a fresh ticket even though the session is reused
 * (`BuildAgenda`'s rule), and so does this: no lookup for a live code, one
 * fresh record per tap.
 *
 * NEVER REACHABLE FROM THE PORTAL. The disc is a button only where the board
 * is mounted without a panel screen id (`isPanelSurface`), and this route is
 * under `/lifecycle`, which the locked panel never calls. Every use is
 * logged at warn with the learner named, like the direct-launch door.
 */
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { mintAccessCode, DEFAULT_ACCESS_CODE_MAX_USES } from '#domains/school/sessions/accessCode.mjs';
import { studyDayWindow } from '#domains/school/studyDay.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { BOOK_LOG_PROGRAM_ID } from '#domains/school/bookLog.mjs';

const HOUR_MS = 3_600_000;
const BOUNDARY_HOUR = 4;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

export class IssueSubjectCode {
  #tokens; #rng; #clock; #timezone; #ttlMs; #maxUses; #roster; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {() => number} deps.rng
   * @param {() => Date} [deps.clock]
   * @param {string|null} [deps.timezone]
   * @param {number} [deps.subjectTokenTtlHours] the same knob BuildAgenda reads
   * @param {number} [deps.accessCodeMaxUses]
   * @param {(() => Array<{id: string}>)|null} [deps.roster]
   */
  constructor({
    tokens, rng, clock = () => new Date(), timezone = null,
    subjectTokenTtlHours = 168, accessCodeMaxUses = DEFAULT_ACCESS_CODE_MAX_USES,
    roster = null, logger = console,
  } = {}) {
    if (!tokens || typeof tokens.put !== 'function' || typeof tokens.liveAccessCodes !== 'function') {
      throw new Error('IssueSubjectCode requires a token registry');
    }
    if (typeof rng !== 'function') throw new Error('IssueSubjectCode requires rng');
    this.#tokens = tokens;
    this.#rng = rng;
    this.#clock = clock;
    this.#timezone = timezone;
    this.#ttlMs = subjectTokenTtlHours * HOUR_MS;
    this.#maxUses = accessCodeMaxUses;
    this.#roster = roster;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string, subject: string, program?: string|null}} args
   * @returns {Promise<{code: string, token: string, expiresAt: string, accessCodeExpiresAt: string}>}
   */
  async execute({ learnerId, subject, program = null } = {}) {
    if (!learnerId || !ID_RE.test(String(learnerId))) throw new ValidationError('a learner id is required', { field: 'learnerId' });
    if (!subject || !ID_RE.test(String(subject))) throw new ValidationError('a subject is required', { field: 'subject' });
    if (program !== null && program !== undefined && !ID_RE.test(String(program))) {
      throw new ValidationError('malformed program', { field: 'program' });
    }
    if (this.#roster) {
      const known = (this.#roster() ?? []).some((person) => person?.id === learnerId);
      if (!known) throw new EntityNotFoundError('learner', learnerId);
    }

    const nowIso = this.#clock().toISOString();
    const expiresAt = new Date(Date.parse(nowIso) + this.#ttlMs).toISOString();
    const live = new Set(await this.#tokens.liveAccessCodes());
    const accessCode = mintAccessCode({ rng: this.#rng, taken: (code) => live.has(code) });
    // The reading shelf's code keeps opening once the day's obligation is met
    // and names what it reopens — exactly as the printed agenda's does.
    const reading = program === BOOK_LOG_PROGRAM_ID;
    const record = mintToken({
      tokenClass: 'subject_next',
      subject: {
        learnerId, subject,
        ...(reading ? { continueToday: true, program: BOOK_LOG_PROGRAM_ID } : {}),
      },
      at: nowIso,
      rng: this.#rng,
      expiresAt,
      accessCode,
      accessCodeExpiresAt: this.#accessCodeExpiryFor(nowIso, expiresAt),
      maxUses: this.#maxUses,
    });
    await this.#tokens.put(record);
    this.#logger.warn?.('school.subject-code.issued', {
      learnerId, subject, program: program ?? null, token: record.token, expiresAt: record.accessCodeExpiresAt,
    });
    return {
      code: record.accessCode, token: record.token,
      expiresAt: record.expiresAt, accessCodeExpiresAt: record.accessCodeExpiresAt,
    };
  }

  /** The code dies at the rollover, clamped to its token — BuildAgenda's rule. */
  #accessCodeExpiryFor(nowIso, tokenExpiresAt) {
    const rolloverMs = studyDayWindow(Date.parse(nowIso), { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR }).endAtMs;
    const tokenMs = Date.parse(tokenExpiresAt);
    return Number.isFinite(tokenMs) && rolloverMs > tokenMs ? tokenExpiresAt : new Date(rolloverMs).toISOString();
  }
}

export default IssueSubjectCode;
