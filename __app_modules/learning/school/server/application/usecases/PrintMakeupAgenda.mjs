/**
 * PrintMakeupAgenda — print the makeup sheet: one card per subject still owed
 * from earlier this week (`GetMakeupWork`), each carrying a `subject_next`
 * ticket with `continueToday` so it opens the NEXT lesson in that subject even
 * once today's is done. That spare lesson is exactly what `foldMakeup` credits
 * to the missed day.
 *
 * Called by a `makeup_print` scan or typed code. The ticket names only the
 * learner, so what prints is recomputed here every time: a subject made up
 * since the agenda printed is not on the sheet.
 */
import { mintToken } from "../../domain/sessions/tokens.mjs";
import { mintAccessCode, DEFAULT_ACCESS_CODE_MAX_USES } from "../../domain/sessions/accessCode.mjs";
import { makeupDocument, makeupBySubject } from "../../domain/documents/receipts.mjs";
import { studyDayWindowForDate } from "../../domain/studyDay.mjs";

const BOUNDARY_HOUR = 4;

export class PrintMakeupAgenda {
  #getMakeupWork; #tokens; #receipts; #resolveSubjectNext; #roster; #timezone; #clock; #rng;
  #selfService; #accessCodeMaxUses; #logger;

  /**
   * @param {object} deps
   * @param {import('./GetMakeupWork.mjs').GetMakeupWork} deps.getMakeupWork
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {{print: Function}} deps.receipts  ReceiptPrinting
   * @param {{peek: Function}|null} [deps.resolveSubjectNext] - consulted read-only
   *   to learn whether a subject's next entry is a program, so its ticket names it
   * @param {{displayName?: Function}|null} [deps.roster]
   * @param {{enabled?: boolean, codeMaxUses?: number}|null} [deps.selfService] - with
   *   `enabled`, every card also carries a six-digit panel code
   * @param {string|null} [deps.timezone]
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {object} [deps.logger]
   */
  constructor({
    getMakeupWork, tokens, receipts, resolveSubjectNext = null, roster = null,
    selfService = null, timezone = null, clock = () => new Date(), rng = Math.random, logger = console,
  } = {}) {
    if (!getMakeupWork || !tokens || !receipts) {
      throw new Error('PrintMakeupAgenda requires getMakeupWork, tokens and receipts');
    }
    this.#getMakeupWork = getMakeupWork;
    this.#tokens = tokens;
    this.#receipts = receipts;
    this.#resolveSubjectNext = resolveSubjectNext;
    this.#roster = roster;
    this.#selfService = selfService?.enabled === true && typeof tokens.liveAccessCodes === 'function';
    const maxUses = selfService?.codeMaxUses;
    this.#accessCodeMaxUses = Number.isInteger(maxUses) && maxUses > 0 ? maxUses : DEFAULT_ACCESS_CODE_MAX_USES;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#rng = rng;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string}} args
   * @returns {Promise<{printed: boolean, reason?: 'nothing_to_make_up'|'print_failed',
   *   subjects?: string[], days?: string[], deadline?: string|null}>}
   */
  async execute({ learnerId } = {}) {
    const { deadline, items } = await this.#getMakeupWork.execute({ learnerId });
    if (!items.length) {
      this.#logger.info?.('school.makeup.nothing-to-print', { learnerId });
      return { printed: false, reason: 'nothing_to_make_up' };
    }
    const now = this.#clock();
    const nowIso = now.toISOString();
    // The ticket lives until the deadline's study day ends: the work counts
    // through that day, and the sheet should open it through that day.
    const window = deadline
      ? studyDayWindowForDate(deadline, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR })
      : null;
    const expiresAt = window && window.endAtMs > now.getTime()
      ? new Date(window.endAtMs).toISOString()
      : new Date(now.getTime() + 24 * 3_600_000).toISOString();

    const groups = makeupBySubject(items);
    const liveCodes = this.#selfService ? new Set(await this.#tokens.liveAccessCodes() ?? []) : new Set();
    const minted = new Set();
    const tokensBySubject = {};
    const accessCodesByToken = {};
    for (const { subject, days } of groups) {
      // eslint-disable-next-line no-await-in-loop
      const program = await this.#programFor(learnerId, subject);
      const accessCode = this.#selfService
        ? mintAccessCode({ rng: this.#rng, taken: (code) => liveCodes.has(code) || minted.has(code) })
        : null;
      if (accessCode) minted.add(accessCode);
      const record = mintToken({
        tokenClass: 'subject_next',
        // `makeupFor`: the days this ticket makes up. Acting on it claims the
        // session for the oldest of them still owed (`ClaimMakeupLesson`), so
        // the lesson counts for that day rather than today.
        subject: {
          learnerId, subject, continueToday: true, makeupFor: [...days].sort(),
          ...(program ? { program } : {}),
        },
        at: nowIso,
        rng: this.#rng,
        expiresAt,
        ...(accessCode ? {
          accessCode,
          accessCodeExpiresAt: expiresAt,
          // One card may owe several lessons, each opened by a fresh scan.
          maxUses: this.#accessCodeMaxUses * days.length,
        } : {}),
      });
      // eslint-disable-next-line no-await-in-loop
      await this.#tokens.put(record);
      tokensBySubject[subject] = record.token;
      if (record.accessCode) accessCodesByToken[record.token] = record.accessCode;
    }

    const document = makeupDocument({
      learnerId,
      learnerName: this.#roster?.displayName?.(learnerId) ?? null,
      generatedAt: nowIso, timeZone: this.#timezone ?? 'UTC',
      items, deadline, tokensBySubject, accessCodesByToken,
    });
    const subjects = groups.map((group) => group.subject);
    const days = [...new Set(items.map((item) => item.day))];
    const outcome = await this.#receipts.print(document);
    if (!outcome?.printed) {
      this.#logger.warn?.('school.makeup.print-failed', { learnerId, subjects, days });
      return { printed: false, reason: 'print_failed', subjects, days, deadline };
    }
    this.#logger.info?.('school.makeup.printed', { learnerId, subjects, days });
    return { printed: true, subjects, days, deadline };
  }

  /** The program a subject's next entry is, if it is one; null otherwise or on any doubt. */
  async #programFor(learnerId, subject) {
    if (typeof this.#resolveSubjectNext?.peek !== 'function') return null;
    try {
      const next = await this.#resolveSubjectNext.peek({ learnerId, subject, continueToday: true });
      return next?.kind === 'program' && typeof next.programId === 'string' ? next.programId : null;
    } catch (error) {
      this.#logger.warn?.('school.makeup.peek-failed', { learnerId, subject, error: error?.message ?? String(error) });
      return null;
    }
  }
}

export default PrintMakeupAgenda;
