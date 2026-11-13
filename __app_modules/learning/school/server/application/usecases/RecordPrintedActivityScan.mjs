/**
 * RecordPrintedActivityScan — a grown-up scans the QR the platform printed on
 * a worksheet (a Beeloo maze or sudoku), and the child it was printed for gets
 * credit.
 *
 * THE SCAN IS THE AUTHORIZATION. Any scan on the household scanner counts, no
 * PIN — the same posture as the agenda print ticket: a parent scanning the
 * code is the sign-off.
 *
 * THE CHILD COMES FROM THE ISSUANCE. The page id alone names nobody; the open
 * issuance recorded when School printed the page carries learnerId, programId
 * and corpusId. A page School never issued earns nothing.
 *
 * CREDIT LANDS ON THE STUDY DAY OF THE SCAN (4am→4am household day), read from
 * the injected clock once. An open issuance never expires.
 *
 * UNENROLLMENT NEVER ERASES EVIDENCE. If the assignment entry has gone since
 * the page was printed, the scan still credits and logs
 * `school.printed-activity.scan-orphaned`.
 *
 * A COMPLETED PAGE IS NEVER RE-ISSUED, to anyone in the household (the
 * launcher excludes every non-voided issuance on the platform). Every copy of
 * a page carries the same QR, so re-issuing it would let an old copy credit
 * whoever holds it now.
 *
 * NEVER THROWS. The answer becomes the scanner's Outcome (`status`, `ok`,
 * `message`), and every path but invalid input tries to print a slip saying
 * what happened. A printer that is missing or refuses costs the slip, never
 * the credit.
 */
import { studyDayForInstant } from '../../domain/studyDay.mjs';
import { noticeDocument } from '../../domain/documents/receipts.mjs';
import { PRINTED_ACTIVITY_PROGRAM_ID } from '../../domain/printedActivity.mjs';

const FAILED_MESSAGE = 'That scan could not be recorded. Scan it again, or check the School log.';
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const errText = (err) => (err && err.message) ? err.message : String(err);

export class RecordPrintedActivityScan {
  #store; #assignments; #receipts; #learnerName; #timezone; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/IPrintedActivityStore.mjs').IPrintedActivityStore} deps.store
   * @param {{get: (learnerId: string) => Promise<object|null>}|null} [deps.assignments]
   * @param {{print: (document: object) => Promise<{printed: boolean}>}} deps.receipts - ReceiptPrinting
   * @param {((learnerId: string) => string|null)|null} [deps.learnerName]
   * @param {string|null} [deps.timezone] - household zone for the study-day boundary
   * @param {() => Date} deps.clock
   * @param {object} deps.logger
   */
  constructor({ store, assignments = null, receipts, learnerName = null, timezone = null, clock, logger } = {}) {
    if (!store) throw new Error('RecordPrintedActivityScan requires a store');
    if (!receipts || typeof receipts.print !== 'function') throw new Error('RecordPrintedActivityScan requires receipts');
    if (typeof clock !== 'function') throw new Error('RecordPrintedActivityScan requires a clock');
    if (!logger) throw new Error('RecordPrintedActivityScan requires a logger');
    this.#store = store;
    this.#assignments = assignments;
    this.#receipts = receipts;
    this.#learnerName = typeof learnerName === 'function' ? learnerName : null;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{platform: string, externalId: string, device?: string|null}} scan
   * @returns {Promise<{status: string, ok: boolean, message: string, printed: boolean,
   *   learnerId?: string, issuanceId?: string}>}
   */
  async execute({ platform, externalId, device = null } = {}) {
    if (!isNonEmptyString(platform) || !isNonEmptyString(externalId)) {
      this.#log('warn', 'school.printed-activity.scan-invalid', { platform: platform ?? null, externalId: externalId ?? null, device });
      return { status: 'invalid', ok: false, message: 'That code is not a worksheet code.', printed: false };
    }
    try {
      return await this.#record({ platform, externalId, device });
    } catch (err) {
      this.#log('error', 'school.printed-activity.scan-failed', { platform, externalId, device, error: errText(err) });
      const printed = await this.#slip(`scan-failed-${externalId}`, FAILED_MESSAGE, []);
      return { status: 'failed', ok: false, message: FAILED_MESSAGE, printed };
    }
  }

  async #record({ platform, externalId, device }) {
    const key = { platform, externalId };
    const open = await this.#store.findOpen(key);

    if (!open) {
      const any = await this.#store.findAny(key);
      if (any?.completedAt) return this.#already(any);
      if (any?.voidedAt) {
        return this.#notCounted(any, 'voided', 'This sheet was cancelled when it was printed. Print a new one.');
      }
      this.#log('info', 'school.printed-activity.scan-unmatched', { platform, externalId, device });
      const headline = 'Not a School sheet';
      const printed = await this.#slip(`unmatched-${externalId}`, headline,
        ["This page wasn't printed by School, so it doesn't count."]);
      return { status: 'not-issued', ok: false, message: headline, printed };
    }

    // One clock read: the completion instant and its study day agree.
    const now = this.#clock();
    const studyDay = studyDayForInstant(now.getTime(), { timezone: this.#timezone });
    const r = await this.#store.complete(open.learnerId, open.issuanceId, { at: now.toISOString(), studyDay, device });

    if (r?.status === 'already') return this.#already(r.issuance ?? open);
    if (r?.status === 'voided') {
      this.#log('warn', 'school.printed-activity.scan-refused', {
        learnerId: open.learnerId, issuanceId: open.issuanceId, platform, externalId, device, status: 'voided',
      });
      return this.#notCounted(open, 'voided', 'This sheet was cancelled when it was printed. Print a new one.');
    }
    if (r?.status !== 'completed') {
      this.#log('warn', 'school.printed-activity.scan-refused', {
        learnerId: open.learnerId, issuanceId: open.issuanceId, platform, externalId, device, status: r?.status ?? null,
      });
      return r?.status === 'missing'
        ? this.#notCounted(open, 'missing', "School couldn't find this sheet's record, so it wasn't counted. Check the School log.")
        : this.#notCounted(open, 'failed', FAILED_MESSAGE);
    }

    const issuance = r.issuance ?? open;
    this.#log('info', 'school.printed-activity.scanned', {
      learnerId: open.learnerId, corpusId: open.corpusId, platform, externalId, studyDay, device,
    });
    await this.#checkOrphan(open);

    const headline = `${this.#name(open.learnerId)}'s ${kindLabel(issuance.kind ?? open.kind)} counted`;
    const printed = await this.#slip(`scanned-${open.issuanceId}`, headline, [issuance.title ?? open.title]);
    return {
      status: 'recorded', ok: true, message: headline, printed,
      learnerId: open.learnerId, issuanceId: open.issuanceId,
    };
  }

  async #already(issuance) {
    const headline = 'Already counted';
    const title = issuance.title ?? 'sheet';
    const printed = await this.#slip(`already-${issuance.issuanceId ?? 'sheet'}`, headline,
      [`${this.#name(issuance.learnerId)}'s ${title} was counted on ${issuance.completedStudyDay ?? 'an earlier day'}.`]);
    return {
      status: 'already', ok: true, message: headline, printed,
      learnerId: issuance.learnerId, issuanceId: issuance.issuanceId,
    };
  }

  async #notCounted(issuance, status, line) {
    const headline = 'Not counted';
    const printed = await this.#slip(`not-counted-${issuance.issuanceId ?? 'sheet'}`, headline, [line]);
    return {
      status, ok: false, message: headline, printed,
      learnerId: issuance.learnerId, issuanceId: issuance.issuanceId,
    };
  }

  /** The credit stands either way; this only makes a removed enrollment visible. */
  async #checkOrphan(issuance) {
    if (!this.#assignments || typeof this.#assignments.get !== 'function') return;
    const { learnerId, corpusId, issuanceId } = issuance;
    try {
      const assignment = await this.#assignments.get(learnerId);
      const programs = Array.isArray(assignment?.programs) ? assignment.programs : [];
      const enrolled = programs.some((p) => p?.programId === PRINTED_ACTIVITY_PROGRAM_ID && p?.corpusId === corpusId);
      if (!enrolled) this.#log('warn', 'school.printed-activity.scan-orphaned', { learnerId, corpusId, issuanceId });
    } catch (err) {
      this.#log('warn', 'school.printed-activity.assignment-unreadable', { learnerId, corpusId, issuanceId, error: errText(err) });
    }
  }

  /** A logger that throws must never turn a written credit into "could not be recorded". */
  #log(level, event, data) {
    try { this.#logger[level]?.(event, data); } catch { /* a broken logger is not the scan's problem */ }
  }

  #name(learnerId) {
    try {
      const name = this.#learnerName?.(learnerId);
      if (isNonEmptyString(name)) return name;
    } catch (err) {
      this.#log('warn', 'school.printed-activity.name-failed', { learnerId, error: errText(err) });
    }
    return learnerId;
  }

  /** @returns {Promise<boolean>} whether paper came out; a printer fault never escapes */
  async #slip(id, headline, lines) {
    try {
      const printed = await this.#receipts.print(noticeDocument({ id, headline, lines }));
      return Boolean(printed?.printed);
    } catch (err) {
      this.#log('warn', 'school.printed-activity.slip-failed', { id, error: errText(err) });
      return false;
    }
  }
}

function kindLabel(kind) {
  return isNonEmptyString(kind) ? kind.trim().toLowerCase() : 'sheet';
}

export default RecordPrintedActivityScan;
