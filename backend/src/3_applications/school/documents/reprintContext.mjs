/**
 * Deriving what actually gets PRINTED on a sheet — the learner's display name
 * and the issue date — from the bare data a worksheet instance persists
 * (`learnerId`, `issuedAt`). This is the SAME derivation IssueDocument.mjs's
 * production issue/reprint path runs inline; both it and the `school-docs
 * reprint` CLI command import from here so the two can never drift apart
 * (ReplaceLostAnswerSheet.mjs's own inline learnerName — the raw id, never
 * title-cased — is the drift this module exists to stop from spreading).
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

/** `'mary-jane_doe'` -> `'Mary Jane Doe'` — split on hyphen/underscore/space, title-case each part. */
export function deriveLearnerName(learnerId) {
  return String(learnerId)
    .split(/[-_\s]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * An ISO timestamp as it prints on the sheet's Date line — day-month-year,
 * household timezone (`DEFAULT_TIMEZONE`, the shared-kernel SSOT).
 *
 * `'en-GB'` here is a FORMAT choice, not a locale preference: it is what gives
 * the day-month-year ordering the sheets print ("14 Aug 2026"). Switching it
 * to `'en-US'` would silently reorder EVERY printed date (and break the
 * byte-for-byte reprint contract against every sheet already in a binder), so
 * leave it alone.
 */
export function deriveIssueDate(isoTimestamp, timeZone = DEFAULT_TIMEZONE) {
  return new Date(isoTimestamp).toLocaleDateString('en-GB', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * The exact render context a card-attached worksheet instance needs to
 * reproduce its print byte-for-byte: same cardId/row range (so
 * `RenderPrintDocument`'s allocation-store idempotent-reprint path returns
 * the SAME live record unchanged, never mutating it), same learner identity,
 * same printed name/date.
 */
export function buildReprintContext(instance) {
  if (!instance?.omr?.cardId || !instance?.omr?.rowRange) {
    throw new ValidationError(
      `worksheet instance '${instance?.id ?? '(unknown)'}' has no card allocation `
      + '(omr.cardId/rowRange); nothing to reprint identically',
      { code: 'REPRINT_NO_CARD', details: { instanceId: instance?.id ?? null } },
    );
  }
  return {
    cardId: instance.omr.cardId,
    startRow: instance.omr.rowRange.start,
    learnerId: instance.learnerId,
    learnerName: deriveLearnerName(instance.learnerId),
    date: deriveIssueDate(instance.issuedAt),
    sessionId: instance.sessionId ?? null,
  };
}
